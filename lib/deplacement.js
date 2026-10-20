// Coût du déplacement pour aller chercher une voiture : aller en train jusqu'au vendeur,
// retour au volant de la voiture achetée (carburant + péages).
// Distance routière réelle via OSRM (serveur public), coordonnées des communes via geo.api.gouv.fr.
// Sans réseau, repli sur la distance à vol d'oiseau × 1,3.

const cacheCP = new Map();
async function coordsCP(cp) {
    cp = String(cp || '').trim();
    if (!/^\d{5}$/.test(cp)) return null;
    if (cacheCP.has(cp)) return cacheCP.get(cp);
    try {
        const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${cp}&fields=nom,centre&format=json`, { signal: AbortSignal.timeout(6000) });
        const j = await r.json();
        const c = Array.isArray(j) && j[0] && j[0].centre && j[0].centre.coordinates;
        const v = c ? { lon: c[0], lat: c[1], nom: j[0].nom } : null;
        cacheCP.set(cp, v);
        return v;
    } catch (e) { return null; }
}

function volOiseau(a, b) {
    const r = Math.PI / 180, dla = (b.lat - a.lat) * r, dlo = (b.lon - a.lon) * r;
    return 2 * 6371 * Math.asin(Math.sqrt(Math.sin(dla / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlo / 2) ** 2));
}

async function itineraire(a, b) {
    try {
        const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`, { signal: AbortSignal.timeout(8000) });
        const j = await r.json();
        const x = j.routes && j.routes[0];
        if (x) return { km: Math.round(x.distance / 1000), minutes: Math.round(x.duration / 60), source: 'itinéraire routier' };
    } catch (e) { /* repli ci-dessous */ }
    const km = Math.round(volOiseau(a, b) * 1.3);
    return { km, minutes: Math.round(km / 80 * 60), source: 'estimation (vol d\'oiseau × 1,3)' };
}

// Énergie du véhicule d'après la fiche officielle, sinon le titre.
function energie(x) {
    const f = x.fiche_api || {};
    const t = `${f.energieNGC || f.energie_ngc || f.energie || f.carburant || ''} ${x.energie_siv || ''} ${x.carburant || ''} ${x.vehicule || ''}`.toLowerCase();
    if (/[ée]lectri|\bev\b|zoe|e-208|tesla/.test(t)) return 'electrique';
    if (/hybrid/.test(t)) return 'hybride';
    if (/diesel|gazole|gasoil|hdi|dci|tdi|crdi|bluehdi|cdti|jtd|d-4d/.test(t)) return 'diesel';
    return 'essence';
}

// r = réglages d'estimation (prix carburant, consommations, péages, train). trainIA = prix de billet trouvé par l'IA.
async function calculer(d, r, trainIA = 0) {
    const x = (d && d.data) || {};
    const [dep, arr] = await Promise.all([coordsCP(r.depart_cp), coordsCP(x.code_postal)]);
    if (!dep || !arr) return null;
    const it = await itineraire(dep, arr);
    const en = energie(x);
    const conso = { diesel: r.conso_diesel, essence: r.conso_essence, hybride: r.conso_hybride, electrique: 0 }[en];
    const carburant = en === 'electrique' ? Math.round(it.km / 100 * r.cout_electrique_100km) : Math.round(it.km / 100 * conso * (en === 'diesel' ? r.prix_gazole : r.prix_essence));
    // Péages : seulement au-delà d'un trajet local (en Île-de-France on rentre sans autoroute payante).
    const peages = it.km > r.peage_seuil_km ? Math.round(it.km * r.peage_eur_km) : 0;
    const local = it.km <= r.train_local_km;
    const trainFormule = local ? r.train_local_eur : Math.max(r.train_min, Math.round(it.km * r.train_eur_km));
    const train = Math.round(Number(trainIA) > 0 && !local ? Number(trainIA) : trainFormule);
    return {
        depart: dep.nom, arrivee: arr.nom, km: it.km, minutes: it.minutes, source_distance: it.source, energie: en,
        train, train_source: Number(trainIA) > 0 && !local ? 'prix relevé par l\'IA' : local ? 'transports d\'Île-de-France' : 'estimation au km',
        carburant, peages, total: train + carburant + peages
    };
}

module.exports = { calculer, coordsCP, energie };
