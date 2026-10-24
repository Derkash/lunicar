// Compta de LUNICAR : véhicules achetés (achat, dépenses, vente, marge) et dépenses générales,
// avec qui a payé (Abdoul-Khader, Youssouf ou le compte de la société) pour suivre les avances de chacun.
// Stocké dans le réglage « compta » (disque persistant ou Supabase selon lib/store.js).
const crypto = require('crypto');
const store = require('./store');

const PAYEURS = { abdoul: 'Abdoul-Khader Guirassy', youssouf: 'Youssouf Guirassy', societe: 'Compte de la société' };
const STATUTS_VEHICULE = { prospect: 'RDV pris', stock: 'Acheté, à récupérer', preparation: 'En préparation', en_vente: 'En vente', vendu: 'Vendu', perdu: 'Sans suite' };
const CATEGORIES_VEHICULE = ['Train / transport', 'Carburant', 'Péages', 'Réparation / pièces', 'Contrôle technique', 'Carte grise / démarches',
    'Nettoyage / préparation', 'Annonce / publicité', 'Assurance', 'Stationnement / fourrière', 'Commission / intermédiaire', 'Autre'];
const REMBOURSEMENT = 'Remboursement d\'avance à un associé';
const CATEGORIES_GENERALES = ['Publicité Google Ads', 'Site / logiciels', 'Téléphonie', 'Assurance', 'Banque / comptable', 'Déplacements', 'Matériel', 'Locaux / parking', 'Autre', REMBOURSEMENT];

const id = () => crypto.randomUUID().slice(0, 12);
const n = v => { const x = Math.round(Number(String(v == null ? '' : v).replace(',', '.').replace(/[^\d.-]/g, '')) * 100) / 100; return Number.isFinite(x) ? x : 0; };
const jour = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
const payeur = v => PAYEURS[v] ? v : 'societe';
const txt = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);

// Écritures en file : deux saisies simultanées ne s'écrasent pas.
let file = Promise.resolve();
async function lire() { const c = await store.lireReglage('compta', null); return { vehicules: [], depenses: [], ...(c || {}) }; }
function modifier(fn) {
    const p = file.then(async () => { const c = await lire(); const r = await fn(c); await store.ecrireReglage('compta', c); return r; });
    file = p.catch(() => {});
    return p;
}

// Une fois acheté, un véhicule n'avance que dans ce sens (jamais de retour à « RDV pris » ou « Sans suite »).
const ORDRE_ACHETE = ['stock', 'preparation', 'en_vente', 'vendu'];
function statutAutorise(avant, apres) {
    if (!avant || avant === apres) return true;
    const i = ORDRE_ACHETE.indexOf(avant);
    if (i < 0) return true;                       // prospect / sans suite : libre
    return ORDRE_ACHETE.indexOf(apres) > i;       // acheté : seulement vers l'avant
}
function vehiculeDepuis(b, v = {}) {
    const o = { ...v };
    if (b.statut !== undefined && v.statut && !statutAutorise(v.statut, b.statut)) {
        const e = new Error(`Véhicule déjà ${v.statut === 'vendu' ? 'vendu' : 'acheté'} : retour en arrière impossible`); e.status = 400; throw e;
    }
    for (const k of ['libelle', 'plaque', 'canal_vente', 'notes', 'vin']) if (b[k] !== undefined) o[k] = txt(b[k], k === 'notes' ? 4000 : 120);
    for (const k of ['annee', 'kilometrage']) if (b[k] !== undefined) o[k] = txt(b[k], 12);
    for (const k of ['prix_achat', 'prix_vente', 'estimation_vente', 'prix_convenu']) if (b[k] !== undefined) o[k] = n(b[k]);
    for (const k of ['date_achat', 'date_vente']) if (b[k] !== undefined) o[k] = b[k] ? jour(b[k]) : '';
    if (b.payeur_achat !== undefined) o.payeur_achat = payeur(b.payeur_achat);
    if (b.encaisse_par !== undefined) o.encaisse_par = payeur(b.encaisse_par);
    if (b.statut !== undefined && STATUTS_VEHICULE[b.statut]) o.statut = b.statut;
    if (b.rdv !== undefined) o.rdv = b.rdv;
    if (o.statut === 'vendu' && !o.date_vente) o.date_vente = jour();
    if (b.plaque !== undefined) o.plaque = o.plaque.toUpperCase();
    return o;
}

function depenseDepuis(b, d = {}) {
    const o = { ...d };
    if (b.montant !== undefined) o.montant = Math.abs(n(b.montant));
    if (b.date !== undefined) o.date = jour(b.date);
    if (b.libelle !== undefined) o.libelle = txt(b.libelle);
    if (b.categorie !== undefined) o.categorie = txt(b.categorie, 60) || 'Autre';
    if (b.payeur !== undefined) o.payeur = payeur(b.payeur);
    for (const k of ['montant_ht', 'tva', 'taux_tva']) if (b[k] !== undefined) o[k] = b[k] === '' || b[k] == null ? null : n(b[k]);
    if (b.tva_recuperable !== undefined) o.tva_recuperable = b.tva_recuperable === true || b.tva_recuperable === 'true' || b.tva_recuperable === 'on';
    if (b.fournisseur !== undefined) o.fournisseur = txt(b.fournisseur, 120);
    if (b.vehicule_id !== undefined) o.vehicule_id = b.vehicule_id ? txt(b.vehicule_id, 20) : null;
    // Remboursement : la société (ou un associé) rend une avance à un associé.
    if (b.beneficiaire !== undefined) o.beneficiaire = PAYEURS[b.beneficiaire] && b.beneficiaire !== 'societe' ? b.beneficiaire : null;
    if (o.categorie === REMBOURSEMENT) { o.vehicule_id = null; if (!o.beneficiaire) throw new Error('Choisir l\'associé remboursé'); } else o.beneficiaire = null;
    return o;
}

// Coût de revient, marge et répartition par payeur d'un véhicule.
function bilanVehicule(v, depenses) {
    const deps = depenses.filter(d => d.vehicule_id === v.id);
    const frais = deps.reduce((t, d) => t + d.montant, 0);
    // Prospect (RDV pris) : le prix convenu tient lieu de prix d'achat pour la marge prévue.
    const base = n(v.prix_achat) || (v.statut === 'prospect' ? n(v.prix_convenu) : 0);
    const cout = base + frais;
    const parPayeur = Object.fromEntries(Object.keys(PAYEURS).map(k => [k, 0]));
    if (v.prix_achat) parPayeur[v.payeur_achat || 'societe'] += n(v.prix_achat);
    deps.forEach(d => { parPayeur[d.payeur] = (parPayeur[d.payeur] || 0) + d.montant; });
    const parCategorie = {};
    deps.forEach(d => { parCategorie[d.categorie] = (parCategorie[d.categorie] || 0) + d.montant; });
    const vendu = v.statut === 'vendu' && n(v.prix_vente) > 0;
    const fin = vendu && v.date_vente ? new Date(v.date_vente) : new Date();
    const jours = v.date_achat && !['prospect', 'perdu'].includes(v.statut) ? Math.max(0, Math.round((fin - new Date(v.date_achat)) / 864e5)) : null;
    return { frais: round(frais), cout: round(cout), marge: vendu ? round(n(v.prix_vente) - cout) : null, marge_prevue: !vendu && v.statut !== 'perdu' && n(v.estimation_vente) ? round(n(v.estimation_vente) - cout) : null,
        nb_depenses: deps.length, par_payeur: parPayeur, par_categorie: parCategorie, jours };
}
const round = x => Math.round(x * 100) / 100;

// Avances de chacun : tout ce qu'il a payé (achats + dépenses) moins ce qu'il a encaissé (ventes).
function soldes(c) {
    const s = Object.fromEntries(Object.keys(PAYEURS).map(k => [k, { paye: 0, encaisse: 0 }]));
    c.vehicules.forEach(v => {
        if (n(v.prix_achat)) s[v.payeur_achat || 'societe'].paye += n(v.prix_achat);
        if (v.statut === 'vendu' && n(v.prix_vente)) s[v.encaisse_par || 'societe'].encaisse += n(v.prix_vente);
    });
    c.depenses.forEach(d => { s[d.payeur].paye += d.montant; if (d.beneficiaire) s[d.beneficiaire].encaisse += d.montant; });
    for (const k of Object.keys(s)) { s[k].paye = round(s[k].paye); s[k].encaisse = round(s[k].encaisse); s[k].net = round(s[k].paye - s[k].encaisse); }
    // Associés à parts égales : celui qui a le plus avancé doit récupérer la moitié de l'écart.
    const ecart = round((s.abdoul.net - s.youssouf.net) / 2);
    return { ...s, equilibre: ecart === 0 ? null : ecart > 0 ? { de: 'youssouf', a: 'abdoul', montant: ecart } : { de: 'abdoul', a: 'youssouf', montant: -ecart } };
}

async function tout() {
    const c = await lire();
    return {
        vehicules: c.vehicules.map(v => ({ ...v, bilan: bilanVehicule(v, c.depenses) })).sort((a, b) => String(b.date_achat || b.cree_le).localeCompare(String(a.date_achat || a.cree_le))),
        depenses: [...c.depenses].sort((a, b) => b.date.localeCompare(a.date) || String(b.cree_le).localeCompare(String(a.cree_le))),
        soldes: soldes(c), payeurs: PAYEURS, remboursement: REMBOURSEMENT, types_document: TYPES_DOCUMENT, statuts: STATUTS_VEHICULE, categories: { vehicule: CATEGORIES_VEHICULE, generales: CATEGORIES_GENERALES }
    };
}

const creerVehicule = b => modifier(c => {
    const v = vehiculeDepuis(b, { id: id(), statut: 'stock', payeur_achat: 'societe', encaisse_par: 'societe', date_achat: jour(), cree_le: new Date().toISOString(), ref: b.ref ? txt(b.ref, 8).toUpperCase() : null });
    c.vehicules.push(v);
    return v;
});
const majVehicule = (vid, b) => modifier(c => {
    const i = c.vehicules.findIndex(v => v.id === vid);
    if (i < 0) throw new Error('Véhicule introuvable');
    c.vehicules[i] = vehiculeDepuis(b, c.vehicules[i]);
    return c.vehicules[i];
});
const supprimerVehicule = vid => modifier(async c => {
    const deps = c.depenses.filter(d => d.vehicule_id === vid);
    for (const d of deps) if (d.justificatif) await store.supprimerPhoto(d.justificatif.path).catch(() => {});
    c.depenses = c.depenses.filter(d => d.vehicule_id !== vid);
    c.vehicules = c.vehicules.filter(v => v.id !== vid);
    return true;
});

// Une demande entre dans « Nos véhicules » dès qu'un rendez-vous est pris (prospect sérieux), passe en stock
// à l'achat, et « Sans suite » si le rendez-vous échoue (gardée seulement si des frais ont été engagés).
async function syncDemande(d) {
    if (!d) return null;
    const x = d.data || {}, s = d.suivi || {}, e = d.estimation || {}, r = s.rdv || null;
    const c = await lire();
    const v = c.vehicules.find(w => w.ref === d.ref);
    const rdv = r ? { date: r.date, heure: r.heure, prix: r.prix || 0, avec: r.avec, lieu: r.lieu || '', statut: r.statut } : null;
    const estim = Number(s.prix_manuel_vente) || (e.prix && e.prix.vente_estime) || '';
    if (d.statut === 'achetee') {
        if (!v) return creerVehicule({ ref: d.ref, libelle: [x.vehicule, x.annee].filter(Boolean).join(' ') || 'Véhicule', plaque: x.plaque || '', annee: x.annee || '', kilometrage: x.kilometrage || '', vin: x.vin || '', prix_achat: s.prix_achat || (r && r.prix) || '', prix_convenu: (r && r.prix) || '', estimation_vente: estim, statut: 'stock', rdv });
        const maj = { rdv };
        if (['prospect', 'perdu'].includes(v.statut)) { maj.statut = 'stock'; maj.date_achat = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); }
        // Le prix d'achat saisi dans la fiche fait foi ; sinon le prix convenu au rendez-vous.
        if (Number(s.prix_achat) && Number(s.prix_achat) !== Number(v.prix_achat)) maj.prix_achat = s.prix_achat;
        else if (!Number(v.prix_achat) && r && r.prix) maj.prix_achat = r.prix;
        return majVehicule(v.id, maj);
    }
    if (r && r.statut === 'prevu' && !['vendue_ailleurs', 'refusee', 'sans_suite'].includes(d.statut)) {
        if (!v) return creerVehicule({ ref: d.ref, libelle: [x.vehicule, x.annee].filter(Boolean).join(' ') || 'Véhicule', plaque: x.plaque || '', annee: x.annee || '', kilometrage: x.kilometrage || '', vin: x.vin || '', prix_convenu: r.prix || '', estimation_vente: estim, statut: 'prospect', date_achat: '', rdv });
        return majVehicule(v.id, { rdv, prix_convenu: r.prix || v.prix_convenu || '', ...(v.statut === 'perdu' ? { statut: 'prospect' } : {}) });
    }
    // Rendez-vous annulé ou fait sans achat, ou demande close : le prospect sort de la liste.
    if (v && v.statut === 'prospect') {
        if (!c.depenses.some(dp => dp.vehicule_id === v.id)) return supprimerVehicule(v.id);
        return majVehicule(v.id, { statut: 'perdu', rdv });
    }
    return v || null;
}

// Compatibilité : une demande passée « Achetée » devient un véhicule.
async function vehiculeDepuisDemande(d) { return syncDemande(d); }
async function ajouterDepense(b, fichier) {
    const dep = depenseDepuis(b, { id: id(), date: jour(), categorie: 'Autre', payeur: 'societe', vehicule_id: null, libelle: '', montant: 0, cree_le: new Date().toISOString() });
    if (!dep.montant) throw new Error('Montant manquant');
    if (fichier) dep.justificatif = await store.ajouterPhoto('compta', `${dep.date}_${dep.id}_${fichier.originalname}`, fichier.buffer);
    return modifier(c => {
        if (dep.vehicule_id && !c.vehicules.some(v => v.id === dep.vehicule_id)) dep.vehicule_id = null;
        c.depenses.push(dep);
        return dep;
    });
}
const majDepense = (did, b, fichier) => modifier(async c => {
    const i = c.depenses.findIndex(d => d.id === did);
    if (i < 0) throw new Error('Dépense introuvable');
    const d = depenseDepuis(b, c.depenses[i]);
    if (fichier) {
        if (d.justificatif) await store.supprimerPhoto(d.justificatif.path).catch(() => {});
        d.justificatif = await store.ajouterPhoto('compta', `${d.date}_${d.id}_${fichier.originalname}`, fichier.buffer);
    }
    c.depenses[i] = d;
    return d;
});
const supprimerDepense = did => modifier(async c => {
    const d = c.depenses.find(x => x.id === did);
    if (d && d.justificatif) await store.supprimerPhoto(d.justificatif.path).catch(() => {});
    c.depenses = c.depenses.filter(x => x.id !== did);
    return true;
});

// Documents d'un véhicule : carte grise barrée, certificat de cession, déclaration d'achat, non-gage, cession à la vente…
const TYPES_DOCUMENT = { carte_grise: 'Carte grise barrée', cession_achat: 'Certificat de cession (achat)', declaration_achat: 'Déclaration d\'achat',
    non_gage: 'Certificat de situation (non-gage)', ct: 'Contrôle technique', cession_vente: 'Certificat de cession (vente)', facture: 'Facture', autre: 'Autre document' };
async function ajouterDocument(vid, type, fichier, nomForce) {
    const v = (await lire()).vehicules.find(x => x.id === vid);
    if (!v) throw new Error('Véhicule introuvable');
    const t = TYPES_DOCUMENT[type] ? type : 'autre';
    const doc = await store.ajouterPhoto(`vehicule-${vid}`, nomForce || `${new Date().toISOString().slice(0, 10)}_${t}_${Date.now()}_${fichier.originalname}`, fichier.buffer);
    return modifier(c => { const w = c.vehicules.find(x => x.id === vid); w.documents = [...(w.documents || []), { ...doc, type: t, libelle: TYPES_DOCUMENT[t] }]; return w; });
}
const supprimerDocument = (vid, p) => modifier(async c => {
    const w = c.vehicules.find(x => x.id === vid); if (!w) throw new Error('Véhicule introuvable');
    await store.supprimerPhoto(p).catch(() => {});
    w.documents = (w.documents || []).filter(d => d.path !== p); return w;
});
// Annulation explicite (erreur de saisie) : seul chemin pour revenir en arrière une fois acheté ou vendu.
// Achat annulé : le véhicule redevient « RDV pris » (ou disparaît s'il n'avait ni rendez-vous ni frais), prix et date d'achat effacés,
// certificat de cession généré supprimé. Vente annulée : retour « En vente », prix et date de vente effacés.
const annulerAchat = vid => modifier(async c => {
    const v = c.vehicules.find(x => x.id === vid); if (!v) throw new Error('Véhicule introuvable');
    if (v.statut === 'vendu') { Object.assign(v, { statut: 'en_vente', prix_vente: 0, date_vente: '' }); return { v, quoi: 'vente' }; }
    if (!ORDRE_ACHETE.includes(v.statut)) throw new Error('Ce véhicule n\'est pas acheté');
    for (const d of (v.documents || []).filter(x => x.genere)) await store.supprimerPhoto(d.path).catch(() => {});
    v.documents = (v.documents || []).filter(x => !x.genere);
    const garder = v.rdv || c.depenses.some(d => d.vehicule_id === v.id) || (v.documents || []).length;
    if (!garder) { c.vehicules = c.vehicules.filter(x => x.id !== vid); return { v: null, quoi: 'achat' }; }
    Object.assign(v, { statut: 'prospect', prix_achat: 0, date_achat: '' });
    if (v.rdv) v.rdv = { ...v.rdv, statut: 'prevu' };
    return { v, quoi: 'achat' };
});
const marquerGenere = (vid, p) => modifier(c => { const w = c.vehicules.find(x => x.id === vid); (w.documents || []).forEach(d => { if (d.path === p) d.genere = true; }); return w; });

// Société acheteuse (YAK SERVICES par défaut) : le SIRET saisi une fois est gardé pour les cessions suivantes.
async function societe() {
    const def = require('./cession').SOCIETE_DEFAUT, lu = await store.lireReglage('societe', {}) || {};
    const v = { ...def, ...lu };
    if (!String(v.siret || '').trim()) v.siret = def.siret; // SIRET vide enregistré : celui de YAK SERVICES
    return v;
}
async function majSociete(b) {
    const cur = await societe(), o = {};
    for (const k of Object.keys(require('./cession').SOCIETE_DEFAUT)) if (b[k] !== undefined) o[k] = txt(b[k], 120);
    if (o.siret !== undefined) o.siret = o.siret.replace(/[^\d]/g, '').slice(0, 14);
    const v = { ...cur, ...o }; await store.ecrireReglage('societe', v); return v;
}

// Export pour le comptable : une ligne par mouvement (achats, dépenses, ventes).
async function csv() {
    const c = await lire();
    const veh = Object.fromEntries(c.vehicules.map(v => [v.id, v]));
    const lignes = [];
    c.vehicules.forEach(v => {
        if (n(v.prix_achat)) lignes.push([v.date_achat, 'Achat véhicule', v.libelle, v.plaque, -n(v.prix_achat), PAYEURS[v.payeur_achat || 'societe'], '']);
        if (v.statut === 'vendu' && n(v.prix_vente)) lignes.push([v.date_vente, 'Vente véhicule', v.libelle, v.plaque, n(v.prix_vente), PAYEURS[v.encaisse_par || 'societe'], v.canal_vente || '']);
    });
    c.depenses.forEach(d => { const v = veh[d.vehicule_id]; lignes.push([d.date, d.categorie, d.libelle || (v ? v.libelle : '') || (d.beneficiaire ? `à ${PAYEURS[d.beneficiaire]}` : ''), v ? v.plaque : '', -d.montant, PAYEURS[d.payeur], [d.beneficiaire ? `remboursé à ${PAYEURS[d.beneficiaire]}` : '', d.justificatif ? 'justificatif joint' : ''].filter(Boolean).join(' · '),
        d.montant_ht != null ? -d.montant_ht : '', d.tva != null ? -d.tva : '', d.taux_tva != null ? d.taux_tva + ' %' : '', d.tva_recuperable == null ? '' : d.tva_recuperable ? 'oui' : 'non', d.fournisseur || '']); });
    lignes.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    return '﻿Date;Nature;Libellé;Plaque;Montant TTC (€);Payé / encaissé par;Remarque;HT (€);TVA (€);Taux TVA;TVA récupérable;Fournisseur\n' + lignes.map(l => l.map((v, i) => [4, 7, 8].includes(i) ? String(v == null ? '' : v).replace('.', ',') : q(v)).join(';')).join('\n');
}

module.exports = { annulerAchat, ORDRE_ACHETE, statutAutorise, marquerGenere, TYPES_DOCUMENT, ajouterDocument, supprimerDocument, societe, majSociete, syncDemande, PAYEURS, REMBOURSEMENT, tout, creerVehicule, majVehicule, supprimerVehicule, vehiculeDepuisDemande, ajouterDepense, majDepense, supprimerDepense, csv, soldes, bilanVehicule };
