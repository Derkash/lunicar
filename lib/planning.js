// Assistant de planification des rendez-vous : c'est Youssouf qui se déplace, au départ du point de départ des
// réglages d'estimation. Pour une nouvelle visite, on cherche le meilleur jour des prochaines semaines en
// privilégiant les jours où une visite est déjà prévue à moins de 150 km, ou sur la route aller/retour,
// plutôt qu'un jour vide. Distances par la route estimées (vol d'oiseau × 1,3, ~70 km/h en moyenne).
const store = require('./store');
const { coordsCP } = require('./deplacement');
const estimation = require('./estimation');

const PROCHE_KM = 150, MAX_VISITES = 3, VITESSE = 70, HORIZON = 21;
const route = (a, b) => {
    const r = Math.PI / 180, dla = (b.lat - a.lat) * r, dlo = (b.lon - a.lon) * r;
    return Math.round(2 * 6371 * Math.asin(Math.sqrt(Math.sin(dla / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlo / 2) ** 2)) * 1.3);
};
const minutes = km => Math.round(km / VITESSE * 60);
const cpDe = d => { const r = (d.suivi || {}).rdv || {}, m = String(r.lieu || '').match(/\b\d{5}\b/); return m ? m[0] : (d.data || {}).code_postal; };
const iso = t => t.toISOString().slice(0, 10);
const hm = m => { m = Math.max(8 * 60, Math.min(19 * 60, Math.round(m / 15) * 15)); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const enMin = h => { const [a, b] = String(h || '14:00').split(':').map(Number); return a * 60 + (b || 0); };
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

async function suggerer(ref, { jours = HORIZON } = {}) {
    const r = await estimation.reglages();
    const liste = await store.listerDemandes(), cible = liste.find(d => d.ref === ref);
    if (!cible) throw new Error('Demande introuvable');
    const [base, T] = await Promise.all([coordsCP(r.depart_cp), coordsCP(cpDe(cible))]);
    if (!base) throw new Error('Point de départ inconnu (réglages d\'estimation)');
    if (!T) throw new Error('Code postal du vendeur inconnu : impossible de calculer les trajets');
    const kmBase = route(base, T);
    // Rendez-vous déjà prévus (autres demandes), regroupés par jour.
    const auj = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }) + 'T12:00:00Z');
    const fin = iso(new Date(auj.getTime() + jours * 864e5));
    const parJour = {};
    for (const d of liste) {
        const v = (d.suivi || {}).rdv;
        if (d.ref === ref || !v || v.statut !== 'prevu' || v.date <= iso(auj) || v.date > fin) continue;
        const c = await coordsCP(cpDe(d)); if (!c) continue;
        (parJour[v.date] = parJour[v.date] || []).push({ ref: d.ref, heure: v.heure, duree: v.duree || 45, ville: c.nom, c, vehicule: (d.data || {}).vehicule || '' });
    }
    const out = [];
    for (let i = 1; i <= jours; i++) {
        const t = new Date(auj.getTime() + i * 864e5), date = iso(t), js = t.getUTCDay();
        if (js === 0) continue;                                  // pas le dimanche
        const deja = (parJour[date] || []).sort((a, b) => a.heure.localeCompare(b.heure));
        const base0 = { date, jour: JOURS[js], visites: deja.map(v => ({ ref: v.ref, heure: v.heure, ville: v.ville, vehicule: v.vehicule })) };
        if (!deja.length) { out.push({ ...base0, type: 'libre', score: 40 + i, km_total: kmBase * 2, heure: '10:00', motif: `Jour libre · ${kmBase} km depuis le départ` }); continue; }
        if (deja.length >= MAX_VISITES) continue;
        // Meilleure visite à laquelle se greffer : proche (< 150 km) ou sur la route (détour faible).
        let best = null;
        for (const v of deja) {
            const kmV = route(T, v.c), kmBV = route(base, v.c);
            const detour = kmBase + kmV - kmBV;                  // aller par le nouveau vendeur puis l'ancien (ou l'inverse au retour)
            const surRoute = detour <= Math.max(30, kmBV * 0.25);
            if (kmV > PROCHE_KM && !surRoute) continue;
            const g = { v, kmV, kmBV, detour, surRoute };
            if (!best || detour < best.detour) best = g;
        }
        if (!best) {
            const pres = Math.min(...deja.map(v => route(T, v.c)));
            out.push({ ...base0, type: 'loin', score: 200 + i, km_total: kmBase * 2, heure: '10:00', motif: `Déjà une visite à ${pres} km : pas combinable` });
            continue;
        }
        // Avant ou après la visite existante : avant si le nouveau vendeur est plus près du départ (on le voit à l'aller).
        const { v, kmV, kmBV, detour, surRoute } = best;
        let avant = kmBase <= kmBV;
        const trajet = minutes(kmV);
        let h = avant ? enMin(v.heure) - trajet - 45 : enMin(v.heure) + v.duree + trajet;
        // Si l'horaire sort de la journée, on passe de l'autre côté.
        if (h < 8 * 60 || h > 19 * 60) { avant = !avant; h = avant ? enMin(v.heure) - trajet - 45 : enMin(v.heure) + v.duree + trajet; }
        const libelle = surRoute ? `${avant ? 'Avant' : 'Après'} la visite de ${v.ville} (${v.heure.replace(':', ' h ')}) · détour ${Math.max(0, detour)} km` : `${avant ? 'Avant' : 'Après'} la visite de ${v.ville} (${v.heure.replace(':', ' h ')}), à ${kmV} km`;
        out.push({ ...base0, type: surRoute ? 'route' : 'proche', score: (surRoute ? 0 : 10) + Math.max(0, detour) / 15 + i * 0.6, km_total: kmBV * 2 + Math.max(0, detour), km_gagnes: kmBase * 2 - Math.max(0, detour), heure: hm(h), ordre: avant ? 'avant' : 'apres', avec_ref: v.ref, motif: libelle });
    }
    out.sort((a, b) => a.score - b.score);
    return { cible: { ref, ville: T.nom, km_depart: kmBase, minutes_depart: minutes(kmBase) }, depart: base.nom, suggestions: out.slice(0, 8) };
}

module.exports = { suggerer };
