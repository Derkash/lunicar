// Analyse approfondie des demandes LUNICAR sur le Mac mini (23/11/2026), appelée par veille.js quand Sonar n'a
// plus rien à relever. Pour chaque demande de la file (GET /api/marche/analyse/file) :
//   1. recherches Leboncoin dans l'onglet piloté (tools/sonar-collecte.js : tranches de km + zone du vendeur) ;
//   2. lecture par Claude des textes du vendeur (formulaire, e-mails, notes d'appel) et de la description des
//      annonces qui pourraient être la sienne : faits datés avec la phrase d'origine, contradictions ;
//   3. fiche moteur en brouillon (Claude + recherche web, sources citées) si la base n'a pas ce moteur ;
//   4. envoi du tout (POST /api/marche/analyse/:ref) : le serveur calcule l'offre et envoie LA notification.
// Clé Claude : ~/lunicar-sonar/anthropic.txt (jamais dans le dépôt). Sans clé, les étapes 2 et 3 sont sautées
// (le serveur le signale) et l'analyse part quand même avec le marché.
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const MODELE = process.env.ANALYSE_MODEL || 'claude-sonnet-5-5';   // même choix de coût que l'estimation (17/10/2026)
// La clé est relue tant qu'elle manque : une clé ajoutée après le démarrage est prise sans redémarrer le service.
let client = null, cleUtilisee = '';
function claude() {
    let cle = process.env.ANTHROPIC_API_KEY || '';
    try { cle = cle || fs.readFileSync(path.join(DIR, 'anthropic.txt'), 'utf8').trim(); } catch (e) { /* pas de clé */ }
    if (!cle) return false;
    if (client && cle === cleUtilisee) return client;
    try { const Anthropic = require('@anthropic-ai/sdk'); client = new Anthropic({ apiKey: cle, timeout: 4 * 60 * 1000, maxRetries: 2 }); cleUtilisee = cle; }
    catch (e) { return false; }
    return client;
}
const pause = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- Claude : appel avec sortie JSON
async function demander({ systeme, contenu, schema, recherche = 0 }) {
    const c = claude();
    if (!c) throw new Error('clé Claude absente sur le Mac mini (anthropic.txt)');
    const messages = [{ role: 'user', content: contenu }];
    const tools = recherche ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: recherche, user_location: { type: 'approximate', country: 'FR', timezone: 'Europe/Paris' } }] : undefined;
    const sources = [];
    for (let tour = 0; tour < 4; tour++) {
        const r = await c.beta.messages.create({
            model: MODELE, max_tokens: 16000, system: systeme, messages,
            betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
            output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
            ...(tools ? { tools } : {})
        });
        for (const b of r.content) if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(s => s.url && sources.length < 12 && !sources.some(x => x.url === s.url) && sources.push({ titre: s.title || '', url: s.url }));
        if (r.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: r.content }); continue; }
        if (r.stop_reason === 'refusal') throw new Error('Claude a décliné la demande');
        const t = r.content.filter(b => b.type === 'text').map(b => b.text).join('');
        try { return { json: JSON.parse(t), sources }; } catch (e) { throw new Error('réponse Claude illisible'); }
    }
    throw new Error('recherche trop longue');
}

const S = { type: 'string' }, N = { type: ['number', 'null'] }, B = { type: 'boolean' };
const objet = (props, req = Object.keys(props)) => ({ type: 'object', properties: props, required: req, additionalProperties: false });
const SCHEMA_TEXTES = objet({
    resume: S,
    faits: { type: 'array', items: objet({
        type: { type: 'string', enum: ['defaut', 'entretien_fait', 'piece_neuve', 'prix', 'projet', 'administratif', 'autre'] },
        organe: { type: 'string', enum: ['distribution', 'embrayage', 'moteur', 'boite', 'turbo', 'injection', 'fap', 'egr', 'adblue', 'freins', 'suspensions', 'direction', 'clim', 'batterie', 'pneus', 'carrosserie', 'interieur', 'electrique', 'vidange', 'ct', 'autre'] },
        libelle: S, citation: S, source: S, km: N, annee: N, facture: B, cout: N,
        gravite: { type: 'string', enum: ['faible', 'moyenne', 'forte'] }
    }) },
    contradictions: { type: 'array', items: objet({ sujet: S, reponse: S, citation: S }) }
});
const SCHEMA_FICHE = objet({
    libelle: S, marque: S, motorisation: S, code_moteur: S, energie: S,
    distribution: objet({ organe: { type: 'string', enum: ['courroie', 'courroie_huile', 'chaine', ''] }, intervalle_km: N, intervalle_ans: N, cout_min: N, cout_max: N, note: S }),
    points: { type: 'array', items: objet({ titre: S, detail: S, organe: S, cout_min: N, cout_max: N, question: S }) },
    questions: { type: 'array', items: S },
    fiabilite: { type: 'string', enum: ['constructeur', 'a_verifier'] }
});

const SYSTEME_TEXTES = `Tu lis les textes d'un vendeur de voiture d'occasion pour LUNICAR, qui rachète des voitures. Tu extrais seulement des faits écrits noir sur blanc, jamais des suppositions.
- Chaque fait : type, organe, libellé court en français, citation exacte (phrase d'origine, 300 caractères au plus), source (telle que fournie), km et année si écrits, facture = true seulement si une facture est mentionnée, coût si un montant de devis ou de réparation est écrit.
- « entretien_fait » : intervention réalisée (distribution, embrayage, vidange, pneus…). « defaut » : problème actuel. « piece_neuve » : pièce remplacée récemment.
- Les annonces Leboncoin fournies ne sont PAS forcément celles du vendeur : pour leurs faits, mets la source telle que fournie (« annonce Leboncoin possible »).
- Contradictions : seulement quand un texte contredit clairement une réponse du formulaire (ex. réponse « aucun voyant », texte « le voyant moteur s'allume »).
- Résumé : 2 phrases utiles à un acheteur avant d'appeler. Si les textes ne disent rien d'utile, résumé vide et listes vides.`;

const SYSTEME_FICHE = `Tu rédiges une fiche moteur pour LUNICAR (rachat de voitures d'occasion) : type de distribution, intervalle de remplacement, coûts, points de vigilance connus et questions à poser au vendeur.
- Cherche sur le web des sources sérieuses (constructeur, presse auto, garages, forums spécialisés). N'écris que ce que les sources soutiennent.
- Intervalle : celui des sources. « constructeur » seulement si la source est un document du constructeur ; sinon « a_verifier ». Inconnu = null, jamais inventé.
- Coûts : ordre de grandeur en euros TTC en France (pièces + main-d'œuvre), ou null.
- marque et motorisation : expressions régulières simples (minuscules, sans accents) qui reconnaissent ce moteur dans un texte, ex. « ford » et « 1[.,]0.*eco ?boost ».
- 2 à 5 points de vigilance, chacun avec une question courte à poser au téléphone. Français simple.`;

// ---------------------------------------------------------------- Une demande
async function traiter(job, ctx) {
    const t0 = Date.now(), erreurs = [], corps = { empreinte: job.empreinte };
    // 1. Recherches Leboncoin (sauf si faites il y a moins de 3 jours)
    if (job.lbc && !job.deja_lbc) {
        const r = await ctx.evaluer(`window.__collecte.lbcLancer(${JSON.stringify(job)})`);
        if (r !== 'lancé') erreurs.push('recherches Leboncoin : ' + r);
        else {
            let etat = null;
            for (let i = 0; i < 100; i++) { await pause(3000); etat = await ctx.evaluer(`window.__collecte.lbcEtat(${JSON.stringify(job.ref)})`); if (etat && etat.fini) break; }
            if (etat && etat.fini) { corps.lbc = etat.resultat; erreurs.push(...(etat.resultat.erreurs || [])); }
            else erreurs.push('recherches Leboncoin trop longues (5 min)');
        }
    } else if (!job.lbc) erreurs.push('pas de modèle Leboncoin connu (ni version Sonar, ni marque de la plaque)');

    // 2. Lecture des textes (vendeur + annonces qui pourraient être la sienne)
    const proches = ((corps.lbc && corps.lbc.local && corps.lbc.local.ads) || [])
        .filter(a => a.texte && !a.pro && (!job.km || Math.abs(a.km - job.km) <= Math.max(10000, job.km * 0.1)) && (!job.annee || Math.abs(a.an - job.annee) <= 1)).slice(0, 3);
    const textes = [...(job.textes || []), ...proches.map(a => ({ source: 'annonce Leboncoin possible', texte: `${a.titre} — ${a.prix} € · ${a.km} km · ${a.ville}\n${a.texte}` }))];
    if (textes.length) {
        try {
            const r = await demander({ systeme: SYSTEME_TEXTES, schema: SCHEMA_TEXTES, contenu:
                `Voiture : ${job.vehicule} ${job.version ? '(' + job.version + ')' : ''} · ${job.annee || '?'} · ${job.km || '?'} km\n` +
                `Réponses du formulaire : ${JSON.stringify(job.reponses)}\n\nTextes :\n${textes.map((t, i) => `[${i + 1}] Source : ${t.source}\n${t.texte}`).join('\n\n')}` });
            corps.textes = r.json;
        } catch (e) { erreurs.push('lecture des textes : ' + e.message); corps.textes = { resume: '', faits: [], contradictions: [], erreur: e.message }; }
    }

    // 3. Fiche moteur manquante (une seule fois par moteur : le serveur ne la redemande plus ensuite)
    if (job.fiche_a_rediger && job.fiche_a_rediger.motorisation) {
        try {
            const f = job.fiche_a_rediger;
            const r = await demander({ systeme: SYSTEME_FICHE, schema: SCHEMA_FICHE, recherche: 6, contenu:
                `Moteur : ${f.marque} · ${f.motorisation}${f.code_moteur ? ' · code moteur ' + f.code_moteur : ''} · ${f.energie || 'énergie inconnue'} · véhicule de ${f.annee || '?'}.` });
            corps.fiche_moteur = { ...r.json, sources: r.sources };
        } catch (e) { erreurs.push('fiche moteur : ' + e.message); }
    }

    corps.erreurs = erreurs;
    corps.duree_s = Math.round((Date.now() - t0) / 1000);
    const x = await fetch(`${ctx.API}/analyse/${encodeURIComponent(job.ref)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cle': ctx.CLE }, body: JSON.stringify(corps) });
    const j = await x.json().catch(() => ({}));
    if (!x.ok) throw new Error(`envoi de l'analyse ${job.ref} : ${x.status} ${j.error || ''}`);
    ctx.log(`analyse ${job.ref} (${job.vehicule}) : ${corps.duree_s} s · offre ${j.offre || '—'} · confiance ${j.confiance || '—'}${erreurs.length ? ' · ' + erreurs.join(' | ') : ''}`);
}

// Un tour : jusqu'à 2 demandes (les plus récentes d'abord). Renvoie le nombre traité.
async function tour(ctx) {
    const r = await fetch(`${ctx.API}/analyse/file?limite=2`, { headers: { 'X-Cle': ctx.CLE } });
    if (!r.ok) throw new Error('file des analyses : ' + r.status);
    const l = await r.json();
    for (const job of l) {
        try { await traiter(job, ctx); }
        catch (e) { ctx.log('analyse en échec', job.ref, e.message); }
    }
    return l.length;
}

module.exports = { tour, traiter, demander, SCHEMA_TEXTES, SCHEMA_FICHE };
