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

// Hors Île-de-France : villes qui reçoivent déjà des visites (≥ 2 clics ou ≥ 100 impressions sur 16 mois
// dans la Search Console, ou pages d'arrivée de visiteurs envoyés par ChatGPT dans GA4).
const FRANCE_CITIES = [
    'marseille', 'lyon', 'nice', 'montpellier', 'bordeaux', 'toulon', 'clermont-ferrand', 'brest', 'tours',
    'amiens', 'perpignan', 'metz', 'rouen', 'avignon', 'la-rochelle', 'anglet', 'sens', 'montbeliard',
    'saint-die-des-vosges', 'forbach', 'fecamp', 'venissieux', 'saint-priest', 'oullins', 'barentin',
    'lannion', 'orthez', 'nimes', 'caen', 'saint-brieuc', 'colmar', 'strasbourg', 'libourne'
];

const FRANCE_SLUG = 'rachat-voiture-france';

// Marques gardées, chacune avec un texte propre (data/guides.json).
const BRANDS = ['renault', 'peugeot', 'citroen', 'dacia', 'volkswagen', 'toyota', 'ford', 'mercedes', 'bmw', 'audi', 'fiat', 'seat'];
const OTHER_BRANDS = ['opel', 'nissan', 'hyundai', 'kia', 'ds', 'alpine', 'porsche', 'mini', 'honda', 'mazda', 'suzuki',
    'mitsubishi', 'lexus', 'tesla', 'jeep', 'alfa-romeo', 'land-rover', 'jaguar', 'mg', 'volvo', 'cupra', 'skoda', 'byd'];

const CASH = 'rachat-voiture-cash-paris';
const SANS_CT = 'vendre-voiture-sans-controle-technique-paris';
const PANNE = 'rachat-voiture-en-panne-paris';
const OCCASION = 'reprise-voiture-occasion';
const COMPARATIF = 'comparatif-reprise-auto';

// Ancienne adresse -> adresse gardée (sans « / » initial). Aucune chaîne : chaque cible est finale.
const PAGE_REDIRECTS = {
    'reprise-auto-24h': CASH, 'reprise-auto-immediate': CASH, 'vendre-sa-voiture-rapidement': CASH,
    'reprise-voiture-48h': CASH, 'rachat-voiture-rapide': CASH, 'rachat-voiture-paiement-cash': CASH,
    'vendre-voiture-paiement-comptant': CASH, 'reprise-auto-paiement-immediat': CASH,
    'rachat-voiture-virement-immediat': CASH, 'reprise-auto-cheque-de-banque': CASH,
    'rachat-voiture-divorce': CASH, 'vendre-voiture-demenagement': CASH, 'reprise-voiture-expatriation': CASH,
    'rachat-voiture-sans-controle-technique': SANS_CT, 'reprise-auto-sans-ct': SANS_CT,
    'reprise-auto-sans-controle-technique': SANS_CT, 'vendre-voiture-sans-ct': SANS_CT, 'rachat-vehicule-sans-revision': SANS_CT,
    'reprise-voiture-en-panne': PANNE, 'reprise-voiture-non-roulante': PANNE, 'rachat-voiture-moteur-hs': PANNE,
    'rachat-voiture-accidentee': 'rachat-voiture-accidentee-paris',
    'rachat-vehicule-utilitaire': 'rachat-utilitaire-paris',
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
 * vers son département, une ville hors Île-de-France vers la page nationale.
 */
function cityRedirect(city, deptSlugByName) {
    if (IDF_CITIES.includes(city.slug) || FRANCE_CITIES.includes(city.slug)) return null;
    if (city.region === 'Île-de-France') return deptSlugByName(city.departement) || 'rachat-voiture-ile-de-france';
    return FRANCE_SLUG;
}

const isKeptCity = c => IDF_CITIES.includes(c.slug) || FRANCE_CITIES.includes(c.slug);

module.exports = { IDF_CITIES, FRANCE_CITIES, FRANCE_SLUG, BRANDS, PAGE_REDIRECTS, cityRedirect, isKeptCity };
