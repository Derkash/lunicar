// Test hors ligne du robot Annonces sur une fausse alerte Leboncoin (tools/annonces/alerte-leboncoin.html).
// Aucun appel réseau : pas d'IMAP, pas d'IA (estimation simulée), pas de leboncoin.fr.
// Usage : node tools/annonces/test_annonces.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

// Stockage local jetable, jamais Supabase.
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY; delete process.env.ANTHROPIC_API_KEY;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lunicar-annonces-'));
const an = require('../../lib/annonces');
const { REGLAGES_DEFAUT } = require('../../lib/estimation');

const html = fs.readFileSync(path.join(__dirname, 'alerte-leboncoin.html'), 'utf-8');
const liste = an.lireAlerte(html);
console.table(liste.map(a => ({ id: a.id, titre: a.titre.slice(0, 45), prix: a.prix, annee: a.annee, km: a.km, lieu: [a.code_postal, a.ville, a.dep].filter(Boolean).join(' '), image: !!a.image })));

// 1. Parsing : 7 annonces, pas le logo, ni « voir toutes les annonces », ni l'adresse du pied de page.
assert.strictEqual(liste.length, 7, '7 annonces attendues');
const par = mot => liste.find(a => a.titre.toLowerCase().includes(mot));
const clio = par('clio');
assert.strictEqual(clio.id, '2876543210');
assert.strictEqual(clio.url, 'https://www.leboncoin.fr/ad/voitures/2876543210');
assert.strictEqual(clio.prix, 3900); assert.strictEqual(clio.annee, 2010); assert.strictEqual(clio.km, 128000);
assert.strictEqual(clio.code_postal, '77000'); assert.strictEqual(clio.ville, 'Melun');
assert.ok(/clio\.jpg/.test(clio.image), 'photo de la Clio');
const yaris = par('yaris');
assert.strictEqual(yaris.id, '2876543299', 'identifiant extrait du lien de suivi encodé');
assert.strictEqual(yaris.dep, '59'); assert.strictEqual(yaris.km, 96500); assert.strictEqual(yaris.annee, 2013);
const picanto = par('picanto');
assert.ok(picanto.id.startsWith('h:'), 'lien de suivi opaque : identifiant par empreinte');
assert.ok(/picanto\.jpg/.test(picanto.image), 'photo rattachée malgré deux liens de suivi');
assert.strictEqual(picanto.code_postal, '13008');

// 2. Règles.
const r = a => an.regles(a);
assert.deepStrictEqual([r(clio).rejet, r(clio).modele], [false, 'Renault Clio']);
assert.deepStrictEqual(r(clio).bonus.sort(), ['déménagement', 'vente rapide']);
assert.strictEqual(r(par('207')).anti_pro, true, '« pros s\'abstenir » exclu');
assert.strictEqual(r(par('207')).rejet, true);
assert.strictEqual(r(yaris).rejet, false, '« professionnels uniquement » n\'est pas un refus des pros');
assert.ok(r(yaris).bonus.includes('professionnels uniquement') && r(yaris).bonus.includes('vente aux professionnels'));
assert.ok(r(par('fiesta')).exclusions.includes('pour pièces'));
assert.ok(r(par('sandero')).raisons.some(x => /hors 1 500-6 000/.test(x)), 'prix hors fourchette');
assert.ok(r(par('bmw')).raisons.includes('modèle hors liste'));
assert.ok(r(picanto).bonus.includes('prix à débattre'));
// Variantes de refus des pros.
for (const t of ['Clio 2 pas de professionnels', 'Twingo, marchands s\'abstenir', 'Polo pas de marchands merci', 'C3 pros non acceptés', 'Corsa vente aux particuliers uniquement'])
    assert.strictEqual(an.regles({ titre: t, texte: '' }).anti_pro, true, t);
for (const t of ['Clio pros acceptés', 'Twingo pas de problème mécanique'])
    assert.strictEqual(an.regles({ titre: t, texte: '' }).anti_pro, false, t);

// 3. Distance (malus léger) et score, avec une estimation légère simulée.
assert.strictEqual(an.distanceParis('77'), 33);
assert.ok(an.distanceParis('13') > 800);
const est = (a, cote, frais, liq) => {
    Object.assign(a, an.regles(a) && { modele: r(a).modele, bonus: r(a).bonus, distance_km: r(a).distance_km });
    a.estimation = { cote_revente: cote, frais_remise: frais, liquidite: liq };
    const c = an.prixMax(a.estimation, a, REGLAGES_DEFAUT);
    a.prix_max = c.prix_max_achat; a.marge = a.prix_max - a.prix;
    return { ...an.scorer(a), prix_max: a.prix_max, marge: a.marge };
};
const sClio = est(clio, 6900, 400, 75), sYaris = est(yaris, 7200, 300, 80), sPicanto = est(picanto, 4300, 300, 65);
console.table({ clio: sClio, yaris: sYaris, picanto: sPicanto });
assert.ok(sClio.score >= 70, 'Clio bien placée près de l\'IDF');
assert.ok(sPicanto.score < sClio.score, 'Marseille, marge faible : moins bien classée');

// 4. Passage complet sans IA sur la fausse alerte (stockage local), puis dédoublonnage.
(async () => {
    const journal = { date: new Date().toISOString(), extraites: 0, doublons: 0, cout_usd: 0, erreurs: [] };
    const n = await an.traiterMails([{ date: journal.date, sujet: 'Citadines A', html }], journal, { ia: false });
    assert.strictEqual(n.length, 7); assert.strictEqual(journal.nouvelles, 3); assert.strictEqual(journal.rejetees, 4);
    const j2 = { date: new Date().toISOString(), extraites: 0, doublons: 0, cout_usd: 0, erreurs: [] };
    await an.traiterMails([{ date: j2.date, sujet: 'Citadines A', html }], j2, { ia: false });
    assert.strictEqual(j2.doublons, 7, 'même alerte relue : aucun doublon');
    assert.strictEqual((await an.lireAnnonces()).length, 7);
    // 5. Nuit : 23 h 30 à Paris = nuit, 9 h = jour.
    assert.strictEqual(an.nuit(new Date('2026-10-23T21:30:00Z')), true);
    assert.strictEqual(an.nuit(new Date('2026-10-24T07:00:00Z')), false);
    console.log('\n✅ Robot Annonces : parsing, règles, score, dédoublonnage et plage de nuit OK');
})().catch(e => { console.error(e); process.exit(1); });
