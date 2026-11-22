#!/usr/bin/env node
// Connexion Google Business Profile : ouvre la page d'autorisation Google (compte propriétaire de la fiche),
// récupère le jeton et l'écrit dans secrets/google/token-gbp.json.
// Affiche ensuite les 3 variables à copier sur Render (GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN).
//
//   node tools/gbp/auth.js            → autorisation puis test de l'accès
//   node tools/gbp/auth.js --test     → test seul avec le jeton existant
//
// Client OAuth : projet Cloud partagé seo-tracker-487515 (application « de bureau »).
// ⚠️ Si l'écran de consentement du projet est en mode « Test », Google révoque le jeton au bout de 7 jours :
// le passer « En production » (Google Cloud › API et services › Écran de consentement OAuth).
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');

const RACINE = path.join(__dirname, '..', '..');
const JETON = path.join(RACINE, 'secrets', 'google', 'token-gbp.json');
const CLIENTS = [path.join(RACINE, 'secrets', 'google', 'client_secret.json'),
    path.join(process.env.HOME, 'iCloud/Projects/work/boubou-queens/seo/credentials/client_secret.json')];

function client() {
    for (const f of CLIENTS) if (fs.existsSync(f)) { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return d.installed || d.web; }
    throw new Error('client_secret.json introuvable (secrets/google/ ou boubou-queens/seo/credentials/).');
}

async function autoriser() {
    const c = client();
    const serveur = http.createServer();
    await new Promise(r => serveur.listen(0, '127.0.0.1', r));
    const redirect = `http://127.0.0.1:${serveur.address().port}`;
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: c.client_id, redirect_uri: redirect, response_type: 'code', access_type: 'offline', prompt: 'consent',
        scope: 'https://www.googleapis.com/auth/business.manage'
    });
    console.log('Autorisation Google : connectez-vous avec le compte de la fiche LUNICAR.\n' + url + '\n');
    execFile('open', [url]);
    const code = await new Promise((ok, ko) => serveur.on('request', (req, res) => {
        const q = new URL(req.url, redirect).searchParams;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(q.get('code') ? '<p style="font:18px system-ui">Connexion LUNICAR ↔ Google Business faite. Vous pouvez fermer cet onglet.</p>' : '<p>Autorisation refusée.</p>');
        serveur.close();
        q.get('code') ? ok(q.get('code')) : ko(new Error(q.get('error') || 'pas de code'));
    }));
    const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: redirect, grant_type: 'authorization_code' })
    });
    const j = await r.json();
    if (!j.refresh_token) throw new Error('Pas de refresh_token : ' + JSON.stringify(j));
    fs.mkdirSync(path.dirname(JETON), { recursive: true });
    fs.writeFileSync(JETON, JSON.stringify({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: j.refresh_token, scopes: [j.scope], cree: new Date().toISOString() }, null, 2), { mode: 0o600 });
    console.log(`Jeton enregistré dans ${path.relative(RACINE, JETON)}.\n\nÀ copier sur Render (service lunicar › Environment) :\n  GBP_CLIENT_ID=${c.client_id}\n  GBP_CLIENT_SECRET=${c.client_secret}\n  GBP_REFRESH_TOKEN=${j.refresh_token}\n`);
}

async function tester() {
    // Pas de Supabase en local : le module garde la fiche trouvée dans un réglage, on lui donne un stockage en mémoire.
    const store = require('../../lib/store');
    const memo = {}; store.lireReglage = async (k, d) => k in memo ? memo[k] : d; store.ecrireReglage = async (k, v) => { memo[k] = v; };
    const gbp = require('../../lib/gbp');
    const e = await gbp.etat();
    console.log('Accès API :', e.acces, e.fiche ? `(fiche « ${e.fiche} »)` : e.message || '');
    if (e.acces === 'en_attente') console.log(`→ Demande d'accès possible à partir du ${e.demande_acces_des} : ${e.formulaire}`);
    if (e.acces === 'ok') { const a = await gbp.avis(); console.log(`Avis : ${a.total}, moyenne ${a.moyenne}, ${a.sans_reponse} sans réponse.`); }
}

(async () => {
    if (!process.argv.includes('--test')) await autoriser();
    await tester();
})().catch(e => { console.error(e.message); process.exit(1); });
