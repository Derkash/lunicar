/**
 * LUNICAR - Configuration du site et petits utilitaires partagés.
 *
 * Le téléphone et WhatsApp sont lus dans l'environnement : tant qu'ils ne sont
 * pas renseignés (LUNICAR_PHONE / LUNICAR_WHATSAPP), aucun bouton d'appel n'est
 * affiché — on n'affiche jamais un numéro inventé.
 */

const BASE_URL = (process.env.SITE_URL || 'https://lunicar.fr').replace(/\/$/, '');

// "06 12 34 56 78", "+33612345678"… -> { display: "06 12 34 56 78", intl: "33612345678" }
function parsePhone(raw) {
    const digits = String(raw || '').replace(/[^\d+]/g, '');
    if (!digits) return null;
    let national = digits;
    if (national.startsWith('+33')) national = '0' + national.slice(3);
    else if (national.startsWith('0033')) national = '0' + national.slice(4);
    else if (national.startsWith('33') && national.length === 11) national = '0' + national.slice(2);
    if (!/^0[1-9]\d{8}$/.test(national)) return null;
    return {
        display: national.replace(/(\d{2})(?=\d)/g, '$1 ').trim(),
        intl: '33' + national.slice(1)
    };
}

// Ligne fixe Île-de-France (même numéro que Proxoweb). LUNICAR_PHONE sur Render la remplace si définie.
const PHONE = parsePhone(process.env.LUNICAR_PHONE || '01 84 16 35 25');
const WHATSAPP = parsePhone(process.env.LUNICAR_WHATSAPP);

// Technicien qui se déplace, tel que le client le connaît (prénom + numéro donnés dans les confirmations).
const TECHNICIEN = { nom: process.env.TECH_NOM || 'Kevin', tel: parsePhone(process.env.TECH_TEL || '06 48 71 87 08') };
// Conseiller qui suit le client (numéro donné dans l'e-mail de confirmation).
const CONSEILLER = { tel: parsePhone(process.env.CONSEILLER_TEL || '06 16 13 37 30') };

const SITE = {
    name: 'LUNICAR',
    baseUrl: BASE_URL,
    email: 'contact@lunicar.fr',
    phone: PHONE,
    whatsapp: WHATSAPP,
    hours: 'Lundi au vendredi 9h–19h, samedi 10h–18h',
    // Comptes officiels : pied de page « Suivez-nous » et données structurées (sameAs).
    // Ajouter chaque nouveau réseau ici (TikTok, Facebook…) une fois le compte créé.
    // Clés d'icône : youtube, instagram, linkedin, facebook, tiktok, trustpilot (pictogrammes dessinés dans lib/layout.js).
    social: [
        { cle: 'youtube', nom: 'YouTube', url: 'https://www.youtube.com/@lunicarfr' },
        { cle: 'instagram', nom: 'Instagram', url: 'https://www.instagram.com/lunicarfr/' },
        { cle: 'linkedin', nom: 'LinkedIn', url: 'https://www.linkedin.com/company/lunicarfr/' },
        { cle: 'trustpilot', nom: 'Trustpilot', url: 'https://fr.trustpilot.com/review/lunicar.fr' }
    ],
    gaId: 'G-MYS8P4VYJ3',
    // Version des fichiers statiques : change à chaque démarrage, donc à chaque déploiement.
    assetVersion: Date.now().toString(36)
};

function esc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Sérialisation JSON-LD sûre dans une balise <script>.
function jsonLd(obj) {
    return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
}

// "à Paris", "au Havre", "aux Mureaux", "à La Rochelle".
function aVille(nom) {
    if (/^Le /.test(nom)) return `au ${nom.slice(3)}`;
    if (/^Les /.test(nom)) return `aux ${nom.slice(4)}`;
    return `à ${nom}`;
}

// "de Paris", "du Havre", "des Mureaux", "d'Argenteuil".
function deVille(nom) {
    if (/^Le /.test(nom)) return `du ${nom.slice(3)}`;
    if (/^Les /.test(nom)) return `des ${nom.slice(4)}`;
    if (/^([AEIOUYÉÈÎÔ]|Herblay|Hyères)/.test(nom)) return `d'${nom}`;
    return `de ${nom}`;
}

module.exports = { SITE, TECHNICIEN, CONSEILLER, esc, jsonLd, aVille, deVille, parsePhone };
