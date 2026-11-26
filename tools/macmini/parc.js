// Suivi de vente du parc sur le Mac mini (24/11/2026), appelé par veille.js quand Sonar et les demandes n'ont plus rien à faire.
// Le serveur dit quoi faire (GET /api/marche/parc/taches) :
//   1. relever nos annonces dans le compte Leboncoin Pro (window.__collecte.nosAnnonces, tools/sonar-collecte.js) ;
//   2. envoyer les dossiers du diagnostic mécanique (copie locale ~/lunicar-sonar/diagnostic, poussée par le dépôt diagnostic) ;
//   3. pour chaque véhicule prêt : dossier complet -> Claude -> stratégie de vente ;
//   4. une fois tout le parc fait : plan du jour (priorités, forfait, leçons des ventes passées).
// Claude ne touche jamais à Leboncoin : il recommande, le dirigeant décide.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = __dirname, DIAG = path.join(DIR, 'diagnostic');
const MODELE = process.env.PARC_MODEL || 'claude-opus-5-5';
let client = null, cleUtilisee = '';
function claude() {
    let cle = process.env.ANTHROPIC_API_KEY || '';
    try { cle = cle || fs.readFileSync(path.join(DIR, 'anthropic.txt'), 'utf8').trim(); } catch (e) { /* pas de clé */ }
    if (!cle) return false;
    if (client && cle === cleUtilisee) return client;
    try { const Anthropic = require('@anthropic-ai/sdk'); client = new Anthropic({ apiKey: cle, timeout: 8 * 60 * 1000, maxRetries: 2 }); cleUtilisee = cle; } catch (e) { return false; }
    return client;
}
async function demander({ systeme, contenu, schema, recherche = 0 }) {
    const c = claude();
    if (!c) throw new Error('clé Claude absente sur le Mac mini (anthropic.txt)');
    const messages = [{ role: 'user', content: contenu }];
    const tools = recherche ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: recherche, user_location: { type: 'approximate', country: 'FR', timezone: 'Europe/Paris' } }] : undefined;
    const sources = [];
    for (let tour = 0; tour < 5; tour++) {
        const r = await c.beta.messages.create({
            model: MODELE, max_tokens: 32000, system: systeme, messages,
            betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
            output_config: { effort: 'high', format: { type: 'json_schema', schema } },
            ...(tools ? { tools } : {})
        });
        for (const b of r.content) if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(x => x.url && sources.length < 12 && !sources.some(y => y.url === x.url) && sources.push({ titre: x.title || '', url: x.url }));
        if (r.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: r.content }); continue; }
        if (r.stop_reason === 'refusal') throw new Error('Claude a décliné la demande');
        const t = r.content.filter(b => b.type === 'text').map(b => b.text).join('');
        try { return { json: JSON.parse(t), sources }; } catch (e) { throw new Error('réponse Claude illisible'); }
    }
    throw new Error('recherche trop longue');
}

const S = { type: 'string' }, N = { type: ['number', 'null'] }, B = { type: 'boolean' }, NB = { type: 'number' };
// Avec la recherche web, l'API refuse les schémas à plusieurs « number|null » (grammaire trop grosse) :
// nombres simples, -1 = inconnu, remis à null par inconnusANull avant l'envoi au site.
const INCONNU_OK = /^(marge_|cout_estime$)/;
const inconnusANull = o => { if (Array.isArray(o)) return o.map(inconnusANull); if (o && typeof o === 'object') { for (const k of Object.keys(o)) o[k] = (o[k] === -1 && !INCONNU_OK.test(k)) ? null : inconnusANull(o[k]); } return o; };
const L = items => ({ type: 'array', items });
const objet = (props, req = Object.keys(props)) => ({ type: 'object', properties: props, required: req, additionalProperties: false });
const E = (...v) => ({ type: 'string', enum: v });
const SCHEMA_VEHICULE = objet({
    synthese: S,
    cote: objet({ tres_bonne_affaire_min: NB, tres_bonne_affaire_max: NB, bonne_affaire_max: NB, prix_equitable_max: NB, prix_juste: NB, lecture: S }),
    demande: objet({ niveau: E('faible', 'moyenne', 'forte', 'tres_forte'), vues_par_jour: NB, contacts_par_semaine: NB, lecture: S }),
    saison: objet({ tendance_30j: E('baisse', 'stable', 'hausse', 'inconnue'), mois_favorables: L(S), lecture: S }),
    probabilite: objet({ j7: NB, j14: NB, j30: NB, j60: NB }),
    delai_estime_jours: NB,
    prix_conseille: NB, prix_plancher: NB, badge_vise: S, marge_au_prix_conseille: NB, marge_au_plancher: NB,
    problemes: L(objet({ titre: S, gravite: E('faible', 'moyenne', 'forte'), source: S, impact_vente: S, a_faire: S, cout_estime: N, a_declarer: B })),
    actions: L(objet({ priorite: NB, titre: S, detail: S, quand: S, cout_forfait: S, gain_attendu: S })),
    annonce: objet({ diagnostic: S, titre_propose: S, a_mettre_en_avant: L(S), photos: S, a_eviter: S }),
    alertes: L(S),
    confiance: E('elevee', 'moyenne', 'faible'),
    donnees_manquantes: L(S)
});
const SCHEMA_PLAN = objet({
    synthese: S,
    priorites: L(objet({ vid: S, libelle: S, action: S, pourquoi: S })),
    forfait: objet({ lecture: S, remontees: S, modifications: S, insertions: S }),
    tresorerie: S,
    lecons: L(S),
    a_surveiller: L(S)
});

const REGLES = `Contexte : LUNICAR / YAK SERVICES, marchand VO professionnel en Île-de-France (Neuilly-sur-Marne, 93). On achète des voitures anciennes ou à fort kilométrage et on les revend sur Leboncoin en tant que pro. Ton rôle : le meilleur conseiller de vente possible, associé du dirigeant. Chiffré, franc, actionnable.
Règles de lecture :
- Tranches Leboncoin (« Très bonne affaire », « Bonne affaire », « Prix équitable », « Légèrement supérieur », « Au-dessus du marché ») : badge affiché sur l'annonce, calculé par Leboncoin pour la version et le km. Données Sonar au km exact = référence.
- Le bon prix n'est pas toujours « Très bonne affaire ». Si la demande est forte (beaucoup de vues par jour, favoris, messages et intentions d'appel, concurrentes qui disparaissent vite, indice de visites élevé, peu d'offre), il faut viser plus haut (« Bonne affaire », voire « Prix équitable »). Exemple réel : une Honda Jazz mise en « Bonne affaire » est partie très vite alors qu'elle était très demandée, donc vendue trop bon marché. Si la demande est faible (peu de vues malgré les remontées, zéro contact après 10 jours), il faut agir : prix, photos, titre ou texte, ou remontée.
- Un pro IDF peut afficher 300 à 500 € de plus que les particuliers (garantie, sérieux, paiement en plusieurs fois). Regarde la concurrence pro à moins de 100 km.
- Saisonnalité : « offre_demande_12_mois » donne pour chaque mois le nombre d'annonces et un indice de visites. Visites hautes et offre basse = bon moment. Déduis la tendance des 30 prochains jours.
- « ventes » Sonar : vraies ventes avec le délai (turnaround) et le prix. « concurrents_observes » : nos propres relevés jour après jour ; une annonce disparue = probablement vendue (délai et prix observés par position de prix). Peu de jours de suivi = signal faible, dis-le.
- Problèmes connus : croise la fiche moteur, les risques, le dossier du diagnostic mécanique YAK (source la plus fiable : c'est l'état réel constaté) et ce que tu sais de ce modèle ou moteur (recherche web autorisée pour les défauts connus et le comportement de la cote). Les défauts déclarés par l'ancien propriétaire dans la demande LUNICAR ne sont PAS l'état actuel : sans info du diagnostic, considère-les réglés.
- Un défaut à déclarer s'écrit dans l'annonce de façon honnête et rassurante. Jamais de mention d'import ni d'immatriculation à l'étranger. Plaques toujours floutées sur les photos.
- Forfait Leboncoin : remontées, modifications et insertions limitées ; au-delà, c'est payant hors forfait (le coût unitaire se déduit de hors_forfait_cts / hors_forfait). Une baisse de prix compte probablement comme une modification (à vérifier). Ne propose une remontée ou une modification que si elle rapporte plus qu'elle ne coûte, et dis laquelle passe en premier quand le quota est épuisé.
- Marges : marge = prix de vente − coût engagé (achat + dépenses + travaux faits) − frais de vente (~60 € + annonce). Le capital immobilisé coûte : une voiture qui dort 60 jours coûte plus qu'une baisse de 200 €.
- Probabilités de vente à 7, 14, 30 et 60 jours en %, cohérentes avec le prix conseillé, la demande et la saison. Délai estimé en jours.
- Actions concrètes, datées (« aujourd'hui », « si 0 contact d'ici vendredi »…), avec le coût forfait (« dans le forfait », « hors forfait ~X € »), 1 à 5 actions par ordre de priorité.
- Français simple, sans jargon, chiffres en euros arrondis. Pas d'invention : une donnée absente va dans donnees_manquantes.
- Nombre inconnu : écris -1 (sauf les marges, toujours chiffrées, et cout_estime, à null si inconnu).`;

const SYSTEME_VEHICULE = REGLES + `
Tâche : stratégie de vente d'UN véhicule à partir de son dossier JSON. Synthèse en 3 ou 4 phrases : où on en est, ce qu'il faut faire et pourquoi.`;
const SYSTEME_PLAN = REGLES + `
Tâche : plan du jour du parc entier à partir des stratégies déjà faites par véhicule, du forfait et des ventes passées. Classe les priorités (ce qui rapporte le plus ou débloque le plus de trésorerie d'abord), répartis le quota du forfait, tire des leçons des ventes passées (prix de vente vs tranche, délai, ce qui a marché), liste ce qu'il faut surveiller demain.`;

// ---------------------------------------------------------------- Diagnostic mécanique : dossiers du parc
function lireDiag(connus) {
    const out = [];
    let parc = [];
    try { parc = fs.readdirSync(path.join(DIAG, 'parc')).filter(f => /^[A-Z0-9-]+_.*\.md$/.test(f)); } catch (e) { return out; }
    let cas = [];
    try { cas = fs.readdirSync(path.join(DIAG, 'diagnostics')); } catch (e) { /* aucun cas */ }
    for (const f of parc) {
        const plaque = f.split('_')[0], cle = plaque.replace(/[^A-Z0-9]/g, '');
        const fichiers = [path.join(DIAG, 'parc', f)];
        const dossiers = cas.filter(c => c.includes('_' + plaque + '_'));
        for (const c of dossiers) { try { fs.readdirSync(path.join(DIAG, 'diagnostics', c)).filter(x => /\.md$/.test(x)).forEach(x => fichiers.push(path.join(DIAG, 'diagnostics', c, x))); } catch (e) { /* */ } }
        const mtime = Math.max(...fichiers.map(x => { try { return fs.statSync(x).mtimeMs; } catch (e) { return 0; } }));
        if (connus[cle] && new Date(connus[cle]).getTime() >= mtime) continue;
        out.push({ plaque, fichier: f, texte: fs.readFileSync(fichiers[0], 'utf8'),
            cas: dossiers.map(c => ({ dossier: c, texte: fichiers.filter(x => x.includes(path.join('diagnostics', c))).map(x => fs.readFileSync(x, 'utf8')).join('\n\n').slice(0, 8000) })) });
    }
    return out;
}

async function api(ctx, chemin, corps) {
    const r = await fetch(ctx.API + chemin, corps === undefined ? { headers: { 'X-Cle': ctx.CLE } } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cle': ctx.CLE }, body: JSON.stringify(corps) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${chemin} : ${r.status} ${j.error || ''}`);
    return j;
}

// Un tour : une tâche à la fois (le relevé des annonces passe par l'onglet Leboncoin, les stratégies non). Renvoie true si quelque chose a été fait.
async function tour(ctx) {
    const T = await api(ctx, '/parc/taches');
    // Dossiers du diagnostic (rapide, sans Leboncoin)
    const diag = lireDiag(T.diag_connus || {});
    if (diag.length) { await api(ctx, '/parc/diag', { dossiers: diag }); ctx.log(`parc : ${diag.length} dossier(s) diagnostic envoyé(s)`); }
    if (T.annonces) {
        const r = await ctx.evaluer('window.__collecte.nosAnnonces()');
        const x = await api(ctx, '/parc/annonces', r);
        ctx.log(`parc : ${x.annonces} annonce(s) relevée(s), ${x.rattachees} rattachée(s) à un véhicule`);
        return 'annonces';
    }
    for (const v of (T.strategies || []).slice(0, 2)) {
        const t0 = Date.now();
        try {
            const D = await api(ctx, '/parc/dossier/' + encodeURIComponent(v.vid));
            const r = await demander({ systeme: SYSTEME_VEHICULE, schema: SCHEMA_VEHICULE, recherche: 4, contenu: 'Dossier du véhicule (JSON) :\n' + JSON.stringify(D) });
            await api(ctx, '/parc/strategie/' + encodeURIComponent(v.vid), { ...inconnusANull(r.json), sources: r.sources, modele: MODELE, empreinte: crypto.createHash('sha1').update(JSON.stringify(D)).digest('hex').slice(0, 12), duree_s: Math.round((Date.now() - t0) / 1000) });
            ctx.log(`parc : stratégie ${v.libelle} · ${r.json.prix_conseille || '—'} € · vente à 30 j ${r.json.probabilite ? r.json.probabilite.j30 : '—'} % · ${Math.round((Date.now() - t0) / 1000)} s`);
        } catch (e) { ctx.log('parc : stratégie en échec', v.libelle, e.message); }
    }
    if ((T.strategies || []).length) return 'strategies';
    if (T.plan) {
        try {
            const G = await api(ctx, '/parc/global');
            const r = await demander({ systeme: SYSTEME_PLAN, schema: SCHEMA_PLAN, contenu: 'Parc (JSON) :\n' + JSON.stringify(G) });
            await api(ctx, '/parc/global', { ...r.json, modele: MODELE });
            ctx.log('parc : plan du jour envoyé');
        } catch (e) { ctx.log('parc : plan en échec', e.message); }
        return 'plan';
    }
    return '';
}

module.exports = { tour, lireDiag };
