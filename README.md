# LUNICAR

Site de rachat de voitures toutes marques aux particuliers et aux professionnels (lunicar.fr), partout en France, déplacement et enlèvement offerts partout en France.

Node.js + Express, sans base de données : tout le HTML public est rendu côté serveur à partir de gabarits JavaScript et de fichiers JSON.

## Lancer en local

```bash
npm install
npm run dev        # http://localhost:3000
```

## Déploiement

Render, déploiement automatique à chaque push sur `main` (`Derkash/lunicar`).

Variables d'environnement à définir sur Render (voir `.env.example`) :

| Variable | Rôle |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_TO` | Envoi des demandes par e-mail. Sans elles, les demandes ne sont visibles que dans les journaux Render. |
| `LUNICAR_PHONE` | Numéro affiché (en-tête, formulaire, barre mobile). Vide = aucun bouton d'appel. |
| `LUNICAR_WHATSAPP` | Numéro WhatsApp. Vide = aucun bouton WhatsApp. |
| `CONVERSIONS_TOKEN` | Jeton du flux `/conversions/google-ads.csv` (leads qualifiés et achats issus d'un clic Ads, par gclid), lu chaque jour par l'import planifié de Google Ads. Non défini = flux fermé. |
| `ADMIN_USER` | Identifiant de `/admino` (par défaut `Elbagui224`, majuscules indifférentes). |
| `ADMIN_PASSWORD` | Mot de passe de `/admino`. Non défini en production = admin fermé. |
| `PLAQUE_API_KEY`, `PLAQUE_API_PROVIDER`, `PLAQUE_API_QUOTA` | Fiche véhicule par plaque (apiplaqueimmatriculation.com par défaut), plafonnée par mois. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Stockage durable de l'admin (demandes, suivi, photos). |
| `ANTHROPIC_API_KEY` | Estimation automatique des demandes. Vide = pas d'estimation. |

Le disque de Render est effacé à chaque déploiement : avec Supabase configuré, les demandes et photos y sont conservées ; l'e-mail reste une copie, les journaux le filet de sécurité.

## Espace admin `/admino`

Toutes les demandes reçues (formulaire, abandons, rappels, anciennes demandes importées de Gmail), avec :

- **Estimation à la demande** (bouton « Estimer maintenant » dans la fiche, ou « Estimer » en masse dans Réglages ; `ESTIMATION_AUTO=1` pour la lancer à chaque demande) : Claude cherche les annonces comparables (Leboncoin d'abord, sinon La Centrale / AutoScout24) et la cote, chiffre la remise en état d'après l'état déclaré, le message et les photos. Quatre prix : **prix max d'achat**, **prix constaté Leboncoin** (médiane des annonces), **cote Argus** (publiée ou déduite, la source est indiquée), **prix de vente estimé**. Le prix max est calculé par le serveur : revente − remise en état − frais fixes − marge (réglages dans l'admin). L'e-mail de demande contient un lien direct vers la fiche pour la lancer.
- Fiche complète : caractéristiques, fiche SIV, message du vendeur, carte grise, annonces et pages consultées, points d'attention, questions à poser.
- **Photos rangées par dossier** (`2026-10-17_AB12CD34_peugeot-308/`), visionneuse, ajout depuis l'admin, téléchargement du dossier en .zip. Les photos ne sont plus publiques.
- Suivi : statut, offre faite, prix d'achat, prix retenus à la main, date de rappel, notes, historique. Export CSV.
- **Import Gmail** (onglet Réglages, ou `node tools/import_gmail.js [AAAA-MM-JJ]`) : relit tous les formats d'e-mail envoyés par le site depuis décembre 2025, reconstruit les demandes, leurs photos et les messages de contact. Rejouable sans doublon.
- Articles : `/admino/articles` (ancienne page).

Code : `lib/store.js` (stockage), `lib/estimation.js`, `lib/gmail-import.js`, `lib/admin.js` (API), `public/admin/index.html` (interface).

### Mise en route (une fois)

1. Créer un projet Supabase, exécuter `supabase/schema.sql` dans le SQL Editor (tables + bucket privé `demandes`).
2. Sur Render : `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (clé service_role), `ANTHROPIC_API_KEY`, `ADMIN_PASSWORD`.
3. Dans l'admin : Réglages → vérifier les marges → « Lancer l'import » Gmail → « Estimer » les anciennes demandes si voulu (≈ 0,15 à 0,30 € par estimation avec Sonnet 5.5).

Alternative sans Supabase : un disque persistant Render monté sur `/var/data` + `DATA_DIR=/var/data` (demandes dans `crm.json`, photos dans `photos/`).

Sans Supabase ni disque, tout fonctionne en local (`data/crm.json`, `uploads/demandes/`), mais Render efface ces fichiers à chaque déploiement.

## Organisation

```
server.js            routes, redirections 301, API demandes/contact/admin, sitemap, robots, llms.txt, IndexNow
lib/config.js        constantes du site, téléphone, utilitaires
lib/zones.js         périmètre indexé : villes gardées, marques gardées, redirections 301
lib/layout.js        gabarit commun : <head>, en-tête, pied, formulaire, sections partagées
lib/pages.js         une fonction par type de page
lib/idf.js           départements d'Île-de-France et pages par situation (contenu rédigé)
data/guides.json     pages rédigées : toutes les voitures, comparatif, situations (diesel, électrique,
                     fort km, LOA/LLD, crédit, succession) et 12 marques
data/local.json      Paris, textes locaux des villes d'IDF gardées, page France, Qui sommes-nous
data/articles.json   conseils (sources officielles, FAQ, date de mise à jour)
data/cities.json     441 communes : sert au maillage et aux redirections, toutes n'ont pas de page
public/css/app.css   feuille unique (polices hébergées sur le site, sans Google Fonts)
public/js/app.js     menu, saisie de plaque, formulaire de demande, rappel, contact, mesure
tools/check_seo.js   contrôle de toutes les pages du sitemap (title, description, H1, JSON-LD, liens)
tools/generate_images.py  photos du site (Gemini), originaux dans .image-raw/
```

## Pages

| Type | Adresse | Source |
|---|---|---|
| Accueil, estimation | `/`, `/reprise` | `pages.home`, `pages.reprise` |
| Paris | `/reprise-auto-paris` | `data/local.json` (paris) |
| Région, départements (7) | `/rachat-voiture-ile-de-france`, `/rachat-voiture-hauts-de-seine-92`… | `lib/idf.js` |
| Situations IDF (5) | `/rachat-voiture-en-panne-paris`… | `lib/idf.js` |
| Guides et marques (20) | `/reprise-voiture-occasion`, `/reprise-renault`… | `data/guides.json` |
| Villes IDF (40) | `/reprise-auto-{slug}` | `lib/zones.js` + `data/local.json` (villes) |
| Villes hors IDF (69) | `/reprise-auto-{slug}` | `lib/zones.js` + `data/local.json` (villes) |
| Régions (11) | `/rachat-voiture-occitanie`… | `data/local.json` (regions) |
| Situations nationales (5) | `/rachat-voiture-en-panne`, `/rachat-voiture-accidentee`, `/rachat-voiture-sans-controle-technique`, `/rachat-voiture-rapide`, `/rachat-vehicule-utilitaire` | `data/guides.json` |
| France, à propos | `/rachat-voiture-france`, `/a-propos` | `data/local.json` |

## Périmètre indexé (décision du 2026-10-14)

Avant : 533 pages, dont 441 villes et 54 marques en gabarit identique à 90 %. Google commençait à les écarter (« explorée, non indexée ») et les positions reculaient sur tout le site.

Après : une page n'existe que si elle a un texte propre. Les communes d'IDF sans page renvoient en 301 vers leur département (où elles restent listées), les autres communes vers leur page région (où elles restent listées), les marques secondaires vers `/reprise-voiture-occasion`, les variantes thématiques vers la page qui couvre l'intention. Toute la table est dans `lib/zones.js` ; aucune chaîne de redirection.

Positionnement national depuis le 2026-10-15 : grandes villes de France + villes qui reçoivent déjà du trafic (Search Console, ChatGPT). Pour ajouter une ville : l'ajouter à `FRANCE_CITIES` (ou `IDF_CITIES`) **avec** son texte local dans `data/local.json`. 

Contrôle avant chaque déploiement :

```bash
PORT=3123 node server.js &  node tools/check_seo.js http://localhost:3123
```

## GEO (moteurs IA)

- `robots.txt` autorise explicitement les robots d'IA (OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot…).
- `/llms.txt` (sommaire décrit) et `/llms-full.txt` (texte intégral des pages piliers) sont générés depuis les mêmes contenus que les pages.
- IndexNow : la clé est servie à `/<clé>.txt` ; toutes les URL du sitemap sont soumises 30 s après chaque démarrage sur Render (donc à chaque déploiement). Bing alimente la recherche de ChatGPT.
- Chaque page affiche sa date de mise à jour (`<time>`) et la déclare en `dateModified`. Les pages rédigées citent leurs sources officielles.
- Suivi mensuel des citations dans ChatGPT : `node tools/geo_suivi/suivi.js` (clé `OPENAI_API_KEY` dans `.env`), 20 questions dans `tools/geo_suivi/questions.json`, relevés datés dans `lunicar-audit/geo-suivi/`.

## Mesure

- GA4 ne se charge qu'après consentement : il voit environ un tiers des visiteurs. Les volumes sont à lire en proportions.
- Événements : `lead_form_start`, `form_step2`, `plaque_saisie`, `plaque_reconnue`, `generate_lead` (demande envoyée, à déclarer comme événement clé dans GA4), `contact_*`.
- Aucune plaque d'immatriculation n'est envoyée à Google : `?immat=` et `?plaque=` sont retirés de l'URL.

## Formulaire de demande

Questions progressives avec jauge : véhicule (plaque facultative qui remplit le reste, modèle, année, km), état mécanique, carrosserie (si elle roule), contrôle technique, délai, projet d'achat, prix (facultatif), identité, téléphone et code postal (commune via geo.api.gouv.fr), titulaire de la carte grise (nom facultatif si non), n° du certificat (facultatif, photo d'aide), e-mail (facultatif). Puis étape photos facultative (prise ou import, réduites à 1600 px dans le navigateur), puis confirmation.

- `POST /api/reprise` : demande complète, e-mail immédiat avec toute la fiche API (VIN compris).
- `POST /api/reprise/brouillon` : dès que le téléphone est saisi, l'état du formulaire est sauvegardé à chaque étape (et à la fermeture de la page). Sans envoi final après `ABANDON_MINUTES` (15 par défaut), un e-mail « Demande abandonnée » part avec tout ce qui a été rempli. Les brouillons sont en mémoire : à l'arrêt du serveur (redéploiement), ils partent tout de suite.
- `POST /api/reprise/:id/photos` : photos envoyées après coup, dans un second e-mail, puis effacées du disque.
- Champ piège anti-robots et limite d'envois par adresse IP.

## Recherche par plaque

- `public/js/plaque.js` : décodeur maison, partagé navigateur/serveur. Les plaques SIV sont attribuées dans l'ordre depuis avril 2009 ; à partir de jalons datés, il donne le mois d'attribution. Ancien format = immatriculé avant 2009, `WW` = provisoire. Gratuit, sans appel externe. Jalons à compléter chaque année (`JALONS`).
- `lib/vehicule.js` : en option, caractéristiques techniques via une API payante (par défaut apiplaqueimmatriculation.com : `PLAQUE_API_KEY` = token, `PLAQUE_API_PROVIDER=apiplaque`) : marque, modèle, version, énergie, boîte, CV, 1re mise en circulation. Désactivé sans clé, plafonné par `PLAQUE_API_QUOTA` appels par mois (380 pour un forfait de 400) et `PLAQUE_API_QUOTA_JOUR` par jour (20), 12 recherches par heure et par visiteur, réponses gardées 24 h en mémoire seulement (jamais stockées). Test : `PLAQUE_API_KEY=… node tools/test_plaque.js AB-123-CD` (1 appel).
- Historique : le vendeur génère son rapport sur Histovec (service de l'État) et colle le lien après sa demande (`POST /api/reprise/histovec`). Le lien est transmis par e-mail et se consulte à la main ; il expire le 8 du mois suivant son partage.
- Pas d'accès direct au SIV ni d'extraction de services tiers : le SIV n'expose pas d'API, la licence de réutilisation coûte plusieurs dizaines de milliers d'euros, et l'extraction de données d'un autre service est pénalement sanctionnée.

## Règles de contenu

- Aucune preuve sociale inventée : pas de note, pas de nombre d'avis, pas de volume de véhicules tant qu'ils ne sont pas réels et vérifiables.
- Aucun numéro de téléphone factice : les boutons d'appel n'apparaissent que si le numéro est configuré.
- L'adresse postale n'apparaît que dans les mentions légales.
- Aucun superlatif ni promesse invérifiable (expert, leader, n°1, « +20 % »…), contrôlé par `tools/check_seo.js`.
- Positionnement : LUNICAR rachète toutes les voitures, récentes ou non. Pas un épaviste.
