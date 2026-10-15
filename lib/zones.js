/**
 * LUNICAR - Périmètre indexé du site et redirections 301.
 *
 * Règle : une page n'existe que si elle a un contenu propre. Les anciennes
 * pages de gabarit (villes, marques, variantes thématiques) sont redirigées
 * vers la page qui couvre réellement l'intention. Décision du 2026-10-14,
 * fondée sur 16 mois de Search Console (voir README).
 */

// Paris + villes d'Île-de-France qui ont un texte local rédigé (data/local.json).
const IDF_CITIES = [
    'paris', 'boulogne-billancourt', 'saint-denis', 'montreuil', 'argenteuil', 'nanterre', 'creteil',
    'vitry-sur-seine', 'versailles', 'aubervilliers', 'colombes', 'asnieres-sur-seine', 'courbevoie',
    'rueil-malmaison', 'champigny-sur-marne', 'saint-maur-des-fosses', 'drancy', 'aulnay-sous-bois',
    'noisy-le-grand', 'cergy', 'evry', 'meaux', 'massy', 'sarcelles', 'ivry-sur-seine',
    'issy-les-moulineaux', 'levallois-perret', 'neuilly-sur-seine', 'antony', 'pantin', 'saint-ouen',
    'clichy', 'bondy', 'la-courneuve', 'goussainville', 'sartrouville', 'chelles', 'melun', 'pontoise',
    'villejuif', 'le-blanc-mesnil'
];

// Hors Île-de-France : grandes villes et villes qui reçoivent déjà des visites (Search Console,
// ChatGPT), chacune avec un texte local rédigé (data/local.json, clé villes).
const FRANCE_CITIES = [
    'marseille', 'lyon', 'toulouse', 'nice', 'nantes', 'montpellier', 'strasbourg', 'bordeaux', 'lille', 'rennes',
    'reims', 'toulon', 'saint-etienne', 'le-havre', 'grenoble', 'dijon', 'angers', 'nimes', 'villeurbanne',
    'clermont-ferrand', 'le-mans', 'aix-en-provence', 'brest', 'tours', 'amiens', 'limoges', 'annecy', 'perpignan',
    'metz', 'besancon', 'orleans', 'rouen', 'mulhouse', 'caen', 'nancy', 'avignon', 'poitiers', 'la-rochelle',
    'pau', 'beziers', 'cannes', 'antibes', 'valence', 'bayonne', 'dunkerque', 'calais', 'lorient', 'quimper', 'vannes',
    'saint-nazaire', 'la-roche-sur-yon', 'niort', 'chambery', 'troyes', 'colmar', 'montbeliard', 'saint-die-des-vosges',
    'forbach', 'fecamp', 'venissieux', 'saint-priest', 'oullins', 'barentin', 'lannion', 'orthez', 'anglet', 'sens',
    'libourne', 'saint-brieuc'
];

// Régions hors Île-de-France : une page chacune, qui liste toutes ses communes.
const REGIONS = {
    'Nouvelle-Aquitaine': 'rachat-voiture-nouvelle-aquitaine',
    'Auvergne-Rhône-Alpes': 'rachat-voiture-auvergne-rhone-alpes',
    'Pays de la Loire': 'rachat-voiture-pays-de-la-loire',
    'Normandie': 'rachat-voiture-normandie',
    'Bretagne': 'rachat-voiture-bretagne',
    'Grand Est': 'rachat-voiture-grand-est',
    'Hauts-de-France': 'rachat-voiture-hauts-de-france',
    'Provence-Alpes-Côte d\'Azur': 'rachat-voiture-provence-alpes-cote-d-azur',
    'Bourgogne-Franche-Comté': 'rachat-voiture-bourgogne-franche-comte',
    'Occitanie': 'rachat-voiture-occitanie',
    'Centre-Val de Loire': 'rachat-voiture-centre-val-de-loire'
};

const FRANCE_SLUG = 'rachat-voiture-france';

// Marques gardées, chacune avec un texte propre (data/guides.json).
const BRANDS = ['renault', 'peugeot', 'citroen', 'dacia', 'volkswagen', 'toyota', 'ford', 'mercedes', 'bmw', 'audi', 'fiat', 'seat'];
const OTHER_BRANDS = ['opel', 'nissan', 'hyundai', 'kia', 'ds', 'alpine', 'porsche', 'mini', 'honda', 'mazda', 'suzuki',
    'mitsubishi', 'lexus', 'tesla', 'jeep', 'alfa-romeo', 'land-rover', 'jaguar', 'mg', 'volvo', 'cupra', 'skoda', 'byd'];

// Variantes d'intention -> page nationale (les pages « -paris » restent pour l'intention locale).
const CASH = 'rachat-voiture-rapide';
const SANS_CT = 'rachat-voiture-sans-controle-technique';
const PANNE = 'rachat-voiture-en-panne';
const OCCASION = 'reprise-voiture-occasion';
const COMPARATIF = 'comparatif-reprise-auto';

// Ancienne adresse -> adresse gardée (sans « / » initial). Aucune chaîne : chaque cible est finale.
const PAGE_REDIRECTS = {
    'reprise-auto-24h': CASH, 'reprise-auto-immediate': CASH, 'vendre-sa-voiture-rapidement': CASH,
    'reprise-voiture-48h': CASH, 'rachat-voiture-paiement-cash': CASH,
    'vendre-voiture-paiement-comptant': CASH, 'reprise-auto-paiement-immediat': CASH,
    'rachat-voiture-virement-immediat': CASH, 'reprise-auto-cheque-de-banque': CASH,
    'rachat-voiture-divorce': CASH, 'vendre-voiture-demenagement': CASH, 'reprise-voiture-expatriation': CASH,
    'reprise-auto-sans-ct': SANS_CT,
    'reprise-auto-sans-controle-technique': SANS_CT, 'vendre-voiture-sans-ct': SANS_CT, 'rachat-vehicule-sans-revision': SANS_CT,
    'reprise-voiture-en-panne': PANNE, 'reprise-voiture-non-roulante': PANNE, 'rachat-voiture-moteur-hs': PANNE,
    'reprise-auto-sans-carte-grise': 'article/documents-necessaires-vente-voiture',
    'rachat-voiture-ancienne': OCCASION, 'reprise-suv': OCCASION, 'rachat-berline': OCCASION, 'reprise-citadine': OCCASION,
    'rachat-monospace': OCCASION, 'reprise-voiture-essence': OCCASION, 'rachat-voiture-gpl': OCCASION,
    'rachat-voiture-hybride': 'reprise-voiture-electrique',
    'vendre-voiture-particulier': COMPARATIF, 'rachat-voiture-professionnel': COMPARATIF,
    'alternative-leboncoin': COMPARATIF, 'alternative-lacentrale': COMPARATIF, 'mieux-que-concessionnaire': COMPARATIF,
    'article/marche-automobile-occasion-2024-tendances': 'articles',
    'article/top-10-voitures-qui-gardent-leur-valeur': 'articles',
    'article/controle-technique-2024-nouvelles-normes': 'article/controle-technique-vente-voiture'
};
OTHER_BRANDS.forEach(b => { PAGE_REDIRECTS[`reprise-${b}`] = OCCASION; });

/**
 * Redirections des pages villes retirées : une commune d'Île-de-France renvoie
 * vers son département, une autre commune vers la page de sa région.
 */
function cityRedirect(city, deptSlugByName) {
    if (IDF_CITIES.includes(city.slug) || FRANCE_CITIES.includes(city.slug)) return null;
    if (city.region === 'Île-de-France') return deptSlugByName(city.departement) || 'rachat-voiture-ile-de-france';
    return REGIONS[city.region] || FRANCE_SLUG;
}

const isKeptCity = c => IDF_CITIES.includes(c.slug) || FRANCE_CITIES.includes(c.slug);

module.exports = { IDF_CITIES, FRANCE_CITIES, FRANCE_SLUG, REGIONS, BRANDS, PAGE_REDIRECTS, cityRedirect, isKeptCity };
