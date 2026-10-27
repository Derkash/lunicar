// SMS aux clients via l'API OVH (compte SMS OVH, signature SHA-1 par requête).
// Variables : OVH_AK (application key), OVH_AS (application secret), OVH_CK (consumer key),
// OVH_SMS_COMPTE (sms-xxxxx-1 ; retrouvé tout seul s'il n'y en a qu'un), OVH_SMS_SENDER (défaut LUNICAR).
// L'expéditeur alphanumérique « LUNICAR » doit être validé par OVH ; tant qu'il ne l'est pas, le SMS part
// d'un numéro court (le client peut répondre), avec la signature LUNICAR dans le texte.
const crypto = require('crypto');

const RACINE = 'https://eu.api.ovh.com/1.0';
const SENDER = (process.env.OVH_SMS_SENDER || 'LUNICAR').slice(0, 11);
const cles = () => ({ ak: process.env.OVH_AK, as: process.env.OVH_AS, ck: process.env.OVH_CK });
const actif = () => { const c = cles(); return !!(c.ak && c.as && c.ck); };

async function requete(methode, chemin, corps) {
    const { ak, as, ck } = cles();
    const url = RACINE + chemin, body = corps ? JSON.stringify(corps) : '';
    const t = Math.round(Date.now() / 1000);
    const sig = '$1$' + crypto.createHash('sha1').update([as, ck, methode, url, body, t].join('+')).digest('hex');
    const res = await fetch(url, {
        method: methode, body: body || undefined, signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', 'X-Ovh-Application': ak, 'X-Ovh-Consumer': ck, 'X-Ovh-Timestamp': String(t), 'X-Ovh-Signature': sig }
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(json.message || `OVH ${methode} ${chemin} : HTTP ${res.status}`); e.status = res.status === 403 || res.status === 401 ? 503 : 502; throw e; }
    return json;
}

let compteCache = null;
async function compte() {
    if (process.env.OVH_SMS_COMPTE) return process.env.OVH_SMS_COMPTE;
    if (compteCache) return compteCache;
    const l = await requete('GET', '/sms');
    if (!l.length) throw new Error('Aucun compte SMS sur ce compte OVH');
    compteCache = l[0];
    return compteCache;
}

// Expéditeur « LUNICAR » validé par la modération OVH ? (mémorisé 10 min)
let senderCache = { t: 0, ok: false };
async function senderValide() {
    if (Date.now() - senderCache.t < 10 * 60e3) return senderCache.ok;
    let ok = false;
    try { ok = (await requete('GET', `/sms/${await compte()}/senders/${encodeURIComponent(SENDER)}`)).status === 'enable'; } catch (e) { ok = false; }
    senderCache = { t: Date.now(), ok };
    return ok;
}

// Numéro français → format international E.164 (+33…).
function international(tel) {
    let t = String(tel || '').replace(/[^\d+]/g, '');
    if (t.startsWith('+')) return t;
    if (t.startsWith('00')) return '+' + t.slice(2);
    if (/^0[1-9]\d{8}$/.test(t)) return '+33' + t.slice(1);
    if (/^33[1-9]\d{8}$/.test(t)) return '+' + t;
    return '';
}
// Nombre de segments facturés (GSM 7 bits : 160, puis 153 par segment ; caractères hors GSM → UCS-2 : 70 / 67).
const GSM = /^[A-Za-z0-9@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà\n\r^{}\\[~\]|€]*$/;
function segments(texte) {
    const gsm = GSM.test(texte), n = texte.length + (gsm ? (texte.match(/[\^{}\\[~\]|€]/g) || []).length : 0);
    const un = gsm ? 160 : 70, suite = gsm ? 153 : 67;
    return { nombre: n <= un ? 1 : Math.ceil(n / suite), unicode: !gsm, caracteres: n };
}

async function envoyer(tel, texte) {
    if (!actif()) { const e = new Error('SMS non configuré sur le serveur (OVH_AK / OVH_AS / OVH_CK)'); e.status = 503; throw e; }
    const a = international(tel);
    if (!a) { const e = new Error('Numéro de téléphone invalide'); e.status = 400; throw e; }
    texte = String(texte || '').replace(/\r\n/g, '\n').trim();
    if (!texte) { const e = new Error('Message vide'); e.status = 400; throw e; }
    if (texte.length > 1000) { const e = new Error('Message trop long (1 000 caractères maximum)'); e.status = 400; throw e; }
    const c = await compte(), alpha = await senderValide();
    const r = await requete('POST', `/sms/${c}/jobs`, {
        message: texte, receivers: [a], charset: 'UTF-8', coding: segments(texte).unicode ? '8bit' : '7bit',
        ...(alpha ? { sender: SENDER } : { senderForResponse: true }),
        noStopClause: true, priority: 'high'     // message de service à un client qui nous a sollicités : pas de mention STOP
    });
    if (Array.isArray(r.invalidReceivers) && r.invalidReceivers.length) { const e = new Error('Numéro refusé par OVH : ' + r.invalidReceivers.join(', ')); e.status = 400; throw e; }
    return { id: crypto.randomUUID(), date: new Date().toISOString(), sens: 'envoye', a, texte, expediteur: alpha ? SENDER : 'numéro court', credits: r.totalCreditsRemoved || segments(texte).nombre, job: (r.ids || [])[0] || null };
}

async function etat() {
    if (!actif()) return { actif: false };
    try {
        const c = await compte(), info = await requete('GET', `/sms/${c}`);
        return { actif: true, compte: c, credits: info.creditsLeft, sender: SENDER, sender_valide: await senderValide() };
    } catch (e) { return { actif: true, erreur: e.message, sender: SENDER }; }
}

module.exports = { actif, envoyer, etat, segments, international, SENDER };
