// Estimation LUNICAR à partir du marché Leboncoin (lib/marche.js) — remplace l'estimation IA pour la décision d'achat.
//
// Règles, toutes visibles dans la fiche :
// - Prix Leboncoin : moyenne Sonar des annonces au km de la demande (courbe prix / km si plusieurs points),
//   sinon médiane des annonces comparables (véhicules de plus de 20 ans), sinon modèles proches de la base.
// - Revente visée : haut de la tranche « Très bonne affaire » (on vend vite, sans négocier dur).
// - Achat max = revente visée − frais par défaut (60 € TTC + annonce Leboncoin 63 € HT) − marge visée
//   (max de 500 € et 10 % de la revente, réglable). L'état n'est
//   jamais déduit : la remise en état est jugée à la main.
// - Revente (0-100) : délai réel de vente (40) · demande = indice de visites comparé à toute la base (35)
//   · volume de ventes (15) · fiabilité du prix (10). Un critère absent n'est pas compté (pondération recalculée).
// - Verdict sur le prix demandé : comparé à NOTRE achat max (jamais au prix de marché seul).
const marche = require('./marche');
const store = require('./store');

// Marge visée = la plus grande de marge_min et marge_pct % de la revente visée (une petite voiture garde une marge en euros).
const DEFAUT = { frais_ttc: 60, annonce_ht: 63, tva: 20, marge_min: 500, marge_pct: 10, arrondi: 50 };
const reglages = async () => ({ ...DEFAUT, ...((await store.lireReglage('marche_reglages', {})) || {}) });
const fraisDe = R => Math.round((Number(R.frais_ttc) || 0) + (Number(R.annonce_ht) || 0) * (1 + (Number(R.tva) || 0) / 100));

const med = t => { const s = t.filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return 0; const m = (s.length - 1) / 2; return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2; };
const rang = (t, v) => !t.length ? 0.5 : t.filter(x => x < v).length / t.length + t.filter(x => x === v).length / t.length / 2;
const kmDe = x => Number(String((x || {}).kilometrage || '').replace(/\D/g, '')) || 0;

// Visites des 3 derniers mois, tendance vs les 9 mois précédents, annonces en ligne.
function offreDemande(od) {
    const l = [...(od || [])].sort((a, b) => String(b[0]).localeCompare(String(a[0])));
    if (!l.length) return null;
    const moy = t => t.length ? t.reduce((s, x) => s + x, 0) / t.length : 0;
    const v3 = moy(l.slice(0, 3).map(x => x[2])), vAvant = moy(l.slice(3, 12).map(x => x[2]));
    const a3 = moy(l.slice(0, 3).map(x => x[1])), aAvant = moy(l.slice(3, 12).map(x => x[1]));
    return { visites: Math.round(v3 * 10) / 10, tendance_visites: vAvant ? Math.round((v3 / vAvant - 1) * 100) : 0, annonces: Math.round(a3), tendance_annonces: aAvant ? Math.round((a3 / aAvant - 1) * 100) : 0,
        mois: l.slice(0, 12).reverse().map(x => [String(x[0]).slice(0, 7), x[1], x[2]]) };
}

// Statistiques de toute la base (pour situer la demande d'un modèle par rapport aux autres).
let cacheBase = { maj: null, v: null };
function base() {
    const maj = marche.lire().maj;
    if (cacheBase.v && cacheBase.maj === maj) return cacheBase.v;
    const l = marche.tous();
    const visites = [], ventes = [];
    for (const r of l) { const o = offreDemande(r.offre_demande); if (o && o.visites) visites.push(o.visites); if (r.ventes && r.ventes.nb) ventes.push(r.ventes.nb); }
    cacheBase = { maj, v: { visites: visites.sort((a, b) => a - b), ventes: ventes.sort((a, b) => a - b), n: l.length } };
    return cacheBase.v;
}

// Prix à un km donné sur la courbe des points relevés (interpolation linéaire, extrapolation bornée).
function prixAuKm(points, km) {
    const p = (points || []).filter(x => x.moyenne > 0).sort((a, b) => a.km - b.km);
    if (!p.length || !km) return null;
    if (p.length === 1) return { prix: p[0].moyenne, ref: p[0], exact: Math.abs(p[0].km - km) <= 15000 };
    let a = p[0], b = p[1];
    for (let i = 0; i < p.length - 1; i++) { if (km >= p[i].km) { a = p[i]; b = p[i + 1]; } }
    if (km > p[p.length - 1].km) { a = p[p.length - 2]; b = p[p.length - 1]; }
    const pente = (b.moyenne - a.moyenne) / ((b.km - a.km) || 1);
    let prix = a.moyenne + pente * (km - a.km);
    const proche = Math.abs(a.km - km) < Math.abs(b.km - km) ? a : b;
    prix = Math.max(prix, proche.moyenne * 0.4);
    return { prix: Math.round(prix), ref: proche, exact: p.some(x => Math.abs(x.km - km) <= 15000) };
}

// Pas de relevé pour cette plaque : modèles proches de la base (même marque / modèle, ±2 ans).
function similaires(x) {
    const txt = String(x.vehicule || '').toLowerCase(), an = Number(x.annee) || 0, km = kmDe(x);
    const l = marche.tous().filter(r => r.version && r.version.model && txt.includes(String(r.version.make || '').toLowerCase().split(' ')[0])
        && txt.includes(String(r.version.model || '').toLowerCase().split(' ')[0]) && (!an || Math.abs((r.version.annee || 0) - an) <= 2));
    const prix = l.map(r => { const k = prixAuKm(r.points, km || r.km); return k ? k.prix : (r.annonces && r.annonces.mediane) || 0; }).filter(Boolean);
    return prix.length ? { prix: Math.round(med(prix)), n: prix.length, exemples: l.slice(0, 5).map(r => `${(r.version || {}).label} ${(r.version || {}).annee}`) } : null;
}

// Délai de vente (jours) -> note : ≤ 20 j = 100, 45 j = 70, 90 j = 40, 180 j = 10.
const NOTE_DELAI = j => j <= 20 ? 100 : j <= 45 ? 100 - (j - 20) * 30 / 25 : j <= 90 ? 70 - (j - 45) * 30 / 45 : j <= 180 ? 40 - (j - 90) * 30 / 90 : 5;

function analyser(d, R, B = base()) {
    const x = d.data || {}, rel = marche.releve(x.plaque), km = kmDe(x) || (rel && rel.km) || 0;
    const out = { ref: d.ref, km, source: '', prix: 0, fiabilite: 0, tranches: [], version: rel ? rel.version : null, releve_le: rel ? rel.date : null, avertissements: [] };
    // ---- Prix Leboncoin
    if (rel && rel.moyenne) {
        const k = prixAuKm(rel.points && rel.points.length ? rel.points : [{ km: rel.km, moyenne: rel.moyenne, tranches: rel.tranches }], km) || { prix: rel.moyenne, ref: { moyenne: rel.moyenne, tranches: rel.tranches } };
        out.prix = k.prix; out.fiabilite = rel.fiabilite; out.source = 'sonar';
        // Tranches du point le plus proche, recalées sur le prix au km de la demande.
        const f = k.ref.moyenne ? k.prix / k.ref.moyenne : 1;
        out.tranches = (k.ref.tranches || rel.tranches || []).map(t => [t[1], Math.round(t[2] * f), Math.round(t[3] * f)]);
        if (!k.exact) out.avertissements.push(`Prix au km de la demande déduit de la courbe (${(rel.points || []).length} points)`);
    } else if (rel && rel.annonces && rel.annonces.nb) {
        const a = rel.annonces;
        out.prix = a.mediane; out.source = 'annonces'; out.fiabilite = a.nb >= 15 ? 4 : a.nb >= 8 ? 3 : a.nb >= 4 ? 2 : 1;
        out.tranches = (a.tranches || []).map(t => [t[1], t[2], t[3]]);
        out.annonces = { nb: a.nb, total: a.total, p25: a.p25, p75: a.p75, part: a.part, pro: a.pro, age_median: a.age_median, filtre: a.filtre, liste: (a.liste || []).slice(0, 12) };
        out.avertissements.push('Plus de 20 ans ou version rare : pas de prix Sonar, médiane des annonces comparables');
    } else {
        const s = similaires(x);
        if (s) { out.prix = s.prix; out.source = 'similaires'; out.fiabilite = s.n >= 5 ? 2 : 1; out.similaires = s; out.avertissements.push(`Pas encore de relevé pour cette plaque : ${s.n} modèle(s) proche(s) de la base`); }
    }
    // Autres versions de la même plaque (passe « grille ») : prix ramené au km de la demande.
    if (rel && (rel.variantes || []).length && out.source === 'sonar') {
        const ref = prixAuKm(rel.points, rel.variantes_km || rel.km), f = ref && ref.prix ? out.prix / ref.prix : 1;
        const l = [[(rel.version || {}).label, (rel.version || {}).trim, out.prix, true], ...rel.variantes.filter(t => t[3] > 0).map(t => [t[1], t[2], Math.round(t[3] * f), false])].sort((a, b) => a[2] - b[2]);
        if (l.length > 1) {
            out.versions = { min: l[0][2], max: l[l.length - 1][2], n: l.length, liste: l };
            if (!(rel.version || {}).suggeree && out.versions.max - out.versions.min > out.prix * 0.15) out.avertissements.push(`Écart de ${(out.versions.max - out.versions.min).toLocaleString('fr-FR')} € selon la version : vérifier la finition sur la carte grise ou les photos`);
        }
    }
    if (rel && rel.version && !rel.version.suggeree && rel.version.choix) out.avertissements.push(`Version choisie automatiquement (${rel.version.choix}) : à vérifier`);
    if (!out.prix) { out.source = 'aucune'; return out; }

    // ---- Revente visée et achat max
    const tba = out.tranches.find(t => /tr[eè]s bonne/i.test(t[0]));
    out.revente = tba ? tba[2] : Math.round(out.prix * 0.85);
    out.frais = fraisDe(R);
    out.marge_cible = Math.round(Math.max(Number(R.marge_min) || 0, out.revente * (Number(R.marge_pct) || 0) / 100));
    const arr = Math.max(1, Number(R.arrondi) || 50);
    out.achat_max = Math.max(0, Math.floor((out.revente - out.frais - out.marge_cible) / arr) * arr);

    // ---- Revente : facile ou pas ?
    const od = rel ? offreDemande(rel.offre_demande) : null, crit = [];
    if (rel && rel.ventes && rel.ventes.nb) {
        const j = rel.ventes.jours;
        crit.push({ k: 'delai', l: 'Délai de vente réel', v: `${j} j en moyenne (${rel.ventes.nb} ventes)`, note: Math.round(NOTE_DELAI(j)), poids: 40 });
        crit.push({ k: 'volume', l: 'Volume de ventes', v: `${rel.ventes.nb} ventes relevées par Leboncoin`, note: Math.round(rang(B.ventes, rel.ventes.nb) * 100), poids: 15 });
        out.ventes = { prix: rel.ventes.prix, jours: j, nb: rel.ventes.nb, liste: (rel.ventes.liste || []).slice(0, 8) };
    } else if (out.annonces && out.annonces.age_median) {
        crit.push({ k: 'delai', l: 'Ancienneté des annonces', v: `${out.annonces.age_median} j en ligne (médiane, faute de ventes relevées)`, note: Math.round(NOTE_DELAI(out.annonces.age_median * 1.3)), poids: 25 });
    }
    if (od && od.visites) {
        const p = rang(B.visites, od.visites);
        crit.push({ k: 'demande', l: 'Demande (visites)', v: `indice ${od.visites}, plus que ${Math.round(p * 100)} % des modèles de la base${od.tendance_visites ? ` · ${od.tendance_visites > 0 ? '+' : ''}${od.tendance_visites} % sur 3 mois` : ''}`, note: Math.round(p * 100), poids: 35 });
        out.offre_demande = od;
    }
    crit.push({ k: 'fiabilite', l: 'Fiabilité du prix', v: `${out.fiabilite}/5`, note: Math.round(out.fiabilite / 5 * 100), poids: 10 });
    const poids = crit.reduce((t, c) => t + c.poids, 0);
    out.revente_score = Math.round(crit.reduce((t, c) => t + c.note * c.poids, 0) / (poids || 1));
    out.revente_verdict = out.revente_score >= 70 ? 'Se revend vite' : out.revente_score >= 50 ? 'Revente correcte' : 'Revente lente';
    out.criteres = crit;
    if (crit.length <= 1) out.avertissements.push('Peu de données de revente : score indicatif');

    // ---- Prix demandé par le vendeur
    const E = Number(String(x.prix_souhaite || '').replace(/\D/g, '')) || 0;
    if (E) {
        const t = out.tranches.find(z => E >= z[1] && E <= z[2]);
        const pos = t ? t[0] : out.tranches.length && E < out.tranches[0][1] ? 'Sous la tranche « Très bonne affaire »' : out.tranches.length ? 'Au-dessus du marché' : '';
        const ecart = E - out.achat_max, marge = out.revente - out.frais - E;
        out.demande = { prix: E, position_lbc: pos, ecart_max: ecart, marge_au_prix: marge,
            verdict: ecart <= 0 ? 'acheter' : ecart <= Math.max(300, out.achat_max * 0.15) ? 'negocier' : 'trop_cher',
            texte: ecart <= 0 ? `Achetable au prix demandé : ${marge.toLocaleString('fr-FR')} € de marge à la revente visée`
                : ecart <= Math.max(300, out.achat_max * 0.15) ? `À négocier : obtenir ${ecart.toLocaleString('fr-FR')} € de moins pour tenir la marge`
                : `Trop cher : ${ecart.toLocaleString('fr-FR')} € au-dessus de notre achat max` };
    }
    return out;
}

async function analyses(demandes) {
    const R = await reglages(), B = base(), o = {};
    for (const d of demandes) { try { o[d.ref] = analyser(d, R, B); } catch (e) { o[d.ref] = { ref: d.ref, source: 'erreur', erreur: e.message }; } }
    return { reglages: { ...R, frais: fraisDe(R) }, analyses: o };
}

// Matrice : un regroupement par modèle (marque + modèle + énergie) et par génération d'années (tranches de 3 ans).
function matrice() {
    const B = base(), g = new Map();
    for (const r of marche.tous()) {
        const v = r.version || {}; if (!v.model) continue;
        const an = Number(v.annee) || 0, bloc = an ? `${an - (an % 3)}-${an - (an % 3) + 2}` : '?';
        const k = [v.make, v.model, v.energy || '', bloc].join('|');
        if (!g.has(k)) g.set(k, { marque: v.make, modele: v.model, energie: v.energy || '', annees: bloc, n: 0, p100: [], p150: [], p200: [], jours: [], ventes: [], visites: [], annonces: [], plaques: [] });
        const e = g.get(k); e.n++; e.plaques.push(r.plaque);
        const pts = r.points && r.points.length ? r.points : r.moyenne ? [{ km: r.km, moyenne: r.moyenne }] : [];
        for (const [km, t] of [[100000, e.p100], [150000, e.p150], [200000, e.p200]]) {
            const k2 = pts.length ? prixAuKm(pts, km) : null;
            if (k2 && (pts.length > 1 || Math.abs(pts[0].km - km) <= 30000)) t.push(k2.prix);
            else if (!pts.length && r.annonces && r.annonces.mediane && Math.abs(r.km - km) <= 30000) t.push(r.annonces.mediane);
        }
        if (r.ventes && r.ventes.nb) { e.jours.push(r.ventes.jours); e.ventes.push(r.ventes.nb); }
        const od = offreDemande(r.offre_demande); if (od) { e.visites.push(od.visites); e.annonces.push(od.annonces); }
    }
    return [...g.values()].map(e => {
        const vis = med(e.visites), j = med(e.jours);
        return { marque: e.marque, modele: e.modele, energie: e.energie, annees: e.annees, n: e.n, prix_100k: Math.round(med(e.p100)), prix_150k: Math.round(med(e.p150)), prix_200k: Math.round(med(e.p200)),
            delai_jours: Math.round(j), ventes: Math.round(med(e.ventes)), visites: Math.round(vis * 10) / 10, demande_rang: vis ? Math.round(rang(B.visites, vis) * 100) : null, annonces: Math.round(med(e.annonces)), plaques: e.plaques.slice(0, 20) };
    }).sort((a, b) => b.n - a.n || String(a.marque).localeCompare(String(b.marque)));
}

module.exports = { analyser, analyses, matrice, reglages, fraisDe, prixAuKm, offreDemande, DEFAUT };
