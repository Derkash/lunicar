require('dotenv').config();
const suivi = require('./lib/suivi');
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const uuidv4 = () => require('crypto').randomUUID();
const nodemailer = require('nodemailer');
const { SITE, esc, parsePhone, aVille } = require('./lib/config');
const pages = require('./lib/pages');
const idf = require('./lib/idf');
const fichePlaque = require('./lib/vehicule');
const zones = require('./lib/zones');
const DEPTS = require('./lib/departements');
const store = require('./lib/store');
const estimation = require('./lib/estimation');
const adminRouter = require('./lib/admin');
const push = require('./lib/push');
const { origine } = require('./lib/origine');
const crypto = require('crypto');

// Filet de sécurité : une promesse rejetée sans gestionnaire est journalisée, elle ne doit jamais arrêter le serveur.
process.on('unhandledRejection', e => console.error('⚠️ Promesse rejetée non gérée :', e && e.stack || e));

const app = express();
const PORT = process.env.PORT || 3000;

// Derrière Cloudflare + Render : l'adresse du visiteur est dans X-Forwarded-For.
app.set('trust proxy', true);
app.disable('x-powered-by');
// Adresse réelle du visiteur pour les limites de débit et le verrouillage de connexion : avec
// `trust proxy: true`, req.ip reprend la PREMIÈRE adresse de X-Forwarded-For, que le client peut
// forger. Cloudflare transmet l'adresse vérifiée dans CF-Connecting-IP : c'est elle qui fait foi.
const ipClient = req => String(req.headers['cf-connecting-ip'] || req.ip || (req.connection && req.connection.remoteAddress) || '').trim();

// Configuration Nodemailer
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// Vérifier la connexion email au démarrage
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter.verify((error) => {
        if (error) {
            console.log('⚠️  Configuration email non valide:', error.message);
        } else {
            console.log('✅ Serveur email prêt');
        }
    });
} else {
    console.log('⚠️  Configuration email manquante (voir .env.example) : les demandes ne seront PAS envoyées par e-mail');
}
if (!SITE.phone) console.log('ℹ️  LUNICAR_PHONE non défini : aucun bouton d\'appel affiché');
if (!SITE.whatsapp) console.log('ℹ️  LUNICAR_WHATSAPP non défini : aucun bouton WhatsApp affiché');

// Configuration Multer pour upload photos
// Photos gardées en mémoire puis rangées dans le dossier de la demande (lib/store.js).
const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024, files: 12 },
    fileFilter: (req, file, cb) => {
        // HEIC/HEIF (photos iPhone non converties) accepté : sharp les convertit au rangement (lib/store.js).
        const allowedTypes = /jpeg|jpg|png|webp|heic|heif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error('Seules les images sont autorisées'));
        }
    }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers (SEO best practices + Lighthouse)
app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // L'admin a besoin de la position (lieu où le véhicule est garé) et de l'appareil photo (carte grise, notes de frais).
    res.setHeader('Permissions-Policy', /^\/admino/.test(req.path) ? 'camera=(self), microphone=(self), geolocation=(self)' : 'camera=(), microphone=(), geolocation=()');
    next();
});

// Anciennes adresses en .html -> adresse propre
const HTML_ALIASES = { index: '/', reprise: '/reprise', contact: '/contact', garanties: '/garanties', articles: '/articles', 'mentions-legales': '/mentions-legales', 'politique-confidentialite': '/politique-confidentialite' };
app.get('/:name.html', (req, res, next) => {
    const target = HTML_ALIASES[req.params.name];
    return target ? res.redirect(301, target) : next();
});

// Les fichiers CSS/JS sont appelés avec ?v=<version> : cache long sans risque.
// Compression à l'origine (gzip/brotli selon le client) : utile hors Cloudflare et pour les robots qui parlent directement à Render.
app.use(require('compression')());
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '30d' }));
// Les photos des vendeurs ne sont plus publiques : elles se consultent dans l'admin.

// Helpers pour fichiers JSON
const dataPath = path.join(__dirname, 'data');

// Créer le dossier data s'il n'existe pas
if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
    console.log('✅ Dossier data créé');
}

function readJSON(filename) {
    const filePath = path.join(dataPath, filename);
    if (!fs.existsSync(filePath)) {
        return [];
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJSON(filename, data) {
    const filePath = path.join(dataPath, filename);
    // S'assurer que le dossier existe
    if (!fs.existsSync(dataPath)) {
        fs.mkdirSync(dataPath, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// Fonction d'envoi d'email
async function sendEmail(options) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.log('📧 Email simulé (config manquante):', options.subject);
        return { simulated: true };
    }

    const mailOptions = {
        from: `"LUNICAR" <${process.env.SMTP_USER}>`,
        to: process.env.EMAIL_TO || 'contact@lunicar.fr',
        subject: options.subject,
        html: options.html
    };
    if (options.replyTo) mailOptions.replyTo = options.replyTo;

    // Ajouter les pièces jointes si présentes
    if (options.attachments && options.attachments.length > 0) {
        mailOptions.attachments = options.attachments;
    }

    return transporter.sendMail(mailOptions);
}

// Limite simple en mémoire : nombre d'envois par adresse IP et par heure.
const sendLog = new Map();
function tooManySends(ip, max = 8) {
    const now = Date.now();
    const recent = (sendLog.get(ip) || []).filter(t => now - t < 60 * 60 * 1000);
    recent.push(now);
    sendLog.set(ip, recent);
    return recent.length > max;
}
setInterval(() => sendLog.clear(), 6 * 60 * 60 * 1000).unref();

// ============ ROUTES PAGES ============

const CSP = [
    "default-src 'self'",
    "script-src 'self' https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://www.google-analytics.com https://www.googletagmanager.com",
    "font-src 'self'",
    "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'"
].join('; ');

// Typographie française : espace insécable avant « : ; ? ! », après « et avant », et entre un nombre et %, € ou km,
// pour qu'un titre ne passe jamais à la ligne juste avant sa ponctuation. Ni les balises, ni les scripts ne sont touchés.
const typoFr = doc => {
    let skip = false;
    return doc.split(/(<[^>]*>)/).map(seg => {
        if (seg.startsWith('<')) {
            if (/^<(script|style|textarea)\b/i.test(seg)) skip = true;
            else if (/^<\/(script|style|textarea)>/i.test(seg)) skip = false;
            return seg;
        }
        if (skip || !seg.trim()) return seg;
        return seg.replace(/ ([:;?!»])/g, '\u00a0$1').replace(/« /g, '«\u00a0').replace(/(\d) (%|€|km\b)/g, '$1\u00a0$2');
    }).join('');
};
const { markdown } = require('./lib/markdown');
// Version Markdown de chaque page publique : /md/<chemin> ou en-tête Accept: text/markdown.
// Les robots des assistants IA lisent le texte brut plus sûrement que le HTML.
app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/md/') || req.path === '/md') { req.url = req.url.replace(/^\/md(?=\/|$)/, '') || '/'; req.markdown = true; }
    else if (/text\/markdown/.test(String(req.headers.accept || '')) && !/text\/html/.test(String(req.headers.accept || '')) && !req.path.startsWith('/api/') && !req.path.startsWith('/admin')) req.markdown = true;
    next();
});
const html = (res, doc, status = 200) => {
    if (res.req && res.req.markdown && status === 200) {
        const titre = (/<title>([^<]*)<\/title>/.exec(doc) || [])[1] || '';
        const modif = (/article:modified_time" content="(\d{4}-\d{2}-\d{2})/.exec(doc) || [])[1] || '';
        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400').set('Vary', 'Accept');
        if (modif) res.set('Last-Modified', new Date(modif + 'T06:00:00Z').toUTCString());
        return res.status(200).type('text/markdown; charset=utf-8').send(markdown(typoFr(doc), { path: res.req.path, title: titre.replace(/&amp;/g, '&'), modified: modif }));
    }
    res.set('Content-Security-Policy', CSP);
    res.set('Cache-Control', status === 200 ? 'public, max-age=300, stale-while-revalidate=86400' : 'no-store');
    // Date de modification réelle de la page (meta article:modified_time) : les moteurs et les assistants IA
    // s'en servent pour décider de rafraîchir leur copie.
    const m = /article:modified_time" content="(\d{4}-\d{2}-\d{2})/.exec(doc);
    if (status === 200 && m) res.set('Last-Modified', new Date(m[1] + 'T06:00:00Z').toUTCString());
    return res.status(status).type('html').send(typoFr(doc));
};
app.set('etag', 'strong');

// Contenus rédigés, lus une fois au démarrage (ils ne changent qu'au déploiement).
const GUIDES = readJSON('guides.json');
const MODELS = readJSON('models.json');
const LOCAL = readJSON('local.json');
const CITIES = readJSON('cities.json');

// ============ REDIRECTIONS 301 : une intention = une page ============
// Anciennes pages de gabarit -> page qui couvre réellement l'intention (lib/zones.js).
const REDIRECTS = { ...zones.PAGE_REDIRECTS };
CITIES.forEach(c => {
    const to = zones.cityRedirect(c, name => (idf.deptByName(name) || {}).slug);
    if (to) REDIRECTS[`reprise-auto-${c.slug}`] = to;
});

// Adresse canonique : sans www, en minuscules, sans « / » final, avant toute autre route.
app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const host = (req.headers.host || '').toLowerCase();
    let p = req.path;
    const qs = req.originalUrl.slice(req.path.length);
    let changed = false;
    if (host.startsWith('www.')) changed = true;
    if (p.length > 1 && p.endsWith('/')) { p = p.replace(/\/+$/, ''); changed = true; }
    if (/[A-Z]/.test(p) && !p.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(p)) { p = p.toLowerCase(); changed = true; }
    const target = REDIRECTS[p.slice(1)];
    if (target) return res.redirect(301, `${SITE.baseUrl}/${target}${qs}`);
    if (changed) return res.redirect(301, `${host.startsWith('www.') ? SITE.baseUrl : ''}${p || '/'}${qs}`);
    next();
});

app.get('/', (req, res) => {
    html(res, pages.home({ cities: CITIES, guides: GUIDES, articles: readJSON('articles.json') }));
});

app.get('/reprise', (req, res) => html(res, pages.reprise()));
app.get(`/${pages.METHODE_SLUG}`, (req, res) => html(res, pages.methode()));

// Île-de-France : région, départements, pages par situation
app.get(`/${idf.HUB_SLUG}`, (req, res) => html(res, pages.hub(CITIES)));
idf.DEPARTMENTS.forEach(d => {
    app.get(`/${d.slug}`, (req, res) => html(res, pages.department(d, CITIES)));
});
idf.SITUATIONS.forEach(s => {
    app.get(`/${s.slug}`, (req, res) => html(res, pages.situation(s)));
});

// Guides rédigés : marques, toutes les voitures, situations, comparatif
GUIDES.forEach(g => {
    app.get(`/${g.slug}`, (req, res) => html(res, pages.guide(g, GUIDES, MODELS)));
});

// Pages modèles rédigées (data/models.json)
MODELS.forEach(m => {
    app.get(`/${m.slug}`, (req, res) => html(res, pages.model(m, MODELS, GUIDES)));
});

if (LOCAL.france) app.get(`/${zones.FRANCE_SLUG}`, (req, res) => html(res, pages.france(LOCAL.france, CITIES)));
Object.values(LOCAL.regions || {}).forEach(r => {
    app.get(`/${r.slug}`, (req, res) => html(res, pages.region(r, CITIES)));
});
// Départements hors Île-de-France rédigés (data/local.json, clé departements)
DEPTS.LIST.forEach(d => {
    app.get(`/${d.slug}`, (req, res) => html(res, pages.departement(d, CITIES)));
});
if (LOCAL.aPropos) app.get('/a-propos', (req, res) => html(res, pages.aPropos(LOCAL.aPropos)));

// Pages villes gardées (les autres sont redirigées plus haut)
app.get('/reprise-auto-:slug', (req, res) => {
    const city = CITIES.find(c => c.slug === req.params.slug);
    if (!city || !zones.isKeptCity(city)) return html(res, pages.notFound(), 404);
    html(res, pages.city(city, CITIES, LOCAL));
});

app.get('/articles', (req, res) => html(res, pages.articles(readJSON('articles.json'))));

app.get('/article/:slug', (req, res) => {
    const articles = readJSON('articles.json');
    const article = articles.find(a => a.slug === req.params.slug);
    if (!article) return html(res, pages.notFound(), 404);
    html(res, pages.article(article, articles));
});

app.get('/garanties', (req, res) => html(res, pages.garanties()));
app.get('/chiffres-cles-vente-voiture-occasion', (req, res) => html(res, pages.chiffres()));
app.get('/contact', (req, res) => html(res, pages.contact()));
app.get('/mentions-legales', (req, res) => html(res, pages.legal('mentions-legales', 'Mentions légales | LUNICAR', 'Mentions légales du site lunicar.fr : société éditrice, hébergement, propriété intellectuelle et contact pour toute question.')));
app.get('/politique-confidentialite', (req, res) => html(res, pages.legal('politique-confidentialite', 'Politique de confidentialité | LUNICAR', 'Comment LUNICAR collecte, utilise et protège vos données personnelles lors d\'une demande d\'estimation : finalités, durée de conservation, vos droits.')));

// ============ API ARTICLES ============

app.get('/api/articles', (req, res) => {
    const articles = readJSON('articles.json');
    res.json(articles);
});

app.get('/api/articles/:slug', (req, res) => {
    const articles = readJSON('articles.json');
    const article = articles.find(a => a.slug === req.params.slug);
    if (article) {
        res.json(article);
    } else {
        res.status(404).json({ error: 'Article non trouvé' });
    }
});

// ============ API VILLE (code postal -> communes, geo.api.gouv.fr) ============

const villesCache = new Map();
app.get('/api/ville/:cp', async (req, res) => {
    const cp = String(req.params.cp || '').replace(/\D/g, '');
    if (cp.length !== 5) return res.json({ villes: [] });
    if (villesCache.has(cp)) return res.set('Cache-Control', 'public, max-age=86400').json({ villes: villesCache.get(cp) });
    if (tooManySends(`ville:${ipClient(req)}`, 60)) return res.status(429).json({ villes: [] });
    try {
        const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${cp}&fields=nom&format=json`, { signal: AbortSignal.timeout(5000) });
        const villes = r.ok ? (await r.json()).map(c => c.nom).sort((a, b) => a.localeCompare(b, 'fr')) : [];
        villesCache.set(cp, villes);
        res.set('Cache-Control', 'public, max-age=86400').json({ villes });
    } catch (e) {
        res.json({ villes: [] });
    }
});

// ============ API PLAQUE ============

// Datation maison toujours ; caractéristiques SIV si une clé API est configurée.
app.get('/api/vehicule/:plaque', async (req, res) => {
    if (tooManySends(`plaque:${ipClient(req)}`, 12)) return res.status(429).json({ error: 'Trop de recherches.' });
    const r = await fichePlaque.rechercher(req.params.plaque);
    res.set('Cache-Control', 'no-store').json(r);
});

// Le vendeur nous transmet le lien de partage de son rapport Histovec.
// ============ API DEMANDES (estimation + rappel) ============

const ETAT_LABELS = { panne: 'En panne / ne roule plus', accident: 'Accidentée', ct: 'Sans CT valide' };

// Libellés des champs de l'API plaque ; les champs inconnus gardent leur nom brut.
const API_LABELS = {
    marque: 'Marque', modele: 'Modèle', modele_en: 'Modèle (court)', version: 'Version', sra_commercial: 'Version commerciale',
    date1erCir_fr: '1re mise en circulation', debut_modele: 'Début du modèle', fin_modele: 'Fin du modèle',
    energieNGC: 'Énergie', type_moteur: 'Type de moteur', code_moteur: 'Code moteur', puisFisc: 'Puissance fiscale (CV)',
    puisFiscReelCH: 'Puissance (ch)', puisFiscReelKW: 'Puissance (kW)', ccm: 'Cylindrée', capacite_litres: 'Cylindrée (L)',
    cylindres: 'Cylindres', valves: 'Soupapes', systeme_alimentation: 'Alimentation', type_compression: 'Compression',
    boite_vitesse: 'Boîte de vitesses', code_boite_vitesse: 'Code boîte', type_transmission: 'Transmission', propulsion: 'Propulsion',
    carrosserieCG: 'Carrosserie (carte grise)', carrosserie: 'Carrosserie', nb_portes: 'Portes', nr_passagers: 'Places',
    genreVCGNGC: 'Genre', couleur: 'Couleur', co2: 'CO2 (g/km)', poids: 'Poids', ptac: 'PTAC',
    longueur: 'Longueur', largeur: 'Largeur', hauteur: 'Hauteur', empattement: 'Empattement',
    vin: 'VIN', numero_serie: 'N° de série', type_mine: 'Type mine', cnit: 'CNIT', variante: 'Variante',
    codes_platforme: 'Plateforme', collection: 'Collection', k_type: 'K-Type', sra_id: 'SRA id', sra_group: 'SRA groupe',
    tecdoc_manu_id: 'TecDoc constructeur', tecdoc_model_id: 'TecDoc modèle', tecdoc_car_id: 'TecDoc véhicule',
    tecdoc_vehicules_compatible: 'TecDoc compatibles', pneus: 'Pneus d\'origine', immat: 'Immatriculation', pays: 'Pays',
    date1erCir_us: '1re mise en circulation (ISO)', energie: 'Code énergie', genreVCG: 'Code genre',
    code_carrosserie: 'Code carrosserie', code_type_transmission: 'Code transmission', code_systeme_alimentation: 'Code alimentation'
};
const API_SKIP = ['erreur', 'logo_marque', 'photo_modele', 'liste_sra_commercial'];

function apiSection(d) {
    const fmt = v => Array.isArray(v) ? v.map(x => (x && typeof x === 'object') ? (x.name || JSON.stringify(x)) : x).join(' · ')
        : (v && typeof v === 'object') ? JSON.stringify(v) : String(v);
    const known = Object.keys(API_LABELS).filter(k => k in d);
    const keys = [...known, ...Object.keys(d).filter(k => !(k in API_LABELS))]
        .filter(k => !API_SKIP.includes(k) && d[k] !== null && d[k] !== '' && !(Array.isArray(d[k]) && !d[k].length));
    const rows = keys.map(k => `<tr><td style="padding:4px 12px 4px 0;color:#6F6B64;white-space:nowrap;vertical-align:top">${esc(API_LABELS[k] || k)}</td><td style="padding:4px 0;color:#0D1B2A">${esc(fmt(d[k]))}</td></tr>`).join('');
    const photo = typeof d.photo_modele === 'string' && /^https:\/\//.test(d.photo_modele) ? `<img src="${esc(d.photo_modele)}" alt="" style="max-width:220px;border-radius:6px;margin:0 0 10px">` : '';
    return `<div style="margin-top:16px;padding:14px 16px;background:#F5F1E8;border-radius:8px">
      <div style="font-weight:700;color:#0D2541;margin-bottom:8px">Fiche véhicule (API plaque)</div>
      ${photo}
      <table style="border-collapse:collapse;font-size:13px;width:100%">${rows}</table>
    </div>`;
}

// Une demande à partir des champs reçus (formulaire complet, brouillon ou rappel).
function construireDemande(b, id) {
    const clean = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
    const phone = parsePhone(b.telephone);
    const plaqueInfo = b.plaque ? fichePlaque.analyser(b.plaque) : null;
    const d = {
        id,
        type: b.type === 'rappel' ? 'rappel' : 'estimation',
        plaque: clean(b.plaque, 12).toUpperCase(),
        vehicule: clean(b.vehicule || [b.marque, b.modele].filter(Boolean).join(' ')),
        annee: clean(b.annee, 12),
        kilometrage: clean(b.kilometrage, 12).replace(/[^\d]/g, ''),
        plaque_datation: plaqueInfo && plaqueInfo.libelle ? plaqueInfo.libelle : '',
        fiche_confirmee: clean(b.fiche, 300),
        prix_souhaite: clean(b.prix, 10).replace(/[^\d]/g, ''),
        etat: [].concat(b.etat || []).map(e => ETAT_LABELS[e]).filter(Boolean),
        mecanique: { ok: 'Roule, aucun souci', soucis: 'Roule, avec des soucis mécaniques', panne: 'Ne roule plus (en panne)', accident: 'Accidentée' }[b.mecanique] || '',
        carrosserie: { tbe: 'Très bon état', rayures: 'Quelques rayures ou petits chocs', abimee: 'Abîmée' }[b.carrosserie] || '',
        controle_technique: { oui6: 'À jour (moins de 6 mois)', oui: 'À jour (plus de 6 mois)', non: 'Pas à jour', nsp: 'Ne sait pas' }[b.ct] || '',
        // Détails façon vendezvotrevoiture : servent au chiffrage (organes, panne, dégâts, historique).
        organes_defaillants: [].concat(b.organes || []).map(v => ({ moteur: 'Moteur', boite: 'Boîte de vitesses', embrayage: 'Embrayage', freins: 'Freins', direction: 'Direction', suspensions: 'Suspensions', clim: 'Climatisation', autre: 'Autre / ne sait pas' })[v]).filter(Boolean).join(', '),
        nature_panne: { moteur: 'Moteur', turbo: 'Turbo', boite: 'Boîte de vitesses', embrayage: 'Embrayage', distribution: 'Distribution', culasse: 'Joint de culasse', demarreur: 'Démarreur / batterie', autre: 'Autre ou inconnue' }[b.panne] || '',
        deplacable: { oui: 'Oui', non: 'Non, dépanneuse nécessaire', nsp: 'Ne sait pas' }[b.deplacable] || '',
        voyant: { oui: 'Oui', non: 'Non', nsp: 'Ne sait pas' }[b.voyant] || '',
        degats: [].concat(b.degats || []).map(v => ({ rayures: 'Rayures', bosses: 'Bosses', rouille: 'Rouille', impacts: 'Éclats, impacts', grele: 'Grêle', parebrise: 'Pare-brise fissuré', parechocs: 'Pare-chocs abîmé' })[v]).filter(Boolean).join(', '),
        cles: { 0: 'Aucune', 1: '1 clé', 2: '2 clés ou plus' }[b.cles] || '',
        carnet: { oui: 'Oui', partiel: 'En partie', non: 'Non' }[b.carnet] || '',
        premiere_main: { oui: 'Oui', non: 'Non', nsp: 'Ne sait pas' }[b.premiere_main] || '',
        importee: { oui: 'Oui', non: 'Non', nsp: 'Ne sait pas' }[b.importee] || '',
        financement: { oui: 'Oui (crédit, LOA ou LLD)', non: 'Non', nsp: 'Ne sait pas' }[b.financement] || '',
        delai: { vite: 'Le plus vite possible', mois: 'Dans le mois', '3mois': 'Dans les 3 mois', info: 'Se renseigne' }[b.delai] || '',
        projet_achat: { oui: 'Oui, prévoit d\'acheter', deja: 'Déjà acheté ou commandé', non: 'Non' }[b.achat] || '',
        prenom: clean(b.prenom, 60),
        nom: clean(b.nom, 80),
        titulaire: ['oui', 'non'].includes(b.titulaire) ? b.titulaire : '',
        nom_titulaire: clean(b.nomTitulaire, 80),
        numero_formule: clean(b.numeroFormule, 14).toUpperCase().replace(/[^A-Z0-9]/g, ''),
        telephone: phone ? phone.display : '',
        telephone_intl: phone ? phone.intl : '',
        email: clean(b.email, 120),
        code_postal: clean(b.codePostal, 5).replace(/[^\d]/g, ''),
        ville: clean(b.ville, 80),
        source: clean(b.source, 80),
        message: clean(b.message, 2000),
        page: clean(b.page, 200),
        provenance: clean(b.provenance, 300),
        clic_ads: /^(gclid|gbraid|wbraid)=[\w.-]{10,250}$/.test(String(b.clicAds || '')) ? String(b.clicAds) : '',
        etape: clean(b.etape, 40),
        createdAt: new Date().toISOString()
    };
    d.origine = origine(d);
    return d;
}

// E-mail d'une demande : complète, abandonnée ou rappel. Toute la fiche API y figure.
function emailDemande(d, apiBrut, opts = {}) {
    const ref = d.id.substring(0, 8).toUpperCase();
    const row = (label, value) => value ? `<tr><td style="padding:6px 12px 6px 0;color:#6F6B64;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:6px 0;color:#0D1B2A;font-weight:600">${value}</td></tr>` : '';
    const idfCp = /^(75|77|78|91|92|93|94|95)/.test(d.code_postal);
    const titre = opts.abandon ? 'DEMANDE ABANDONNÉE' : d.type === 'rappel' ? 'DEMANDE DE RAPPEL' : 'DEMANDE D\'ESTIMATION';
    return `<!DOCTYPE html><html><body style="margin:0;background:#F5F1E8;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:20px">
  <div style="background:${opts.abandon ? '#7A3B12' : '#0D2541'};color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
    <div style="font-size:13px;letter-spacing:1px;color:#D4B26A">LUNICAR · ${titre}</div>
    <div style="font-size:22px;font-weight:700;margin-top:6px">${esc([d.prenom, d.nom].filter(Boolean).join(' ') || 'Sans nom')} · <a href="tel:+${d.telephone_intl}" style="color:#fff">${esc(d.telephone)}</a></div>
  </div>
  <div style="background:#fff;padding:20px 22px;border-radius:0 0 10px 10px">
    ${opts.estimation ? blocEstimation(opts.estimation, ref) : opts.estimationEnAttente ? `<p style="margin:0 0 14px;padding:10px 12px;background:#EEF3F8;border-radius:8px;color:#0D2541">Estimation automatique en cours : elle apparaîtra dans <a href="${SITE.baseUrl}/admino/demande/${ref}">l'espace admin</a>.</p>` : d.type !== 'rappel' ? `<p style="margin:0 0 14px"><a href="${SITE.baseUrl}/admino/demande/${ref}" style="color:#B8923A;font-weight:700">Ouvrir la fiche et lancer l'estimation →</a></p>` : ''}
    ${opts.abandon ? `<p style="margin:0 0 14px;padding:10px 12px;background:#FCF3E8;border-radius:8px;color:#7A3B12">Le vendeur a quitté le formulaire à l'étape <strong>${esc(d.etape || 'inconnue')}</strong> sans l'envoyer. Voici tout ce qu'il avait rempli.</p>` : ''}
    <p style="margin:0 0 16px"><a href="tel:+${d.telephone_intl}" style="display:inline-block;background:#B8923A;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Appeler ${esc(d.telephone)}</a>
    &nbsp; <a href="https://wa.me/${d.telephone_intl}" style="color:#0D2541;font-weight:700">WhatsApp</a></p>
    <table style="border-collapse:collapse;font-size:15px;width:100%">
      ${row('Véhicule', esc(d.vehicule))}
      ${row('Plaque', esc(d.plaque) + (d.plaque_datation ? `<br><span style="font-weight:400;color:#6F6B64">${esc(d.plaque_datation)}</span>` : ''))}
      ${row('VIN', apiBrut && apiBrut.vin ? `<span style="font-family:monospace">${esc(apiBrut.vin)}</span>` : '')}
      ${row('Année', esc(d.annee))}
      ${row('Kilométrage', d.kilometrage ? `${Number(d.kilometrage).toLocaleString('fr-FR')} km` : '')}
      ${row('État mécanique', esc(d.mecanique || d.etat.join(', ')))}
      ${row('Carrosserie', esc(d.carrosserie))}
      ${row('Organes en cause', esc(d.organes_defaillants))}
      ${row('Nature de la panne', esc(d.nature_panne))}
      ${row('Déplaçable sans dépanneuse', esc(d.deplacable))}
      ${row('Voyant allumé', esc(d.voyant))}
      ${row('Défauts carrosserie', esc(d.degats))}
      ${row('Contrôle technique', esc(d.controle_technique))}
      ${row('Clés', esc(d.cles))}
      ${row('Carnet / factures', esc(d.carnet))}
      ${row('Première main', esc(d.premiere_main))}
      ${row('Importée', esc(d.importee))}
      ${row('Crédit / LOA / LLD en cours', esc(d.financement))}
      ${row('Vendre quand', esc(d.delai))}
      ${row('Autre voiture', esc(d.projet_achat))}
      ${row('Prix souhaité', d.prix_souhaite ? `${Number(d.prix_souhaite).toLocaleString('fr-FR')} €` : '')}
      ${row('Message', d.message ? `<span style="font-weight:400;white-space:pre-wrap">${esc(d.message)}</span>` : '')}
      ${row('Ville', [d.code_postal, d.ville].filter(Boolean).map(esc).join(' ') + (idfCp ? ' · Île-de-France' : ''))}
      ${row('E-mail', d.email ? `<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>` : '')}
      ${row('Origine', esc(origine(d)))}
      ${row('Page', esc(d.page))}
      ${row('Provenance', esc(d.provenance))}
      ${row('Photos', opts.photos ? `${opts.photos} en pièce jointe` : '')}
    </table>
    ${(d.titulaire || d.numero_formule || d.nom_titulaire) ? `<div style="margin-top:16px;padding:14px 16px;background:#F5F1E8;border-radius:8px">
      <div style="font-weight:700;color:#0D2541;margin-bottom:6px">Carte grise</div>
      <table style="border-collapse:collapse;font-size:14px">
        ${row('Titulaire de la carte grise', d.titulaire ? (d.titulaire === 'oui' ? 'Oui, le vendeur' : 'Non') : '')}
        ${row('Nom du titulaire', esc(d.nom_titulaire))}
        ${row('N° du certificat', esc(d.numero_formule))}
      </table>
    </div>` : ''}
    ${apiBrut ? apiSection(apiBrut) : ''}
    <p style="margin:18px 0 0;font-size:12px;color:#9C978E">Réf. ${ref} · ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}</p>
  </div>
</div></body></html>`;
}

const euros = v => v ? `${Number(v).toLocaleString('fr-FR')} €` : '—';
// Les 4 prix de l'estimation automatique, en tête de l'e-mail.
function blocEstimation(e, ref) {
    const p = e.prix || {};
    const case_ = (label, v, fort) => `<td style="padding:10px 8px;text-align:center;width:25%;${fort ? 'background:#0D2541;color:#fff;' : 'background:#F5F1E8;color:#0D2541;'}border-radius:8px">
        <div style="font-size:11px;letter-spacing:.5px;${fort ? 'color:#D4B26A' : 'color:#6F6B64'}">${label}</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px">${euros(v)}</div></td>`;
    return `<div style="margin:0 0 18px">
      <div style="font-weight:700;color:#0D2541;margin-bottom:8px">Estimation automatique <span style="font-weight:400;color:#6F6B64">· confiance ${esc(e.confiance || '?')}</span></div>
      <table style="border-collapse:separate;border-spacing:6px 0;width:100%"><tr>
        ${case_('PRIX MAX ACHAT', p.max_achat, true)}${case_('PRIX DE MARCHÉ', p.marche || p.leboncoin)}${case_(p.cote_marchand ? 'COTE REPRISE PRO' : 'COTE ARGUS', p.cote_marchand || p.argus)}${case_('REVENTE PROS', p.vente_estime)}
      </tr></table>
      ${Array.isArray(e.analyse) ? `<ul style="margin:10px 0 0;padding:0;list-style:none;font-size:13px;color:#3B3833;line-height:1.45">${e.analyse.map(l => `<li style="margin:0 0 5px"><strong style="color:#0D2541">${esc(l.t)} :</strong> ${esc(l.s)}</li>`).join('')}</ul>` : e.resume ? `<p style="margin:10px 0 0;font-size:13px;color:#3B3833">${esc(e.resume)}</p>` : ''}
      ${e.attractivite && e.attractivite.score != null ? `<p style="margin:8px 0 0;font-size:13px;color:#3B3833"><strong>Attractivité à la revente : ${e.attractivite.score}/100 · ${esc({ acheter: 'acheter', prix_serre: 'acheter à prix serré', eviter: 'éviter' }[e.attractivite.verdict] || '')}${e.attractivite.delai_commentaire ? ' · ' + esc(e.attractivite.delai_commentaire) : ''}</strong>${e.attractivite.resume ? '<br>' + esc(e.attractivite.resume) : ''}</p>` : ''}
      ${(e.questions_a_poser || []).length ? `<p style="margin:8px 0 0;font-size:13px;color:#3B3833"><strong>À demander :</strong> ${e.questions_a_poser.map(esc).join(' · ')}</p>` : ''}
      <p style="margin:8px 0 0;font-size:13px"><a href="${SITE.baseUrl}/admino/demande/${ref}" style="color:#B8923A;font-weight:700">Détail, annonces et sources dans l'admin →</a></p>
    </div>`;
}

// Année du véhicule : déclarée, sinon 1re mise en circulation (fiche plaque), sinon datation de la plaque.
function anneeVehicule(d, apiBrut) {
    const an = v => { const m = /\b(19[5-9]\d|20[0-4]\d)\b/.exec(String(v || '')); return m ? Number(m[1]) : 0; };
    let a = an(d.annee);
    if (!a && apiBrut) { try { const f = fichePlaque.normaliserReponse(apiBrut); a = an(f && f.annee); } catch (e) { /* fiche illisible */ } }
    return a || an(d.plaque_datation);
}
// Même plaque déjà reçue dans une autre demande (sans plaque : même téléphone).
async function dejaRecue(d) {
    const pl = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const tel = v => String(v || '').replace(/\D/g, '').slice(-9);
    const p = pl(d.plaque), t = tel(d.telephone);
    if (!p && t.length < 9) return false;
    return (await store.listerDemandes()).some(x => x.id !== d.id && (p ? pl((x.data || {}).plaque) === p : tel((x.data || {}).telephone) === t));
}

const ESTIMATION_ATTENTE = (parseFloat(process.env.ESTIMATION_ATTENTE_S) || 150) * 1000;

// Une demande reçue : enregistrement durable, fiche plaque, estimation, puis e-mail.
async function envoyerDemande(d, opts = {}) {
    // Alerte immédiate sur l'app iOS, avant la fiche plaque et l'e-mail.
    push.notifier({
        titre: opts.abandon ? '⚠️ Demande abandonnée' : d.type === 'rappel' ? '📞 Demande de rappel' : '🚗 Nouvelle demande' + (/^Google Ads/.test(origine(d)) ? ' [PUB]' : ''),
        texte: [[d.vehicule || d.prenom || d.plaque, d.annee].filter(Boolean).join(' '), d.kilometrage ? `${Number(d.kilometrage).toLocaleString('fr-FR')} km` : '', [d.code_postal, d.ville].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || d.telephone,
        ref: d.id.substring(0, 8).toUpperCase()
    }).catch(e => console.error('Push :', e.message));
    let apiBrut = null;
    if (d.plaque) { try { apiBrut = await fichePlaque.ficheComplete(d.plaque); } catch (e) { apiBrut = null; } }
    const ref = d.id.substring(0, 8).toUpperCase();
    try {
        await store.enregistrerDemande(store.ligneDepuisDemande({ ...d, ...(apiBrut ? { fiche_api: apiBrut, vin: apiBrut.vin || '' } : {}) }, { origine: opts.abandon ? 'abandon' : 'site' }));
    } catch (e) {
        console.error(`🚨 Demande ${ref} non enregistrée en base :`, e.message);
    }
    // Estimation automatique pour les véhicules de 10 ans et plus (décision du 2026-10-20), sauf si la même
    // plaque a déjà été reçue (sans plaque : même téléphone). Les autres s'estiment à la main depuis l'admin.
    // ESTIMATION_AUTO=1 sur Render la relance pour toutes les demandes.
    // Jamais d'estimation automatique sur un brouillon abandonné (coût IA sans vendeur au bout), ni
    // en double : si la demande a déjà son estimation (abandon puis envoi), on la réutilise.
    let auto = process.env.ESTIMATION_AUTO === '1' && !opts.abandon;
    if (!auto && estimation.actif() && d.type !== 'rappel' && d.vehicule && !opts.rapide && !opts.abandon) {
        const annee = anneeVehicule(d, apiBrut), age = annee ? new Date().getFullYear() - annee : 0;
        const doublon = age >= 10 ? await dejaRecue(d).catch(() => false) : false;
        auto = age >= 10 && !doublon;
        console.log(`💶 ${ref} : ${annee ? `${annee} (${age} ans)` : 'année inconnue'}${doublon ? ', déjà reçue' : ''} → estimation ${auto ? 'automatique' : 'à la demande'}`);
    }
    if (auto && estimation.actif() && d.type !== 'rappel' && d.vehicule && !opts.rapide) {
        const deja = await store.lireDemande(ref).catch(() => null);
        if (deja && deja.estimation) opts = { ...opts, estimation: deja.estimation };
        else {
            const fin = estimation.planifier(ref);
            await Promise.race([fin, new Promise(r => setTimeout(r, ESTIMATION_ATTENTE).unref())]);
            const ligne = await store.lireDemande(ref).catch(() => null);
            if (ligne && ligne.estimation) opts = { ...opts, estimation: ligne.estimation };
            else opts = { ...opts, estimationEnAttente: true };
        }
    }
    const prefixe = (opts.abandon ? '⚠️ Abandonnée' : d.type === 'rappel' ? '📞 Rappel' : '🚗 Estimation') + (/^Google Ads/.test(origine(d)) ? ' [PUB]' : '');
    let emailed = false;
    try {
        const result = await sendEmail({
            subject: `${prefixe} ${d.code_postal || ''} ${d.ville || ''} · ${d.vehicule || d.prenom || d.plaque} ${d.annee || ''} · ${d.telephone}${opts.estimation && opts.estimation.prix ? ` · max ${euros(opts.estimation.prix.max_achat)}` : ''}`.replace(/\s+/g, ' '),
            html: emailDemande(d, apiBrut, opts),
            replyTo: d.email || undefined
        });
        emailed = !result.simulated;
    } catch (e) {
        console.error('❌ Erreur envoi email:', e.message);
    }
    // Journal : la demande complète (données personnelles) n'y figure que si l'e-mail n'est pas parti,
    // comme filet de sécurité ; sinon seulement la référence et le véhicule.
    if (emailed) console.log(`✅ ${opts.abandon ? 'Abandon' : 'Demande'} ${ref} : ${d.vehicule || d.type} · ${d.code_postal || '-'}`);
    else console.log(`🚨 NON ENVOYÉE PAR E-MAIL ${opts.abandon ? 'Abandon' : 'Demande'} ${ref}: ${JSON.stringify(d)}`);
    return emailed;
}

// Doublons (même vendeur, même voiture) : on garde la demande la plus renseignée, complétée par les autres.
const doublons = require('./lib/doublons');
const fusionDoublons = () => doublons.fusionnerTout().catch(e => console.error('Doublons :', e.message));
setTimeout(fusionDoublons, 60 * 1000).unref();
setInterval(fusionDoublons, 15 * 60 * 1000).unref();
setTimeout(() => require('./lib/compta').completerDepuisDemandes().catch(e => console.error('Compta, complétion :', e.message)), 20 * 1000).unref();

// ---------- Brouillons : demandes commencées mais pas envoyées ----------
// Dès que le téléphone est saisi, le formulaire envoie son état à chaque étape.
// Sans envoi final après ABANDON_MS d'inactivité, la demande part en « abandonnée ».
const brouillons = new Map();
const ABANDON_MS = (parseFloat(process.env.ABANDON_MINUTES) || 15) * 60 * 1000;
const terminees = new Map(); // id -> { demande, t } : pour rattacher les photos envoyées après coup

app.post('/api/reprise/brouillon', express.text({ type: '*/*', limit: '20kb' }), (req, res) => {
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b || {};
    const id = String(b.draftId || '');
    if (!/^[0-9a-f-]{36}$/.test(id) || b.site_web) return res.status(204).end();
    if (terminees.has(id)) return res.status(204).end();
    if (!parsePhone(b.telephone)) return res.status(204).end();
    if (tooManySends(`brouillon:${ipClient(req)}`, 120)) return res.status(204).end();
    brouillons.set(id, { b, t: Date.now() });
    res.status(204).end();
});

async function traiterAbandons(tout) {
    const now = Date.now();
    for (const [id, { b, t }] of brouillons) {
        if (!tout && now - t < ABANDON_MS) continue;
        brouillons.delete(id);
        await envoyerDemande(construireDemande(b, id), { abandon: true, rapide: !!tout });
    }
    for (const [id, v] of terminees) if (now - v.t > 6 * 60 * 60 * 1000) terminees.delete(id);
}
setInterval(() => traiterAbandons(false), Math.min(60 * 1000, ABANDON_MS / 2)).unref();
// Redéploiement Render : on envoie les brouillons en cours plutôt que de les perdre.
process.on('SIGTERM', async () => {
    try { await traiterAbandons(true); await suivi.vider(); } finally { process.exit(0); }
});

app.post('/api/reprise', async (req, res) => {
    try {
        const b = req.body || {};
        // Champ piège : rempli uniquement par les robots. On répond "ok" sans rien enregistrer.
        if (b.site_web) return res.json({ success: true, id: uuidv4() });
        if (tooManySends(ipClient(req))) return res.status(429).json({ error: 'Trop de demandes. Réessayez plus tard ou écrivez-nous à contact@lunicar.fr.' });
        if (!parsePhone(b.telephone)) return res.status(400).json({ error: 'Numéro de téléphone invalide.', field: 'telephone' });
        if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(b.email).trim())) return res.status(400).json({ error: 'Adresse e-mail invalide.', field: 'email' });

        // L'identifiant du brouillon n'est repris que s'il est connu : en mémoire (brouillon en cours) ou
        // déjà en base avec le même identifiant (brouillon abandonné puis envoyé). Sinon un client pourrait
        // choisir un identifiant dont la référence (8 premiers caractères) écrase la fiche d'un autre vendeur.
        const refDe = id => String(id).replace(/-/g, '').slice(0, 8).toUpperCase();
        let draftId = null;
        if (/^[0-9a-f-]{36}$/.test(String(b.draftId || ''))) {
            if (brouillons.has(b.draftId)) draftId = b.draftId;
            else { const ex = await store.lireDemande(refDe(b.draftId)).catch(() => null); if (ex && ex.id === b.draftId) draftId = b.draftId; }
        }
        let id = draftId || uuidv4();
        // Référence sur 8 caractères : on évite la collision avec une fiche existante.
        if (!draftId && await store.lireDemande(refDe(id)).catch(() => null)) id = uuidv4();
        const d = construireDemande(b, id);
        if (d.type === 'estimation' && !d.vehicule) return res.status(400).json({ error: 'Indiquez la marque et le modèle.', field: 'vehicule' });
        if (d.type === 'estimation' && !/^\d{4}$|^avant/i.test(String(d.annee || ''))) return res.status(400).json({ error: 'Indiquez l\'année.', field: 'annee' });
        if (d.type === 'estimation' && !d.kilometrage) return res.status(400).json({ error: 'Indiquez le kilométrage.', field: 'kilometrage' });
        if (!d.prenom) return res.status(400).json({ error: 'Indiquez votre prénom.', field: 'prenom' });
        if (d.type === 'estimation' && !/^\d{5}$/.test(String(d.code_postal || ''))) return res.status(400).json({ error: 'Indiquez un code postal à 5 chiffres.', field: 'codePostal' });
        if (draftId) brouillons.delete(draftId);
        terminees.set(d.id, { demande: d, t: Date.now() });

        // Enregistrée tout de suite (les photos peuvent arriver avant la fin de l'estimation).
        try { await store.enregistrerDemande(store.ligneDepuisDemande(d, { origine: 'site' })); } catch (e) { console.error('🚨 Enregistrement :', e.message); }
        res.json({ success: true, id: d.id });
        envoyerDemande(d).catch(e => console.error('Erreur traitement demande:', e.message));
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur lors de l\'enregistrement' });
    }
});

// Photos envoyées après la demande (étape facultative) : un e-mail avec les pièces jointes.
app.post('/api/reprise/:id/photos', upload.array('photos', 12), async (req, res) => {
    const files = req.files || [];
    try {
        const id = String(req.params.id || '');
        const ref = id.substring(0, 8).toUpperCase();
        const enBase = /^[0-9a-f-]{36}$/.test(id) ? await store.lireDemande(ref).catch(() => null) : null;
        const fini = terminees.get(id) || (enBase && enBase.id === id && Date.now() - new Date(enBase.created_at) < 24 * 3600 * 1000 ? { demande: { ...enBase.data, id } } : null);
        if (!fini || !files.length) return res.status(fini ? 400 : 404).json({ error: fini ? 'Aucune photo reçue.' : 'Demande introuvable, envoyez vos photos à contact@lunicar.fr.' });
        if (tooManySends(`photos:${ipClient(req)}`, 6)) return res.status(429).json({ error: 'Trop d\'envois.' });
        const d = fini.demande;
        // Rangement dans le dossier de la demande (durable), avant l'e-mail.
        try {
            const ligne = enBase || await store.lireDemande(ref);
            if (ligne) {
                const jour = new Date().toISOString().slice(0, 10);
                const ajout = [];
                for (const [i, f] of files.entries()) ajout.push(await store.ajouterPhoto(ligne.dossier, `${jour}_${Date.now()}_${i + 1}${path.extname(f.originalname).toLowerCase() || '.jpg'}`, f.buffer));
                const frais = await store.lireDemande(ref);
                await store.majDemande(ref, { photos: [...((frais || ligne).photos || []), ...ajout] });
            }
        } catch (e) { console.error('🚨 Photos non rangées :', e.message); }
        await sendEmail({
            subject: `📷 ${files.length} photo${files.length > 1 ? 's' : ''} · réf. ${ref} · ${d.vehicule} · ${d.telephone}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:560px"><p>Photos de la demande <strong>${esc(ref)}</strong> : ${esc([d.prenom, d.nom].filter(Boolean).join(' '))}, ${esc(d.vehicule)} ${esc(d.annee)}, ${esc(d.telephone)}.</p></div>`,
            replyTo: d.email || undefined,
            attachments: files.map((f, i) => ({ filename: `${ref}_photo_${i + 1}${path.extname(f.originalname) || '.jpg'}`, content: f.buffer }))
        });
        console.log(`📷 ${files.length} photo(s) reçues pour ${ref}`);
        res.json({ success: true });
    } catch (e) {
        console.error('Erreur photos:', e.message);
        res.status(500).json({ error: 'Envoi impossible, réessayez ou écrivez à contact@lunicar.fr.' });
    }
});

app.post('/api/contact', async (req, res) => {
    try {
        const b = req.body || {};
        if (b.site_web) return res.json({ success: true });
        if (tooManySends(ipClient(req))) return res.status(429).json({ error: 'Trop de messages. Réessayez plus tard.' });
        const clean = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
        const message = {
            id: uuidv4(),
            lu: false,
            nom: clean(b.nom, 80),
            email: clean(b.email, 120),
            telephone: clean(b.telephone, 20),
            sujet: clean(b.sujet, 80) || 'Message depuis le site',
            message: clean(b.message, 4000),
            createdAt: new Date().toISOString()
        };
        if (!message.nom || !/^\S+@\S+\.\S+$/.test(message.email) || !message.message) {
            return res.status(400).json({ error: 'Merci de renseigner votre nom, un e-mail valide et votre message.' });
        }

        try { await store.ajouterMessage(message); } catch (e) { console.error('🚨 Message non enregistré :', e.message); }

        try {
            await sendEmail({
                subject: `📩 Contact · ${message.nom}`,
                replyTo: message.email,
                html: `<div style="font-family:Arial,sans-serif;max-width:560px">
<p><strong>${esc(message.nom)}</strong> · <a href="mailto:${esc(message.email)}">${esc(message.email)}</a>${message.telephone ? ` · <a href="tel:${esc(message.telephone)}">${esc(message.telephone)}</a>` : ''}</p>
<p style="white-space:pre-wrap;background:#F5F1E8;padding:14px;border-radius:8px">${esc(message.message)}</p></div>`
            });
        } catch (emailError) {
            console.error('❌ Erreur envoi email:', emailError.message);
            console.log(`🚨 Message contact non envoyé par e-mail : ${JSON.stringify(message)}`);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur lors de l\'envoi' });
    }
});

// ============ API VALIDATION PLAQUE ============

app.get('/api/valider-plaque/:plaque', (req, res) => {
    const plaque = req.params.plaque.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const nouveauFormat = /^[A-Z]{2}[0-9]{3}[A-Z]{2}$/;
    const ancienFormat = /^[0-9]{1,4}[A-Z]{2,3}[0-9]{2}$/;
    const valide = nouveauFormat.test(plaque) || ancienFormat.test(plaque);

    res.json({
        valide,
        plaque: plaque,
        format: nouveauFormat.test(plaque) ? 'nouveau' : ancienFormat.test(plaque) ? 'ancien' : 'invalide'
    });
});

// ============ API ADMIN ============

// Le dépôt est public : aucun mot de passe par défaut en production.
// Sans ADMIN_PASSWORD défini sur l'hébergeur, la connexion à l'admin est fermée.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? null : 'lunicar2024');
if (!ADMIN_PASSWORD) console.log('⚠️  ADMIN_PASSWORD non défini : espace /admino désactivé');
const ADMIN_USER = process.env.ADMIN_USER || 'Elbagui224';
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

// Stockage des tentatives de connexion par IP
const loginAttempts = new Map(); // ip -> { count, lockedUntil }

// Nettoyage périodique des blocages expirés
setInterval(() => {
    const now = Date.now();
    for (const [ip, attempt] of loginAttempts.entries()) {
        if (attempt.lockedUntil && now > attempt.lockedUntil) {
            loginAttempts.delete(ip);
        }
    }
}, 60000); // Vérifie chaque minute

// Middleware de rate limiting pour login
function loginRateLimiter(req, res, next) {
    const ip = ipClient(req);
    const now = Date.now();
    const attempt = loginAttempts.get(ip);

    if (attempt) {
        // Vérifier si l'IP est bloquée
        if (attempt.lockedUntil && now < attempt.lockedUntil) {
            const remainingMinutes = Math.ceil((attempt.lockedUntil - now) / 60000);
            return res.status(429).json({
                success: false,
                error: `Trop de tentatives. Réessayez dans ${remainingMinutes} minute(s).`,
                lockedUntil: attempt.lockedUntil
            });
        }
        // Réinitialiser si le blocage est expiré
        if (attempt.lockedUntil && now >= attempt.lockedUntil) {
            loginAttempts.delete(ip);
        }
    }
    next();
}

// Jeton de session signé (HMAC du mot de passe admin) : valable 30 jours, survit aux
// redéploiements Render. Changer ADMIN_PASSWORD invalide toutes les sessions.
const SESSION_JOURS = 30;
const signer = corps => require('crypto').createHmac('sha256', `${ADMIN_USER}:${ADMIN_PASSWORD}`).update(corps).digest('base64url');
function creerJeton() {
    const corps = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_JOURS * 864e5, n: uuidv4().slice(0, 8) })).toString('base64url');
    return `${corps}.${signer(corps)}`;
}
function jetonValide(token) {
    const [corps, sig] = String(token || '').split('.');
    if (!ADMIN_PASSWORD || !corps || !sig) return false;
    const attendu = signer(corps);
    if (sig.length !== attendu.length || !require('crypto').timingSafeEqual(Buffer.from(sig), Buffer.from(attendu))) return false;
    try { return JSON.parse(Buffer.from(corps, 'base64url').toString()).exp > Date.now(); } catch (e) { return false; }
}

// Middleware d'authentification admin
function authAdmin(req, res, next) {
    const authHeader = req.headers.authorization || '';
    // Images, zip et export s'ouvrent par lien : le jeton peut aussi passer en ?k=
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : String(req.query.k || '');
    if (!token) return res.status(401).json({ error: 'Non autorisé' });
    if (!jetonValide(token)) return res.status(401).json({ error: 'Session expirée' });
    next();
}

// Planning des rendez-vous en abonnement (Calendrier iPhone, Google Agenda) : adresse secrète dérivée du mot de passe admin.
const jetonCalendrier = () => ADMIN_PASSWORD ? signer('calendrier-rdv').slice(0, 32) : null;
app.get('/calendrier/:jeton/lunicar-rdv.ics', async (req, res) => {
    const j = jetonCalendrier();
    if (!j || req.params.jeton !== j) return res.status(404).send('Introuvable');
    const depuis = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    const ds = (await store.listerDemandes()).filter(d => d.suivi && d.suivi.rdv && d.suivi.rdv.date >= depuis);
    res.type('text/calendar; charset=utf-8').set('Cache-Control', 'no-cache').send(require('./lib/calendrier').ics(ds));
});
app.get('/api/admin/calendrier', authAdmin, (req, res) => {
    const j = jetonCalendrier();
    res.json({ url: j ? `${SITE.baseUrl.replace(/^https?:/, 'webcal:')}/calendrier/${j}/lunicar-rdv.ics` : null, https: j ? `${SITE.baseUrl}/calendrier/${j}/lunicar-rdv.ics` : null });
});

// Login admin avec rate limiting
app.post('/api/admin/login', loginRateLimiter, (req, res) => {
    const { identifiant, password } = req.body;
    const ip = ipClient(req);

    if (ADMIN_PASSWORD && String(identifiant || '').trim().toLowerCase() === ADMIN_USER.toLowerCase() && password === ADMIN_PASSWORD) {
        // Connexion réussie - réinitialiser les tentatives
        loginAttempts.delete(ip);

        res.json({ success: true, token: creerJeton(), expiresIn: SESSION_JOURS * 864e5 });
    } else {
        // Échec de connexion - incrémenter les tentatives
        const attempt = loginAttempts.get(ip) || { count: 0, lockedUntil: null };
        attempt.count++;

        if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
            attempt.lockedUntil = Date.now() + LOCKOUT_DURATION;
            loginAttempts.set(ip, attempt);
            return res.status(429).json({
                success: false,
                error: 'Trop de tentatives. Compte bloqué pendant 15 minutes.',
                lockedUntil: attempt.lockedUntil
            });
        }

        loginAttempts.set(ip, attempt);
        const remaining = MAX_LOGIN_ATTEMPTS - attempt.count;
        res.status(401).json({
            success: false,
            error: `Identifiant ou mot de passe incorrect. ${remaining} tentative(s) restante(s).`
        });
    }
});

// Stats admin
app.get('/api/admin/stats', authAdmin, async (req, res) => {
    try {
        const articles = readJSON('articles.json');
        const demandes = await store.listerDemandes();
        const messages = await store.listerMessages();

        res.json({
            articles: articles.length,
            demandes: demandes.length,
            messages: messages.length
        });
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Mesure interne du site (public/js/suivi.js) : événements anonymes, par balise ou fetch keepalive.
app.post('/api/suivi', express.text({ type: '*/*', limit: '16kb' }), (req, res) => {
    if (tooManySends(`suivi:${ipClient(req)}`, 600)) return res.status(204).end();
    suivi.recevoir(req.body);
    res.status(204).end();
});
// Onglet « Analyses » de l'admin : visites, canaux, entonnoir du formulaire, vitesse des pages.
app.get('/api/admin/analyses', authAdmin, async (req, res) => {
    try { res.json(await suivi.analyser(req.query.jours)); } catch (e) { console.error('Analyses :', e.message); res.status(500).json({ error: 'Analyse impossible pour le moment.' }); }
});

// Demandes, estimations, photos, import Gmail, réglages : lib/admin.js
app.use(adminRouter(authAdmin));

// Liste articles admin
app.get('/api/admin/articles', authAdmin, (req, res) => {
    const articles = readJSON('articles.json');
    res.json(articles);
});

// Créer article
app.post('/api/admin/articles', authAdmin, (req, res) => {
    const articles = readJSON('articles.json');
    const { titre, metaTitle, metaDescription, extrait, categorie, tags, emoji, image, imageAlt, contenu, auteur } = req.body;

    if (!titre || !extrait || !categorie || !contenu) {
        return res.status(400).json({ error: 'Champs obligatoires manquants' });
    }

    // Générer slug
    const slug = titre
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

    // Vérifier unicité slug
    if (articles.some(a => a.slug === slug)) {
        return res.status(400).json({ error: 'Un article avec ce titre existe déjà' });
    }

    const now = new Date();
    const dateFormatted = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const dateISO = now.toISOString().split('T')[0];

    const nouvelArticle = {
        slug,
        titre,
        metaTitle: metaTitle || null,
        metaDescription: metaDescription || extrait,
        extrait,
        categorie,
        categorieSlug: categorie.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
        tags: tags ? tags.split(',').map(t => t.trim()) : [categorie],
        date: dateFormatted,
        dateISO,
        tempsLecture: Math.max(1, Math.ceil(contenu.replace(/<[^>]*>/g, '').split(/\s+/).length / 200)),
        emoji: emoji || '📰',
        image: image || null,
        imageAlt: imageAlt || null,
        auteur: auteur || 'Equipe LUNICAR',
        contenu
    };

    articles.unshift(nouvelArticle);
    writeJSON('articles.json', articles);

    res.json({ success: true, article: nouvelArticle });
});

// Modifier article
app.put('/api/admin/articles/:slug', authAdmin, (req, res) => {
    const articles = readJSON('articles.json');
    const index = articles.findIndex(a => a.slug === req.params.slug);

    if (index === -1) {
        return res.status(404).json({ error: 'Article non trouvé' });
    }

    const { titre, metaTitle, metaDescription, extrait, categorie, tags, emoji, image, imageAlt, contenu, auteur } = req.body;

    const now = new Date();
    const dateModified = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

    articles[index] = {
        ...articles[index],
        titre: titre || articles[index].titre,
        metaTitle: metaTitle !== undefined ? metaTitle : articles[index].metaTitle,
        metaDescription: metaDescription || articles[index].metaDescription,
        extrait: extrait || articles[index].extrait,
        categorie: categorie || articles[index].categorie,
        categorieSlug: (categorie || articles[index].categorie).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
        tags: tags ? tags.split(',').map(t => t.trim()) : articles[index].tags,
        emoji: emoji || articles[index].emoji,
        image: image !== undefined ? image : articles[index].image,
        imageAlt: imageAlt !== undefined ? imageAlt : articles[index].imageAlt,
        auteur: auteur || articles[index].auteur,
        contenu: contenu || articles[index].contenu,
        tempsLecture: contenu ? Math.max(1, Math.ceil(contenu.replace(/<[^>]*>/g, '').split(/\s+/).length / 200)) : articles[index].tempsLecture,
        dateModified: dateModified
    };

    writeJSON('articles.json', articles);
    res.json({ success: true, article: articles[index] });
});

// Supprimer article
app.delete('/api/admin/articles/:slug', authAdmin, (req, res) => {
    let articles = readJSON('articles.json');
    const initialLength = articles.length;
    articles = articles.filter(a => a.slug !== req.params.slug);

    if (articles.length === initialLength) {
        return res.status(404).json({ error: 'Article non trouvé' });
    }

    writeJSON('articles.json', articles);
    res.json({ success: true });
});

// ============ SEO - SITEMAP, ROBOTS, LLMS.TXT, INDEXNOW ============

// Toutes les pages indexables, avec leur vraie date de mise à jour (contenu rédigé ou gabarit).
function indexablePages() {
    const T = pages.TEMPLATE_DATE;
    const articles = readJSON('articles.json');
    const list = [];
    const add = (loc, priority, lastmod = T) => list.push({ loc, priority, lastmod });
    add('/', '1.0');
    add('/reprise', '0.9', '2026-10-22');
    add(`/${pages.METHODE_SLUG}`, '0.9', pages.METHODE_UPDATED);
    add('/reprise-auto-paris', '0.9', (LOCAL.paris && LOCAL.paris.updated) || T);
    add(`/${idf.HUB_SLUG}`, '0.9');
    idf.DEPARTMENTS.forEach(d => add(`/${d.slug}`, '0.8', d.updated || T));
    idf.SITUATIONS.forEach(s => add(`/${s.slug}`, '0.8', s.updated || T));
    GUIDES.forEach(g => add(`/${g.slug}`, g.brand ? '0.6' : '0.8', g.updated || T));
    MODELS.forEach(m => add(`/${m.slug}`, '0.7', m.updated || '2026-10-18'));
    zones.IDF_CITIES.filter(s => s !== 'paris').forEach(s => add(`/reprise-auto-${s}`, '0.7', ((LOCAL.villes || {})[s] || {}).updated || T));
    if (LOCAL.france) add(`/${zones.FRANCE_SLUG}`, '0.9', LOCAL.france.updated || T);
    Object.values(LOCAL.regions || {}).forEach(r => add(`/${r.slug}`, '0.8', r.updated || T));
    DEPTS.LIST.forEach(d => add(`/${d.slug}`, '0.8', d.updated || T));
    zones.FRANCE_CITIES.forEach(s => add(`/reprise-auto-${s}`, '0.7', ((LOCAL.villes || {})[s] || {}).updated || T));
    if (LOCAL.aPropos) add('/a-propos', '0.5', LOCAL.aPropos.updated || T);
    add('/garanties', '0.5');
    add('/articles', '0.6');
    add('/chiffres-cles-vente-voiture-occasion', '0.8', require('./lib/faits').derniereVerif() || T);
    articles.forEach(a => add(`/article/${a.slug}`, '0.6', a.dateModified || a.dateISO || T));
    add('/contact', '0.3');
    add('/mentions-legales', '0.1');
    add('/politique-confidentialite', '0.1');
    return list;
}

// Plan du site en deux fichiers (pages / villes) pour suivre l'indexation de chaque type dans la Search Console.
const urlset = list => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${list.map(u => `  <url><loc>${SITE.baseUrl}${u.loc === '/' ? '/' : u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`;
const isCityUrl = u => u.loc.startsWith('/reprise-auto-') && u.loc !== '/reprise-auto-paris';
app.get('/sitemap.xml', (req, res) => {
    const all = indexablePages();
    const last = list => list.reduce((m, u) => (u.lastmod > m ? u.lastmod : m), '');
    res.header('Content-Type', 'application/xml').set('Cache-Control', 'public, max-age=3600');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${SITE.baseUrl}/sitemap-pages.xml</loc><lastmod>${last(all.filter(u => !isCityUrl(u)))}</lastmod></sitemap>
  <sitemap><loc>${SITE.baseUrl}/sitemap-villes.xml</loc><lastmod>${last(all.filter(isCityUrl))}</lastmod></sitemap>
</sitemapindex>`);
});
app.get('/sitemap-pages.xml', (req, res) => { res.header('Content-Type', 'application/xml').set('Cache-Control', 'public, max-age=3600'); res.send(urlset(indexablePages().filter(u => !isCityUrl(u)))); });
app.get('/sitemap-villes.xml', (req, res) => { res.header('Content-Type', 'application/xml').set('Cache-Control', 'public, max-age=3600'); res.send(urlset(indexablePages().filter(isCityUrl))); });

// Anciennes adresses redirigées (301) : poussées à IndexNow (Bing) pour que les moteurs constatent
// la redirection. Plus de sitemap dédié : un sitemap ne doit lister que des URL canoniques en 200.
const redirectedUrls = () => Object.keys(REDIRECTS).map(k => `${SITE.baseUrl}/${k}`);

// Robots d'IA cités explicitement : leur accès est voulu (citations ChatGPT, Perplexity, Claude…).
app.get('/robots.txt', (req, res) => {
    const aiBots = ['OAI-SearchBot', 'ChatGPT-User', 'GPTBot', 'PerplexityBot', 'Perplexity-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'Google-Extended', 'Applebot-Extended', 'Bingbot', 'DuckAssistBot', 'MistralAI-User'];
    const robots = `# LUNICAR - robots.txt
User-agent: *
Allow: /
Disallow: /admin
Disallow: /admino
Disallow: /api/
Disallow: /uploads/

# Moteurs de recherche et assistants IA : bienvenus.
${aiBots.map(b => `User-agent: ${b}`).join('\n')}
Allow: /
Disallow: /admino
Disallow: /api/

Sitemap: ${SITE.baseUrl}/sitemap.xml
`;
    res.header('Content-Type', 'text/plain; charset=utf-8').set('Cache-Control', 'public, max-age=3600');
    res.send(robots);
});

const strip = h => String(h || '').replace(/<li>/g, '\n- ').replace(/<\/(p|h2|h3|ul|ol|table|tr)>/g, '\n').replace(/<(td|th)[^>]*>/g, ' | ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
const title = t => String(t || '').replace(/<[^>]+>/g, '');

const LLMS_SUMMARY = `LUNICAR achète des voitures de toutes marques, récentes ou non, aux particuliers et aux professionnels, partout en France. Toute voiture peut faire l'objet d'une demande d'estimation, mais LUNICAR ne s'engage pas à toutes les racheter : certaines pannes ou dégradations importantes peuvent conduire à une absence d'offre. Le vendeur décrit son véhicule en ligne en deux minutes ; l'équipe étudie la demande et un conseiller le rappelle rapidement avec une fourchette de prix indicative (pas un prix ferme) ; si elle lui convient, un technicien LUNICAR vient vérifier le véhicule à son adresse, sans frais ; LUNICAR présente ensuite le prix définitif, que le vendeur accepte ou refuse librement. Si l'état réel correspond à la description, LUNICAR respecte le positionnement annoncé, sans renégociation injustifiée ; un écart constaté peut modifier le prix. Si la vente est conclue, les documents de cession sont préparés ensemble, l'enlèvement est offert et le paiement se fait par virement instantané, sous réserve des conditions bancaires.`;

app.get('/llms.txt', (req, res) => {
    const b = SITE.baseUrl;
    const articles = readJSON('articles.json');
    const llms = `# LUNICAR

> ${LLMS_SUMMARY}

Dernière mise à jour : ${indexablePages().reduce((m, u) => (u.lastmod > m ? u.lastmod : m), '')}

Version texte de chaque page : ajoutez /md devant le chemin (ex. ${b}/md/comment-ca-marche) ou demandez-la avec l'en-tête Accept: text/markdown.

## Faits clés
- Zone : partout en France ; un technicien LUNICAR intervient sur rendez-vous à l'adresse du vendeur, selon les disponibilités convenues, sans frais
- Véhicules étudiés : toutes marques, récents (y compris sous garantie constructeur), d'occasion, SUV, premium, électriques et hybrides, utilitaires, anciens, fort kilométrage, sans contrôle technique
- Voitures en panne ou accidentées : peuvent être étudiées sur description de la panne ou des dommages ; selon leur importance, une offre n'est pas toujours possible
- Aucune réparation à avancer avant la vente
- Contrôle technique non exigé : il n'est obligatoire que pour une vente à un particulier
- Estimation gratuite et sans engagement : fourchette indicative au téléphone rapidement, prix définitif après vérification du véhicule ; refus possible même le jour du rendez-vous, sans frais
- Révision du prix uniquement en cas d'écart constaté avec la description (dommage ou panne non déclarés, kilométrage différent…)
- Enlèvement à la charge de LUNICAR si la vente est conclue, y compris véhicule non roulant ou en parking souterrain
- Paiement par virement instantané à la conclusion de la vente, sous réserve des conditions bancaires (ni espèces ni chèque)
- Certificat de cession (Cerfa 15776) et déclaration de cession ANTS préparés avec le vendeur
- Aucune obligation d'acheter un autre véhicule
- Horaires : ${SITE.hours} ; contact : ${SITE.email}

## Comptes officiels LUNICAR
${(SITE.social || []).map(r => `- [LUNICAR sur ${r.nom}](${r.url})`).join('\n')}

## Pages principales
- [Accueil](${b}/): présentation, déroulé, comparatif, FAQ
- [Comment fonctionne LUNICAR](${b}/${pages.METHODE_SLUG}): la méthode de bout en bout (demande, fourchette indicative, technicien, prix définitif, virement instantané), ce que LUNICAR s'engage à faire et ce qu'il ne promet pas
- [Estimation voiture gratuite](${b}/reprise): comment est calculée l'estimation, fourchette indicative et prix définitif, motifs de révision, estimation avec la plaque
- [Vendre une vieille voiture sans se déplacer](${b}/vendre-vieille-voiture): voitures de plus de 15 ans, peu roulées
- [Toutes les voitures](${b}/reprise-voiture-occasion): ce que LUNICAR étudie et ce qui fait le prix
- [Qui sommes-nous](${b}/a-propos): société, méthode, engagements
- [Nos engagements](${b}/garanties): les six engagements
- [Comparer particulier, concession et professionnel](${b}/comparatif-reprise-auto)
- [Chiffres clés de la vente d'une voiture d'occasion](${b}/chiffres-cles-vente-voiture-occasion): données officielles sourcées (SDES, service-public, UTAC, Banque de France, Code civil, Code des assurances, Code général des impôts)

## Partout en France
- [Rachat de voiture partout en France](${b}/${zones.FRANCE_SLUG})
${Object.values(LOCAL.regions || {}).map(r => `- [Rachat de voiture en ${r.region}](${b}/${r.slug}): ${r.description}`).join('\n')}
${zones.FRANCE_CITIES.slice(0, 12).map(s => { const c = CITIES.find(x => x.slug === s); return c ? `- [Rachat de voiture à ${c.nom}](${b}/reprise-auto-${s})` : ''; }).filter(Boolean).join('\n')}

## Paris et Île-de-France
- [Rachat de voiture à Paris](${b}/reprise-auto-paris)
- [Rachat de voiture en Île-de-France](${b}/${idf.HUB_SLUG})
${idf.DEPARTMENTS.map(d => `- [Rachat de voiture ${d.dans} (${d.code})](${b}/${d.slug})`).join('\n')}
${zones.IDF_CITIES.filter(x => x !== 'paris').slice(0, 8).map(x => { const c = CITIES.find(y => y.slug === x); return c ? `- [Rachat de voiture à ${c.nom}](${b}/reprise-auto-${x})` : ''; }).filter(Boolean).join('\n')}

## Situations
${idf.SITUATIONS.map(s => `- [${title(s.h1)}](${b}/${s.slug}): ${s.description}`).join('\n')}
${GUIDES.filter(g => !g.brand).map(g => `- [${title(g.h1)}](${b}/${g.slug}): ${g.description}`).join('\n')}

## Marques
${GUIDES.filter(g => g.brand).map(g => `- [${g.brand}](${b}/${g.slug}): ${g.description}`).join('\n')}

## Modèles (fiche, distribution, problèmes connus, vente)
${MODELS.map(m => `- [Vendre sa ${m.nav}](${b}/${m.slug}): ${m.description}`).join('\n')}

## Conseils (réponses sourcées aux questions des vendeurs)
${articles.map(a => `- [${a.titre}](${b}/article/${a.slug}): ${a.extrait}`).join('\n')}

## Départements
${DEPTS.LIST.map(d => `- [Rachat de voiture ${d.dans} (${d.code})](${b}/${d.slug})`).join('\n')}

## Grandes villes (chaque commune couverte a sa page : voir le plan des villes)
${zones.FRANCE_CITIES.slice(0, 100).map(s => { const c = CITIES.find(x => x.slug === s); return c ? `- [Rachat de voiture ${aVille(c.nom)} (${c.codePostal})](${b}/reprise-auto-${s})` : ''; }).filter(Boolean).join('\n')}

## Optional
- [Texte intégral des pages clés](${b}/llms-full.txt)
- [Plan des pages villes (${zones.FRANCE_CITIES.length + zones.IDF_CITIES.length} communes, texte local vérifié pour chacune)](${b}/sitemap-villes.xml)
- [Plan du site](${b}/sitemap.xml)
`;
    res.header('Content-Type', 'text/plain; charset=utf-8').set('Cache-Control', 'public, max-age=3600');
    res.send(llms);
});

// Version longue : le texte des pages piliers, pour les assistants qui lisent un seul fichier.
app.get('/llms-full.txt', (req, res) => {
    const b = SITE.baseUrl;
    const block = (url, h, lede, sections, faq) => `# ${title(h)}\nURL : ${url}\n\n${lede ? lede + '\n\n' : ''}${(sections || []).map(s => `## ${title(s.h2)}\n\n${strip(s.html)}`).join('\n\n')}${faq && faq.length ? '\n\n## Questions fréquentes\n\n' + faq.map(f => `**${f.question}**\n${strip(f.answer)}`).join('\n\n') : ''}\n`;
    const parts = [`# LUNICAR\n\n> ${LLMS_SUMMARY}\n\nDernière mise à jour : ${indexablePages().reduce((m, u) => (u.lastmod > m ? u.lastmod : m), '')}\n`];
    parts.push(pages.methodeTexte(`${b}/${pages.METHODE_SLUG}`));
    if (LOCAL.aPropos) parts.push(block(`${b}/a-propos`, LOCAL.aPropos.h1, LOCAL.aPropos.lede, LOCAL.aPropos.sections, LOCAL.aPropos.faq));
    if (LOCAL.france) parts.push(block(`${b}/${zones.FRANCE_SLUG}`, LOCAL.france.h1, LOCAL.france.lede, LOCAL.france.sections, LOCAL.france.faq));
    if (LOCAL.paris) parts.push(block(`${b}/reprise-auto-paris`, LOCAL.paris.h1, LOCAL.paris.lede, LOCAL.paris.sections, LOCAL.paris.faq));
    idf.SITUATIONS.forEach(s => parts.push(block(`${b}/${s.slug}`, s.h1, s.lede, s.sections, s.faq)));
    GUIDES.filter(g => !g.brand).forEach(g => parts.push(block(`${b}/${g.slug}`, g.h1, g.lede, g.sections, g.faq)));
    parts.push(`# Chiffres clés de la vente d'une voiture d'occasion en France\nURL : ${b}/chiffres-cles-vente-voiture-occasion\n\n${require('./lib/faits').FAITS.map(f => `- ${f.fait} (source : ${f.source_titre}, ${f.source_url})`).join('\n')}\n`);
    readJSON('articles.json').forEach(a => parts.push(`# ${a.titre}\nURL : ${b}/article/${a.slug}\n\n${a.extrait}\n\n${strip(a.contenu)}\n`));
    res.header('Content-Type', 'text/plain; charset=utf-8').set('Cache-Control', 'public, max-age=3600');
    res.send(parts.join('\n---\n\n'));
});

// IndexNow (Bing, Yandex, Seznam… ; Bing alimente ChatGPT) : clé publique servie à la racine,
// soumission de toutes les URL au démarrage en production, donc à chaque déploiement.
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || crypto.createHash('sha256').update('lunicar-indexnow-' + SITE.baseUrl).digest('hex').slice(0, 32);
app.get(`/${INDEXNOW_KEY}.txt`, (req, res) => res.type('text/plain').send(INDEXNOW_KEY));

// Soumission IndexNow (Bing, et donc ChatGPT) : seulement les pages modifiées depuis la dernière soumission,
// au plus une fois par jour, et une resoumission complète (anciennes adresses redirigées comprises) chaque semaine.
// Renvoyer les 5 300 URL à chaque redémarrage faisait passer le site pour un spammeur d'IndexNow.
const JOUR = 24 * 3600 * 1000;
async function pingIndexNow() {
    const etat = (await store.lireReglage('indexnow', null)) || {};
    const now = Date.now();
    if (etat.quand && now - Date.parse(etat.quand) < 20 * 3600 * 1000) return;
    const complet = !etat.complet || now - Date.parse(etat.complet) > 7 * JOUR;
    const pagesSite = indexablePages();
    const modifiees = complet || !etat.lastmod ? pagesSite : pagesSite.filter(u => u.lastmod > etat.lastmod);
    const urlList = [...modifiees.map(u => SITE.baseUrl + (u.loc === '/' ? '/' : u.loc)), ...(complet ? redirectedUrls() : [])].slice(0, 10000);
    const lastmod = pagesSite.reduce((m, u) => (u.lastmod > m ? u.lastmod : m), '');
    if (!urlList.length) { await store.ecrireReglage('indexnow', { ...etat, quand: new Date(now).toISOString(), lastmod }); return; }
    const body = JSON.stringify({ host: new URL(SITE.baseUrl).host, key: INDEXNOW_KEY, keyLocation: `${SITE.baseUrl}/${INDEXNOW_KEY}.txt`, urlList });
    try {
        const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body });
        console.log(`IndexNow : ${urlList.length} URL soumises${complet ? ' (resoumission complète)' : ''} (HTTP ${r.status})`);
        if (r.ok) await store.ecrireReglage('indexnow', { quand: new Date(now).toISOString(), lastmod, complet: complet ? new Date(now).toISOString() : etat.complet });
    } catch (e) { console.log('IndexNow indisponible :', e.message); }
}
if (typeof fetch === 'function' && (process.env.RENDER || process.env.INDEXNOW_PING === '1')) {
    setTimeout(() => pingIndexNow().catch(e => console.log('IndexNow :', e.message)), 30000).unref();
    setInterval(() => pingIndexNow().catch(e => console.log('IndexNow :', e.message)), JOUR).unref();
}

// Route admin cachée
// Flux de conversions pour l'import planifié de Google Ads (Conversions > Importations > HTTPS).
// Protégé par CONVERSIONS_TOKEN : en paramètre ?k= ou en mot de passe HTTP Basic (champ prévu par Google Ads).
app.get(['/conversions/google-ads.csv', '/conversions/leads.csv'], async (req, res) => {
    const jeton = process.env.CONVERSIONS_TOKEN;
    const basic = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString().split(':').slice(1).join(':');
    const fourni = String(req.query.k || basic || '').trim();
    const autorise = !!jeton && fourni.length === jeton.length && crypto.timingSafeEqual(Buffer.from(fourni), Buffer.from(jeton));
    console.log(`Flux conversions : ${req.method} ${req.path} · ${autorise ? 'autorisé' : 'refusé (' + (req.headers.authorization ? 'mot de passe incorrect' : 'sans identifiants') + ')'} · ${String(req.headers['user-agent'] || '').slice(0, 60)}`);
    if (!autorise) {
        res.set('WWW-Authenticate', 'Basic realm="conversions"');
        return res.status(401).send('Non autorisé');
    }
    try {
        res.set('X-Robots-Tag', 'noindex').set('Cache-Control', 'no-store').type('text/csv; charset=utf-8')
            .send(require('./lib/admin').csvConversions(await store.listerDemandes(), false));
    } catch (e) { res.status(500).send('Erreur'); }
});

app.get(['/admino', '/admino/demande/:ref', '/admino/vehicule/:id'], (req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});
app.get('/admino/articles', (req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(path.join(__dirname, 'public', 'admino-articles.html'));
});

// Tout le reste : vraie page 404
app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Introuvable' });
    html(res, pages.notFound(), 404);
});

// Erreurs levées par un middleware (Multer : photo trop lourde, type refusé, JSON mal formé…) :
// réponse JSON lisible par le formulaire au lieu de la page HTML 500 d'Express.
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const code = err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' || err.type === 'entity.parse.failed' || /images sont autorisées/.test(err.message || '') ? 400 : (err.status || 500);
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Photo trop lourde (8 Mo maximum par photo).' : err.code === 'LIMIT_FILE_COUNT' ? 'Trop de photos (12 au plus).' : code === 400 ? err.message : 'Erreur interne.';
    if (code === 500) console.error('Erreur non gérée :', err);
    if (req.path.startsWith('/api/')) return res.status(code).json({ error: message });
    res.status(code).type('text/plain').send(message);
});

// Démarrage serveur
app.listen(PORT, () => {
    console.log(`\n🚗 LUNICAR Server démarré sur http://localhost:${PORT}\n`);
});

// Récapitulatif du matin (8 h, jours ouvrés) : relances du jour et en retard, nouvelles demandes pas encore appelées.
const relances = require('./lib/relances');
setInterval(async () => {
    try {
        const jour = relances.aujourdhui();
        const heure = Number(new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }));
        if (heure < 8 || !relances.ouvre(jour) || (await store.lireReglage('digest_jour', '')) === jour) return;
        await store.ecrireReglage('digest_jour', jour);
        const toutes = await store.listerDemandes();
        const actives = toutes.filter(d => relances.ACTIFS.includes(d.statut));
        const dues = actives.filter(d => (d.suivi || {}).rappel_le && d.suivi.rappel_le <= jour).sort((a, b) => a.suivi.rappel_le.localeCompare(b.suivi.rappel_le));
        // Marquées « À appeler » à la main (hors relances déjà comptées).
        const drapeaux = toutes.filter(d => (d.suivi || {}).a_appeler && !d.suivi.archivee && !dues.includes(d));
        // Nouvelles demandes des 14 derniers jours jamais appelées (les anciennes importées de Gmail n'y figurent pas).
        const neuves = actives.filter(d => d.statut === 'nouvelle' && !(d.suivi || {}).nb_appels && !(d.suivi || {}).a_appeler && Date.now() - new Date(d.created_at) < 14 * 864e5);
        const rdvs = toutes.filter(d => (d.suivi || {}).rdv && d.suivi.rdv.statut === 'prevu' && d.suivi.rdv.date === jour).sort((a, b) => a.suivi.rdv.heure.localeCompare(b.suivi.rdv.heure));
        if (!dues.length && !neuves.length && !drapeaux.length && !rdvs.length) return;
        if (rdvs.length) push.notifier({ titre: `📅 ${rdvs.length} rendez-vous aujourd'hui`, texte: rdvs.map(d => `${d.suivi.rdv.heure} ${[(d.data || {}).vehicule, (d.data || {}).ville].filter(Boolean).join(', ')}`).join(' · '), ref: rdvs.length === 1 ? rdvs[0].ref : undefined }).catch(() => {});
        const total = dues.length + drapeaux.length + neuves.length;
        if (total) push.notifier({ titre: `📞 ${total} vendeur${total > 1 ? 's' : ''} à appeler aujourd'hui`, texte: [dues.length && `${dues.length} relance${dues.length > 1 ? 's' : ''} arrivée${dues.length > 1 ? 's' : ''}`, drapeaux.length && `${drapeaux.length} marqué${drapeaux.length > 1 ? 's' : ''} « À appeler »`, neuves.length && `${neuves.length} nouvelle${neuves.length > 1 ? 's' : ''} jamais appelée${neuves.length > 1 ? 's' : ''}`].filter(Boolean).join(' · ') }).catch(() => {});
        const ligne = d => { const x = d.data || {}; const r = (d.suivi || {}).rappel_le;
            return `<tr><td style="padding:6px 10px 6px 0"><a href="${SITE.baseUrl}/admino/demande/${d.ref}" style="color:#0D2541;font-weight:700">${esc([x.prenom, x.nom].filter(Boolean).join(' ') || 'Sans nom')}</a><br><span style="color:#6F6B64">${esc([x.vehicule, x.annee].filter(Boolean).join(' '))} · ${esc([x.code_postal, x.ville].filter(Boolean).join(' '))}</span></td>
            <td style="padding:6px 10px 6px 0;white-space:nowrap"><a href="tel:+${esc(x.telephone_intl || '')}">${esc(x.telephone || '')}</a></td>
            <td style="padding:6px 0;color:${r && r < jour ? '#B03A2E' : '#6F6B64'};white-space:nowrap">${r ? (r < jour ? 'en retard · ' : '') + r.split('-').reverse().join('/') : ''}</td></tr>`; };
        await sendEmail({
            subject: `${rdvs.length ? `📅 ${rdvs.length} RDV · ` : ''}☎️ ${total} vendeur${total > 1 ? 's' : ''} à appeler aujourd'hui : ${dues.length} relance${dues.length > 1 ? 's' : ''}, ${drapeaux.length} marqué${drapeaux.length > 1 ? 's' : ''}, ${neuves.length} nouvelle${neuves.length > 1 ? 's' : ''}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:620px">
${rdvs.length ? `<h3 style="color:#0D2541">Rendez-vous du jour (${rdvs.length})</h3><table style="border-collapse:collapse;font-size:14px;width:100%">${rdvs.map(d => `<tr><td style="padding:6px 10px 6px 0;font-weight:700;white-space:nowrap">${d.suivi.rdv.heure}</td><td style="padding:6px 0"><a href="${SITE.baseUrl}/admino/demande/${d.ref}" style="color:#0D2541;font-weight:700">${esc([(d.data || {}).prenom, (d.data || {}).nom].filter(Boolean).join(' ') || 'Vendeur')}</a> · ${esc((d.data || {}).vehicule || '')}<br><span style="color:#6F6B64">${esc(d.suivi.rdv.lieu || [(d.data || {}).code_postal, (d.data || {}).ville].filter(Boolean).join(' '))}${d.suivi.rdv.prix ? ` · fourchette ${(d.suivi.rdv.prix_min || d.suivi.rdv.prix).toLocaleString('fr-FR')}${(d.suivi.rdv.prix_max || d.suivi.rdv.prix) !== (d.suivi.rdv.prix_min || d.suivi.rdv.prix) ? ' – ' + (d.suivi.rdv.prix_max || d.suivi.rdv.prix).toLocaleString('fr-FR') : ''} €` : ''}</span></td></tr>`).join('')}</table>` : ''}
${dues.length ? `<h3 style="color:#0D2541">Relances du jour (${dues.length})</h3><table style="border-collapse:collapse;font-size:14px;width:100%">${dues.map(ligne).join('')}</table>` : ''}
${drapeaux.length ? `<h3 style="color:#0D2541">Marquées « À appeler » (${drapeaux.length})</h3><table style="border-collapse:collapse;font-size:14px;width:100%">${drapeaux.map(ligne).join('')}</table>` : ''}
${neuves.length ? `<h3 style="color:#0D2541">Nouvelles demandes pas encore appelées (${neuves.length})</h3><table style="border-collapse:collapse;font-size:14px;width:100%">${neuves.map(ligne).join('')}</table>` : ''}
<p><a href="${SITE.baseUrl}/admino" style="color:#B8923A;font-weight:700">Ouvrir l'espace admin →</a></p></div>`
        });
        console.log(`☎️ Récapitulatif envoyé : ${dues.length} relances, ${drapeaux.length} drapeaux, ${neuves.length} nouvelles`);
    } catch (e) { console.error('Récapitulatif :', e.message); }
}, 10 * 60 * 1000).unref();

// Veille forums : un passage par jour à partir de 9 h (heure de Paris ; VEILLE_FREQUENCE=hebdo = le lundi seulement),
// et à la demande depuis l'admin.
// Notification sur l'app iOS quand de nouvelles discussions sont à traiter.
const veille = require('./lib/veille');
setInterval(async () => {
    try {
        if (process.env.VEILLE_AUTO === '0') return;
        const jour = relances.aujourdhui();
        const p = new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).split(', ');
        const hebdo = process.env.VEILLE_FREQUENCE === 'hebdo';
        if ((hebdo && p[0] !== 'Mon') || Number(p[1]) < 9 || (await store.lireReglage('veille_semaine', '')) === jour) return;
        await store.ecrireReglage('veille_semaine', jour);
        const j = await veille.passage('auto');
        if (j.nouvelles) push.notifier({ titre: `💬 À vous d'intervenir : ${j.nouvelles} discussion${j.nouvelles > 1 ? 's' : ''}`, texte: 'Réponse prête : touchez « Copier et ouvrir », collez dans Reddit ou le forum, puis « Posté ».', onglet: 'forums' }).catch(() => {});
    } catch (e) { console.error('Veille planifiée :', e.message); }
}, 10 * 60 * 1000).unref();

// Annonces Leboncoin : la boîte des alertes e-mail est relue toutes les 30 min (ANNONCES_AUTO=0 pour couper).
// Notification « 🚗 N annonce(s) intéressante(s) » pour les nouvelles annonces à score ≥ 70, jamais entre 22 h et 8 h
// (heure de Paris) : ce qui arrive la nuit est regroupé dans la première notification du matin.
const annonces = require('./lib/annonces');
const releverAnnonces = async () => {
    try {
        if (process.env.ANNONCES_AUTO === '0' || !(await annonces.etat()).boite) return;
        const j = await annonces.passage('auto');
        await annonces.notifier(j.interessantes || 0);
    } catch (e) { console.error('Annonces planifiées :', e.message); }
};
setTimeout(releverAnnonces, 90 * 1000).unref();
setInterval(releverAnnonces, 30 * 60 * 1000).unref();

// Boîte mail contact@ : relue toutes les 3 min (BOITE_AUTO=0 pour couper), en lecture seule (BODY.PEEK).
// Notification « 📧 <expéditeur> » pour chaque e-mail utile (regroupées si plusieurs), jamais entre 22 h et 7 h
// (heure de Paris) : retenues et envoyées en une fois au matin. Voir lib/boite.js.
const boite = require('./lib/boite');
const releverBoite = async () => {
    try {
        if (process.env.BOITE_AUTO === '0' || !boite.imap()) return;
        await boite.relever('auto');
    } catch (e) { console.error('Boîte planifiée :', e.message); }
};
setTimeout(releverBoite, 60 * 1000).unref();
setInterval(releverBoite, 3 * 60 * 1000).unref();

// Import Gmail demandé hors interface : fichier DATA_DIR/import.todo (créé depuis le shell Render).
// Vérifié chaque minute ; effacé seulement quand l'import a abouti, donc repris après un redémarrage.
const IMPORT_TODO = path.join(process.env.DATA_DIR || dataPath, 'import.todo');
let importAuto = false;
setInterval(async () => {
    if (importAuto || !fs.existsSync(IMPORT_TODO)) return;
    importAuto = true;
    try {
        await require('./lib/gmail-import').importer();
        fs.unlinkSync(IMPORT_TODO);
    } catch (e) {
        console.error('Import Gmail :', e.message);
    } finally { importAuto = false; }
}, 60 * 1000).unref();
