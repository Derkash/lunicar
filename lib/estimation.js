// Estimation d'une demande de rachat — version 2 (27/10/2026).
// Trois recherches ciblées lancées EN PARALLÈLE (cotes publiées + reprise concurrents · annonces comparables
// La Centrale / Leboncoin / Le Parking · état + attractivité), puis le serveur TRIANGULE les ancrages,
// applique la cote reprise pro (façon vendezvotrevoiture, calée sur nos propres passages) et rédige une
// analyse en cinq lignes qui justifie chaque chiffre. Compte en une minute environ.
const Anthropic = require('@anthropic-ai/sdk');
const deplacement = require('./deplacement');
const store = require('./store');
const coteMarchand = require('./cote-marchand');
const fourchetteClient = require('./fourchette');

const MODEL = process.env.ESTIMATION_MODEL || 'claude-sonnet-5-5';
const actif = () => !!process.env.ANTHROPIC_API_KEY;
const client = actif() ? new Anthropic({ timeout: 2.5 * 60 * 1000, maxRetries: 1 }) : null;

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
    decote_pro_pct: 12,        // annonces de professionnels : garantie, préparation, marge à retirer
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

// ---------------------------------------------------------------- Calage sur nos prix vendezvotrevoiture
// Chaque prix vendezvotrevoiture noté sur une demande (suivi.reference_vvv) corrige la cote reprise pro.
let calibCache = { t: 0, v: null };
async function calibration() {
    if (Date.now() - calibCache.t < 60e3 && calibCache.v) return calibCache.v;
    const r = await store.lireReglage('estimation', {});
    const points = [];
    try {
        for (const d of await store.listerDemandes()) {
            const ref = (d.suivi || {}).reference_vvv, e = d.estimation;
            const retail = e && e.prix && (e.prix.marche || e.prix.leboncoin);
            if (!ref || !n(ref.prix) || !retail) continue;
            const x = d.data || {}, f = x.fiche_api || {};
            points.push({ ref: d.ref, libelle: [x.vehicule, x.annee].filter(Boolean).join(' '), vvv: n(ref.prix), retail: n(retail), fraisMeca: n(e.frais_remise_en_etat && e.frais_remise_en_etat.total),
                d: { annee: String(f.date1erCir_fr || '').slice(-4) || x.annee, kilometrage: x.kilometrage, mecanique: x.mecanique, carrosserie: x.carrosserie, controle_technique: x.controle_technique } });
        }
    } catch (e) { /* sans points, pas de calage */ }
    const c = coteMarchand.calibrer(points, r.calage || {});
    calibCache = { t: Date.now(), v: { ...c, points: points.map(p => ({ ref: p.ref, libelle: p.libelle, vvv: p.vvv, retail: p.retail })) } };
    return calibCache.v;
}
// Réglages + facteur de calage appris : ce que l'estimation et le recalcul utilisent.
async function reglagesCalibres() {
    const r = await reglages(), c = await calibration();
    return { ...r, calage: { ...(r.calage || {}), facteur: c.facteur }, calibration: { nb: c.nb, facteur: c.facteur } };
}

// ---------------------------------------------------------------- Consignes des trois recherches
const CONTEXTE = `Tu es l'acheteur expert de LUNICAR, négociant qui rachète des voitures d'occasion (souvent anciennes ou à fort kilométrage) à des particuliers partout en France et les revend à des professionnels (marchands, enchères B2B, export). Réponds en français, chiffres en euros TTC entiers. N'invente JAMAIS une valeur, une annonce ni une URL : n'indique que ce que tu as réellement vu dans les résultats de recherche ; si tu ne trouves pas, mets 0 ou une liste vide et dis-le. Si le véhicule déclaré par le vendeur et la fiche officielle SIV se contredisent (carburant, motorisation, version), la fiche SIV fait foi.`;

const P_COTES = `${CONTEXTE}

Mission (4 recherches web maximum) : IDENTIFIER précisément la voiture et relever les COTES publiées et les PRIX DE REPRISE des concurrents.
1. Identification : génération, finition, motorisation exacte (cylindrée, puissance), carburant, boîte, carrosserie. Une mauvaise version fausse tout.
2. Cotes publiées : cote La Centrale (lacentrale.fr/cote-auto…), Autoplus, Caradisiac, L'argus si visible gratuitement. Pour chaque cote trouvée : source, valeur, URL, et "precision" = "exacte" si elle porte sur la même version, la même année et un kilométrage proche, sinon "approchee" en précisant dans "detail" sur quoi elle porte (autre version, kilométrage standard…).
3. Ton avis chiffré : le prix auquel CETTE voiture (cette version, cette année, CE kilométrage, en état de rouler) se vend entre particuliers aujourd'hui, d'après ce que tu as vu. Sois réaliste et plutôt prudent sur les forts kilométrages. Toujours un nombre, même approximatif : il sert de repère quand les cotes manquent.
4. Reprise concurrents : ce que proposent les racheteurs professionnels pour ce modèle (vendezvotrevoiture.fr / Auto1, Aramis reprise, Autobiz, La Centrale reprise, Capcar, Carvivo) quand c'est visible : source, valeur, URL. Sinon liste vide.

Termine par UN SEUL bloc \`\`\`json :
{"vehicule_identifie": "string", "generation": "string", "motorisation": "string", "carburant": "string", "boite": "string", "hypotheses": ["string"],
 "cotes": [{"source": "string", "valeur": 0, "url": "string", "precision": "exacte|approchee", "detail": "string"}],
 "valeur_estimee_ia": {"valeur": 0, "justification": "string"},
 "reprise": [{"source": "string", "valeur": 0, "url": "string", "detail": "string"}]}`;

const P_ANNONCES = `${CONTEXTE}

Mission (5 recherches web maximum) : relever les ANNONCES COMPARABLES actuelles — même modèle, motorisation proche, années ±2, kilométrage proche — pour une voiture QUI ROULE, même si celle étudiée est en panne.
Fais OBLIGATOIREMENT une recherche "site:lacentrale.fr", une "site:leboncoin.fr" et une "site:leparking.fr" (agrégateur : ses pages donnent le nombre d'annonces et le prix moyen), puis autoscout24 / paruvendu / aramisauto / autohero si tu manques de points. Les pages de résultats et de statistiques comptent : « X annonces de A à B €, prix moyen C € » → rapporte-les dans "stats_sources".
Pour chaque annonce individuelle vue : prix, année, km, version, vendeur (particulier|pro), source, URL.
Ajuste chaque prix à la voiture étudiée avant de comparer (kilométrage : 3 à 6 % du prix par 20 000 km d'écart selon la gamme ; année : 5 à 10 % par an ; version et options), écarte les aberrations (épaves, prix d'appel), puis donne la médiane ajustée des PARTICULIERS et celle des PROFESSIONNELS (prix affichés, sans retirer la marge pro : le serveur s'en charge). Si tu n'as que des statistiques de pages (prix moyen), utilise-les pour la médiane en le disant dans "commentaire".

Termine par UN SEUL bloc \`\`\`json :
{"annonces": [{"titre": "string", "prix": 0, "prix_ajuste": 0, "annee": 0, "km": 0, "vendeur": "particulier|pro", "source": "lacentrale|leboncoin|leparking|autoscout24|paruvendu|aramis|autohero|autre", "url": "string"}],
 "stats_sources": [{"source": "string", "nb_annonces": 0, "prix_bas": 0, "prix_moyen": 0, "prix_haut": 0, "url": "string"}],
 "nb_annonces": 0, "mediane_particulier_ajustee": 0, "mediane_pro_ajustee": 0, "prix_bas": 0, "prix_haut": 0,
 "dispersion": "serree|moyenne|forte", "anciennete": "string (annonces anciennes, baisses de prix… ou « non observé »)", "commentaire": "string (sur quoi reposent les médianes, ajustements faits)"}`;

const P_ETAT = `${CONTEXTE}

Mission : chiffrer l'ÉTAT de la voiture et juger sa REVENTE. Recherche web seulement si nécessaire (3 maximum : pannes connues de cette motorisation, prix d'un billet de train si un trajet est indiqué).
1. Remise en état d'après l'état déclaré, les photos, et SURTOUT le diagnostic LUNICAR s'il est fourni (il prime sur la déclaration du vendeur) : pour chaque code défaut visible (P0xxx, P1xxx, Cxxxx, Bxxxx, Uxxxx), signification probable POUR CE MOTEUR, gravité, coût réaliste en garage indépendant ; distingue défaut ponctuel / capteur et panne lourde. Postes concrets et chiffrés (embrayage, distribution, pneus, élément de carrosserie…). Si des comptes rendus d'appel sont fournis, ce que le vendeur a dit au téléphone prime sur le formulaire.
2. Canal de revente le plus réaliste pour un négociant qui revend aux pros.
3. Attractivité à la revente, score 0-100 (75 et plus = se revend vite, acheter ; 50-74 = vendable à prix serré ; moins de 50 = éviter sauf prix très bas) : demande pour ce modèle, réputation de fiabilité et coûts d'entretien connus, Crit'Air / ZFE si Île-de-France, boîte, gabarit, saisonnalité. Facteurs + et − concrets, observés ; « non observé » plutôt qu'un chiffre inventé.
4. Points d'attention et 3 questions maximum à poser au vendeur pour affiner.
5. Train : si un TRAJET est indiqué, prix d'un aller simple 2de classe réservé quelques jours avant (SNCF Connect, Trainline, Ouigo) ; 0 si introuvable.

Termine par UN SEUL bloc \`\`\`json :
{"frais_remise_en_etat": {"total": 0, "postes": [{"libelle": "string", "montant": 0}]},
 "canal_revente": "reparer_revendre|en_l_etat_marchand|export|pieces",
 "diagnostic": {"codes": [{"code": "string", "signification": "string", "gravite": "faible|moyenne|forte", "cout_estime": 0}], "synthese": "string (vide si aucun diagnostic fourni)"},
 "attractivite": {"score": 0, "verdict": "acheter|prix_serre|eviter", "delai_revente": "rapide|moyen|lent", "delai_commentaire": "string", "demande": {"tendance": "hausse|stable|baisse|non_observee", "commentaire": "string"}, "facteurs_plus": ["string"], "facteurs_moins": ["string"], "contexte_idf": "string", "confiance": "faible|moyenne|bonne", "resume": "string (1 phrase)"},
 "points_attention": ["string"], "questions_a_poser": ["string"], "deplacement": {"train_aller": 0, "source": "string"}}`;

// ---------------------------------------------------------------- Description de la demande
function descriptionDemande(d) {
    const x = d.data || {};
    const fiche = x.fiche_api || null;
    const lignes = [
        ['Véhicule déclaré', x.vehicule], ['Finition', x.finition], ['Motorisation', x.motorisation], ['Année', x.annee], ['Kilométrage', x.kilometrage && `${x.kilometrage} km`],
        ['Plaque', x.plaque], ['Datation de la plaque', x.plaque_datation], ['Fiche confirmée par le vendeur', x.fiche_confirmee],
        ['État mécanique', x.mecanique || (x.etat || []).join(', ')], ['Carrosserie', x.carrosserie],
        ['Organes en cause', x.organes_defaillants], ['Nature de la panne', x.nature_panne], ['Déplaçable sans dépanneuse', x.deplacable],
        ['Voyant allumé au tableau de bord', x.voyant], ['Défauts de carrosserie', x.degats],
        ['Contrôle technique', x.controle_technique], ['Clés', x.cles], ['Carnet / factures d\'entretien', x.carnet],
        ['Première main', x.premiere_main], ['Importée', x.importee], ['Crédit / LOA / LLD en cours', x.financement],
        ['Prix souhaité par le vendeur', x.prix_souhaite && `${x.prix_souhaite} €`],
        ['Délai de vente', x.delai], ['Localisation', [x.code_postal, x.ville].filter(Boolean).join(' ')],
        ['Message du vendeur', x.message],
        ['Carburant', x.carburant], ['Boîte', x.boite], ['Extérieur', x.etat_exterieur], ['Intérieur', x.etat_interieur]
    ].filter(([, v]) => v).map(([k, v]) => `- ${k} : ${v}`);
    const diag = (d.suivi || {}).diagnostic || {};
    const appels = ((d.suivi || {}).appels || []).filter(a => a.texte || (a.corrections || []).length).slice(0, 5);
    let txt = `Demande de rachat reçue le ${String(d.created_at).slice(0, 10)}.\n${lignes.join('\n')}`;
    if (fiche) {
        const ignores = /^(erreur|logo|photo|tecdoc|k_type|sra|code_|liste_|pneus|collection)/i;
        const f = Object.entries(fiche).filter(([k, v]) => !ignores.test(k) && v !== null && v !== '' && typeof v !== 'object').slice(0, 40).map(([k, v]) => `- ${k} : ${v}`);
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
    for (const p of (d.photos || []).filter(p => /\.(jpe?g|png|webp)$/i.test(p.name) && !/carte-grise/.test(p.name)).slice(0, 4)) {
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
const mediane = a => { const l = a.filter(v => v > 0).sort((p, q) => p - q); return l.length ? (l.length % 2 ? l[(l.length - 1) / 2] : Math.round((l[l.length / 2 - 1] + l[l.length / 2]) / 2)) : 0; };
const eur = v => `${Math.round(n(v)).toLocaleString('fr-FR')} €`;

// Un appel Claude avec recherche web ; une recherche longue peut rendre la main en « pause_turn ».
async function appel(system, contenu, maxRecherches, usage, sources) {
    const messages = [{ role: 'user', content: contenu }];
    let resp;
    for (let tour = 0; tour < 3; tour++) {
        resp = await client.beta.messages.create({
            model: MODEL, max_tokens: 6000,
            betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
            thinking: { type: 'adaptive' }, output_config: { effort: process.env.ESTIMATION_EFFORT || 'medium' },
            system,
            tools: maxRecherches ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxRecherches, user_location: { type: 'approximate', country: 'FR', timezone: 'Europe/Paris' } }] : undefined,
            messages
        });
        usage.input_tokens += resp.usage.input_tokens || 0;
        usage.output_tokens += resp.usage.output_tokens || 0;
        usage.recherches += (resp.usage.server_tool_use && resp.usage.server_tool_use.web_search_requests) || 0;
        for (const b of resp.content) if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(s => s.url && !sources.some(x => x.url === s.url) && sources.push({ titre: s.title, url: s.url }));
        if (resp.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: resp.content });
    }
    if (resp.stop_reason === 'refusal') throw new Error('Estimation refusée par le modèle');
    return { ia: extraireJSON(resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n')), modele: resp.model };
}

// ---------------------------------------------------------------- Calculs
// Prix max d'achat = revente − remise en état − frais fixes − déplacement − marge (en % du prix de revente, avec un minimum).
function calculer(ia, r, depl) {
    const vente = n(ia.prix_vente_estime && ia.prix_vente_estime.valeur) || n(ia.marche && ia.marche.prix_median_ajuste);
    const remise = n(ia.frais_remise_en_etat && ia.frais_remise_en_etat.total);
    const marge = Math.max(n(r.marge_min), Math.round(vente * n(r.marge_pct) / 100));
    const trajet = depl ? n(depl.total) : 0;
    const brut = vente - remise - n(r.frais_fixes) - trajet - marge;
    const arrondi = Math.max(1, n(r.arrondi));
    return { prix_vente_estime: vente, frais_remise_en_etat: remise, frais_fixes: n(r.frais_fixes), deplacement: trajet, marge, prix_max_achat: Math.max(0, Math.floor(brut / arrondi) * arrondi) };
}

// Mode marchand : cote reprise pro (façon vendezvotrevoiture.fr) puis offre LUNICAR un peu au-dessus,
// plafonnée pour garder une marge sur la revente aux professionnels.
function calculerMarchand(ia, r, depl, demande) {
    const x = (demande && demande.data) || {};
    const fiche = x.fiche_api || {};
    const annee = String(fiche.date1erCir_fr || '').slice(-4) || x.annee;
    const retail = n(ia.marche && ia.marche.prix_median_ajuste) || n(ia.leboncoin && ia.leboncoin.prix_median) || n(ia.prix_vente_estime && ia.prix_vente_estime.valeur);
    if (!retail) throw new Error('Aucune annonce comparable ni cote trouvée : estimation à refaire à la main');
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
        mode: 'marchand', prix_particulier: retail, cote_marchand: cote.valeur, cote_detail: cote, offre_cible: offreCible, plafonne: plafond < offreCible,
        prix_vente_estime: revente, frais_remise_en_etat: 0, frais_meca_chiffres: fraisMeca, frais_fixes: n(r.frais_fixes_marchand), deplacement: trajet,
        marge: revente - max - n(r.frais_fixes_marchand) - trajet, prix_max_achat: max
    };
}

// Triangulation des ancrages : cotes publiées, médiane particuliers, annonces pro (moins leur marge).
// Chaque ancrage est pesé selon sa solidité ; la confiance vient de leur accord.
function trianguler(C, A, r, demande) {
    const x = (demande && demande.data) || {}, km = n(x.kilometrage);
    const cotes = (C.cotes || []).map(c => ({ source: String(c.source || '').slice(0, 60), valeur: n(c.valeur), url: c.url, precision: c.precision === 'exacte' ? 'exacte' : 'approchee', detail: c.detail })).filter(c => c.valeur > 0);
    const nbAnn = Math.max(n(A.nb_annonces), (A.annonces || []).length, ...(A.stats_sources || []).map(s => n(s.nb_annonces)));
    // Annonces de particuliers : la médiane des prix AJUSTÉS relevés fait foi (plus fiable que le chiffre annoncé par l'IA).
    const part = (A.annonces || []).filter(a => a.vendeur !== 'pro').map(a => n(a.prix_ajuste) || n(a.prix)).filter(v => v > 0);
    const medPart = part.length >= 3 ? mediane(part) : (n(A.mediane_particulier_ajustee) || mediane(part) || mediane((A.stats_sources || []).map(s => n(s.prix_moyen))));
    const medProAff = n(A.mediane_pro_ajustee) || mediane((A.annonces || []).filter(a => a.vendeur === 'pro').map(a => n(a.prix_ajuste) || n(a.prix)));
    const medPro = Math.round(medProAff * (1 - n(r.decote_pro_pct) / 100));
    const anc = [], alertes = [];
    const coteExacte = cotes.filter(c => c.precision === 'exacte'), coteV = mediane((coteExacte.length ? coteExacte : cotes).map(c => c.valeur));
    if (coteV) anc.push({ cle: 'cote', libelle: 'Cote publiée', valeur: coteV, poids: coteExacte.length ? 1.3 : 0.6, detail: cotes.map(c => `${c.source} ${eur(c.valeur)}${c.precision === 'approchee' ? ' (approchée)' : ''}`).join(' · '), url: (coteExacte[0] || cotes[0]).url });
    if (medPart) anc.push({ cle: 'particuliers', libelle: 'Annonces particuliers', valeur: medPart, poids: nbAnn >= 5 && part.length >= 3 ? 1 : nbAnn >= 2 ? 0.6 : 0.3, detail: `${nbAnn || '?'} annonce${nbAnn > 1 ? 's' : ''} · ${(A.stats_sources || []).map(s => s.source).concat([...new Set((A.annonces || []).map(a => a.source))]).filter((v, i, l) => v && l.indexOf(v) === i).join(', ') || 'sources non précisées'}`, url: ((A.stats_sources || [])[0] || (A.annonces || [])[0] || {}).url });
    if (medPro) anc.push({ cle: 'pros', libelle: 'Annonces pros', valeur: medPro, poids: 0.5, detail: `${eur(medProAff)} affichés − ${n(r.decote_pro_pct)} % de marge pro`, url: ((A.annonces || []).find(a => a.vendeur === 'pro') || {}).url });
    const ia = n(C.valeur_estimee_ia && C.valeur_estimee_ia.valeur);
    // Garde-fou : un ancrage qui s'écarte de plus de 45 % de la cote exacte (annonces de voitures plus récentes,
    // moins kilométrées…) est fortement minoré et signalé.
    if (coteExacte.length) for (const a of anc) if (a.cle !== 'cote' && Math.abs(a.valeur - coteV) / coteV > 0.45) { a.poids = Math.min(a.poids, 0.2); a.douteux = true; alertes.push(`${a.libelle.toLowerCase()} (${eur(a.valeur)}) très loin de la cote (${eur(coteV)}) : minoré`); }
    // Aucune cote ni annonce : on se positionne quand même sur l'avis chiffré de l'IA, en confiance faible.
    if (!anc.length && ia) anc.push({ cle: 'ia', libelle: 'Avis chiffré (sans comparable)', valeur: ia, poids: 0.3, detail: String((C.valeur_estimee_ia || {}).justification || '').slice(0, 160) });
    const reprise = (C.reprise || []).map(c => ({ source: String(c.source || '').slice(0, 60), valeur: n(c.valeur), url: c.url, detail: c.detail })).filter(c => c.valeur > 0);
    if (!anc.length) throw new Error('Aucune cote, aucune annonce ni avis chiffré : estimation à refaire à la main');
    // Prix retenu PRUDENT : la plus basse entre la moyenne pondérée et la médiane des ancrages fiables.
    const fiables = anc.filter(a => !a.douteux);
    const moy = Math.round(anc.reduce((t, a) => t + a.valeur * a.poids, 0) / anc.reduce((t, a) => t + a.poids, 0));
    const med = mediane((fiables.length ? fiables : anc).map(a => a.valeur));
    let prixMarche = Math.min(moy, med || moy);
    // Fort kilométrage non reflété par les comparables : plafond prudent si l'avis de l'IA est nettement plus bas.
    if (ia && km >= 200000 && ia < prixMarche * 0.8) { alertes.push(`fort kilométrage (${Math.round(km / 1000)} 000 km) : prix ramené vers l'avis chiffré ${eur(ia)}`); prixMarche = Math.round((prixMarche + ia) / 2); }
    const vals = fiables.map(a => a.valeur), ecart = vals.length > 1 ? (Math.max(...vals) - Math.min(...vals)) / Math.min(...vals) : 0;
    const confiance = anc.some(a => a.cle === 'ia') ? 'faible' : fiables.length >= 2 && ecart <= 0.15 && nbAnn >= 5 ? 'bonne' : (fiables.length >= 2 && ecart <= 0.3) || (fiables.length === 1 && nbAnn >= 5) ? 'moyenne' : 'faible';
    return { ancrages: anc, cotes, reprise, prix_marche: prixMarche, ecart: Math.round(ecart * 100), confiance, nb_annonces: nbAnn, med_particulier: medPart, med_pro: medPro, med_pro_affiche: medProAff, alertes, avis_ia: ia };
}

// Où se situe le prix demandé par le vendeur, façon « indicateur prix » des sites d'annonces.
function positionPrix(souhaite, marche) {
    souhaite = n(souhaite); marche = n(marche);
    if (!souhaite || !marche) return null;
    const r = souhaite / marche;
    const niveau = r <= 0.8 ? 'tres_bonne' : r <= 0.92 ? 'bonne' : r <= 1.08 ? 'marche' : 'au_dessus';
    return { niveau, libelle: { tres_bonne: 'Très bonne affaire', bonne: 'Bonne affaire', marche: 'Prix du marché', au_dessus: 'Au-dessus du marché' }[niveau], ecart_pct: Math.round((r - 1) * 100) };
}

// L'analyse : cinq lignes qui justifient les chiffres (véhicule, marché, état, offre, pourquoi).
function rediger(d, C, A, E, T, calcul, r, depl, fourch) {
    const x = d.data || {}, att = E.attractivite || {}, cd = calcul.cote_detail || {}, et = cd.etat || {};
    const L = [];
    L.push({ t: 'Véhicule', s: `${C.vehicule_identifie || x.vehicule || '?'}${C.motorisation && !String(C.vehicule_identifie || '').includes(C.motorisation) ? ` · ${C.motorisation}` : ''}${x.kilometrage ? ` · ${Number(x.kilometrage).toLocaleString('fr-FR')} km` : ''}${(C.hypotheses || []).length ? ` — hypothèse : ${C.hypotheses[0]}` : ''}` });
    const parts = T.ancrages.map(a => `${a.libelle.toLowerCase()} ${eur(a.valeur)}${a.cle === 'particuliers' ? ` (${T.nb_annonces || '?'} annonces${A.dispersion ? ', dispersion ' + A.dispersion : ''})` : a.cle === 'cote' ? ` (${T.cotes.map(c => c.source).join(', ')})` : ''}`);
    L.push({ t: 'Marché', s: `${parts.join(' ; ')} → prix de marché retenu (prudent) ${eur(T.prix_marche)}, confiance ${T.confiance}${T.ecart > 25 ? ` (les sources s'écartent de ${T.ecart} % : à vérifier)` : ''}${(T.alertes || []).length ? ' · ' + T.alertes.join(' · ') : ''}.` });
    const etatTxt = et.meca === 'panne' ? 'ne roule plus' : et.meca === 'accident' ? 'accidentée' : et.meca === 'soucis' ? 'roule avec des soucis' : 'roule sans souci déclaré';
    const frais = n(E.frais_remise_en_etat && E.frais_remise_en_etat.total), postes = ((E.frais_remise_en_etat || {}).postes || []).slice(0, 3).map(p => `${p.libelle} ${eur(p.montant)}`).join(', ');
    L.push({ t: 'État', s: `${etatTxt}${et.ct_expire ? ', CT pas à jour' : ''}${et.carro && et.carro !== 'tbe' ? ', carrosserie ' + (et.carro === 'abimee' ? 'abîmée' : 'rayée') : ''} → ${frais ? `${eur(frais)} de remise en état (${postes})` : 'pas de frais chiffrés'} ; cote reprise pro ${eur(calcul.cote_marchand)} (${Math.round((cd.coef_global || 0) * 100)} % du marché${T.reprise.length ? ` ; reprise constatée ${T.reprise.map(p => `${p.source} ${eur(p.valeur)}`).join(', ')}` : ''}${r.calibration && r.calibration.nb >= 2 ? ` ; calée sur ${r.calibration.nb} de nos voitures` : ''}).` });
    L.push({ t: 'Offre', s: `${fourch ? `${eur(fourch.min)} – ${eur(fourch.max)} au vendeur` : eur(calcul.prix_max_achat)} (max ${eur(calcul.prix_max_achat)}${calcul.plafonne ? ', plafonné par la marge' : ''}) ; revente aux pros ≈ ${eur(calcul.prix_vente_estime)}, marge ≈ ${eur(calcul.marge)}${depl ? `, trajet ${eur(depl.total)} (${depl.km} km)` : ''}${x.prix_souhaite ? ` ; il demande ${eur(x.prix_souhaite)}${n(x.prix_souhaite) > calcul.prix_max_achat ? ` (${eur(n(x.prix_souhaite) - calcul.prix_max_achat)} au-dessus)` : ' (dans notre fourchette)'}` : ''}.` });
    const plus = (att.facteurs_plus || [])[0], moins = (att.facteurs_moins || [])[0], q = (E.questions_a_poser || []).slice(0, 2);
    L.push({ t: 'Pourquoi', s: `attractivité ${att.score != null ? att.score + '/100' : '?'} (${{ acheter: 'à acheter', prix_serre: 'à prix serré', eviter: 'à éviter' }[att.verdict] || '?'}${att.delai_revente ? `, revente ${{ rapide: 'rapide', moyen: 'moyenne', lent: 'lente' }[att.delai_revente]}` : ''})${plus ? ` ; + ${plus}` : ''}${moins ? ` ; − ${moins}` : ''}${q.length ? `. À demander : ${q.join(' ; ')}` : ''}.` });
    return L;
}

// ---------------------------------------------------------------- Estimation complète
async function estimer(demande) {
    if (!client) throw new Error('ANTHROPIC_API_KEY non défini : estimation automatique désactivée');
    const r = await reglagesCalibres();
    const t0 = Date.now();
    const depl0 = await deplacement.calculer(demande, r).catch(() => null);
    const trajet = depl0 ? `\n\nTRAJET pour aller chercher la voiture : départ ${depl0.depart} → ${depl0.arrivee} (${depl0.km} km par la route). Aller en train, retour au volant.` : '';
    const desc = descriptionDemande(demande);
    const photos = await photosPourClaude(demande);
    const etatContenu = [...(photos.length ? [{ type: 'text', text: 'Photos du véhicule envoyées par le vendeur :' }, ...photos] : []), ...await diagPourClaude(demande), { type: 'text', text: desc + trajet }];
    const usage = { input_tokens: 0, output_tokens: 0, recherches: 0 }, sources = [];
    const maxR = n(process.env.ESTIMATION_RECHERCHES);   // total facultatif, réparti 4 / 5 / 3
    const part = (k, def) => maxR ? Math.max(1, Math.round(maxR * k)) : def;
    const [rc, ra, re] = await Promise.allSettled([
        appel(P_COTES, [{ type: 'text', text: desc }], part(0.33, 4), usage, sources),
        appel(P_ANNONCES, [{ type: 'text', text: desc }], part(0.42, 5), usage, sources),
        appel(P_ETAT, etatContenu, part(0.25, 3), usage, sources)
    ]);
    const erreurs = [rc, ra, re].filter(x => x.status === 'rejected').map(x => x.reason && x.reason.message);
    if (rc.status === 'rejected' && ra.status === 'rejected') throw new Error('Recherches de prix échouées : ' + erreurs.join(' / '));
    const C = rc.status === 'fulfilled' ? rc.value.ia : { cotes: [], reprise: [], hypotheses: [] };
    const A = ra.status === 'fulfilled' ? ra.value.ia : { annonces: [], stats_sources: [] };
    const E = re.status === 'fulfilled' ? re.value.ia : { frais_remise_en_etat: { total: 0, postes: [] }, attractivite: null, questions_a_poser: [], points_attention: [] };
    const T = trianguler(C, A, r, demande);
    if (E.attractivite) {
        const a = E.attractivite;
        a.score = Math.max(0, Math.min(100, n(a.score)));
        if (!['acheter', 'prix_serre', 'eviter'].includes(a.verdict)) a.verdict = a.score >= 75 ? 'acheter' : a.score >= 50 ? 'prix_serre' : 'eviter';
        a.offre = { nb_annonces_comparables: T.nb_annonces, anciennete: A.anciennete || 'non observé', dispersion_prix: A.dispersion || 'moyenne' };
    }
    // Billet de train relevé par l'IA (hors trajet local), sinon estimation au km.
    let depl = depl0;
    const trainIA = n(E.deplacement && E.deplacement.train_aller);
    if (depl && trainIA > 0 && depl.km > n(r.train_local_km)) depl = { ...depl, train: trainIA, train_source: 'prix relevé par l\'IA', total: trainIA + depl.carburant + depl.peages };
    // Objet « ia » au format historique, pour les calculs et le recalcul.
    const ia = {
        vehicule_identifie: C.vehicule_identifie || '', generation: C.generation || '', motorisation: C.motorisation || '', hypotheses: C.hypotheses || [],
        annonces: (A.annonces || []).slice(0, 30), stats_sources: A.stats_sources || [],
        marche: { nb_annonces: T.nb_annonces, prix_bas: n(A.prix_bas), prix_median_ajuste: T.prix_marche, prix_haut: n(A.prix_haut), dispersion: A.dispersion || '', sources: T.ancrages.map(a => a.libelle), commentaire: A.commentaire || '', median_particuliers: T.med_particulier, median_pros: T.med_pro },
        cote_argus: T.cotes[0] ? { valeur: T.cotes[0].valeur, source: T.cotes[0].source, commentaire: T.cotes[0].detail || '' } : { valeur: 0, source: '', commentaire: '' },
        cotes: T.cotes, reprise_concurrents: T.reprise[0] ? { valeur: mediane(T.reprise.map(p => p.valeur)), source: T.reprise.map(p => p.source).join(', '), commentaire: T.reprise.map(p => p.detail).filter(Boolean).join(' · ') } : { valeur: 0, source: '', commentaire: '' },
        canal_revente: E.canal_revente || 'en_l_etat_marchand', frais_remise_en_etat: E.frais_remise_en_etat || { total: 0, postes: [] }, diagnostic: E.diagnostic || null,
        confiance: T.confiance, points_attention: E.points_attention || [], questions_a_poser: E.questions_a_poser || [], attractivite: E.attractivite || null,
        ancrages: T.ancrages, ecart_sources: T.ecart, erreurs_partielles: erreurs, alertes: T.alertes, avis_ia: T.avis_ia,
        position_prix: positionPrix((demande.data || {}).prix_souhaite, T.prix_marche)
    };
    ia.prix_vente_estime = { valeur: T.prix_marche, commentaire: 'prix de marché triangulé' };
    const calcul = r.mode === 'particulier' ? calculer(ia, r, depl) : calculerMarchand(ia, r, depl, demande);
    const fourch = fourchetteClient.fourchette(calcul.prix_max_achat, r, (demande.data || {}).prix_souhaite);
    const analyse = rediger(demande, C, A, E, T, calcul, r, depl, fourch);
    return {
        ...ia, analyse, resume: analyse.map(l => `${l.t} : ${l.s}`).join('\n'),
        prix: {
            max_achat: calcul.prix_max_achat, leboncoin: T.med_particulier || T.prix_marche, marche: T.prix_marche,
            reprise_concurrents: n(ia.reprise_concurrents.valeur), argus: n(ia.cote_argus.valeur),
            vente_estime: calcul.prix_vente_estime, cote_marchand: calcul.cote_marchand || 0, fourchette: fourch
        },
        calcul, deplacement_detail: depl, reglages: r, sources: sources.slice(0, 40), version: 2,
        modele: (rc.value || ra.value || re.value || {}).modele || MODEL, duree_s: Math.round((Date.now() - t0) / 1000), usage,
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
            // On relit le suivi (appels, RDV, notes saisis entre-temps) plutôt que de réécrire la copie lue au départ.
            const frais = await store.lireDemande(ref).catch(() => null) || d;
            const maj = await store.majDemande(ref, { estimation: est, estimation_at: est.date, suivi: { ...frais.suivi, estimation_statut: 'ok', estimation_erreur: null } });
            console.log(`💶 Estimation ${ref} : max ${est.prix.max_achat} € · marché ${est.prix.marche} € · confiance ${est.confiance} (${est.duree_s} s, ${est.usage.recherches} recherches)`);
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
    r = r || await reglagesCalibres();
    const depl = e.deplacement_detail || (e.calcul && e.calcul.deplacement ? { total: e.calcul.deplacement } : null);
    const calcul = r.mode === 'particulier' ? calculer(e, r, depl) : calculerMarchand(e, r, depl, demande);
    return { ...e, calcul, reglages: r, prix: { ...e.prix, max_achat: calcul.prix_max_achat, vente_estime: calcul.prix_vente_estime, cote_marchand: calcul.cote_marchand || 0, fourchette: fourchetteClient.fourchette(calcul.prix_max_achat, r, (demande.data || {}).prix_souhaite) } };
}

const etat = () => ({ actif: actif(), modele: MODEL, en_cours: [...enCours] });

module.exports = { positionPrix, estimer, planifier, calculer, calculerMarchand, trianguler, recalculer, reglages, reglagesCalibres, calibration, REGLAGES_DEFAUT, etat, actif };
