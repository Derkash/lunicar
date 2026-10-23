// Robot de veille « Forums » : trouve les discussions récentes où un particulier demande comment
// ou à qui vendre sa voiture (Reddit + forums auto / conso français) et PROPOSE une réponse que le
// dirigeant poste lui-même, à la main, depuis son propre compte.
// Le robot ne poste jamais, ne crée aucun compte, ne contacte personne : il lit des pages publiques.
//
// 1. Reddit : recherche publique (JSON, puis flux RSS si le JSON est bloqué), quelques requêtes espacées.
// 2. Forums : API OpenAI Responses + outil web_search (OPENAI_API_KEY, modèle VEILLE_MODEL), une requête
//    à la fois, plafonnée par passage. Chaque URL est vérifiée par un GET (sauf Reddit).
// 3. Qualification + brouillon de réponse : Claude (ANTHROPIC_API_KEY, même modèle que l'estimation).
// Stockage : réglages clé/valeur (store.lireReglage) « veille » (suggestions), « veille_vues » (URL déjà vues),
// « veille_journal » (passages et erreurs).
const Anthropic = require('@anthropic-ai/sdk');
const store = require('./store');

const UA = 'lunicar-veille/1.0 (contact@lunicar.fr)';
const UA_WEB = 'Mozilla/5.0 (compatible; lunicar-veille/1.0; +https://lunicar.fr)';
const MODELE_OPENAI = process.env.VEILLE_MODEL || 'gpt-5.4';
const MODELE_CLAUDE = process.env.VEILLE_CLAUDE_MODEL || process.env.ESTIMATION_MODEL || 'claude-sonnet-5-5';
const ent = (v, d) => { const x = parseInt(v, 10); return Number.isFinite(x) && x >= 0 ? x : d; };
// Plafonds stricts par passage (coûts et limites de débit).
const MAX_OPENAI = () => Math.min(ent(process.env.VEILLE_OPENAI_MAX, 8), 8);
const MAX_REDDIT = () => Math.min(ent(process.env.VEILLE_REDDIT_MAX, 12), 20);
const MAX_IA = () => Math.min(ent(process.env.VEILLE_IA_MAX, 15), 30);
const PAUSE_OPENAI = () => ent(process.env.VEILLE_PAUSE_OPENAI_MS, 20000);
const PAUSE_REDDIT = () => ent(process.env.VEILLE_PAUSE_REDDIT_MS, 7000);
const JOURS = 30;

const openaiActif = () => !!process.env.OPENAI_API_KEY;
const claudeActif = () => !!process.env.ANTHROPIC_API_KEY;
let claude = null;
const client = () => (claude = claude || new Anthropic({ timeout: 3 * 60 * 1000, maxRetries: 2 }));

const attendre = ms => new Promise(r => setTimeout(r, ms));
const nettoyer = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (m, c) => String.fromCharCode(c)).replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- URL
function cleUrl(u) {
    try {
        const x = new URL(u);
        const m = x.pathname.match(/\/comments\/([a-z0-9]+)/i);
        if (/(^|\.)reddit\.com$/.test(x.hostname) && m) return `reddit:${m[1].toLowerCase()}`;
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(k => x.searchParams.delete(k));
        x.hash = '';
        return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + (x.search || '')).toLowerCase();
    } catch (e) { return ''; }
}
const domaine = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
const estReddit = u => /(^|\.)reddit\.com$/.test(domaine(u)) || domaine(u) === 'redd.it';

// ---------------------------------------------------------------- Règles par communauté
// Issues de la vérification des chartes (lunicar-audit/geo-sources/2026-10-22-REPONSES-ET-VIDEOS.md).
// mention : 'transparence' = LUNICAR citable avec la phrase de transparence, sans lien ;
//           'non' = réponse neutre sans LUNICAR ; 'jamais' = idem, et réécrire avec ses propres mots.
function regles(url, sub) {
    const d = domaine(url), s = String(sub || '').toLowerCase();
    if (s === 'conseiljuridique') return { source: 'r/conseiljuridique', mention: 'jamais', texte: 'Règles : pas de pub et contenu généré par IA interdit. Ne jamais citer LUNICAR ; réécrire la réponse avec vos propres mots.' };
    if (s === 'voiture') return { source: 'r/voiture', mention: 'non', texte: 'Règle « Pas d\'auto-promotion » : réponse sans LUNICAR. Mention possible seulement après accord écrit de la modération (modmail).' };
    if (s) return { source: `r/${sub}`, mention: 'non', texte: 'Règles du subreddit non vérifiées : réponse sans LUNICAR par prudence. Lire la barre latérale avant de poster.' };
    if (/commentcamarche|ccm\.net/.test(d)) return { source: 'Comment ça marche', mention: 'non', texte: 'Charte : pas de message publicitaire ou à but commercial. Réponse sans LUNICAR.' };
    if (/caradisiac/.test(d)) return { source: 'Caradisiac', mention: 'transparence', texte: 'Pas de charte anti-mention trouvée : LUNICAR citable avec la phrase de transparence, sans lien (lien seulement si on le demande).' };
    if (/largus/.test(d)) return { source: "L'argus", mention: 'transparence', texte: 'Pas de charte anti-mention trouvée : LUNICAR citable avec la phrase de transparence, sans lien.' };
    if (/matmut/.test(d)) return { source: 'Matmut', mention: 'transparence', texte: 'Pas de charte anti-mention trouvée : LUNICAR citable avec la phrase de transparence, sans lien.' };
    if (/uberzone/.test(d)) return { source: 'Uberzone', mention: 'transparence', texte: 'Pas de charte anti-mention trouvée : LUNICAR citable avec la phrase de transparence, sans lien.' };
    if (/forum-auto\.com/.test(d)) return { source: 'Forum-Auto', mention: 'non', texte: 'Charte non vérifiée : réponse sans LUNICAR par prudence. Lire la charte avant de poster.' };
    if (/doctissimo/.test(d)) return { source: 'Doctissimo', mention: 'non', texte: 'Charte non vérifiée : réponse sans LUNICAR par prudence. Lire la charte avant de poster.' };
    return { source: d || 'Forum', mention: 'non', texte: 'Charte non vérifiée : réponse sans LUNICAR par prudence. Lire la charte avant de poster.' };
}

// ---------------------------------------------------------------- Reddit
const SUBS = [
    { sub: 'voiture', q: 'vendre OR revendre OR rachat OR reprise OR "contrôle technique" OR "crit\'air"' },
    { sub: 'voiture', q: '"vieille voiture" OR succession OR décédé OR "sans CT" OR "fort kilométrage"' },
    { sub: 'france', q: '"vendre ma voiture" OR "vendre voiture" OR "vendre sa voiture" OR "rachat voiture" OR "reprise voiture"' },
    { sub: 'AskFrance', q: '"vendre ma voiture" OR "vendre voiture" OR "vendre sa voiture" OR "vieille voiture" OR "reprise voiture"' },
    { sub: 'vosfinances', q: '"vendre ma voiture" OR "vendre voiture" OR "vendre sa voiture" OR "reprise voiture" OR "rachat voiture"' },
    { sub: 'conseiljuridique', q: '"vendre voiture" OR "vente voiture" OR "vendre la voiture" OR "voiture décédé" OR "cession véhicule"' },
    { sub: 'paris', q: '"vendre ma voiture" OR "vendre voiture" OR "crit\'air" OR "reprise voiture"' },
    { sub: 'Lyon', q: '"vendre ma voiture" OR "vendre voiture" OR "crit\'air" OR "reprise voiture"' },
    { sub: 'Marseille', q: '"vendre ma voiture" OR "vendre voiture" OR "reprise voiture"' },
    { sub: 'toulouse', q: '"vendre ma voiture" OR "vendre voiture" OR "reprise voiture"' },
    { sub: 'bordeaux', q: '"vendre ma voiture" OR "vendre voiture" OR "reprise voiture"' },
    { sub: 'lille', q: '"vendre ma voiture" OR "vendre voiture" OR "reprise voiture"' }
];
// Sujet qui parle bien de VENDRE une voiture (filtre local avant toute dépense d'IA) : un titre explicite,
// ou un texte où l'auteur parle de vendre / faire reprendre sa propre voiture.
const VENTE_TITRE = /\b(vendre|revendre|vends|vente|rachat|racheteur|reprise|cession|céder|débarrasser|casse|que faire (de|avec))\b/i;
const VENTE_TEXTE = /\b(vendre|revendre|faire reprendre|me débarrasser|céder|mettre à la casse)\b.{0,40}\b(ma|sa|notre|mon|la|cette|une) (voiture|auto|bagnole|caisse|véhicule|vieille|\w+ de \d{4})|\b(reprise|rachat) (de )?(ma|sa|notre|mon) /i;
const pertinent = t => VENTE_TITRE.test(t.titre || '') || VENTE_TEXTE.test(t.texte || '');

async function getReddit(url, journal) {
    for (let essai = 0; essai < 2; essai++) {
        const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: url.includes('.rss') ? 'application/atom+xml' : 'application/json' }, signal: AbortSignal.timeout(20000) });
        if (r.status === 429 && essai === 0) {
            const reset = Math.min(90, ent(r.headers.get('x-ratelimit-reset'), 30) + 2);
            await attendre(reset * 1000);
            continue;
        }
        return r;
    }
    return { ok: false, status: 429 };
}

function lireRss(xml, sub) {
    const out = [];
    for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
        const e = m[1];
        const lien = (e.match(/<link href="([^"]+)"/) || [])[1] || '';
        const titre = nettoyer((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
        const date = (e.match(/<published>([^<]+)<\/published>/) || e.match(/<updated>([^<]+)<\/updated>/) || [])[1] || '';
        const html = nettoyer(nettoyer((e.match(/<content type="html">([\s\S]*?)<\/content>/) || [])[1]));
        const texte = html.replace(/submitted by .*$/i, '').replace(/\[link\]\s*\[comments\]/gi, '').trim();
        if (lien) out.push({ url: lien.replace(/&amp;/g, '&'), titre, date, texte: texte.slice(0, 4000), sub });
    }
    return out;
}

async function chercherReddit(journal) {
    const trouves = [];
    let mode = 'json', requetes = 0;
    for (const s of SUBS) {
        if (requetes >= MAX_REDDIT()) break;
        const base = `https://www.reddit.com/r/${s.sub}/search`;
        const qs = `?q=${encodeURIComponent(s.q)}&restrict_sr=1&sort=new&t=month&limit=25`;
        try {
            if (requetes) await attendre(PAUSE_REDDIT());
            requetes++;
            let r = mode === 'json' ? await getReddit(base + '.json' + qs, journal) : null;
            if (r && r.ok) {
                const j = await r.json();
                for (const c of (j.data && j.data.children) || []) {
                    const p = c.data || {};
                    trouves.push({
                        url: `https://www.reddit.com${p.permalink}`, titre: p.title, date: new Date(p.created_utc * 1000).toISOString(),
                        texte: String(p.selftext || '').slice(0, 4000), sub: p.subreddit || s.sub,
                        verrouille: !!(p.locked || p.archived), commentaires: p.num_comments
                    });
                }
                continue;
            }
            if (r && ![403, 401].includes(r.status)) { journal.erreurs.push(`Reddit r/${s.sub} : HTTP ${r.status}`); if (r.status === 429) break; continue; }
            // JSON refusé (fréquent depuis un serveur) : flux RSS public, même recherche.
            if (mode === 'json') { mode = 'rss'; journal.infos.push('Reddit : JSON refusé, passage au flux RSS'); await attendre(PAUSE_REDDIT()); }
            r = await getReddit(base + '.rss' + qs, journal);
            if (!r.ok) { journal.erreurs.push(`Reddit r/${s.sub} (RSS) : HTTP ${r.status}`); if (r.status === 429 || r.status === 403) break; continue; }
            trouves.push(...lireRss(await r.text(), s.sub));
        } catch (e) { journal.erreurs.push(`Reddit r/${s.sub} : ${e.message}`); }
    }
    journal.requetes.reddit = requetes;
    const limite = Date.now() - JOURS * 864e5;
    return trouves.filter(t => (!t.date || new Date(t.date) >= limite) && pertinent(t))
        .map(t => ({ ...t, source_type: 'reddit', verifiee: true }));
}

// ---------------------------------------------------------------- Forums (OpenAI + recherche web)
const RECHERCHES = [
    'forum-auto.caradisiac.com : particuliers qui demandent comment ou à qui vendre leur voiture (vieille voiture, fort kilométrage, sans contrôle technique, panne)',
    'forum-auto.com et forums.commentcamarche.net (rubrique auto) : questions de particuliers sur la vente de leur voiture d\'occasion (où vendre, reprise, rachat, contrôle technique)',
    'forum L\'argus (largus.fr), forum Doctissimo, communauté Matmut : particuliers qui veulent vendre leur voiture (succession, parent décédé, voiture ancienne, Crit\'Air)',
    'Reddit (r/voiture, r/france, r/AskFrance, r/vosfinances) : discussions où un particulier demande où ou comment vendre sa voiture',
    'forums français : vendre la voiture d\'un parent décédé, succession, carte grise au nom du défunt, cession du véhicule',
    'forums français : vendre une voiture Crit\'Air 3, 4 ou 5 à cause des ZFE, vieux diesel, que faire de sa voiture',
    'forums français : vendre une voiture sans contrôle technique ou avec contre-visite, à un particulier ou à un professionnel',
    'forums français : vendre une voiture à plus de 200 000 km, reprise garage trop basse, racheteur de voitures en ligne avis'
];

function consigne(sujet) {
    const auj = new Date().toISOString().slice(0, 10);
    return `Nous sommes le ${auj}. Cherche sur le web des DISCUSSIONS DE FORUM (pas d'articles, pas de pages commerciales) publiées ou actives dans les ${JOURS} derniers jours.
Sujet : ${sujet}.
Fais plusieurs recherches (site par site, plusieurs formulations : « vendre ma voiture », « vendre voiture sans CT », « vendre vieille voiture », « reprise voiture »…). Ne retiens que des fils où un particulier pose une question ou demande conseil. N'invente aucune URL : ne donne que des URL que tu as réellement vues dans les résultats de recherche, avec l'adresse complète du fil.
Réponds uniquement par un bloc \`\`\`json contenant un tableau (vide si rien de récent) :
[{"url": "https://...", "titre": "titre exact du fil", "site": "nom du forum", "date": "AAAA-MM-JJ (premier message ou dernier message)", "resume": "la question posée, en 1 phrase"}]`;
}

let forcerOutil = true;
async function appelOpenAI(sujet, outil) {
    const envoi = () => fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        // tool_choice « required » : le modèle doit réellement chercher, sinon il répond de mémoire (souvent un tableau vide).
        body: JSON.stringify({ model: MODELE_OPENAI, tools: [{ type: outil, user_location: { type: 'approximate', country: 'FR' } }], ...(forcerOutil ? { tool_choice: 'required' } : {}), input: consigne(sujet) }),
        signal: AbortSignal.timeout(4 * 60 * 1000)
    });
    let r = await envoi();
    let corps = await r.json().catch(() => ({}));
    if (r.status === 400 && forcerOutil && /tool_choice/i.test(JSON.stringify(corps))) { forcerOutil = false; r = await envoi(); corps = await r.json().catch(() => ({})); }
    if (!r.ok) { const e = new Error((corps.error && corps.error.message) || `HTTP ${r.status}`); e.status = r.status; throw e; }
    let texte = ''; const cites = new Set();
    for (const item of corps.output || []) {
        if (item.type !== 'message') continue;
        for (const c of item.content || []) {
            if (c.type !== 'output_text') continue;
            texte += c.text;
            for (const an of c.annotations || []) if (an.type === 'url_citation' && an.url) cites.add(cleUrl(an.url));
        }
    }
    let liste = [], lisible = true;
    try {
        const blocs = [...texte.matchAll(/```json\s*([\s\S]*?)```/g)];
        // Les citations insérées par la recherche web (« ([site](url)) ») cassent parfois le JSON : on les retire.
        const brut = (blocs.length ? blocs[blocs.length - 1][1] : texte.slice(texte.indexOf('['), texte.lastIndexOf(']') + 1))
            .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, '');
        liste = JSON.parse(brut);
    } catch (e) { liste = []; lisible = false; }
    // Filet : les pages réellement citées par la recherche (titre + URL), si le JSON est illisible.
    if (!lisible) for (const item of corps.output || []) for (const c of item.content || []) for (const an of c.annotations || []) {
        if (an.type === 'url_citation' && an.url && !liste.some(x => cleUrl(x.url) === cleUrl(an.url))) liste.push({ url: an.url, titre: an.title || '' });
    }
    return { liste: Array.isArray(liste) ? liste : [], cites, lisible, extrait: texte.slice(0, 200) };
}

// Page d'un forum : elle doit répondre. 2xx = vérifiée. Anti-robot (401/403/429/503) : gardée seulement si
// l'URL figure dans les sources réellement citées par la recherche web, avec la mention « lien non vérifié ».
async function verifierPage(url) {
    try {
        const r = await fetch(url, { headers: { 'User-Agent': UA_WEB, Accept: 'text/html', 'Accept-Language': 'fr-FR,fr;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
        if (r.ok) {
            const html = (await r.text()).slice(0, 600000);
            const verrouille = /(sujet (est )?(verrouillé|fermé|clos)|topic (is )?locked|this topic is now closed|discussion (est )?fermée)/i.test(html);
            const corps = nettoyer(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>/gi, ' '));
            return { etat: 'ok', verrouille, texte: corps.slice(0, 5000), url_finale: r.url };
        }
        return { etat: [401, 403, 429, 503].includes(r.status) ? 'protegee' : 'absente', status: r.status };
    } catch (e) { return { etat: 'absente', status: 0, erreur: e.message }; }
}

async function chercherForums(journal) {
    if (!openaiActif()) { journal.infos.push('OPENAI_API_KEY absent : forums sautés (Reddit seul)'); journal.requetes.openai = 0; return []; }
    const trouves = [];
    let outil = 'web_search', n = 0;
    // Rotation : chaque passage commence là où le précédent s'est arrêté.
    const depart = ent(await store.lireReglage('veille_rotation', 0), 0) % RECHERCHES.length;
    for (let i = 0; i < Math.min(MAX_OPENAI(), RECHERCHES.length); i++) {
        const sujet = RECHERCHES[(depart + i) % RECHERCHES.length];
        if (n) await attendre(PAUSE_OPENAI());
        n++;
        try {
            let rep;
            try { rep = await appelOpenAI(sujet, outil); } catch (e) {
                if (e.status === 400 && outil === 'web_search' && /tool|web_search/i.test(e.message)) { outil = 'web_search_preview'; rep = await appelOpenAI(sujet, outil); }
                else if (e.status === 429) { await attendre(60000); rep = await appelOpenAI(sujet, outil); }
                else throw e;
            }
            journal.infos.push(`OpenAI « ${sujet.slice(0, 50)}… » : ${rep.liste.length} discussion(s), ${rep.cites.size} source(s) citée(s)${rep.lisible ? '' : ' (réponse non JSON, sources citées reprises)'}`);
            for (const x of rep.liste) {
                if (!x || !/^https?:\/\//.test(String(x.url || ''))) continue;
                trouves.push({ url: String(x.url).replace(/[?&]utm_source=openai$/, ''), titre: String(x.titre || '').slice(0, 300), date: String(x.date || ''), resume_recherche: String(x.resume || '').slice(0, 400), site: x.site, cite: rep.cites.has(cleUrl(x.url)), source_type: estReddit(x.url) ? 'reddit' : 'forum' });
            }
        } catch (e) {
            journal.erreurs.push(`OpenAI : ${e.message}`.slice(0, 300));
            if (e.status === 401 || e.status === 429) break;
        }
    }
    await store.ecrireReglage('veille_rotation', (depart + n) % RECHERCHES.length);
    journal.requetes.openai = n;
    return trouves;
}

// ---------------------------------------------------------------- Qualification et brouillon (Claude)
const SYSTEM = `Tu aides le dirigeant de LUNICAR (racheteur de voitures toutes marques aux particuliers, partout en France) à répondre lui-même, à la main et depuis son compte personnel, à des discussions publiques où un particulier demande comment ou à qui vendre sa voiture.

Pour la discussion fournie, donne :
1. "score" de pertinence 0 à 100 :
   - cible (score haut) : particulier qui veut vendre SA voiture, surtout voiture ancienne, fort kilométrage, sans contrôle technique ou avec contre-visite, succession / parent décédé, Crit'Air / ZFE, reprise garage jugée trop basse ;
   - hors cible (score bas, moins de 30) : épave, voiture accidentée ou gravement endommagée, vente de pièces, professionnel, acheteur (pas vendeur), simple débat sans demande, sujet sans rapport ;
   - discussion verrouillée, archivée ou fermée : "rejet": true et score 0 ;
   - plus la question est précise, récente et sans bonne réponse déjà donnée, plus le score monte.
2. "resume" : la demande en 1 phrase.
3. "reponse" : une réponse en français naturel, ton d'un humain compétent (tutoiement sur Reddit, vouvoiement sur les forums), 80 à 220 mots, prête à coller :
   - UTILE D'ABORD : les vraies démarches (certificat de cession Cerfa 15776, déclaration de cession ANTS sous 15 jours, certificat de situation administrative / HistoVec, contrôle technique de moins de 6 mois exigé seulement pour vendre à un particulier, pas exigé pour un professionnel, succession…) avec un lien service-public.fr ou ants.gouv.fr si c'est pertinent ; la réponse doit rester bonne si on retire toute mention de LUNICAR ;
   - mention de LUNICAR SEULEMENT si "mention_autorisee" vaut "transparence" : une phrase finale transparente, sans lien, du type « Transparence : je travaille chez LUNICAR, un racheteur de voitures… », puis au plus une ou deux promesses réelles de la liste ci-dessous ; sinon AUCUNE mention de LUNICAR, d'un racheteur en particulier ni d'un lien commercial ;
   - promesses réelles autorisées, et aucune autre : estimation gratuite ; réponse rapide avec une fourchette indicative ; un technicien LUNICAR vient voir la voiture à l'adresse du client ; prix définitif après vérification ; enlèvement gratuit partout en France ; virement instantané si la vente est conclue ; toute voiture est étudiée, sans promesse de rachat.
   - INTERDITS ABSOLUS : se faire passer pour un client ou un particulier, faux témoignage (« j'ai vendu la mienne… »), « nos clients », chiffres inventés (prix, cotes, délais, volumes), « meilleur prix », « 24 h » ou tout délai chiffré, mettre en avant les véhicules accidentés, « depuis Paris », le mot OPTIMERCH, critiquer nommément un concurrent, superlatifs (leader, n°1, expert).
4. "mention_lunicar" : true si la réponse cite LUNICAR.
5. "note" : 1 phrase pour le dirigeant (ce qui a déjà été répondu dans le fil s'il le voit, point à vérifier avant de poster) ; vide sinon.

Réponds par UN SEUL bloc \`\`\`json : {"score": 0, "rejet": false, "resume": "", "reponse": "", "mention_lunicar": false, "note": ""}`;

async function qualifier(c) {
    const r = c.regles;
    const contenu = [
        `Source : ${r.source} (${c.source_type === 'reddit' ? 'Reddit' : 'forum'})`,
        `URL : ${c.url}`, `Titre : ${c.titre || '(inconnu)'}`, c.date && `Date : ${String(c.date).slice(0, 10)}`,
        `mention_autorisee : ${r.mention === 'transparence' ? 'transparence' : 'non'} (${r.texte})`,
        c.verrouille && 'ATTENTION : la page indique que la discussion est verrouillée ou archivée.',
        c.resume_recherche && `Résumé trouvé par la recherche : ${c.resume_recherche}`,
        c.texte ? `Texte de la discussion (extrait) :\n${c.texte}` : 'Texte de la discussion non disponible : appuie-toi sur le titre et le résumé.'
    ].filter(Boolean).join('\n');
    let texte, modele;
    if (claudeActif()) {
        const resp = await client().beta.messages.create({
            model: MODELE_CLAUDE, max_tokens: 4000,
            betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
            thinking: { type: 'adaptive' }, output_config: { effort: process.env.VEILLE_EFFORT || 'medium' },
            system: SYSTEM, messages: [{ role: 'user', content: contenu }]
        });
        texte = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        modele = resp.model || MODELE_CLAUDE;
    } else {
        // Sans ANTHROPIC_API_KEY : rédaction par OpenAI (sans recherche web), même consigne.
        modele = process.env.VEILLE_REDACTION_MODEL || MODELE_OPENAI;
        const r = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
            body: JSON.stringify({ model: modele, instructions: SYSTEM, input: contenu }), signal: AbortSignal.timeout(3 * 60 * 1000)
        });
        const corps = await r.json().catch(() => ({}));
        if (!r.ok) { const e = new Error((corps.error && corps.error.message) || `HTTP ${r.status}`); e.status = r.status; throw e; }
        texte = (corps.output || []).filter(i => i.type === 'message').flatMap(i => i.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('\n');
    }
    const blocs = [...texte.matchAll(/```json\s*([\s\S]*?)```/g)];
    const j = JSON.parse(blocs.length ? blocs[blocs.length - 1][1] : texte.slice(texte.indexOf('{'), texte.lastIndexOf('}') + 1));
    let reponse = String(j.reponse || '').trim();
    // Garde-fous : rien de ce qui est interdit ne doit passer, même si le modèle s'égare.
    const alertes = [];
    if (/optimerch/i.test(reponse)) { reponse = reponse.replace(/optimerch/gi, 'LUNICAR'); alertes.push('mot interdit retiré'); }
    if (/\b24\s?h|24 heures|meilleur prix|depuis paris|nos clients|leader|n°\s?1/i.test(reponse)) alertes.push('formulation interdite détectée : relire');
    if (r.mention !== 'transparence' && /lunicar/i.test(reponse)) alertes.push('LUNICAR cité alors que la communauté ne le permet pas : retirer la mention');
    return {
        score: Math.max(0, Math.min(100, Math.round(Number(j.score) || 0))) * (j.rejet ? 0 : 1),
        rejet: !!j.rejet, resume: String(j.resume || '').slice(0, 400), reponse,
        mention_lunicar: /lunicar/i.test(reponse), note: String(j.note || '').slice(0, 400), alertes, modele
    };
}

// ---------------------------------------------------------------- Passage
let enCours = null;
const redactionActive = () => claudeActif() || openaiActif();
const etat = () => ({ en_cours: !!enCours, openai: openaiActif(), claude: claudeActif(), redaction: claudeActif() ? 'claude' : openaiActif() ? 'openai' : null, modele_openai: MODELE_OPENAI, plafond_openai: MAX_OPENAI() });

async function lireSuggestions() { return (await store.lireReglage('veille', [])) || []; }

async function passage(origine = 'manuel') {
    if (enCours) return enCours;
    enCours = (async () => {
        const t0 = Date.now();
        const journal = { date: new Date().toISOString(), origine, requetes: {}, erreurs: [], infos: [], trouvees: 0, nouvelles: 0, qualifiees: 0 };
        try {
            const vues = (await store.lireReglage('veille_vues', {})) || {};
            const deja = new Set([...Object.keys(vues), ...(await lireSuggestions()).map(s => s.cle)]);
            const reddit = await chercherReddit(journal).catch(e => { journal.erreurs.push(`Reddit : ${e.message}`); return []; });
            const forums = await chercherForums(journal).catch(e => { journal.erreurs.push(`Forums : ${e.message}`); return []; });
            journal.trouvees = reddit.length + forums.length;
            // Dédoublonnage par URL normalisée, et rien de ce qui a déjà été vu ou ignoré.
            const candidats = new Map();
            for (const c of [...reddit, ...forums]) {
                const cle = cleUrl(c.url);
                if (!cle || deja.has(cle) || candidats.has(cle) || domaine(c.url).endsWith('lunicar.fr')) continue;
                candidats.set(cle, { ...c, cle });
            }
            // Alternance forums / Reddit, pour que le plafond de rédaction profite aux deux.
            const f = [...candidats.values()].filter(c => c.source_type === 'forum'), rd = [...candidats.values()].filter(c => c.source_type !== 'forum');
            const ordre = [];
            for (let i = 0; i < Math.max(f.length, rd.length); i++) { if (f[i]) ordre.push(f[i]); if (rd[i]) ordre.push(rd[i]); }
            const nouvelles = [];
            let ia = 0, iaCoupee = false;
            for (const c of ordre) {
                if (c.source_type === 'forum') {
                    const v = await verifierPage(c.url);
                    if (v.etat === 'absente' || (v.etat === 'protegee' && !c.cite)) { vues[c.cle] = journal.date; journal.infos.push(`URL écartée (${v.status || 'injoignable'}) : ${c.url}`.slice(0, 200)); continue; }
                    c.verifiee = v.etat === 'ok';
                    if (v.etat === 'ok') { c.texte = v.texte; c.verrouille = v.verrouille; }
                }
                const sub = c.source_type === 'reddit' ? (c.sub || ((c.url.match(/\/r\/([^/]+)/) || [])[1] || '')) : '';
                c.regles = regles(c.url, sub);
                if (c.verrouille) { vues[c.cle] = journal.date; continue; }
                let q = null;
                if (redactionActive() && !iaCoupee) {
                    // Au-delà du plafond, ou si l'IA est en panne : la discussion n'est pas marquée vue, elle sera reprise au prochain passage.
                    if (ia >= MAX_IA()) continue;
                    ia++;
                    try { q = await qualifier(c); } catch (e) {
                        journal.erreurs.push(`Rédaction (${c.url}) : ${e.message}`.slice(0, 300));
                        if ([401, 403, 429].includes(e.status)) iaCoupee = true;
                        continue;
                    }
                } else if (redactionActive()) continue;
                if (q && (q.rejet || q.score < 25)) { vues[c.cle] = journal.date; continue; }
                nouvelles.push({
                    id: c.cle.replace(/[^a-z0-9]+/g, '-').slice(-60) + '-' + Date.now().toString(36).slice(-4),
                    cle: c.cle, url: c.url, source: c.regles.source, source_type: c.source_type, titre: c.titre || '(sans titre)',
                    date: c.date || '', trouvee_le: journal.date, verifiee: !!c.verifiee,
                    score: q ? q.score : null, resume: q ? q.resume : (c.resume_recherche || String(c.texte || '').slice(0, 200)),
                    reponse: q ? q.reponse : '', reponse_ia: q ? q.reponse : '', mention_lunicar: q ? q.mention_lunicar : false,
                    regles: c.regles.texte, mention: c.regles.mention, note: q ? q.note : '', alertes: q ? q.alertes : [],
                    statut: 'a_traiter'
                });
                vues[c.cle] = journal.date;
            }
            journal.qualifiees = ia;
            journal.nouvelles = nouvelles.length;
            // Relecture juste avant l'écriture : les actions faites dans l'admin pendant le passage sont gardées.
            const actuelles = await lireSuggestions();
            const vus = new Set(actuelles.map(s => s.cle));
            const toutes = [...nouvelles.filter(s => !vus.has(s.cle)), ...actuelles];
            // On garde tout ce qui est à traiter ou posté, et les 150 dernières ignorées.
            let ign = 0;
            await store.ecrireReglage('veille', toutes.filter(s => s.statut !== 'ignoree' || ign++ < 150).slice(0, 400));
            const cles = Object.entries(vues).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, 3000);
            await store.ecrireReglage('veille_vues', Object.fromEntries(cles));
        } catch (e) {
            journal.erreurs.push(e.message);
        }
        journal.duree_s = Math.round((Date.now() - t0) / 1000);
        const hist = ((await store.lireReglage('veille_journal', [])) || []);
        await store.ecrireReglage('veille_journal', [journal, ...hist].slice(0, 20)).catch(() => {});
        journal.erreurs.forEach(e => console.error('Veille :', e));
        console.log(`🔎 Veille forums (${origine}) : ${journal.trouvees} trouvées, ${journal.nouvelles} nouvelles, ${journal.qualifiees} qualifiées, OpenAI ${journal.requetes.openai || 0} req., Reddit ${journal.requetes.reddit || 0} req., ${journal.duree_s} s`);
        return journal;
    })().finally(() => { enCours = null; });
    return enCours;
}

async function majSuggestion(id, champs) {
    const liste = await lireSuggestions();
    const s = liste.find(x => x.id === id);
    if (!s) return null;
    if (['a_traiter', 'postee', 'ignoree'].includes(champs.statut)) {
        s.statut = champs.statut;
        s.statut_le = new Date().toISOString();
    }
    if (typeof champs.reponse === 'string') s.reponse = champs.reponse.slice(0, 8000);
    await store.ecrireReglage('veille', liste);
    return s;
}

module.exports = { passage, etat, lireSuggestions, majSuggestion, cleUrl, regles, lireRss };
