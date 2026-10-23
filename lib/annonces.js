// Robot « Annonces » : repère sur Leboncoin des petites citadines intéressantes à racheter,
// UNIQUEMENT à partir des e-mails d'alertes Leboncoin (recherches enregistrées) reçus dans une boîte IMAP.
// Le robot ne visite jamais leboncoin.fr, ne contacte aucun vendeur et ne poste rien : il lit la boîte,
// trie, chiffre (estimation légère par Claude, sans recherche web) et notifie. Le dirigeant ouvre
// l'annonce dans l'app Leboncoin et contacte lui-même.
//
// Boîte : ANNONCES_IMAP_HOST/PORT/USER/PASS (+ ANNONCES_IMAP_BOX, INBOX par défaut), sinon CONTACT_IMAP_*.
// Stockage (réglages clé/valeur) : « annonces » (fiches), « annonces_vues » (identifiants déjà vus),
// « annonces_imap » (UID traités), « annonces_bruts » (20 derniers e-mails bruts, pour déboguer),
// « annonces_journal » (20 derniers passages), « annonces_notif » (notifications regroupées la nuit).
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const store = require('./store');

const env = k => String(process.env[k] || '').trim();
const ent = (v, d) => { const x = parseInt(v, 10); return Number.isFinite(x) && x >= 0 ? x : d; };
const MODELE = () => env('ANNONCES_MODEL') || 'claude-haiku-4-5';
const MAX_IA = () => Math.min(ent(process.env.ANNONCES_IA_MAX, 20), 60);
const SEUIL_NOTIF = 70;
// Tarifs en $ par million de jetons (entrée, sortie), pour journaliser le coût de chaque passage.
const TARIFS = { 'claude-haiku-4-5': [1, 5], 'claude-sonnet-5-5': [2, 10], 'claude-sonnet-5': [2, 10], 'claude-opus-5-5': [4, 20] };

function imap() {
    if (env('ANNONCES_IMAP_USER') && env('ANNONCES_IMAP_PASS')) {
        return { host: env('ANNONCES_IMAP_HOST') || env('CONTACT_IMAP_HOST') || 'imap.hostinger.com', port: Number(env('ANNONCES_IMAP_PORT')) || 993, user: env('ANNONCES_IMAP_USER'), pass: env('ANNONCES_IMAP_PASS'), source: 'ANNONCES_IMAP' };
    }
    if (env('CONTACT_IMAP_USER') && env('CONTACT_IMAP_PASS')) {
        return { host: env('CONTACT_IMAP_HOST') || 'imap.gmail.com', port: Number(env('CONTACT_IMAP_PORT')) || 993, user: env('CONTACT_IMAP_USER'), pass: env('CONTACT_IMAP_PASS'), source: 'CONTACT_IMAP' };
    }
    return null;
}
const iaActive = () => !!process.env.ANTHROPIC_API_KEY;
let claude = null;
const client = () => (claude = claude || new Anthropic({ timeout: 60 * 1000, maxRetries: 2 }));

// ---------------------------------------------------------------- Texte
const ENT = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', euro: '€', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', laquo: '«', raquo: '»', rsquo: '’', middot: '·', ndash: '–', mdash: '—', hellip: '…' };
const decoder = s => String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] != null ? ENT[n.toLowerCase()] : m);
const propre = s => decoder(s).replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
// Minuscules sans accents, apostrophes droites : pour les recherches de mots.
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`´]/g, "'").replace(/\s+/g, ' ');

// ---------------------------------------------------------------- Liens d'annonce
// Identifiant d'annonce depuis un lien, éventuellement enveloppé dans un lien de suivi (paramètre encodé).
function idDepuisLien(href) {
    let u = decoder(href);
    for (let i = 0; i < 4; i++) {
        const m = u.match(/leboncoin\.fr\/(?:ad\/)?[a-z_]+\/(\d{6,})(?:\.htm)?/i) || u.match(/leboncoin\.fr\/vi\/(\d{6,})/i);
        if (m) return m[1];
        let d; try { d = decodeURIComponent(u); } catch (e) { break; }
        if (d === u) break;
        u = d;
    }
    return null;
}
const lienAnnonce = (id, cat = 'voitures') => `https://www.leboncoin.fr/ad/${cat}/${id}`;
// Lien de suivi opaque d'un domaine Leboncoin (on ne le suit jamais : seul le dirigeant l'ouvrira).
const lienSuivi = href => /^https?:\/\/(?!www\.|static\.|img\.)([a-z0-9-]+\.)+leboncoin\.fr\/[^?#\s]+/i.test(href) && !/\/(recherche|mes-recherches|account|compte|dc\/|aide|unsubscribe|desinscri|preferences|cgu|legal)/i.test(href);
const LIENS_INUTILES = /se d[ée]sinscrire|d[ée]sabonner|g[ée]rer (mes|vos) alertes|voir (toutes )?les annonces|voir plus|t[ée]l[ée]charger|app store|google play|mentions l[ée]gales|confidentialit|aide/i;

// ---------------------------------------------------------------- Lecture d'une alerte
// Le format exact des e-mails Leboncoin n'est pas connu (et change) : on découpe le HTML en une suite
// de jetons (texte, image, lien) puis chaque annonce = tout ce qui suit son premier lien jusqu'au lien
// d'une autre annonce. Titre = texte le plus parlant du bloc, prix = « 4 500 € », lieu = code postal
// ou « Ville (75) », année / kilométrage si présents.
function jetons(html) {
    const out = [];
    const pile = [];
    const re = /<!--[\s\S]*?-->|<(style|script|head)\b[\s\S]*?<\/\1>|<(\/?)([a-z0-9]+)\b([^>]*)>|([^<]+)/gi;
    let m;
    while ((m = re.exec(html))) {
        if (m[5] != null) { const t = propre(m[5]); if (t) out.push({ t: 'txt', v: t, a: pile[pile.length - 1] || null }); continue; }
        const ferme = m[2] === '/', tag = (m[3] || '').toLowerCase(), attrs = m[4] || '';
        if (!tag) continue;
        if (tag === 'a') {
            if (ferme) { pile.pop(); continue; }
            const h = (attrs.match(/href\s*=\s*("([^"]*)"|'([^']*)')/i) || []);
            pile.push(decoder(h[2] || h[3] || ''));
            out.push({ t: 'lien', v: pile[pile.length - 1] });
        } else if (tag === 'img' && !ferme) {
            const s = (attrs.match(/src\s*=\s*("([^"]*)"|'([^']*)')/i) || []);
            const alt = (attrs.match(/alt\s*=\s*("([^"]*)"|'([^']*)')/i) || []);
            const w = Number((attrs.match(/width\s*=\s*"?(\d+)/i) || [])[1] || 0);
            out.push({ t: 'img', v: decoder(s[2] || s[3] || ''), alt: propre(alt[2] || alt[3] || ''), w, a: pile[pile.length - 1] || null });
        } else if (/^(br|p|div|td|tr|li|h\d|table)$/.test(tag)) out.push({ t: 'sep' });
    }
    return out;
}

const PRIX = /(\d{1,3}(?:[ . ]\d{3})+|\d{3,6})\s?(?:€|eur\b|euros?\b)/i;
const KM = /(\d{1,3}(?:[ . ]\d{3})+|\d{2,6})\s?km\b/i;
const ANNEE = /\b(199\d|20[0-3]\d)\b/;
const CP = /\b((?:0[1-9]|[1-8]\d|9[0-5]|2[AB])\d{3}|97\d{3})\b/;
const VILLE_DEP = /([A-ZÀ-Ý][\p{L}' -]{1,40}?)\s*\((\d{2}|2[AB]|97\d)\)/u;
const nombre = s => Number(String(s || '').replace(/[^\d]/g, '')) || null;

function bloc(id, lien, toks) {
    const textes = toks.filter(x => x.t === 'txt').map(x => x.v).filter(t => !LIENS_INUTILES.test(t));
    const tout = textes.join(' · ');
    const img = toks.find(x => x.t === 'img' && /^https?:/.test(x.v) && !/logo|pixel|spacer|track|open\.|\/o\.gif|1x1|icon|badge|store/i.test(x.v) && (!x.w || x.w >= 60));
    // Titre : de préférence le texte du lien de l'annonce, sinon le premier texte qui n'est ni un prix ni un lieu.
    const candidats = [...toks.filter(x => x.t === 'txt' && x.a && (idDepuisLien(x.a) === id || x.a === lien)).map(x => x.v), ...textes]
        .filter(t => t.length >= 4 && !/^\s*[\d\s.]+\s?€\s*$/.test(t) && !/^(particulier|professionnel|pro|nouveau|urgent|voir l'annonce|voir|à la une)$/i.test(t) && !/^\d{5}\b/.test(t));
    const titre = (candidats[0] || (img && img.alt) || '').slice(0, 140);
    const prix = nombre((tout.match(PRIX) || [])[1]);
    const km = nombre((tout.match(KM) || [])[1]);
    const anneeM = textes.filter(t => !PRIX.test(t) || t.length > 20).join(' ').match(ANNEE);
    // Lieu : cherché hors prix et kilométrage (« 12000 km » n'est pas un code postal).
    const lieu = tout.replace(new RegExp(KM.source, 'gi'), ' ').replace(new RegExp(PRIX.source, 'gi'), ' ');
    const vd = lieu.match(VILLE_DEP);
    const cpM = lieu.match(new RegExp(`([A-ZÀ-Ý][\\p{L}' -]{1,40}?)\\s+${CP.source}|${CP.source}\\s+([A-ZÀ-Ý][\\p{L}' -]{1,40})`, 'u'));
    let ville = '', code_postal = '', dep = '';
    if (cpM) { code_postal = (cpM[2] || cpM[3] || '').toUpperCase(); ville = propre(cpM[1] || cpM[4] || ''); }
    if (vd) { ville = ville || propre(vd[1]); dep = vd[2].toUpperCase(); }
    if (code_postal && !dep) dep = depDeCp(code_postal);
    const vendeur = /\bprofessionnel\b|\bpro\b/i.test(textes.filter(t => t.length < 20).join(' ')) ? 'pro' : '';
    return { id, url: lien, titre, prix, km, annee: anneeM ? Number(anneeM[1]) : null, ville, code_postal, dep, image: img ? img.v : '', vendeur, texte: tout.slice(0, 1200) };
}

function lireAlerte(html, texte) {
    const toks = jetons(String(html || '') || String(texte || '').replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>'));
    // Découpage : un bloc commence au premier lien d'une annonce et s'arrête au lien d'une autre.
    const blocs = [];
    let courant = null, orpheline = null;
    for (const x of toks) {
        if (x.t === 'lien' && !/^(https?:)?\/\//i.test(x.v)) continue; // ancre vide, mailto:, #
        if (x.t === 'lien') {
            const id = idDepuisLien(x.v);
            let cle = id ? `lbc:${id}` : (lienSuivi(x.v) ? `h:${crypto.createHash('sha1').update(x.v).digest('hex').slice(0, 16)}` : null);
            if (cle && courant && cle !== courant.cle && !id && courant.cle.startsWith('h:') && !courant.toks.some(t => t.t === 'txt')) {
                // Deux liens de suivi différents pour la même annonce (photo puis titre) : on les fusionne.
                courant.cle = cle; courant.lien = x.v; continue;
            }
            if (cle && (!courant || cle !== courant.cle)) {
                const deja = blocs.find(b => b.cle === cle);
                if (deja) { courant = deja; continue; }
                courant = { cle, id, lien: id ? lienAnnonce(id, ((decodeURIComponentSur(x.v).match(/leboncoin\.fr\/(?:ad\/)?([a-z_]+)\/\d{6,}/i) || [])[1] || 'voitures').toLowerCase()) : x.v, toks: [] };
                // Image placée juste avant le lien (hors lien) : rattachée à l'annonce qui suit.
                const prec = blocs.length ? blocs[blocs.length - 1].toks : [];
                const im = prec.length && prec[prec.length - 1].t === 'img' && !prec[prec.length - 1].a ? prec.pop() : null;
                if (im) courant.toks.push(im);
                else if (orpheline) courant.toks.push(orpheline);
                orpheline = null;
                blocs.push(courant);
                continue;
            }
            // Lien qui n'est pas une annonce (voir toutes les annonces, désinscription…) : fin du bloc en cours.
            if (!cle) { courant = null; continue; }
        }
        if (x.t === 'txt' && /d[ée]sinscri|vous recevez cet e-?mail|©|tous droits/i.test(x.v)) courant = null;
        if (courant) courant.toks.push(x);
        else if (x.t === 'img') orpheline = x;
    }
    const out = [];
    for (const b of blocs) {
        const a = bloc(b.id || b.cle, b.lien, b.toks);
        a.cle = b.cle;
        // Un lien de suivi sans prix ni titre n'est pas une annonce (bouton, bandeau…).
        if (!b.id && !(a.prix && a.titre)) continue;
        if (!a.titre && !a.prix) continue;
        out.push(a);
    }
    return out;
}
function decodeURIComponentSur(u) { let x = u; for (let i = 0; i < 3; i++) { try { const d = decodeURIComponent(x); if (d === x) break; x = d; } catch (e) { break; } } return x; }

// ---------------------------------------------------------------- Géographie (distance depuis Paris)
// Préfecture de chaque département (lat, lon) : approximation suffisante pour un malus de distance.
const DEP = {'01':[46.205,5.226],'02':[49.564,3.62],'03':[46.566,3.333],'04':[44.092,6.236],'05':[44.559,6.079],'06':[43.71,7.262],'07':[44.735,4.599],'08':[49.773,4.72],'09':[42.965,1.607],'10':[48.297,4.074],'11':[43.212,2.353],'12':[44.35,2.575],'13':[43.296,5.37],'14':[49.182,-0.37],'15':[44.926,2.44],'16':[45.648,0.156],'17':[46.16,-1.151],'18':[47.081,2.399],'19':[45.267,1.77],'2A':[41.919,8.738],'2B':[42.697,9.451],'21':[47.322,5.041],'22':[48.514,-2.765],'23':[46.171,1.871],'24':[45.184,0.721],'25':[47.238,6.024],'26':[44.933,4.892],'27':[49.024,1.151],'28':[48.444,1.489],'29':[47.996,-4.102],'30':[43.837,4.36],'31':[43.605,1.444],'32':[43.646,0.586],'33':[44.838,-0.579],'34':[43.611,3.877],'35':[48.117,-1.678],'36':[46.81,1.691],'37':[47.394,0.685],'38':[45.188,5.725],'39':[46.675,5.555],'40':[43.894,-0.5],'41':[47.586,1.335],'42':[45.44,4.387],'43':[45.043,3.885],'44':[47.218,-1.554],'45':[47.903,1.909],'46':[44.448,1.441],'47':[44.203,0.616],'48':[44.518,3.5],'49':[47.478,-0.563],'50':[49.116,-1.09],'51':[48.957,4.363],'52':[48.111,5.139],'53':[48.073,-0.769],'54':[48.692,6.184],'55':[48.773,5.161],'56':[47.658,-2.76],'57':[49.119,6.176],'58':[46.99,3.159],'59':[50.629,3.057],'60':[49.43,2.083],'61':[48.432,0.091],'62':[50.291,2.777],'63':[45.778,3.087],'64':[43.295,-0.371],'65':[43.232,0.078],'66':[42.699,2.895],'67':[48.573,7.752],'68':[48.079,7.358],'69':[45.764,4.836],'70':[47.62,6.155],'71':[46.307,4.828],'72':[48.006,0.199],'73':[45.564,5.918],'74':[45.899,6.129],'75':[48.857,2.352],'76':[49.443,1.1],'77':[48.62,2.95],'78':[48.805,1.95],'79':[46.323,-0.464],'80':[49.894,2.296],'81':[43.929,2.148],'82':[44.018,1.355],'83':[43.124,5.928],'84':[43.949,4.806],'85':[46.67,-1.426],'86':[46.58,0.34],'87':[45.834,1.261],'88':[48.173,6.449],'89':[47.798,3.567],'90':[47.638,6.863],'91':[48.55,2.3],'92':[48.84,2.24],'93':[48.91,2.48],'94':[48.78,2.46],'95':[49.06,2.15]};
const IDF = ['75', '77', '78', '91', '92', '93', '94', '95'];
function depDeCp(cp) {
    cp = String(cp || '').toUpperCase();
    if (/^2[AB]/.test(cp)) return cp.slice(0, 2);
    if (!/^\d{5}$/.test(cp)) return '';
    if (cp.startsWith('97')) return cp.slice(0, 3);
    if (cp.startsWith('20')) return Number(cp.slice(0, 3)) < 202 ? '2A' : '2B';
    return cp.slice(0, 2);
}
// Distance routière approximative depuis Paris : vol d'oiseau entre préfectures × 1,3.
function distanceParis(dep) {
    const g = DEP[dep];
    if (!g) return null;
    if (IDF.includes(dep)) return dep === '75' ? 0 : Math.round(25 * 1.3);
    const r = Math.PI / 180, la1 = 48.857 * r, la2 = g[0] * r, dla = la2 - la1, dlo = (g[1] - 2.352) * r;
    return Math.round(2 * 6371 * Math.asin(Math.sqrt(Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2)) * 1.3);
}

// ---------------------------------------------------------------- Règles
const MODELES = [
    ['Renault Clio', /\bclio\b/], ['Renault Twingo', /\btwingo\b/], ['Dacia Sandero', /\bsandero\b/],
    ['Peugeot 207', /\b207\b/], ['Peugeot 208', /\b208\b/], ['Peugeot 108', /\b108\b/],
    ['Citroën C3', /\bc3\b/], ['Citroën C1', /\bc1\b/],
    ['Toyota Yaris', /\byaris\b/], ['Toyota Aygo', /\baygo\b/], ['Volkswagen Polo', /\bpolo\b/], ['Seat Ibiza', /\bibiza\b/], ['Skoda Fabia', /\bfabia\b/],
    ['Opel Corsa', /\bcorsa\b/], ['Ford Fiesta', /\bfiesta\b/], ['Hyundai i10', /\bi ?10\b/], ['Hyundai i20', /\bi ?20\b/], ['Kia Picanto', /\bpicanto\b/], ['Nissan Micra', /\bmicra\b/]
];
const EXCLUSIONS = [
    ['pour pièces', /pour (les )?pieces|vendu(e)? en pieces/], ['moteur HS', /moteur (hs|h\.s|casse|mort|a refaire|serre)|\bhs\b|non roulant/],
    ['accidenté', /accidente|sinistre|vge|vei\b/], ['export', /\bexport\b/], ['épave', /epave/], ['sans papiers', /sans (papiers|carte grise|cg)\b/]
];
// « Pas de pros » : le vendeur refuse les professionnels, inutile de l'appeler.
const ANTI_PRO = /\bpros?\.? s'?abst|professionnels? s'?abst|marchands? s'?abst|garagistes? s'?abst|negociants? s'?abst|pas de (pros?|professionnels?|marchands?|garagistes?|negociants?)\b|sans (pros?|marchands?)\b|(pros?|professionnels?|marchands?) (non|pas) (acceptes?|admis|bienvenus?)|aux particuliers uniquement|particuliers? uniquement|reserve aux particuliers/;
const BONUS = [
    ['vente rapide', /vente rapide|vend(s|re)? rapidement|doit partir vite/], ['urgent', /\burgent|urgence/], ['départ', /\bdepart (a l'etranger|a l'etranger|en|pour|definitif)|cause depart|pour cause de depart/],
    ['déménagement', /demenage/], ['succession', /succession|heritage/], ['décès', /deces|decede/],
    ['pros acceptés', /(pros?|professionnels?|marchands?|garages?) (acceptes?|bienvenus?|ok)\b/], ['vente aux professionnels', /vente aux (pros?|professionnels?|marchands?)/],
    ['professionnels uniquement', /(pros?|professionnels?|marchands?) uniquement|reserve aux (pros?|professionnels?|marchands?)/], ['prix à débattre', /a debattre|negociable|faire offre|\bnego\b/]
];

function regles(a) {
    const t = norm(`${a.titre} ${a.texte}`), titre = norm(a.titre);
    const modele = (MODELES.find(([, re]) => re.test(titre)) || MODELES.find(([, re]) => re.test(t)) || [])[0] || '';
    const exclusions = EXCLUSIONS.filter(([, re]) => re.test(t)).map(([k]) => k);
    const antiPro = ANTI_PRO.test(t.replace(/(pros?|professionnels?|marchands?) uniquement|reserve aux (pros?|professionnels?|marchands?)/g, ''));
    const bonus = BONUS.filter(([, re]) => re.test(t)).map(([k]) => k);
    const raisons = [];
    if (!modele) raisons.push('modèle hors liste');
    if (a.prix && (a.prix < 1500 || a.prix > 6000)) raisons.push(`prix ${a.prix} € hors 1 500-6 000 €`);
    if (exclusions.length) raisons.push(`exclu : ${exclusions.join(', ')}`);
    if (antiPro) raisons.push('le vendeur refuse les professionnels');
    if (a.vendeur === 'pro') raisons.push('vendeur professionnel');
    const km = distanceParis(a.dep);
    return { modele, exclusions, anti_pro: antiPro, bonus, rejet: raisons.length > 0, raisons, distance_km: km };
}

// ---------------------------------------------------------------- Estimation légère (sans recherche web)
const SYSTEM = `Tu es l'acheteur de LUNICAR, négociant qui rachète des voitures d'occasion à des particuliers en France et les revend rapidement (sous 30 jours) entre particuliers.
On te donne le résumé d'une annonce Leboncoin (titre, prix demandé, année, kilométrage, ville) : tu n'as PAS accès au web ni à l'annonce. Estime avec ta connaissance du marché français de l'occasion :
- cote_revente : prix réaliste de revente rapide par LUNICAR (euros TTC), pour ce modèle, cette année et ce kilométrage, en bon état courant ;
- frais_remise : budget de remise en état probable pour ce type de véhicule (entretien, pneus, CT, petite carrosserie), sans défaut déclaré ;
- liquidite : 0 à 100, facilité de revente (demande, fiabilité connue, Crit'Air / ZFE en Île-de-France, essence plutôt que diesel ancien) ;
- commentaire : une phrase (version probable, point de vigilance connu du modèle).
Si une donnée manque (année, km), fais l'hypothèse la plus probable et baisse la confiance. Aucun prix d'achat ni d'offre dans le commentaire.
Réponds UNIQUEMENT par un objet JSON : {"cote_revente": 0, "frais_remise": 0, "liquidite": 0, "confiance": "faible|moyenne|bonne", "commentaire": ""}`;

async function estimerLeger(a) {
    const contenu = [`Annonce : ${a.titre || '(sans titre)'}`, a.modele && `Modèle repéré : ${a.modele}`, `Prix demandé : ${a.prix ? a.prix + ' €' : 'inconnu'}`,
        `Année : ${a.annee || 'inconnue'}`, `Kilométrage : ${a.km ? a.km + ' km' : 'inconnu'}`, `Lieu : ${[a.code_postal, a.ville].filter(Boolean).join(' ') || a.dep || 'inconnu'}`,
        a.texte && `Texte de l'alerte : ${a.texte.slice(0, 600)}`].filter(Boolean).join('\n');
    const resp = await client().messages.create({ model: MODELE(), max_tokens: 400, system: SYSTEM, messages: [{ role: 'user', content: contenu }] });
    const texte = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const j = JSON.parse(texte.slice(texte.indexOf('{'), texte.lastIndexOf('}') + 1));
    const [pe, ps] = TARIFS[MODELE()] || TARIFS['claude-haiku-4-5'];
    const u = resp.usage || {};
    return {
        cote_revente: Math.round(Number(j.cote_revente) || 0), frais_remise: Math.round(Number(j.frais_remise) || 0),
        liquidite: Math.max(0, Math.min(100, Math.round(Number(j.liquidite) || 0))), confiance: String(j.confiance || ''), commentaire: String(j.commentaire || '').slice(0, 300),
        modele_ia: resp.model || MODELE(), cout_usd: ((u.input_tokens || 0) * pe + (u.output_tokens || 0) * ps) / 1e6
    };
}

// Prix max conseillé : même calcul que l'estimation complète (revente − remise − frais fixes − déplacement − marge),
// avec un déplacement approché : train à l'aller, retour au volant (essence + péages).
function prixMax(est, a, r) {
    const { calculer } = require('./estimation');
    const km = a.distance_km;
    let depl = 0;
    if (km != null) {
        const train = km <= Number(r.train_local_km) ? Number(r.train_local_eur) : Math.max(Number(r.train_min), Math.round(km * Number(r.train_eur_km)));
        depl = Math.round(train + km * Number(r.conso_essence) / 100 * Number(r.prix_essence) + (km > Number(r.peage_seuil_km) ? km * Number(r.peage_eur_km) : 0));
    }
    return calculer({ prix_vente_estime: { valeur: est.cote_revente }, frais_remise_en_etat: { total: est.frais_remise } }, r, { total: depl });
}

// Score 0-100 : marge estimée d'abord, puis facilité de revente, mots repérés, distance (malus léger).
function scorer(a) {
    let s = 45;
    const detail = [];
    if (a.estimation && a.prix) {
        const marge = a.marge;
        const pts = marge >= 0 ? Math.min(35, Math.round(marge / 40)) : Math.max(-40, Math.round(marge / 25));
        s += pts; detail.push(`marge ${marge >= 0 ? '+' : ''}${pts}`);
        const liq = Math.round((a.estimation.liquidite - 50) / 5);
        s += liq; detail.push(`revente ${liq >= 0 ? '+' : ''}${liq}`);
    } else if (!a.prix) { s -= 15; detail.push('prix absent −15'); }
    const b = Math.min(20, (a.bonus || []).length * 8);
    if (b) { s += b; detail.push(`mots +${b}`); }
    if (a.distance_km != null && a.distance_km > 60) { const m = Math.min(15, Math.round(a.distance_km / 60)); s -= m; detail.push(`distance −${m}`); }
    if (a.km && a.km > 180000) { s -= 5; detail.push('km −5'); }
    if (a.annee && (a.annee < 2008 || a.annee > 2017)) { s -= 5; detail.push('année −5'); }
    return { score: Math.max(0, Math.min(100, Math.round(s))), score_detail: detail.join(' · ') };
}

// Qualification complète d'une annonce extraite : règles, puis (si autorisé) estimation légère, puis score.
async function qualifier(a, { ia = true, reglagesEstimation } = {}) {
    const q = regles(a);
    Object.assign(a, { modele: q.modele, bonus: q.bonus, exclusions: q.exclusions, anti_pro: q.anti_pro, rejet: q.rejet, raisons: q.raisons, distance_km: q.distance_km });
    if (!a.rejet && ia) {
        a.estimation = await estimerLeger(a);
        const c = prixMax(a.estimation, a, reglagesEstimation);
        a.prix_max = c.prix_max_achat; a.calcul = c;
        a.marge = a.prix ? c.prix_max_achat - a.prix : null;
    }
    Object.assign(a, a.rejet ? { score: 0, score_detail: q.raisons.join(' · ') } : scorer(a));
    return a;
}

// ---------------------------------------------------------------- Boîte IMAP
const estLeboncoin = adr => /@([a-z0-9-]+\.)*leboncoin\.fr$/i.test(String(adr || ''));

async function lireBoite(journal) {
    const c = imap();
    if (!c) throw Object.assign(new Error('Boîte non configurée (ANNONCES_IMAP_USER/PASS ou CONTACT_IMAP_USER/PASS).'), { status: 503 });
    const { ImapFlow } = require('imapflow');
    const { simpleParser } = require('mailparser');
    const cx = new ImapFlow({ host: c.host, port: c.port, secure: true, auth: { user: c.user, pass: c.pass }, logger: false, socketTimeout: 30000 });
    await cx.connect();
    const mails = [];
    try {
        const lock = await cx.getMailboxLock(env('ANNONCES_IMAP_BOX') || 'INBOX');
        try {
            const etat = (await store.lireReglage('annonces_imap', {})) || {};
            const validite = String(cx.mailbox.uidValidity || '');
            const dernier = etat.validite === validite ? Number(etat.dernier_uid) || 0 : 0;
            // Premier passage (ou boîte réinitialisée) : 7 derniers jours seulement.
            const depuis = new Date(Date.now() - 7 * 864e5);
            const crit = dernier ? { uid: `${dernier + 1}:*` } : { since: depuis };
            const uids = ((await cx.search({ ...crit, or: [{ from: 'leboncoin.fr' }, { subject: 'leboncoin' }] }, { uid: true })) || []).filter(u => u > dernier).slice(-80);
            let max = dernier;
            for (const uid of uids) {
                max = Math.max(max, uid);
                const msg = await cx.fetchOne(uid, { source: true }, { uid: true });
                if (!msg || !msg.source || msg.source.length > 6 * 1024 * 1024) continue;
                const mail = await simpleParser(msg.source);
                const de = (((mail.from && mail.from.value) || [])[0] || {}).address || '';
                const html = mail.html || '';
                // Alerte Leboncoin, ou e-mail transféré à la main qui en contient une.
                if (!estLeboncoin(de) && !/leboncoin\.fr\/(ad|vi|voitures)\//i.test(decodeURIComponentSur(html + (mail.text || '')))) continue;
                mails.push({ uid, date: new Date(mail.date || Date.now()).toISOString(), de, sujet: String(mail.subject || '').slice(0, 200), html, texte: mail.text || '' });
            }
            await store.ecrireReglage('annonces_imap', { validite, dernier_uid: max, boite: `${c.user} (${c.source})`, lu_le: new Date().toISOString() });
            journal.messages = uids.length;
        } finally { lock.release(); }
    } finally { await cx.logout().catch(() => {}); }
    return mails;
}

// ---------------------------------------------------------------- Passage
let enCours = null;
async function lireAnnonces() { return (await store.lireReglage('annonces', [])) || []; }

// Traite une liste d'e-mails déjà lus (sert aussi aux tests avec une fausse alerte).
async function traiterMails(mails, journal, { ia = iaActive() } = {}) {
    const vues = (await store.lireReglage('annonces_vues', {})) || {};
    const r = await require('./estimation').reglages();
    const nouvelles = [];
    let appels = 0;
    for (const m of mails) {
        const extraites = lireAlerte(m.html, m.texte);
        journal.extraites += extraites.length;
        for (const a of extraites) {
            if (vues[a.cle] || nouvelles.some(x => x.cle === a.cle)) { journal.doublons++; continue; }
            a.recue_le = m.date; a.alerte = m.sujet;
            const avecIA = ia && appels < MAX_IA();
            try {
                const regle = regles(a);
                if (avecIA && !regle.rejet) appels++;
                await qualifier(a, { ia: avecIA, reglagesEstimation: r });
                if (a.estimation) journal.cout_usd += a.estimation.cout_usd;
            } catch (e) {
                journal.erreurs.push(`Estimation (${a.titre}) : ${e.message}`.slice(0, 300));
                Object.assign(a, scorer(a));
            }
            if (ia && !a.rejet && !a.estimation && appels >= MAX_IA()) a.estimation_reportee = true;
            a.statut = a.rejet ? 'ignoree' : 'a_traiter';
            a.statut_auto = a.rejet;
            a.trouvee_le = journal.date;
            vues[a.cle] = journal.date;
            nouvelles.push(a);
        }
    }
    journal.appels_ia = appels;
    journal.nouvelles = nouvelles.filter(a => !a.rejet).length;
    journal.rejetees = nouvelles.filter(a => a.rejet).length;
    journal.interessantes = nouvelles.filter(a => !a.rejet && a.score >= SEUIL_NOTIF).length;
    // Relecture juste avant l'écriture : les actions faites dans l'admin pendant le passage sont gardées.
    const actuelles = await lireAnnonces();
    const cles = new Set(actuelles.map(a => a.cle));
    let ign = 0;
    const toutes = [...nouvelles.filter(a => !cles.has(a.cle)), ...actuelles].filter(a => a.statut !== 'ignoree' || ign++ < 200).slice(0, 600);
    await store.ecrireReglage('annonces', toutes);
    const v = Object.entries(vues).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, 5000);
    await store.ecrireReglage('annonces_vues', Object.fromEntries(v));
    return nouvelles;
}

async function passage(origine = 'manuel') {
    if (enCours) return enCours;
    enCours = (async () => {
        const t0 = Date.now();
        const journal = { date: new Date().toISOString(), origine, messages: 0, alertes: 0, extraites: 0, doublons: 0, nouvelles: 0, rejetees: 0, interessantes: 0, appels_ia: 0, cout_usd: 0, erreurs: [] };
        try {
            const mails = await lireBoite(journal);
            journal.alertes = mails.length;
            if (mails.length) {
                const bruts = (await store.lireReglage('annonces_bruts', [])) || [];
                await store.ecrireReglage('annonces_bruts', [...mails.map(m => ({ date: m.date, de: m.de, sujet: m.sujet, html: String(m.html || m.texte).slice(0, 120000) })), ...bruts].slice(0, 20));
                await traiterMails(mails, journal);
            }
        } catch (e) { journal.erreurs.push(e.message); }
        journal.cout_usd = Math.round(journal.cout_usd * 10000) / 10000;
        journal.duree_s = Math.round((Date.now() - t0) / 1000);
        const hist = (await store.lireReglage('annonces_journal', [])) || [];
        await store.ecrireReglage('annonces_journal', [journal, ...hist].slice(0, 20)).catch(() => {});
        journal.erreurs.forEach(e => console.error('Annonces :', e));
        console.log(`🚗 Annonces (${origine}) : ${journal.alertes} alerte(s), ${journal.extraites} annonce(s) lues, ${journal.nouvelles} nouvelle(s), ${journal.interessantes} ≥ ${SEUIL_NOTIF}, IA ${journal.appels_ia} appel(s) ≈ ${journal.cout_usd} $, ${journal.duree_s} s`);
        return journal;
    })().finally(() => { enCours = null; });
    return enCours;
}

// Notification : pas la nuit (22 h-8 h, heure de Paris) ; ce qui arrive la nuit est regroupé au matin.
const heureParis = (d = new Date()) => Number(d.toLocaleString('en-US', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }));
const nuit = (d = new Date()) => { const h = heureParis(d); return h >= 22 || h < 8; };
async function notifier(n, maintenant = new Date()) {
    const push = require('./push');
    const att = (await store.lireReglage('annonces_notif', { en_attente: 0 })) || { en_attente: 0 };
    const total = (Number(att.en_attente) || 0) + (Number(n) || 0);
    if (!total) return 0;
    if (nuit(maintenant)) { await store.ecrireReglage('annonces_notif', { en_attente: total, depuis: att.depuis || maintenant.toISOString() }); return 0; }
    await store.ecrireReglage('annonces_notif', { en_attente: 0 });
    await push.notifier({ titre: `🚗 ${total} annonce${total > 1 ? 's' : ''} intéressante${total > 1 ? 's' : ''}`, texte: 'Petites citadines repérées dans vos alertes Leboncoin : ouvrez l\'écran Annonces.', onglet: 'annonces' }).catch(() => {});
    return total;
}

async function majAnnonce(id, champs) {
    const liste = await lireAnnonces();
    const a = liste.find(x => x.id === id || x.cle === id);
    if (!a) return null;
    if (['a_traiter', 'contactee', 'ignoree'].includes(champs.statut)) { a.statut = champs.statut; a.statut_le = new Date().toISOString(); a.statut_auto = false; }
    for (const k of ['estimation_complete', 'estimation_complete_statut', 'estimation_complete_erreur', 'demande_ref']) if (k in champs) a[k] = champs[k];
    if (typeof champs.note === 'string') a.note = champs.note.slice(0, 2000);
    await store.ecrireReglage('annonces', liste);
    return a;
}

// Une annonce vue comme une demande (pour l'estimation complète et la création de demande dans le CRM).
function versDemande(a) {
    return {
        vehicule: a.titre || a.modele, annee: a.annee ? String(a.annee) : '', kilometrage: a.km ? String(a.km) : '',
        code_postal: a.code_postal || '', ville: a.ville || '', prix_souhaite: a.prix ? String(a.prix) : '',
        message: `Annonce Leboncoin repérée par le robot Annonces : ${a.url}\nPrix demandé : ${a.prix ? a.prix + ' €' : 'inconnu'}${(a.bonus || []).length ? `\nMots repérés : ${a.bonus.join(', ')}` : ''}`,
        origine: 'Leboncoin', annonce_url: a.url, annonce_id: a.id
    };
}

const etat = async () => {
    const c = imap(), i = (await store.lireReglage('annonces_imap', null)) || null;
    return { en_cours: !!enCours, boite: c ? `${c.user} (${c.source})` : null, ia: iaActive(), modele: MODELE(), plafond_ia: MAX_IA(), seuil: SEUIL_NOTIF, derniere_lecture: i && i.lu_le, attente_notif: ((await store.lireReglage('annonces_notif', {})) || {}).en_attente || 0 };
};

module.exports = { passage, etat, lireAnnonces, majAnnonce, notifier, versDemande, lireAlerte, regles, scorer, qualifier, traiterMails, prixMax, distanceParis, depDeCp, idDepuisLien, nuit, SEUIL_NOTIF };
