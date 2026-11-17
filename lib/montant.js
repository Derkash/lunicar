// Montants en euros : écriture « 4 990,00 € » et en toutes lettres (règle de 1990 : traits d'union partout).
const UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const DIZAINES = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

function moinsDeCent(n) {
    if (n <= 16) return UNITES[n];
    if (n < 20) return 'dix-' + UNITES[n - 10];
    const d = Math.floor(n / 10), u = n % 10;
    if (d === 7 || d === 9) return DIZAINES[d] + (d === 7 && u === 1 ? '-et-' : '-') + moinsDeCent(10 + u);
    if (u === 0) return DIZAINES[d] + (d === 8 ? 's' : '');
    return DIZAINES[d] + (u === 1 && d !== 8 ? '-et-' : '-') + UNITES[u];
}
function moinsDeMille(n) {
    const c = Math.floor(n / 100), r = n % 100;
    const cent = c === 0 ? '' : c === 1 ? 'cent' : UNITES[c] + '-cent' + (r === 0 ? 's' : '');
    return [cent, r ? moinsDeCent(r) : ''].filter(Boolean).join('-') || 'zéro';
}
function entierEnLettres(n) {
    if (n === 0) return 'zéro';
    const parts = [];
    const millions = Math.floor(n / 1e6), milliers = Math.floor(n % 1e6 / 1000), reste = n % 1000;
    if (millions) parts.push(moinsDeMille(millions) + '-million' + (millions > 1 ? 's' : ''));
    // « mille » invariable ; « cents » et « quatre-vingts » perdent leur s devant mille.
    if (milliers) parts.push((milliers === 1 ? '' : moinsDeMille(milliers).replace(/(cent|vingt)s$/, '$1') + '-') + 'mille');
    if (reste) parts.push(moinsDeMille(reste));
    return parts.join('-');
}
function enLettres(montant) {
    const t = Math.round(Number(montant) * 100), e = Math.floor(t / 100), c = t % 100;
    let s = `${entierEnLettres(e)} euro${e > 1 ? 's' : ''}`;
    if (/(million|millions)$/.test(entierEnLettres(e))) s = s.replace(/ euros$/, ' d\'euros');
    if (c) s += ` et ${entierEnLettres(c)} centime${c > 1 ? 's' : ''}`;
    return s;
}
const euros = v => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ | /g, ' ') + ' €';

module.exports = { enLettres, euros };
