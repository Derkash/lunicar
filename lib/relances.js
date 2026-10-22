// Relances : un vendeur fait estimer sa voiture sur plusieurs sites. Après un contact ou une offre,
// on le rappelle 4 jours ouvrés plus tard pour savoir où il en est (vendue ? autre offre ?).

// Jours fériés français (fixes + Pâques, Ascension, Pentecôte).
function feries(annee) {
    const a = annee % 19, b = Math.floor(annee / 100), c = annee % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1;
    const paques = Date.UTC(annee, mois - 1, jour);
    const plus = n => new Date(paques + n * 864e5).toISOString().slice(0, 10);
    return new Set([`${annee}-01-01`, `${annee}-05-01`, `${annee}-05-08`, `${annee}-07-14`, `${annee}-08-15`, `${annee}-11-01`, `${annee}-11-11`, `${annee}-12-25`,
        plus(1), plus(39), plus(50)]);
}

const aujourdhui = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); // AAAA-MM-JJ, heure de Paris

function ouvre(iso) {
    const d = new Date(`${iso}T12:00:00Z`);
    const j = d.getUTCDay();
    return j !== 0 && j !== 6 && !feries(d.getUTCFullYear()).has(iso);
}

function ajouterJoursOuvres(depuis, n) {
    let d = new Date(`${depuis || aujourdhui()}T12:00:00Z`);
    let reste = n;
    while (reste > 0) {
        d = new Date(d.getTime() + 864e5);
        if (ouvre(d.toISOString().slice(0, 10))) reste--;
    }
    return d.toISOString().slice(0, 10);
}

// Statuts encore « vivants » : ceux qu'on relance.
const ACTIFS = ['nouvelle', 'contactee', 'offre', 'rdv'];

// Résultats d'appel : nouveau statut éventuel et délai de la prochaine relance (jours ouvrés).
const RESULTATS = {
    injoignable: { libelle: 'Injoignable', relance: 1 },
    reflechit: { libelle: 'Réfléchit / compare les offres', statut: 'offre', relance: 4 },
    rappeler: { libelle: 'Demande à être rappelé plus tard', relance: 4 },
    // Date (et heure) du rappel convenues avec le client : saisies dans le compte rendu.
    rappel_prevu: { libelle: 'Rappel prévu (date convenue)', relance: 1, dateConvenue: true },
    accepte: { libelle: 'Offre acceptée, rendez-vous à fixer', statut: 'rdv', relance: 1 },
    vendue_ailleurs: { libelle: 'A vendu ailleurs', statut: 'vendue_ailleurs', relance: 0 },
    refuse: { libelle: 'Refuse notre offre', statut: 'refusee', relance: 0 },
    garde: { libelle: 'Garde sa voiture finalement', statut: 'sans_suite', relance: 0 }
};

module.exports = { aujourdhui, ajouterJoursOuvres, ouvre, ACTIFS, RESULTATS, DELAI: 4 };
