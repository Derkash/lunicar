// Dossier de vente d'un véhicule acheté : tout ce qui enrichira sa fiche sur la
// place de marché pro (photos légendées et floutées, vidéo du moteur, documents,
// relevé de dommages, essai routier, fiche technique, équipements, description).
// Saisi depuis l'admin, puis envoyé d'un bloc vers remarkauto (lib/remarkauto.js).
// Stockage : réglage « dossier:<id véhicule> », médias dans le dossier photo « dossier-<id> ».
const store = require('./store');
const compta = require('./compta');
const remarkauto = require('./remarkauto');

const URL = (process.env.REMARKAUTO_URL || '').replace(/\/$/, '');
const TOKEN = process.env.REMARKAUTO_IMPORT_TOKEN || '';

const LISTES = {
    zones: ['Avant', 'Côté gauche', 'Arrière', 'Côté droit', 'Toit', 'Intérieur', 'Moteur et transmission'],
    types_dommage: ['Rayure', 'Éclat', 'Bosse', 'Choc', 'Usure', 'Fissure', 'Corrosion', 'Manquant', 'Déformation', 'Peinture', 'Voyant allumé', 'Bruit anormal', 'Fuite'],
    points_essai: ['Moteur', 'Boîte de vitesses', 'Embrayage', 'Direction', 'Suspension', 'Freins', 'Climatisation', 'Tachymètre / voyants', 'Électronique', 'Bruits de roulement'],
    quand: ['Au démarrage', 'À froid', 'À chaud', 'Au ralenti', 'En accélération', 'Au freinage', 'En virage', 'En permanence'],
    legendes: ['Avant gauche', 'Avant', 'Avant droit', 'Côté droit', 'Arrière droit', 'Arrière', 'Arrière gauche', 'Côté gauche', 'Tableau de bord', 'Compteur', 'Sièges avant', 'Sièges arrière', 'Coffre', 'Moteur', 'Jante', 'Pneu', 'Toit', 'Dessous'],
    types_document: ['Carte grise', 'Contrôle technique', "Carnet d'entretien", 'Facture', 'COC', 'Rapport de diagnostic', 'Autre'],
    categories: ['Climatisation', 'Navigation / multimédia', 'Aide à la conduite', 'Sécurité', 'Confort', 'Sièges', 'Éclairage', 'Jantes / pneus', 'Extérieur', 'Remorquage', 'Autre'],
    carburants: ['Essence', 'Diesel', 'Hybride', 'Hybride rechargeable', 'Électrique', 'GPL'],
    boites: ['Manuelle', 'Automatique'],
    carrosseries: ['Citadine', 'Berline', 'Break', 'SUV', 'Monospace', 'Coupé', 'Cabriolet', 'Utilitaire', 'Pick-up'],
    normes: ['Euro 4', 'Euro 5', 'Euro 6', 'Euro 6d'],
    entretien: [['complet', 'Carnet complet, toutes les révisions'], ['partiel', 'Carnet partiel'], ['aucun', "Sans justificatif d'entretien"]],
    usages: ['Particulier', 'Leasing', 'Loueur', 'Flotte', 'Taxi / VTC'],
};

const VIDE = () => ({ photos: [], video: null, documents: [], points_forts: [], dommages: [], essai: { fait: false, conditions: 'Route ouverte, vitesse inférieure à 80 km/h', points: {}, notes: '' }, equipements: [], equipements_vin: [], description: '', fiche: {}, pousse_le: null, remarkauto_id: null });

const cle = vid => `dossier:${vid}`;
const txt = (v, n = 600) => String(v == null ? '' : v).trim().slice(0, n);

async function lire(vid) {
    const d = await store.lireReglage(cle(vid), null);
    return { ...VIDE(), ...(d || {}), essai: { ...VIDE().essai, ...((d || {}).essai || {}) }, fiche: { ...((d || {}).fiche || {}) }, listes: LISTES, remarkauto_url: URL };
}

// Fusion champ par champ : chaque bloc de l'admin n'envoie que ce qu'il modifie.
async function ecrire(vid, patch) {
    const d = await lire(vid); delete d.listes; delete d.remarkauto_url;
    const p = patch || {};
    if (p.photos) d.photos = p.photos.map(x => ({ path: txt(x.path, 200), legende: txt(x.legende, 60), floutee: x.floutee === true || x.floutee === 'true' })).filter(x => x.path);
    if (p.documents) d.documents = p.documents.map(x => ({ path: txt(x.path, 200), type: txt(x.type, 40) || 'Autre', legende: txt(x.legende, 80) })).filter(x => x.path);
    if (p.points_forts) d.points_forts = p.points_forts.map(x => ({ path: txt(x.path, 200), legende: txt(x.legende, 80) })).filter(x => x.path);
    if (p.dommages) d.dommages = p.dommages.map(x => ({ zone: txt(x.zone, 40), element: txt(x.element, 80), type: txt(x.type, 40), photo: txt(x.photo, 200) || undefined })).filter(x => x.element || x.photo);
    if (p.essai) d.essai = { fait: !!p.essai.fait, conditions: txt(p.essai.conditions, 120), notes: txt(p.essai.notes, 1500), points: Object.fromEntries(Object.entries(p.essai.points || {}).filter(([k]) => LISTES.points_essai.includes(k)).map(([k, v]) => [k, { etat: v.etat === 'defaut' ? 'defaut' : 'ok', quand: txt(v.quand, 40), resultat: txt(v.resultat, 160) }])) };
    if (p.equipements) d.equipements = p.equipements.map(s => txt(s, 160)).filter(Boolean).slice(0, 80);
    if (p.equipements_vin) d.equipements_vin = p.equipements_vin.map(s => txt(s, 160)).filter(Boolean).slice(0, 120);
    if (p.description !== undefined) d.description = txt(p.description, 3000);
    if (p.video !== undefined) d.video = p.video ? txt(p.video, 200) : null;
    if (p.fiche) d.fiche = { ...d.fiche, ...Object.fromEntries(Object.entries(p.fiche).map(([k, v]) => [k, typeof v === 'boolean' ? v : txt(v, 80)])) };
    await store.ecrireReglage(cle(vid), d);
    return { ...d, listes: LISTES };
}

// type : photo | document | point | dommage | video. `remplace` = chemin d'une photo à remplacer
// (version floutée) : la légende est conservée et la photo marquée floutée.
async function ajouterMedia(vid, type, fichier, corps = {}) {
    const d = await lire(vid); delete d.listes; delete d.remarkauto_url;
    const propre = String(fichier.originalname || 'fichier').replace(/[^\w.-]+/g, '_').slice(-60);
    const m = await store.ajouterPhoto(`dossier-${vid}`, `${type}_${Date.now()}_${propre}`, fichier.buffer);
    if (type === 'video') {
        if (d.video) await store.supprimerPhoto(d.video).catch(() => {});
        d.video = m.path;
    } else if (type === 'document') d.documents.push({ path: m.path, type: txt(corps.type, 40) || 'Autre', legende: '' });
    else if (type === 'point') d.points_forts.push({ path: m.path, legende: '' });
    else if (type === 'dommage') {
        const i = Number(corps.index);
        if (d.dommages[i]) { if (d.dommages[i].photo) await store.supprimerPhoto(d.dommages[i].photo).catch(() => {}); d.dommages[i].photo = m.path; }
    } else if (corps.remplace) {
        const i = d.photos.findIndex(x => x.path === corps.remplace);
        if (i >= 0) { await store.supprimerPhoto(d.photos[i].path).catch(() => {}); d.photos[i] = { ...d.photos[i], path: m.path, floutee: true }; }
        else d.photos.push({ path: m.path, legende: '', floutee: true });
    } else d.photos.push({ path: m.path, legende: '', floutee: false });
    await store.ecrireReglage(cle(vid), d);
    return { ...d, listes: LISTES };
}

async function supprimerMedia(vid, chemin) {
    const d = await lire(vid); delete d.listes; delete d.remarkauto_url;
    d.photos = d.photos.filter(x => x.path !== chemin);
    d.documents = d.documents.filter(x => x.path !== chemin);
    d.points_forts = d.points_forts.filter(x => x.path !== chemin);
    d.dommages = d.dommages.map(x => x.photo === chemin ? { ...x, photo: undefined } : x);
    if (d.video === chemin) d.video = null;
    await store.supprimerPhoto(chemin).catch(() => {});
    await store.ecrireReglage(cle(vid), d);
    return { ...d, listes: LISTES };
}

async function supprimer(vid) {
    const d = await lire(vid);
    const tous = [...d.photos.map(x => x.path), ...d.documents.map(x => x.path), ...d.points_forts.map(x => x.path), ...d.dommages.map(x => x.photo).filter(Boolean), d.video].filter(Boolean);
    for (const p of tous) await store.supprimerPhoto(p).catch(() => {});
    await store.supprimerReglage(cle(vid)).catch(() => {});
}

// Ce qui manque avant de pouvoir envoyer : la fiche part incomplète, mais jamais avec une plaque lisible.
function manques(d) {
    const m = [];
    if (!d.photos.length) m.push('au moins une photo');
    const nonFloutees = d.photos.filter(x => !x.floutee).length;
    if (nonFloutees) m.push(`${nonFloutees} photo${nonFloutees > 1 ? 's' : ''} à flouter (ou à marquer « sans plaque »)`);
    return m;
}

async function envoyerFichier(chemin) {
    const { buffer, type } = await store.lirePhoto(chemin);
    const fd = new FormData();
    fd.append('photos', new Blob([buffer], { type: type || 'application/octet-stream' }), chemin.split('/').pop());
    const r = await fetch(`${URL}/api/admin/photos`, { method: 'POST', headers: { 'x-import-token': TOKEN }, body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok || !j.photos || !j.photos[0]) throw new Error(`Envoi refusé pour ${chemin}`);
    return j.photos[0];
}

const num = v => { const n = Number(String(v == null ? '' : v).replace(/[^\d.,-]/g, '').replace(',', '.')); return Number.isFinite(n) && n !== 0 ? n : null; };
const bool01 = v => (v === true || v === 'true' || v === '1' ? 1 : 0);

// Envoi complet vers remarkauto : médias d'abord, puis la fiche (écrasement assumé : c'est Lunicar qui fait foi
// pour la description du véhicule ; le prix et la mise en vente restent côté remarkauto).
async function pousser(vid) {
    if (!URL || !TOKEN) throw Object.assign(new Error('Passerelle remarkauto non configurée (REMARKAUTO_URL / REMARKAUTO_IMPORT_TOKEN)'), { status: 400 });
    const v = (await compta.tout()).vehicules.find(x => x.id === vid);
    if (!v) throw Object.assign(new Error('Véhicule introuvable'), { status: 404 });
    const d = await lire(vid); delete d.listes; delete d.remarkauto_url;
    const m = manques(d);
    if (m.length) throw Object.assign(new Error('Avant d\'envoyer : ' + m.join(' ; ')), { status: 400 });

    const envoyes = new Map();
    const envoi = async p => { if (!p) return null; if (!envoyes.has(p)) envoyes.set(p, await envoyerFichier(p)); return envoyes.get(p); };
    const photos = [], legendes = {};
    for (const x of d.photos) { const n = await envoi(x.path); photos.push(n); if (x.legende) legendes[n] = x.legende; }
    const documents = []; for (const x of d.documents) documents.push({ photo: await envoi(x.path), type: x.type, legende: x.legende || undefined });
    const points_forts = []; for (const x of d.points_forts) points_forts.push({ photo: await envoi(x.path), legende: x.legende || '' });
    const dommages = []; for (const x of d.dommages) dommages.push({ zone: x.zone, element: x.element, type: x.type, photo: x.photo ? await envoi(x.photo) : undefined });
    const video = d.video ? await envoi(d.video) : null;

    const dec = remarkauto.decouper(v.libelle) || { marque: 'Marque', modele: 'Modèle' };
    const f = d.fiche || {};
    const annee = Number(String(f.mise_circulation || v.annee || '').match(/(19|20)\d{2}/)?.[0]) || null;
    const vehicule = {
        marque: f.marque || dec.marque, modele: f.modele || dec.modele, version: f.version || null,
        mise_circulation: f.mise_circulation || (annee ? String(annee) : null), annee_construction: num(f.annee_construction) || annee,
        km: num(f.km) || num(v.kilometrage) || 0, vin: (f.vin || v.vin || '').toUpperCase() || null,
        carburant: f.carburant || null, boite: f.boite || null, carrosserie: f.carrosserie || null,
        puissance_ch: num(f.puissance_ch), cylindree: num(f.cylindree), portes: num(f.portes), places: num(f.places),
        couleur: f.couleur || null, sellerie: f.sellerie || null, co2: num(f.co2), norme_euro: f.norme_euro || null,
        proprietaires: num(f.proprietaires), cles: num(f.cles), ct_expire: f.ct_expire || null,
        accidente: bool01(f.accidente), roulant: f.roulant === undefined || f.roulant === '' ? 1 : bool01(f.roulant), tva_deductible: bool01(f.tva_deductible), coc: bool01(f.coc),
        couleur_origine: f.couleur_origine === undefined || f.couleur_origine === '' ? 1 : bool01(f.couleur_origine), sellerie_origine: f.sellerie_origine === undefined || f.sellerie_origine === '' ? 1 : bool01(f.sellerie_origine),
        entretien: f.entretien || null, usage_precedent: f.usage_precedent || null, pays_origine: f.pays_origine || 'FR', pays_derniere_immat: f.pays_derniere_immat || 'FR',
        lieu_ville: null, lieu_cp: null, description: d.description || null,
        equipements: d.equipements, equipements_vin: d.equipements_vin, dommages, essai: d.essai, photos, legendes, documents, points_forts, video,
    };
    const r = await fetch(`${URL}/api/admin/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-import-token': TOKEN }, body: JSON.stringify({ source: 'lunicar', source_id: v.id, immat: v.plaque || undefined, forcer: true, vehicule }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.erreur || `remarkauto : HTTP ${r.status}`);
    d.pousse_le = new Date().toISOString(); d.remarkauto_id = j.id;
    await store.ecrireReglage(cle(vid), d);
    const lien = await store.lireReglage('remarkauto_sync', {}); lien[vid] = j.id; await store.ecrireReglage('remarkauto_sync', lien);
    return { ok: true, id: j.id, url: `${URL}/admin/vehicules/${j.id}`, medias: envoyes.size, pousse_le: d.pousse_le };
}

module.exports = { lire, ecrire, ajouterMedia, supprimerMedia, supprimer, pousser, manques, LISTES };
