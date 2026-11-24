// Suivi de vente du parc (véhicules achetés) — 24/11/2026.
// Le Mac mini relève chaque jour, dans le compte Leboncoin Pro, nos annonces (prix, badge, vues, favoris, messages,
// intentions d'appel, remontées) et le forfait (insertions, modifications, remontées restantes). Il relance aussi
// l'analyse de chaque véhicule (Sonar au km exact + annonces concurrentes). Ici :
//   - l'historique quotidien de nos annonces (une ligne par jour et par annonce) ;
//   - le suivi des annonces concurrentes : vue pour la première fois, dernière fois, prix ; une annonce qui
//     disparaît d'une recherche qui la couvrait = probablement vendue (délai et prix gardés) ;
//   - le dossier complet envoyé à Claude sur le Mac mini (GET /api/marche/parc) et la stratégie qu'il renvoie.
// Rien n'est publié ni modifié sur Leboncoin : les actions sont des recommandations pour le dirigeant.
const fs = require('fs');
const path = require('path');

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FICHIER = path.join(DIR, 'parc-suivi.json');

let cache = null, ecriture = null;
function lire() {
    if (cache) return cache;
    try { cache = JSON.parse(fs.readFileSync(FICHIER, 'utf8')); } catch (e) { cache = {}; }
    cache.annonces = cache.annonces || {};        // clé (réf. YAK ou titre) -> { titre, ref_yak, vid, jours: { 'AAAA-MM-JJ': {...} } }
    cache.forfait = cache.forfait || null;
    cache.concurrents = cache.concurrents || {};  // vid -> { id: { vu_le, vu_der, prix, prix0, km, an, pro, jours0, titre, url, disparue_le } }
    cache.strategies = cache.strategies || {};    // vid -> stratégie Claude (dernière) + historique court
    cache.plan = cache.plan || null;              // plan global (quota du forfait, priorités)
    cache.diag = cache.diag || {};                // plaque -> { texte, maj }
    cache.liens = cache.liens || {};              // clé d'annonce -> vid (rattachement manuel)
    return cache;
}
function sauver() {
    if (ecriture) return;
    ecriture = setTimeout(() => {
        ecriture = null;
        fs.mkdirSync(path.dirname(FICHIER), { recursive: true });
        fs.writeFileSync(FICHIER + '.tmp', JSON.stringify(cache));
        fs.renameSync(FICHIER + '.tmp', FICHIER);
    }, 1000);
    ecriture.unref && ecriture.unref();
}
const num = v => { const x = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')); return Number.isFinite(x) ? x : 0; };
const s = (v, m = 200) => String(v == null ? '' : v).slice(0, m);
const jourParis = (d = new Date()) => new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Paris' })).toISOString().slice(0, 10);
const sansAccent = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const plaqueCle = p => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------------------------------------------------------------- Nos annonces (relevé quotidien du Mac mini)
const cleAnnonce = a => a.ref_yak ? 'YAK:' + a.ref_yak : 'T:' + sansAccent(a.titre).replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
// Rattachement annonce -> véhicule de la compta : manuel d'abord, sinon marque + modèle du titre, un seul candidat.
function rattacher(a, vehicules) {
    const L = lire(), k = cleAnnonce(a);
    if (L.liens[k]) return L.liens[k];
    const t = sansAccent(a.titre);
    const mots = v => sansAccent(v.libelle).replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(w => w.length > 1 && !/^(19|20)\d\d$/.test(w));
    const cands = vehicules.filter(v => ['stock', 'preparation', 'en_vente', 'vendu'].includes(v.statut)).map(v => {
        const m = mots(v); if (m.length < 2) return null;
        const marque = m[0], modele = m[1];
        if (!t.includes(marque) && !(marque === 'forf' && t.includes('ford'))) return null;
        if (!new RegExp('\\b' + modele.replace(/[^a-z0-9]/g, '')).test(t)) return null;
        const kmV = num(v.kilometrage), ecartKm = a.km && kmV ? Math.abs(a.km - kmV) / Math.max(kmV, 1) : 0.5;
        return { v, note: m.filter(w => t.includes(w)).length * 2 - ecartKm * 3 - (v.statut === 'vendu' ? 1 : 0) };
    }).filter(Boolean).sort((x, y) => y.note - x.note);
    if (!cands.length) return null;
    if (cands.length > 1 && cands[0].note - cands[1].note < 1.5) return null;   // ambigu : rattachement manuel dans l'admin
    return cands[0].v.id;
}
function enregistrerAnnonces(b, vehicules) {
    const L = lire(), j = jourParis(), vus = new Set();
    for (const x of (b.annonces || []).slice(0, 80)) {
        const a = { titre: s(x.titre, 200), ref_yak: s(x.ref_yak, 20), prix: num(x.prix), badge: s(x.badge, 40), publiee: s(x.publiee, 10), remontee: s(x.remontee, 60),
            vues: num(x.vues), favoris: num(x.favoris), messages: num(x.messages), appels: num(x.appels), qualite: s(x.qualite, 30), km: num(x.km), id: s(x.id, 20) };
        if (!a.titre) continue;
        const k = cleAnnonce(a); vus.add(k);
        const e = L.annonces[k] = L.annonces[k] || { titre: a.titre, ref_yak: a.ref_yak, premier_releve: j, jours: {} };
        Object.assign(e, { titre: a.titre, ref_yak: a.ref_yak, id: a.id || e.id || '', publiee: a.publiee || e.publiee, en_ligne: true, dernier_releve: j, hors_ligne_le: null });
        e.vid = rattacher(a, vehicules) || e.vid || null;
        e.jours[j] = { prix: a.prix, badge: a.badge, remontee: a.remontee, vues: a.vues, favoris: a.favoris, messages: a.messages, appels: a.appels, qualite: a.qualite };
        // 120 jours d'historique au plus
        const ks = Object.keys(e.jours).sort(); for (const d of ks.slice(0, Math.max(0, ks.length - 120))) delete e.jours[d];
    }
    // Annonce absente du relevé : retirée (vendue ou supprimée).
    if ((b.annonces || []).length) for (const [k, e] of Object.entries(L.annonces)) if (!vus.has(k) && e.en_ligne) { e.en_ligne = false; e.hors_ligne_le = j; }
    if (b.forfait) L.forfait = { ...b.forfait, releve_le: new Date().toISOString() };
    if (b.resume) L.resume_lbc = { texte: s(b.resume, 600), le: new Date().toISOString() };
    L.annonces_le = new Date().toISOString();
    sauver();
    return { annonces: vus.size, rattachees: [...vus].filter(k => L.annonces[k].vid).length };
}
function lier(cle, vid) { const L = lire(); if (vid) L.liens[cle] = vid; else delete L.liens[cle]; if (L.annonces[cle]) L.annonces[cle].vid = vid || null; sauver(); }

// Série quotidienne d'une annonce : vues et contacts par jour (différences entre relevés), prix et badge.
function serie(e) {
    const ks = Object.keys(e.jours || {}).sort(), out = [];
    ks.forEach((d, i) => {
        const x = e.jours[d], p = i ? e.jours[ks[i - 1]] : null;
        out.push({ jour: d, prix: x.prix, badge: x.badge, remontee: x.remontee, vues: x.vues, favoris: x.favoris, messages: x.messages, appels: x.appels, qualite: x.qualite,
            vues_jour: p ? Math.max(0, x.vues - p.vues) : null, contacts_jour: p ? Math.max(0, (x.messages + x.appels) - (p.messages + p.appels)) : null });
    });
    return out;
}

// ---------------------------------------------------------------- Annonces concurrentes (depuis les recherches du Mac mini)
// Appelé à chaque analyse reçue d'une demande achetée : on met à jour la liste des concurrentes du véhicule.
// Une annonce vue avant mais absente d'une recherche qui couvre son km et son année = disparue (vendue le plus souvent).
function suivreConcurrents(vid, ads, cible = {}) {
    if (!vid || !Array.isArray(ads) || !ads.length) return;
    const L = lire(), C = L.concurrents[vid] = L.concurrents[vid] || {}, j = jourParis(), vus = new Set();
    for (const a of ads) {
        if (!a || !a.id || !a.prix) continue;
        const id = String(a.id); vus.add(id);
        const e = C[id];
        if (!e) C[id] = { vu_le: j, vu_der: j, prix: a.prix, prix0: a.prix, km: a.km, an: a.an, pro: !!a.pro, jours0: a.jours || 0, titre: s(a.titre || a.version, 120), url: s(a.url, 200), ville: s(a.ville, 60), positionnement: s(a.positionnement, 40) };
        else Object.assign(e, { vu_der: j, prix: a.prix, positionnement: s(a.positionnement, 40) || e.positionnement, disparue_le: null });
    }
    // Disparues : recherche du jour faite, annonce non revue, dans la zone de km couverte.
    const kms = ads.map(a => a.km).filter(Boolean), kmMin = Math.min(...kms), kmMax = Math.max(...kms);
    for (const [id, e] of Object.entries(C)) {
        if (vus.has(id) || e.disparue_le || e.vu_der === j) continue;
        if (e.km && kms.length && (e.km < kmMin * 0.9 || e.km > kmMax * 1.1)) continue;
        e.disparue_le = j;
    }
    // 400 annonces au plus par véhicule (les plus anciennes disparues partent d'abord)
    const l = Object.entries(C); if (l.length > 400) l.sort((a, b) => String(a[1].vu_der).localeCompare(String(b[1].vu_der))).slice(0, l.length - 400).forEach(([id]) => delete C[id]);
    sauver();
}
// Lecture du marché observé : vitesse de disparition par position de prix vs la tranche « Très bonne affaire ».
function vitesseMarche(vid, tba) {
    const C = Object.values(lire().concurrents[vid] || {}), j = jourParis();
    const age = e => (e.jours0 || 0) + Math.round((new Date(e.disparue_le || e.vu_der) - new Date(e.vu_le)) / 864e5);
    const pos = e => !tba ? 'inconnue' : e.prix <= tba.max ? 'tres_bonne_affaire' : tba.bandes && e.prix <= tba.bandes.ba ? 'bonne_affaire' : tba.bandes && e.prix <= tba.bandes.eq ? 'equitable' : 'au_dessus';
    const parPos = {};
    for (const e of C) { const p = pos(e); const g = parPos[p] = parPos[p] || { n: 0, disparues: 0, ages: [] }; g.n++; if (e.disparue_le) { g.disparues++; g.ages.push(age(e)); } }
    const med = l => { if (!l.length) return null; const t = [...l].sort((a, b) => a - b), m = t.length >> 1; return t.length % 2 ? t[m] : Math.round((t[m - 1] + t[m]) / 2); };
    for (const g of Object.values(parPos)) { g.delai_median = med(g.ages); delete g.ages; }
    const suivies = C.length, disp = C.filter(e => e.disparue_le);
    const premier = C.reduce((m, e) => e.vu_le < m ? e.vu_le : m, j);
    return { suivies, en_ligne: suivies - disp.length, disparues: disp.length, suivi_depuis: premier, jours_suivi: Math.round((new Date(j) - new Date(premier)) / 864e5), par_position: parPos,
        disparues_recentes: disp.sort((a, b) => String(b.disparue_le).localeCompare(String(a.disparue_le))).slice(0, 12).map(e => ({ titre: e.titre, prix: e.prix, prix_depart: e.prix0, km: e.km, an: e.an, pro: e.pro, en_ligne_jours: age(e), disparue_le: e.disparue_le, ville: e.ville })) };
}

// ---------------------------------------------------------------- Diagnostic mécanique (dossiers du parc, envoyés par le Mac mini)
function enregistrerDiag(l) {
    const L = lire();
    for (const d of (Array.isArray(l) ? l : []).slice(0, 60)) { const p = plaqueCle(d.plaque); if (p) L.diag[p] = { fichier: s(d.fichier, 120), texte: s(d.texte, 20000), cas: (d.cas || []).slice(0, 6).map(c => ({ dossier: s(c.dossier, 120), texte: s(c.texte, 8000) })), maj: new Date().toISOString() }; }
    sauver();
    return Object.keys(L.diag).length;
}

// ---------------------------------------------------------------- Stratégies (renvoyées par Claude sur le Mac mini)
function enregistrerStrategie(vid, b) {
    const L = lire(), avant = L.strategies[vid];
    const st = { ...b, recu_le: new Date().toISOString() };
    L.strategies[vid] = { ...st, historique: [...((avant && avant.historique) || []), ...(avant ? [{ le: avant.recu_le, prix_conseille: avant.prix_conseille, action: (avant.actions || [])[0] && avant.actions[0].titre, proba_30j: avant.probabilite && avant.probabilite.j30 }] : [])].slice(-30) };
    sauver();
    return L.strategies[vid];
}
function enregistrerPlan(b) { const L = lire(); L.plan = { ...b, recu_le: new Date().toISOString() }; sauver(); return L.plan; }

module.exports = { sauver, lire, enregistrerAnnonces, lier, serie, suivreConcurrents, vitesseMarche, enregistrerDiag, enregistrerStrategie, enregistrerPlan, cleAnnonce, jourParis, plaqueCle };
