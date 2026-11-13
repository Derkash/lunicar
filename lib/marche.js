// Base de connaissance du marché Leboncoin (Sonar Pricing, compte pro YAK) : un relevé par plaque de nos demandes.
// Alimentée depuis un onglet Leboncoin piloté (outils/sonar-collecte.js) : la page envoie chaque relevé ici,
// avec une clé de collecte temporaire générée dans l'admin. Rien n'interroge Leboncoin depuis le serveur.
//
// Relevé (par plaque) : version Sonar (id, libellé, énergie, puissance, boîte…), prix moyen des annonces et fiabilité
// au km de la demande, les 5 tranches de prix (très bonne affaire → au-dessus du marché), les ventes réelles
// (prix, délai de vente en jours), l'offre (nb d'annonces) et la demande (indice de visites) sur 12 mois,
// et des points supplémentaires à d'autres kilométrages (courbe prix / km).
//
// Fichier : DATA_DIR/marche-sonar.json (disque persistant Render), à part du CRM pour ne pas l'alourdir.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FICHIER = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'marche-sonar.json');
let cache = null;
function lire() {
    if (cache) return cache;
    try { cache = JSON.parse(fs.readFileSync(FICHIER, 'utf8')); } catch (e) { cache = { vehicules: {}, maj: null }; }
    if (!cache.vehicules) cache.vehicules = {};
    return cache;
}
let ecriture = null;
function sauver() {
    // Écriture regroupée (la collecte envoie un relevé toutes les quelques secondes).
    if (ecriture) return;
    ecriture = setTimeout(() => {
        ecriture = null;
        const tmp = FICHIER + '.tmp';
        fs.mkdirSync(path.dirname(FICHIER), { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(cache));
        fs.renameSync(tmp, FICHIER);
    }, 2000);
}

const plaqueCle = p => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

// ---------------------------------------------------------------- Clé de collecte (48 h)
// Plusieurs clés (onglet ponctuel 48 h, Mac mini permanent), gardées sur le disque : la collecte survit aux redéploiements.
const FICHIER_CLE = FICHIER.replace(/\.json$/, '.cle');
let cles = [];
try { const c = JSON.parse(fs.readFileSync(FICHIER_CLE, 'utf8')); cles = Array.isArray(c) ? c : c && c.valeur ? [c] : []; } catch (e) { cles = []; }
function nouvelleCle({ jours = 2, nom = 'onglet' } = {}) {
    const cle = { valeur: crypto.randomBytes(18).toString('hex'), expire: Date.now() + Math.min(Math.max(Number(jours) || 2, 1), 400) * 864e5, nom: String(nom).slice(0, 40) };
    // Une seule clé par nom : la nouvelle remplace l'ancienne du même appareil.
    cles = [...cles.filter(c => c.expire > Date.now() && c.nom !== cle.nom), cle];
    fs.mkdirSync(path.dirname(FICHIER_CLE), { recursive: true });
    fs.writeFileSync(FICHIER_CLE, JSON.stringify(cles));
    return cle;
}
const cleValide = v => !!(v && cles.some(c => c.expire > Date.now() && v.length === c.valeur.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(c.valeur))));

// ---------------------------------------------------------------- Relevés
// Nettoie un relevé envoyé par la page de collecte (on ne garde que des nombres et des libellés courts).
function propre(r) {
    const s = (v, m = 160) => String(v == null ? '' : v).slice(0, m);
    const v = r.version || {};
    const tr = (r.tranches || []).slice(0, 5).map(t => [s(t[0], 30), s(t[1], 40), n(t[2]), n(t[3])]);
    const pt = p => ({ km: n(p.km), moyenne: n(p.moyenne), fiabilite: n(p.fiabilite), tranches: (p.tranches || []).slice(0, 5).map(t => [s(t[0], 30), s(t[1], 40), n(t[2]), n(t[3])]) });
    return {
        plaque: plaqueCle(r.plaque), ref: s(r.ref, 12), date: new Date().toISOString(),
        version: { id: s(v.id, 20), label: s(v.label), trim: s(v.trim, 60), make: s(v.make, 40), model: s(v.model, 60), make_model: s(v.make_model, 80), submodel: s(v.submodel, 60),
            energy: s(v.energy, 30), power: n(v.power), gearbox: s(v.gearbox, 20), car_type: s(v.car_type, 30), seats: n(v.seats), annee: n(v.annee), mec: s(v.mec, 10), suggeree: !!v.suggeree, choix: s(v.choix, 120) },
        km: n(r.km), moyenne: n(r.moyenne), fiabilite: n(r.fiabilite), tranches: tr,
        ventes: r.ventes ? { prix: n(r.ventes.prix), jours: n(r.ventes.jours), fiabilite: n(r.ventes.fiabilite), nb: n(r.ventes.nb),
            liste: (r.ventes.liste || []).slice(0, 30).map(t => [n(t[0]), s(t[1], 10), n(t[2]), s(t[3], 10), n(t[4]), s(t[5], 40), s(t[6], 80)]) } : null,
        offre_demande: (r.offre_demande || []).slice(0, 24).map(t => [s(t[0], 10), n(t[1]), n(t[2])]),
        points: (r.points || []).slice(0, 12).map(pt),
        // Autres versions de la même plaque au km de la demande : [id, libellé, finition, moyenne, fiabilité].
        variantes: (r.variantes || []).slice(0, 12).map(t => [s(t[0], 20), s(t[1]), s(t[2], 60), n(t[3]), n(t[4])]), variantes_km: n(r.variantes_km),
        // Annonces Leboncoin comparables (repli quand Sonar n'a pas de prix : véhicule de plus de 20 ans, version rare).
        annonces: r.annonces ? { nb: n(r.annonces.nb), total: n(r.annonces.total), mediane: n(r.annonces.mediane), p25: n(r.annonces.p25), p75: n(r.annonces.p75),
            part: n(r.annonces.part), pro: n(r.annonces.pro), ecartees: n(r.annonces.ecartees), age_median: n(r.annonces.age_median), filtre: s(r.annonces.filtre, 200),
            tranches: (r.annonces.tranches || []).slice(0, 5).map(t => [s(t[0], 30), s(t[1], 40), n(t[2]), n(t[3])]),
            liste: (r.annonces.liste || []).slice(0, 40).map(t => [n(t[0]), n(t[1]), n(t[2]), n(t[3]), n(t[4])]) } : null,
        erreur: s(r.erreur, 200)
    };
}
function enregistrer(r) {
    const p = propre(r);
    if (!p.plaque) throw Object.assign(new Error('Plaque manquante'), { status: 400 });
    const b = lire(), avant = b.vehicules[p.plaque];
    // Un échec (page perdue, réseau…) n'efface jamais un relevé qui a déjà un prix.
    if (p.erreur && !p.moyenne && !(p.annonces && p.annonces.nb) && avant && (avant.moyenne || (avant.annonces && avant.annonces.nb))) return avant;
    // Points à d'autres km : fusionnés avec ceux déjà relevés (la courbe prix / km s'enrichit à chaque passage).
    const parKm = new Map(((avant && avant.points) || []).map(x => [x.km, x]));
    for (const x of p.points) parKm.set(x.km, x);
    const points = [...parKm.values()].sort((a, c) => a.km - c.km);
    // Passage « grille » (r.grille) : seulement des km en plus, le relevé principal reste.
    b.vehicules[p.plaque] = r.grille && avant ? { ...avant, points, maj_points: p.date, ...(p.variantes.length ? { variantes: p.variantes, variantes_km: p.variantes_km } : {}) }
        : { ...p, points, ...(avant && avant.variantes && !p.variantes.length ? { variantes: avant.variantes, variantes_km: avant.variantes_km } : {}) };
    b.maj = p.date;
    sauver();
    return b.vehicules[p.plaque];
}
const releve = plaque => lire().vehicules[plaqueCle(plaque)] || null;
const tous = () => Object.values(lire().vehicules);

module.exports = { lire, enregistrer, releve, tous, nouvelleCle, cleValide, plaqueCle, FICHIER };
