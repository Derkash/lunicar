// Tests de lib/analyse-vehicule.js sur des scénarios réalistes. DONNÉES DE TEST FICTIVES (prix, annonces, relevés) :
// elles servent à vérifier le calcul, pas à estimer une voiture. Lancement : node tools/analyse/test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const dir = process.env.GARDER_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'lunicar-analyse-'));
if (process.env.GARDER_DIR) fs.mkdirSync(dir, { recursive: true });
process.env.DATA_DIR = dir;
delete process.env.SUPABASE_URL;

// Graine pseudo-aléatoire : annonces de test reproductibles.
let g = 42; const r = () => (g = (g * 16807) % 2147483647) / 2147483647;
// Marché fictif : prix = 12 000 − 3 € / 100 km, ± 8 %, quelques pros plus chers, quelques aberrants.
function annonces(km, n, { an = 2017, energie = 'Diesel', boite = 'Manuelle', ch = 120, pente = 0.03, base = 12000 } = {}) {
    const l = [];
    for (let i = 0; i < n; i++) {
        const k = Math.max(5000, Math.round(km - 60000 + r() * 120000)), pro = r() < 0.3 ? 1 : 0;
        l.push({ id: `T${km}${i}`, prix: Math.round((base - pente * k) * (0.92 + r() * 0.16) + (pro ? 500 : 0)), km: k, an: an + (r() < 0.3 ? 1 : 0) - (r() < 0.3 ? 1 : 0), pro, jours: Math.round(r() * 80), energie, boite, ch, ville: 'Test', lat: 48.8 + r(), lng: 2.3 + r() });
    }
    l.push({ id: 'ABER1', prix: 900, km, an, pro: 0, jours: 3, energie, boite, ch });            // aberrant bas
    l.push({ id: 'ABER2', prix: 30000, km, an, pro: 1, jours: 3, energie, boite, ch });          // aberrant haut
    l.push({ id: 'HS1', prix: 2000, km, an, pro: 0, jours: 3, energie, boite, ch, hs: 1 });       // en panne
    l.push({ id: 'ESS', prix: 9000, km, an, pro: 0, jours: 3, energie: 'Essence', boite, ch });   // autre énergie
    l.push({ ...l[0], id: l[0].id });                                                             // doublon
    return l;
}
fs.writeFileSync(path.join(dir, 'marche-sonar.json'), JSON.stringify({ maj: new Date().toISOString(), vehicules: {
    TT100AA: { plaque: 'TT100AA', km: 190000, moyenne: 6300, fiabilite: 4, version: { label: '1.6 MultiJet 120 Trekking', make: 'Fiat', model: '500L', make_model: 'FIAT_500L', energy: 'Diesel', power: 120, gearbox: 'Manuelle', annee: 2017, suggeree: true },
        tranches: [['badge_key_5_5', 'Très bonne affaire', 4800, 5600], ['badge_key_4_5', 'Bonne affaire', 5600, 6100], ['badge_key_3_5', 'Prix équitable', 6100, 6600], ['badge_key_2_5', 'Légèrement supérieur', 6600, 7200], ['badge_key_1_5', 'Au-dessus du marché', 7200, 8400]],
        ventes: { prix: 6000, jours: 30, nb: 5, liste: [[180000, '2017', 25, '2026-10', 6100], [195000, '2017', 40, '2026-10', 5800], [170000, '2016', 30, '2026-09', 6200], [200000, '2018', 20, '2026-11', 6000], [210000, '2017', 35, '2026-10', 5500]] }, offre_demande: [], points: [{ km: 190000, moyenne: 6300, tranches: [] }] },
    TT200BB: { plaque: 'TT200BB', km: 120000, moyenne: 7400, fiabilite: 3, version: { label: '1.0 EcoBoost 100 Titanium', make: 'Ford', model: 'Fiesta', make_model: 'FORD_FIESTA', energy: 'Essence', power: 100, gearbox: 'Manuelle', annee: 2016, suggeree: true },
        tranches: [['badge_key_5_5', 'Très bonne affaire', 5900, 6700], ['badge_key_4_5', 'Bonne affaire', 6700, 7200]], ventes: null, offre_demande: [], points: [{ km: 120000, moyenne: 7400, tranches: [] }] },
    TT300CC: { plaque: 'TT300CC', km: 60000, moyenne: 9800, fiabilite: 3, version: { label: 'R110 Zen', make: 'Renault', model: 'Zoe', make_model: 'RENAULT_ZOE', energy: 'Electrique', power: 108, annee: 2019, suggeree: true },
        tranches: [['badge_key_5_5', 'Très bonne affaire', 8000, 9000]], ventes: null, offre_demande: [], points: [{ km: 60000, moyenne: 9800, tranches: [] }] }
} }));
fs.writeFileSync(path.join(dir, 'crm.json'), JSON.stringify({ demandes: [], messages: [], reglages: {} }));

const store = require('../../lib/store');
const AV = require('../../lib/analyse-vehicule');
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); };
const demande = (ref, data, suivi = {}) => ({ ref, id: ref.toLowerCase() + '-0000-4000-8000-000000000000', created_at: new Date().toISOString(), type: 'estimation', statut: 'nouvelle', data, suivi, photos: [] });
const eur = v => v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €';

(async () => {
    // ---------- Scénario 3 du brief : Fiat 500L, 190 000 km, distribution inconnue, pas de factures
    console.log('Fiat 500L 1.6 MultiJet · 190 000 km · distribution inconnue');
    const fiat = demande('TESTFIAT', { plaque: 'TT-100-AA', vehicule: 'Fiat 500L', annee: '2017', kilometrage: '190000', mecanique: 'Roule, aucun souci', carrosserie: 'Très bon état', cles: '2 clés ou plus', carnet: 'Non', voyant: 'Non', prix_souhaite: '5000', code_postal: '93600', ville: 'Aulnay-sous-Bois',
        fiche_api: { marque: 'FIAT', modele: '500L', version: '1.6 MULTIJET 120 TREKKING', energieNGC: 'GAZOLE', date1erCir_fr: '28-04-2017', couleur: 'GRIS' } });
    await store.enregistrerDemande(fiat);
    AV.majAnalyse('TESTFIAT', { vendeur: { lat: 48.938, lng: 2.497 } });
    const local = [{ id: 'VENDEUR', prix: 5400, km: 186000, an: 2017, mec: '04/2017', pro: 0, jours: 41, ville: 'Aulnay-sous-Bois', lat: 48.94, lng: 2.50, couleur: 'Gris', version: '500L 1.6 Multijet 120ch Trekking', energie: 'Diesel', boite: 'Manuelle', ch: 120, texte: 'Distribution faite, CT ok', url: '/ad/voitures/0000000000' },
        { id: 'AUTRE', prix: 6900, km: 120000, an: 2018, pro: 1, jours: 5, ville: 'Bondy', lat: 48.9, lng: 2.48, energie: 'Diesel', boite: 'Manuelle', ch: 120 }];
    let c = await AV.recevoir('TESTFIAT', { lbc: { local: { ads: local }, bandes: [{ min: 130000, max: 250000, ads: annonces(190000, 45) }] }, textes: { resume: '', faits: [], contradictions: [] } });
    ok(c.marche.annonces.n >= 30, `courbe sur ${c.marche.annonces.n} annonces, ${c.marche.annonces.ecartees} écartées (${c.marche.annonces.motifs_ecart.join(', ')})`);
    ok(c.marche.annonces.motifs_ecart.some(m => /doublon/.test(m)) && c.marche.annonces.motifs_ecart.some(m => /panne/.test(m)) && c.marche.annonces.motifs_ecart.some(m => /énergie/.test(m)), 'doublon, panne et autre énergie écartés');
    ok(c.marche.annonces.pente_10000km < 0, `pente ${c.marche.annonces.pente_10000km} € / 10 000 km`);
    ok(c.marche.composantes.length >= 3, `prix retenu ${eur(c.marche.prix_retenu)} = ${c.marche.composantes.map(x => `${x.source} ${eur(x.prix)} (${x.poids} %)`).join(' + ')}`);
    ok(c.marche.annonces.part && c.marche.annonces.pro, `particuliers ${eur(c.marche.annonces.part.mediane)} · pros ${eur(c.marche.annonces.pro.mediane)} (${c.marche.annonces.part_pct} % particuliers)`);
    const dist = c.risques.find(x => x.organe === 'distribution');
    ok(dist && dist.niveau === 'rouge' && dist.provision > 0, `distribution : ${dist.niveau}, ${eur(dist.provision)} provisionnés (${dist.detail})`);
    ok(c.risques.some(x => /embrayage/i.test(x.titre)), 'embrayage d\'origine probable signalé à 190 000 km');
    ok(c.annonce_vendeur && c.annonce_vendeur.niveau === 'sure' && c.annonce_vendeur.annonce.id === 'VENDEUR', `annonce du vendeur trouvée (${c.annonce_vendeur.score} pts : ${c.annonce_vendeur.preuves.join(', ')})`);
    ok(c.offre && c.offre.offre > 0 && c.offre.offre < c.offre.achat_max_sain, `offre ${eur(c.offre.offre)} (${eur(c.offre.fourchette.min)}–${eur(c.offre.fourchette.max)}) < achat max sain ${eur(c.offre.achat_max_sain)}, confiance ${c.confiance.niveau} ${c.confiance.score}`);
    ok(c.questions[0] && /distribution|annonce|vôtre/i.test(c.questions.slice(0, 3).map(q => q.texte).join(' ')), `1res questions : ${c.questions.slice(0, 3).map(q => q.texte).join(' | ')}`);
    ok(/Offre conseillée/.test(AV.ligneNotification(c)), 'notification : ' + AV.ligneNotification(c));

    // ---------- Même Fiat : le message dit « distribution faite à 150 000 km en 2023, facture » → provision réduite
    console.log('Fiat : distribution faite selon le message');
    const avant = dist.provision;
    c = await AV.recevoir('TESTFIAT', { textes: { resume: 'Distribution faite', faits: [{ type: 'entretien_fait', organe: 'distribution', libelle: 'Distribution remplacée', citation: 'courroie faite en 2023 à 150 000 km, facture dispo', source: 'formulaire', km: 150000, annee: 2023, facture: true }], contradictions: [] } });
    const d2 = c.risques.find(x => x.organe === 'distribution');
    ok(d2.niveau !== 'rouge' || d2.provision < avant, `distribution : ${d2.niveau}, ${eur(d2.provision)} (avant ${eur(avant)}) · ${d2.detail}`);

    // ---------- Contradiction réponse / texte
    console.log('Contradiction : « aucun voyant » mais le texte parle du voyant moteur');
    c = await AV.recevoir('TESTFIAT', { textes: { resume: '', faits: [{ type: 'defaut', organe: 'moteur', libelle: 'Voyant moteur par moments', citation: 'le voyant moteur s\'allume de temps en temps', source: 'e-mail du 2026-11-23', gravite: 'moyenne' }], contradictions: [{ sujet: 'voyant moteur', reponse: 'Non', citation: 'le voyant moteur s\'allume de temps en temps' }] } });
    ok(/Clarifier/.test(c.questions[0].texte), `question n°1 : ${c.questions[0].texte}`);
    ok(c.risques.some(x => x.texte && x.organe === 'moteur'), 'défaut lu dans le texte provisionné');

    // ---------- Ford Fiesta 1.0 EcoBoost : courroie dans l'huile (fiche moteur en brouillon)
    console.log('Ford Fiesta 1.0 EcoBoost · 120 000 km');
    const fiesta = demande('TESTFORD', { plaque: 'TT-200-BB', vehicule: 'Ford Fiesta', annee: '2016', kilometrage: '120000', mecanique: 'Roule, aucun souci', carrosserie: 'Quelques rayures ou petits chocs', carnet: 'En partie', code_postal: '75020', ville: 'Paris',
        fiche_api: { marque: 'FORD', modele: 'FIESTA', version: '1.0 ECOBOOST 100 TITANIUM', code_moteur: 'SFJC', energieNGC: 'ESSENCE', date1erCir_fr: '31-10-2016' } });
    await store.enregistrerDemande(fiesta);
    c = await AV.recevoir('TESTFORD', { lbc: { bandes: [{ min: 60000, max: 180000, ads: annonces(120000, 25, { an: 2016, energie: 'Essence', ch: 100, base: 10500 }) }] } });
    ok(c.fiche_moteur && c.fiche_moteur.id === 'ford-1.0-ecoboost' && c.fiche_moteur.par === 'code moteur', `fiche moteur ${c.fiche_moteur.libelle} reconnue par ${c.fiche_moteur.par} (${c.fiche_moteur.statut})`);
    ok(c.risques.some(x => /huile/i.test(x.detail || '') && x.fiche), 'point « courroie humide / huile non conforme » affiché, non chiffré (brouillon)');
    ok(c.questions.some(q => /vidange/i.test(q.texte)), 'question sur les factures de vidange');
    // Fiche validée : ses coûts entrent dans l'offre
    const avantV = c.offre.offre;
    AV.validerFiche('ford-1.0-ecoboost');
    c = await AV.calculer(fiesta);
    ok(c.fiche_moteur.statut === 'valide' && c.offre.offre <= avantV, `fiche validée : offre ${eur(avantV)} → ${eur(c.offre.offre)}`);

    // ---------- Électrique : pas de distribution
    console.log('Renault Zoé électrique');
    const zoe = demande('TESTZOE', { plaque: 'TT-300-CC', vehicule: 'Renault Zoé', annee: '2019', kilometrage: '60000', mecanique: 'Roule, aucun souci', carnet: 'Oui', fiche_api: { marque: 'RENAULT', modele: 'ZOE', energieNGC: 'ELECTRIC', date1erCir_fr: '01-03-2019' } });
    await store.enregistrerDemande(zoe);
    c = await AV.recevoir('TESTZOE', { lbc: { bandes: [{ min: 0, max: 120000, ads: annonces(60000, 6, { an: 2019, energie: 'Électrique', boite: 'Automatique', ch: 108, base: 11000 }) }] } });
    ok(!c.risques.some(x => x.organe === 'distribution') && !c.risques.some(x => /embrayage/i.test(x.titre)), 'ni distribution ni embrayage pour une électrique');
    ok(c.confiance.score < 80, `peu de comparables (${c.marche.annonces.n}) : confiance ${c.confiance.niveau} (${c.confiance.score})`);

    // ---------- Scénario 4 : défaut moteur + voyant, pas de plaque Sonar → peu de données
    console.log('Voiture en panne moteur, voyant allumé, sans relevé Sonar');
    const panne = demande('TESTPANN', { vehicule: 'Peugeot 307 1.6 HDi', annee: '2006', kilometrage: '260000', mecanique: 'Ne roule plus (en panne)', nature_panne: 'Moteur', deplacable: 'Non, dépanneuse nécessaire', voyant: 'Oui', carrosserie: 'Abîmée', carnet: 'Non', cles: '1 clé' });
    await store.enregistrerDemande(panne);
    c = await AV.recevoir('TESTPANN', { lbc: { bandes: [{ min: 200000, max: 320000, ads: annonces(260000, 4, { an: 2006, ch: 90, base: 4000, pente: 0.008 }) }] } });
    ok(c.risques.filter(x => x.niveau === 'rouge').length >= 1, `risques rouges : ${c.risques.filter(x => x.niveau === 'rouge').map(x => x.titre).join(', ')}`);
    ok(!c.offre || c.offre.offre <= 1000, `offre prudente : ${c.offre ? eur(c.offre.offre) : 'aucune (données insuffisantes)'} · confiance ${c.confiance.niveau}`);
    ok(c.confiance.niveau === 'insuffisante' || c.confiance.niveau === 'faible', 'confiance faible ou insuffisante sans Sonar et avec 4 annonces');

    console.log('\nTous les scénarios passent.');
    if (!process.env.GARDER_DIR) fs.rmSync(dir, { recursive: true, force: true });
    else setTimeout(() => process.exit(0), 1500);   // laisse le temps d'écrire le fichier des analyses
})().catch(e => { console.error('ÉCHEC :', e.message); fs.rmSync(dir, { recursive: true, force: true }); process.exit(1); });
