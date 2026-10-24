// Vérifie que la cote marchand reproduit les prix vendezvotrevoiture.fr relevés le 24/10/2026.
// node tools/cote_marchand/test.js
const { valeurMarchand } = require('../../lib/cote-marchand');
const cas = [
    { nom: 'Fiesta 2016 66 000 km', d: { annee: 2016, kilometrage: 66400, mecanique: 'Roule, aucun souci', carrosserie: 'Très bon état', controle_technique: 'À jour' }, retail: 7890, frais: 550, vvv: 4607 },
    { nom: 'Yaris 2007 230 000 km', d: { annee: 2007, kilometrage: 230000, mecanique: 'Sans CT valide', carrosserie: 'Quelques rayures', controle_technique: '' }, retail: 2900, frais: 520, vvv: 662 },
    { nom: 'Golf VII 2014 253 000 km panne', d: { annee: 2014, kilometrage: 253000, mecanique: 'En panne / ne roule plus' }, retail: 6900, frais: 200, vvv: 1082 },
    { nom: 'Grand Scénic 2006 161 000 km soucis', d: { annee: 2006, kilometrage: 160900, mecanique: 'Roule, avec des soucis mécaniques', carrosserie: 'Quelques rayures ou petits chocs', controle_technique: 'Pas à jour' }, retail: 3420, frais: 1600, vvv: 273 }
];
let ko = 0;
for (const c of cas) {
    const r = valeurMarchand(c.d, c.retail, c.frais);
    const ecart = Math.round((r.valeur - c.vvv) / c.vvv * 100);
    if (Math.abs(r.valeur - c.vvv) > Math.max(60, c.vvv * 0.08)) ko++;
    console.log(`${c.nom.padEnd(38)} cote ${String(r.valeur).padStart(5)} €  VVV ${String(c.vvv).padStart(5)} €  écart ${ecart > 0 ? '+' : ''}${ecart} %`);
}
process.exit(ko ? 1 : 0);
