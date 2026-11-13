// Collecteur Sonar Pricing en temps réel pour LUNICAR — tourne en continu sur le Mac mini (~/lunicar-sonar).
// Lance un Chrome dédié (profil à part, connecté au compte Leboncoin Pro), y charge tools/sonar-collecte.js
// depuis lunicar.fr et, chaque minute, passe dans Sonar les demandes qui n'ont pas encore leur prix (les nouvelles
// d'abord) au kilométrage de la demande. Alerte LUNICAR si Leboncoin se déconnecte ou freine.
// Lancé et relancé par launchd (fr.lunicar.sonar.plist). Journal : ~/lunicar-sonar/veille.log
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname, PORT = 9333, PROFIL = path.join(DIR, 'profil-chrome');
const API = 'https://lunicar.fr/api/marche', SONAR = 'https://www.leboncoin.fr/compte/pro/donnees-auto';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CLE = fs.readFileSync(path.join(DIR, 'cle.txt'), 'utf8').trim();
const log = (...a) => console.log(new Date().toISOString(), ...a);
const pause = ms => new Promise(r => setTimeout(r, ms));

async function alerte(type, texte) {
    log('ALERTE', type, texte);
    try { await fetch(API + '/alerte', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cle': CLE }, body: JSON.stringify({ type, texte }) }); } catch (e) { /* réseau */ }
}

// ---------------------------------------------------------------- Chrome dédié (DevTools sur 127.0.0.1 seulement)
async function cibles() { try { return await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch (e) { return null; } }
async function assurerChrome() {
    let t = await cibles();
    if (t) return t;
    log('lancement de Chrome');
    spawn(CHROME, [`--user-data-dir=${PROFIL}`, `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
        // Pas de ralentissement quand la fenêtre est cachée ou l'écran éteint.
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', SONAR],
        { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 40; i++) { await pause(1000); t = await cibles(); if (t) return t; }
    throw new Error('Chrome ne répond pas');
}

// Mini client DevTools : une connexion par tour, Runtime.evaluate / Page.navigate.
function session(wsUrl) {
    return new Promise((ok, ko) => {
        const ws = new WebSocket(wsUrl), attente = new Map();
        let id = 0;
        ws.onopen = () => ok({
            appel: (method, params = {}) => new Promise((r, k) => { const i = ++id; attente.set(i, { r, k }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (attente.has(i)) { attente.delete(i); k(new Error('délai DevTools ' + method)); } }, 60000); }),
            fermer: () => ws.close()
        });
        ws.onmessage = ev => { const m = JSON.parse(ev.data); const a = attente.get(m.id); if (a) { attente.delete(m.id); m.error ? a.k(new Error(m.error.message)) : a.r(m.result); } };
        ws.onerror = () => ko(new Error('connexion DevTools impossible'));
    });
}
async function evaluer(s, expr) {
    const r = await s.appel('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
    return r.result.value;
}

// ---------------------------------------------------------------- Boucle
let pauseJusqua = 0, dernierEtat = '';
async function tour() {
    const t = await assurerChrome();
    let page = t.find(x => x.type === 'page' && /leboncoin\.fr/.test(x.url)) || t.find(x => x.type === 'page');
    if (!page) { await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(SONAR)}`, { method: 'PUT' }); await pause(5000); return; }
    const s = await session(page.webSocketDebuggerUrl);
    try {
        let href = await evaluer(s, 'location.href');
        if (!/leboncoin\.fr\/(compte\/pro\/donnees-auto|recherche)/.test(href)) {
            await s.appel('Page.navigate', { url: SONAR }); await pause(8000);
            href = await evaluer(s, 'location.href');
            if (!/leboncoin\.fr\/compte\/pro\/donnees-auto/.test(href)) return alerte('deconnecte', 'Leboncoin a déconnecté le Mac mini : reconnectez le compte pro dans le Chrome « Sonar » du Mac mini.');
        }
        // Script de collecte présent ? (il disparaît si la page a été rechargée)
        const charge = await evaluer(s, `!!(window.__collecte && window.__collecte.lancer && window.__CLE)`);
        if (!charge) {
            await evaluer(s, `(async () => { window.__CLE = ${JSON.stringify(CLE)}; const r = await fetch(${JSON.stringify(API + '/script')}, { headers: { 'X-Cle': window.__CLE } }); if (!r.ok) throw new Error('script ' + r.status); (0, eval)(await r.text()); return true; })()`);
            log('script de collecte chargé');
        }
        const E = await evaluer(s, 'window.__collecte.etat()');
        const etat = JSON.stringify(E);
        if (etat !== dernierEtat) { log('état', etat); dernierEtat = etat; }
        if (E.en_cours) return;
        if (/Leboncoin freine/.test(E.derniereErreur || '')) {
            pauseJusqua = Date.now() + 3600e3;
            await evaluer(s, `window.__collecte.derniereErreur = ''`);
            return alerte('freinage', 'Leboncoin freine les recherches : collecte en pause 1 h.');
        }
        if (Date.now() < pauseJusqua) return;
        // Un passage Sonar par demande au km exact : les nouvelles d'abord (file triée par le serveur), par lots de 10.
        const r1 = await evaluer(s, `window.__collecte.lancer({ mode: 'principal', limite: 10 })`);
        if (!/lancé : 0 plaque/.test(r1)) log(r1);
    } finally { s.fermer(); }
}

(async () => {
    log('démarrage du collecteur Sonar');
    let echecs = 0;
    for (;;) {
        try { await tour(); echecs = 0; }
        catch (e) { echecs++; log('erreur', e.message); if (echecs === 5) await alerte('panne', `Collecteur Sonar en échec : ${e.message}`); }
        await pause(60000);
    }
})();
