// Espace vente : quand un véhicule a un acheteur, une seule saisie (acheteur, prix, date, kilométrage) produit
// le bon de commande, le certificat de cession (Cerfa 15776*01, société = ancien propriétaire) et la facture
// (régime de la marge par défaut). Saisie gardée dans le réglage « vente:<id> », numéros de facture
// chronologiques dans « factures_vente » (un numéro attribué n'est jamais réutilisé ni changé).
const store = require('./store');
const compta = require('./compta');
const dossier = require('./dossier');
const cession = require('./cession');
const bonCommande = require('./bon-commande');
const facture = require('./facture-vente');

const txt = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const n = v => { const x = Math.round(Number(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')) * 100) / 100; return Number.isFinite(x) ? x : 0; };
const aujourdhui = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
const fr = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const dateIso = t => { const m = /(\d{2})[-/](\d{2})[-/](\d{4})/.exec(String(t || '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : /^\d{4}-\d{2}-\d{2}/.test(String(t || '')) ? String(t).slice(0, 10) : ''; };
const milliers = s => String(s || '').replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// Le véhicule tel qu'il doit figurer sur les trois documents : fiche du dossier de vente, puis carte grise scannée,
// puis fiche plaque de la demande d'origine.
async function infosVehicule(v) {
    const d = v.ref ? await store.lireDemande(v.ref) : null, x = (d && d.data) || {}, f = x.fiche_api || {}, cg = x.carte_grise || {};
    const fi = (await dossier.lire(v.id).catch(() => null) || {}).fiche || {};
    const mots = String(v.libelle || x.vehicule || '').replace(/\b(19|20)\d{2}\b/, '').trim().split(/\s+/);
    const ch = fi.puissance_ch || f.puisFiscReelCH || '', cv = f.puisFisc || '';
    return {
        marque: String(fi.marque || cg.marque || f.marque || mots[0] || '').toUpperCase(), modele: fi.modele || f.modele || mots.slice(1).join(' '),
        version: fi.version || f.version || '', immatriculation: String(v.plaque || x.plaque || cg.immatriculation || '').toUpperCase(),
        vin: String(fi.vin || v.vin || cg.vin || x.vin || f.vin || '').toUpperCase(),
        date_immatriculation: dateIso(fi.mise_circulation) || cg.date_premiere_immatriculation || dateIso(f.date1erCir_fr || f.date1erCir),
        kilometrage: milliers(fi.km || v.kilometrage || x.kilometrage),
        energie: fi.carburant || f.energieNGC || f.energie || x.carburant || '', boite: fi.boite || f.boiteVitesse || x.boite || '',
        couleur: fi.couleur || f.couleur || '', puissance: [ch && `${ch} ch`, cv && `${cv} CV`].filter(Boolean).join(' · '),
        numero_formule: x.numero_formule || cg.numero_formule || '',
        type_version: cg.type_variante_version || '', genre: cg.genre || f.genreVCGNGC || f.genre || 'VP', denomination: cg.denomination_commerciale || ''
    };
}

// La société qui vend : coordonnées du bon de commande (réglage « bon_commande ») + adresse en champs du Cerfa.
async function vendeur() {
    const g = await store.lireReglage('bon_commande', {}) || {};
    const { representant, ...reste } = g;   // plus de représentant nommé sur les documents
    return { ...bonCommande.VENDEUR_DEFAUT, ...reste };
}

async function preparer(v) {
    const garde = await store.lireReglage('vente:' + v.id, null);
    const ve = await infosVehicule(v), soc = await compta.societe();
    const base = {
        acheteur: { type: 'particulier', sexe: '', nom: '', prenom: '', societe: '', siret: '', tva: '', num: '', extension: '', type_voie: '', voie: '', cp: '', commune: '', naissance: '', lieu_naissance: '', telephone: '', email: '' },
        vente: { date: aujourdhui(), heure: '', lieu: soc.lieu_signature || soc.commune || '', prix_ttc: v.prix_vente || '', acompte: '', mode_reglement: 'Virement', payee: false, regime: 'marge', observations: '' },
        vehicule: ve
    };
    const g = garde || {};
    return {
        ...base, ...g,
        acheteur: { ...base.acheteur, ...(g.acheteur || {}) }, vente: { ...base.vente, ...(g.vente || {}) },
        // Le véhicule : ce qui a été corrigé à la main prime sur la fiche.
        vehicule: { ...ve, ...Object.fromEntries(Object.entries(g.vehicule || {}).filter(([, val]) => txt(val))) },
        vendeur: await vendeur(), societe: soc, numero_facture: g.numero_facture || '', documents: g.documents || {}
    };
}

// Numéro de facture : FV-AAAA-NNN, chronologique sur l'année, réservé une fois pour toutes pour ce véhicule.
let file = Promise.resolve();
function numeroFacture() {
    const p = file.then(async () => {
        const an = aujourdhui().slice(0, 4), c = await store.lireReglage('factures_vente', {}) || {};
        const suivant = (c.annee === an ? Number(c.dernier) || 0 : 0) + 1;
        await store.ecrireReglage('factures_vente', { annee: an, dernier: suivant });
        return `FV-${an}-${String(suivant).padStart(3, '0')}`;
    });
    file = p.catch(() => {});
    return p;
}

function nettoyer(b) {
    const a = b.acheteur || {}, s = b.vente || {}, ve = b.vehicule || {};
    const A = {}; for (const k of ['type', 'sexe', 'nom', 'prenom', 'societe', 'siret', 'tva', 'num', 'extension', 'type_voie', 'voie', 'cp', 'commune', 'naissance', 'lieu_naissance', 'telephone', 'email']) A[k] = txt(a[k], 160);
    A.type = A.type === 'societe' ? 'societe' : 'particulier'; A.nom = A.nom.toUpperCase();
    const S = { date: dateIso(s.date) || aujourdhui(), heure: /^\d{2}:\d{2}$/.test(s.heure || '') ? s.heure : '', lieu: txt(s.lieu, 80), prix_ttc: n(s.prix_ttc), acompte: n(s.acompte),
        mode_reglement: txt(s.mode_reglement, 60), payee: s.payee === true || s.payee === 'true' || s.payee === 'on', regime: s.regime === 'normal' ? 'normal' : 'marge', observations: txt(s.observations, 600) };
    const V = {}; for (const k of ['marque', 'modele', 'version', 'immatriculation', 'vin', 'date_immatriculation', 'kilometrage', 'energie', 'boite', 'couleur', 'puissance', 'numero_formule', 'type_version', 'genre', 'denomination']) V[k] = txt(ve[k], 80);
    V.immatriculation = V.immatriculation.toUpperCase(); V.vin = V.vin.toUpperCase(); V.kilometrage = milliers(V.kilometrage);
    return { acheteur: A, vente: S, vehicule: V };
}

// Génère les documents demandés, les range dans les documents du véhicule (remplace la version générée précédente)
// et, sur demande, passe le véhicule en « Vendu » avec le prix et la date.
async function generer(vid, b) {
    const v = (await compta.tout()).vehicules.find(x => x.id === vid);
    if (!v) { const e = new Error('Véhicule introuvable'); e.status = 404; throw e; }
    const { acheteur: a, vente: s, vehicule: ve } = nettoyer(b);
    const voulus = new Set((b.generer || []).filter(t => ['bon_commande', 'cession_vente', 'facture'].includes(t)));
    const err = m => { const e = new Error(m); e.status = 400; throw e; };
    if (!(a.type === 'societe' ? a.societe : a.nom)) err('Indiquez le nom de l\'acheteur');
    if (voulus.has('facture') && !s.prix_ttc) err('Indiquez le prix de vente pour la facture');
    if (voulus.has('facture') && (!a.voie || !a.cp || !a.commune)) err('L\'adresse de l\'acheteur est obligatoire sur la facture');

    const garde = await store.lireReglage('vente:' + vid, {}) || {};
    let numero = garde.numero_facture || '';
    if (voulus.has('facture') && !numero) numero = await numeroFacture();
    const V = await vendeur();
    const nomComplet = a.type === 'societe' ? a.societe : [a.nom, a.prenom].filter(Boolean).join(' ');
    const adresse = [a.num, a.extension, a.type_voie, a.voie].filter(Boolean).join(' ').replace(/^(\d+) ([A-Za-z]{1,3}) /, '$1$2 ');
    const cpVille = [a.cp, a.commune].filter(Boolean).join(' ');
    const mention = s.regime === 'marge' ? `${facture.MENTION_MARGE} : TVA sur la marge (CGI art. 297 A), non récupérable.` : '';
    const plaque = (ve.immatriculation || v.plaque || vid).replace(/[^\w-]/g, '');
    const fait = {};
    const ranger = async (type, nom, pdf) => {
        for (const dd of (v.documents || []).filter(x => x.type === type && x.genere)) await compta.supprimerDocument(vid, dd.path).catch(() => {});
        const w = await compta.ajouterDocument(vid, type, { originalname: nom, buffer: pdf }, `${aujourdhui()}_${nom}`);
        const doc = w.documents[w.documents.length - 1];
        await compta.marquerGenere(vid, doc.path);
        fait[type] = doc;
    };

    if (voulus.has('bon_commande')) {
        const numBc = garde.numero_bc || `BC-${s.date.replace(/-/g, '')}-${plaque.replace(/-/g, '')}`;
        garde.numero_bc = numBc;
        await ranger('bon_commande', `bon-de-commande-${numBc}.pdf`, await bonCommande.generer({
            numero: numBc, date: fr(s.date), vendeur: V,
            acheteur: { societe: a.type === 'societe' ? a.societe : '', siret: a.siret, nom: a.type === 'societe' ? '' : a.nom, prenom: a.type === 'societe' ? '' : a.prenom, adresse, cp_ville: cpVille, telephone: a.telephone, email: a.email },
            vehicule: { ...ve, mise_circulation: fr(ve.date_immatriculation), observations: s.observations },
            prix: s.prix_ttc ? { ttc: s.prix_ttc, acompte: s.acompte, mention } : null
        }));
    }
    if (voulus.has('cession_vente')) {
        const soc = await compta.societe();
        await ranger('cession_vente', `certificat-cession-vente-${plaque}.pdf`, await cession.generer({
            sens: 'vente', immatriculation: ve.immatriculation, vin: ve.vin, date_immatriculation: ve.date_immatriculation, marque: ve.marque,
            type_version: ve.type_version, genre: ve.genre, denomination: ve.denomination || ve.modele.toUpperCase(), kilometrage: ve.kilometrage.replace(/\s/g, ''),
            certificat_present: true, numero_formule: ve.numero_formule,
            vendeur_morale: true, vendeur_nom: soc.raison, vendeur_siret: soc.siret, vendeur_num: soc.num, vendeur_extension: soc.extension, vendeur_type_voie: soc.type_voie,
            vendeur_voie: soc.voie, vendeur_cp: soc.cp, vendeur_commune: soc.commune,
            date_vente: s.date, heure_vente: s.heure, destruction: false, certif_situation: true, sans_transformation: true, lieu_signature: s.lieu,
            acheteur_morale: a.type === 'societe', acheteur_sexe: a.sexe, acheteur_naissance: a.naissance, acheteur_lieu_naissance: a.lieu_naissance,
            acheteur_nom: a.type === 'societe' ? a.societe : [a.nom, a.prenom].filter(Boolean).join(' '), acheteur_siret: a.type === 'societe' ? a.siret.replace(/\s/g, '') : '',
            acheteur_num: a.num, acheteur_extension: a.extension, acheteur_type_voie: a.type_voie, acheteur_voie: a.voie, acheteur_cp: a.cp, acheteur_commune: a.commune
        }));
    }
    if (voulus.has('facture')) {
        await ranger('facture', `facture-${numero}.pdf`, await facture.generer({
            numero, date: fr(aujourdhui()), date_livraison: fr(s.date), regime: s.regime, prix_ttc: s.prix_ttc, acompte: s.acompte,
            payee: s.payee, payee_le: fr(s.date), mode_reglement: s.mode_reglement, observations: s.observations,
            vendeur: V, conditions: 'Véhicule d\'occasion vendu en l\'état, tel que vu et essayé par l\'acheteur.',
            acheteur: { societe: a.type === 'societe' ? a.societe : '', nom: a.type === 'societe' ? '' : a.nom, prenom: a.type === 'societe' ? '' : a.prenom, adresse, cp_ville: cpVille,
                siret: a.type === 'societe' ? a.siret : '', tva: a.type === 'societe' ? a.tva : '', telephone: a.telephone, email: a.email, pro: a.type === 'societe' },
            vehicule: { ...ve, mise_circulation: fr(ve.date_immatriculation) }
        }));
    }

    await store.ecrireReglage('vente:' + vid, {
        ...garde, acheteur: a, vente: s, vehicule: ve, numero_facture: numero, acheteur_nom: nomComplet,
        documents: { ...(garde.documents || {}), ...Object.fromEntries(Object.entries(fait).map(([k, d]) => [k, d.path])) }, maj: new Date().toISOString()
    });
    if (b.marquer_vendu && s.prix_ttc && v.statut !== 'vendu') await compta.majVehicule(vid, { statut: 'vendu', prix_vente: s.prix_ttc, date_vente: s.date });
    else if (b.marquer_vendu && s.prix_ttc) await compta.majVehicule(vid, { prix_vente: s.prix_ttc, date_vente: s.date });
    return { ok: true, numero_facture: numero, documents: fait };
}

module.exports = { preparer, generer, infosVehicule };
