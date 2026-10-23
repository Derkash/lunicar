// Boîte mail contact@lunicar.fr dans l'admin : relève IMAP toutes les 3 minutes, notification iOS pour
// chaque e-mail utile, lecture, réponse avec le gabarit LUNICAR (lib/contact-client.js), lien avec le CRM.
//
// Boîte : CONTACT_IMAP_HOST/PORT/USER/PASS (dossier BOITE_IMAP_BOX, INBOX par défaut). Lecture seule :
// les messages sont lus en BODY.PEEK (rien n'est marqué lu sur le serveur), rien n'est déplacé ni supprimé.
// Le statut « lu » est celui de l'admin, pas celui de la messagerie.
//
// Écartés vers le filtre « Autres » (gardés, jamais notifiés) : e-mails de @leboncoin.fr (alertes et codes,
// déjà traités par lib/annonces.js), nos propres envois, notifications automatiques évidentes.
//
// Stockage (réglages clé/valeur) : « boite » (200 derniers e-mails utiles + 60 « Autres », sans le HTML),
// « boite_html:<id> » (HTML assaini d'un e-mail), « boite_imap » (UID déjà lus + validité du dossier),
// « boite_notif » (notifications retenues la nuit), « boite_journal » (20 derniers passages).
const crypto = require('crypto');
const store = require('./store');
const contact = require('./contact-client');

const env = k => String(process.env[k] || '').trim();
const MAX_UTILES = 200, MAX_AUTRES = 60;
const MAX_PAR_PASSAGE = 60;
const LIMITE_SOURCE = 12 * 1024 * 1024;   // au-delà : en-têtes seulement
const LIMITE_TEXTE = 12000;
const LIMITE_HTML = 200 * 1024;
const LIMITE_CID = 150 * 1024;            // image intégrée (cid:) gardée en data: si plus petite
const PREMIER_PASSAGE_JOURS = 14;

function imap() {
    if (!(env('CONTACT_IMAP_USER') && env('CONTACT_IMAP_PASS'))) return null;
    return { host: env('CONTACT_IMAP_HOST') || 'imap.hostinger.com', port: Number(env('CONTACT_IMAP_PORT')) || 993, user: env('CONTACT_IMAP_USER'), pass: env('CONTACT_IMAP_PASS'), box: env('BOITE_IMAP_BOX') || 'INBOX' };
}

// Écritures de « boite » une par une (relève et clics de l'admin ne s'écrasent pas).
let file = Promise.resolve();
const verrou = fn => { const p = file.then(fn, fn); file = p.catch(() => {}); return p; };
const lireListe = async () => (await store.lireReglage('boite', [])) || [];

// ---------------------------------------------------------------- Texte
const ENT = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', euro: '€', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®' };
const decoder = s => String(s || '')
    .replace(/&#x([0-9a-f]+);?/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return ''; } })
    .replace(/&#(\d+);?/g, (m, d) => { try { return String.fromCodePoint(Number(d)); } catch (e) { return ''; } })
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] != null ? ENT[n.toLowerCase()] : m);

// Texte brut lisible : fins de ligne, espaces invisibles, lignes vides en trop.
function nettoyer(t) {
    return String(t || '').replace(/\r\n?/g, '\n').replace(/[​-‍﻿­]/g, '').replace(/[ \t ]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n').trim().slice(0, LIMITE_TEXTE);
}
function htmlVersTexte(html) {
    return nettoyer(decoder(String(html || '')
        .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d|table|blockquote)>/gi, '\n').replace(/<li\b[^>]*>/gi, '- ')
        .replace(/<[^>]+>/g, '')).replace(/[ \t]{2,}/g, ' '));
}
const extraitDe = t => contact.citation(t).replace(/\s+/g, ' ').trim().slice(0, 180);

// ---------------------------------------------------------------- HTML assaini
// Liste blanche de balises et d'attributs : pas de script, pas de formulaire, pas d'iframe, pas d'événement,
// liens http(s)/mailto/tel seulement (ouverts dans un nouvel onglet), styles sans url()/expression.
// Images distantes neutralisées (src -> data-lunicar-src) : l'admin ne les charge que sur demande.
// L'admin affiche en plus ce HTML dans une iframe sandbox sans script, avec une CSP stricte.
const TAGS_OK = new Set('a abbr address b bdi bdo big blockquote br caption center cite code col colgroup dd del dfn div dl dt em font h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre q s samp small span strike strong sub sup table tbody td tfoot th thead tr tt u ul var wbr'.split(' '));
const TAGS_VIDES = /<(script|style|head|title|iframe|object|embed|noscript|noembed|noframes|template|svg|math|textarea|select|button|video|audio|canvas|applet|xml|frameset|form)\b[\s\S]*?<\/\1\s*>/gi;
const ATTRS_OK = new Set(['align', 'valign', 'width', 'height', 'colspan', 'rowspan', 'cellpadding', 'cellspacing', 'border', 'bgcolor', 'color', 'face', 'size', 'dir', 'title', 'alt', 'style', 'span', 'start', 'type', 'nowrap']);
const sansControle = s => decoder(s).replace(/[\u0000- \u007F-\u009F]+/g, '').toLowerCase();
const STYLE_INTERDIT = /url\s*\(|expression|javascript:|vbscript:|@import|behavio(u)?r|-moz-binding|position\s*:\s*(fixed|absolute|sticky)/i;
function style(v) {
    const s = decoder(v);
    if (/\\|&#|\/\*/.test(s)) return '';
    return s.split(';').map(x => x.trim()).filter(x => x && /^[a-z-]+\s*:/i.test(x) && !STYLE_INTERDIT.test(x)).join('; ');
}
const attrEsc = v => String(v).replace(/&(?!(#\d+|#x[0-9a-f]+|[a-z]+);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function assainir(html, { cid = {} } = {}) {
    let h = String(html || '');
    if (!h.trim()) return '';
    for (let i = 0; i < 3; i++) h = h.replace(TAGS_VIDES, '');
    h = h.replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<![^>]*>/g, '').replace(/<\?[\s\S]*?\?>/g, '')
        // Balise dangereuse ouverte et jamais fermée : on coupe tout ce qui suit.
        .replace(/<(script|style|iframe|object|embed|svg|math|template|textarea|xml)\b[\s\S]*$/i, '');
    const out = [];
    const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>|<|[^<]+/g;
    let m;
    while ((m = re.exec(h))) {
        if (m[0] === '<') { out.push('&lt;'); continue; }
        if (!m[2]) { out.push(m[0]); continue; }
        const tag = m[2].toLowerCase(), ferme = m[1] === '/';
        if (!TAGS_OK.has(tag)) continue;
        if (ferme) { out.push(`</${tag}>`); continue; }
        const attrs = [];
        const ra = /([^\s"'>\/=]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
        let a;
        while ((a = ra.exec(m[3] || ''))) {
            const nom = a[1].toLowerCase(), val = a[3] != null ? a[3] : a[4] != null ? a[4] : a[5] != null ? a[5] : '';
            if (tag === 'a' && nom === 'href') {
                const u = sansControle(val);
                if (/^(https?:|mailto:|tel:)/.test(u)) attrs.push(`href="${attrEsc(decoder(val).trim())}"`);
                continue;
            }
            if (tag === 'img' && nom === 'src') {
                const u = sansControle(val);
                if (/^cid:/.test(u)) { const d = cid[decoder(val).trim().slice(4).replace(/^<|>$/g, '')]; if (d) attrs.push(`src="${attrEsc(d)}"`); }
                else if (/^data:image\/(png|jpe?g|gif|webp);base64,/.test(u) && val.length < LIMITE_CID * 1.4) attrs.push(`src="${attrEsc(val.trim())}"`);
                else if (/^https?:/.test(u)) attrs.push(`data-lunicar-src="${attrEsc(decoder(val).trim())}"`);
                continue;
            }
            if (!ATTRS_OK.has(nom)) continue;
            if (nom === 'style') { const s = style(val); if (s) attrs.push(`style="${attrEsc(s)}"`); continue; }
            attrs.push(`${nom}="${attrEsc(decoder(val))}"`);
        }
        if (tag === 'a') attrs.push('target="_blank" rel="noopener noreferrer nofollow"');
        out.push(`<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`);
    }
    const r = out.join('');
    return r.length > LIMITE_HTML ? '' : r;
}

// ---------------------------------------------------------------- Lecture d'un e-mail
const adresseDe = v => (((v && v.value) || [])[0] || {});
const minus = s => String(s || '').trim().toLowerCase();
const DE_AUTO = /^(no-?reply|noreply|ne-?pas-?repondre|nepasrepondre|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notify|newsletters?|news|marketing|alerts?|info-?noreply|automated|robot|system)([+._-]|@)/i;
const DOMAINES_AUTO = /@([a-z0-9-]+\.)*(hostinger\.(com|fr|net)|render\.com|supabase\.(io|com)|accounts\.google\.com|google\.com|apple\.com|facebookmail\.com|linkedin\.com|mailchimp\.com|sendinblue\.com|brevo\.com|mailjet\.com)$/i;
const OBJET_AUTO = /^(r[ée]ponse automatique|automatic reply|auto(matic)?[- ]?reply|absence|out of office|accus[ée] de r[ée]ception|undeliver|delivery status|non remis|mail delivery|returned mail|[ée]chec de (la )?remise)/i;
const estLeboncoin = adr => /@([a-z0-9-]+\.)*leboncoin\.fr$/i.test(String(adr || ''));
const adresseDans = s => ((String(s || '').match(/[^\s<>"',;]+@[^\s<>"',;]+/) || [])[0] || '').toLowerCase();

function nosAdresses() {
    return new Set([env('CONTACT_IMAP_USER'), adresseDans(env('CONTACT_FROM')), env('CONTACT_SMTP_USER'), env('SMTP_USER'), env('ANNONCES_IMAP_USER')]
        .map(minus).filter(Boolean));
}

// Classement : « utile » (notifié, compté) ou « autre » (gardé dans le filtre Autres), avec la raison.
function classer(m, nos = nosAdresses()) {
    const de = minus(m.de), h = m.entetes || {};
    if (estLeboncoin(de)) return { categorie: 'autre', raison: 'Leboncoin (traité par le robot Annonces)' };
    if (nos.has(de) || h['x-lunicar-ref'] || h['x-lunicar-apercu'] || h['x-lunicar-boite']) return { categorie: 'autre', raison: 'Envoi de LUNICAR' };
    if (!de) return { categorie: 'autre', raison: 'Expéditeur inconnu' };
    if (/multipart\/report/i.test(h['content-type'] || '')) return { categorie: 'autre', raison: 'Avis de non-remise' };
    if (DE_AUTO.test(de) || DOMAINES_AUTO.test(de)) return { categorie: 'autre', raison: 'Notification automatique' };
    const auto = String(h['auto-submitted'] || '').toLowerCase();
    if (auto && auto !== 'no') return { categorie: 'autre', raison: 'Réponse automatique' };
    if (/^(bulk|list|junk|auto_reply)$/i.test(String(h.precedence || '').trim())) return { categorie: 'autre', raison: 'Envoi en nombre' };
    if (h['list-unsubscribe'] || h['list-id']) return { categorie: 'autre', raison: 'Lettre d\'information' };
    if (OBJET_AUTO.test(String(m.objet || '').trim())) return { categorie: 'autre', raison: 'Réponse automatique' };
    return { categorie: 'utile', raison: '' };
}

const enteteTexte = v => v == null ? '' : typeof v === 'string' ? v : v.value != null ? String(v.value) : v.text != null ? String(v.text) : Array.isArray(v) ? v.join(', ') : String(v);

// Source brute (Buffer) -> fiche stockée (+ HTML assaini à part).
async function analyser(source, { uid = 0 } = {}) {
    const { simpleParser } = require('mailparser');
    const mail = await simpleParser(source, { skipTextToHtml: true, skipImageLinks: true });
    const de = adresseDe(mail.from), rt = adresseDe(mail.replyTo);
    const entetes = {};
    for (const k of ['x-lunicar-ref', 'x-lunicar-apercu', 'x-lunicar-boite', 'auto-submitted', 'precedence', 'list-unsubscribe', 'list-id', 'content-type']) {
        const v = mail.headers.get(k); if (v != null) entetes[k] = enteteTexte(v).slice(0, 200);
    }
    // mailparser regroupe les en-têtes List-* sous « list » ({ unsubscribe, id… }).
    const list = mail.headers.get('list');
    if (list && typeof list === 'object') { if (list.unsubscribe) entetes['list-unsubscribe'] = '1'; if (list.id) entetes['list-id'] = '1'; }
    const date = new Date(mail.date || Date.now());
    const texte = nettoyer(mail.text || htmlVersTexte(mail.html));
    // Images intégrées (cid:) petites : gardées en data: pour s'afficher sans rien charger de l'extérieur.
    const cid = {};
    for (const a of mail.attachments || []) {
        if (a.cid && a.content && a.size <= LIMITE_CID && /^image\/(png|jpe?g|gif|webp)$/i.test(a.contentType || '')) cid[a.cid] = `data:${a.contentType};base64,${a.content.toString('base64')}`;
    }
    const html = mail.html ? assainir(mail.html, { cid }) : '';
    const message_id = String(mail.messageId || '').slice(0, 300);
    const refs = [].concat(mail.references || []).map(String).filter(Boolean).slice(-10);
    const pieces = (mail.attachments || []).filter(a => !(a.related && a.cid && cid[a.cid])).slice(0, 20)
        .map(a => ({ nom: String(a.filename || 'sans nom').slice(0, 120), type: String(a.contentType || '').slice(0, 80), taille: a.size || 0 }));
    const fiche = {
        id: contact.idMail(mail.messageId, uid, mail.date), uid,
        date: date.toISOString(), recu_le: new Date().toISOString(),
        de: minus(de.address), nom: String(de.name || '').replace(/^["']|["']$/g, '').trim().slice(0, 120),
        reply_to: rt.address && minus(rt.address) !== minus(de.address) ? minus(rt.address) : '',
        a: String((mail.to && mail.to.text) || '').slice(0, 300),
        objet: String(mail.subject || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, contact.LIMITE_OBJET),
        texte, extrait: extraitDe(texte), html: !!html, message_id, references: refs, pieces,
        lu: false, ref: null, reponses: []
    };
    Object.assign(fiche, classer({ ...fiche, entetes }));
    return { fiche, html };
}

// E-mail trop gros : seulement l'enveloppe.
function depuisEnveloppe(env0, uid, taille) {
    const f = ((env0 && env0.from) || [])[0] || {};
    const fiche = {
        id: contact.idMail(env0 && env0.messageId, uid, env0 && env0.date), uid,
        date: new Date((env0 && env0.date) || Date.now()).toISOString(), recu_le: new Date().toISOString(),
        de: minus(f.address), nom: String(f.name || '').slice(0, 120), reply_to: '', a: '',
        objet: String((env0 && env0.subject) || '').slice(0, contact.LIMITE_OBJET),
        texte: `(E-mail de ${Math.round(taille / 1048576)} Mo, trop volumineux pour l'admin : à lire dans la messagerie.)`, extrait: 'E-mail volumineux : à lire dans la messagerie.',
        html: false, message_id: String((env0 && env0.messageId) || ''), references: [], pieces: [], lu: false, ref: null, reponses: []
    };
    Object.assign(fiche, classer(fiche));
    return { fiche, html: '' };
}

// ---------------------------------------------------------------- Lien avec le CRM
// Adresse -> demande : la plus récente non archivée, sinon la plus récente.
function indexDemandes(demandes) {
    const map = new Map();
    for (const d of demandes) {
        const a = minus((d.data || {}).email);
        if (!a) continue;
        const deja = map.get(a);
        if (!deja || ((deja.suivi || {}).archivee && !(d.suivi || {}).archivee) || (!!(deja.suivi || {}).archivee === !!(d.suivi || {}).archivee && d.created_at > deja.created_at)) map.set(a, d);
    }
    return map;
}
const versFil = m => ({ id: m.id, date: m.date, sens: 'recu', de: m.de, objet: m.objet, texte: (contact.citation(m.texte) || m.texte || '').slice(0, contact.LIMITE_TEXTE), message_id: m.message_id, pieces: (m.pieces || []).length, boite: m.id });

// Ajoute des e-mails reçus au fil « Échanges par e-mail » de la fiche (sans doublon avec « Vérifier les réponses »).
async function attacher(ref, msgs) {
    const d = await store.lireDemande(ref);
    if (!d || !msgs.length) return 0;
    const suivi = { ...(d.suivi || {}) }, avant = suivi.emails || [];
    const vus = new Set(avant.map(m => m.message_id || m.id));
    const neufs = msgs.filter(m => !vus.has(m.message_id || m.id));
    if (!neufs.length) return 0;
    suivi.emails = contact.fusionEmails(avant, neufs.map(versFil));
    suivi.historique = [...neufs.map(m => ({ date: m.date, type: 'email', quoi: `E-mail reçu du client : ${m.objet || '(sans objet)'}` })), ...(suivi.historique || [])].slice(0, 300);
    await store.majDemande(d.ref, { suivi });
    return neufs.length;
}

// ---------------------------------------------------------------- Notifications
// Pas entre 22 h et 7 h (heure de Paris) : retenues, puis regroupées dans la première notification du matin.
const heureParis = (d = new Date()) => Number(d.toLocaleString('en-US', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }));
const nuit = (d = new Date()) => { const h = heureParis(d); return h >= 22 || h < 7; };

// Contenu de la notification pour une liste d'e-mails (un seul : expéditeur + objet ; plusieurs : regroupés).
function contenuNotif(liste) {
    if (liste.length === 1) {
        const x = liste[0];
        return { titre: `📧 ${x.qui}`, texte: x.objet || '(sans objet)', ...(x.ref ? { ref: x.ref, fil: 'boite' } : { onglet: 'boite', mail: x.id }) };
    }
    const refs = [...new Set(liste.map(x => x.ref || ''))];
    const qui = [...new Set(liste.map(x => x.qui))];
    return {
        titre: qui.length === 1 ? `📧 ${qui[0]} (${liste.length} e-mails)` : `📧 ${liste.length} nouveaux e-mails`,
        texte: liste.slice(-4).reverse().map(x => qui.length === 1 ? (x.objet || '(sans objet)') : `${x.qui} : ${x.objet || '(sans objet)'}`).join('\n').slice(0, 300),
        ...(refs.length === 1 && refs[0] ? { ref: refs[0], fil: 'boite' } : { onglet: 'boite' })
    };
}

// nouveaux : fiches utiles arrivées à ce passage. Renvoie la notification envoyée (ou null).
async function notifier(nouveaux, maintenant = new Date(), envoyer = p => require('./push').notifier(p)) {
    const att = (await store.lireReglage('boite_notif', null)) || { en_attente: [] };
    let liste = [...(att.en_attente || []), ...nouveaux.map(m => ({ id: m.id, qui: m.nom || m.de, objet: m.objet, ref: m.ref || '' }))];
    if (!liste.length) return null;
    if (nuit(maintenant)) {
        await store.ecrireReglage('boite_notif', { en_attente: liste.slice(-50), depuis: att.depuis || maintenant.toISOString() });
        return null;
    }
    // Au matin : seulement ce qui n'a pas été lu entre-temps dans l'admin.
    if ((att.en_attente || []).length) {
        const lus = new Set((await lireListe()).filter(m => m.lu).map(m => m.id));
        liste = liste.filter(x => !lus.has(x.id));
    }
    await store.ecrireReglage('boite_notif', { en_attente: [] });
    if (!liste.length) return null;
    const p = contenuNotif(liste);
    await Promise.resolve(envoyer(p)).catch(e => console.error('Boîte, notification :', e.message));
    return p;
}

// ---------------------------------------------------------------- Passage
// lus : [{ fiche, html }] déjà analysés. Range, relie au CRM, notifie. Sert aussi aux tests (fixtures).
async function traiter(lus, { initial = false, maintenant = new Date(), demandes = null, envoyerNotif } = {}) {
    const journal = { nouveaux: 0, utiles: 0, autres: 0, lies: 0, notification: null };
    const neufs = [];
    await verrou(async () => {
        const liste = await lireListe();
        const vus = new Set(liste.map(m => m.id));
        for (const { fiche, html } of lus) {
            if (vus.has(fiche.id)) continue;
            vus.add(fiche.id);
            if (initial) fiche.lu = true; // premier passage : historique repris, rien à signaler
            neufs.push({ fiche, html });
        }
        if (!neufs.length) return;
        // Lien avec une demande par l'adresse de l'expéditeur (ou de réponse).
        const idx = indexDemandes(demandes || await store.listerDemandes());
        for (const { fiche } of neufs) {
            if (fiche.categorie !== 'utile') continue;
            const d = idx.get(fiche.de) || (fiche.reply_to && idx.get(fiche.reply_to));
            if (d) { fiche.ref = d.ref; fiche.lie_le = new Date().toISOString(); }
        }
        for (const { fiche, html } of neufs) if (html) await store.ecrireReglage(`boite_html:${fiche.id}`, html).catch(e => console.error('Boîte, HTML :', e.message));
        const tout = [...neufs.map(x => x.fiche), ...liste].sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const utiles = tout.filter(m => m.categorie === 'utile'), autres = tout.filter(m => m.categorie !== 'utile');
        const garde = [...utiles.slice(0, MAX_UTILES), ...autres.slice(0, MAX_AUTRES)];
        const gardes = new Set(garde.map(m => m.id));
        for (const m of tout) if (!gardes.has(m.id) && m.html) await store.ecrireReglage(`boite_html:${m.id}`, null).catch(() => {});
        await store.ecrireReglage('boite', garde);
    });
    journal.nouveaux = neufs.length;
    journal.utiles = neufs.filter(x => x.fiche.categorie === 'utile').length;
    journal.autres = journal.nouveaux - journal.utiles;
    // Fil de la fiche, regroupé par demande.
    const parRef = {};
    for (const { fiche } of neufs) if (fiche.ref) (parRef[fiche.ref] = parRef[fiche.ref] || []).push(fiche);
    for (const [ref, msgs] of Object.entries(parRef)) journal.lies += await attacher(ref, msgs).catch(e => { console.error('Boîte, fiche :', e.message); return 0; });
    if (!initial) journal.notification = await notifier(neufs.filter(x => x.fiche.categorie === 'utile' && !x.fiche.lu).map(x => x.fiche), maintenant, envoyerNotif);
    return journal;
}

// E-mails utiles arrivés avant la demande (ou avant que l'adresse soit saisie) : reliés après coup.
let dernierRattrapage = 0;
async function rattraper(demandes = null) {
    dernierRattrapage = Date.now();
    const orphelins = (await lireListe()).filter(m => m.categorie === 'utile' && !m.ref);
    if (!orphelins.length) return 0;
    const idx = indexDemandes(demandes || await store.listerDemandes());
    const lies = orphelins.filter(m => idx.get(m.de) || (m.reply_to && idx.get(m.reply_to)));
    if (!lies.length) return 0;
    return lier(lies.map(m => m.id), m => (idx.get(m.de) || idx.get(m.reply_to)).ref);
}
// Pose la référence sur les e-mails donnés et les ajoute au fil de leur fiche.
async function lier(ids, refDe) {
    const parRef = {};
    await verrou(async () => {
        const liste = await lireListe();
        for (const m of liste) {
            if (!ids.includes(m.id)) continue;
            const ref = typeof refDe === 'function' ? refDe(m) : refDe;
            if (!ref) continue;
            m.ref = ref; m.lie_le = new Date().toISOString();
            (parRef[ref] = parRef[ref] || []).push(m);
        }
        await store.ecrireReglage('boite', liste);
    });
    let n = 0;
    for (const [ref, msgs] of Object.entries(parRef)) n += await attacher(ref, msgs);
    return n;
}

async function lireImap(journal) {
    const c = imap();
    if (!c) throw Object.assign(new Error('Boîte non configurée (CONTACT_IMAP_USER / CONTACT_IMAP_PASS).'), { status: 503 });
    const { ImapFlow } = require('imapflow');
    const cx = new ImapFlow({ host: c.host, port: c.port, secure: c.port !== 143, auth: { user: c.user, pass: c.pass }, logger: false, socketTimeout: 60000 });
    await cx.connect();
    const lus = [];
    let initial = false;
    try {
        const lock = await cx.getMailboxLock(c.box, { readOnly: true });
        try {
            const etat = (await store.lireReglage('boite_imap', {})) || {};
            const validite = String(cx.mailbox.uidValidity || '');
            const dernier = etat.validite === validite ? Number(etat.dernier_uid) || 0 : 0;
            initial = !dernier;
            const crit = dernier ? { uid: `${dernier + 1}:*` } : { since: new Date(Date.now() - PREMIER_PASSAGE_JOURS * 864e5) };
            const tous = ((await cx.search(crit, { uid: true })) || []).filter(u => u > dernier);
            const uids = tous.slice(-MAX_PAR_PASSAGE);
            let max = dernier;
            for (const u of tous) max = Math.max(max, u);
            for (const uid of uids) {
                try {
                    const info = await cx.fetchOne(uid, { size: true, envelope: true }, { uid: true });
                    if (!info) continue;
                    if (info.size > LIMITE_SOURCE) { lus.push(depuisEnveloppe(info.envelope, uid, info.size)); continue; }
                    const msg = await cx.fetchOne(uid, { source: true }, { uid: true }); // BODY.PEEK[] : reste non lu côté serveur
                    if (msg && msg.source) lus.push(await analyser(msg.source, { uid }));
                } catch (e) { journal.erreurs.push(`UID ${uid} : ${e.message}`.slice(0, 200)); }
            }
            await store.ecrireReglage('boite_imap', { validite, dernier_uid: max, boite: c.user, dossier: c.box, lu_le: new Date().toISOString() });
            journal.lus = uids.length; journal.ignores_volume = tous.length - uids.length;
        } finally { lock.release(); }
    } finally { await cx.logout().catch(() => {}); }
    return { lus, initial };
}

let enCours = null;
function relever(origine = 'auto') {
    if (enCours) return enCours;
    enCours = (async () => {
        const t0 = Date.now();
        const journal = { date: new Date().toISOString(), origine, lus: 0, nouveaux: 0, utiles: 0, autres: 0, lies: 0, notifie: false, erreurs: [] };
        try {
            const { lus, initial } = await lireImap(journal);
            const r = await traiter(lus, { initial });
            Object.assign(journal, { nouveaux: r.nouveaux, utiles: r.utiles, autres: r.autres, lies: r.lies, notifie: !!r.notification, initial });
            if (Date.now() - dernierRattrapage > 30 * 60 * 1000) journal.lies += await rattraper().catch(e => { journal.erreurs.push(e.message); return 0; });
        } catch (e) { journal.erreurs.push(e.message.slice(0, 300)); }
        journal.duree_s = Math.round((Date.now() - t0) / 100) / 10;
        if (journal.nouveaux || journal.erreurs.length || origine !== 'auto') {
            const hist = (await store.lireReglage('boite_journal', [])) || [];
            await store.ecrireReglage('boite_journal', [journal, ...hist].slice(0, 20)).catch(() => {});
        }
        if (journal.erreurs.length) console.error('Boîte mail :', journal.erreurs[0]);
        else if (journal.nouveaux) console.log(`📧 Boîte (${origine}) : ${journal.nouveaux} nouveau(x), ${journal.utiles} utile(s), ${journal.lies} relié(s) au CRM`);
        return journal;
    })().finally(() => { enCours = null; });
    return enCours;
}

// ---------------------------------------------------------------- Consultation (admin)
async function lister() {
    const sansTexte = ({ texte, ...m }) => m;
    return (await lireListe()).map(sansTexte);
}
async function lire(id) {
    const m = (await lireListe()).find(x => x.id === id);
    if (!m) return null;
    const html = m.html ? (await store.lireReglage(`boite_html:${id}`, '')) || '' : '';
    return { message: m, html };
}
async function maj(id, champs) {
    return verrou(async () => {
        const liste = await lireListe();
        const m = liste.find(x => x.id === id);
        if (!m) return null;
        if (typeof champs.lu === 'boolean') m.lu = champs.lu;
        if (champs.reponse) { m.reponses = [...(m.reponses || []), champs.reponse].slice(-20); m.lu = true; }
        if ('ref' in champs) m.ref = champs.ref || null;
        if (champs.categorie === 'utile' || champs.categorie === 'autre') { m.categorie = champs.categorie; m.raison = champs.categorie === 'utile' ? '' : (m.raison || 'Classé à la main'); }
        await store.ecrireReglage('boite', liste);
        return m;
    });
}

// ---------------------------------------------------------------- Réponse
const reObjet = o => { o = String(o || '').trim(); return /^(re|r[ée]p)\s*:/i.test(o) ? o : `Re: ${o || 'Votre message'}`.slice(0, contact.LIMITE_OBJET); };
const prenomDe = nom => { const p = String(nom || '').trim().split(/\s+/); return p.length >= 1 && /^[A-ZÀ-Ý][a-zà-ÿ'-]{1,30}$/.test(p[0]) ? p[0] : ''; };

// Modèles de réponse. Avec une demande liée : ceux de la fiche (contact-client) + les modèles généraux.
// Règles : fourchette indicative, prix définitif après vérification par un technicien à l'adresse du client,
// enlèvement gratuit partout en France, virement instantané si la vente est conclue, réponse rapide sans délai chiffré.
function modeles(m, d = null) {
    const p = d ? String(((d.data || {}).prenom) || '').trim() : prenomDe(m && m.nom);
    const bonjour = p ? `Bonjour ${p},` : 'Bonjour,';
    const sig = contact.signature();
    const generaux = [
        {
            id: 'recu', titre: 'Accusé de réception',
            texte: [bonjour, '', 'Merci pour votre message, nous l\'avons bien reçu. Nous l\'étudions et revenons vers vous rapidement.', '', sig].join('\n')
        },
        {
            id: 'infos_vehicule', titre: 'Informations sur le véhicule',
            texte: [bonjour, '', 'Merci pour votre message. Pour vous donner une fourchette indicative, pourriez-vous nous préciser :',
                '- la marque, le modèle et la version ;', "- l'année et le kilométrage ;", '- l\'état général et les défauts connus ;', '- le code postal où se trouve le véhicule.', '',
                "Quelques photos (les quatre côtés, l'intérieur, le compteur allumé) nous aident beaucoup. Il vous suffit de répondre à cet e-mail ; vous pouvez aussi faire votre demande en ligne sur lunicar.fr.", '', sig].join('\n')
        },
        {
            id: 'fonctionnement', titre: 'Comment se passe la vente',
            texte: [bonjour, '', 'Merci pour votre message. Voici comment se passe la vente de votre voiture avec LUNICAR :',
                '- vous nous décrivez le véhicule et nous vous indiquons une fourchette indicative ;', '- un technicien LUNICAR vérifie le véhicule à votre adresse ;',
                '- le prix définitif est fixé après cette vérification ;', "- l'enlèvement est gratuit, partout en France ;", '- si la vente est conclue, le paiement se fait par virement instantané.', '',
                'Pour commencer, il suffit de répondre à cet e-mail avec les informations sur le véhicule, ou de faire votre demande sur lunicar.fr.', '', sig].join('\n')
        }
    ];
    if (d) return [...contact.modeles(d), ...generaux.filter(g => g.id !== 'infos_vehicule')];
    return [...generaux, {
        id: 'fourchette', titre: 'Fourchette indicative',
        texte: [bonjour, '', "Merci pour les informations transmises. D'après ces éléments, nous pouvons vous indiquer une fourchette indicative de [montant bas] à [montant haut] €.", '',
            "Cette fourchette n'est pas une offre ferme : le prix définitif est fixé après vérification du véhicule par un technicien, à votre adresse. L'enlèvement est gratuit, partout en France, et en cas d'accord, le paiement se fait par virement instantané.", '',
            "Dites-nous si vous souhaitez convenir d'un rendez-vous.", '', sig].join('\n')
    }];
}

async function etat() {
    const c = imap(), i = (await store.lireReglage('boite_imap', null)) || null, ce = contact.etat();
    const att = ((await store.lireReglage('boite_notif', {})) || {}).en_attente || [];
    return { boite: c ? c.user : null, dossier: c ? c.box : null, en_cours: !!enCours, derniere_lecture: i && i.lu_le, attente_notif: att.length, envoi: ce.envoi, from: ce.from, reply_to: ce.reply_to, auto: env('BOITE_AUTO') !== '0' };
}

module.exports = { imap, etat, relever, traiter, analyser, assainir, classer, notifier, contenuNotif, nuit, lister, lire, maj, lier, rattraper, modeles, reObjet, versFil, indexDemandes, LIMITE_TEXTE };
