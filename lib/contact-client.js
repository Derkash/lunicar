// E-mails au client depuis la fiche d'une demande (/admino/demande/REF) : message libre avec modèles,
// et refus poli (« Pas intéressé »). Rien ne part sans une action explicite de l'admin.
//
// Expéditeur : CONTACT_FROM (ex. « LUNICAR <contact@lunicar.fr> »), réponses vers CONTACT_REPLY_TO.
// SMTP dédié si CONTACT_SMTP_HOST/USER/PASS, sinon le SMTP du site (SMTP_HOST/USER/PASS).
// Réponses du client : boîte IMAP CONTACT_IMAP_HOST/USER/PASS, sinon celle de l'import Gmail
// (IMAP_USER/IMAP_PASS ou SMTP_USER/SMTP_PASS). Sans identifiants : pas de lecture des réponses.
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { SITE } = require('./config');

const env = k => String(process.env[k] || '').trim();
const LIMITE_OBJET = 200;
const LIMITE_TEXTE = 10000;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
const emailValide = e => typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e);
// Repères à remplacer dans les modèles ([montant bas], [date]…) : l'envoi est refusé tant qu'il en reste.
// Copie systématique (visible) des confirmations de rendez-vous : l'équipe terrain suit chaque rendez-vous confirmé.
const COPIE_CONFIRMATION_RDV = ['yakautoservices@gmail.com', 'guirassy.youssouf@gmail.com'];

const REPERE = /\[(montant|date|heure|lieu|à compléter)[^\]]*\]/i;
// Formulations interdites dans tout e-mail au client (règles éditoriales LUNICAR) : l'envoi est refusé.
// Mêmes garde-fous que le site : aucune promesse de délai, de validité ou de prix garanti dans un e-mail client.
const INTERDITS = /optimerch|depuis paris|basée? à paris|\b24 ?h\b|sous 48 ?h|\d+ jours? (ouvré|de validité)|valable \d+|cash|en espèces|meilleur prix|prix garanti|garanti(e|es|s)? (le|au|à)\b|se déplace|nos clients/i;

// ---------------------------------------------------------------- Configuration
function smtp() {
    if (env('CONTACT_SMTP_HOST') && env('CONTACT_SMTP_USER') && env('CONTACT_SMTP_PASS')) {
        return { host: env('CONTACT_SMTP_HOST'), port: Number(env('CONTACT_SMTP_PORT')) || 587, user: env('CONTACT_SMTP_USER'), pass: env('CONTACT_SMTP_PASS'), dedie: true };
    }
    if (env('SMTP_USER') && env('SMTP_PASS')) {
        return { host: env('SMTP_HOST') || 'smtp.gmail.com', port: Number(env('SMTP_PORT')) || 587, user: env('SMTP_USER'), pass: env('SMTP_PASS'), dedie: false };
    }
    return null;
}
function expediteur() {
    const s = smtp();
    // Le client voit toujours « LUNICAR » comme expéditeur : on ne garde que l'adresse de CONTACT_FROM / SMTP_USER.
    const adr = (String(env('CONTACT_FROM') || '').match(/<([^>]+)>/) || [])[1] || (/@/.test(env('CONTACT_FROM') || '') ? env('CONTACT_FROM').trim() : '') || (s ? s.user : '');
    const from = adr ? `"LUNICAR" <${adr}>` : '';
    const replyTo = env('CONTACT_REPLY_TO') || '';
    return { from, replyTo };
}
function imap() {
    if (env('CONTACT_IMAP_USER') && env('CONTACT_IMAP_PASS')) {
        return { host: env('CONTACT_IMAP_HOST') || 'imap.gmail.com', port: Number(env('CONTACT_IMAP_PORT')) || 993, user: env('CONTACT_IMAP_USER'), pass: env('CONTACT_IMAP_PASS') };
    }
    const user = env('IMAP_USER') || env('SMTP_USER'), pass = env('IMAP_PASS') || env('SMTP_PASS');
    return user && pass ? { host: env('IMAP_HOST') || 'imap.gmail.com', port: 993, user, pass } : null;
}
function etat() {
    const s = smtp(), { from, replyTo } = expediteur(), i = imap();
    return { envoi: !!s, smtp_dedie: !!(s && s.dedie), from, reply_to: replyTo, reponses: !!i, boite: i ? i.user : '' };
}

let transport = null, cleTransport = '', transportForce = null;
// Tests : transport factice (ex. nodemailer streamTransport), rien ne part. null = retour au SMTP réel.
function utiliserTransport(t) { transportForce = t || null; }
function transporteur() {
    if (transportForce) return transportForce;
    const s = smtp();
    if (!s) return null;
    const cle = `${s.host}:${s.port}:${s.user}`;
    if (!transport || cle !== cleTransport) {
        transport = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: { user: s.user, pass: s.pass }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
        cleTransport = cle;
    }
    return transport;
}

// ---------------------------------------------------------------- Textes
const modeleDe = d => String(((d && d.data) || {}).vehicule || '').trim();
const objetPar = d => `Votre demande LUNICAR ${d.ref}${modeleDe(d) ? ` – ${modeleDe(d)}` : ''}`;
const bonjour = d => { const p = String(((d.data || {}).prenom) || '').trim(); return p ? `Bonjour ${p},` : 'Bonjour,'; };
const votre = d => modeleDe(d) ? `votre ${modeleDe(d)}` : 'votre véhicule';
const signature = () => ['Bien cordialement,', "L'équipe LUNICAR", [SITE.phone && SITE.phone.display, 'lunicar.fr'].filter(Boolean).join(' · ')].join('\n');
const jjmm = iso => String(iso || '').slice(0, 10).split('-').reverse().join('/');

function modeles(d) {
    const s = d.suivi || {}, rdv = s.rdv && s.rdv.statut === 'prevu' ? s.rdv : null;
    return [
        {
            id: 'infos', titre: "Demande d'informations / photos",
            texte: [bonjour(d), '',
                `Merci pour votre demande concernant ${votre(d)}. Pour vous donner une fourchette indicative, pourriez-vous nous envoyer quelques photos (les quatre côtés, l'intérieur, le compteur allumé et les éventuels défauts) et nous préciser :`,
                '- le kilométrage exact ;', "- l'historique d'entretien (factures, carnet) ;", '- les défauts ou réparations à prévoir que vous connaissez.', '',
                'Il vous suffit de répondre à cet e-mail en joignant les photos.', '', signature()].join('\n')
        },
        {
            id: 'fourchette', titre: 'Fourchette indicative',
            texte: [bonjour(d), '',
                `Merci pour les informations transmises sur ${votre(d)}. D'après ces éléments, nous pouvons vous indiquer une fourchette indicative de [montant bas] à [montant haut] €.`, '',
                "Cette fourchette n'est pas une offre ferme : le prix définitif est fixé après vérification du véhicule par un technicien, lors d'un rendez-vous. En cas d'accord, le paiement se fait par virement instantané au moment de la cession.", '',
                'Dites-nous si vous souhaitez convenir d\'un rendez-vous.', '', signature()].join('\n')
        },
        {
            id: 'rdv', titre: 'Confirmation de rendez-vous',
            texte: [bonjour(d), '',
                `Nous vous confirmons notre rendez-vous du ${rdv ? jjmm(rdv.date) : '[date]'} à ${rdv ? rdv.heure.replace(':', ' h ') : '[heure]'}${rdv && rdv.lieu ? `, ${rdv.lieu}` : rdv ? '' : ', [lieu]'}, pour ${votre(d)}.`, '',
                "Un technicien vérifiera le véhicule sur place : le prix définitif est fixé à l'issue de cette vérification. En cas d'accord, le paiement se fait par virement instantané.", '',
                "Merci de prévoir la carte grise, une pièce d'identité, le double des clés et, si vous les avez, le carnet d'entretien et le dernier contrôle technique.", '',
                'En cas d\'empêchement, il suffit de répondre à cet e-mail.', '', signature()].join('\n')
        }
    ];
}

function refus(d) {
    return {
        objet: objetPar(d),
        texte: [bonjour(d), '',
            `Merci de nous avoir contactés pour la vente de ${votre(d)} et pour le temps consacré à votre demande.`, '',
            "Notre équipe l'a étudiée avec attention. Nous sommes au regret de vous informer que nous ne pouvons pas y donner suite : votre véhicule ne correspond pas aujourd'hui à nos critères de rachat.", '',
            "Cette décision ne porte pas de jugement sur votre voiture : elle dépend de notre activité du moment (modèles recherchés, état, kilométrage, frais de remise en état). Si votre situation évolue ou si vous souhaitez nous proposer un autre véhicule, vous pouvez refaire une demande à tout moment sur lunicar.fr.", '',
            'Nous vous souhaitons une vente rapide et sereine.', '', signature()].join('\n')
    };
}

// ---------------------------------------------------------------- Envoi
// Version HTML aux couleurs de LUNICAR (logo, bandeau, pied de page) ; le texte brut reste joint.
const { layout } = require('./email-layout');

// Contrôle commun : adresse du client, objet et texte (taille, repères oubliés). Renvoie un message d'erreur ou null.
function verifier(d, objet, texte) {
    return verifierA(String(((d.data || {}).email) || '').trim(), objet, texte, "Pas d'adresse e-mail sur cette demande.");
}
function verifierA(a, objet, texte, sansAdresse = 'Adresse du destinataire manquante.') {
    if (!a) return sansAdresse;
    if (!emailValide(a)) return `Adresse e-mail du client invalide : ${a.slice(0, 80)}`;
    if (!objet) return 'Objet vide.';
    if (objet.length > LIMITE_OBJET) return `Objet trop long (${LIMITE_OBJET} caractères maximum).`;
    if (!texte) return 'Message vide.';
    if (texte.length > LIMITE_TEXTE) return `Message trop long (${LIMITE_TEXTE.toLocaleString('fr-FR')} caractères maximum).`;
    if (REPERE.test(objet + texte)) return `Il reste un repère à compléter dans le message : ${(objet + texte).match(REPERE)[0]}`;
    if (INTERDITS.test(objet + texte)) return `Formulation à retirer du message : « ${(objet + texte).match(INTERDITS)[0]} ».`;
    return null;
}

const nettoyerObjet = o => String(o || '').replace(/[\r\n\t]+/g, ' ').trim();
const nettoyerTexte = t => String(t || '').replace(/\r\n?/g, '\n').trim();

// Envoie et renvoie l'entrée à historiser. Lève une erreur au message lisible si rien n'est parti.
async function envoyer(d, { objet, texte, type = 'libre', cci = '', pieces = [] }) {
    objet = nettoyerObjet(objet); texte = nettoyerTexte(texte);
    const err = verifier(d, objet, texte);
    if (err) { const e = new Error(err); e.status = 400; throw e; }
    const t = transporteur();
    if (!t) { const e = new Error("E-mail non envoyé : aucun serveur d'envoi configuré (CONTACT_SMTP_* ou SMTP_USER/SMTP_PASS sur le serveur)."); e.status = 503; throw e; }
    const { from, replyTo } = expediteur();
    const a = d.data.email.trim();
    // Fil de discussion : les envois suivants répondent au premier (même conversation chez le client).
    const precedents = ((d.suivi || {}).emails || []).filter(m => m.message_id).map(m => m.message_id).reverse();
    let info;
    try {
        info = await t.sendMail({
            from, to: a, subject: objet, text: require('./email-layout').texteBrut(texte), html: layout({ titre: objet, texte }),
            ...(pieces.length ? { attachments: pieces.map(p => ({ filename: p.nom, content: p.contenu, contentType: p.type })) } : {}),
            ...(replyTo ? { replyTo } : {}),
            ...(type === 'confirmation_rdv' ? { cc: COPIE_CONFIRMATION_RDV.filter(c => c.toLowerCase() !== a.toLowerCase()) } : {}),
            // Copie cachée : adresse demandée + l'adresse d'invitation Trustpilot (TRUSTPILOT_BCC) sur le mail de remerciement,
            // qui déclenche une invitation « avis vérifié » 7 jours plus tard.
            ...((l => l.length ? { bcc: l } : {})([cci && emailValide(cci) ? cci : '', type === 'remerciement' && emailValide(env('TRUSTPILOT_BCC') || '') ? env('TRUSTPILOT_BCC') : ''].filter(Boolean))),
            ...(precedents.length ? { inReplyTo: precedents[precedents.length - 1], references: precedents.slice(-10) } : {}),
            headers: { 'X-Lunicar-Ref': d.ref }
        });
    } catch (e0) {
        const e = new Error(`E-mail non envoyé : ${e0.message}`); e.status = 502; throw e;
    }
    return { id: crypto.randomUUID(), date: new Date().toISOString(), sens: 'envoye', type, de: from, a, ...(type === 'confirmation_rdv' ? { copie: COPIE_CONFIRMATION_RDV } : {}), objet, texte, message_id: info.messageId || '' };
}

// Réponse à un e-mail reçu dans la boîte contact (écran « Boîte mail »), avec ou sans demande liée.
// Même transport et même gabarit ; en réponse au fil (In-Reply-To / References) pour que la messagerie
// du correspondant range la réponse dans la même conversation.
async function envoyerReponse({ a, objet, texte, inReplyTo, references = [], ref = '', type = 'reponse_boite' }) {
    objet = nettoyerObjet(objet); texte = nettoyerTexte(texte); a = String(a || '').trim();
    const err = verifierA(a, objet, texte);
    if (err) { const e = new Error(err); e.status = 400; throw e; }
    const t = transporteur();
    if (!t) { const e = new Error("E-mail non envoyé : aucun serveur d'envoi configuré (CONTACT_SMTP_* ou SMTP_USER/SMTP_PASS sur le serveur)."); e.status = 503; throw e; }
    const { from, replyTo } = expediteur();
    const refs = [...new Set([...(references || []), inReplyTo].filter(Boolean))].slice(-10);
    let info;
    try {
        info = await t.sendMail({
            from, to: a, subject: objet, text: texte,
            html: layout({ titre: objet, texte, ...(ref ? {} : { pied: 'Vous recevez cet e-mail en réponse à votre message à LUNICAR.' }) }),
            ...(replyTo ? { replyTo } : {}),
            ...(inReplyTo ? { inReplyTo, references: refs } : {}),
            headers: { ...(ref ? { 'X-Lunicar-Ref': ref } : {}), 'X-Lunicar-Boite': '1' }
        });
    } catch (e0) {
        const e = new Error(`E-mail non envoyé : ${e0.message}`); e.status = 502; throw e;
    }
    return { id: crypto.randomUUID(), date: new Date().toISOString(), sens: 'envoye', type, de: from, a, objet, texte, message_id: info.messageId || '', ...(pieces.length ? { pieces: pieces.length } : {}) };
}

// Identifiant stable d'un e-mail reçu (même valeur depuis la boîte et depuis « Vérifier les réponses ») : pas de doublon.
const idMail = (messageId, uid, date) => crypto.createHash('sha1').update(messageId || `${uid}:${date}`).digest('hex').slice(0, 24);
// Fusion dans suivi.emails, sans doublon (par message_id, sinon id), du plus récent au plus ancien.
const fusionEmails = (avant, ajout) => {
    const vus = new Set((avant || []).map(m => m.message_id || m.id));
    return [...(ajout || []).filter(m => !vus.has(m.message_id || m.id)), ...(avant || [])].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 200);
};

// ---------------------------------------------------------------- Réponses du client (IMAP)
// Point d'extension : renvoie les e-mails reçus de l'adresse du client depuis la demande.
// Une autre source (webhook d'un service d'e-mail…) peut alimenter suivi.emails avec le même format :
// { id, date, sens: 'recu', de, objet, texte, message_id }.
const citation = t => {
    const l = String(t || '').replace(/\r\n?/g, '\n').split('\n');
    const fin = l.findIndex(x => /^(le .{4,120} a écrit\s*:|on .{4,120} wrote:|-{2,}\s*(message d'origine|original message)|de\s*:\s.+@|from:\s.+@)/i.test(x.trim()));
    return (fin >= 0 ? l.slice(0, fin) : l).filter(x => !/^\s*>/.test(x)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

async function lireReponses(d) {
    const c = imap();
    if (!c) { const e = new Error('Lecture des réponses non configurée (CONTACT_IMAP_USER/CONTACT_IMAP_PASS).'); e.status = 503; throw e; }
    const a = String(((d.data || {}).email) || '').trim();
    if (!emailValide(a)) return [];
    const { ImapFlow } = require('imapflow');
    const { simpleParser } = require('mailparser');
    const client = new ImapFlow({ host: c.host, port: c.port, secure: true, auth: { user: c.user, pass: c.pass }, logger: false, socketTimeout: 30000 });
    await client.connect();
    const out = [];
    try {
        const boites = await client.list();
        const all = boites.find(b => b.specialUse === '\\All');
        const lock = await client.getMailboxLock(all ? all.path : 'INBOX');
        try {
            const depuis = new Date(new Date(d.created_at || Date.now()).getTime() - 864e5);
            const uids = ((await client.search({ from: a, since: depuis }, { uid: true })) || []).slice(-30);
            for (const uid of uids) {
                const msg = await client.fetchOne(uid, { source: true }, { uid: true });
                if (!msg || !msg.source || msg.source.length > 8 * 1024 * 1024) continue;
                const mail = await simpleParser(msg.source);
                const de = ((mail.from && mail.from.value) || [])[0] || {};
                if (String(de.address || '').toLowerCase() !== a.toLowerCase()) continue;
                const texte = citation(mail.text || (mail.html ? String(mail.html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '') : ''));
                out.push({
                    id: idMail(mail.messageId, uid, mail.date),
                    date: new Date(mail.date || Date.now()).toISOString(), sens: 'recu', de: a,
                    objet: String(mail.subject || '').slice(0, LIMITE_OBJET), texte: texte.slice(0, LIMITE_TEXTE),
                    message_id: mail.messageId || '', pieces: (mail.attachments || []).length,
                    // Pièces jointes utiles (photos, PDF : carte grise, factures…), rangées ensuite avec les photos de la demande.
                    fichiers: (mail.attachments || []).filter(p => /^(image\/|application\/pdf)/.test(p.contentType || '') && p.content && p.content.length <= 10 * 1024 * 1024).slice(0, 10)
                        .map(p => ({ nom: String(p.filename || ('piece.' + (/pdf/.test(p.contentType) ? 'pdf' : 'jpg'))).replace(/[^\w.\-]+/g, '_').slice(0, 80), type: p.contentType, contenu: p.content }))
                });
            }
        } finally { lock.release(); }
    } finally { await client.logout().catch(() => {}); }
    return out;
}

// Aperçu : le même e-mail (gabarit compris) envoyé à des adresses internes, sans rien historiser
// ni changer au statut de la demande. Sert à relire un message ou un modèle avant de l'envoyer au client.
async function apercu(d, { objet, texte, a, pied, pieces = [] }) {
    objet = nettoyerObjet(objet); texte = nettoyerTexte(texte);
    const dest = [...new Set(String(a || '').split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean))];
    if (!dest.length) { const e = new Error('Indiquez au moins une adresse.'); e.status = 400; throw e; }
    if (dest.length > 5) { const e = new Error('5 adresses au maximum.'); e.status = 400; throw e; }
    const mauvaise = dest.find(x => !emailValide(x));
    if (mauvaise) { const e = new Error(`Adresse invalide : ${mauvaise.slice(0, 80)}`); e.status = 400; throw e; }
    if (!objet || !texte) { const e = new Error('Objet et message obligatoires.'); e.status = 400; throw e; }
    if (objet.length > LIMITE_OBJET || texte.length > LIMITE_TEXTE) { const e = new Error('Message trop long.'); e.status = 400; throw e; }
    const t = transporteur();
    if (!t) { const e = new Error("Aucun serveur d'envoi configuré."); e.status = 503; throw e; }
    const { from, replyTo } = expediteur();
    try {
        await t.sendMail({ from, to: dest.join(', '), subject: `[Aperçu] ${objet}`, text: require('./email-layout').texteBrut(texte), html: layout({ titre: objet, texte, ...(pied ? { pied } : {}) }), ...(pieces.length ? { attachments: pieces.map(p => ({ filename: p.nom, content: p.contenu, contentType: p.type })) } : {}), ...(replyTo ? { replyTo } : {}), headers: { 'X-Lunicar-Ref': d.ref, 'X-Lunicar-Apercu': '1' } });
    } catch (e0) { const e = new Error(`Aperçu non envoyé : ${e0.message}`); e.status = 502; throw e; }
    return { envoye_a: dest };
}

module.exports = { etat, modeles, refus, objetPar, envoyer, envoyerReponse, apercu, lireReponses, emailValide, citation, idMail, fusionEmails, expediteur, signature, utiliserTransport, LIMITE_OBJET, LIMITE_TEXTE, COPIE_CONFIRMATION_RDV };
