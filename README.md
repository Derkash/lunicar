# LUNICAR - Site de Reprise Automobile

Site web professionnel de reprise de vehicules automobiles.

## Fonctionnalites

- **Page d'accueil** : Hero, statistiques, etapes, avantages, temoignages
- **Formulaire de reprise** : Multi-etapes avec upload photos
- **Articles/Blog** : Systeme d'articles avec filtres par categorie
- **Page garanties** : Engagements et FAQ
- **Page contact** : Formulaire de contact
- **Pages legales** : Mentions legales et politique de confidentialite
- **Envoi d'emails** : Notifications par email via Nodemailer

## Technologies

- **Backend** : Node.js, Express.js
- **Frontend** : HTML5, CSS3, JavaScript vanilla
- **Email** : Nodemailer (SMTP Gmail)
- **Stockage** : Fichiers JSON

## Installation locale

```bash
# Cloner le projet
git clone <url-du-repo>
cd lunicar

# Installer les dependances
npm install

# Configurer les variables d'environnement (optionnel pour les emails)
cp .env.example .env
# Editer .env avec vos identifiants SMTP

# Lancer le serveur
npm start
```

Le site sera accessible sur http://localhost:3000

## Configuration Email (optionnel)

Pour activer l'envoi d'emails, creez un fichier `.env` :

```env
EMAIL_TO=votre-email@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=votre-email@gmail.com
SMTP_PASS=votre-mot-de-passe-application
SMTP_FROM_NAME=LUNICAR
```

> **Note** : Pour Gmail, utilisez un [mot de passe d'application](https://support.google.com/accounts/answer/185833)

## Deploiement sur Render

### Option 1 : Deploiement automatique

1. Connectez votre repo GitHub a Render
2. Le fichier `render.yaml` configurera automatiquement le service

### Option 2 : Deploiement manuel

1. Creez un nouveau **Web Service** sur Render
2. Connectez votre repository
3. Configuration :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Environment** : Node
4. Ajoutez les variables d'environnement (optionnel) :
   - `EMAIL_TO`
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `SMTP_USER`
   - `SMTP_PASS`
   - `SMTP_FROM_NAME`

## Structure du projet

```
lunicar/
├── server.js              # Serveur Express
├── package.json           # Dependances
├── render.yaml            # Configuration Render
├── .env.example           # Template variables d'environnement
├── public/                # Fichiers statiques
│   ├── index.html         # Page d'accueil
│   ├── reprise.html       # Formulaire de reprise
│   ├── articles.html      # Liste des articles
│   ├── article.html       # Page article
│   ├── garanties.html     # Page garanties
│   ├── contact.html       # Page contact
│   ├── mentions-legales.html
│   ├── politique-confidentialite.html
│   ├── css/
│   │   ├── style.css      # Styles principaux
│   │   ├── pages.css      # Styles des pages
│   │   └── forms.css      # Styles des formulaires
│   └── js/
│       ├── main.js        # JavaScript principal
│       ├── reprise.js     # Script formulaire reprise
│       ├── articles.js    # Script liste articles
│       └── article-single.js  # Script page article
├── data/
│   └── articles.json      # Articles du blog
└── uploads/               # Photos uploadees (gitignore)
```

## API Endpoints

| Methode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/articles` | Liste tous les articles |
| GET | `/api/articles/:slug` | Detail d'un article |
| POST | `/api/reprise` | Soumettre une demande de reprise |
| POST | `/api/contact` | Envoyer un message de contact |
| GET | `/api/valider-plaque/:plaque` | Valider un format de plaque |

## Licence

MIT
