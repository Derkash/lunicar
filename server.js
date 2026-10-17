require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const { SITE, esc, parsePhone } = require('./lib/config');
const pages = require('./lib/pages');
const idf = require('./lib/idf');
const fichePlaque = require('./lib/vehicule');
const zones = require('./lib/zones');
const store = require('./lib/store');
const estimation = require('./lib/estimation');
const adminRouter = require('./lib/admin');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Derrière Cloudflare + Render : l'adresse du visiteur est dans X-Forwarded-For.
app.set('trust proxy', true);
app.disable('x-powered-by');

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
        const allowedTypes = /jpeg|jpg|png|webp/;
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
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});

// Anciennes adresses en .html -> adresse propre
const HTML_ALIASES = { index: '/', reprise: '/reprise', contact: '/contact', garanties: '/garanties', articles: '/articles', 'mentions-legales': '/mentions-legales', 'politique-confidentialite': '/politique-confidentialite' };
app.get('/:name.html', (req, res, next) => {
    const target = HTML_ALIASES[req.params.name];
    return target ? res.redirect(301, target) : next();
});

// Les fichiers CSS/JS sont appelés avec ?v=<version> : cache long sans risque.
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
        from: `"${process.env.SMTP_FROM_NAME || 'LUNICAR'}" <${process.env.SMTP_USER}>`,
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

const html = (res, doc, status = 200) => {
    res.set('Content-Security-Policy', CSP);
    res.set('Cache-Control', status === 200 ? 'public, max-age=300, stale-while-revalidate=86400' : 'no-store');
    return res.status(status).type('html').send(doc);
};

// Contenus rédigés, lus une fois au démarrage (ils ne changent qu'au déploiement).
const GUIDES = readJSON('guides.json');
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
    app.get(`/${g.slug}`, (req, res) => html(res, pages.guide(g, GUIDES)));
});

if (LOCAL.france) app.get(`/${zones.FRANCE_SLUG}`, (req, res) => html(res, pages.france(LOCAL.france, CITIES)));
Object.values(LOCAL.regions || {}).forEach(r => {
    app.get(`/${r.slug}`, (req, res) => html(res, pages.region(r, CITIES)));
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
app.get('/contact', (req, res) => html(res, pages.contact()));
app.get('/mentions-legales', (req, res) => html(res, pages.legal('mentions-legales', 'Mentions légales | LUNICAR', 'Mentions légales du site lunicar.fr : éditeur et propriétaire OPTIMERCH (SAS), hébergement, propriété intellectuelle et contact pour toute question.')));
app.get('/politique-confidentialite', (req, res) => html(res, pages.legal('politique-confidentialite', 'Politique de confidentialité | LUNICAR', 'Comment LUNICAR collecte, utilise et protège vos données personnelles lors d\'une demande d\'offre de rachat : finalités, durée de conservation, vos droits.')));

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
    if (tooManySends(`ville:${req.ip || ''}`, 60)) return res.status(429).json({ villes: [] });
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
    if (tooManySends(`plaque:${req.ip || ''}`, 12)) return res.status(429).json({ error: 'Trop de recherches.' });
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
        controle_technique: { oui: 'À jour', non: 'Pas à jour', nsp: 'Ne sait pas' }[b.ct] || '',
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
    ${opts.estimation ? blocEstimation(opts.estimation, ref) : opts.estimationEnAttente ? `<p style="margin:0 0 14px;padding:10px 12px;background:#EEF3F8;border-radius:8px;color:#0D2541">Estimation automatique en cours : elle apparaîtra dans <a href="${SITE.baseUrl}/admino#${ref}">l'espace admin</a>.</p>` : d.type !== 'rappel' ? `<p style="margin:0 0 14px"><a href="${SITE.baseUrl}/admino#${ref}" style="color:#B8923A;font-weight:700">Ouvrir la fiche et lancer l'estimation →</a></p>` : ''}
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
      ${row('Contrôle technique', esc(d.controle_technique))}
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

// Origine lisible d'une demande : pub Google Ads (campagne, groupe, mot-clé), ChatGPT, Google naturel…
function origine(d) {
    const p = String(d.provenance || '');
    const q = k => { const m = p.match(new RegExp(`(?:^|[&| ])${k}=([^&|]+)`)); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() : ''; };
    if (d.clic_ads || /gclid=|gbraid=|wbraid=/.test(p) || /utm_medium=cpc/.test(p)) {
        return ['Google Ads', q('utm_campaign') && `campagne « ${q('utm_campaign')} »`, q('utm_content') && `groupe « ${q('utm_content')} »`, q('utm_term') && `mot-clé « ${q('utm_term')} »`].filter(Boolean).join(' · ');
    }
    const ref = q('ref');
    if (/chatgpt|openai/i.test(ref + q('utm_source'))) return 'ChatGPT';
    if (/perplexity/i.test(ref)) return 'Perplexity';
    if (/google\./i.test(ref)) return 'Google (résultats naturels)';
    if (/bing\.|ecosia|qwant|duckduckgo/i.test(ref)) return 'Moteur de recherche (naturel)';
    if (q('utm_source')) return q('utm_source');
    return ref ? `Lien depuis ${ref.replace(/^https?:\/\//, '').split('/')[0]}` : 'Accès direct';
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
        ${case_('PRIX MAX ACHAT', p.max_achat, true)}${case_('LEBONCOIN', p.leboncoin)}${case_('COTE ARGUS', p.argus)}${case_('PRIX DE VENTE', p.vente_estime)}
      </tr></table>
      ${e.resume ? `<p style="margin:10px 0 0;font-size:13px;color:#3B3833">${esc(e.resume)}</p>` : ''}
      ${(e.questions_a_poser || []).length ? `<p style="margin:8px 0 0;font-size:13px;color:#3B3833"><strong>À demander :</strong> ${e.questions_a_poser.map(esc).join(' · ')}</p>` : ''}
      <p style="margin:8px 0 0;font-size:13px"><a href="${SITE.baseUrl}/admino#${ref}" style="color:#B8923A;font-weight:700">Détail, annonces et sources dans l'admin →</a></p>
    </div>`;
}

const ESTIMATION_ATTENTE = (parseFloat(process.env.ESTIMATION_ATTENTE_S) || 150) * 1000;

// Une demande reçue : enregistrement durable, fiche plaque, estimation, puis e-mail.
async function envoyerDemande(d, opts = {}) {
    let apiBrut = null;
    if (d.plaque) { try { apiBrut = await fichePlaque.ficheComplete(d.plaque); } catch (e) { apiBrut = null; } }
    const ref = d.id.substring(0, 8).toUpperCase();
    try {
        await store.enregistrerDemande(store.ligneDepuisDemande({ ...d, ...(apiBrut ? { fiche_api: apiBrut, vin: apiBrut.vin || '' } : {}) }, { origine: opts.abandon ? 'abandon' : 'site' }));
    } catch (e) {
        console.error(`🚨 Demande ${ref} non enregistrée en base :`, e.message);
    }
    // Estimation lancée à la main depuis l'admin (décision du 2026-10-17).
    // ESTIMATION_AUTO=1 sur Render la relance automatiquement à chaque demande.
    if (process.env.ESTIMATION_AUTO === '1' && estimation.actif() && d.type !== 'rappel' && d.vehicule && !opts.rapide) {
        const fin = estimation.planifier(ref);
        await Promise.race([fin, new Promise(r => setTimeout(r, ESTIMATION_ATTENTE).unref())]);
        const ligne = await store.lireDemande(ref).catch(() => null);
        if (ligne && ligne.estimation) opts = { ...opts, estimation: ligne.estimation };
        else opts = { ...opts, estimationEnAttente: true };
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
    // Le disque de Render est effacé à chaque déploiement : on journalise toujours la demande en entier.
    console.log(`${emailed ? '✅' : '🚨 NON ENVOYÉE PAR E-MAIL'} ${opts.abandon ? 'Abandon' : 'Demande'} ${ref}: ${JSON.stringify(d)}`);
    return emailed;
}

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
    if (tooManySends(`brouillon:${req.ip || ''}`, 120)) return res.status(204).end();
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
    try { await traiterAbandons(true); } finally { process.exit(0); }
});

app.post('/api/reprise', async (req, res) => {
    try {
        const b = req.body || {};
        // Champ piège : rempli uniquement par les robots. On répond "ok" sans rien enregistrer.
        if (b.site_web) return res.json({ success: true, id: uuidv4() });
        if (tooManySends(req.ip || '')) return res.status(429).json({ error: 'Trop de demandes. Réessayez plus tard ou écrivez-nous à contact@lunicar.fr.' });
        if (!parsePhone(b.telephone)) return res.status(400).json({ error: 'Numéro de téléphone invalide.', field: 'telephone' });

        const draftId = /^[0-9a-f-]{36}$/.test(String(b.draftId || '')) ? b.draftId : null;
        const d = construireDemande(b, draftId || uuidv4());
        if (d.type === 'estimation' && !d.vehicule) return res.status(400).json({ error: 'Indiquez la marque et le modèle.', field: 'vehicule' });
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
        if (tooManySends(`photos:${req.ip || ''}`, 6)) return res.status(429).json({ error: 'Trop d\'envois.' });
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
        if (tooManySends(req.ip || '')) return res.status(429).json({ error: 'Trop de messages. Réessayez plus tard.' });
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
        }
        console.log(`Message contact: ${JSON.stringify(message)}`);

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
const SESSION_EXPIRY = 60 * 60 * 1000; // 1 heure
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

// Stockage des tokens avec expiration
const adminSessions = new Map(); // token -> { createdAt, lastActivity }

// Stockage des tentatives de connexion par IP
const loginAttempts = new Map(); // ip -> { count, lockedUntil }

// Nettoyage périodique des sessions expirées
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of adminSessions.entries()) {
        if (now - session.lastActivity > SESSION_EXPIRY) {
            adminSessions.delete(token);
        }
    }
    // Nettoyage des blocages expirés
    for (const [ip, attempt] of loginAttempts.entries()) {
        if (attempt.lockedUntil && now > attempt.lockedUntil) {
            loginAttempts.delete(ip);
        }
    }
}, 60000); // Vérifie chaque minute

// Middleware de rate limiting pour login
function loginRateLimiter(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
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

// Middleware d'authentification admin
function authAdmin(req, res, next) {
    const authHeader = req.headers.authorization || '';
    // Images, zip et export s'ouvrent par lien : le jeton peut aussi passer en ?k=
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : String(req.query.k || '');
    if (!token) {
        return res.status(401).json({ error: 'Non autorisé' });
    }
    const session = adminSessions.get(token);

    if (!session) {
        return res.status(401).json({ error: 'Token invalide' });
    }

    // Vérifier expiration de session (1h d'inactivité)
    const now = Date.now();
    if (now - session.lastActivity > SESSION_EXPIRY) {
        adminSessions.delete(token);
        return res.status(401).json({ error: 'Session expirée' });
    }

    // Mettre à jour l'activité
    session.lastActivity = now;
    next();
}

// Login admin avec rate limiting
app.post('/api/admin/login', loginRateLimiter, (req, res) => {
    const { password } = req.body;
    const ip = req.ip || req.connection.remoteAddress;

    if (ADMIN_PASSWORD && password === ADMIN_PASSWORD) {
        // Connexion réussie - réinitialiser les tentatives
        loginAttempts.delete(ip);

        const token = uuidv4();
        const now = Date.now();
        adminSessions.set(token, {
            createdAt: now,
            lastActivity: now
        });
        res.json({ success: true, token, expiresIn: SESSION_EXPIRY });
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
            error: `Mot de passe incorrect. ${remaining} tentative(s) restante(s).`
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
    add('/reprise', '0.9');
    add('/reprise-auto-paris', '0.9', (LOCAL.paris && LOCAL.paris.updated) || T);
    add(`/${idf.HUB_SLUG}`, '0.9');
    idf.DEPARTMENTS.forEach(d => add(`/${d.slug}`, '0.8'));
    idf.SITUATIONS.forEach(s => add(`/${s.slug}`, '0.8'));
    GUIDES.forEach(g => add(`/${g.slug}`, g.brand ? '0.6' : '0.8', g.updated || T));
    zones.IDF_CITIES.filter(s => s !== 'paris').forEach(s => add(`/reprise-auto-${s}`, '0.7'));
    if (LOCAL.france) add(`/${zones.FRANCE_SLUG}`, '0.9', LOCAL.france.updated || T);
    Object.values(LOCAL.regions || {}).forEach(r => add(`/${r.slug}`, '0.8', r.updated || T));
    zones.FRANCE_CITIES.forEach(s => add(`/reprise-auto-${s}`, '0.7'));
    if (LOCAL.aPropos) add('/a-propos', '0.5');
    add('/garanties', '0.5');
    add('/articles', '0.6');
    articles.forEach(a => add(`/article/${a.slug}`, '0.6', a.dateModified || a.dateISO || T));
    add('/contact', '0.3');
    add('/mentions-legales', '0.1');
    add('/politique-confidentialite', '0.1');
    return list;
}

app.get('/sitemap.xml', (req, res) => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexablePages().map(u => `  <url><loc>${SITE.baseUrl}${u.loc === '/' ? '/' : u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`;
    res.header('Content-Type', 'application/xml');
    res.send(xml);
});

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
    res.header('Content-Type', 'text/plain; charset=utf-8');
    res.send(robots);
});

const strip = h => String(h || '').replace(/<li>/g, '\n- ').replace(/<\/(p|h2|h3|ul|ol|table|tr)>/g, '\n').replace(/<(td|th)[^>]*>/g, ' | ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
const title = t => String(t || '').replace(/<[^>]+>/g, '');

const LLMS_SUMMARY = `LUNICAR rachète les voitures de toutes marques, récentes ou non, aux particuliers et aux professionnels partout en France (Paris, Lyon, Marseille, Bordeaux, Toulouse, Lille, Nantes, Nice, Montpellier…). Le déplacement et l'enlèvement sont à sa charge partout en France. Le vendeur décrit son véhicule en ligne en deux minutes ; un conseiller le rappelle sous 24 h ouvrées avec une offre chiffrée, valable 7 jours ; le rendez-vous a lieu à l'adresse choisie ; le paiement se fait par virement bancaire le jour de la vente. LUNICAR est une marque de GUIRAK SERVICES (SAS, SIRET 947 982 856 00017).`;

app.get('/llms.txt', (req, res) => {
    const b = SITE.baseUrl;
    const articles = readJSON('articles.json');
    const llms = `# LUNICAR

> ${LLMS_SUMMARY}

Dernière mise à jour : ${pages.TEMPLATE_DATE}

## Faits clés
- Véhicules rachetés : récents (y compris sous garantie constructeur), d'occasion, SUV, premium, électriques et hybrides, utilitaires, fort kilométrage, en panne, accidentés, sans contrôle technique
- Contrôle technique non exigé : il n'est obligatoire que pour une vente entre particuliers
- Offre gratuite et sans engagement, valable 7 jours ; refus possible même le jour du rendez-vous, sans frais
- Déplacement et enlèvement à la charge de LUNICAR partout en France, y compris véhicule non roulant ou en parking souterrain
- Paiement par virement bancaire uniquement, le jour de la vente (ni espèces ni chèque)
- Certificat de cession (Cerfa 15776) et déclaration de cession ANTS préparés avec le vendeur
- Aucune obligation d'acheter un autre véhicule
- Horaires : ${SITE.hours} ; contact : ${SITE.email}

## Pages principales
- [Accueil](${b}/): présentation, déroulé, comparatif, FAQ
- [Estimation gratuite](${b}/reprise): formulaire de demande d'offre
- [Toutes les voitures](${b}/reprise-voiture-occasion): ce que LUNICAR rachète et ce qui fait le prix
- [Qui sommes-nous](${b}/a-propos): société, méthode, engagements
- [Garanties](${b}/garanties): les six engagements
- [Comparer particulier, concession et professionnel](${b}/comparatif-reprise-auto)

## Partout en France
- [Rachat de voiture partout en France](${b}/${zones.FRANCE_SLUG})
${Object.values(LOCAL.regions || {}).map(r => `- [Rachat de voiture en ${r.region}](${b}/${r.slug}): ${r.description}`).join('\n')}
${zones.FRANCE_CITIES.slice(0, 40).map(s => { const c = CITIES.find(x => x.slug === s); return c ? `- [Rachat de voiture à ${c.nom}](${b}/reprise-auto-${s})` : ''; }).filter(Boolean).join('\n')}

## Paris et Île-de-France
- [Rachat de voiture à Paris](${b}/reprise-auto-paris)
- [Rachat de voiture en Île-de-France](${b}/${idf.HUB_SLUG})
${idf.DEPARTMENTS.map(d => `- [Rachat de voiture ${d.dans} (${d.code})](${b}/${d.slug})`).join('\n')}

## Situations
${idf.SITUATIONS.map(s => `- [${title(s.h1)}](${b}/${s.slug}): ${s.description}`).join('\n')}
${GUIDES.filter(g => !g.brand).map(g => `- [${title(g.h1)}](${b}/${g.slug}): ${g.description}`).join('\n')}

## Marques
${GUIDES.filter(g => g.brand).map(g => `- [${g.brand}](${b}/${g.slug}): ${g.description}`).join('\n')}

## Conseils
${articles.map(a => `- [${a.titre}](${b}/article/${a.slug}): ${a.extrait}`).join('\n')}

## Optional
- [Texte intégral des pages clés](${b}/llms-full.txt)
- [Plan du site](${b}/sitemap.xml)
`;
    res.header('Content-Type', 'text/plain; charset=utf-8');
    res.send(llms);
});

// Version longue : le texte des pages piliers, pour les assistants qui lisent un seul fichier.
app.get('/llms-full.txt', (req, res) => {
    const b = SITE.baseUrl;
    const block = (url, h, lede, sections, faq) => `# ${title(h)}\nURL : ${url}\n\n${lede ? lede + '\n\n' : ''}${(sections || []).map(s => `## ${title(s.h2)}\n\n${strip(s.html)}`).join('\n\n')}${faq && faq.length ? '\n\n## Questions fréquentes\n\n' + faq.map(f => `**${f.question}**\n${strip(f.answer)}`).join('\n\n') : ''}\n`;
    const parts = [`# LUNICAR\n\n> ${LLMS_SUMMARY}\n\nDernière mise à jour : ${pages.TEMPLATE_DATE}\n`];
    if (LOCAL.aPropos) parts.push(block(`${b}/a-propos`, LOCAL.aPropos.h1, LOCAL.aPropos.lede, LOCAL.aPropos.sections, LOCAL.aPropos.faq));
    if (LOCAL.france) parts.push(block(`${b}/${zones.FRANCE_SLUG}`, LOCAL.france.h1, LOCAL.france.lede, LOCAL.france.sections, LOCAL.france.faq));
    if (LOCAL.paris) parts.push(block(`${b}/reprise-auto-paris`, LOCAL.paris.h1, LOCAL.paris.lede, LOCAL.paris.sections, LOCAL.paris.faq));
    idf.SITUATIONS.forEach(s => parts.push(block(`${b}/${s.slug}`, s.h1, s.lede, s.sections, s.faq)));
    GUIDES.filter(g => !g.brand).forEach(g => parts.push(block(`${b}/${g.slug}`, g.h1, g.lede, g.sections, g.faq)));
    res.header('Content-Type', 'text/plain; charset=utf-8');
    res.send(parts.join('\n---\n\n'));
});

// IndexNow (Bing, Yandex, Seznam… ; Bing alimente ChatGPT) : clé publique servie à la racine,
// soumission de toutes les URL au démarrage en production, donc à chaque déploiement.
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || crypto.createHash('sha256').update('lunicar-indexnow-' + SITE.baseUrl).digest('hex').slice(0, 32);
app.get(`/${INDEXNOW_KEY}.txt`, (req, res) => res.type('text/plain').send(INDEXNOW_KEY));

function pingIndexNow() {
    const urlList = indexablePages().map(u => SITE.baseUrl + (u.loc === '/' ? '/' : u.loc));
    const body = JSON.stringify({ host: new URL(SITE.baseUrl).host, key: INDEXNOW_KEY, keyLocation: `${SITE.baseUrl}/${INDEXNOW_KEY}.txt`, urlList });
    fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body })
        .then(r => console.log(`IndexNow : ${urlList.length} URL soumises (HTTP ${r.status})`))
        .catch(e => console.log('IndexNow indisponible :', e.message));
}
if (typeof fetch === 'function' && (process.env.RENDER || process.env.INDEXNOW_PING === '1')) setTimeout(pingIndexNow, 30000).unref();

// Route admin cachée
app.get('/admino', (req, res) => {
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

// Démarrage serveur
app.listen(PORT, () => {
    console.log(`\n🚗 LUNICAR Server démarré sur http://localhost:${PORT}\n`);
});

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
