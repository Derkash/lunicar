/**
 * LUNICAR - Décodeur de plaque d'immatriculation (sans aucun service tiers).
 *
 * Les plaques SIV (AB-123-CD) sont attribuées dans l'ordre, pour toute la France,
 * depuis le 15 avril 2009 : les chiffres défilent d'abord (001 à 999), puis la
 * dernière lettre, puis l'avant-dernière, puis la paire de gauche. À partir de
 * jalons datés, on retrouve donc le mois où la plaque a été attribuée.
 *
 * Limite : c'est la date d'immatriculation EN FRANCE sous ce numéro. Un véhicule
 * importé, ou passé de l'ancien format au SIV, peut être plus ancien. Le résultat
 * est une estimation, présentée comme telle.
 *
 * Fichier partagé : chargé tel quel par le navigateur et par le serveur (require).
 */
(function (root) {
    'use strict';

    // Lettres utilisées par le SIV (I, O et U exclues).
    const LETTRES = 'ABCDEFGHJKLMNPQRSTVWXYZ';
    const N = LETTRES.length;

    // Jalons publiés (date -> plaque atteinte). Sources : fichier SIV via Wikipédia
    // (plaque atteinte au 31/12), Caradisiac (début de chaque première lettre),
    // eplaque (relevés de septembre). Relevé eplaque de sept. 2017 écarté : incohérent
    // avec celui du 31/12/2016.
    const JALONS = [
        ['2009-04-15', 'AA-001-AA'], ['2009-09-15', 'AD-733-CG'], ['2009-12-31', 'AJ-083-DQ'],
        ['2010-09-15', 'BA-001-AA'], ['2010-12-31', 'BF-900-PQ'],
        ['2011-09-15', 'BV-458-LP'], ['2011-12-31', 'BZ-521-TB'],
        ['2012-01-06', 'CA-001-AA'], ['2012-09-15', 'CL-341-CY'], ['2012-12-31', 'CP-778-KL'],
        ['2013-09-15', 'CY-989-YX'], ['2013-10-29', 'DA-001-AA'], ['2013-12-31', 'DB-022-XE'],
        ['2014-09-15', 'DK-331-KS'], ['2014-12-31', 'DM-930-ZT'],
        ['2015-09-15', 'DW-242-BD'], ['2015-12-31', 'DY-706-QH'],
        ['2016-02-26', 'EA-001-AA'], ['2016-12-31', 'EJ-171-AS'], ['2017-12-31', 'ET-897-DT'],
        ['2018-08-29', 'FA-001-AA'], ['2018-12-31', 'FC-885-XN'],
        ['2019-09-15', 'FK-480-JQ'], ['2019-12-31', 'FM-528-WC'],
        ['2020-09-15', 'FS-320-ZB'], ['2020-12-31', 'FW-059-GA'],
        ['2021-06-16', 'GA-001-AA'], ['2021-09-15', 'GB-532-FR'], ['2021-12-31', 'GD-060-YQ'],
        ['2022-09-15', 'GJ-775-PQ'], ['2022-12-31', 'GL-945-LT'],
        ['2023-09-15', 'GR-698-KJ'], ['2023-12-31', 'GT-765-KN'],
        ['2024-09-15', 'GZ-233-HZ'], ['2024-11-01', 'HA-001-AA'], ['2024-12-31', 'HB-688-FD'],
        ['2025-09-15', 'HF-020-ST']
    ];

    const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

    function rang(plaque) {
        const m = /^([A-Z]{2})-?(\d{3})-?([A-Z]{2})$/.exec(plaque);
        if (!m) return null;
        const l = s => LETTRES.indexOf(s);
        const [a, b, c, d] = [l(m[1][0]), l(m[1][1]), l(m[3][0]), l(m[3][1])];
        const n = parseInt(m[2], 10);
        if ([a, b, c, d].some(x => x < 0) || n < 1) return null;
        return ((((a * N + b) * N + c) * N + d) * 999) + (n - 1);
    }

    // Jalons convertis et filtrés : rang et date strictement croissants.
    const POINTS = [];
    JALONS.forEach(([date, plaque]) => {
        const r = rang(plaque);
        const t = Date.parse(date + 'T12:00:00Z');
        const prev = POINTS[POINTS.length - 1];
        if (r !== null && (!prev || (r > prev.r && t > prev.t))) POINTS.push({ r, t });
    });

    function normaliser(saisie) {
        return String(saisie || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    }

    function dateDepuisRang(r) {
        if (r < POINTS[0].r) return null;
        for (let i = 1; i < POINTS.length; i++) {
            const p = POINTS[i - 1];
            const q = POINTS[i];
            if (r <= q.r) return new Date(p.t + (q.t - p.t) * (r - p.r) / (q.r - p.r));
        }
        // Au-delà du dernier jalon : prolongement au rythme des douze derniers mois.
        const last = POINTS[POINTS.length - 1];
        const ref = POINTS.filter(p => last.t - p.t >= 300 * 864e5).pop() || POINTS[POINTS.length - 2];
        const d = new Date(last.t + (last.t - ref.t) * (r - last.r) / (last.r - ref.r));
        return d > new Date() ? new Date() : d;
    }

    /**
     * analyser('AB-123-CD') -> { plaque, format, annee, mois, libelle, fiable }
     *   format : 'siv' | 'fni' | 'w-garage' | 'inconnu'
     */
    function analyser(saisie) {
        const brut = normaliser(saisie);
        if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(brut)) {
            const plaque = `${brut.slice(0, 2)}-${brut.slice(2, 5)}-${brut.slice(5)}`;
            if (brut.startsWith('WW')) return { plaque, format: 'w-garage', libelle: 'Immatriculation provisoire (WW) : véhicule en attente de sa plaque définitive, souvent importé.' };
            const r = rang(brut);
            const d = r === null ? null : dateDepuisRang(r);
            if (!d) return { plaque, format: 'siv', libelle: 'Plaque au format SIV.' };
            const mois = d.getUTCMonth();
            const annee = d.getUTCFullYear();
            return {
                plaque, format: 'siv', annee, mois: mois + 1, fiable: true,
                libelle: `Plaque attribuée vers ${MOIS[mois]} ${annee}`
            };
        }
        // Ancien format FNI : 1 à 4 chiffres, 2 ou 3 lettres, numéro de département.
        if (/^\d{1,4}[A-Z]{2,3}(\d{2}|2A|2B|97\d)$/.test(brut)) {
            return { plaque: brut, format: 'fni', annee: null, libelle: 'Ancien format : véhicule immatriculé avant avril 2009, jamais revendu depuis.' };
        }
        return { plaque: brut, format: 'inconnu', libelle: '' };
    }

    const api = { analyser, normaliser, rang };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.LunicarPlaque = api;
})(typeof window !== 'undefined' ? window : this);
