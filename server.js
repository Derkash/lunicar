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
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
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
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

const html = (res, doc, status = 200) => res.status(status).type('html').send(doc);

app.get('/', (req, res) => {
    html(res, pages.home({ cities: readJSON('cities.json'), themes: readJSON('themes.json'), articles: readJSON('articles.json') }));
});

app.get('/reprise', (req, res) => html(res, pages.reprise()));

// ============ REDIRECTIONS 301 anti-cannibalisation SEO ============
// Map: ancienne URL -> URL canonique gardée. Une intention = une page.
const SEO_REDIRECTS = {
    // Cluster "rapidité" -> rachat-voiture-rapide
    'reprise-auto-24h': 'rachat-voiture-rapide',
    'reprise-auto-immediate': 'rachat-voiture-rapide',
    'vendre-sa-voiture-rapidement': 'rachat-voiture-rapide',
    'reprise-voiture-48h': 'rachat-voiture-rapide',
    // Cluster "sans CT" -> rachat-voiture-sans-controle-technique
    'reprise-auto-sans-ct': 'rachat-voiture-sans-controle-technique',
    'reprise-auto-sans-controle-technique': 'rachat-voiture-sans-controle-technique',
    'vendre-voiture-sans-ct': 'rachat-voiture-sans-controle-technique',
    'rachat-vehicule-sans-revision': 'rachat-voiture-sans-controle-technique',
    // Cluster "panne / HS / non roulante" -> page dédiée
    'reprise-voiture-en-panne': 'rachat-voiture-en-panne-paris',
    'reprise-voiture-non-roulante': 'rachat-voiture-en-panne-paris',
    'rachat-voiture-moteur-hs': 'rachat-voiture-en-panne-paris',
    // Cluster "paiement cash" -> rachat-voiture-paiement-cash
    'vendre-voiture-paiement-comptant': 'rachat-voiture-paiement-cash',
    'rachat-voiture-virement-immediat': 'rachat-voiture-paiement-cash',
    'reprise-auto-paiement-immediat': 'rachat-voiture-paiement-cash'
};

Object.keys(SEO_REDIRECTS).forEach(oldSlug => {
    app.get(`/${oldSlug}`, (req, res) => {
        res.redirect(301, `/${SEO_REDIRECTS[oldSlug]}`);
    });
});

// Île-de-France : région, départements, pages par situation
app.get(`/${idf.HUB_SLUG}`, (req, res) => html(res, pages.hub(readJSON('cities.json'))));
idf.DEPARTMENTS.forEach(d => {
    app.get(`/${d.slug}`, (req, res) => html(res, pages.department(d, readJSON('cities.json'))));
});
idf.SITUATIONS.forEach(s => {
    app.get(`/${s.slug}`, (req, res) => html(res, pages.situation(s)));
});

// Pages thématiques (data/themes.json), hors slugs redirigés
readJSON('themes.json').forEach(({ slug }) => {
    if (SEO_REDIRECTS[slug]) return;
    app.get(`/${slug}`, (req, res) => {
        const themes = readJSON('themes.json');
        const theme = themes.find(t => t.slug === slug);
        if (!theme) return html(res, pages.notFound(), 404);
        html(res, pages.theme(theme, themes));
    });
});

// Pages villes (déclarées après les redirections et les thématiques en "reprise-auto-*")
app.get('/reprise-auto-:slug', (req, res) => {
    const cities = readJSON('cities.json');
    const city = cities.find(c => c.slug === req.params.slug);
    if (!city) return html(res, pages.notFound(), 404);
    html(res, pages.city(city, cities));
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
app.get('/mentions-legales', (req, res) => html(res, pages.legal('mentions-legales', 'Mentions légales | LUNICAR', 'Mentions légales du site lunicar.fr, édité par GUIRAK SERVICES.')));
app.get('/politique-confidentialite', (req, res) => html(res, pages.legal('politique-confidentialite', 'Politique de confidentialité | LUNICAR', 'Comment LUNICAR collecte, utilise et protège vos données personnelles.')));

// ============ API VILLES ============

app.get('/api/villes', (req, res) => {
    const cities = readJSON('cities.json');
    res.json(cities);
});

app.get('/api/villes/:slug', (req, res) => {
    const cities = readJSON('cities.json');
    const city = cities.find(c => c.slug === req.params.slug);
    if (city) {
        res.json(city);
    } else {
        res.status(404).json({ error: 'Ville non trouvée' });
    }
});

// ============ API THEMES ============

app.get('/api/themes', (req, res) => {
    const themes = readJSON('themes.json');
    res.json(themes);
});

app.get('/api/themes/:slug', (req, res) => {
    const themes = readJSON('themes.json');
    const theme = themes.find(t => t.slug === req.params.slug);
    if (theme) {
        res.json(theme);
    } else {
        res.status(404).json({ error: 'Page non trouvée' });
    }
});

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

// ============ API DEMANDES (estimation + rappel) ============

const ETAT_LABELS = { panne: 'En panne / ne roule plus', accident: 'Accidentée', ct: 'Sans CT valide' };

app.post('/api/reprise', upload.array('photos', 10), async (req, res) => {
    try {
        const b = req.body || {};
        // Champ piège : rempli uniquement par les robots. On répond "ok" sans rien enregistrer.
        if (b.site_web) return res.json({ success: true, id: uuidv4() });

        const ip = req.ip || '';
        if (tooManySends(ip)) return res.status(429).json({ error: 'Trop de demandes. Réessayez plus tard ou écrivez-nous à contact@lunicar.fr.' });

        const clean = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
        const phone = parsePhone(b.telephone);
        if (!phone) return res.status(400).json({ error: 'Numéro de téléphone invalide.', field: 'telephone' });

        const type = b.type === 'rappel' ? 'rappel' : 'estimation';
        // Ancien formulaire : marque + modèle séparés.
        const vehicule = clean(b.vehicule || [b.marque, b.modele].filter(Boolean).join(' '));
        if (type === 'estimation' && !vehicule) return res.status(400).json({ error: 'Indiquez la marque et le modèle.', field: 'vehicule' });

        const etat = [].concat(b.etat || []).map(e => ETAT_LABELS[e]).filter(Boolean);
        const referenceId = uuidv4();
        const ref = referenceId.substring(0, 8).toUpperCase();

        const demande = {
            id: referenceId,
            statut: 'nouvelle',
            type,
            plaque: clean(b.plaque, 12).toUpperCase(),
            vehicule,
            annee: clean(b.annee, 12),
            kilometrage: clean(b.kilometrage, 12).replace(/[^\d]/g, ''),
            etat,
            prenom: clean(b.prenom, 60),
            telephone: phone.display,
            email: clean(b.email, 120),
            code_postal: clean(b.codePostal, 5).replace(/[^\d]/g, ''),
            source: clean(b.source, 80),
            page: clean(b.page, 200),
            provenance: clean(b.provenance, 300),
            photos: req.files ? req.files.map(f => f.filename) : [],
            createdAt: new Date().toISOString()
        };

        const demandes = readJSON('demandes.json');
        demandes.unshift(demande);
        writeJSON('demandes.json', demandes);

        const attachments = (req.files || []).map((file, i) => ({ filename: `photo_${i + 1}${path.extname(file.originalname)}`, path: file.path }));
        const row = (label, value) => value ? `<tr><td style="padding:6px 12px 6px 0;color:#6F6B64;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:6px 0;color:#0D1B2A;font-weight:600">${value}</td></tr>` : '';
        const idfCp = /^(75|77|78|91|92|93|94|95)/.test(demande.code_postal);
        const emailHtml = `<!DOCTYPE html><html><body style="margin:0;background:#F5F1E8;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:20px">
  <div style="background:#0D2541;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
    <div style="font-size:13px;letter-spacing:1px;color:#D4B26A">LUNICAR · ${type === 'rappel' ? 'DEMANDE DE RAPPEL' : 'DEMANDE D\'ESTIMATION'}</div>
    <div style="font-size:22px;font-weight:700;margin-top:6px">${esc(demande.prenom || 'Sans prénom')} · <a href="tel:+${phone.intl}" style="color:#fff">${phone.display}</a></div>
  </div>
  <div style="background:#fff;padding:20px 22px;border-radius:0 0 10px 10px">
    <p style="margin:0 0 16px"><a href="tel:+${phone.intl}" style="display:inline-block;background:#B8923A;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Appeler ${phone.display}</a>
    &nbsp; <a href="https://wa.me/${phone.intl}" style="color:#0D2541;font-weight:700">WhatsApp</a></p>
    <table style="border-collapse:collapse;font-size:15px;width:100%">
      ${row('Véhicule', esc(demande.vehicule))}
      ${row('Année', esc(demande.annee))}
      ${row('Kilométrage', demande.kilometrage ? `${Number(demande.kilometrage).toLocaleString('fr-FR')} km` : '')}
      ${row('Plaque', esc(demande.plaque))}
      ${row('Particularités', esc(etat.join(', ')))}
      ${row('Code postal', demande.code_postal ? `${esc(demande.code_postal)}${idfCp ? ' · Île-de-France' : ''}` : '')}
      ${row('E-mail', demande.email ? `<a href="mailto:${esc(demande.email)}">${esc(demande.email)}</a>` : '')}
      ${row('Page', esc(demande.page))}
      ${row('Provenance', esc(demande.provenance))}
      ${row('Photos', attachments.length ? `${attachments.length} en pièce jointe` : '')}
    </table>
    <p style="margin:18px 0 0;font-size:12px;color:#9C978E">Réf. ${ref} · reçue le ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}</p>
  </div>
</div></body></html>`;

        let emailed = false;
        try {
            const result = await sendEmail({
                subject: `${type === 'rappel' ? '📞 Rappel' : '🚗 Estimation'} ${demande.code_postal || ''} · ${demande.vehicule || demande.prenom} ${demande.annee || ''} · ${phone.display}`.replace(/\s+/g, ' '),
                html: emailHtml,
                replyTo: demande.email || undefined,
                attachments
            });
            emailed = !result.simulated;
        } catch (emailError) {
            console.error('❌ Erreur envoi email:', emailError.message);
        }
        // Le disque de Render est effacé à chaque déploiement : sans e-mail, la demande
        // ne survit que dans les journaux. On la journalise donc toujours en entier.
        console.log(`${emailed ? '✅' : '🚨 NON ENVOYÉE PAR E-MAIL'} Demande ${ref}: ${JSON.stringify(demande)}`);

        res.json({ success: true, id: referenceId });
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur lors de l\'enregistrement' });
    }
});

// ============ API CONTACT ============

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

        const messages = readJSON('messages.json');
        messages.unshift(message);
        writeJSON('messages.json', messages);

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
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Non autorisé' });
    }
    const token = authHeader.split(' ')[1];
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
app.get('/api/admin/stats', authAdmin, (req, res) => {
    try {
        const articles = readJSON('articles.json');
        const demandes = readJSON('demandes.json');
        const messages = readJSON('messages.json');

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

// ============ SEO - SITEMAP & ROBOTS ============

// Date du dernier déploiement : sert de <lastmod> aux pages générées par gabarit.
const DEPLOY_DATE = new Date().toISOString().split('T')[0];

app.get('/sitemap.xml', (req, res) => {
    const baseUrl = SITE.baseUrl;
    const articles = readJSON('articles.json');
    const cities = readJSON('cities.json');
    const themes = readJSON('themes.json');
    const urls = [];
    const add = (loc, priority, lastmod = DEPLOY_DATE) => urls.push({ loc, priority, lastmod });

    add('/', '1.0');
    add('/reprise', '0.9');
    add(`/${idf.HUB_SLUG}`, '0.9');
    idf.SITUATIONS.forEach(s => add(`/${s.slug}`, '0.9'));
    idf.DEPARTMENTS.forEach(d => add(`/${d.slug}`, '0.9'));
    cities.filter(idf.isIdf).forEach(c => add(`/reprise-auto-${c.slug}`, '0.8'));
    themes.forEach(t => { if (!SEO_REDIRECTS[t.slug]) add(`/${t.slug}`, '0.6'); });
    cities.filter(c => !idf.isIdf(c)).forEach(c => add(`/reprise-auto-${c.slug}`, '0.5'));
    add('/garanties', '0.5');
    add('/articles', '0.5');
    articles.forEach(a => add(`/article/${a.slug}`, '0.5', a.dateISO || DEPLOY_DATE));
    add('/contact', '0.4');
    add('/mentions-legales', '0.1');
    add('/politique-confidentialite', '0.1');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${baseUrl}${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`;
    res.header('Content-Type', 'application/xml');
    res.send(xml);
});

app.get('/robots.txt', (req, res) => {
    const robots = `# LUNICAR - Robots.txt
User-agent: *
Allow: /
Disallow: /admin
Disallow: /admino
Disallow: /api/
Disallow: /uploads/

Sitemap: ${SITE.baseUrl}/sitemap.xml
`;
    res.header('Content-Type', 'text/plain');
    res.send(robots);
});

// llms.txt - guide les moteurs IA (ChatGPT, Perplexity, Claude) vers le contenu clé
app.get('/llms.txt', (req, res) => {
    const baseUrl = SITE.baseUrl;
    const llms = `# LUNICAR

> LUNICAR rachète les voitures d'occasion des particuliers et des professionnels à Paris, en Île-de-France et, sur demande, dans le reste de la France. Offre de prix sous 24 h ouvrées, valable 7 jours, déplacement à l'adresse du vendeur, paiement par virement bancaire. Les véhicules en panne, accidentés, non roulants ou sans contrôle technique valide sont acceptés.

## Points clés
- Demande d'estimation gratuite et sans engagement, en deux minutes
- Contrôle technique non exigé : il n'est obligatoire que pour une vente entre particuliers
- Véhicules en panne, moteur HS, accidentés ou non roulants rachetés en l'état, enlèvement sur place
- Paiement par virement bancaire uniquement (ni espèces ni chèque)
- Certificat de cession et déclaration de cession préparés avec le vendeur
- Zone prioritaire : Paris (75), Hauts-de-Seine (92), Seine-Saint-Denis (93), Val-de-Marne (94), Val-d'Oise (95), Essonne (91), Yvelines (78), Seine-et-Marne (77)

## Pages principales
- [Faire estimer ma voiture](${baseUrl}/reprise)
- [Rachat de voiture en Île-de-France](${baseUrl}/${idf.HUB_SLUG})
${idf.SITUATIONS.map(s => `- [${s.h1.replace(/<[^>]+>/g, '')}](${baseUrl}/${s.slug})`).join('\n')}
${idf.DEPARTMENTS.map(d => `- [Rachat de voiture ${d.dans} (${d.code})](${baseUrl}/${d.slug})`).join('\n')}
- [Rachat de voiture à Paris](${baseUrl}/reprise-auto-paris)
- [Nos garanties](${baseUrl}/garanties)
- [Conseils pour vendre sa voiture](${baseUrl}/articles)

## Contact
- E-mail : ${SITE.email}${SITE.phone ? `\n- Téléphone : ${SITE.phone.display}` : ''}
- Horaires : ${SITE.hours}
`;
    res.header('Content-Type', 'text/plain; charset=utf-8');
    res.send(llms);
});

// Route admin cachée
app.get('/admino', (req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(path.join(__dirname, 'public', 'admino.html'));
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
