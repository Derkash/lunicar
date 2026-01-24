require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

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
    transporter.verify((error, success) => {
        if (error) {
            console.log('⚠️  Configuration email non valide:', error.message);
        } else {
            console.log('✅ Serveur email prêt');
        }
    });
} else {
    console.log('⚠️  Configuration email manquante (voir .env.example)');
}

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
app.use(express.static(path.join(__dirname, 'public')));
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

    // Ajouter les pièces jointes si présentes
    if (options.attachments && options.attachments.length > 0) {
        mailOptions.attachments = options.attachments;
    }

    return transporter.sendMail(mailOptions);
}

// ============ ROUTES PAGES ============

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/reprise', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reprise.html'));
});

// Route dynamique pour les pages villes SEO
app.get('/reprise-auto-:slug', (req, res) => {
    const cities = readJSON('cities.json');
    const city = cities.find(c => c.slug === req.params.slug);
    if (city) {
        res.sendFile(path.join(__dirname, 'public', 'reprise-ville.html'));
    } else {
        res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Routes dynamiques pour les pages thématiques SEO
const thematicRoutes = [
    // Rapidité
    'reprise-auto-24h', 'reprise-auto-immediate', 'rachat-voiture-rapide',
    'vendre-sa-voiture-rapidement', 'reprise-voiture-48h',
    // Sans contraintes
    'rachat-voiture-sans-controle-technique', 'reprise-auto-sans-ct',
    'vendre-voiture-sans-ct', 'rachat-vehicule-sans-revision',
    'reprise-voiture-en-panne', 'rachat-voiture-accidentee',
    'reprise-voiture-non-roulante', 'rachat-voiture-moteur-hs',
    'reprise-auto-sans-carte-grise',
    // Paiement
    'reprise-auto-paiement-immediat', 'rachat-voiture-paiement-cash',
    'vendre-voiture-paiement-comptant', 'reprise-auto-cheque-de-banque',
    'rachat-voiture-virement-immediat',
    // Type de véhicule
    'reprise-voiture-occasion', 'rachat-voiture-ancienne',
    'reprise-voiture-haut-kilometrage', 'rachat-vehicule-utilitaire',
    'reprise-suv', 'rachat-berline', 'reprise-citadine', 'rachat-monospace',
    'reprise-voiture-diesel', 'reprise-voiture-essence', 'rachat-voiture-hybride',
    'reprise-voiture-electrique', 'rachat-voiture-gpl',
    // Marques
    'reprise-renault', 'reprise-peugeot', 'reprise-citroen', 'reprise-volkswagen',
    'reprise-toyota', 'reprise-ford', 'reprise-opel', 'reprise-audi',
    'reprise-bmw', 'reprise-mercedes', 'reprise-nissan', 'reprise-fiat',
    'reprise-dacia', 'reprise-hyundai', 'reprise-kia',
    'reprise-ds', 'reprise-alpine', 'reprise-porsche', 'reprise-mini',
    'reprise-honda', 'reprise-mazda', 'reprise-suzuki', 'reprise-mitsubishi',
    'reprise-lexus', 'reprise-tesla', 'reprise-jeep', 'reprise-alfa-romeo',
    'reprise-land-rover', 'reprise-jaguar', 'reprise-mg', 'reprise-volvo',
    'reprise-seat', 'reprise-cupra', 'reprise-skoda', 'reprise-byd',
    // Situations
    'vendre-voiture-particulier', 'rachat-voiture-professionnel',
    'reprise-voiture-leasing', 'vendre-voiture-credit', 'reprise-voiture-succession',
    'rachat-voiture-divorce', 'vendre-voiture-demenagement', 'reprise-voiture-expatriation',
    // Alternatives
    'alternative-leboncoin', 'alternative-lacentrale',
    'mieux-que-concessionnaire', 'comparatif-reprise-auto'
];

thematicRoutes.forEach(route => {
    app.get(`/${route}`, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'reprise-theme.html'));
    });
});

app.get('/articles', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'articles.html'));
});

app.get('/article/:slug', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'article.html'));
});

app.get('/garanties', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'garanties.html'));
});

app.get('/contact', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'contact.html'));
});

app.get('/mentions-legales', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'mentions-legales.html'));
});

app.get('/politique-confidentialite', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'politique-confidentialite.html'));
});

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

// ============ API REPRISE ============

app.post('/api/reprise', upload.array('photos', 10), async (req, res) => {
    try {
        const referenceId = uuidv4();

        const nouvelleDemande = {
            id: referenceId,
            statut: 'nouvelle',
            plaque: req.body.plaque,
            marque: req.body.marque,
            modele: req.body.modele,
            annee: req.body.annee,
            kilometrage: req.body.kilometrage,
            carburant: req.body.carburant,
            boite: req.body.boite,
            etat_exterieur: req.body.etatExterieur,
            etat_interieur: req.body.etatInterieur,
            etat_mecanique: req.body.etatMecanique,
            commentaires: req.body.commentaires || '',
            delai_vente: req.body.delaiVente || '',
            civilite: req.body.civilite,
            nom: req.body.nom,
            prenom: req.body.prenom,
            email: req.body.email,
            telephone: req.body.telephone,
            code_postal: req.body.codePostal,
            photos: req.files ? req.files.map(f => f.filename) : [],
            createdAt: new Date().toISOString()
        };

        // Sauvegarder dans le fichier JSON local
        const demandes = readJSON('demandes.json');
        demandes.unshift(nouvelleDemande);
        writeJSON('demandes.json', demandes);

        // Préparer les pièces jointes (images)
        const attachments = [];
        if (req.files && req.files.length > 0) {
            req.files.forEach((file, index) => {
                attachments.push({
                    filename: `photo_${index + 1}${path.extname(file.originalname)}`,
                    path: file.path,
                    cid: `photo${index + 1}`
                });
            });
        }

        // Fonction pour déterminer la couleur du badge délai
        const getDelaiColor = (delai) => {
            if (delai === 'Des que possible') return '#EF4444';
            if (delai === 'Dans la semaine') return '#F59E0B';
            if (delai === 'Dans le mois') return '#3B82F6';
            return '#6B7280';
        };

        // Préparer les données pour l'email (camelCase)
        const demandeEmail = {
            ...nouvelleDemande,
            etatExterieur: nouvelleDemande.etat_exterieur,
            etatInterieur: nouvelleDemande.etat_interieur,
            etatMecanique: nouvelleDemande.etat_mecanique,
            delaiVente: nouvelleDemande.delai_vente,
            codePostal: nouvelleDemande.code_postal
        };

        // Envoi email de notification
        const emailHtml = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #0F172A; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; color: #F59E0B; }
        .content { background: #f8f9fa; padding: 20px; border: 1px solid #ddd; }
        .section { background: white; padding: 15px; margin-bottom: 15px; border-radius: 8px; border-left: 4px solid #3B82F6; }
        .section h3 { margin-top: 0; color: #0F172A; }
        .label { font-weight: bold; color: #666; }
        .value { color: #333; }
        .footer { background: #0F172A; color: #999; padding: 15px; text-align: center; font-size: 12px; border-radius: 0 0 8px 8px; }
        .ref { background: #F59E0B; color: #0F172A; padding: 10px 20px; border-radius: 4px; font-weight: bold; display: inline-block; }
        .urgence { background: ${getDelaiColor(demandeEmail.delaiVente)}; color: white; padding: 12px 20px; border-radius: 8px; text-align: center; margin-bottom: 15px; }
        .urgence-label { font-size: 12px; text-transform: uppercase; opacity: 0.9; }
        .urgence-value { font-size: 18px; font-weight: bold; margin-top: 4px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>LUNICAR</h1>
            <p>Nouvelle demande de reprise</p>
        </div>
        <div class="content">
            <p style="text-align: center;"><span class="ref">REF: ${referenceId.substring(0, 8).toUpperCase()}</span></p>

            <div class="urgence">
                <div class="urgence-label">Delai de vente souhaite</div>
                <div class="urgence-value">${demandeEmail.delaiVente || 'Non specifie'}</div>
            </div>

            <div class="section">
                <h3>🚗 Vehicule</h3>
                <p><span class="label">Plaque:</span> <span class="value">${demandeEmail.plaque}</span></p>
                <p><span class="label">Marque / Modele:</span> <span class="value">${demandeEmail.marque} ${demandeEmail.modele}</span></p>
                <p><span class="label">Annee:</span> <span class="value">${demandeEmail.annee}</span></p>
                <p><span class="label">Kilometrage:</span> <span class="value">${demandeEmail.kilometrage} km</span></p>
                <p><span class="label">Carburant:</span> <span class="value">${demandeEmail.carburant}</span></p>
                <p><span class="label">Boite:</span> <span class="value">${demandeEmail.boite}</span></p>
            </div>

            <div class="section">
                <h3>📋 Etat du vehicule</h3>
                <p><span class="label">Exterieur:</span> <span class="value">${demandeEmail.etatExterieur}</span></p>
                <p><span class="label">Interieur:</span> <span class="value">${demandeEmail.etatInterieur}</span></p>
                <p><span class="label">Mecanique:</span> <span class="value">${demandeEmail.etatMecanique}</span></p>
                ${demandeEmail.commentaires ? `<p><span class="label">Commentaires:</span> <span class="value">${demandeEmail.commentaires}</span></p>` : ''}
            </div>

            <div class="section">
                <h3>👤 Contact</h3>
                <p><span class="label">Nom:</span> <span class="value">${demandeEmail.civilite} ${demandeEmail.prenom} ${demandeEmail.nom}</span></p>
                <p><span class="label">Email:</span> <span class="value"><a href="mailto:${demandeEmail.email}">${demandeEmail.email}</a></span></p>
                <p><span class="label">Telephone:</span> <span class="value"><a href="tel:${demandeEmail.telephone}">${demandeEmail.telephone}</a></span></p>
                <p><span class="label">Code postal:</span> <span class="value">${demandeEmail.codePostal}</span></p>
            </div>

            ${attachments.length > 0 ? `
            <div class="section">
                <h3>📷 Photos</h3>
                <p><strong>${attachments.length} photo(s) jointe(s) a cet email</strong></p>
                <p style="color: #666; font-size: 13px;">Les images sont disponibles en pieces jointes de cet email.</p>
            </div>
            ` : ''}
        </div>
        <div class="footer">
            <p>LUNICAR - Reprise automobile professionnelle</p>
            <p>Email recu le ${new Date().toLocaleDateString('fr-FR')} a ${new Date().toLocaleTimeString('fr-FR')}</p>
        </div>
    </div>
</body>
</html>`;

        try {
            await sendEmail({
                subject: `🚗 Nouvelle demande de reprise - ${demandeEmail.marque} ${demandeEmail.modele} - REF: ${referenceId.substring(0, 8).toUpperCase()}`,
                html: emailHtml,
                attachments: attachments
            });
            console.log('✅ Email de notification envoyé avec ' + attachments.length + ' pièce(s) jointe(s)');
        } catch (emailError) {
            console.error('❌ Erreur envoi email:', emailError.message);
        }

        res.json({
            success: true,
            message: 'Demande enregistrée avec succès',
            id: referenceId
        });
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur lors de l\'enregistrement' });
    }
});

// ============ API CONTACT ============

app.post('/api/contact', async (req, res) => {
    try {
        const messageId = uuidv4();

        const nouveauMessage = {
            id: messageId,
            lu: false,
            nom: req.body.nom,
            email: req.body.email,
            telephone: req.body.telephone || '',
            sujet: req.body.sujet,
            message: req.body.message,
            createdAt: new Date().toISOString()
        };

        // Sauvegarder dans le fichier JSON local
        const messages = readJSON('messages.json');
        messages.unshift(nouveauMessage);
        writeJSON('messages.json', messages);

        // Envoi email de notification
        const emailHtml = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #0F172A; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; color: #F59E0B; }
        .content { background: #f8f9fa; padding: 20px; border: 1px solid #ddd; }
        .section { background: white; padding: 15px; border-radius: 8px; border-left: 4px solid #3B82F6; }
        .label { font-weight: bold; color: #666; }
        .message-box { background: #f0f0f0; padding: 15px; border-radius: 8px; margin-top: 15px; }
        .footer { background: #0F172A; color: #999; padding: 15px; text-align: center; font-size: 12px; border-radius: 0 0 8px 8px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>LUNICAR</h1>
            <p>Nouveau message de contact</p>
        </div>
        <div class="content">
            <div class="section">
                <p><span class="label">De:</span> ${nouveauMessage.nom}</p>
                <p><span class="label">Email:</span> <a href="mailto:${nouveauMessage.email}">${nouveauMessage.email}</a></p>
                ${nouveauMessage.telephone ? `<p><span class="label">Téléphone:</span> <a href="tel:${nouveauMessage.telephone}">${nouveauMessage.telephone}</a></p>` : ''}
                <p><span class="label">Sujet:</span> ${nouveauMessage.sujet}</p>
                <div class="message-box">
                    <p><span class="label">Message:</span></p>
                    <p>${nouveauMessage.message.replace(/\n/g, '<br>')}</p>
                </div>
            </div>
        </div>
        <div class="footer">
            <p>LUNICAR - Reprise automobile professionnelle</p>
            <p>Message reçu le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</p>
        </div>
    </div>
</body>
</html>`;

        try {
            await sendEmail({
                subject: `📩 Nouveau message contact - ${nouveauMessage.sujet}`,
                html: emailHtml
            });
            console.log('✅ Email de contact envoyé');
        } catch (emailError) {
            console.error('❌ Erreur envoi email:', emailError.message);
        }

        res.json({
            success: true,
            message: 'Message envoyé avec succès'
        });
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

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'lunicar2024';
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

    if (password === ADMIN_PASSWORD) {
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

app.get('/sitemap.xml', (req, res) => {
    const baseUrl = process.env.SITE_URL || 'https://lunicar.fr';
    const articles = readJSON('articles.json');
    const cities = readJSON('cities.json');
    const themes = readJSON('themes.json');

    const staticPages = [
        { url: '/', priority: '1.0', changefreq: 'weekly' },
        { url: '/reprise', priority: '0.9', changefreq: 'monthly' },
        { url: '/garanties', priority: '0.8', changefreq: 'monthly' },
        { url: '/articles', priority: '0.8', changefreq: 'weekly' },
        { url: '/contact', priority: '0.7', changefreq: 'monthly' },
        { url: '/mentions-legales', priority: '0.3', changefreq: 'yearly' },
        { url: '/politique-confidentialite', priority: '0.3', changefreq: 'yearly' }
    ];

    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;

    staticPages.forEach(page => {
        sitemap += `  <url>
    <loc>${baseUrl}${page.url}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>
`;
    });

    // Pages villes SEO locales
    cities.forEach(city => {
        sitemap += `  <url>
    <loc>${baseUrl}/reprise-auto-${city.slug}</loc>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
`;
    });

    // Pages thématiques SEO
    themes.forEach(theme => {
        sitemap += `  <url>
    <loc>${baseUrl}/${theme.slug}</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
`;
    });

    articles.forEach(article => {
        const lastmod = article.dateISO || new Date().toISOString().split('T')[0];
        sitemap += `  <url>
    <loc>${baseUrl}/article/${article.slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
`;
    });

    sitemap += `</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.send(sitemap);
});

app.get('/robots.txt', (req, res) => {
    const baseUrl = process.env.SITE_URL || 'https://lunicar.fr';
    const robots = `# LUNICAR - Robots.txt
User-agent: *
Allow: /

# Sitemap
Sitemap: ${baseUrl}/sitemap.xml

# Disallow admin areas
Disallow: /admin
Disallow: /admino
Disallow: /api/admin/

# Disallow uploads
Disallow: /uploads/
`;
    res.header('Content-Type', 'text/plain');
    res.send(robots);
});

// Bloquer l'ancienne URL /admin - retourne 404
app.get('/admin', (req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route admin cachée (nouvelle URL)
app.get('/admino', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admino.html'));
});

// Démarrage serveur
app.listen(PORT, () => {
    console.log(`\n🚗 LUNICAR Server démarré sur http://localhost:${PORT}\n`);
});
