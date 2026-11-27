/**
 * Mesure de l'apport des liens achetés (netlinking) sur lunicar.fr.
 *
 *   node tools/liens_suivi/suivi_liens.js            relevé : 28 derniers jours comparés à la période de référence
 *
 * Plan des liens, pages test / témoin et requêtes suivies : tools/liens_suivi/liens.json
 * (mettre statut « publie » + date_publication quand un article est en ligne).
 *
 * Lecture :
 *   - Search Console : clics, affichages, position moyenne des pages qui reçoivent des liens (test)
 *     et de pages comparables sans lien (témoin), + position des requêtes suivies.
 *     Si les pages test montent et pas les témoins, c'est l'effet des liens.
 *   - GA4 : visites et demandes (generate_lead) arrivées directement depuis les sites des articles.
 *   - Demandes et voitures achetées par origine : tableau de bord de l'admin (« Lien depuis … », « Google naturel »).
 *
 * Jeton : secrets/gsc-token.json (jeton OAuth Google partagé) ou GSC_TOKEN. Aucune dépendance.
 * Sortie : lunicar-audit/liens-suivi/AAAA-MM-JJ.md (+ .json), dossier modifiable avec LIENS_SUIVI_DIR.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const RACINE = path.join(__dirname, '..', '..');
const SITE = 'sc-domain:lunicar.fr';
const PROPRIETE = process.env.GA4_PROPRIETE || '502773704';
const SORTIE = process.env.LIENS_SUIVI_DIR
    || path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/Projects/work/lunicar-audit/liens-suivi');
const PLAN = JSON.parse(fs.readFileSync(path.join(__dirname, 'liens.json'), 'utf-8'));

const jour = d => d.toISOString().slice(0, 10);
const ilYa = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return jour(d); };

async function jeton() {
    const chemin = process.env.GSC_TOKEN || path.join(RACINE, 'secrets', 'gsc-token.json');
    const t = JSON.parse(fs.readFileSync(chemin, 'utf-8'));
    const r = await fetch(t.token_uri || 'https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: t.client_id, client_secret: t.client_secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' })
    });
    const j = await r.json();
    if (!j.access_token) throw new Error('jeton Google refusé : ' + (j.error_description || j.error || r.status));
    return j.access_token;
}

async function gsc(tok, corps) {
    const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(corps)
    });
    const j = await r.json();
    if (j.error) throw new Error('Search Console : ' + j.error.message);
    return j.rows || [];
}

// Clics, affichages, position moyenne (pondérée par les affichages) pour une liste de chemins.
async function pages(tok, debut, fin) {
    const rows = await gsc(tok, { startDate: debut, endDate: fin, dimensions: ['page'], rowLimit: 25000 });
    const par = {};
    for (const r of rows) {
        // Adresses avec / sans www, avec / sans barre finale : additionnées sur le même chemin.
        const p = new URL(r.keys[0]).pathname.replace(/\/$/, '') || '/';
        const x = par[p] || (par[p] = { clics: 0, affichages: 0, somme: 0 });
        x.clics += r.clicks; x.affichages += r.impressions; x.somme += r.position * r.impressions;
    }
    for (const x of Object.values(par)) { x.position = x.affichages ? x.somme / x.affichages : null; delete x.somme; }
    return par;
}
async function requetes(tok, debut, fin) {
    const rows = await gsc(tok, { startDate: debut, endDate: fin, dimensions: ['query'], rowLimit: 25000 });
    return Object.fromEntries(rows.map(r => [r.keys[0], { clics: r.clicks, affichages: r.impressions, position: r.position }]));
}
function groupe(par, liste) {
    let c = 0, a = 0, pa = 0;
    for (const p of liste) { const x = par[p]; if (!x) continue; c += x.clics; a += x.affichages; pa += x.position * x.affichages; }
    return { clics: c, affichages: a, position: a ? pa / a : null };
}

async function ga4Referents(tok, debut, fin, domaines) {
    if (!domaines.length) return [];
    const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPRIETE}:runReport`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            dateRanges: [{ startDate: debut, endDate: fin }], dimensions: [{ name: 'sessionSource' }],
            metrics: [{ name: 'sessions' }, { name: 'keyEvents:generate_lead' }],
            dimensionFilter: { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'PARTIAL_REGEXP', value: domaines.map(d => d.replace(/\./g, '\\.')).join('|') } } }
        })
    });
    const j = await r.json();
    if (j.error) throw new Error('GA4 : ' + j.error.message);
    return (j.rows || []).map(x => ({ source: x.dimensionValues[0].value, visites: Number(x.metricValues[0].value), demandes: Number(x.metricValues[1].value) }));
}

const f1 = v => v == null ? '–' : v.toFixed(1);
const ecart = (a, b, inverse) => {
    if (a == null || b == null) return '';
    const d = inverse ? b - a : a - b;
    return d === 0 ? '=' : (d > 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(inverse ? 1 : 0);
};

(async () => {
    const tok = await jeton();
    const ref = PLAN.reference;
    const fin = ilYa(3), debut = ilYa(30); // la Search Console a ~3 jours de retard
    const [pRef, pAct, qRef, qAct] = await Promise.all([pages(tok, ref.debut, ref.fin), pages(tok, debut, fin), requetes(tok, ref.debut, ref.fin), requetes(tok, debut, fin)]);
    const publies = PLAN.liens.filter(l => l.statut === 'publie');
    const domaines = [...new Set(publies.map(l => l.site))];
    let refs = [];
    try { refs = await ga4Referents(tok, debut, ilYa(1), domaines); } catch (e) { refs = [{ source: 'erreur GA4 : ' + e.message, visites: 0, demandes: 0 }]; }

    const L = [];
    L.push(`# Suivi des liens achetés — ${jour(new Date())}`, '');
    L.push(`Période mesurée : ${debut} → ${fin} (28 jours), comparée à la référence ${ref.debut} → ${ref.fin} (avant le premier lien).`, '');
    L.push(`Liens publiés : **${publies.length} / ${PLAN.liens.length}** (${publies.reduce((s, l) => s + l.prix, 0)} € engagés sur ${PLAN.liens.reduce((s, l) => s + l.prix, 0)} € prévus).`, '');

    L.push('## 1. Pages avec liens (test) vs pages sans lien (témoin)', '');
    L.push('| Groupe | Clics réf. → maintenant | Affichages réf. → maintenant | Position réf. → maintenant |', '|---|---|---|---|');
    for (const [nom, liste] of [['Test (avec liens)', PLAN.pages_test], ['Témoin (sans lien)', PLAN.pages_temoin]]) {
        const a = groupe(pRef, liste), b = groupe(pAct, liste);
        L.push(`| ${nom} | ${a.clics} → ${b.clics} (${ecart(b.clics, a.clics)}) | ${a.affichages} → ${b.affichages} | ${f1(a.position)} → ${f1(b.position)} (${ecart(b.position, a.position, true)}) |`);
    }
    L.push('', 'Lecture : ▲ sur la position = la page est remontée. L\'effet des liens, c\'est l\'écart entre le groupe test et le groupe témoin.', '');
    L.push('| Page | Groupe | Clics | Position réf. → maintenant |', '|---|---|---|---|');
    for (const [g, liste] of [['test', PLAN.pages_test], ['témoin', PLAN.pages_temoin]]) {
        for (const p of liste) {
            const a = pRef[p] || {}, b = pAct[p] || {};
            L.push(`| ${p} | ${g} | ${a.clics || 0} → ${b.clics || 0} | ${f1(a.position)} → ${f1(b.position)} (${ecart(b.position, a.position, true)}) |`);
        }
    }

    L.push('', '## 2. Requêtes suivies', '', '| Requête | Position réf. → maintenant | Clics |', '|---|---|---|');
    for (const q of PLAN.requetes) {
        const a = qRef[q] || {}, b = qAct[q] || {};
        L.push(`| ${q} | ${f1(a.position)} → ${f1(b.position)} (${ecart(b.position, a.position, true)}) | ${a.clics || 0} → ${b.clics || 0} |`);
    }

    L.push('', '## 3. Visites et demandes venues directement des articles (GA4)', '');
    if (!publies.length) L.push('Aucun article publié pour l\'instant.');
    else if (!refs.length) L.push('Aucune visite enregistrée depuis les sites des articles (GA4 ne voit que ~40 % des visiteurs : compléter avec l\'admin, origine « Lien depuis … »).');
    else { L.push('| Source | Visites | Demandes |', '|---|---|---|'); refs.forEach(r => L.push(`| ${r.source} | ${r.visites} | ${r.demandes} |`)); }

    L.push('', '## 4. Liens', '', '| Semaine | Site | Page cible | Ancre | Prix | Statut | Publié le |', '|---|---|---|---|---|---|---|');
    PLAN.liens.forEach(l => L.push(`| ${l.semaine} | ${l.site} | ${l.page_cible} | ${l.ancre} | ${l.prix} € | ${l.statut} | ${l.date_publication || ''} |`));

    L.push('', '## 5. À compléter dans l\'admin', '', '- Tableau de bord : demandes du mois par origine (« Google naturel », « Lien depuis … », ChatGPT) et voitures achetées issues de ces demandes.',
        '- Règle de décision à 3 mois : pages test +10 places de plus que les témoins, ou demandes « Google naturel » en hausse nette → 2e vague. Sinon arrêt.');

    fs.mkdirSync(SORTIE, { recursive: true });
    const date = jour(new Date());
    fs.writeFileSync(path.join(SORTIE, `${date}.md`), L.join('\n') + '\n');
    fs.writeFileSync(path.join(SORTIE, `${date}.json`), JSON.stringify({ date, periode: { debut, fin }, reference: ref, pages: { ref: pRef, act: pAct }, requetes: { ref: qRef, act: qAct }, referents: refs, liens: PLAN.liens }, null, 1));
    console.log(L.join('\n'));
    console.log(`\n→ ${path.join(SORTIE, date + '.md')}`);
})().catch(e => { console.error('Suivi des liens :', e.message); process.exit(1); });
