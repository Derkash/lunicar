// Estimation automatique d'une demande de rachat.
// Claude cherche sur le web les annonces comparables (Leboncoin d'abord, puis La Centrale / AutoScout24)
// et la cote, chiffre la remise en état d'après ce que le vendeur a déclaré (et ses photos),
// puis le serveur calcule le prix maximum d'achat avec les réglages de marge de l'admin.
const Anthropic = require('@anthropic-ai/sdk');
const deplacement = require('./deplacement');
const store = require('./store');
const coteMarchand = require('./cote-marchand');
const fourchetteClient = require('./fourchette');

const MODEL = process.env.ESTIMATION_MODEL || 'claude-sonnet-5-5';
const actif = () => !!process.env.ANTHROPIC_API_KEY;
const client = actif() ? new Anthropic({ timeout: 4 * 60 * 1000, maxRetries: 2 }) : null;

// Réglages par défaut du calcul (modifiables dans l'admin, onglet Réglages).
const REGLAGES_DEFAUT = {
    // Mode de calcul : « marchand » (LUNICAR revend aux professionnels, offre calée sur
    // vendezvotrevoiture.fr un peu au-dessus) ou « particulier » (ancien calcul revente aux particuliers).
    mode: 'marchand',
    prime_pct: 6,           // marchand : on propose la cote marchand + 6 %…
    prime_eur: 50,          // …+ 50 €
    revente_marchand_pct: 15, // marchand : revente aux professionnels ≈ cote + 15 %…
    revente_marchand_min: 600, // …et au moins + 600 € (écart observé entre rachat et enchères pro)
    frais_fixes_marchand: 150, // démarches, transport vers l'acheteur pro
    marge_min_marchand: 300,   // marge minimale par voiture revendue aux pros
    ...fourchetteClient.DEFAUT, // fourchette annoncée au client (bas = offre de base)
    marge_pct: 15,          // marge visée, en % du prix de revente
    marge_min: 800,         // marge minimale en euros
    frais_fixes: 350,       // enlèvement, démarches, nettoyage, annonce
    arrondi: 50,            // prix max arrondi à l'inférieur
    // Déplacement pour aller chercher la voiture : train à l'aller, retour au volant (carburant + péages).
    depart_cp: '75020',     // point de départ (code postal)
    prix_gazole: 1.75, prix_essence: 1.85, cout_electrique_100km: 5,
    conso_diesel: 6.5, conso_essence: 7.5, conso_hybride: 5.5,  // litres / 100 km
    peage_eur_km: 0.085, peage_seuil_km: 80,                   // péages au-delà de 80 km
    train_eur_km: 0.11, train_min: 20,                          // billet aller estimé hors Île-de-France
    train_local_km: 70, train_local_eur: 5                      // trajet local : ticket RER / Transilien
};
const reglages = async () => ({ ...REGLAGES_DEFAUT, ...(await store.lireReglage('estimation', {})) });

const SYSTEM = `Tu es l'acheteur expert de LUNICAR, négociant qui rachète des voitures d'occasion à des particuliers partout en France et les revend principalement à des professionnels (marchands, enchères B2B, export), comme vendezvotrevoiture.fr. Le prix d'achat est calculé par le serveur à partir de la médiane des annonces de particuliers que tu relèves : elle doit donc être juste et porter sur des voitures comparables QUI ROULENT, même si la voiture étudiée est en panne.

Ta mission : estimer le plus PRÉCISÉMENT possible ce que vaut la voiture décrite, en croisant toutes les sources disponibles, avec des chiffres sourcés.

Méthode :
1. Identifie précisément le véhicule : génération, version / finition, motorisation exacte, carburant, boîte (d'après la fiche officielle SIV, le titre et l'année). Une mauvaise version fausse tout : vérifie-la.
2. MARCHÉ — relève un maximum d'annonces comparables actuelles (vise 8 à 15) en multipliant les sources :
   - particuliers : leboncoin.fr, ParuVendu, Le Parking (agrégateur) ;
   - professionnels : La Centrale, AutoScout24, Aramis Auto, Autohero, Spoticar / Renew / réseaux de marque, Capcar ;
   - fais plusieurs requêtes (modèle + motorisation + année, puis années ±1 et ±2, puis kilométrages proches) jusqu'à avoir assez de points.
   Pour chaque annonce : prix, année, kilométrage, version, vendeur particulier ou pro, URL. N'invente aucune annonce.
   AJUSTE chaque prix à la voiture étudiée avant de comparer : kilométrage (ordre de grandeur 3 à 6 % du prix par tranche de 20 000 km d'écart selon la gamme), année (5 à 10 % par an), version et options, et retire environ 8 à 15 % aux annonces de professionnels (garantie, préparation, marge). Écarte les valeurs aberrantes (épaves, erreurs, prix d'appel). Calcule la médiane ajustée et la dispersion.
3. COTES — cherche au moins deux cotes publiées : La Centrale (cote), L'argus / largus.fr, Autoplus, Caradisiac. Indique la plus pertinente dans "cote_argus" et les autres dans "cotes". Sans cote publiée, déduis-la des annonces et mets source = "estimation".
3 bis. CONCURRENCE À LA REPRISE — quand c'est trouvable, relève ce que proposent les racheteurs professionnels pour ce type de voiture (Aramis reprise, Autobiz / vendezvotrevoiture, La Centrale reprise, comparateurs) : c'est le prix que le vendeur peut obtenir ailleurs. Mets-le dans "reprise_concurrents".
4. Estime les frais de remise en état d'après l'état déclaré : mécanique, carrosserie, contrôle technique, kilométrage, et ce que montrent les photos s'il y en a. Sois concret (embrayage, distribution, pneus, carrosserie par élément…). Pour une voiture en panne ou accidentée, choisis le canal de revente le plus réaliste (réparer puis revendre, ou revendre en l'état à un marchand / à l'export) et chiffre en conséquence.
4 bis. Si un DIAGNOSTIC MÉCANIQUE de LUNICAR est fourni (explication écrite et/ou captures d'une valise de diagnostic : codes défaut OBD/constructeur, ediag, mesures), il PRIME sur l'état déclaré par le vendeur. Lis chaque code défaut visible sur les captures (P0xxx, P1xxx, Cxxxx, Bxxxx, Uxxxx…), donne sa signification probable POUR CE MOTEUR, sa gravité et le coût de réparation réaliste en garage indépendant (cherche sur le web si besoin). Distingue un défaut ponctuel / mémorisé (souvent un capteur, peu cher) d'une panne lourde. Reporte ces réparations dans les postes de remise en état et dans "diagnostic". Si une capture est illisible ou ne montre pas de code, dis-le ; n'invente aucun code.
4 ter. Si un TRAJET est indiqué (départ de LUNICAR → commune du vendeur), cherche le prix d'un billet de train ALLER pour ce trajet (SNCF Connect, Trainline, Ouigo ; aller simple en 2de classe réservé quelques jours avant) et donne-le dans "deplacement.train_aller". Si tu ne trouves pas, mets 0. Le retour se fait au volant de la voiture : ne le chiffre pas, le serveur s'en charge.
4 quater. Si des COMPTES RENDUS D'APPEL sont fournis, ce que le vendeur a dit au téléphone PRIME sur le formulaire (kilométrage, défauts, entretien, prix souhaité, urgence). Tiens-en compte partout.
5. Le prix de vente estimé est le prix auquel LUNICAR peut réellement revendre ce véhicule rapidement (sous 30 jours) par le canal choisi, une fois les frais engagés. TRIANGULE : médiane ajustée des annonces de particuliers (poids principal), cotes, annonces pro moins leur marge. Explique en une phrase dans "prix_vente_estime.commentaire" comment tu arrives au chiffre. La confiance est « bonne » seulement avec au moins 6 comparables cohérents et une dispersion serrée.
6. Juge l'ATTRACTIVITÉ À LA REVENTE : ce véhicule vaut-il le coup d'être acheté, se revendra-t-il vite ? Appuie-toi sur des signaux que tu as réellement observés :
   - l'offre : nombre d'annonces comparables (même modèle, motorisation, années ±2), et leur ancienneté quand elle est visible (annonces en ligne depuis longtemps, baisses de prix, mêmes annonces qui reviennent) ;
   - la dispersion des prix des annonces (serrée = marché clair et liquide, forte = marché flou) ;
   - la demande : intérêt de recherche pour le modèle (Google Trends, popularité, articles « les occasions les plus recherchées »), réputation de fiabilité, coût d'entretien connu (courroie, boîte robotisée, pièces chères) ;
   - le contexte Île-de-France si le véhicule y est : vignette Crit'Air et zone à faibles émissions (un vieux diesel se revend mal à Paris), boîte automatique recherchée en ville, petite citadine demandée ; et la possibilité de revendre hors IDF ou à l'export ;
   - la saisonnalité quand elle compte (cabriolet, 4x4, utilitaire).
   Barème du score (0 à 100) : 75 et plus = se revend vite, acheter ; 50 à 74 = vendable, acheter seulement à prix serré ; moins de 50 = demande faible ou revente lente, éviter sauf prix très bas. N'invente aucun chiffre de demande : si un signal n'est pas observable, dis « non observé » et baisse la confiance.

Règles de cohérence : le PRIX MAX D'ACHAT est calculé par le serveur à partir de TON prix de vente, de TES frais de remise en état et des réglages de LUNICAR (frais fixes, déplacement, marge). Ne cite donc AUCUN prix d'achat, d'offre ou de « prix à proposer » dans "resume", "attractivite.resume" ni ailleurs dans les textes : parle du prix de revente, des frais et des risques. "prix_max_achat_ia" reste ton avis brut, sans marge, pour contrôle interne.
Règles : si le véhicule déclaré par le vendeur et la fiche officielle SIV se contredisent (carburant, motorisation, version), la fiche SIV fait foi ; signale la contradiction dans "hypotheses". Euros TTC, nombres entiers. Si une information manque (motorisation, finition), fais l'hypothèse la plus probable et signale-la. N'invente jamais d'annonce ni d'URL : n'indique que celles que tu as réellement vues dans les résultats.

Réponds en terminant par UN SEUL bloc \`\`\`json conforme à ce schéma :
{
  "vehicule_identifie": "string",
  "hypotheses": ["string"],
  "annonces": [{"titre": "string", "prix": 0, "prix_ajuste": 0, "annee": 0, "km": 0, "lieu": "string", "vendeur": "particulier|pro", "source": "leboncoin|lacentrale|autoscout24|paruvendu|leparking|aramis|autohero|spoticar|autre", "url": "string"}],
  "marche": {"nb_annonces": 0, "prix_bas": 0, "prix_median_ajuste": 0, "prix_haut": 0, "dispersion": "serree|moyenne|forte", "sources": ["string"], "commentaire": "string (sur quoi repose la médiane, ajustements faits)"},
  "leboncoin": {"prix_bas": 0, "prix_median": 0, "prix_haut": 0, "nb_annonces": 0, "commentaire": "string"},
  "cote_argus": {"valeur": 0, "source": "string", "commentaire": "string"},
  "cotes": [{"source": "string", "valeur": 0}],
  "reprise_concurrents": {"valeur": 0, "source": "string", "commentaire": "string (0 si non trouvé)"},
  "canal_revente": "reparer_revendre|en_l_etat_marchand|export|pieces",
  "prix_vente_estime": {"valeur": 0, "commentaire": "string"},
  "frais_remise_en_etat": {"total": 0, "postes": [{"libelle": "string", "montant": 0}]},
  "prix_max_achat_ia": 0,
  "deplacement": {"train_aller": 0, "source": "string"},
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
    const appels = ((d.suivi || {}).appels || []).filter(a => a.texte || (a.corrections || []).length).slice(0, 5);
    let txt = `Demande de rachat reçue le ${String(d.created_at).slice(0, 10)}.\n${lignes.join('\n')}`;
    if (fiche) {
        const ignores = /^(erreur|logo|photo|tecdoc|k_type|sra|code_|liste_|pneus|collection)/i;
        const f = Object.entries(fiche)
            .filter(([k, v]) => !ignores.test(k) && v !== null && v !== '' && typeof v !== 'object')
            .slice(0, 40).map(([k, v]) => `- ${k} : ${v}`);
        if (f.length) txt += `\n\nFiche officielle (SIV) :\n${f.join('\n')}`;
    }
    if (appels.length) {
        txt += `\n\nCOMPTES RENDUS D'APPEL (du plus récent au plus ancien ; ils priment sur le formulaire) :\n` + appels.map(a => `- ${String(a.date).slice(0, 10)} · ${a.libelle || a.resultat}${a.offre ? ` · offre faite ${a.offre} €` : ''}${(a.corrections || []).length ? ` · corrections : ${a.corrections.join(' ; ')}` : ''}${a.texte ? `\n  « ${a.texte} »` : ''}`).join('\n');
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

// Prix max d'achat = revente − remise en état − frais fixes − déplacement − marge (en % du prix de revente, avec un minimum).
function calculer(ia, r, depl) {
    const vente = n(ia.prix_vente_estime && ia.prix_vente_estime.valeur);
    const remise = n(ia.frais_remise_en_etat && ia.frais_remise_en_etat.total);
    const marge = Math.max(n(r.marge_min), Math.round(vente * n(r.marge_pct) / 100));
    const trajet = depl ? n(depl.total) : 0;
    const brut = vente - remise - n(r.frais_fixes) - trajet - marge;
    const arrondi = Math.max(1, n(r.arrondi));
    return {
        prix_vente_estime: vente,
        frais_remise_en_etat: remise,
        frais_fixes: n(r.frais_fixes),
        deplacement: trajet,
        marge,
        prix_max_achat: Math.max(0, Math.floor(brut / arrondi) * arrondi)
    };
}

// Mode marchand : cote marchand (façon vendezvotrevoiture.fr) puis offre LUNICAR un peu au-dessus,
// plafonnée pour garder une marge sur la revente aux professionnels.
function calculerMarchand(ia, r, depl, demande) {
    const x = (demande && demande.data) || {};
    const fiche = x.fiche_api || {};
    const annee = String(fiche.date1erCir_fr || '').slice(-4) || x.annee;
    const retail = n(ia.marche && ia.marche.prix_median_ajuste) || n(ia.leboncoin && ia.leboncoin.prix_median) || n(ia.prix_vente_estime && ia.prix_vente_estime.valeur);
    const fraisMeca = n(ia.frais_remise_en_etat && ia.frais_remise_en_etat.total);
    const cote = coteMarchand.valeurMarchand({ annee, kilometrage: x.kilometrage, mecanique: x.mecanique, carrosserie: x.carrosserie, controle_technique: x.controle_technique }, retail, fraisMeca, r.calage || {});
    const arrondi = Math.max(1, n(r.arrondi));
    const trajet = depl ? n(depl.total) : 0;
    const offreCible = Math.round(cote.valeur * (1 + n(r.prime_pct) / 100) + n(r.prime_eur));
    const revente = cote.valeur + Math.max(n(r.revente_marchand_min), Math.round(cote.valeur * n(r.revente_marchand_pct) / 100));
    const plafond = revente - n(r.frais_fixes_marchand) - trajet - n(r.marge_min_marchand);
    const brut = Math.min(offreCible, plafond);
    const max = Math.max(0, Math.floor(brut / arrondi) * arrondi);
    return {
        mode: 'marchand',
        prix_particulier: retail,
        cote_marchand: cote.valeur,
        cote_detail: cote,
        offre_cible: offreCible,
        plafonne: plafond < offreCible,
        prix_vente_estime: revente,               // revente aux professionnels
        frais_remise_en_etat: 0,                   // vendue en l'état aux pros
        frais_meca_chiffres: fraisMeca,
        frais_fixes: n(r.frais_fixes_marchand),
        deplacement: trajet,
        marge: revente - max - n(r.frais_fixes_marchand) - trajet,
        prix_max_achat: max
    };
}

async function estimer(demande) {
    if (!client) throw new Error('ANTHROPIC_API_KEY non défini : estimation automatique désactivée');
    const r = await reglages();
    const photos = await photosPourClaude(demande);
    const depl0 = await deplacement.calculer(demande, r).catch(() => null);
    const trajet = depl0 ? `\n\nTRAJET pour aller chercher la voiture : départ ${depl0.depart} → ${depl0.arrivee} (${depl0.km} km par la route). Aller en train, retour au volant.` : '';
    const contenu = [...(photos.length ? [{ type: 'text', text: 'Photos du véhicule envoyées par le vendeur :' }, ...photos] : []), ...await diagPourClaude(demande), { type: 'text', text: descriptionDemande(demande) + trajet }];
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
            output_config: { effort: process.env.ESTIMATION_EFFORT || 'high' },
            system: SYSTEM,
            tools: [{
                type: 'web_search_20260209', name: 'web_search', max_uses: n(process.env.ESTIMATION_RECHERCHES) || 20,
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
    // Billet de train relevé par l'IA (hors trajet local), sinon estimation au km.
    let depl = depl0;
    const trainIA = n(ia.deplacement && ia.deplacement.train_aller);
    if (depl && trainIA > 0 && depl.km > n(r.train_local_km)) depl = { ...depl, train: trainIA, train_source: 'prix relevé par l\'IA', total: trainIA + depl.carburant + depl.peages };
    const calcul = r.mode === 'particulier' ? calculer(ia, r, depl) : calculerMarchand(ia, r, depl, demande);
    return {
        ...ia,
        // Les 4 chiffres affichés partout (e-mail, admin)
        prix: {
            max_achat: calcul.prix_max_achat,
            leboncoin: n(ia.marche && ia.marche.prix_median_ajuste) || n(ia.leboncoin && ia.leboncoin.prix_median),
            marche: n(ia.marche && ia.marche.prix_median_ajuste) || n(ia.leboncoin && ia.leboncoin.prix_median),
            reprise_concurrents: n(ia.reprise_concurrents && ia.reprise_concurrents.valeur),
            argus: n(ia.cote_argus && ia.cote_argus.valeur),
            vente_estime: calcul.prix_vente_estime,
            cote_marchand: calcul.cote_marchand || 0,
            fourchette: fourchetteClient.fourchette(calcul.prix_max_achat, r)
        },
        calcul, deplacement_detail: depl, reglages: r, sources: sources.slice(0, 40),
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
// Recalcule le prix d'une estimation déjà faite avec les réglages actuels (sans nouvel appel à l'IA).
async function recalculer(demande, r) {
    const e = demande.estimation;
    if (!e || !e.prix) return null;
    r = r || await reglages();
    const depl = e.deplacement_detail || (e.calcul && e.calcul.deplacement ? { total: e.calcul.deplacement } : null);
    const calcul = r.mode === 'particulier' ? calculer(e, r, depl) : calculerMarchand(e, r, depl, demande);
    return { ...e, calcul, reglages: r, prix: { ...e.prix, max_achat: calcul.prix_max_achat, vente_estime: calcul.prix_vente_estime, cote_marchand: calcul.cote_marchand || 0, fourchette: fourchetteClient.fourchette(calcul.prix_max_achat, r) } };
}

const etat = () => ({ actif: actif(), modele: MODEL, en_cours: [...enCours] });

module.exports = { estimer, planifier, calculer, calculerMarchand, recalculer, reglages, REGLAGES_DEFAUT, etat, actif };
