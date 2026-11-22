/**
 * LUNICAR - Repérer les véhicules utilitaires parmi les demandes.
 * Une seule règle, partagée par le serveur (notification, e-mail) et l'admin (servie en /admino/utilitaire.js).
 *
 * 0. Marquage à la main dans l'admin (suivi.utilitaire = true / false) : il prime sur tout.
 * 1. Fiche plaque : genre CTTE, DERIV-VP, CAM, TCP, VASP = utilitaire certain.
 *    L'API répond souvent « VP » pour les versions société (Clio Société, 206 Affaire, Twingo Société, C3 Entreprise) :
 *    on les reconnaît à la version (SOCIETE, AFFAIRE, ENTREPRISE) ou aux 2 places d'une berline.
 * 2. Le nom saisi par le vendeur : « société », « 2 places », modèles 100 % utilitaires (Trafic, Master, Transit…) = certain ;
 *    ludospaces vendus en deux versions (Kangoo, Partner, Berlingo…) = possible, sauf si la carte grise dit VP.
 * 3. Demande envoyée depuis une page « rachat utilitaire » : possible, même si l'API dit VP.
 *
 * Résultat : null, ou { sur: true|false, libelle, raison, manuel? }.
 */
(function (racine, fabrique) {
    if (typeof module === 'object' && module.exports) module.exports = fabrique();
    else racine.Utilitaire = fabrique();
})(typeof self !== 'undefined' ? self : this, function () {
    const GENRES = {
        CTTE: 'Utilitaire', 'DERIV-VP': 'Utilitaire (dérivé VP)', CAM: 'Camion', TCP: 'Minibus', VASP: 'Véhicule spécial', TRR: 'Tracteur'
    };
    // Versions société d'une voiture : vendues en utilitaire 2 places.
    const SOCIETE = /\b(?:societe|affaires?|entreprise|(?:2|deux)\s*places|version\s+utilitaire|vu|deriv(?:ee)?\s*vp|ctte)\b/i;
    // Modèles uniquement utilitaires (ou pick-up), et mots qui désignent un utilitaire.
    const SURS = /\b(?:transit(?!\s+(?:courier\s+)?tourneo)|trafic|master|jumpy|jumper|boxer|ducato|sprinter|vito|crafter|transporter|vivaro|movano|talento|scudo|expert|daily|iveco|interstar|primastar|nv\s?300|nv\s?400|proace|maxity|cabstar|canter|atego|hiace|dyna|citan|nemo|bipper|fiorino|c\s?15|express|ranger|hilux|navara|l\s?200|amarok|d-?max|fullback|fourgon|fourgonnette|camionnette|camion|utilitaire|van|pick-?up|plateau|benne|frigo|tolee|t[456]\s+(?:van|fourgon|kasten))\b/i;
    // Ludospaces vendus en VP et en utilitaire : le genre de la carte grise tranche.
    const POSSIBLES = /\b(?:kangoo|partner|berlingo|caddy|doblo|combo|townstar|dokker|nv\s?200|connect|courier|qubo)\b/i;
    // Versions particuliers des fourgons (combis, minibus) : pas un utilitaire sur la carte grise.
    const PASSAGERS = /\b(?:multivan|caravelle|tourneo|spacetourer|traveller|tourer|combi\s+\d|kombi|zafira\s+life|vivaro\s+life|proace\s+verso|v-?class|classe\s+v|marco\s+polo|california|tepee|rifter)\b/i;
    // Deux places normales : coupés, cabriolets, roadsters, Smart.
    const DEUX_PLACES_SPORT = /coup|decapot|cabrio|roadster|spider|spyder|targa/i;
    const DEUX_PLACES_MODELES = /\b(?:smart|fortwo|mx-?5|370z|350z|z4|slk|slc|tt|boxster|cayman|911|miata|gt86|brz|elise|exige|alpine|a110|ds3\s*cabrio)\b/i;
    const PAGE_UTILITAIRE = /utilitaire|camionnette|fourgon/i;

    const sansAccent = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

    function detecter(x, suivi) {
        x = x || {};
        const m = (suivi || {}).utilitaire;
        if (m === false) return null;
        if (m === true) return { sur: true, libelle: 'Utilitaire', raison: 'marqué à la main dans l\'admin', manuel: true };

        const f = x.fiche_api || {};
        const genre = String(f.genreVCGNGC || f.genre || '').toUpperCase().trim();
        if (GENRES[genre]) return { sur: true, libelle: GENRES[genre], raison: `carte grise : genre ${genre}${f.carrosserie ? ' (' + f.carrosserie + ')' : ''}` };

        // Versions société que l'API classe en VP.
        const versionApi = sansAccent([f.version, f.sra_commercial, f.variante].filter(Boolean).join(' '));
        const vs = SOCIETE.exec(versionApi);
        if (vs) return { sur: true, libelle: 'Utilitaire (version société)', raison: `version : « ${[f.version, f.sra_commercial].filter(Boolean)[0] || vs[0]} »` };
        const nomComplet = sansAccent([x.vehicule, x.fiche_confirmee, f.marque, f.modele, f.version].filter(Boolean).join(' '));
        if (Number(f.nr_passagers) === 2 && !DEUX_PLACES_SPORT.test(sansAccent(f.carrosserie)) && !DEUX_PLACES_MODELES.test(nomComplet))
            return { sur: true, libelle: 'Utilitaire (2 places)', raison: `fiche plaque : 2 places${f.carrosserie ? ' (' + f.carrosserie.toLowerCase() + ')' : ''}` };

        // Nom saisi par le vendeur, et son message.
        const txt = sansAccent([x.vehicule, x.fiche_confirmee, x.marque, x.modele].filter(Boolean).join(' '));
        const ts = SOCIETE.exec(txt);
        if (ts) return { sur: true, libelle: 'Utilitaire (version société)', raison: `modèle saisi : « ${ts[0]} »` };
        const msg = sansAccent(x.message);
        const ms = /\b(?:version|modele|vehicule)\s+(?:societe|utilitaire|entreprise)\b|\b(?:2|deux)\s*places\b|\bcarte grise (?:en )?(?:ctte|vu)\b/i.exec(msg);
        if (ms) return { sur: true, libelle: 'Utilitaire (version société)', raison: `message du vendeur : « ${ms[0]} »` };

        if (!genre || genre !== 'VP') {
            if (txt.trim() && !PASSAGERS.test(txt)) {
                const s = SURS.exec(txt);
                if (s) return { sur: true, libelle: 'Utilitaire', raison: `modèle saisi : « ${s[0]} »` };
                const p = POSSIBLES.exec(txt);
                if (p) return { sur: false, libelle: 'Utilitaire ?', raison: `« ${p[0]} » existe en version utilitaire : vérifier la carte grise` };
            }
        }

        // Le vendeur est venu par une page « rachat utilitaire » : l'API peut ignorer une version société.
        const page = [x.page, x.source, (/entree=([^\s|]+)/.exec(String(x.provenance || '')) || [])[1]].filter(Boolean).join(' ');
        if (PAGE_UTILITAIRE.test(page)) return { sur: false, libelle: 'Utilitaire ?', raison: 'demande envoyée depuis la page « Rachat utilitaire » : vérifier la carte grise (version société ?)' };
        return null;
    }

    return { detecter, GENRES };
});
