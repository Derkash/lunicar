// LUNICAR - Fourchette annoncée au client à partir du prix max d'achat (offre de base).
// Le bas de la fourchette = l'offre de base : LUNICAR s'engage à proposer au moins ce prix
// si les informations renseignées sont exactes. Le haut dépend de l'état constaté à l'inspection.
// Même règle côté admin (public/admin/index.html, fonction fourchette) : garder les deux alignées.
const DEFAUT = {
    fourchette_seuil1: 500, fourchette_haut1: 1000,   // base < 500 €  → entre base et 1 000 €
    fourchette_seuil2: 800, fourchette_haut2: 1200,   // base < 800 €  → entre base et 1 200 €
    fourchette_pct: 20, fourchette_min_eur: 300,      // au-delà → base + 20 % (au moins + 300 €)
    fourchette_souhait_moins: 300                      // vendeur qui demande moins que notre base : bas = son prix − 300 €
};
const n = v => Number(v) || 0;
// base : prix max d'achat calculé. souhaite : prix demandé par le vendeur (facultatif).
// Si le vendeur demande moins que notre base, le bas de la fourchette devient son prix − 300 €
// (et le haut est recalculé à partir de ce nouveau bas).
function haut(min, c) {
    if (min < n(c.fourchette_seuil1)) return n(c.fourchette_haut1);
    if (min < n(c.fourchette_seuil2)) return n(c.fourchette_haut2);
    return Math.max(n(c.fourchette_haut2), Math.ceil((min + Math.max(n(c.fourchette_min_eur), min * n(c.fourchette_pct) / 100)) / 50) * 50);
}
function fourchette(base, r = {}, souhaite = 0) {
    const c = { ...DEFAUT, ...r };
    base = Math.max(0, Math.round(n(base)));
    if (!base) return null;
    let min = base, ajustee = false;
    const s = Math.round(n(String(souhaite || '').replace(/[^\d]/g, '')));
    if (s >= 100 && s < base) {
        min = Math.max(50, s - n(c.fourchette_souhait_moins));
        min = Math.floor(min / 50) * 50 || min;
        ajustee = true;
    }
    return { min, max: Math.max(haut(min, c), min), base, ajustee, souhaite: s || null };
}
const eur = v => `${Math.round(v).toLocaleString('fr-FR')} €`;
function texteClient(f) {
    if (!f) return '';
    return `Notre estimation pour votre voiture : entre ${eur(f.min)} et ${eur(f.max)}.\n\n` +
        `Sous réserve que les informations que vous nous avez transmises soient exactes, nous nous engageons à vous proposer au moins ${eur(f.min)}.\n\n` +
        `L'écart entre ces deux montants dépend de l'état général de la voiture, que notre technicien vérifie lors de l'inspection à votre adresse : entretien, carrosserie, intérieur, pneus et fonctionnement mécanique. Plus la voiture est soignée, plus le prix se rapproche du haut de la fourchette.`;
}
module.exports = { fourchette, texteClient, DEFAUT };
