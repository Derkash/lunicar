// Reprise des anciennes demandes depuis la boîte Gmail qui les a reçues (IMAP).
// Lit tous les formats d'e-mail envoyés par le site depuis décembre 2025 (estimation, rappel,
// abandon, ancien « Nouvelle demande de reprise », photos, Histovec, contact), reconstruit chaque
// demande et range ses photos dans son dossier. Rejouable : rien n'est créé en double.
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const crypto = require('crypto');
const store = require('./store');

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', euro: '€' };
const decode = s => String(s || '').replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITES[e.toLowerCase()] !== undefined ? ENTITES[e.toLowerCase()] : m;
});
const texte = html => decode(String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim();
const cle = s => texte(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s*:\s*$/, '').trim();

// Paires libellé -> valeur (HTML) des deux gabarits : tableau <td>…</td><td>…</td> et <span class="label">.
function paires(html) {
    const out = [];
    for (const m of html.matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi)) out.push([cle(m[1]), m[2]]);
    for (const m of html.matchAll(/<span class="label">([\s\S]*?)<\/span>\s*<span class="value">([\s\S]*?)<\/span>\s*<\/p>/gi)) out.push([cle(m[1]), m[2]]);
    return out;
}

const CHAMPS = {
    'vehicule': 'vehicule', 'marque / modele': 'vehicule', 'annee': 'annee', 'kilometrage': 'kilometrage',
    'etat mecanique': 'mecanique', 'mecanique': 'mecanique', 'etat': 'mecanique', 'particularites': 'mecanique',
    'carrosserie': 'carrosserie', 'exterieur': 'etat_exterieur', 'interieur': 'etat_interieur',
    'carburant': 'carburant', 'boite': 'boite', 'controle technique': 'controle_technique',
    'vendre quand': 'delai', 'autre voiture': 'projet_achat', 'prix souhaite': 'prix_souhaite',
    'e-mail': 'email', 'email': 'email', 'telephone': 'telephone', 'page': 'page', 'provenance': 'provenance',
    'fiche plaque': 'fiche_confirmee', 'nom du titulaire': 'nom_titulaire', 'nom (c.1)': 'nom_titulaire',
    'n° du certificat': 'numero_formule', 'n° de formule': 'numero_formule', 'vin': 'vin',
    'commentaires': 'message', 'message': 'message', 'code postal': 'code_postal'
};

function demandeDepuisEmail(mail) {
    const html = mail.html || '';
    const sujet = mail.subject || '';
    const d = { etat: [], autres: {} };
    for (const [k, vHtml] of paires(html)) {
        const v = texte(vHtml);
        if (!v) continue;
        if (k === 'plaque') {
            const [pl, ...reste] = vHtml.split(/<br\s*\/?>/i);
            d.plaque = texte(pl).toUpperCase();
            if (reste.length) d.plaque_datation = texte(reste.join(' '));
        } else if (k === 'ville') {
            const m = v.match(/^(\d{5})?\s*(.*?)(\s*·\s*Île-de-France)?$/);
            d.code_postal = (m && m[1]) || d.code_postal || '';
            d.ville = ((m && m[2]) || '').trim();
        } else if (k === 'nom') {
            const parts = v.replace(/^(m\.|mme|mlle|monsieur|madame)\s+/i, '').split(/\s+/);
            d.prenom = parts.shift() || ''; d.nom = parts.join(' ');
        } else if (k.startsWith('titulaire de la')) {
            d.titulaire = /^oui/i.test(v) ? 'oui' : /^non/i.test(v) ? 'non' : '';
        } else if (k === 'photos') {
            // compté via les pièces jointes
        } else if (CHAMPS[k]) {
            d[CHAMPS[k]] = v;
        } else {
            d.autres[texte(k)] = v;
        }
    }
    // En-tête des e-mails récents : « Prénom Nom · 06 … »
    const h = html.match(/font-size:22px[^>]*>([^<]*?)\s*·\s*<a href="tel:\+?(\d+)"[^>]*>([^<]*)<\/a>/i);
    if (h) {
        const nom = decode(h[1]).trim();
        if (nom && nom !== 'Sans nom' && !d.prenom) { const p = nom.split(/\s+/); d.prenom = p.shift(); d.nom = p.join(' '); }
        d.telephone = d.telephone || decode(h[3]).trim();
        d.telephone_intl = h[2];
    }
    const urg = html.match(/class="urgence-value">([\s\S]*?)<\/div>/i);
    if (urg && !d.delai) d.delai = texte(urg[1]);
    const etape = html.match(/l'étape <strong>([^<]*)<\/strong>|l&#39;étape <strong>([^<]*)<\/strong>/i);
    if (etape) d.etape = decode(etape[1] || etape[2]);

    d.kilometrage = String(d.kilometrage || '').replace(/[^\d]/g, '');
    d.prix_souhaite = String(d.prix_souhaite || '').replace(/[^\d]/g, '');
    if (!Object.keys(d.autres).length) delete d.autres;

    const refM = (texte(html) + ' ' + sujet).match(/R[ée]f(?:\.|érence)?\s*:?\s*([0-9A-F]{8})\b/i);
    const ref = refM ? refM[1].toUpperCase()
        : crypto.createHash('sha1').update(mail.messageId || sujet + mail.date).digest('hex').slice(0, 8).toUpperCase();
    const type = /rappel/i.test(sujet) ? 'rappel' : 'estimation';
    const origine = /abandonn/i.test(sujet) ? 'abandon' : 'gmail';
    return { ref, type, origine, data: d };
}

const estDemande = s => /(Estimation|Rappel|Abandonn|Nouvelle demande de reprise)/i.test(s) && !/^📷|photo/i.test(s.slice(0, 12));
const estPhotos = s => /^\S*\s*\d+\s+photos?\s+·\s+réf\./i.test(s) || /Histovec reçu/i.test(s);
const estContact = s => /^\S*\s*Contact\s+·/i.test(s);

async function importer({ log = console.log, depuis } = {}) {
    const user = process.env.IMAP_USER || process.env.SMTP_USER;
    const pass = process.env.IMAP_PASS || process.env.SMTP_PASS;
    if (!user || !pass) throw new Error('Identifiants Gmail absents (IMAP_USER/IMAP_PASS ou SMTP_USER/SMTP_PASS)');
    const client = new ImapFlow({ host: process.env.IMAP_HOST || 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
    await client.connect();
    const bilan = { lus: 0, demandes: 0, nouvelles: 0, photos: 0, messages: 0, ignores: 0, erreurs: [] };
    try {
        // « Tous les messages » (nom localisé) : on prend la boîte marquée \All, sinon INBOX.
        const boites = await client.list();
        const all = boites.find(b => b.specialUse === '\\All');
        const lock = await client.getMailboxLock(all ? all.path : 'INBOX');
        try {
            const crit = { gmraw: `subject:(Estimation OR Rappel OR Abandonnée OR "demande de reprise" OR photo OR photos OR Histovec OR Contact)${depuis ? ` after:${depuis.replace(/-/g, '/')}` : ''}` };
            const uids = (await client.search(crit, { uid: true })) || [];
            log(`📬 ${uids.length} e-mails candidats dans ${all ? all.path : 'INBOX'}`);
            const mails = [];
            for await (const msg of client.fetch(uids, { source: true, envelope: true }, { uid: true })) {
                const sujet = (msg.envelope && msg.envelope.subject) || '';
                if (!estDemande(sujet) && !estPhotos(sujet) && !estContact(sujet)) { bilan.ignores++; continue; }
                mails.push(await simpleParser(msg.source));
            }
            bilan.lus = mails.length;
            // Les demandes d'abord, puis les photos (qui ont besoin du dossier de leur demande).
            mails.sort((a, b) => (estPhotos(a.subject || '') - estPhotos(b.subject || '')) || (new Date(a.date) - new Date(b.date)));
            for (const mail of mails) {
                const sujet = mail.subject || '';
                try {
                    if (estContact(sujet)) { await importerContact(mail); bilan.messages++; continue; }
                    if (estPhotos(sujet)) { bilan.photos += await importerPhotos(mail, sujet); continue; }
                    const { ref, type, origine, data } = demandeDepuisEmail(mail);
                    const avant = await store.lireDemande(ref);
                    const created = new Date(mail.date || Date.now()).toISOString();
                    const ligne = store.ligneDepuisDemande({ id: avant ? avant.id : ref.toLowerCase(), createdAt: created, type, ...data }, { origine });
                    ligne.ref = ref;
                    ligne.dossier = avant ? avant.dossier : store.nomDossier(ref, created, data.vehicule);
                    ligne.data.gmail_message_id = mail.messageId;
                    // Anciens e-mails : les photos étaient jointes à la demande elle-même.
                    for (const [i, a] of (mail.attachments || []).filter(a => /^image\//.test(a.contentType)).entries()) {
                        ligne.photos.push(await store.ajouterPhoto(ligne.dossier, `${created.slice(0, 10)}_${i + 1}_${a.filename || 'photo.jpg'}`, a.content));
                        bilan.photos++;
                    }
                    await store.enregistrerDemande(ligne);
                    bilan.demandes++;
                    if (!avant) bilan.nouvelles++;
                } catch (e) {
                    bilan.erreurs.push(`${sujet.slice(0, 80)} : ${e.message}`);
                }
            }
        } finally { lock.release(); }
    } finally { await client.logout().catch(() => {}); }
    await store.ecrireReglage('gmail_import', { date: new Date().toISOString(), ...bilan, erreurs: bilan.erreurs.slice(0, 20) });
    log(`✅ Import Gmail : ${bilan.demandes} demandes (${bilan.nouvelles} nouvelles), ${bilan.photos} photos, ${bilan.messages} messages, ${bilan.erreurs.length} erreurs`);
    return bilan;
}

async function importerPhotos(mail, sujet) {
    const m = sujet.match(/réf\.\s*([0-9A-F]{8})/i);
    if (!m) return 0;
    const ref = m[1].toUpperCase();
    let d = await store.lireDemande(ref);
    if (!d) {
        // Photos dont la demande n'a pas été retrouvée : on crée une fiche minimale pour ne rien perdre.
        const info = sujet.split('·').map(s => s.trim());
        d = await store.enregistrerDemande(store.ligneDepuisDemande({ id: ref.toLowerCase(), createdAt: new Date(mail.date).toISOString(), vehicule: info[2] || '', telephone: info[3] || '' }, { origine: 'gmail' }));
    }
    const pj = (mail.attachments || []).filter(a => /^(image\/|application\/pdf)/.test(a.contentType));
    const ajout = [];
    for (const [i, a] of pj.entries()) {
        ajout.push(await store.ajouterPhoto(d.dossier, `${new Date(mail.date).toISOString().slice(0, 10)}_${i + 1}_${a.filename || 'piece.jpg'}`, a.content));
    }
    const vus = new Set((d.photos || []).map(p => p.path));
    await store.majDemande(ref, { photos: [...(d.photos || []), ...ajout.filter(p => !vus.has(p.path))] });
    return ajout.length;
}

async function importerContact(mail) {
    const html = mail.html || '';
    const tete = html.match(/<strong>([^<]*)<\/strong>\s*·\s*<a href="mailto:([^"]*)"/i);
    const tel = html.match(/href="tel:([^"]*)"/i);
    const corps = html.match(/white-space:pre-wrap[^>]*>([\s\S]*?)<\/p>/i);
    const id = crypto.createHash('sha1').update(mail.messageId || mail.subject + mail.date).digest('hex').slice(0, 32);
    await store.ajouterMessage({
        id, lu: true, createdAt: new Date(mail.date).toISOString(),
        nom: tete ? decode(tete[1]) : (mail.subject || '').replace(/^.*Contact\s+·\s*/, ''),
        email: tete ? decode(tete[2]) : '', telephone: tel ? decode(tel[1]) : '',
        sujet: 'Message depuis le site', message: corps ? texte(corps[1]) : texte(html), import: 'gmail'
    });
}

module.exports = { importer, demandeDepuisEmail };
