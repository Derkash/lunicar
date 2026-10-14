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
server.js            routes, redirections 301, API demandes/contact/admin, sitemap, robots, llms.txt
lib/config.js        constantes du site, téléphone, utilitaires
lib/layout.js        gabarit commun : <head>, en-tête, pied, barre mobile, formulaire, sections partagées
lib/pages.js         une fonction par type de page
lib/idf.js           départements d'Île-de-France et pages par situation (contenu rédigé)
data/cities.json     441 villes (150 en Île-de-France)
data/themes.json     pages thématiques nationales (marques, types, situations)
data/articles.json   articles de conseils
content/*.html       corps des pages légales
public/css/app.css   feuille unique des pages publiques
public/js/app.js     menu, formulaire de demande, rappel, contact
public/admino.html   espace d'administration des articles (utilise style.css + pages.css)
```

## Pages

| Type | Adresse | Source |
|---|---|---|
| Accueil, estimation | `/`, `/reprise` | `pages.home`, `pages.reprise` |
| Région | `/rachat-voiture-ile-de-france` | `pages.hub` |
| Départements (7) | `/rachat-voiture-hauts-de-seine-92`… | `idf.DEPARTMENTS` |
| Situations (5) | `/rachat-voiture-en-panne-paris`… | `idf.SITUATIONS` |
| Villes (441) | `/reprise-auto-{slug}` | `data/cities.json` |
| Thématiques | `/{slug}` | `data/themes.json` |

Règle : une intention de recherche = une page. Les variantes proches sont regroupées, les anciennes adresses redirigées en 301 (`SEO_REDIRECTS` dans `server.js`).

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
