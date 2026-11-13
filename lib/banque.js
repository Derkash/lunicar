// Banque : opérations du compte Qonto de la société, lues avec la clé API (lecture seule : aucun virement possible),
// puis attribuées une à une : à une voiture (achat, frais, vente), aux frais de gestion de la société, ou mises de côté.
// Une attribution crée (ou rattache) la ligne de la compta : la rentabilité des voitures et la préparation Zefyr
// reprennent donc directement les mouvements bancaires.
// Identifiants : QONTO_LOGIN + QONTO_SECRET_KEY (Render) ou saisis une fois depuis l'admin (réglage « qonto »).
const store = require('./store');
const compta = require('./compta');

const API = 'https://thirdparty.qonto.com/v2';
const ECART_MIN_MS = 10 * 60 * 1000;   // pas plus d'une lecture toutes les 10 min à l'ouverture de l'appli
const DEBUT = '2025-12-01T00:00:00.000Z'; // première lecture : tout depuis la création de l'activité
const MISES_DE_COTE = ['Virement entre comptes', 'Apport d\'un associé', 'Remboursement reçu', 'Prélèvement de l\'associé', 'Recette hors véhicule', 'Autre'];

const round = x => Math.round(x * 100) / 100;
const jourParis = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
// Libellé ramené à sa forme stable (« PRLV SEPA FREE MOBILE 12/11 » → « free mobile ») pour les attributions habituelles.
const motif = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(prlv|sepa|cb|carte|vir|virement|inst|instantane|facture|fact|ref|du|le)\b/g, ' ').replace(/[\d/*#.:-]+/g, ' ').replace(/\s+/g, ' ').trim();

async function identifiants() {
    if (process.env.QONTO_LOGIN && process.env.QONTO_SECRET_KEY) return { login: process.env.QONTO_LOGIN.trim(), cle: process.env.QONTO_SECRET_KEY.trim(), source: 'env' };
    const r = await store.lireReglage('qonto', null);
    return r && r.login && r.cle ? { ...r, source: 'admin' } : null;
}
async function qonto(chemin, id) {
    const r = await fetch(API + chemin, { headers: { Authorization: `${id.login}:${id.cle}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (r.status === 401) throw new Error('Qonto refuse la clé API (identifiant ou clé secrète invalide)');
    if (!r.ok) throw new Error(`Qonto : erreur ${r.status}`);
    return r.json();
}

let etatFile = Promise.resolve();
async function lire() { const b = await store.lireReglage('banque', null); return { comptes: [], transactions: [], regles: [], ...(b || {}) }; }
function modifier(fn) {
    const p = etatFile.then(async () => { const b = await lire(); const r = await fn(b); await store.ecrireReglage('banque', b); return r; });
    etatFile = p.catch(() => {});
    return p;
}

function depuisQonto(t, compte) {
    const contrepartie = t.clean_counterparty_name || '';
    return {
        id: t.id || t.transaction_id, compte: compte.name || compte.iban, date: jourParis(t.settled_at || t.emitted_at), statut: t.status,
        sens: t.side === 'credit' ? 'credit' : 'debit', montant: round(Math.abs(Number(t.amount) || 0)),
        libelle: String(contrepartie || t.label || '').trim().slice(0, 160), detail: [t.label !== contrepartie ? t.label : '', t.reference, t.note].filter(Boolean).join(' · ').slice(0, 300),
        type: t.operation_type || '', tva: t.vat_amount != null ? round(Math.abs(Number(t.vat_amount))) : null, taux_tva: t.vat_rate != null ? Number(t.vat_rate) : null,
        pieces: Array.isArray(t.attachment_ids) ? t.attachment_ids.slice(0, 5) : []
    };
}

// Lecture des opérations (réglées, en attente ; les refusées sont retirées). Les attributions déjà faites sont gardées.
let enCours = null;
async function synchroniser(force) {
    const id = await identifiants();
    if (!id) return { configure: false };
    const b0 = await lire();
    if (!force && b0.sync_le && Date.now() - new Date(b0.sync_le) < ECART_MIN_MS) return { configure: true, deja: true };
    if (enCours) return enCours;
    enCours = (async () => {
        const org = (await qonto('/organization', id)).organization || {};
        const comptes = (org.bank_accounts || []).filter(c => c.status !== 'closed');
        const depuis = b0.sync_le ? new Date(new Date(b0.sync_le) - 3 * 864e5).toISOString() : DEBUT;
        const lues = [];
        for (const c of comptes) {
            for (let page = 1; page && page < 200;) {
                const q = new URLSearchParams({ bank_account_id: c.id, updated_at_from: depuis, per_page: '100', current_page: String(page), sort_by: 'updated_at:asc' });
                ['completed', 'pending', 'declined'].forEach(s => q.append('status[]', s));
                const r = await qonto('/transactions?' + q, id);
                (r.transactions || []).forEach(t => lues.push(depuisQonto(t, c)));
                page = r.meta && r.meta.next_page;
            }
        }
        const res = await modifier(b => {
            b.comptes = comptes.map(c => ({ id: c.id, nom: c.name, iban: c.iban, solde: Number(c.balance) || 0 }));
            const parId = new Map(b.transactions.map(t => [t.id, t]));
            let nouvelles = 0;
            for (const t of lues) {
                const avant = parId.get(t.id);
                if (t.statut === 'declined') { if (avant && !avant.affectation) parId.delete(t.id); continue; }
                if (!avant) nouvelles++;
                parId.set(t.id, { ...(avant || {}), ...t, affectation: avant ? avant.affectation || null : null, vue_le: avant ? avant.vue_le : new Date().toISOString() });
            }
            b.transactions = [...parId.values()].sort((x, y) => y.date.localeCompare(x.date));
            b.sync_le = new Date().toISOString(); b.erreur = '';
            return { nouvelles };
        });
        const auto = await appliquerRegles();
        return { configure: true, nouvelles: res.nouvelles, auto };
    })().catch(async e => { await modifier(b => { b.erreur = e.message; }).catch(() => {}); throw e; }).finally(() => { enCours = null; });
    return enCours;
}

// Rapprochements proposés pour une opération non attribuée : dépense déjà saisie (même montant, ±7 j),
// voiture dont la plaque apparaît dans le libellé, achat ou vente au même montant.
function suggestions(t, c) {
    const S = [], jours = d => Math.abs(new Date(d) - new Date(t.date)) / 864e5;
    if (t.sens === 'debit') c.depenses.filter(d => !d.qonto_id && d.payeur === 'societe' && Math.abs(d.montant - t.montant) < 0.01 && jours(d.date) <= 7).slice(0, 3)
        .forEach(d => S.push({ type: 'depense', depense_id: d.id, texte: `Déjà saisie : ${d.libelle || d.categorie} du ${d.date}` }));
    const texte = (t.libelle + ' ' + t.detail).toUpperCase().replace(/[\s-]/g, '');
    c.vehicules.forEach(v => {
        const p = String(v.plaque || '').toUpperCase().replace(/[\s-]/g, '');
        const achat = !(v.qonto_achat || []).length && Number(v.prix_achat) && Math.abs(Number(v.prix_achat) - t.montant) < 0.01;
        const vente = !(v.qonto_vente || []).length && Number(v.prix_vente) && Math.abs(Number(v.prix_vente) - t.montant) < 0.01;
        if (t.sens === 'debit' && achat) S.push({ type: 'achat', vehicule_id: v.id, texte: `Achat de ${v.libelle}${v.plaque ? ' · ' + v.plaque : ''} (même montant)` });
        else if (t.sens === 'credit' && vente) S.push({ type: 'vente', vehicule_id: v.id, texte: `Vente de ${v.libelle}${v.plaque ? ' · ' + v.plaque : ''} (même montant)` });
        else if (p.length >= 6 && texte.includes(p)) S.push({ type: t.sens === 'credit' ? 'vente' : 'frais', vehicule_id: v.id, texte: `${v.libelle} · ${v.plaque} (plaque dans le libellé)` });
    });
    return S.slice(0, 4);
}

async function etat() {
    const [b, c, id] = await Promise.all([lire(), compta.tout(), identifiants()]);
    const veh = Object.fromEntries(c.vehicules.map(v => [v.id, v])), dep = Object.fromEntries(c.depenses.map(d => [d.id, d]));
    const transactions = b.transactions.map(t => {
        // Dépense supprimée depuis la compta : l'opération redevient à attribuer.
        const a = t.affectation && !(t.affectation.depense_id && !dep[t.affectation.depense_id]) ? t.affectation : null, o = { ...t, affectation: a };
        if (!a) o.suggestions = suggestions(t, c);
        else {
            const d = a.depense_id && dep[a.depense_id], v = veh[a.vehicule_id || (d && d.vehicule_id)];
            o.affectation = { ...a, vehicule: v ? `${v.libelle}${v.plaque ? ' · ' + v.plaque : ''}` : '', categorie: d ? d.categorie : a.categorie || '', zefyr: d ? !!d.zefyr : a.type === 'achat' ? !!(v && v.zefyr_achat) : a.type === 'vente' ? !!(v && v.zefyr_vente) : null };
        }
        return o;
    });
    return {
        configure: !!id, source: id ? id.source : '', login: id ? id.login : '', sync_le: b.sync_le || '', erreur: b.erreur || '',
        comptes: b.comptes, regles: b.regles, mises_de_cote: MISES_DE_COTE, transactions,
        a_attribuer: transactions.filter(t => !t.affectation && t.statut === 'completed').length
    };
}

// Attribution d'une opération. Corps : { type, vehicule_id?, categorie?, motif?, depense_id?, explication?, habituel? }
//  - depense : rattache une dépense déjà saisie (rien n'est créé, pas de doublon)
//  - frais   : dépense de la voiture (catégorie véhicule)        - gestion : frais de gestion de la société
//  - achat   : paiement du prix d'achat de la voiture             - vente   : encaissement de la vente
//  - cote    : mise de côté (virement entre comptes, apport…), hors compta
async function attribuer(tid, b) {
    const t = (await lire()).transactions.find(x => x.id === tid);
    if (!t) throw new Error('Opération introuvable');
    if (t.affectation) await desattribuer(tid);
    const c = await compta.tout(), aff = { type: b.type, le: new Date().toISOString() };
    let avertissement = '';
    if (b.type === 'depense') {
        const d = c.depenses.find(x => x.id === b.depense_id); if (!d) throw new Error('Dépense introuvable');
        await compta.majDepense(d.id, { qonto_id: t.id });
        aff.depense_id = d.id; aff.cree = false;
    } else if (b.type === 'frais' || b.type === 'gestion') {
        if (t.sens !== 'debit') throw new Error('Une entrée d\'argent ne peut pas être une dépense');
        if (b.type === 'frais' && !c.vehicules.some(v => v.id === b.vehicule_id)) throw new Error('Choisir la voiture');
        const cats = b.type === 'frais' ? c.categories.vehicule : c.categories.generales;
        const d = await compta.ajouterDepense({
            montant: t.montant, date: t.date, libelle: t.libelle, fournisseur: t.libelle, payeur: 'societe', categorie: cats.includes(b.categorie) ? b.categorie : 'Autre',
            vehicule_id: b.type === 'frais' ? b.vehicule_id : null, explication: b.explication || '', qonto_id: t.id,
            ...(t.tva != null && t.tva > 0 ? { tva: t.tva, montant_ht: round(t.montant - t.tva), taux_tva: t.taux_tva, tva_recuperable: true } : {})
        });
        aff.depense_id = d.id; aff.cree = true;
        if (b.type === 'frais') aff.vehicule_id = b.vehicule_id;
        recupererJustificatif(t, d.id).catch(e => console.error('Qonto, justificatif :', e.message));
    } else if (b.type === 'achat' || b.type === 'vente') {
        const v = c.vehicules.find(x => x.id === b.vehicule_id); if (!v) throw new Error('Choisir la voiture');
        if ((b.type === 'achat') !== (t.sens === 'debit')) throw new Error(b.type === 'achat' ? 'Un achat est une sortie d\'argent' : 'Une vente est une entrée d\'argent');
        const cle = b.type === 'achat' ? 'qonto_achat' : 'qonto_vente', prix = b.type === 'achat' ? 'prix_achat' : 'prix_vente';
        const ids = [...(v[cle] || []), t.id];
        // Achat ou vente réglé en plusieurs virements : le prix = la somme des virements rattachés, sauf prix déjà saisi différent.
        const total = round((await lire()).transactions.filter(x => ids.includes(x.id)).reduce((s, x) => s + x.montant, 0));
        const maj = { [cle]: ids };
        if (!Number(v[prix]) || ids.length > 1) maj[prix] = total;
        else if (Math.abs(Number(v[prix]) - total) >= 0.01) avertissement = `Prix ${b.type === 'achat' ? 'd\'achat' : 'de vente'} saisi : ${v[prix]} €, virement : ${total} € (prix laissé tel quel)`;
        if (b.type === 'achat') Object.assign(maj, { payeur_achat: 'societe', ...(v.date_achat ? {} : { date_achat: t.date }), ...(['prospect', 'perdu'].includes(v.statut) ? { statut: 'stock', date_achat: t.date } : {}) });
        else Object.assign(maj, { encaisse_par: 'societe', date_vente: v.date_vente || t.date, ...(compta.statutAutorise(v.statut, 'vendu') && v.statut !== 'vendu' ? { statut: 'vendu' } : {}) });
        await compta.majVehicule(v.id, maj);
        aff.vehicule_id = v.id;
    } else if (b.type === 'cote') {
        aff.motif = MISES_DE_COTE.includes(b.motif) ? b.motif : 'Autre';
    } else throw new Error('Attribution inconnue');
    if (b.habituel && ['gestion', 'cote'].includes(b.type)) await ajouterRegle({ motif: motif(t.libelle), sens: t.sens, type: b.type, categorie: b.categorie, motif_cote: aff.motif, explication: b.explication || '' });
    await modifier(B => { const x = B.transactions.find(y => y.id === tid); if (x) x.affectation = aff; });
    return { ok: true, avertissement };
}

async function desattribuer(tid) {
    const t = (await lire()).transactions.find(x => x.id === tid);
    if (!t || !t.affectation) return { ok: true };
    const a = t.affectation, c = await compta.tout();
    if (a.depense_id) {
        const d = c.depenses.find(x => x.id === a.depense_id);
        if (d && a.cree) await compta.supprimerDepense(d.id); else if (d) await compta.majDepense(d.id, { qonto_id: '' });
    }
    if (a.type === 'achat' || a.type === 'vente') {
        const v = c.vehicules.find(x => x.id === a.vehicule_id), cle = a.type === 'achat' ? 'qonto_achat' : 'qonto_vente';
        if (v) await compta.majVehicule(v.id, { [cle]: (v[cle] || []).filter(x => x !== tid) });
    }
    await modifier(B => { const x = B.transactions.find(y => y.id === tid); if (x) x.affectation = null; });
    return { ok: true };
}

// Justificatif déjà déposé dans Qonto (photo du ticket prise dans l'appli Qonto) : copié sur la dépense.
async function recupererJustificatif(t, depId) {
    if (!t.pieces.length) return;
    const id = await identifiants(); if (!id) return;
    const a = (await qonto('/attachments/' + t.pieces[0], id)).attachment;
    if (!a || !a.url) return;
    const r = await fetch(a.url, { signal: AbortSignal.timeout(30000) }); if (!r.ok) return;
    const buffer = Buffer.from(await r.arrayBuffer());
    await compta.majDepense(depId, {}, { originalname: a.file_name || 'justificatif-qonto.pdf', buffer });
}

// Attributions habituelles (abonnements, téléphone, banque…) : appliquées seules à chaque lecture.
async function ajouterRegle(r) {
    if (!r.motif) return;
    await modifier(b => {
        b.regles = b.regles.filter(x => !(x.motif === r.motif && x.sens === r.sens));
        b.regles.push({ id: Date.now().toString(36), motif: r.motif, sens: r.sens, type: r.type, categorie: r.categorie || '', motif_cote: r.motif_cote || '', explication: r.explication || '' });
    });
}
const supprimerRegle = rid => modifier(b => { b.regles = b.regles.filter(x => x.id !== rid); return true; });
async function appliquerRegles() {
    const b = await lire(); let n = 0;
    for (const t of b.transactions.filter(x => !x.affectation && x.statut === 'completed')) {
        const r = b.regles.find(x => x.sens === t.sens && x.motif && x.motif === motif(t.libelle));
        if (!r) continue;
        try { await attribuer(t.id, { type: r.type, categorie: r.categorie, motif: r.motif_cote, explication: r.explication }); n++; } catch (e) { console.error('Qonto, règle :', e.message); }
    }
    return n;
}

async function enregistrerIdentifiants(login, cle) {
    login = String(login || '').trim(); cle = String(cle || '').trim();
    if (!login || !cle) { await store.ecrireReglage('qonto', null); return { configure: !!(await identifiants()) }; }
    await qonto('/organization', { login, cle }); // vérifie la clé avant de l'enregistrer
    await store.ecrireReglage('qonto', { login, cle });
    return { configure: true };
}

module.exports = { synchroniser, etat, attribuer, desattribuer, supprimerRegle, enregistrerIdentifiants, MISES_DE_COTE };
