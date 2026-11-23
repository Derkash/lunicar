// Analyse approfondie d'une demande, préparée par le Mac mini avant la notification (23/11/2026).
//
// Le Mac mini (tools/macmini/analyse.js + tools/sonar-collecte.js) vient chercher les demandes à analyser
// (GET /api/marche/analyse/file), puis renvoie ce qu'il a trouvé (POST /api/marche/analyse/:ref) :
//   - ses propres recherches Leboncoin : annonces comparables par tranches de kilométrage (en dessous, au km,
//     au-dessus), et les annonces proches du vendeur (même modèle autour de son code postal) ;
//   - la lecture par Claude des textes du vendeur (message du formulaire, e-mails, notes d'appel, description de
//     son annonce) : faits datés avec la phrase d'origine, contradictions avec ses réponses ;
//   - une fiche moteur en brouillon quand la base n'en a pas pour ce moteur.
// Ce fichier croise tout cela avec Sonar (lib/marche.js), l'achat max (lib/marche-analyse.js), les réponses du
// formulaire et la fiche de la plaque, et produit : la courbe prix / km, le prix de marché retenu, les risques
// chiffrés, l'offre précise et sa fourchette, le niveau de confiance et les questions à poser à l'appel.
//
// Règles :
//   - Rien n'est inventé : sans donnée, la ligne le dit et la confiance baisse.
//   - Une fiche moteur en brouillon (rédigée par le Mac mini) informe l'appel mais ne bouge pas le prix tant
//     qu'elle n'est pas validée dans l'admin ; à sa place, la règle de prudence générique s'applique.
//   - Une réponse du vendeur n'est jamais écrasée par un fait lu dans un texte : l'écart devient une question.
//   - Stockage à part du CRM (DATA_DIR/analyses-vehicules.json) pour ne pas alourdir crm.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const marche = require('./marche');

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FICHIER = path.join(DIR, 'analyses-vehicules.json');
const SEED_FICHES = path.join(__dirname, '..', 'data', 'fiches-moteur.json');
const VERSION = 1;

// ---------------------------------------------------------------- Stockage
let cache = null, ecriture = null;
function lire() {
    if (cache) return cache;
    try { cache = JSON.parse(fs.readFileSync(FICHIER, 'utf8')); } catch (e) { cache = {}; }
    cache.analyses = cache.analyses || {};
    cache.fiches = cache.fiches || {};
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
const analyse = ref => lire().analyses[String(ref || '').toUpperCase()] || null;
function majAnalyse(ref, champs) {
    const b = lire(), k = String(ref).toUpperCase();
    b.analyses[k] = { ...(b.analyses[k] || {}), ...champs, maj: new Date().toISOString() };
    sauver();
    return b.analyses[k];
}

// ---------------------------------------------------------------- Fiches moteur
// Base du dépôt (data/fiches-moteur.json) + fiches ajoutées ou validées sur le disque. Le disque l'emporte.
function fiches() {
    let base = [];
    try { base = JSON.parse(fs.readFileSync(SEED_FICHES, 'utf8')).fiches || []; } catch (e) { base = []; }
    const disque = lire().fiches, out = new Map(base.map(f => [f.id, { ...f, origine: f.origine || 'base' }]));
    for (const [id, f] of Object.entries(disque)) out.set(id, { ...(out.get(id) || {}), ...f });
    return [...out.values()];
}
function enregistrerFiche(f, { origine = 'mac_mini' } = {}) {
    const s = (v, m = 300) => String(v == null ? '' : v).slice(0, m);
    const n = v => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.round(x) : null; };
    const id = s(f.id || [f.marque, f.motorisation].join('-'), 80).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');
    if (!id) throw Object.assign(new Error('Fiche moteur sans identifiant'), { status: 400 });
    const avant = fiches().find(x => x.id === id);
    if (avant && avant.statut === 'valide' && origine === 'mac_mini') return avant;   // une fiche validée n'est jamais écrasée par un brouillon
    const d = f.distribution || {};
    const fiche = {
        id, libelle: s(f.libelle, 120), marque: s(f.marque, 120), motorisation: s(f.motorisation, 200), code_moteur: s(f.code_moteur, 120), energie: s(f.energie, 20),
        distribution: { organe: ['courroie', 'courroie_huile', 'chaine'].includes(d.organe) ? d.organe : '', intervalle_km: n(d.intervalle_km), intervalle_ans: n(d.intervalle_ans), cout_min: n(d.cout_min), cout_max: n(d.cout_max), note: s(d.note, 400) },
        points: (f.points || []).slice(0, 12).map(p => ({ titre: s(p.titre, 120), detail: s(p.detail, 500), organe: s(p.organe, 40), cout_min: n(p.cout_min), cout_max: n(p.cout_max), question: s(p.question, 200) })),
        questions: (f.questions || []).slice(0, 10).map(q => s(q, 200)),
        sources: (f.sources || []).slice(0, 10).map(x => ({ titre: s(x.titre, 160), url: /^https?:\/\//.test(String(x.url || '')) ? s(x.url, 400) : '' })).filter(x => x.url),
        fiabilite: ['constructeur', 'a_verifier', 'prudence'].includes(f.fiabilite) ? f.fiabilite : 'a_verifier',
        statut: origine === 'admin' && f.statut === 'valide' ? 'valide' : 'brouillon', origine, maj: new Date().toISOString()
    };
    lire().fiches[id] = fiche; sauver();
    return fiche;
}
function validerFiche(id, champs = {}) {
    const f = fiches().find(x => x.id === id);
    if (!f) throw Object.assign(new Error('Fiche moteur introuvable'), { status: 404 });
    return enregistrerFiche({ ...f, ...champs, statut: champs.statut === 'brouillon' ? 'brouillon' : 'valide' }, { origine: 'admin' });
}

const sansAccent = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const re = (motif, txt) => { if (!motif) return false; try { return new RegExp(sansAccent(motif), 'i').test(sansAccent(txt)); } catch (e) { return false; } };
// Texte qui décrit le moteur : modèle saisi, version Sonar, fiche plaque (version, type de moteur, code moteur).
function texteMoteur(d) {
    const x = d.data || {}, api = x.fiche_api || {}, rel = marche.releve(x.plaque) || {}, v = rel.version || {};
    return [x.vehicule, x.finition_auto && x.finition_auto.version, v.label, v.trim, api.version, api.sra_commercial, api.type_moteur, api.code_moteur, api.energieNGC, api.capacite_litres ? api.capacite_litres + ' l' : '']
        .filter(Boolean).join(' ');
}
function ficheMoteur(d) {
    const x = d.data || {}, api = x.fiche_api || {}, rel = marche.releve(x.plaque) || {};
    const marque = [api.marque, (rel.version || {}).make, x.vehicule].filter(Boolean).join(' ');
    const txt = texteMoteur(d), code = sansAccent(api.code_moteur || '');
    let best = null;
    for (const f of fiches()) {
        if (f.marque && f.marque !== '*' && !re(f.marque, marque)) continue;
        const parCode = !!(f.code_moteur && code && re(f.code_moteur, code));
        const parMot = f.motorisation && f.motorisation !== '*' && re(f.motorisation, txt);
        const score = (parCode ? 3 : 0) + (parMot ? 2 : 0);
        if (score && (!best || score > best.score)) best = { fiche: f, score, par: parCode ? 'code moteur' : 'motorisation' };
    }
    return best;
}

// ---------------------------------------------------------------- Outils
const num = v => { const x = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')); return Number.isFinite(x) ? x : 0; };
const eur = v => `${Math.round(v).toLocaleString('fr-FR')} €`;
const kmf = v => `${Math.round(v).toLocaleString('fr-FR')} km`;
const bas50 = v => Math.floor(v / 50) * 50;
const quant = (t, q) => { const s = [...t].sort((a, b) => a - b); if (!s.length) return 0; const i = (s.length - 1) * q, b = Math.floor(i); return s[b] + ((s[Math.min(b + 1, s.length - 1)] - s[b]) * (i - b)); };
const med = t => quant(t, 0.5);
const moy = t => t.length ? t.reduce((a, b) => a + b, 0) / t.length : 0;
const distanceKm = (a, b) => {
    if (!a || !b || !a.lat || !b.lat) return null;
    const R = 6371, r = x => x * Math.PI / 180, dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};
function anneeDe(d) {
    const x = d.data || {}, api = x.fiche_api || {};
    const m = String(api.date1erCir_fr || api.date1erCir_us || '').match(/(\d{4})/);
    return num(m && m[1]) || num(String(x.annee || '').slice(-4)) || 0;
}
function mecDe(d) {   // « MM/AAAA » de la 1re mise en circulation (fiche plaque), pour reconnaître l'annonce du vendeur.
    const api = (d.data || {}).fiche_api || {};
    let m = String(api.date1erCir_fr || '').match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
    if (m) return `${m[2]}/${m[3]}`;
    m = String(api.date1erCir_us || '').match(/(\d{4})-(\d{2})/);
    return m ? `${m[2]}/${m[1]}` : '';
}
const energieDe = d => {
    const x = d.data || {}, api = x.fiche_api || {}, v = (marche.releve(x.plaque) || {}).version || {};
    const t = sansAccent([api.energieNGC, v.energy, x.fiche_confirmee, x.vehicule].join(' '));
    return /electri/.test(t) && !/hybrid/.test(t) ? 'electrique' : /hybrid/.test(t) ? 'hybride' : /diesel|gazole|go\b|hdi|dci|tdi|crdi|cdti|multijet|tdci|jtd/.test(t) ? 'diesel' : /essence|es\b|tce|tsi|puretech|vti|ecoboost/.test(t) ? 'essence' : '';
};
const boiteDe = d => {
    const x = d.data || {}, api = x.fiche_api || {}, v = (marche.releve(x.plaque) || {}).version || {};
    const t = sansAccent([api.boite_vitesse, v.gearbox, x.fiche_confirmee].join(' '));
    return /auto|edc|eat|dsg|bva|cvt|robot/.test(t) ? 'automatique' : /manu|bvm|\bm\b/.test(t) ? 'manuelle' : '';
};

// Barème interne de provisions (ordres de grandeur, réglable dans l'admin : réglage « analyse_bareme »).
// Ce sont des hypothèses LUNICAR pour provisionner, à recaler sur nos factures réelles, pas des devis.
const BAREME = {
    panne: { moteur: 2500, turbo: 1200, boite: 1800, embrayage: 900, distribution: 1000, culasse: 1500, demarreur: 400, autre: 1500 },
    soucis: { moteur: 1200, boite: 1000, embrayage: 900, freins: 300, direction: 500, suspensions: 500, clim: 400, autre: 600 },
    part_soucis: 0.7,        // un souci déclaré mais pas chiffré : 70 % du coût type
    voyant: 400, depannage: 150,
    carrosserie: { rayures: 200, abimee: 700 },
    degats: { rayures: 150, bosses: 200, rouille: 300, impacts: 120, grele: 800, parebrise: 350, parechocs: 250 },
    cles: { une: 200, aucune: 450 },
    ct_absent: 350,          // contrôle + petites réparations habituelles
    carnet: { aucun: 0.02, partiel: 0.005 },   // part de la revente : se revend moins bien sans historique
    accident: 0.3,           // accident déclaré, non chiffré : 30 % de la revente
    distribution_generique: { km: 120000, ans: 6, cout: 650 },
    embrayage_generique: { km: 180000, cout: 900, part: 0.25 },
    // Risque « de son âge » non déclaré (distribution sans facture, embrayage d'origine…) : les annonces comparables
    // sont presque toutes dans le même cas, leur prix l'intègre déjà. On n'en provisionne qu'une part, pas le coût
    // entier (sinon on le compte deux fois et toutes les voitures anciennes tombent au plancher, constaté le 23/11/2026).
    part_risque_age: 0.35, part_risque_age_fiche: 0.5,
    revente_lente: 0.03,     // score de revente < 50 : 3 % de la revente en plus
    plancher: 250
};
async function bareme() { const r = await store.lireReglage('analyse_bareme', {}).catch(() => ({})) || {}; return { ...BAREME, ...r }; }

// ---------------------------------------------------------------- Marché : annonces relevées par le Mac mini
// Annonce compacte : { id, prix, km, an, mec, pro, jours, cp, lat, lng, couleur, version, finition, positionnement,
//   ancien_prix, energie, boite, ch, titre, texte, photos, url, hs }
function propresAnnonces(l, max = 60) {
    const s = (v, m) => String(v == null ? '' : v).slice(0, m);
    return (Array.isArray(l) ? l : []).slice(0, max).map(a => ({
        id: s(a.id, 20), prix: num(a.prix), km: num(a.km), an: num(a.an), mec: s(a.mec, 7), pro: a.pro ? 1 : 0, jours: num(a.jours), cp: s(a.cp, 5), ville: s(a.ville, 60),
        lat: Number(a.lat) || 0, lng: Number(a.lng) || 0, couleur: s(a.couleur, 30), version: s(a.version, 90), finition: s(a.finition, 60), positionnement: s(a.positionnement, 40),
        ancien_prix: num(a.ancien_prix), energie: s(a.energie, 20), boite: s(a.boite, 20), ch: num(a.ch), titre: s(a.titre, 120), texte: s(a.texte, 900), photos: num(a.photos),
        url: /^\/ad\//.test(String(a.url || '')) || /^https:\/\/www\.leboncoin\.fr\//.test(String(a.url || '')) ? s(a.url, 200) : '', hs: a.hs ? 1 : 0
    })).filter(a => a.prix >= 200);
}

// Filtre et courbe prix / km. Exclut : doublons (même id, ou même prix + km + année), annonces « en panne »,
// autre énergie ou autre boîte, autre motorisation (puissance à plus de 15 % de celle de la version Sonar),
// puis les prix aberrants (résidu de la régression > 2,5 écarts absolus médians).
function courbe(ads, cible) {
    const ecartees = [], vus = new Set();
    const garder = [];
    for (const a of ads) {
        const k = a.id || `${a.prix}|${a.km}|${a.an}`, k2 = `${a.prix}|${a.km}|${a.an}`;
        if (vus.has(k) || vus.has(k2)) { ecartees.push([a, 'doublon']); continue; }
        vus.add(k); vus.add(k2);
        if (a.hs) { ecartees.push([a, 'en panne / pour pièces']); continue; }
        if (cible.energie && a.energie && sansAccent(a.energie).slice(0, 4) !== cible.energie.slice(0, 4) && !(cible.energie === 'hybride' && /hybr/i.test(a.energie))) { ecartees.push([a, 'autre énergie']); continue; }
        if (cible.boite && a.boite && (cible.boite === 'automatique') !== /auto/i.test(a.boite)) { ecartees.push([a, 'autre boîte']); continue; }
        if (cible.ch && a.ch && Math.abs(a.ch - cible.ch) / cible.ch > 0.15) { ecartees.push([a, `autre motorisation (${a.ch} ch)`]); continue; }
        if (!a.km) { ecartees.push([a, 'kilométrage absent']); continue; }
        garder.push(a);
    }
    // Régression prix = a + b·km + c·(année − année cible), moindres carrés, deux passes (aberrants retirés).
    const ajuster = l => {
        const n = l.length; if (n < 4) return null;
        const X = l.map(a => [1, a.km / 1000, (a.an || cible.an) - cible.an]), y = l.map(a => a.prix);
        const varAn = new Set(l.map(a => a.an || cible.an)).size > 1;
        const cols = varAn ? 3 : 2;
        const A = Array.from({ length: cols }, () => Array(cols).fill(0)), B = Array(cols).fill(0);
        for (let i = 0; i < n; i++) for (let r = 0; r < cols; r++) { B[r] += X[i][r] * y[i]; for (let c = 0; c < cols; c++) A[r][c] += X[i][r] * X[i][c]; }
        // Élimination de Gauss
        for (let p = 0; p < cols; p++) {
            let m = p; for (let r = p + 1; r < cols; r++) if (Math.abs(A[r][p]) > Math.abs(A[m][p])) m = r;
            [A[p], A[m]] = [A[m], A[p]]; [B[p], B[m]] = [B[m], B[p]];
            if (Math.abs(A[p][p]) < 1e-9) return null;
            for (let r = 0; r < cols; r++) if (r !== p) { const f = A[r][p] / A[p][p]; for (let c = p; c < cols; c++) A[r][c] -= f * A[p][c]; B[r] -= f * B[p]; }
        }
        const k = B.map((b, i) => b / A[i][i]);
        return { a: k[0], parKkm: k[1], parAn: varAn ? k[2] : 0, n };
    };
    let fit = ajuster(garder);
    let retenues = garder;
    if (fit) {
        const res = garder.map(a => a.prix - (fit.a + fit.parKkm * a.km / 1000 + fit.parAn * ((a.an || cible.an) - cible.an)));
        const mad = med(res.map(Math.abs)) || 1;
        retenues = garder.filter((a, i) => { const ok = Math.abs(res[i]) <= 2.5 * mad * 1.4826; if (!ok) ecartees.push([a, 'prix hors marché']); return ok; });
        fit = ajuster(retenues) || fit;
    }
    // Pente plausible : une voiture perd de la valeur avec les km. Une pente positive (peu d'annonces) n'est pas retenue.
    if (fit && fit.parKkm > 0) fit = { ...fit, parKkm: 0, pente_ignoree: true };
    const auKm = (a) => fit ? a.prix + fit.parKkm * (cible.km - a.km) / 1000 + fit.parAn * (cible.an - (a.an || cible.an)) : a.prix;
    const ajustes = retenues.map(a => ({ ...a, prix_ajuste: Math.round(auKm(a)) }));
    const part = ajustes.filter(a => !a.pro), pro = ajustes.filter(a => a.pro);
    const stats = l => l.length ? { n: l.length, min: Math.round(Math.min(...l.map(a => a.prix_ajuste))), max: Math.round(Math.max(...l.map(a => a.prix_ajuste))), mediane: Math.round(med(l.map(a => a.prix_ajuste))), moyenne: Math.round(moy(l.map(a => a.prix_ajuste))), q1: Math.round(quant(l.map(a => a.prix_ajuste), 0.25)), q3: Math.round(quant(l.map(a => a.prix_ajuste), 0.75)) } : null;
    const tous = stats(ajustes);
    const prixCourbe = fit ? Math.round(fit.a + fit.parKkm * cible.km / 1000) : tous ? tous.mediane : 0;
    const cv = tous && tous.moyenne ? Math.round(Math.sqrt(moy(ajustes.map(a => (a.prix_ajuste - tous.moyenne) ** 2))) / tous.moyenne * 100) / 100 : null;
    // Points de la courbe par tranche de km (pour l'affichage) : médiane brute par tranche.
    const tranches = [];
    const pas = [-60000, -30000, -10000, 10000, 30000, 60000];
    for (let i = 0; i < pas.length - 1; i++) {
        const lo = cible.km + pas[i], hi = cible.km + pas[i + 1];
        const l = retenues.filter(a => a.km >= lo && a.km < hi);
        tranches.push({ de: Math.max(0, lo), a: hi, n: l.length, mediane: l.length ? Math.round(med(l.map(a => a.prix))) : 0, km_median: l.length ? Math.round(med(l.map(a => a.km))) : 0 });
    }
    return {
        n: ajustes.length, ecartees: ecartees.length, motifs_ecart: Object.entries(ecartees.reduce((o, [, m]) => { const k = m.replace(/\s*\(.*\)$/, ''); o[k] = (o[k] || 0) + 1; return o; }, {})).map(([m, c]) => `${c} ${m}`),
        pente_10000km: fit ? Math.round(fit.parKkm * 10) : null, pente_an: fit ? Math.round(fit.parAn) : null, pente_ignoree: !!(fit && fit.pente_ignoree),
        prix_au_km: prixCourbe, tous, part: stats(part), pro: stats(pro), part_pct: ajustes.length ? Math.round(part.length / ajustes.length * 100) : null,
        km_median: ajustes.length ? Math.round(med(ajustes.map(a => a.km))) : 0, jours_median: ajustes.length ? Math.round(med(ajustes.map(a => a.jours))) : 0,
        anciennes_pct: ajustes.length ? Math.round(ajustes.filter(a => a.jours > 35).length / ajustes.length * 100) : null,
        baisses_pct: ajustes.length ? Math.round(ajustes.filter(a => a.ancien_prix > a.prix).length / ajustes.length * 100) : null,
        dispersion: cv, tranches,
        // Référence « tout marché » (méthode du 03/11/2026) : médianes particuliers et pros pondérées par le nombre d'annonces.
        reference: part.length || pro.length ? Math.round(((stats(part) || { mediane: 0 }).mediane * part.length + (stats(pro) || { mediane: 0 }).mediane * pro.length) / (part.length + pro.length)) : 0,
        exemples: ajustes.sort((a, b) => Math.abs(a.km - cible.km) - Math.abs(b.km - cible.km)).slice(0, 12).map(a => ({ prix: a.prix, prix_ajuste: a.prix_ajuste, km: a.km, an: a.an, pro: a.pro, jours: a.jours, ville: a.ville, version: a.version || a.titre, url: a.url }))
    };
}

// ---------------------------------------------------------------- Annonce du vendeur
function annonceVendeur(ads, d, vendeur, refus = []) {
    const x = d.data || {}, km = num(x.kilometrage), an = anneeDe(d), mec = mecDe(d);
    const couleur = sansAccent((x.fiche_api || {}).couleur || '');
    const motsVersion = new Set(sansAccent([x.vehicule, (x.finition_auto || {}).version].join(' ')).split(/[^a-z0-9.]+/).filter(w => w.length > 2));
    const souhait = num(x.prix_souhaite);
    const notes = [];
    for (const a of ads) {
        if (refus.includes(a.id)) continue;
        const p = [], dist = distanceKm(vendeur, a);
        // Sans position connue (vendeur ou annonce), ou à plus de 60 km : ce ne peut pas être la sienne.
        if (dist == null || dist > 60) continue;
        let s = 0;
        if (km && a.km) {
            const e = Math.abs(a.km - km);
            if (e > Math.max(25000, km * 0.25)) continue;
            if (e <= 3000) { s += 40; p.push('km à moins de 3 000 km'); } else if (e <= 10000) { s += 20; p.push('km à moins de 10 000 km'); }
            // Une annonce affiche souvent un peu moins de km que le formulaire (relevé plus ancien).
        }
        if (mec && a.mec && a.mec === mec) { s += 30; p.push(`même mise en circulation (${mec})`); }
        else if (an && a.an === an) { s += 10; p.push('même année'); }
        else if (an && a.an && Math.abs(a.an - an) > 1) continue;
        if (dist <= 10) { s += 20; p.push(`${dist} km du vendeur`); } else if (dist <= 30) { s += 10; p.push(`${dist} km du vendeur`); }
        if (couleur && a.couleur && sansAccent(a.couleur).slice(0, 4) === couleur.slice(0, 4)) { s += 15; p.push(`même couleur (${a.couleur})`); }
        if (a.pro) s -= 40; else { s += 10; p.push('particulier'); }
        const mv = sansAccent(a.version + ' ' + a.finition).split(/[^a-z0-9.]+/).filter(w => w.length > 2 && motsVersion.has(w));
        if (mv.length >= 2) { s += 10; p.push('même version'); }
        if (souhait && Math.abs(a.prix - souhait) <= Math.max(300, souhait * 0.1)) { s += 5; p.push('prix proche de son prix souhaité'); }
        if (s >= 50) notes.push({ ...a, score: s, preuves: p, distance: dist });
    }
    notes.sort((a, b) => b.score - a.score);
    const best = notes[0];
    if (!best) return null;
    const ecarts = [];
    if (km && best.km && Math.abs(best.km - km) >= 2000) ecarts.push(`${kmf(best.km)} dans l'annonce, ${kmf(km)} au formulaire`);
    if (souhait && best.prix) ecarts.push(`affichée ${eur(best.prix)}, il demande ${eur(souhait)}`);
    return {
        niveau: best.score >= 75 ? 'sure' : 'probable', score: best.score, preuves: best.preuves, ecarts,
        annonce: { id: best.id, url: best.url, prix: best.prix, ancien_prix: best.ancien_prix, jours: best.jours, km: best.km, ville: best.ville, distance: best.distance, titre: best.titre, texte: best.texte, photos: best.photos, couleur: best.couleur, positionnement: best.positionnement },
        autres: notes.slice(1, 3).map(a => ({ id: a.id, url: a.url, prix: a.prix, km: a.km, ville: a.ville, score: a.score }))
    };
}

// ---------------------------------------------------------------- Calcul complet
async function calculer(d, opts = {}) {
    const MA = require('./marche-analyse');
    const R = await MA.reglages(), Bm = await bareme();
    const x = d.data || {}, s = d.suivi || {}, A = analyse(d.ref) || {}, mac = A.mac || {};
    const rel = marche.releve(x.plaque), v = (rel && rel.version) || {};
    const km = num(x.kilometrage) || (rel && rel.km) || 0, an = anneeDe(d), age = an ? Math.max(0, new Date().getFullYear() - an) : 0;
    const energie = energieDe(d), boite = boiteDe(d), ma = MA.analyser(d, R);
    const out = { ref: d.ref, version: VERSION, calcule_le: new Date().toISOString(), etat: A.etat || 'jamais', analyse_le: A.termine_le || null,
        vehicule: {}, marche: {}, risques: [], offre: null, confiance: null, questions: [], annonce_vendeur: null, textes: null, fiche_moteur: null, ecarts_identite: [], avertissements: [] };

    // ---- Identité : plaque, Sonar, vendeur
    const api = x.fiche_api || {};
    out.vehicule = { libelle: x.vehicule, version_sonar: v.label || '', finition_sonar: v.trim || '', energie, boite, annee: an || null, mec: mecDe(d) || null, km,
        code_moteur: api.code_moteur || '', couleur: api.couleur || '', puissance: v.power || num(api.puisFiscReelCH) || null, places: num(api.nr_passagers) || v.seats || null, carrosserie: api.carrosserie || api.carrosserieCG || v.car_type || '' };
    if (api.energieNGC && v.energy && energieDe({ data: { fiche_api: { energieNGC: api.energieNGC } } }) !== energieDe({ data: { fiche_api: { energieNGC: v.energy } } })) out.ecarts_identite.push(`Énergie : plaque « ${api.energieNGC} », Sonar « ${v.energy} »`);
    if (v.annee && an && Math.abs(v.annee - an) > 1) out.ecarts_identite.push(`Année : plaque ${an}, Sonar ${v.annee}`);
    if (x.vehicule_declare && v.model && !sansAccent(x.vehicule_declare).includes(sansAccent(v.model).split(' ')[0])) out.ecarts_identite.push(`Modèle déclaré « ${x.vehicule_declare} », Sonar « ${v.make} ${v.model} »`);
    if (v.seats && api.nr_passagers && Number(v.seats) !== num(api.nr_passagers)) out.ecarts_identite.push(`Places : plaque ${api.nr_passagers}, Sonar ${v.seats} (5 ou 7 places ? vérifier la carte grise)`);
    if (rel && rel.version && !rel.version.suggeree && rel.version.choix) out.ecarts_identite.push(`Version Sonar choisie automatiquement : ${rel.version.choix}`);

    // ---- Marché : Sonar + annonces du Mac mini
    const lbc = mac.lbc || {};
    const cible = { km: km || 150000, an: an || (v.annee || 0), energie, boite, ch: v.power || 0 };
    const toutes = [...(lbc.bandes || []).flatMap(b => b.ads || []), ...((lbc.local || {}).ads || [])];
    const C = toutes.length ? courbe(toutes, cible) : null;
    const sonarPrix = ma && ma.source === 'sonar' ? ma.prix : 0;
    out.marche = {
        sonar: sonarPrix ? { prix_au_km: sonarPrix, fiabilite: ma.fiabilite, tranches: ma.tranches, ventes: ma.ventes ? { nb: ma.ventes.nb, prix: ma.ventes.prix, jours: ma.ventes.jours } : null, releve_le: ma.releve_le } : null,
        annonces: C, revente_score: ma ? ma.revente_score : null, revente_verdict: ma ? ma.revente_verdict : null, source_achat_max: ma ? ma.source : 'aucune',
        recherches: (lbc.bandes || []).map(b => ({ de: b.min, a: b.max, total: b.total, relevees: (b.ads || []).length })), recherche_le: A.termine_le || null
    };
    // Prix de marché retenu : Sonar pondéré par sa fiabilité, annonces pondérées par leur nombre et leur homogénéité.
    const pts = [];
    if (sonarPrix) pts.push({ src: 'Sonar', prix: sonarPrix, poids: Math.max(1, ma.fiabilite) * 2 });
    if (C && C.n >= 5 && C.prix_au_km) pts.push({ src: `courbe de ${C.n} annonces`, prix: C.prix_au_km, poids: Math.min(10, C.n / 3) * (C.dispersion != null && C.dispersion > 0.35 ? 0.5 : 1) });
    if (C && C.reference && C.n >= 5) pts.push({ src: 'référence particuliers + pros', prix: C.reference, poids: Math.min(6, C.n / 5) });
    // Ventes réelles relevées par Sonar (prix de transaction), ramenées au km de la demande avec la pente de la courbe.
    const ventes = ((rel && rel.ventes && rel.ventes.liste) || []).filter(t => num(t[4]) > 200 && num(t[0]) > 0);
    if (ventes.length >= 3) {
        const pente = C && C.pente_10000km != null ? C.pente_10000km / 10000 : -0.02;   // € par km ; repli : − 200 € / 10 000 km
        const aj = ventes.map(t => num(t[4]) + pente * (cible.km - num(t[0])));
        const mv = Math.round(med(aj));
        out.marche.ventes_reelles = { n: ventes.length, mediane_ajustee: mv, jours_median: Math.round(med(ventes.map(t => num(t[2])).filter(Boolean))), pente_utilisee: Math.round(pente * 10000) };
        pts.push({ src: `${ventes.length} ventes réelles Sonar`, prix: mv, poids: Math.min(6, ventes.length / 2) });
    }
    if (!pts.length && ma && ma.prix) pts.push({ src: ma.source === 'annonces' ? 'annonces Sonar (repli)' : 'modèles proches', prix: ma.prix, poids: 1 });
    const poids = pts.reduce((t, p) => t + p.poids, 0);
    const prixMarche = poids ? Math.round(pts.reduce((t, p) => t + p.prix * p.poids, 0) / poids) : 0;
    out.marche.prix_retenu = prixMarche;
    out.marche.composantes = pts.map(p => ({ source: p.src, prix: Math.round(p.prix), poids: Math.round(p.poids / poids * 100) }));
    if (sonarPrix && C && C.prix_au_km && C.n >= 5) {
        const e = Math.round((C.prix_au_km / sonarPrix - 1) * 100);
        out.marche.ecart_sonar_annonces = e;
        if (Math.abs(e) >= 12) out.avertissements.push(`Sonar et nos annonces divergent de ${e > 0 ? '+' : ''}${e} % : vérifier la version et les annonces retenues`);
    }
    if (!km) out.avertissements.push('Kilométrage absent : marché calculé à 150 000 km');

    // ---- Revente visée et achat max (règles de lib/marche-analyse.js, recalées sur le prix retenu)
    let revente = 0;
    if (ma && ma.revente && ma.prix) revente = Math.round(ma.revente * (prixMarche / ma.prix));
    else if (C && C.tous) revente = Math.round(C.tous.q1);
    else if (prixMarche) revente = Math.round(prixMarche * 0.85);
    const frais = MA.fraisDe(R), marge = Math.round(Math.max(Number(R.marge_min) || 0, revente * (Number(R.marge_pct) || 0) / 100));
    const achatMaxSain = revente ? Math.max(0, bas50(revente - frais - marge)) : 0;

    // ---- Faits lus dans les textes par le Mac mini (Claude)
    const T = mac.textes || {};
    const faits = (T.faits || []);
    const faitSur = (organe, type) => faits.filter(f => f.organe === organe && (!type || f.type === type));
    out.textes = { resume: T.resume || '', faits, contradictions: T.contradictions || [], lu_le: T.lu_le || null, erreur: T.erreur || '' };

    // ---- Fiche moteur
    const FM = ficheMoteur(d);
    const fm = FM ? FM.fiche : null;
    out.fiche_moteur = fm ? { id: fm.id, libelle: fm.libelle, statut: fm.statut, fiabilite: fm.fiabilite, par: FM.par, distribution: fm.distribution, points: fm.points, questions: fm.questions, sources: fm.sources, origine: fm.origine } : null;
    if (!fm) out.avertissements.push('Pas encore de fiche pour ce moteur : règles de prudence générales');

    // ---- Risques chiffrés
    const R2 = out.risques, ajout = (niveau, titre, detail, provision, extra = {}) => R2.push({ niveau, titre, detail, provision: Math.round(provision || 0), ...extra });
    const meca = sansAccent(x.mecanique);
    const nature = sansAccent(x.nature_panne), organes = sansAccent(x.organes_defaillants);
    const cle = t => ({ moteur: 'moteur', turbo: 'turbo', boite: 'boite', 'boite de vitesses': 'boite', embrayage: 'embrayage', distribution: 'distribution', 'joint de culasse': 'culasse', 'demarreur / batterie': 'demarreur' })[t] || 'autre';
    if (/panne|ne roule/.test(meca)) {
        const k = cle(nature.replace(/ ou .*$/, '').trim());
        ajout('rouge', 'Ne roule plus', `Panne déclarée : ${x.nature_panne || 'nature inconnue'}${x.deplacable ? ` · se déplace seule : ${x.deplacable}` : ''}`, (Bm.panne[k] || Bm.panne.autre) + (/non/.test(sansAccent(x.deplacable)) ? Bm.depannage : 0), { organe: k });
    } else if (/avec des soucis/.test(meca)) {
        const l = organes.split(/,\s*/).filter(Boolean);
        for (const o of l.length ? l : ['autre']) {
            const k = /moteur/.test(o) ? 'moteur' : /boite/.test(o) ? 'boite' : /embray/.test(o) ? 'embrayage' : /frein/.test(o) ? 'freins' : /direction/.test(o) ? 'direction' : /suspens/.test(o) ? 'suspensions' : /clim/.test(o) ? 'clim' : 'autre';
            ajout(['moteur', 'boite'].includes(k) ? 'rouge' : 'orange', `Souci déclaré : ${o}`, 'Roule avec ce souci, non chiffré : à préciser à l\'appel', (Bm.soucis[k] || Bm.soucis.autre) * Bm.part_soucis, { organe: k });
        }
    }
    if (/accident/.test(meca)) ajout('rouge', 'Accidentée', 'Dommages et réparation à faire préciser (photos indispensables)', revente * Bm.accident);
    if (/^oui/.test(sansAccent(x.voyant)) && !R2.some(r => r.organe === 'moteur')) ajout('orange', 'Voyant allumé', 'Lequel ? Un voyant moteur ou huile change tout', Bm.voyant);
    else if (/ne sait/.test(sansAccent(x.voyant))) ajout('orange', 'Voyant : ne sait pas', 'À vérifier au téléphone', Bm.voyant * 0.3);
    const carro = sansAccent(x.carrosserie);
    if (/abim/.test(carro)) ajout('orange', 'Carrosserie abîmée', x.degats || 'Détail à demander (photos)', Bm.carrosserie.abimee);
    else if (/rayure|choc/.test(carro)) ajout('vert', 'Rayures, petits chocs', x.degats || 'Légers', Bm.carrosserie.rayures);
    const vusDg = new Set();
    for (const dg of sansAccent(x.degats).split(/,\s*/).filter(Boolean)) {
        const k = /parebrise|pare-brise/.test(dg) ? 'parebrise' : /pare-choc/.test(dg) ? 'parechocs' : /rouille/.test(dg) ? 'rouille' : /grele/.test(dg) ? 'grele' : /eclat|impact/.test(dg) ? 'impacts' : /bosse/.test(dg) ? 'bosses' : '';
        if (k && !vusDg.has(k) && vusDg.add(k) && k !== 'rayures' && k !== 'bosses') ajout('orange', `Dégât : ${dg}`, '', Bm.degats[k]);
    }
    if (/^1/.test(x.cles || '')) ajout('vert', 'Une seule clé', 'Double à refaire', Bm.cles.une);
    else if (/aucune/i.test(x.cles || '')) ajout('orange', 'Aucune clé', 'Clés à refaire', Bm.cles.aucune);
    const ct = sansAccent(x.controle_technique);
    if (/pas a jour|expir|non/.test(ct)) ajout('orange', 'Contrôle technique pas à jour', '', Bm.ct_absent);
    const carnet = sansAccent(x.carnet);
    if (carnet === 'non') ajout('orange', 'Sans historique d\'entretien', 'Se revend moins bien, risques mécaniques moins maîtrisés', revente * Bm.carnet.aucun);
    else if (/partie/.test(carnet)) ajout('vert', 'Historique d\'entretien partiel', '', revente * Bm.carnet.partiel);
    if (/^oui/.test(sansAccent(x.financement))) ajout('rouge', 'Crédit, LOA ou LLD en cours', 'LOA/LLD : la voiture n\'est pas à lui. Crédit : solde et non-gage à vérifier avant tout RDV', 0, { bloquant: true });
    if (/^oui/.test(sansAccent(x.importee))) ajout('orange', 'Importée', 'Papiers et décote marchand à vérifier', revente * 0.03);

    // Distribution : fiche moteur validée, sinon règle de prudence. Un fait « distribution faite » lue dans un texte
    // sert de point de départ (à confirmer par la facture) ; un fait contraire devient une question.
    if (energie !== 'electrique') {
        const D = fm && fm.distribution || {};
        const organe = D.organe || '';
        const valide = fm && fm.statut === 'valide' && D.intervalle_km;
        const G = Bm.distribution_generique;
        const iKm = valide ? D.intervalle_km : (organe === 'chaine' ? 0 : G.km), iAns = valide ? D.intervalle_ans : (organe === 'chaine' ? 0 : G.ans);
        const cout = valide && D.cout_min ? Math.round(((D.cout_min || 0) + (D.cout_max || D.cout_min)) / 2) : G.cout;
        const fait = faitSur('distribution', 'entretien_fait').sort((a, b) => (b.km || 0) - (a.km || 0))[0];
        if (organe === 'chaine') {
            ajout('vert', 'Distribution par chaîne', `Pas de remplacement périodique${fm && fm.statut !== 'valide' ? ' (fiche moteur à valider)' : ''} : écouter un éventuel cliquetis à froid`, 0, { organe: 'distribution' });
        } else if (iKm || iAns) {
            const depuisKm = fait && fait.km ? km - fait.km : km, depuisAns = fait && fait.annee ? new Date().getFullYear() - fait.annee : age;
            const ratio = Math.max(iKm ? depuisKm / iKm : 0, iAns ? depuisAns / iAns : 0);
            const libOrg = organe === 'courroie_huile' ? 'courroie dans l\'huile' : organe === 'courroie' ? 'courroie' : 'type inconnu (courroie ou chaîne ?)';
            const src = valide ? `fiche ${fm.libelle} (${fm.fiabilite === 'constructeur' ? 'donnée constructeur' : 'intervalle à vérifier'})` : `règle de prudence LUNICAR${fm && fm.statut !== 'valide' ? ', fiche moteur en brouillon' : ''}`;
            const detail = `${libOrg} · intervalle ${iKm ? kmf(iKm) : '—'}${iAns ? ' / ' + iAns + ' ans' : ''} (${src}) · ${fait ? `faite à ${fait.km ? kmf(fait.km) : '?'}${fait.annee ? ' en ' + fait.annee : ''} selon ${fait.source || 'un texte'}${fait.facture ? ', facture annoncée' : ', sans facture vue'}` : 'aucun remplacement connu'}`;
            const part = fait ? Bm.part_risque_age : (valide ? Bm.part_risque_age_fiche : Bm.part_risque_age);
            if (ratio >= 1) ajout('rouge', 'Distribution à faire ou non justifiée', `${detail} · ${Math.round(part * 100)} % du coût provisionné (les comparables sont souvent dans le même cas) ; sans facture, l'inspection décide`, cout * part, { organe: 'distribution', question: 'Distribution faite ? À quel km, quelle année ? Facture ?' });
            else if (ratio >= 0.8) ajout('orange', 'Distribution bientôt à faire', detail, cout * part * 0.5, { organe: 'distribution', question: 'Distribution faite ? À quel km ? Facture ?' });
            else ajout('vert', 'Distribution', detail, 0, { organe: 'distribution' });
        }
        // Embrayage (boîte manuelle) à gros kilométrage sans remplacement connu
        const EG = Bm.embrayage_generique;
        if (boite !== 'automatique' && km >= EG.km && !faitSur('embrayage', 'entretien_fait').length && !R2.some(r => r.organe === 'embrayage'))
            ajout('orange', 'Embrayage d\'origine probable', `${kmf(km)} sans remplacement connu`, EG.cout * EG.part, { organe: 'embrayage', question: 'Embrayage d\'origine ? Patine en côte ?' });
    }
    // Points connus de la fiche moteur : affichés et transformés en questions ; chiffrés seulement si la fiche est validée.
    for (const p of (fm && fm.points) || []) {
        // Organe déjà provisionné (ex. distribution à faire) : le point est affiché, pas chiffré une 2e fois.
        const dejaCompte = R2.some(r => r.organe === p.organe && r.provision > 0);
        const chiffre = fm.statut === 'valide' && p.cout_min && !dejaCompte ? Math.round(((p.cout_min || 0) + (p.cout_max || p.cout_min)) / 2 * 0.25) : 0;
        if (!faitSur(p.organe, 'entretien_fait').length) ajout('orange', `Point connu : ${p.titre}`, p.detail + (fm.statut !== 'valide' ? ' (fiche à valider, non chiffré)' : chiffre ? ' (25 % du coût type provisionné)' : ' (organe déjà compté plus haut)'), chiffre, { organe: p.organe, question: p.question, fiche: true });
    }
    // Faits lus dans les textes (défauts, réparations faites, pièces neuves)
    for (const f of faits) {
        if (f.type === 'defaut' && !R2.some(r => r.organe && r.organe === f.organe && r.niveau !== 'vert')) {
            const k = Bm.soucis[f.organe] ? f.organe : 'autre';
            ajout(f.gravite === 'forte' ? 'rouge' : 'orange', `Lu dans ${f.source || 'un texte'} : ${f.libelle}`, `« ${f.citation || ''} »`, f.cout ? f.cout : Bm.soucis[k] * 0.5, { organe: f.organe, question: `Préciser : ${f.libelle}`, texte: true });
        }
        if (f.type === 'entretien_fait' && f.organe !== 'distribution') ajout('vert', `Fait selon ${f.source || 'un texte'} : ${f.libelle}`, `« ${f.citation || ''} »${f.facture ? ' · facture annoncée' : ''}`, 0, { organe: f.organe, texte: true });
    }
    if (ma && ma.revente_score != null && ma.revente_score < 50) ajout('orange', 'Revente lente', `${ma.revente_verdict} (${ma.revente_score}/100)`, revente * Bm.revente_lente);

    // ---- Annonce Leboncoin du vendeur
    const vendeur = A.vendeur || null;
    const av = (lbc.local && (lbc.local.ads || []).length) || toutes.length ? annonceVendeur([...((lbc.local || {}).ads || []), ...toutes], d, vendeur, (A.annonce_refusees || [])) : null;
    if (av) {
        if (A.annonce_confirmee && A.annonce_confirmee === av.annonce.id) av.niveau = 'confirmee';
        out.annonce_vendeur = av;
    }

    // ---- Confiance (0-100)
    let conf = 0; const raisons = [];
    if (sonarPrix) { conf += ma.fiabilite * 7; raisons.push(`Sonar fiabilité ${ma.fiabilite}/5`); } else raisons.push('pas de prix Sonar');
    if (C) {
        conf += C.n >= 20 ? 25 : C.n >= 10 ? 18 : C.n >= 5 ? 10 : 3; raisons.push(`${C.n} annonces retenues`);
        if (C.dispersion != null) { conf += C.dispersion < 0.15 ? 12 : C.dispersion < 0.25 ? 8 : C.dispersion < 0.35 ? 4 : 0; raisons.push(`dispersion ${Math.round(C.dispersion * 100)} %`); }
    } else raisons.push('pas d\'annonces relevées par le Mac mini');
    if (sonarPrix && C && out.marche.ecart_sonar_annonces != null) { const e = Math.abs(out.marche.ecart_sonar_annonces); conf += e <= 6 ? 10 : e <= 12 ? 5 : 0; raisons.push(`écart Sonar / annonces ${out.marche.ecart_sonar_annonces} %`); }
    if (rel && rel.version && rel.version.suggeree) { conf += 6; raisons.push('version suggérée par Sonar'); }
    if (out.ecarts_identite.length) { conf -= 5 * out.ecarts_identite.length; raisons.push(`${out.ecarts_identite.length} écart(s) d'identité`); }
    const rouges = R2.filter(r => r.niveau === 'rouge').length;
    conf -= rouges * 6; if (rouges) raisons.push(`${rouges} risque(s) rouge(s)`);
    if ((T.contradictions || []).length) { conf -= 4 * T.contradictions.length; raisons.push(`${T.contradictions.length} contradiction(s)`); }
    if (x.carnet === 'Oui') conf += 4;
    conf = Math.max(0, Math.min(100, Math.round(conf)));
    const niveau = conf >= 70 ? 'élevée' : conf >= 50 ? 'moyenne' : conf >= 30 ? 'faible' : 'insuffisante';
    out.confiance = { score: conf, niveau, raisons };

    // ---- Offre précise et fourchette
    const provisions = R2.reduce((t, r) => t + (r.provision || 0), 0);
    if (achatMaxSain) {
        const brute = bas50(achatMaxSain - provisions);
        const offre = Math.max(Bm.plancher, brute);
        const auPlancher = brute <= Bm.plancher;
        const ecartPct = { 'élevée': 10, moyenne: 15, faible: 25, insuffisante: 30 }[niveau];
        const basF = Math.max(50, bas50(offre * (1 - ecartPct / 100)));
        const souhait = num(x.prix_souhaite);
        const etapes = [
            { libelle: `Prix de marché retenu au km (${out.marche.composantes.map(c => `${c.source} ${eur(c.prix)} · ${c.poids} %`).join(' + ')})`, valeur: prixMarche },
            { libelle: 'Revente visée (haut « Très bonne affaire » recalé sur le prix retenu, sinon 1er quartile des annonces)', valeur: revente },
            { libelle: `− frais (${eur(frais)}) − marge (${eur(marge)}) = achat max d'une voiture saine`, valeur: achatMaxSain },
            ...R2.filter(r => r.provision).map(r => ({ libelle: `− ${r.titre}`, valeur: -r.provision })),
            { libelle: 'Offre conseillée (arrondie aux 50 € inférieurs)', valeur: offre }
        ];
        out.offre = {
            offre, fourchette: { min: Math.min(basF, offre), max: offre, ecart_pct: ecartPct }, achat_max_sain: achatMaxSain, revente_visee: revente, frais, marge, provisions: Math.round(provisions),
            prix_marche: prixMarche, prix_particuliers: C && C.part ? C.part.mediane : null, prix_pros: C && C.pro ? C.pro.mediane : null,
            prix_souhaite: souhait || null, verdict: souhait ? (souhait <= offre ? 'acheter' : souhait <= offre * 1.15 || souhait - offre <= 300 ? 'negocier' : 'trop_cher') : null,
            au_plancher: auPlancher, envoyer_sans_relecture: niveau !== 'insuffisante' && !R2.some(r => r.bloquant) && !auPlancher, etapes
        };
        if (av && av.annonce.prix) out.offre.annonce = { prix: av.annonce.prix, jours: av.annonce.jours, lecture: av.annonce.jours > 35 ? `en ligne depuis ${av.annonce.jours} j à ${eur(av.annonce.prix)} : ce prix ne passe pas` : `en ligne depuis ${av.annonce.jours} j à ${eur(av.annonce.prix)}` };
    } else out.avertissements.push('Pas assez de données de marché pour proposer une offre : à estimer à la main');

    // ---- Questions à poser, dans l'ordre
    const Q = out.questions, vu = new Set(), q = (texte, pourquoi, prio) => { const k = sansAccent(texte).slice(0, 40); if (vu.has(k)) return; vu.add(k); Q.push({ texte, pourquoi, prio }); };
    for (const c of T.contradictions || []) q(`Clarifier : ${c.sujet}`, `Il a répondu « ${c.reponse} » mais a écrit « ${c.citation} »`, 1);
    for (const r of R2.filter(r => r.niveau === 'rouge' && r.question)) q(r.question, `${r.titre} · ${eur(r.provision)} provisionnés`, 2);
    if (/^oui/.test(sansAccent(x.voyant))) q('Quel voyant ? Allumé en permanence ou par moments ?', 'Moteur ou huile = risque fort, airbag = coût connu', 2);
    for (const r of R2.filter(r => r.niveau === 'orange' && r.question)) q(r.question, `${r.titre}${r.provision ? ' · ' + eur(r.provision) + ' provisionnés' : ''}`, 3);
    for (const fq of (fm && fm.questions) || []) q(fq, `Fiche moteur ${fm.libelle}${fm.statut !== 'valide' ? ' (brouillon)' : ''}`, 3);
    if (!x.carnet) q('Carnet d\'entretien ou factures ? Dernière vidange ?', 'Historique inconnu', 4);
    if (!x.financement || /ne sait/.test(sansAccent(x.financement))) q('Crédit, LOA ou gage en cours ?', 'Peut bloquer la vente', 4);
    if (!x.cles) q('Combien de clés ?', 'Double manquant : 150 à 400 €', 5);
    for (const e of out.ecarts_identite) q(`Vérifier : ${e}`, 'Écart entre la plaque, Sonar et sa saisie', 4);
    if (av && av.niveau !== 'confirmee') q(`« J'ai vu une ${x.vehicule || 'voiture'} à ${av.annonce.ville || '?'} à ${eur(av.annonce.prix)}, c'est la vôtre ? »`, `Annonce Leboncoin ${av.niveau === 'sure' ? 'très probablement' : 'peut-être'} la sienne (${av.preuves.join(', ')})`, 2);
    Q.sort((a, b) => a.prio - b.prio);
    return out;
}

// ---------------------------------------------------------------- Résumé (liste des demandes, notification)
function resume(c) {
    if (!c) return null;
    return { offre: c.offre ? c.offre.offre : null, min: c.offre ? c.offre.fourchette.min : null, max: c.offre ? c.offre.fourchette.max : null, confiance: c.confiance ? c.confiance.niveau : null,
        rouges: c.risques.filter(r => r.niveau === 'rouge').map(r => r.titre), annonce: c.annonce_vendeur ? { niveau: c.annonce_vendeur.niveau, prix: c.annonce_vendeur.annonce.prix, jours: c.annonce_vendeur.annonce.jours, url: c.annonce_vendeur.annonce.url } : null,
        etat: c.etat, contradictions: (c.textes && c.textes.contradictions || []).length };
}
function ligneNotification(c) {
    if (!c || !c.offre) return c && c.avertissements.length ? c.avertissements[0] : '';
    const o = c.offre;
    return [o.au_plancher ? `Frais estimés au-dessus de la valeur (marché ${eur(o.prix_marche)}) : au cas par cas` : `Offre conseillée ${eur(o.offre)} (${eur(o.fourchette.min)}–${eur(o.fourchette.max)})`, `confiance ${c.confiance.niveau}`,
        ...c.risques.filter(r => r.niveau === 'rouge').slice(0, 2).map(r => '🔴 ' + r.titre.toLowerCase()),
        c.annonce_vendeur ? `annonce LBC ${c.annonce_vendeur.niveau === 'sure' ? 'sûre' : 'probable'} ${eur(c.annonce_vendeur.annonce.prix)}` : '',
        o.prix_souhaite ? `il demande ${eur(o.prix_souhaite)}` : ''].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------- File du Mac mini
// Empreinte des textes : un nouvel e-mail ou une note d'appel relance la lecture des textes.
function textesDe(d) {
    const x = d.data || {}, s = d.suivi || {}, l = [];
    if (x.message) l.push({ source: 'formulaire', texte: String(x.message).slice(0, 3000) });
    for (const m of (s.emails || []).filter(m => m.sens === 'recu').slice(0, 6)) l.push({ source: `e-mail du ${String(m.date || '').slice(0, 10)}`, texte: String(m.texte || '').slice(0, 3000) });
    for (const a of (s.appels || []).slice(0, 6)) if (a.note || a.texte) l.push({ source: `note d'appel du ${String(a.date || '').slice(0, 10)}`, texte: String(a.note || a.texte).slice(0, 1500) });
    return l;
}
const empreinte = d => crypto.createHash('sha1').update(JSON.stringify([textesDe(d), (d.data || {}).kilometrage, (d.data || {}).plaque])).digest('hex').slice(0, 16);

const geoCache = new Map();
async function coordonnees(cp, ville) {
    cp = String(cp || '').replace(/\D/g, '');
    if (cp.length !== 5) return null;
    const k = cp + '|' + sansAccent(ville);
    if (geoCache.has(k)) return geoCache.get(k);
    try {
        const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${cp}&fields=nom,centre,codeDepartement&format=json`, { signal: AbortSignal.timeout(5000) });
        const l = r.ok ? await r.json() : [];
        const c = l.find(c => sansAccent(c.nom) === sansAccent(ville)) || l[0];
        const v = c && c.centre ? { lat: c.centre.coordinates[1], lng: c.centre.coordinates[0], dep: c.codeDepartement, ville: c.nom } : null;
        geoCache.set(k, v);
        return v;
    } catch (e) { return null; }
}
const IDF = ['75', '77', '78', '91', '92', '93', '94', '95'];

// Demandes à analyser : moins de 7 jours, pas archivées, relevé Sonar fait (ou définitif, ou pas de plaque),
// pas encore analysées ou dont les textes ont changé. Une analyse « en cours » depuis plus de 30 min repart.
// Dernier passage du Mac mini dans la file : sert à savoir s'il fait l'analyse (sinon la notification n'attend pas).
let dernierPassage = 0;
const macActif = () => Date.now() - dernierPassage < 30 * 60e3;
async function file({ limite = 5 } = {}) {
    dernierPassage = Date.now();
    const out = [];
    const demandes = (await store.listerDemandes()).filter(d => d.type !== 'rappel' && Date.now() - new Date(d.created_at) < 7 * 864e5 && !(d.suivi || {}).archivee && !['achetee', 'sans_suite', 'vendue_ailleurs', 'refusee'].includes(d.statut));
    for (const d of demandes) {
        const x = d.data || {}, A = analyse(d.ref) || {}, rel = marche.releve(x.plaque);
        const emp = empreinte(d);
        if (A.etat === 'terminee' && A.empreinte === emp && !A.relancer) continue;
        if (A.etat === 'en_cours' && Date.now() - new Date(A.servi_le || 0) < 30 * 60e3) continue;
        if (x.plaque && !rel && Date.now() - new Date(d.created_at) < 15 * 60e3) continue;   // attendre le relevé Sonar
        const v = (rel && rel.version) || {}, geo = await coordonnees(x.code_postal, x.ville);
        const FM = ficheMoteur(d), api = x.fiche_api || {};
        const mm = v.make_model || '';
        out.push({
            ref: d.ref, cree_le: d.created_at, plaque: marche.plaqueCle(x.plaque), vehicule: x.vehicule || '', km: num(x.kilometrage), annee: anneeDe(d), mec: mecDe(d), energie: energieDe(d), boite: boiteDe(d),
            puissance: v.power || num(api.puisFiscReelCH) || 0, couleur: api.couleur || '', code_moteur: api.code_moteur || '', version: v.label || api.version || '', finition: v.trim || '',
            lbc: mm || api.marque ? { marque: mm ? mm.split('_')[0] : String(api.marque).toUpperCase().trim(), modele: mm, texte: mm ? '' : String(api.modele || '').trim(), zone: geo ? (IDF.includes(geo.dep) ? 'r_12' : `d_${geo.dep}`) : '' } : null,
            vendeur: geo ? { lat: geo.lat, lng: geo.lng, dep: geo.dep, ville: geo.ville, cp: x.code_postal } : null,
            reponses: { mecanique: x.mecanique, voyant: x.voyant, carrosserie: x.carrosserie, degats: x.degats, organes: x.organes_defaillants, panne: x.nature_panne, carnet: x.carnet, cles: x.cles, ct: x.controle_technique, accident: /accident/i.test(x.mecanique || '') ? 'oui' : '', prix_souhaite: x.prix_souhaite },
            textes: textesDe(d), empreinte: emp, deja_lbc: !A.relancer && !!(A.mac && A.mac.lbc && A.mac.lbc.bandes && Date.now() - new Date(A.mac.lbc.le || 0) < 3 * 864e5),
            fiche_moteur: FM ? { id: FM.fiche.id, statut: FM.fiche.statut } : null,
            fiche_a_rediger: FM ? null : { marque: (api.marque || v.make || String(x.vehicule || '').split(' ')[0] || ''), motorisation: [api.version, v.label, api.type_moteur].filter(Boolean).join(' · ').slice(0, 200), code_moteur: api.code_moteur || '', energie: energieDe(d), annee: anneeDe(d) }
        });
        if (out.length >= limite) break;
    }
    // Les plus récentes d'abord : une nouvelle demande est analysée avant les autres.
    out.sort((a, b) => String(b.cree_le).localeCompare(String(a.cree_le)));
    for (const j of out) majAnalyse(j.ref, { etat: 'en_cours', servi_le: new Date().toISOString(), vendeur: j.vendeur, relancer: false });
    return out;
}

// Résultat du Mac mini. Tout est nettoyé (nombres, textes courts), puis la demande est recalculée.
function propresFaits(l) {
    const s = (v, m) => String(v == null ? '' : v).slice(0, m);
    const ORG = ['distribution', 'embrayage', 'moteur', 'boite', 'turbo', 'injection', 'fap', 'egr', 'adblue', 'freins', 'suspensions', 'direction', 'clim', 'batterie', 'pneus', 'carrosserie', 'interieur', 'electrique', 'vidange', 'ct', 'autre'];
    return (Array.isArray(l) ? l : []).slice(0, 30).map(f => ({
        type: ['defaut', 'entretien_fait', 'piece_neuve', 'prix', 'projet', 'administratif', 'autre'].includes(f.type) ? f.type : 'autre',
        organe: ORG.includes(f.organe) ? f.organe : 'autre', libelle: s(f.libelle, 160), citation: s(f.citation, 300), source: s(f.source, 60),
        km: num(f.km) || null, annee: num(f.annee) || null, facture: !!f.facture, cout: num(f.cout) || null, gravite: ['faible', 'moyenne', 'forte'].includes(f.gravite) ? f.gravite : 'moyenne'
    })).filter(f => f.libelle);
}
async function recevoir(ref, b) {
    ref = String(ref || '').toUpperCase();
    const d = await store.lireDemande(ref);
    if (!d) throw Object.assign(new Error('Demande introuvable'), { status: 404 });
    const A = analyse(ref) || {}, mac = { ...(A.mac || {}) };
    if (b.lbc && !b.lbc.erreur) {
        mac.lbc = { le: new Date().toISOString(),
            local: b.lbc.local ? { filtre: String(b.lbc.local.filtre || '').slice(0, 200), total: num(b.lbc.local.total), ads: propresAnnonces(b.lbc.local.ads, 70) } : null,
            bandes: (b.lbc.bandes || []).slice(0, 8).map(x => ({ min: num(x.min), max: num(x.max), total: num(x.total), filtre: String(x.filtre || '').slice(0, 200), ads: propresAnnonces(x.ads, 70) })) };
    }
    if (b.textes) {
        const s = (v, m) => String(v == null ? '' : v).slice(0, m);
        mac.textes = { lu_le: new Date().toISOString(), resume: s(b.textes.resume, 600), faits: propresFaits(b.textes.faits), erreur: s(b.textes.erreur, 200),
            contradictions: (b.textes.contradictions || []).slice(0, 10).map(c => ({ sujet: s(c.sujet, 120), reponse: s(c.reponse, 120), citation: s(c.citation, 300) })) };
    }
    if (b.fiche_moteur && b.fiche_moteur.marque) { try { enregistrerFiche(b.fiche_moteur, { origine: 'mac_mini' }); } catch (e) { /* fiche illisible */ } }
    const erreurs = (b.erreurs || []).slice(0, 10).map(e => String(e).slice(0, 200));
    majAnalyse(ref, { mac, etat: 'terminee', termine_le: new Date().toISOString(), empreinte: b.empreinte || empreinte(d), erreurs, duree_s: num(b.duree_s) || null });
    const c = await calculer(d);
    majAnalyse(ref, { resume: resume(c) });
    return c;
}

module.exports = { macActif, calculer, recevoir, file, analyse, majAnalyse, resume, ligneNotification, fiches, ficheMoteur, enregistrerFiche, validerFiche, courbe, annonceVendeur, propresAnnonces, BAREME, lire };
