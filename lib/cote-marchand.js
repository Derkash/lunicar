// LUNICAR - Cote marchand : ce que vaut la voiture pour un professionnel (positionnement
// « vendezvotrevoiture.fr », LUNICAR revend aux marchands), puis l'offre LUNICAR = un peu plus.
//
// Calage (24/10/2026) sur les prix finaux vendezvotrevoiture.fr (Auto1) de nos propres voitures,
// rapportés à la médiane des annonces de particuliers relevée par l'estimation :
//   Fiesta 1.0 EcoBoost 2016, 66 000 km, saine ............ 4 607 € / 7 890 €  = 58 %
//   Yaris 1.3 2007, 230 000 km, CT expiré, rayures ........   662 € / 2 900 €  = 23 %
//   Golf VII 1.2 TSI 2014, 253 000 km, en panne ...........  1 082 € / 6 900 €  = 16 % (roulante)
//   Grand Scénic 2.0 dCi 2006, 161 000 km, 3 défauts méca .   273 € / 3 420 €  =  8 %
// Les tables ci-dessous reproduisent ces 4 prix à ±5 %. À recaler dès qu'on a plus de points
// (chaque voiture achetée passée sur vendezvotrevoiture, puis les prix d'enchères Auto1).

// Interpolation linéaire dans une table [[x, coef], ...] triée.
function interp(table, x) {
    if (x <= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++) {
        const [x1, y1] = table[i];
        if (x <= x1) {
            const [x0, y0] = table[i - 1];
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
        }
    }
    return table[table.length - 1][1];
}

const CALAGE_DEFAUT = {
    // Part du prix d'annonce particulier selon l'âge (ans)
    coef_age: [[0, 0.72], [3, 0.70], [6, 0.65], [10, 0.60], [15, 0.46], [20, 0.33], [25, 0.28]],
    // Décote supplémentaire selon le kilométrage
    coef_km: [[0, 1], [100000, 1], [150000, 0.92], [200000, 0.82], [250000, 0.70], [300000, 0.60], [400000, 0.50]],
    ct_expire: 0.92,          // contrôle technique pas à jour / expiré
    carrosserie: { tbe: 1, rayures: 0.97, abimee: 0.88 },
    panne: 0.42,              // voiture qui ne roule plus : part de la valeur roulante
    soucis_part_frais: 0.4,   // « roule avec des soucis » : on retire 40 % des frais méca chiffrés…
    soucis_sans_frais: 0.55,  // …ou, sans chiffrage, on garde 55 % de la valeur
    accident: 0.35,
    plancher: 250             // valeur casse / export : jamais en dessous
};

const n = v => { const x = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')); return Number.isFinite(x) ? x : 0; };

function etatDe(d) {
    const meca = String(d.mecanique || '').toLowerCase();
    const carro = String(d.carrosserie || '').toLowerCase();
    const ct = String(d.controle_technique || '').toLowerCase();
    return {
        meca: /accident/.test(meca) ? 'accident' : /panne|ne roule|ne démarre|immobilis/.test(meca) ? 'panne' : /aucun (souci|probl)/.test(meca) ? 'ok' : /souci|probl|défaut|bruit|voyant/.test(meca) ? 'soucis' : 'ok',
        ct_expire: /pas à jour|expir|sans ct|non\b|^non/.test(ct) || /sans ct/.test(meca),
        carro: /ab[iî]m|endommag|accident/.test(carro) ? 'abimee' : /rayure|choc|bosse/.test(carro) ? 'rayures' : 'tbe'
    };
}

// d : { annee, kilometrage, mecanique, carrosserie, controle_technique }
// prixParticulier : médiane des annonces de particuliers pour une voiture comparable QUI ROULE
// fraisMeca : frais de remise en état chiffrés (pour le cas « roule avec des soucis »)
function valeurMarchand(d, prixParticulier, fraisMeca = 0, calage = {}) {
    const c = { ...CALAGE_DEFAUT, ...calage, carrosserie: { ...CALAGE_DEFAUT.carrosserie, ...(calage.carrosserie || {}) } };
    const retail = n(prixParticulier);
    const annee = n(String(d.annee || '').slice(-4)) || new Date().getFullYear() - 10;
    const age = Math.max(0, new Date().getFullYear() - annee);
    const km = n(d.kilometrage);
    const e = etatDe(d);
    const etapes = [];
    const kAge = interp(c.coef_age, age), kKm = interp(c.coef_km, km);
    let v = retail * kAge * kKm;
    etapes.push({ libelle: `Annonces particuliers ${Math.round(retail)} € × âge ${age} ans (${Math.round(kAge * 100)} %) × ${Math.round(km / 1000)} 000 km (${Math.round(kKm * 100)} %)`, valeur: Math.round(v) });
    if (e.ct_expire && e.meca !== 'panne') { v *= c.ct_expire; etapes.push({ libelle: 'Contrôle technique pas à jour', valeur: Math.round(v) }); }
    if (e.carro !== 'tbe') { v *= c.carrosserie[e.carro]; etapes.push({ libelle: e.carro === 'abimee' ? 'Carrosserie abîmée' : 'Rayures, petits chocs', valeur: Math.round(v) }); }
    if (e.meca === 'panne') { v *= c.panne; etapes.push({ libelle: `Ne roule plus : ${Math.round(c.panne * 100)} % de la valeur roulante`, valeur: Math.round(v) }); }
    else if (e.meca === 'accident') { v *= c.accident; etapes.push({ libelle: 'Accidentée', valeur: Math.round(v) }); }
    else if (e.meca === 'soucis') {
        v = n(fraisMeca) > 0 ? v - n(fraisMeca) * c.soucis_part_frais : v * c.soucis_sans_frais;
        etapes.push({ libelle: n(fraisMeca) > 0 ? `Soucis mécaniques : − ${Math.round(c.soucis_part_frais * 100)} % des ${Math.round(n(fraisMeca))} € de réparations chiffrées` : 'Soucis mécaniques (non chiffrés)', valeur: Math.round(v) });
    }
    if (v < c.plancher) { v = c.plancher; etapes.push({ libelle: 'Plancher valeur casse / export', valeur: c.plancher }); }
    return { valeur: Math.round(v), age, km, etat: e, etapes, coef_global: retail ? Math.round(v / retail * 100) / 100 : null };
}

module.exports = { valeurMarchand, CALAGE_DEFAUT, interp, etatDe };
