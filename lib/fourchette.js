// LUNICAR - Fourchette annoncée au client à partir du prix max d'achat.
// Règle (29/10/2026) : le HAUT de la fourchette est notre prix max d'achat, jamais au-dessus — la marge est
// déjà comptée dedans. Le bas = prix max − écart (au moins fourchette_min_eur, ou fourchette_pct %) : c'est
// l'engagement si les informations sont exactes ; l'inspection fait monter vers le haut si la voiture est soignée.
// Même règle côté admin (public/admin/index.html, fonction fourchette) : garder les deux alignées.
const DEFAUT = {
    fourchette_pct: 15,        // écart entre le bas et le haut, en % du prix max…
    fourchette_min_eur: 200,   // …et au moins 200 €
    fourchette_souhait_moins: 300  // conservé pour les anciens réglages (plus utilisé)
};
const n = v => Number(v) || 0;
const bas50 = v => Math.floor(v / 50) * 50;
// base : prix max d'achat calculé. souhaite : prix demandé par le vendeur (facultatif) — s'il demande moins
// que notre max, on ne propose jamais plus que son prix.
function fourchette(base, r = {}, souhaite = 0) {
    const c = { ...DEFAUT, ...r };
    base = Math.max(0, Math.round(n(base)));
    if (!base) return null;
    let max = base, ajustee = false;
    const s = Math.round(n(String(souhaite || '').replace(/[^\d]/g, '')));
    if (s >= 100 && s < base) { max = Math.max(50, bas50(s)); ajustee = true; }
    const ecart = Math.min(max * 0.35, Math.max(n(c.fourchette_min_eur), max * n(c.fourchette_pct) / 100));   // jamais plus de 35 % d'écart (petits prix)
    const min = Math.max(50, bas50(max - ecart));
    return { min: Math.min(min, max), max, base, ajustee, souhaite: s || null };
}
const eur = v => `${Math.round(v).toLocaleString('fr-FR')} €`;
function texteClient(f) {
    if (!f) return '';
    return `Notre estimation pour votre voiture : entre ${eur(f.min)} et ${eur(f.max)}.\n\n` +
        `Sous réserve que les informations que vous nous avez transmises soient exactes, nous nous engageons à vous proposer au moins ${eur(f.min)}.\n\n` +
        `L'écart entre ces deux montants dépend de l'état général de la voiture, que notre technicien vérifie lors de l'inspection à votre adresse : entretien, carrosserie, intérieur, pneus et fonctionnement mécanique. Plus la voiture est soignée, plus le prix se rapproche du haut de la fourchette.`;
}
module.exports = { fourchette, texteClient, DEFAUT };
