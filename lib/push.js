// Notifications push vers l'app iOS « Lunicar » (admin) : une alerte à chaque demande reçue.
// APNs en HTTP/2 avec un jeton JWT (ES256), sans dépendance.
// Variables Render : APNS_KEY (contenu du fichier AuthKey_XXXX.p8), APNS_KEY_ID,
// APNS_TEAM_ID (3ZPRX5D49W par défaut), APNS_TOPIC (fr.lunicar.admin par défaut).
// Les appareils s'enregistrent depuis l'admin ouvert dans l'app (POST /api/admin/push).
const http2 = require('http2');
const crypto = require('crypto');
const store = require('./store');

const KEY = (process.env.APNS_KEY || '').replace(/\\n/g, '\n').trim();
const KEY_ID = process.env.APNS_KEY_ID || '';
const TEAM_ID = process.env.APNS_TEAM_ID || '3ZPRX5D49W';
const TOPIC = process.env.APNS_TOPIC || 'fr.lunicar.admin';
const HOTES = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' };

const actif = () => !!(KEY && KEY_ID);

// Apple refuse un jeton de plus d'une heure et en limite le renouvellement : on le garde 50 min.
let jwt = null, jwtAt = 0;
function jeton() {
    if (jwt && Date.now() - jwtAt < 50 * 60 * 1000) return jwt;
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const corps = `${b64({ alg: 'ES256', kid: KEY_ID })}.${b64({ iss: TEAM_ID, iat: Math.floor(Date.now() / 1000) })}`;
    const sig = crypto.sign('sha256', Buffer.from(corps), { key: KEY, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    jwt = `${corps}.${sig}`; jwtAt = Date.now();
    return jwt;
}

function envoyer(env, token, payload) {
    return new Promise(resolve => {
        const client = http2.connect(HOTES[env]);
        client.on('error', e => resolve({ status: 0, raison: e.message }));
        const req = client.request({
            ':method': 'POST', ':path': `/3/device/${token}`,
            authorization: `bearer ${jeton()}`, 'apns-topic': TOPIC,
            'apns-push-type': 'alert', 'apns-priority': '10'
        });
        let status = 0, data = '';
        req.on('response', h => { status = h[':status']; });
        req.on('data', c => { data += c; });
        req.on('end', () => { client.close(); let raison = ''; try { raison = JSON.parse(data).reason; } catch (e) {} resolve({ status, raison }); });
        req.on('error', e => { client.close(); resolve({ status: 0, raison: e.message }); });
        req.setTimeout(10000, () => req.close());
        req.end(JSON.stringify(payload));
    });
}

async function appareils() { return (await store.lireReglage('push_appareils', [])) || []; }

async function enregistrer(token, info = {}) {
    if (!/^[0-9a-f]{32,200}$/i.test(String(token || ''))) throw new Error('Jeton invalide');
    const liste = (await appareils()).filter(a => a.token !== token);
    liste.push({ token, nom: String(info.nom || '').slice(0, 60), env: null, le: new Date().toISOString() });
    await store.ecrireReglage('push_appareils', liste.slice(-10));
}

// Envoie à tous les appareils. Une app installée depuis Xcode reçoit par le bac à sable,
// une app TestFlight/App Store par la production : on essaie l'un puis l'autre et on retient.
async function notifier({ titre, texte, ref, onglet, mail, fil }) {
    if (!actif()) return;
    const liste = await appareils();
    if (!liste.length) return;
    // « onglet » : écran à ouvrir au toucher de la notification (ex. « forums ») ; « mail » : e-mail à ouvrir dans l'écran Boîte mail.
    const payload = { aps: { alert: { title: titre, body: texte }, sound: 'default', 'thread-id': fil || onglet || 'demandes' }, ref, ...(onglet ? { onglet } : {}), ...(mail ? { mail } : {}) };
    let change = false;
    const gardes = [];
    for (const a of liste) {
        const essais = a.env ? [a.env] : ['production', 'sandbox'];
        let ok = false, mort = false;
        for (const env of essais) {
            const r = await envoyer(env, a.token, payload);
            if (r.status === 200) { if (a.env !== env) { a.env = env; change = true; } ok = true; break; }
            if (r.status === 410 || r.raison === 'Unregistered') { mort = true; break; }
            if (r.raison !== 'BadDeviceToken') { console.error(`Push ${env} : ${r.status} ${r.raison}`); break; }
        }
        if (!ok && !mort && a.env && essais.length === 1) { a.env = null; change = true; }
        if (mort) change = true; else gardes.push(a);
    }
    if (change) await store.ecrireReglage('push_appareils', gardes);
}

module.exports = { actif, enregistrer, notifier, appareils };
