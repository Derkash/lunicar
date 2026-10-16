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

const CSP = [
    "default-src 'self'",
    "script-src 'self' https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://www.google-analytics.com https://www.googletagmanager.com",
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

// ============ API PLAQUE ============

// Datation maison toujours ; caractéristiques SIV si une clé API est configurée.
app.get('/api/vehicule/:plaque', async (req, res) => {
    if (tooManySends(`plaque:${req.ip || ''}`, 12)) return res.status(429).json({ error: 'Trop de recherches.' });
    const r = await fichePlaque.rechercher(req.params.plaque);
    res.set('Cache-Control', 'no-store').json(r);
});

// Le vendeur nous transmet le lien de partage de son rapport Histovec.
app.post('/api/reprise/histovec', async (req, res) => {
    const b = req.body || {};
    const id = String(b.id || '').trim();
    const lien = String(b.lien || '').trim().slice(0, 600);
    if (tooManySends(`histovec:${req.ip || ''}`, 6)) return res.status(429).json({ error: 'Trop d\'envois.' });
    const ok = /^https:\/\/histovec\.interieur\.gouv\.fr\/\S+$/.test(lien) || /^[A-Za-z0-9_-]{6,64}$/.test(lien);
    if (!ok) return res.status(400).json({ error: 'Collez le lien de partage Histovec (il commence par https://histovec.interieur.gouv.fr).' });
    const demandes = readJSON('demandes.json');
    const d = demandes.find(x => x.id === id);
    if (d) { d.histovec = lien; writeJSON('demandes.json', demandes); }
    const ref = id.substring(0, 8).toUpperCase() || 'INCONNUE';
    try {
        await sendEmail({
            subject: `📄 Histovec reçu · réf. ${ref}${d ? ` · ${d.vehicule} · ${d.telephone}` : ''}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:560px">
<p>Le vendeur de la demande <strong>${esc(ref)}</strong>${d ? ` (${esc(d.prenom)}, ${esc(d.vehicule)}, ${esc(d.telephone)})` : ''} a transmis son rapport Histovec :</p>
<p><a href="${esc(lien.startsWith('http') ? lien : 'https://histovec.interieur.gouv.fr')}" style="font-weight:700">${esc(lien)}</a></p>
<p style="color:#6F6B64;font-size:13px">À ouvrir dans le navigateur. Lien valable jusqu'au 8 du mois suivant son partage : à consulter rapidement.</p></div>`
        });
    } catch (e) { console.error('❌ Erreur envoi email:', e.message); }
    console.log(`Histovec reçu pour ${ref}: ${lien}`);
    res.json({ success: true });
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
        const plaqueInfo = b.plaque ? fichePlaque.analyser(b.plaque) : null;
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
            plaque_datation: plaqueInfo && plaqueInfo.libelle ? plaqueInfo.libelle : '',
            fiche_confirmee: clean(b.fiche, 300),
            prix_souhaite: clean(b.prix, 10).replace(/[^\d]/g, ''),
            etat,
            prenom: clean(b.prenom, 60),
            nom: clean(b.nom, 80),
            whatsapp_ok: b.whatsapp === 'oui',
            titulaire: ['oui', 'non'].includes(b.titulaire) ? b.titulaire : '',
            nom_titulaire: clean(b.nomTitulaire, 80),
            date_certificat: clean(b.dateCertificat, 10),
            numero_formule: clean(b.numeroFormule, 14).toUpperCase().replace(/[^A-Z0-9]/g, ''),
            consent_histovec: b.consentHistovec === 'oui',
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
    <div style="font-size:22px;font-weight:700;margin-top:6px">${esc([demande.prenom, demande.nom].filter(Boolean).join(' ') || 'Sans nom')} · <a href="tel:+${phone.intl}" style="color:#fff">${phone.display}</a></div>
  </div>
  <div style="background:#fff;padding:20px 22px;border-radius:0 0 10px 10px">
    <p style="margin:0 0 16px"><a href="tel:+${phone.intl}" style="display:inline-block;background:#B8923A;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Appeler ${phone.display}</a>
    &nbsp; ${demande.whatsapp_ok ? `<a href="https://wa.me/${phone.intl}" style="color:#0D2541;font-weight:700">WhatsApp ✓ accepté</a>` : '<span style="color:#9C978E">WhatsApp non autorisé</span>'}</p>
    <table style="border-collapse:collapse;font-size:15px;width:100%">
      ${row('Véhicule', esc(demande.vehicule))}
      ${row('Année', esc(demande.annee))}
      ${row('Kilométrage', demande.kilometrage ? `${Number(demande.kilometrage).toLocaleString('fr-FR')} km` : '')}
      ${row('Prix souhaité', demande.prix_souhaite ? `${Number(demande.prix_souhaite).toLocaleString('fr-FR')} €` : '')}
      ${row('Plaque', esc(demande.plaque) + (demande.plaque_datation ? `<br><span style="font-weight:400;color:#6F6B64">${esc(demande.plaque_datation)}</span>` : ''))}
      ${row('Fiche plaque', esc(demande.fiche_confirmee))}
      ${row('Particularités', esc(etat.join(', ')))}
      ${row('Code postal', demande.code_postal ? `${esc(demande.code_postal)}${idfCp ? ' · Île-de-France' : ''}` : '')}
      ${row('E-mail', demande.email ? `<a href="mailto:${esc(demande.email)}">${esc(demande.email)}</a>` : '')}
      ${row('Page', esc(demande.page))}
      ${row('Provenance', esc(demande.provenance))}
      ${row('Photos', attachments.length ? `${attachments.length} en pièce jointe` : '')}
    </table>
    ${(demande.numero_formule || demande.date_certificat || demande.nom_titulaire) ? `<div style="margin-top:16px;padding:14px 16px;background:#F5F1E8;border-radius:8px">
      <div style="font-weight:700;color:#0D2541;margin-bottom:6px">Carte grise · Histovec ${demande.consent_histovec ? '<span style="color:#2C7A4B">· consultation autorisée</span>' : '<span style="color:#A8423F">· consultation NON autorisée</span>'}</div>
      <table style="border-collapse:collapse;font-size:14px">
        ${row('Titulaire de la CG', demande.titulaire ? (demande.titulaire === 'oui' ? 'Oui' : 'Non') : '')}
        ${row('Nom (C.1)', esc(demande.nom_titulaire))}
        ${row('Date du certificat (I)', esc(demande.date_certificat))}
        ${row('N° de formule', esc(demande.numero_formule))}
      </table>
      ${demande.consent_histovec ? `<p style="margin:10px 0 0"><a href="https://histovec.interieur.gouv.fr/histovec/proprietaire" style="font-weight:700;color:#0D2541">Ouvrir Histovec (espace propriétaire) →</a></p>` : ''}
    </div>` : ''}
    <p style="margin:16px 0 0;font-size:13px;color:#6F6B64">Historique officiel : demander au vendeur son rapport <a href="https://histovec.interieur.gouv.fr">Histovec</a> (gratuit, généré avec sa carte grise).</p>
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
