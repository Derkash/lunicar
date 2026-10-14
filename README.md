# LUNICAR

Site de rachat de voitures aux particuliers et aux professionnels (lunicar.fr), centré sur Paris et l'Île-de-France.

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
| `ADMIN_PASSWORD` | Mot de passe de `/admino`. Non défini en production = admin fermé. |
| `PLAQUE_API_KEY`, `PLAQUE_API_QUOTA` | Caractéristiques SIV par plaque via une API licenciée (facultatif), plafonnées par mois. |

Le disque de Render est effacé à chaque déploiement : `data/demandes.json` n'est pas une archive fiable. L'e-mail est le canal de référence, les journaux le filet de sécurité.

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
| Villes hors IDF (33) | `/reprise-auto-{slug}` | page honnête : demande étudiée au cas par cas |
| France, à propos | `/rachat-voiture-france`, `/a-propos` | `data/local.json` |

## Périmètre indexé (décision du 2026-10-14)

Avant : 533 pages, dont 441 villes et 54 marques en gabarit identique à 90 %. Google commençait à les écarter (« explorée, non indexée ») et les positions reculaient sur tout le site.

Après : une page n'existe que si elle a un texte propre. Les communes d'IDF sans page renvoient en 301 vers leur département (où elles restent listées), les villes hors IDF sans trafic vers `/rachat-voiture-france`, les marques secondaires vers `/reprise-voiture-occasion`, les variantes thématiques vers la page qui couvre l'intention. Toute la table est dans `lib/zones.js` ; aucune chaîne de redirection.

Une ville hors IDF est gardée si elle avait au moins 2 clics ou 100 impressions en 16 mois de Search Console, ou si ChatGPT y envoie des visiteurs (GA4). Pour en ajouter une : l'ajouter à `FRANCE_CITIES` ; pour une ville d'IDF, l'ajouter à `IDF_CITIES` **avec** son texte dans `data/local.json`.

Contrôle avant chaque déploiement :

```bash
PORT=3123 node server.js &  node tools/check_seo.js http://localhost:3123
```

## GEO (moteurs IA)

- `robots.txt` autorise explicitement les robots d'IA (OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot…).
- `/llms.txt` (sommaire décrit) et `/llms-full.txt` (texte intégral des pages piliers) sont générés depuis les mêmes contenus que les pages.
- IndexNow : la clé est servie à `/<clé>.txt` ; toutes les URL du sitemap sont soumises 30 s après chaque démarrage sur Render (donc à chaque déploiement). Bing alimente la recherche de ChatGPT.
- Chaque page affiche sa date de mise à jour (`<time>`) et la déclare en `dateModified`. Les pages rédigées citent leurs sources officielles.

## Mesure

- GA4 ne se charge qu'après consentement : il voit environ un tiers des visiteurs. Les volumes sont à lire en proportions.
- Événements : `lead_form_start`, `form_step2`, `plaque_saisie`, `plaque_reconnue`, `generate_lead` (demande envoyée, à déclarer comme événement clé dans GA4), `contact_*`.
- Aucune plaque d'immatriculation n'est envoyée à Google : `?immat=` et `?plaque=` sont retirés de l'URL.

## Formulaire de demande

Deux étapes : le véhicule (plaque facultative, marque et modèle, année, kilométrage, particularités), puis les coordonnées (prénom, téléphone, code postal, e-mail facultatif). Une voie courte « Être rappelé » (prénom + téléphone) est présente sur chaque page.

`POST /api/reprise` accepte du JSON. La demande est envoyée par e-mail, journalisée, et enregistrée dans `data/demandes.json`. Champ piège anti-robots et limite d'envois par adresse IP.

## Recherche par plaque

- `public/js/plaque.js` : décodeur maison, partagé navigateur/serveur. Les plaques SIV sont attribuées dans l'ordre depuis avril 2009 ; à partir de jalons datés, il donne le mois d'attribution. Ancien format = immatriculé avant 2009, `WW` = provisoire. Gratuit, sans appel externe. Jalons à compléter chaque année (`JALONS`).
- `lib/vehicule.js` : en option, caractéristiques techniques via une API licenciée SIV (marque, modèle, énergie, CV, 1re mise en circulation). Désactivé sans `PLAQUE_API_KEY`, plafonné par mois, réponses gardées 24 h en mémoire seulement : sans licence SIV propre, ces données ne doivent pas être stockées (guide ministériel de réutilisation, §5.2).
- Historique : le vendeur génère son rapport sur Histovec (service de l'État) et colle le lien après sa demande (`POST /api/reprise/histovec`). Le lien est transmis par e-mail et se consulte à la main ; il expire le 8 du mois suivant son partage.
- Pas d'accès direct au SIV ni d'extraction de services tiers : le SIV n'expose pas d'API, la licence de réutilisation coûte plusieurs dizaines de milliers d'euros, et l'extraction de données d'un autre service est pénalement sanctionnée.

## Règles de contenu

- Aucune preuve sociale inventée : pas de note, pas de nombre d'avis, pas de volume de véhicules tant qu'ils ne sont pas réels et vérifiables.
- Aucun numéro de téléphone factice : les boutons d'appel n'apparaissent que si le numéro est configuré.
- L'adresse postale n'apparaît que dans les mentions légales.
- Aucun superlatif ni promesse invérifiable (expert, leader, n°1, « +20 % »…), contrôlé par `tools/check_seo.js`.
- Positionnement : LUNICAR rachète toutes les voitures, récentes ou non. Pas un épaviste.
