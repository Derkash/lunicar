// LUNICAR - Fourchette annoncée au client à partir du prix max d'achat (offre de base).
// Le bas de la fourchette = l'offre de base : LUNICAR s'engage à proposer au moins ce prix
// si les informations renseignées sont exactes. Le haut dépend de l'état constaté à l'inspection.
// Même règle côté admin (public/admin/index.html, fonction fourchette) : garder les deux alignées.
const DEFAUT = {
    fourchette_seuil1: 500, fourchette_haut1: 1000,   // base < 500 €  → entre base et 1 000 €
    fourchette_seuil2: 800, fourchette_haut2: 1200,   // base < 800 €  → entre base et 1 200 €
    fourchette_pct: 20, fourchette_min_eur: 300       // au-delà → base + 20 % (au moins + 300 €)
};
const n = v => Number(v) || 0;
function fourchette(base, r = {}) {
    const c = { ...DEFAUT, ...r };
    base = Math.max(0, Math.round(n(base)));
    if (!base) return null;
    let haut;
    if (base < n(c.fourchette_seuil1)) haut = n(c.fourchette_haut1);
    else if (base < n(c.fourchette_seuil2)) haut = n(c.fourchette_haut2);
    else haut = Math.max(n(c.fourchette_haut2), Math.ceil((base + Math.max(n(c.fourchette_min_eur), base * n(c.fourchette_pct) / 100)) / 50) * 50);
    return { min: base, max: Math.max(haut, base) };
}
const eur = v => `${Math.round(v).toLocaleString('fr-FR')} €`;
function texteClient(f) {
    if (!f) return '';
    return `Notre estimation pour votre voiture : entre ${eur(f.min)} et ${eur(f.max)}.\n\n` +
        `Sous réserve que les informations que vous nous avez transmises soient exactes, nous nous engageons à vous proposer au moins ${eur(f.min)}.\n\n` +
        `L'écart entre ces deux montants dépend de l'état général de la voiture, que notre technicien vérifie lors de l'inspection à votre adresse : entretien, carrosserie, intérieur, pneus et fonctionnement mécanique. Plus la voiture est soignée, plus le prix se rapproche du haut de la fourchette.`;
}
module.exports = { fourchette, texteClient, DEFAUT };
