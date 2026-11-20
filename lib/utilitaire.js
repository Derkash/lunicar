/**
 * LUNICAR - Repérer les véhicules utilitaires parmi les demandes.
 * Une seule règle, partagée par le serveur (notification, e-mail, API) et l'admin (servie en /admino/utilitaire.js).
 *
 * 1. Fiche plaque (carte grise) : le genre fait foi. CTTE, DERIV-VP, CAM, TCP, VASP = utilitaire certain ; VP = jamais.
 * 2. Sans fiche : le nom saisi par le vendeur.
 *    - modèles qui n'existent qu'en utilitaire (Trafic, Master, Transit, Sprinter…) ou mots « fourgon », « van »… = certain ;
 *    - ludospaces vendus en deux versions (Kangoo, Partner, Berlingo, Caddy…) = « possible », à confirmer à l'appel.
 *
 * Résultat : null, ou { sur: true|false, libelle, raison }.
 */
(function (racine, fabrique) {
    if (typeof module === 'object' && module.exports) module.exports = fabrique();
    else racine.Utilitaire = fabrique();
})(typeof self !== 'undefined' ? self : this, function () {
    const GENRES = {
        CTTE: 'Utilitaire', 'DERIV-VP': 'Utilitaire (dérivé VP)', CAM: 'Camion', TCP: 'Minibus', VASP: 'Véhicule spécial', TRR: 'Tracteur'
    };
    // Modèles uniquement utilitaires (ou pick-up), et mots qui désignent un utilitaire.
    const SURS = /\b(?:transit(?!\s+(?:courier\s+)?tourneo)|trafic|master|jumpy|jumper|boxer|ducato|sprinter|vito|crafter|transporter|vivaro|movano|talento|scudo|expert|daily|iveco|interstar|primastar|nv\s?300|nv\s?400|proace|maxity|cabstar|canter|atego|hiace|dyna|citan|nemo|bipper|fiorino|c\s?15|express|ranger|hilux|navara|l\s?200|amarok|d-?max|fullback|fourgon|fourgonnette|camionnette|camion|utilitaire|van|pick-?up|plateau|benne|frigo|tolee|t[456]\s+(?:van|fourgon|kasten))\b/i;
    // Ludospaces vendus en VP et en utilitaire : le genre de la carte grise tranche.
    const POSSIBLES = /\b(?:kangoo|partner|berlingo|caddy|doblo|combo|townstar|dokker|nv\s?200|connect|courier|qubo)\b/i;
    // Versions particuliers des fourgons (combis, minibus) : pas un utilitaire sur la carte grise.
    const PASSAGERS = /\b(?:multivan|caravelle|tourneo|spacetourer|traveller|tourer|combi\s+\d|kombi|zafira\s+life|vivaro\s+life|proace\s+verso|v-?class|classe\s+v|marco\s+polo|california|tepee|rifter)\b/i;

    const sansAccent = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

    function detecter(x) {
        x = x || {};
        const f = x.fiche_api || {};
        const genre = String(f.genreVCGNGC || f.genre || '').toUpperCase().trim();
        if (genre) {
            if (GENRES[genre]) return { sur: true, libelle: GENRES[genre], raison: `carte grise : genre ${genre}${f.carrosserie ? ' (' + f.carrosserie + ')' : ''}` };
            return null; // VP, moto… : la carte grise fait foi.
        }
        const txt = sansAccent([x.vehicule, x.fiche_confirmee, x.marque, x.modele].filter(Boolean).join(' '));
        if (!txt.trim()) return null;
        if (PASSAGERS.test(txt)) return null;
        const m = SURS.exec(txt);
        if (m) return { sur: true, libelle: 'Utilitaire', raison: `modèle saisi : « ${m[0]} »` };
        const p = POSSIBLES.exec(txt);
        if (p) return { sur: false, libelle: 'Utilitaire ?', raison: `« ${p[0]} » existe en version utilitaire : vérifier la carte grise` };
        return null;
    }

    return { detecter, GENRES };
});
