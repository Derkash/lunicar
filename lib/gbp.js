// Fiche Google Business Profile de LUNICAR : avis (lecture, réponse), statistiques, publications, infos de la fiche.
// Passe par les API Google Business Profile avec un jeton OAuth du compte propriétaire de la fiche (scope business.manage).
//
// Configuration (Render) : GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN (créés par `node tools/gbp/auth.js`),
// GBP_LOCATION facultatif (« locations/123… », sinon la première fiche dont le nom contient LUNICAR).
// En local, à défaut des variables : secrets/google/token-gbp.json.
//
// Accès API : Google ne l'ouvre qu'aux fiches validées depuis au moins 60 jours (fiche validée le 22/11/2026 →
// demande possible à partir du 21/01/2027 sur https://support.google.com/business/contact/api_default).
// Tant que le quota est à 0, chaque appel répond 429 : l'état passe à « en_attente » et l'admin l'affiche.
const fs = require('fs');
const path = require('path');
const store = require('./store');

const DEMANDE_ACCES_DES = '2027-01-21';
const FORMULAIRE_ACCES = 'https://support.google.com/business/contact/api_default';
const LIEN_AVIS = 'https://g.page/r/CcBIBePt41KGEBM/review';
const GESTIONNAIRE = 'https://business.google.com/locations';
const FICHIER_JETON = path.join(__dirname, '..', 'secrets', 'google', 'token-gbp.json');

function identifiants() {
    if (process.env.GBP_REFRESH_TOKEN) return { client_id: process.env.GBP_CLIENT_ID, client_secret: process.env.GBP_CLIENT_SECRET, refresh_token: process.env.GBP_REFRESH_TOKEN };
    try { const d = JSON.parse(fs.readFileSync(FICHIER_JETON, 'utf8')); if (d.refresh_token) return d; } catch (e) { /* pas de fichier */ }
    return null;
}
const configure = () => !!identifiants();

let acces = null; // { token, expire }
async function jeton() {
    if (acces && acces.expire > Date.now() + 60e3) return acces.token;
    const id = identifiants();
    if (!id) throw erreur('non_configure', 'Jeton Google Business absent : lancer node tools/gbp/auth.js puis renseigner GBP_* sur Render.');
    const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: id.client_id, client_secret: id.client_secret, refresh_token: id.refresh_token, grant_type: 'refresh_token' })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw erreur('jeton_invalide', `Jeton Google refusé (${j.error || r.status}) : relancer node tools/gbp/auth.js.`);
    acces = { token: j.access_token, expire: Date.now() + (j.expires_in || 3600) * 1000 };
    return acces.token;
}

function erreur(code, message, status = 503) { return Object.assign(new Error(message), { code, status }); }

async function appel(url, { method = 'GET', body } = {}) {
    const r = await fetch(url, {
        method, headers: { Authorization: 'Bearer ' + await jeton(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    const t = await r.text();
    let j = {}; try { j = t ? JSON.parse(t) : {}; } catch (e) { j = { brut: t }; }
    if (r.ok) return j;
    const msg = (j.error && j.error.message) || t.slice(0, 200);
    // Quota à 0 (accès pas encore accordé) ou API non activée sur le projet : même cause côté utilisateur.
    if (r.status === 429 || /quota|has not been used|is disabled/i.test(msg)) throw erreur('en_attente', 'Accès API Google Business pas encore accordé.');
    if (r.status === 401) { acces = null; throw erreur('jeton_invalide', 'Jeton Google expiré ou révoqué : relancer node tools/gbp/auth.js.'); }
    throw erreur('erreur', `Google ${r.status} : ${msg}`, r.status >= 500 ? 502 : 400);
}

// Compte et fiche : résolus une fois puis gardés en réglage (évite deux appels à chaque écran).
let fiche = null; // { compte: 'accounts/…', lieu: 'locations/…', titre }
async function lieu() {
    if (fiche) return fiche;
    const memo = await store.lireReglage('gbp_fiche', null);
    if (memo && memo.compte && memo.lieu && (!process.env.GBP_LOCATION || memo.lieu === process.env.GBP_LOCATION)) return (fiche = memo);
    const comptes = (await appel('https://mybusinessaccountmanagement.googleapis.com/v1/accounts')).accounts || [];
    for (const c of comptes) {
        let page = '';
        do {
            const j = await appel(`https://mybusinessbusinessinformation.googleapis.com/v1/${c.name}/locations?readMask=name,title&pageSize=100${page ? '&pageToken=' + page : ''}`);
            const l = (j.locations || []).find(x => process.env.GBP_LOCATION ? x.name === process.env.GBP_LOCATION : /lunicar/i.test(x.title || ''));
            if (l) { fiche = { compte: c.name, lieu: l.name, titre: l.title }; await store.ecrireReglage('gbp_fiche', fiche); return fiche; }
            page = j.nextPageToken || '';
        } while (page);
    }
    throw erreur('erreur', 'Aucune fiche LUNICAR trouvée sur ce compte Google : le jeton doit venir du compte propriétaire ou gestionnaire de la fiche.', 404);
}
const cheminV4 = f => `https://mybusiness.googleapis.com/v4/${f.compte}/${f.lieu}`;

// État affiché en tête de l'écran Google Business de l'admin.
async function etat() {
    const base = { configure: configure(), demande_acces_des: DEMANDE_ACCES_DES, formulaire: FORMULAIRE_ACCES, lien_avis: LIEN_AVIS, gestionnaire: GESTIONNAIRE };
    if (!base.configure) return { ...base, acces: 'non_configure' };
    try { const f = await lieu(); return { ...base, acces: 'ok', fiche: f.titre }; }
    catch (e) { return { ...base, acces: e.code || 'erreur', message: e.message }; }
}

// ---------- Avis ----------
const NOTE = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
function avisPropre(a) {
    return {
        id: a.reviewId, note: NOTE[a.starRating] || 0, auteur: (a.reviewer && a.reviewer.displayName) || 'Anonyme',
        texte: a.comment ? a.comment.replace(/\s*\(Translated by Google\)[\s\S]*$/, '').replace(/^\(Original\)\s*/, '') : '',
        date: a.createTime, reponse: a.reviewReply ? { texte: a.reviewReply.comment, date: a.reviewReply.updateTime } : null
    };
}
async function avis() {
    const f = await lieu(), liste = [];
    let page = '', resume = {};
    do {
        const j = await appel(`${cheminV4(f)}/reviews?pageSize=50&orderBy=updateTime%20desc${page ? '&pageToken=' + page : ''}`);
        resume = { moyenne: j.averageRating || 0, total: j.totalReviewCount || 0 };
        liste.push(...(j.reviews || []).map(avisPropre));
        page = j.nextPageToken || '';
    } while (page && liste.length < 200);
    return { ...resume, sans_reponse: liste.filter(a => !a.reponse).length, avis: liste };
}
async function repondre(id, texte) {
    texte = String(texte || '').trim();
    if (!texte) throw erreur('erreur', 'Réponse vide.', 400);
    if (texte.length > 4000) throw erreur('erreur', 'Réponse trop longue (4 000 caractères au maximum).', 400);
    verifierTexte(texte);
    const f = await lieu();
    return appel(`${cheminV4(f)}/reviews/${encodeURIComponent(id)}/reply`, { method: 'PUT', body: { comment: texte } });
}
async function supprimerReponse(id) {
    const f = await lieu();
    return appel(`${cheminV4(f)}/reviews/${encodeURIComponent(id)}/reply`, { method: 'DELETE' });
}

// Garde-fous sur tout texte publié sur la fiche (réponses, publications) : règles LUNICAR.
function verifierTexte(t) {
    const interdits = [
        [/yak/i, 'YAK SERVICES ne doit jamais apparaître'],
        [/optimerch/i, 'OPTIMERCH seulement dans les mentions légales'],
        [/valable\s+7\s+jours/i, 'jamais « valable 7 jours »'],
        [/bas[ée]s?\s+à\s+paris|on se déplace/i, 'jamais « basé à Paris » ni « on se déplace »']
    ];
    // Mots propres à l'entreprise (adresse du siège…) : variable GBP_MOTS_INTERDITS, séparés par des virgules, hors du dépôt public.
    for (const m of String(process.env.GBP_MOTS_INTERDITS || '').split(',').map(s => s.trim()).filter(Boolean)) interdits.push([new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `« ${m} » ne doit pas apparaître`]);
    for (const [re, raison] of interdits) if (re.test(t)) throw erreur('erreur', `Texte refusé : ${raison}.`, 400);
}

// Proposition de réponse par Claude : l'admin relit, modifie, puis publie. Jamais publié automatiquement.
const REGLES = `Règles LUNICAR, à respecter strictement :
- LUNICAR rachète les voitures de particuliers partout en France (toutes marques, anciennes ou à fort kilométrage), formulaire en ligne sur lunicar.fr.
- Commencer par « Bonjour, » seul : jamais le prénom ni le nom de la personne.
- Ne jamais citer d'adresse, de ville de siège, de société autre que LUNICAR, de prix, de cote ni de montant.
- Ne rien promettre : pas de délai garanti, pas de prix garanti, jamais « valable 7 jours ». L'estimation est indicative, le prix définitif est fixé après l'inspection par le technicien.
- Ne jamais écrire « basé à Paris » ni « on se déplace ».
- Signer « L'équipe LUNICAR ».`;
async function proposerReponse(a) {
    const client = anthropic();
    const neg = a.note && a.note <= 3;
    const m = await client.messages.create({
        model: process.env.ESTIMATION_MODEL || 'claude-sonnet-5-5', max_tokens: 600,
        system: `Tu rédiges la réponse publique de LUNICAR à un avis Google. Français, ton chaleureux et sobre, 2 à 4 phrases, pas d'emoji, pas de formule creuse.
${neg ? 'Avis mitigé ou négatif : remercier pour le retour, reconnaître le point soulevé sans se justifier longuement ni contredire, inviter à écrire à contact@lunicar.fr pour en parler.' : 'Avis positif : remercier en reprenant un détail concret de l\'avis s\'il y en a un.'}
${REGLES}
Réponds uniquement par le texte de la réponse.`,
        messages: [{ role: 'user', content: `Note : ${a.note || '?'} / 5\nAvis : ${a.texte || '(note sans commentaire)'}` }]
    });
    return texteDe(m);
}

// ---------- Publications (« Nouveautés » de la fiche) ----------
async function publications() {
    const f = await lieu();
    const j = await appel(`${cheminV4(f)}/localPosts?pageSize=20`);
    return (j.localPosts || []).map(p => ({ id: p.name, texte: p.summary, date: p.createTime, etat: p.state, lien: p.searchUrl, bouton: p.callToAction && p.callToAction.url }));
}
async function publier({ texte, url }) {
    texte = String(texte || '').trim();
    if (!texte) throw erreur('erreur', 'Publication vide.', 400);
    if (texte.length > 1500) throw erreur('erreur', 'Publication trop longue (1 500 caractères au maximum).', 400);
    verifierTexte(texte);
    const f = await lieu();
    const lien = /^https:\/\/lunicar\.fr(\/|$)/.test(url || '') ? url : 'https://lunicar.fr/';
    return appel(`${cheminV4(f)}/localPosts`, { method: 'POST', body: { languageCode: 'fr', topicType: 'STANDARD', summary: texte, callToAction: { actionType: 'LEARN_MORE', url: lien } } });
}
async function proposerPublication(sujet) {
    const client = anthropic();
    const m = await client.messages.create({
        model: process.env.ESTIMATION_MODEL || 'claude-sonnet-5-5', max_tokens: 700,
        system: `Tu rédiges une publication pour la fiche Google Business de LUNICAR (rubrique « Nouveautés »). Français, 400 à 900 caractères, concret et utile pour un particulier qui veut vendre sa voiture, pas d'emoji, pas de hashtag, pas de majuscules criardes. Terminer par une invitation à remplir le formulaire sur lunicar.fr.
${REGLES}
Réponds uniquement par le texte de la publication.`,
        messages: [{ role: 'user', content: sujet ? `Sujet : ${sujet}` : 'Choisis un sujet utile (ex. vendre une voiture à fort kilométrage, papiers à préparer pour la cession, contrôle technique expiré, voiture qui ne roule plus beaucoup).' }]
    });
    return texteDe(m);
}

// ---------- Statistiques (Performance API) ----------
const METRIQUES = {
    BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 'vues_recherche', BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 'vues_recherche',
    BUSINESS_IMPRESSIONS_MOBILE_MAPS: 'vues_maps', BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 'vues_maps',
    CALL_CLICKS: 'appels', WEBSITE_CLICKS: 'clics_site', BUSINESS_DIRECTION_REQUESTS: 'itineraires'
};
async function stats(jours = 28) {
    const f = await lieu();
    const fin = new Date(Date.now() - 2 * 864e5), debut = new Date(fin.getTime() - (jours - 1) * 864e5); // Google a ~2 jours de retard
    const d = (p, x) => `dailyRange.${p}_date.year=${x.getUTCFullYear()}&dailyRange.${p}_date.month=${x.getUTCMonth() + 1}&dailyRange.${p}_date.day=${x.getUTCDate()}`;
    const q = Object.keys(METRIQUES).map(m => 'dailyMetrics=' + m).join('&');
    const j = await appel(`https://businessprofileperformance.googleapis.com/v1/${f.lieu}:fetchMultiDailyMetricsTimeSeries?${q}&${d('start', debut)}&${d('end', fin)}`);
    const totaux = {}, parJour = {};
    for (const bloc of j.multiDailyMetricTimeSeries || []) for (const s of bloc.dailyMetricTimeSeries || []) {
        const cle = METRIQUES[s.dailyMetric];
        for (const p of (s.timeSeries && s.timeSeries.datedValues) || []) {
            const v = Number(p.value || 0), jour = `${p.date.year}-${String(p.date.month).padStart(2, '0')}-${String(p.date.day).padStart(2, '0')}`;
            totaux[cle] = (totaux[cle] || 0) + v;
            (parJour[jour] = parJour[jour] || {})[cle] = (parJour[jour][cle] || 0) + v;
        }
    }
    // Recherches qui ont affiché la fiche (mois en cours et précédent).
    let recherches = [];
    try {
        const m0 = new Date(fin.getUTCFullYear(), fin.getUTCMonth() - 1, 1);
        const k = await appel(`https://businessprofileperformance.googleapis.com/v1/${f.lieu}/searchkeywords/impressions/monthly?monthlyRange.start_month.year=${m0.getFullYear()}&monthlyRange.start_month.month=${m0.getMonth() + 1}&monthlyRange.end_month.year=${fin.getUTCFullYear()}&monthlyRange.end_month.month=${fin.getUTCMonth() + 1}`);
        recherches = (k.searchKeywordsCounts || []).map(x => ({ terme: x.searchKeyword, vues: x.insightsValue && (x.insightsValue.value ? Number(x.insightsValue.value) : `< ${x.insightsValue.threshold}`) })).slice(0, 15);
    } catch (e) { /* facultatif */ }
    return { du: debut.toISOString().slice(0, 10), au: fin.toISOString().slice(0, 10), totaux, jours: Object.entries(parJour).sort().map(([jour, v]) => ({ jour, ...v })), recherches };
}

// ---------- Infos de la fiche : écarts avec le site ----------
async function infos() {
    const f = await lieu();
    const l = await appel(`https://mybusinessbusinessinformation.googleapis.com/v1/${f.lieu}?readMask=title,phoneNumbers,websiteUri,regularHours,serviceArea,categories,profile`);
    const { SITE } = require('./config');
    const ecarts = [];
    const tel = ((l.phoneNumbers && l.phoneNumbers.primaryPhone) || '').replace(/\D/g, '').replace(/^33/, '0');
    const telSite = String((SITE.phone || {}).display || '').replace(/\D/g, '');
    if (telSite && tel && tel !== telSite) ecarts.push(`Téléphone : fiche ${tel}, site ${telSite}`);
    if (!/^https:\/\/(www\.)?lunicar\.fr\/?$/.test(l.websiteUri || '')) ecarts.push(`Site web de la fiche : ${l.websiteUri || 'absent'}`);
    return {
        titre: l.title, telephone: tel, site: l.websiteUri,
        categorie: l.categories && l.categories.primaryCategory && l.categories.primaryCategory.displayName,
        horaires: ((l.regularHours && l.regularHours.periods) || []).map(p => `${p.openDay} ${hm(p.openTime)}–${hm(p.closeTime)}`),
        zones: ((l.serviceArea && l.serviceArea.places && l.serviceArea.places.placeInfos) || []).map(z => z.placeName),
        description: l.profile && l.profile.description, ecarts
    };
}
const hm = t => t ? `${String(t.hours || 0).padStart(2, '0')}:${String(t.minutes || 0).padStart(2, '0')}` : '';

// ---------- Surveillance : notification à chaque nouvel avis ----------
async function nouveauxAvis() {
    if (!configure()) return [];
    const { avis: liste } = await avis();
    const vus = new Set((await store.lireReglage('gbp_avis_vus', null)) || []);
    const premier = !vus.size;
    const neufs = premier ? [] : liste.filter(a => !vus.has(a.id));
    await store.ecrireReglage('gbp_avis_vus', liste.map(a => a.id).slice(0, 500));
    return neufs;
}

function anthropic() {
    if (!process.env.ANTHROPIC_API_KEY) throw erreur('erreur', 'ANTHROPIC_API_KEY absente : proposition automatique indisponible.', 400);
    const Anthropic = require('@anthropic-ai/sdk');
    return new Anthropic({ timeout: 60e3, maxRetries: 2 });
}
const texteDe = m => (m.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();

module.exports = { etat, configure, avis, repondre, supprimerReponse, proposerReponse, publications, publier, proposerPublication, stats, infos, nouveauxAvis, verifierTexte, LIEN_AVIS };
