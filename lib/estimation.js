// Estimation automatique d'une demande de rachat.
// Claude cherche sur le web les annonces comparables (Leboncoin d'abord, puis La Centrale / AutoScout24)
// et la cote, chiffre la remise en état d'après ce que le vendeur a déclaré (et ses photos),
// puis le serveur calcule le prix maximum d'achat avec les réglages de marge de l'admin.
const Anthropic = require('@anthropic-ai/sdk');
const store = require('./store');

const MODEL = process.env.ESTIMATION_MODEL || 'claude-sonnet-5-5';
const actif = () => !!process.env.ANTHROPIC_API_KEY;
const client = actif() ? new Anthropic({ timeout: 4 * 60 * 1000, maxRetries: 2 }) : null;

// Réglages par défaut du calcul (modifiables dans l'admin, onglet Réglages).
const REGLAGES_DEFAUT = {
    marge_pct: 15,          // marge visée, en % du prix de revente
    marge_min: 800,         // marge minimale en euros
    frais_fixes: 350,       // enlèvement, démarches, nettoyage, annonce
    arrondi: 50             // prix max arrondi à l'inférieur
};
const reglages = async () => ({ ...REGLAGES_DEFAUT, ...(await store.lireReglage('estimation', {})) });

const SYSTEM = `Tu es l'acheteur expert de LUNICAR, négociant qui rachète des voitures d'occasion à des particuliers partout en France, puis les revend (après remise en état, ou en l'état à des marchands / à l'export quand la réparation ne vaut pas le coup).

Ta mission : estimer ce que vaut la voiture décrite, avec des chiffres sourcés.

Méthode :
1. Identifie précisément le véhicule (version, motorisation, carburant probables d'après la fiche et l'année).
2. Cherche sur le web des annonces comparables actuelles, en priorité sur leboncoin.fr (requêtes du type « leboncoin <marque> <modèle> <année> <motorisation> »), sinon La Centrale, AutoScout24, ParuVendu. Même modèle, années ±1, kilométrage proche. Relève les prix réels que tu vois, ne les invente pas.
3. Cherche la cote (La Centrale « cote », Argus, ou équivalent). Si tu ne trouves pas de cote publiée, déduis-la des annonces (en général 10 à 15 % sous le prix moyen des annonces de particuliers) et indique source = "estimation".
4. Estime les frais de remise en état d'après l'état déclaré : mécanique, carrosserie, contrôle technique, kilométrage, et ce que montrent les photos s'il y en a. Sois concret (embrayage, distribution, pneus, carrosserie par élément…). Pour une voiture en panne ou accidentée, choisis le canal de revente le plus réaliste (réparer puis revendre, ou revendre en l'état à un marchand / à l'export) et chiffre en conséquence.
4 bis. Si un DIAGNOSTIC MÉCANIQUE de LUNICAR est fourni (explication écrite et/ou captures d'une valise de diagnostic : codes défaut OBD/constructeur, ediag, mesures), il PRIME sur l'état déclaré par le vendeur. Lis chaque code défaut visible sur les captures (P0xxx, P1xxx, Cxxxx, Bxxxx, Uxxxx…), donne sa signification probable POUR CE MOTEUR, sa gravité et le coût de réparation réaliste en garage indépendant (cherche sur le web si besoin). Distingue un défaut ponctuel / mémorisé (souvent un capteur, peu cher) d'une panne lourde. Reporte ces réparations dans les postes de remise en état et dans "diagnostic". Si une capture est illisible ou ne montre pas de code, dis-le ; n'invente aucun code.
5. Le prix de vente estimé est le prix auquel LUNICAR peut réellement revendre ce véhicule rapidement (sous 30 jours) par le canal choisi, une fois les frais engagés.
6. Juge l'ATTRACTIVITÉ À LA REVENTE : ce véhicule vaut-il le coup d'être acheté, se revendra-t-il vite ? Appuie-toi sur des signaux que tu as réellement observés :
   - l'offre : nombre d'annonces comparables (même modèle, motorisation, années ±2), et leur ancienneté quand elle est visible (annonces en ligne depuis longtemps, baisses de prix, mêmes annonces qui reviennent) ;
   - la dispersion des prix des annonces (serrée = marché clair et liquide, forte = marché flou) ;
   - la demande : intérêt de recherche pour le modèle (Google Trends, popularité, articles « les occasions les plus recherchées »), réputation de fiabilité, coût d'entretien connu (courroie, boîte robotisée, pièces chères) ;
   - le contexte Île-de-France si le véhicule y est : vignette Crit'Air et zone à faibles émissions (un vieux diesel se revend mal à Paris), boîte automatique recherchée en ville, petite citadine demandée ; et la possibilité de revendre hors IDF ou à l'export ;
   - la saisonnalité quand elle compte (cabriolet, 4x4, utilitaire).
   Barème du score (0 à 100) : 75 et plus = se revend vite, acheter ; 50 à 74 = vendable, acheter seulement à prix serré ; moins de 50 = demande faible ou revente lente, éviter sauf prix très bas. N'invente aucun chiffre de demande : si un signal n'est pas observable, dis « non observé » et baisse la confiance.

Règles : si le véhicule déclaré par le vendeur et la fiche officielle SIV se contredisent (carburant, motorisation, version), la fiche SIV fait foi ; signale la contradiction dans "hypotheses". Euros TTC, nombres entiers. Si une information manque (motorisation, finition), fais l'hypothèse la plus probable et signale-la. N'invente jamais d'annonce ni d'URL : n'indique que celles que tu as réellement vues dans les résultats.

Réponds en terminant par UN SEUL bloc \`\`\`json conforme à ce schéma :
{
  "vehicule_identifie": "string",
  "hypotheses": ["string"],
  "annonces": [{"titre": "string", "prix": 0, "annee": 0, "km": 0, "lieu": "string", "source": "leboncoin|lacentrale|autoscout24|autre", "url": "string"}],
  "leboncoin": {"prix_bas": 0, "prix_median": 0, "prix_haut": 0, "nb_annonces": 0, "commentaire": "string (si peu ou pas d'annonces Leboncoin trouvées, dis-le et sur quoi tu t'appuies)"},
  "cote_argus": {"valeur": 0, "source": "string", "commentaire": "string"},
  "canal_revente": "reparer_revendre|en_l_etat_marchand|export|pieces",
  "prix_vente_estime": {"valeur": 0, "commentaire": "string"},
  "frais_remise_en_etat": {"total": 0, "postes": [{"libelle": "string", "montant": 0}]},
  "prix_max_achat_ia": 0,
  "diagnostic": {"codes": [{"code": "string", "signification": "string", "gravite": "faible|moyenne|forte", "cout_estime": 0}], "synthese": "string (ce que le diagnostic change à l'estimation ; vide si aucun diagnostic fourni)"},
  "confiance": "faible|moyenne|bonne",
  "points_attention": ["string"],
  "questions_a_poser": ["string (ce qu'il faut demander au vendeur au téléphone pour affiner)"],
  "attractivite": {
    "score": 0,
    "verdict": "acheter|prix_serre|eviter",
    "delai_revente": "rapide|moyen|lent",
    "delai_commentaire": "string (ex. « 2 à 4 semaines par annonce entre particuliers »)",
    "offre": {"nb_annonces_comparables": 0, "anciennete": "string (ce que tu as vu sur l'ancienneté des annonces et les baisses de prix, ou « non observé »)", "dispersion_prix": "serree|moyenne|forte"},
    "demande": {"tendance": "hausse|stable|baisse|non_observee", "commentaire": "string"},
    "facteurs_plus": ["string"],
    "facteurs_moins": ["string"],
    "contexte_idf": "string (Crit'Air, ZFE, boîte, gabarit… ou « hors IDF »)",
    "confiance": "faible|moyenne|bonne",
    "resume": "string (1 ou 2 phrases : vaut-il le coup d'être acheté, et à quelle condition)"
  },
  "resume": "string (2 ou 3 phrases)"
}`;

function descriptionDemande(d) {
    const x = d.data || {};
    const fiche = x.fiche_api || null;
    const lignes = [
        ['Véhicule déclaré', x.vehicule], ['Année', x.annee], ['Kilométrage', x.kilometrage && `${x.kilometrage} km`],
        ['Plaque', x.plaque], ['Datation de la plaque', x.plaque_datation], ['Fiche confirmée par le vendeur', x.fiche_confirmee],
        ['État mécanique', x.mecanique || (x.etat || []).join(', ')], ['Carrosserie', x.carrosserie],
        ['Contrôle technique', x.controle_technique], ['Prix souhaité par le vendeur', x.prix_souhaite && `${x.prix_souhaite} €`],
        ['Délai de vente', x.delai], ['Localisation', [x.code_postal, x.ville].filter(Boolean).join(' ')],
        ['Message du vendeur', x.message],
        // Champs des anciens formulaires (import Gmail)
        ['Carburant', x.carburant], ['Boîte', x.boite], ['Extérieur', x.etat_exterieur], ['Intérieur', x.etat_interieur]
    ].filter(([, v]) => v).map(([k, v]) => `- ${k} : ${v}`);
    const diag = (d.suivi || {}).diagnostic || {};
    let txt = `Demande de rachat reçue le ${String(d.created_at).slice(0, 10)}.\n${lignes.join('\n')}`;
    if (fiche) {
        const ignores = /^(erreur|logo|photo|tecdoc|k_type|sra|code_|liste_|pneus|collection)/i;
        const f = Object.entries(fiche)
            .filter(([k, v]) => !ignores.test(k) && v !== null && v !== '' && typeof v !== 'object')
            .slice(0, 40).map(([k, v]) => `- ${k} : ${v}`);
        if (f.length) txt += `\n\nFiche officielle (SIV) :\n${f.join('\n')}`;
    }
    if (diag.texte || (diag.captures || []).length) {
        txt += `\n\nDIAGNOSTIC MÉCANIQUE LUNICAR (prioritaire sur l'état déclaré par le vendeur)`;
        if (diag.texte) txt += ` :\n${diag.texte}`;
        if ((diag.captures || []).length) txt += `\n${diag.captures.length} capture(s) de la valise de diagnostic jointe(s) ci-dessus, après les photos du véhicule.`;
    }
    return txt;
}

// Photos jointes (au plus 4, sous 4,5 Mo) pour que Claude juge l'état visuel.
async function photosPourClaude(d) {
    const blocs = [];
    for (const p of (d.photos || []).filter(p => /\.(jpe?g|png|webp)$/i.test(p.name)).slice(0, 4)) {
        try {
            const { buffer, type } = await store.lirePhoto(p.path);
            if (buffer.length > 4.5 * 1024 * 1024) continue;
            const media = /png/.test(type) ? 'image/png' : /webp/.test(type) ? 'image/webp' : 'image/jpeg';
            blocs.push({ type: 'image', source: { type: 'base64', media_type: media, data: buffer.toString('base64') } });
        } catch (e) { /* photo illisible : on continue sans */ }
    }
    return blocs;
}

// Captures de la valise de diagnostic (au plus 6), précédées d'une légende pour les distinguer des photos.
async function diagPourClaude(d) {
    const blocs = [];
    for (const p of (((d.suivi || {}).diagnostic || {}).captures || []).filter(p => /\.(jpe?g|png|webp)$/i.test(p.name)).slice(-6)) {
        try {
            const { buffer, type } = await store.lirePhoto(p.path);
            if (buffer.length > 4.5 * 1024 * 1024) continue;
            const media = /png/.test(type) ? 'image/png' : /webp/.test(type) ? 'image/webp' : 'image/jpeg';
            blocs.push({ type: 'image', source: { type: 'base64', media_type: media, data: buffer.toString('base64') } });
        } catch (e) { /* capture illisible : on continue sans */ }
    }
    return blocs.length ? [{ type: 'text', text: 'Captures de la valise de diagnostic (codes défaut) :' }, ...blocs] : [];
}

function extraireJSON(texte) {
    const blocs = [...texte.matchAll(/```json\s*([\s\S]*?)```/g)];
    const brut = blocs.length ? blocs[blocs.length - 1][1] : texte.slice(texte.indexOf('{'), texte.lastIndexOf('}') + 1);
    return JSON.parse(brut);
}
const n = v => { const x = Math.round(Number(String(v == null ? '' : v).replace(/[^\d.-]/g, ''))); return Number.isFinite(x) ? x : 0; };

// Prix max d'achat = revente − remise en état − frais fixes − marge (en % du prix de revente, avec un minimum).
function calculer(ia, r) {
    const vente = n(ia.prix_vente_estime && ia.prix_vente_estime.valeur);
    const remise = n(ia.frais_remise_en_etat && ia.frais_remise_en_etat.total);
    const marge = Math.max(n(r.marge_min), Math.round(vente * n(r.marge_pct) / 100));
    const brut = vente - remise - n(r.frais_fixes) - marge;
    const arrondi = Math.max(1, n(r.arrondi));
    return {
        prix_vente_estime: vente,
        frais_remise_en_etat: remise,
        frais_fixes: n(r.frais_fixes),
        marge,
        prix_max_achat: Math.max(0, Math.floor(brut / arrondi) * arrondi)
    };
}

async function estimer(demande) {
    if (!client) throw new Error('ANTHROPIC_API_KEY non défini : estimation automatique désactivée');
    const r = await reglages();
    const photos = await photosPourClaude(demande);
    const contenu = [...(photos.length ? [{ type: 'text', text: 'Photos du véhicule envoyées par le vendeur :' }, ...photos] : []), ...await diagPourClaude(demande), { type: 'text', text: descriptionDemande(demande) }];
    const messages = [{ role: 'user', content: contenu }];
    const t0 = Date.now();
    let resp;
    const usage = { input_tokens: 0, output_tokens: 0, recherches: 0 };
    // Une recherche web longue peut rendre la main en « pause_turn » : on relance avec la suite.
    for (let tour = 0; tour < 4; tour++) {
        resp = await client.beta.messages.create({
            model: MODEL,
            max_tokens: 16000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            thinking: { type: 'adaptive' },
            output_config: { effort: process.env.ESTIMATION_EFFORT || 'medium' },
            system: SYSTEM,
            tools: [{
                type: 'web_search_20260209', name: 'web_search', max_uses: n(process.env.ESTIMATION_RECHERCHES) || 10,
                user_location: { type: 'approximate', country: 'FR', timezone: 'Europe/Paris' }
            }],
            messages
        });
        usage.input_tokens += resp.usage.input_tokens || 0;
        usage.output_tokens += resp.usage.output_tokens || 0;
        usage.recherches += (resp.usage.server_tool_use && resp.usage.server_tool_use.web_search_requests) || 0;
        if (resp.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: resp.content });
    }
    if (resp.stop_reason === 'refusal') throw new Error('Estimation refusée par le modèle');

    // Sources réellement consultées (résultats de recherche), pour vérifier les chiffres.
    const sources = [];
    for (const m of [...messages.filter(m => m.role === 'assistant').map(m => m.content), resp.content]) {
        for (const b of m) {
            if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
                b.content.forEach(s => s.url && !sources.some(x => x.url === s.url) && sources.push({ titre: s.title, url: s.url }));
            }
        }
    }
    const texte = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const ia = extraireJSON(texte);
    if (ia.attractivite) {
        const a = ia.attractivite;
        a.score = Math.max(0, Math.min(100, n(a.score)));
        if (!['acheter', 'prix_serre', 'eviter'].includes(a.verdict)) a.verdict = a.score >= 75 ? 'acheter' : a.score >= 50 ? 'prix_serre' : 'eviter';
    }
    const calcul = calculer(ia, r);
    return {
        ...ia,
        // Les 4 chiffres affichés partout (e-mail, admin)
        prix: {
            max_achat: calcul.prix_max_achat,
            leboncoin: n(ia.leboncoin && ia.leboncoin.prix_median),
            argus: n(ia.cote_argus && ia.cote_argus.valeur),
            vente_estime: calcul.prix_vente_estime
        },
        calcul, reglages: r, sources: sources.slice(0, 40),
        modele: resp.model || MODEL, duree_s: Math.round((Date.now() - t0) / 1000), usage,
        date: new Date().toISOString()
    };
}

// File d'attente : une estimation à la fois, pour maîtriser le coût et les limites de l'API.
let file = Promise.resolve();
const enCours = new Set();
function planifier(ref) {
    ref = String(ref).toUpperCase();
    if (enCours.has(ref)) return file;
    enCours.add(ref);
    file = file.then(async () => {
        try {
            const d = await store.lireDemande(ref);
            if (!d) return null;
            await store.majDemande(ref, { suivi: { ...d.suivi, estimation_statut: 'en_cours', estimation_erreur: null } });
            const est = await estimer(d);
            const maj = await store.majDemande(ref, { estimation: est, estimation_at: est.date, suivi: { ...d.suivi, estimation_statut: 'ok', estimation_erreur: null } });
            console.log(`💶 Estimation ${ref} : max ${est.prix.max_achat} € · revente ${est.prix.vente_estime} € (${est.duree_s} s, ${est.usage.recherches} recherches)`);
            return maj;
        } catch (e) {
            console.error(`❌ Estimation ${ref} :`, e.message);
            const d = await store.lireDemande(ref).catch(() => null);
            if (d) await store.majDemande(ref, { suivi: { ...d.suivi, estimation_statut: 'erreur', estimation_erreur: e.message.slice(0, 300) } }).catch(() => {});
            return null;
        } finally {
            enCours.delete(ref);
        }
    });
    return file;
}
const etat = () => ({ actif: actif(), modele: MODEL, en_cours: [...enCours] });

module.exports = { estimer, planifier, calculer, reglages, REGLAGES_DEFAUT, etat, actif };
