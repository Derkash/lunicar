// Doublons de demandes : même vendeur (téléphone) pour la même voiture (plaque ou marque identique, ou véhicule
// non renseigné d'un côté). On garde la demande la PLUS RENSEIGNÉE, complétée par les autres (champs vides,
// appels, notes, e-mails, photos, rendez-vous), puis les autres sont supprimées (photos conservées).
const store = require('./store');
const compta = require('./compta');

const CHAMPS = ['vehicule', 'annee', 'kilometrage', 'plaque', 'mecanique', 'carrosserie', 'controle_technique', 'prix_souhaite', 'delai', 'projet_achat',
    'email', 'code_postal', 'ville', 'prenom', 'nom', 'message', 'numero_formule', 'titulaire', 'fiche_confirmee', 'vin', 'carburant', 'boite'];
const ORDRE = ['nouvelle', 'contactee', 'offre', 'rdv', 'achetee'];
const tel9 = v => String(v || '').replace(/\D/g, '').slice(-9);
const pl = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const marque = v => String(v || '').trim().split(/\s+/)[0].toLowerCase();

// Plus le score est haut, plus la demande est renseignée.
function remplissage(d) {
    const x = d.data || {}, s = d.suivi || {};
    let n = CHAMPS.filter(k => String(x[k] == null ? '' : x[k]).trim()).length;
    if (x.fiche_api) n += 3;
    n += Math.min(5, (d.photos || []).length);
    if (d.estimation) n += 3;
    if (d.origine === 'abandon') n -= 4;             // formulaire abandonné en route
    n += Math.min(3, (s.appels || []).length);
    return n;
}

function memeVehicule(a, b) {
    const xa = a.data || {}, xb = b.data || {};
    const ta = tel9(xa.telephone), tb = tel9(xb.telephone);
    if (ta.length < 9 || ta !== tb) return false;
    const pa = pl(xa.plaque), pb = pl(xb.plaque);
    if (pa && pb) return pa === pb;
    const ma = marque(xa.vehicule), mb = marque(xb.vehicule);
    return !ma || !mb || ma === mb;
}

function rang(statut) { const i = ORDRE.indexOf(statut); return i < 0 ? -1 : i; }

async function fusionnerGroupe(groupe) {
    const tri = [...groupe].sort((a, b) => remplissage(b) - remplissage(a) || String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
    const base = tri[0], autres = tri.slice(1), maintenant = new Date().toISOString();
    const data = { ...base.data };
    for (const o of autres) for (const [k, v] of Object.entries(o.data || {})) if ((data[k] == null || String(data[k]).trim() === '') && v != null && String(v).trim() !== '') data[k] = v;
    data.premiere_demande = [base, ...autres].map(d => d.created_at).sort()[0];
    const tous = [base, ...autres], S = tous.map(d => d.suivi || {});
    const suivi = { ...S[0] };
    const parDate = arr => arr.sort((p, q) => String(q.date).localeCompare(String(p.date)));
    suivi.historique = parDate(S.flatMap(s => s.historique || [])).slice(0, 300);
    suivi.appels = parDate(S.flatMap(s => s.appels || [])).slice(0, 50);
    const vus = new Set(); suivi.emails = parDate(S.flatMap(s => s.emails || [])).filter(m => { const k = m.id || m.message_id || m.date + m.objet; if (vus.has(k)) return false; vus.add(k); return true; }).reverse();
    suivi.nb_appels = S.reduce((t, s) => t + (Number(s.nb_appels) || 0), 0);
    for (const k of ['offre', 'prix_achat', 'prix_manuel_max', 'prix_manuel_vente', 'diagnostic', 'dernier_appel', 'premier_contact']) if (!suivi[k]) { const s = S.find(z => z[k]); if (s) suivi[k] = s[k]; }
    const rdvPrevu = S.map(s => s.rdv).find(r => r && r.statut === 'prevu'); if (rdvPrevu) suivi.rdv = rdvPrevu; else if (!suivi.rdv) suivi.rdv = S.map(s => s.rdv).find(Boolean) || undefined;
    suivi.a_appeler = S.some(s => s.a_appeler);
    const rappels = S.map(s => s.rappel_le).filter(Boolean).sort(); if (rappels.length) suivi.rappel_le = rappels[0];
    suivi.archivee = S.every(s => s.archivee);
    suivi.historique.unshift({ date: maintenant, quoi: `Doublon fusionné : ${autres.map(d => d.ref).join(', ')} (la demande la plus renseignée est gardée)` });
    // Statut le plus avancé (une demande active l'emporte sur une demande close).
    const actifs = tous.filter(d => rang(d.statut) >= 0);
    const statut = actifs.length ? actifs.sort((a, b) => rang(b.statut) - rang(a.statut))[0].statut : base.statut;
    const photos = []; const pv = new Set(); for (const d of tous) for (const p of d.photos || []) if (!pv.has(p.path)) { pv.add(p.path); photos.push(p); }
    const estimation = base.estimation || (autres.find(d => d.estimation) || {}).estimation || null;
    const champs = { data, suivi, statut, photos, estimation };
    if (!base.estimation && estimation) champs.estimation_at = (autres.find(d => d.estimation) || {}).estimation_at;
    const maj = await store.majDemande(base.ref, champs);
    for (const o of autres) { await compta.changerRef(o.ref, base.ref).catch(() => {}); await store.supprimerDemande(o.ref, { garderPhotos: true }); }
    console.log(`🔗 Doublons fusionnés dans ${base.ref} : ${autres.map(d => d.ref).join(', ')}`);
    return { garde: base.ref, supprimees: autres.map(d => d.ref), demande: maj };
}

function groupes(liste) {
    const res = [], pris = new Set();
    for (const a of liste) {
        if (pris.has(a.ref)) continue;
        const g = [a];
        for (const b of liste) if (b !== a && !pris.has(b.ref) && g.some(x => memeVehicule(x, b))) g.push(b);
        if (g.length > 1) { g.forEach(d => pris.add(d.ref)); res.push(g); }
    }
    return res;
}

// Une demande trop récente n'est pas encore fusionnée : le vendeur peut encore envoyer ses photos sur sa référence.
async function fusionnerTout({ ageMin = 30 } = {}) {
    const limite = Date.now() - ageMin * 60e3;
    const gs = groupes(await store.listerDemandes()).filter(g => g.every(d => new Date(d.created_at).getTime() < limite));
    const out = [];
    for (const g of gs) out.push(await fusionnerGroupe(g));
    return out;
}

module.exports = { fusionnerTout, remplissage, memeVehicule };
