/**
 * LUNICAR - Faits officiels sourcés (data/faits.json).
 *
 * Chaque fait a été lu sur sa page source (SDES, service-public, UTAC, Banque de France,
 * Code civil…) avant publication. Ce sont des faits de marché ou de réglementation,
 * jamais des chiffres sur LUNICAR. Ils servent à deux choses :
 * - l'encadré « Bon à savoir » des pages piliers (2 ou 3 faits choisis par page) ;
 * - la page de référence /chiffres-cles-vente-voiture-occasion, très citée par les IA.
 * Mettre à jour une fois par an (nouveaux chiffres SDES au 1er trimestre).
 */
const fs = require('fs');
const path = require('path');
const { esc } = require('./config');

const FAITS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'faits.json'), 'utf-8'));
const parId = Object.fromEntries(FAITS.map(f => [f.id, f]));
const PAGE_SLUG = 'chiffres-cles-vente-voiture-occasion';

// Faits affichés par page (chemin -> identifiants), choisis selon le sujet de la page.
const PAR_PAGE = {
    '/': ['marche-vo-volume-2025', 'cession-declaration-15-jours', 'ct-dispenses-vente'],
    '/reprise': ['marche-vo-age-moyen-2025', 'kilometrage-annuel-2025', 'ct-taux-contre-visite-2025'],
    '/rachat-voiture-france': ['marche-vo-volume-2025', 'parc-age-moyen-2026', 'cession-declaration-15-jours'],
    '/reprise-auto-paris': ['parc-critair-2026', 'cession-declaration-15-jours', 'paiement-especes-professionnel'],
    '/rachat-voiture-ile-de-france': ['parc-critair-2026', 'parc-age-moyen-2026', 'cession-code-15-jours'],
    '/rachat-voiture-en-panne': ['ct-taux-contre-visite-2025', 'ct-dispenses-vente', 'vices-caches-delai'],
    '/rachat-voiture-en-panne-paris': ['ct-taux-contre-visite-2025', 'ct-dispenses-vente', 'vices-caches-delai'],
    '/rachat-voiture-accidentee': ['vices-caches-definition', 'vices-caches-delai', 'cession-csa-15-jours'],
    '/rachat-voiture-accidentee-paris': ['vices-caches-definition', 'vices-caches-delai', 'cession-csa-15-jours'],
    '/rachat-voiture-sans-controle-technique': ['ct-dispenses-vente', 'ct-moins-6-mois', 'ct-contre-visite-2-mois'],
    '/vendre-voiture-sans-controle-technique-paris': ['ct-dispenses-vente', 'ct-moins-6-mois', 'ct-contre-visite-2-mois'],
    '/rachat-voiture-rapide': ['paiement-especes-professionnel', 'arnaque-escroquerie-peine', 'arnaque-cheque-delai'],
    '/rachat-voiture-cash-paris': ['paiement-especes-professionnel', 'arnaque-escroquerie-peine', 'arnaque-cheque-delai'],
    '/reprise-voiture-diesel': ['parc-diesel-2026', 'marche-vo-diesel-2025', 'parc-critair-2026'],
    '/reprise-voiture-haut-kilometrage': ['kilometrage-annuel-2025', 'marche-vo-plus-15-ans-2025', 'ct-taux-contre-visite-2025'],
    '/vendre-vieille-voiture': ['marche-vo-plus-15-ans-2025', 'parc-age-moyen-2026', 'ct-dispenses-vente'],
    '/reprise-voiture-occasion': ['marche-vo-volume-2025', 'marche-vo-part-achats-2025', 'marche-vo-age-moyen-2025'],
    '/comparatif-reprise-auto': ['vices-caches-delai', 'paiement-especes-particuliers', 'arnaque-cheque-delai'],
    '/vendre-voiture-credit': ['cession-csa-15-jours', 'cession-declaration-15-jours'],
    '/reprise-voiture-succession': ['cession-declaration-15-jours', 'cession-csa-15-jours'],
    '/rachat-vehicule-utilitaire': ['paiement-especes-professionnel', 'cession-declaration-15-jours'],
    '/rachat-utilitaire-paris': ['paiement-especes-professionnel', 'cession-declaration-15-jours']
};

const source = f => `<a href="${esc(f.source_url)}" rel="noopener" target="_blank">${esc(f.source_titre)}</a>`;

// Encadré « Bon à savoir » : vide si la page n'a pas de faits attribués.
function bloc(chemin) {
    const ids = PAR_PAGE[chemin];
    if (!ids) return '';
    const items = ids.map(id => parId[id]).filter(Boolean);
    if (!items.length) return '';
    return `
<section class="section section-faits">
    <div class="wrap narrow">
        <p class="eyebrow">Bon à savoir</p>
        <ul class="faits">
            ${items.map(f => `<li><p>${esc(f.fait)}</p><p class="fait-source">Source : ${source(f)}</p></li>`).join('')}
        </ul>
        <p><a class="text-link" href="/${PAGE_SLUG}">Tous les chiffres clés de la vente d'une voiture d'occasion</a></p>
    </div>
</section>`;
}

// Faits regroupés par thème, dans l'ordre du fichier.
function parTheme() {
    const groupes = new Map();
    FAITS.forEach(f => { if (!groupes.has(f.theme)) groupes.set(f.theme, []); groupes.get(f.theme).push(f); });
    return [...groupes.entries()];
}

const derniereVerif = () => FAITS.reduce((m, f) => (f.verifie_le > m ? f.verifie_le : m), '');

module.exports = { FAITS, PAGE_SLUG, bloc, parTheme, derniereVerif, source };
