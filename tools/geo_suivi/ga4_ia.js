/**
 * Relevé GA4 des visites venues des assistants IA (ChatGPT, Perplexity, Copilot, Gemini, Claude…).
 *
 *   node tools/geo_suivi/ga4_ia.js            relevé seul (7 derniers jours + 7 précédents, et 28 jours)
 *   appelé aussi en fin de tools/geo_suivi/suivi.js (section ajoutée au relevé ChatGPT)
 *
 * Pour chaque IA : sessions et demandes envoyées (generate_lead), puis les pages d'arrivée.
 * Google naturel est donné en repère. GA ne voit que les visiteurs qui acceptent les cookies.
 *
 * Jeton : secrets/gsc-token.json (jeton OAuth Google partagé, scope analytics.readonly), ou GSC_TOKEN.
 * Propriété : GA4_PROPRIETE (502773704 par défaut). Aucune dépendance.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const RACINE = path.join(__dirname, '..', '..');
const PROPRIETE = process.env.GA4_PROPRIETE || '502773704';
const SORTIE = process.env.GEO_SUIVI_DIR
    || path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/Projects/work/lunicar-audit/geo-suivi');

// Source GA (sessionSource) -> nom de l'assistant.
const IA = [
    ['ChatGPT', /chatgpt|openai/i], ['Perplexity', /perplexity/i], ['Copilot', /copilot|bing\.com\/chat|edgeservices/i],
    ['Gemini', /gemini|bard/i], ['Claude', /claude\.ai|anthropic/i], ['Mistral', /mistral|chat\.mistral/i], ['DeepSeek', /deepseek/i]
];
const nomIA = src => (IA.find(([, re]) => re.test(src)) || [])[0] || null;
const REGEX_IA = 'chatgpt|openai|perplexity|copilot|bing\\.com/chat|edgeservices|gemini|bard|claude|anthropic|mistral|deepseek';

async function jeton() {
    const chemin = process.env.GSC_TOKEN || path.join(RACINE, 'secrets', 'gsc-token.json');
    if (!fs.existsSync(chemin)) throw new Error(`jeton Google absent (${chemin})`);
    const t = JSON.parse(fs.readFileSync(chemin, 'utf-8'));
    const r = await fetch(t.token_uri || 'https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: t.client_id, client_secret: t.client_secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' })
    });
    const j = await r.json();
    if (!j.access_token) throw new Error('jeton Google refusé : ' + (j.error_description || j.error || r.status));
    return j.access_token;
}

async function rapport(tok, corps) {
    const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPRIETE}:runReport`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(corps)
    });
    const j = await r.json();
    if (j.error) throw new Error('GA4 : ' + j.error.message);
    return (j.rows || []).map(x => ({ d: x.dimensionValues.map(v => v.value), m: x.metricValues.map(v => Number(v.value)) }));
}

const metrics = [{ name: 'sessions' }, { name: 'keyEvents:generate_lead' }];
const filtreIA = { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'PARTIAL_REGEXP', value: REGEX_IA, caseSensitive: false } } };

async function releve() {
    const tok = await jeton();
    const periodes = [
        { startDate: '7daysAgo', endDate: 'yesterday', name: 's' },
        { startDate: '14daysAgo', endDate: '8daysAgo', name: 'p' },
        { startDate: '28daysAgo', endDate: 'yesterday', name: 'm' }
    ];
    // 1. Par assistant et période
    const parSource = await rapport(tok, { dateRanges: periodes, dimensions: [{ name: 'sessionSource' }], metrics, dimensionFilter: filtreIA, limit: 200 });
    const ia = {};
    parSource.forEach(({ d: [src, per], m: [s, l] }) => {
        const n = nomIA(src); if (!n) return;
        ia[n] = ia[n] || { s: [0, 0], p: [0, 0], m: [0, 0] };
        ia[n][per][0] += s; ia[n][per][1] += l;
    });
    // 2. Pages d'arrivée des IA sur 28 jours
    const pages = (await rapport(tok, { dateRanges: [periodes[2]], dimensions: [{ name: 'landingPage' }, { name: 'sessionSource' }], metrics, dimensionFilter: filtreIA, limit: 500 }))
        .reduce((acc, { d: [page, src], m: [s, l] }) => {
            const n = nomIA(src); if (!n) return acc;
            const k = page || '(inconnue)'; acc[k] = acc[k] || { page: k, sessions: 0, demandes: 0, ia: new Set() };
            acc[k].sessions += s; acc[k].demandes += l; acc[k].ia.add(n); return acc;
        }, {});
    // 3. Repère : Google naturel
    const google = await rapport(tok, {
        dateRanges: periodes, dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics,
        dimensionFilter: { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { value: 'Organic Search' } } }
    });
    const g = { s: [0, 0], p: [0, 0], m: [0, 0] };
    google.forEach(({ d: [, per], m: [s, l] }) => { g[per] = [s, l]; });
    return {
        date: new Date().toLocaleDateString('sv-SE'), propriete: PROPRIETE,
        assistants: Object.entries(ia).map(([nom, v]) => ({ nom, semaine: v.s, semaine_precedente: v.p, jours_28: v.m })).sort((a, b) => b.jours_28[0] - a.jours_28[0]),
        pages: Object.values(pages).map(p => ({ ...p, ia: [...p.ia] })).sort((a, b) => b.demandes - a.demandes || b.sessions - a.sessions).slice(0, 25),
        google_naturel: { semaine: g.s, semaine_precedente: g.p, jours_28: g.m }
    };
}

function markdown(r) {
    const tot = k => r.assistants.reduce((a, x) => [a[0] + x[k][0], a[1] + x[k][1]], [0, 0]);
    const ts = tot('semaine'), tp = tot('semaine_precedente'), tm = tot('jours_28');
    const ev = (a, b) => b ? `${a - b >= 0 ? '+' : ''}${Math.round((a - b) / b * 100)} %` : (a ? 'nouveau' : '-');
    const ligne = (nom, x) => `| ${nom} | ${x.semaine[0]} | ${x.semaine[1]} | ${ev(x.semaine[0], x.semaine_precedente[0])} | ${x.jours_28[0]} | ${x.jours_28[1]} |`;
    return `## Visites venues des IA (Google Analytics)

Sessions et demandes envoyées (generate_lead) par assistant. 7 derniers jours (hors aujourd'hui), évolution vs les 7 jours d'avant, et 28 jours.
GA ne compte que les visiteurs qui acceptent les cookies : les chiffres réels sont plus élevés (compter les demandes dans l'admin).

| Source | Sessions 7 j | Demandes 7 j | Évol. sessions | Sessions 28 j | Demandes 28 j |
|---|---|---|---|---|---|
${r.assistants.map(x => ligne(x.nom, x)).join('\n') || '| (aucune visite IA) | 0 | 0 | - | 0 | 0 |'}
| **Total IA** | **${ts[0]}** | **${ts[1]}** | ${ev(ts[0], tp[0])} | **${tm[0]}** | **${tm[1]}** |
| Google naturel (repère) | ${r.google_naturel.semaine[0]} | ${r.google_naturel.semaine[1]} | ${ev(r.google_naturel.semaine[0], r.google_naturel.semaine_precedente[0])} | ${r.google_naturel.jours_28[0]} | ${r.google_naturel.jours_28[1]} |

### Pages d'arrivée des visiteurs venus des IA (28 jours)

| Page | Sessions | Demandes | Assistants |
|---|---|---|---|
${r.pages.map(p => `| ${p.page} | ${p.sessions} | ${p.demandes} | ${p.ia.join(', ')} |`).join('\n') || '| - | 0 | 0 | - |'}
`;
}

module.exports = { releve, markdown };

if (require.main === module) {
    releve().then(r => {
        fs.mkdirSync(SORTIE, { recursive: true });
        const base = path.join(SORTIE, `${r.date}-ga4-ia`);
        fs.writeFileSync(base + '.json', JSON.stringify(r, null, 2));
        fs.writeFileSync(base + '.md', `# Visites IA sur lunicar.fr : relevé du ${r.date}\n\n` + markdown(r).replace(/^## .*\n\n/, ''));
        console.log(markdown(r));
        console.log(`Relevé : ${base}.json / .md`);
    }).catch(e => { console.error('Relevé GA4 impossible :', e.message); process.exit(1); });
}
