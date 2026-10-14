/**
 * LUNICAR - Fiche véhicule à partir de la plaque.
 *
 * 1. Toujours : le décodeur maison (public/js/plaque.js), gratuit et illimité,
 *    qui date la plaque.
 * 2. En option : une API licenciée SIV pour les caractéristiques techniques
 *    (marque, modèle, énergie, puissance, date de 1re mise en circulation).
 *    Active seulement si PLAQUE_API_KEY est défini, et plafonnée par
 *    PLAQUE_API_QUOTA appels par mois (10 par défaut = palier gratuit).
 *
 * Règle SIV (guide ministériel de réutilisation, §5.2) : sans licence propre,
 * les données SIV ne doivent pas être stockées en base. On ne les garde qu'en
 * mémoire, le temps de la demande, et on ne recopie dans le dossier que ce que
 * le vendeur a lui-même validé dans le formulaire.
 */

const plaque = require('../public/js/plaque');

const API_KEY = process.env.PLAQUE_API_KEY || '';
const API_HOST = process.env.PLAQUE_API_HOST || 'api-plaque-immatriculation-siv.p.rapidapi.com';
const QUOTA = parseInt(process.env.PLAQUE_API_QUOTA || '10', 10);

// Mémoire courte : évite de payer deux fois la même plaque dans la même journée.
const cache = new Map();
const CACHE_MS = 24 * 60 * 60 * 1000;
let mois = '';
let appels = 0;

function quotaRestant() {
    const m = new Date().toISOString().slice(0, 7);
    if (m !== mois) { mois = m; appels = 0; }
    return Math.max(0, QUOTA - appels);
}

// Les fournisseurs ne nomment pas leurs champs de la même façon : on cherche
// la première clé connue, à n'importe quel niveau de la réponse.
function trouver(obj, cles) {
    const stack = [obj];
    while (stack.length) {
        const o = stack.pop();
        if (!o || typeof o !== 'object') continue;
        for (const [k, v] of Object.entries(o)) {
            const kn = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cles.includes(kn) && v !== null && v !== '' && typeof v !== 'object') return String(v).trim();
            if (v && typeof v === 'object') stack.push(v);
        }
    }
    return '';
}

function normaliserReponse(json) {
    const fiche = {
        marque: trouver(json, ['marque', 'make', 'brand']),
        modele: trouver(json, ['modele', 'model', 'modelname']),
        version: trouver(json, ['version', 'finition', 'variant', 'description']),
        energie: trouver(json, ['energie', 'energy', 'fuel', 'fueltype', 'carburant']),
        puissanceFiscale: trouver(json, ['puissancefiscale', 'puisfisc', 'cvfiscaux', 'fiscalpower', 'puissancefisc']),
        puissanceCh: trouver(json, ['puissancedyn', 'puissancech', 'horsepower', 'power', 'puissance']),
        boite: trouver(json, ['boitevitesse', 'boite', 'gearbox', 'transmission']),
        miseEnCirculation: trouver(json, ['date1ercir', 'datemiseencirculation', 'date1mec', 'dateimmatriculation', 'firstregistration', 'registrationdate', 'date1erecirculation'])
    };
    const m = /(\d{4})/.exec(fiche.miseEnCirculation);
    fiche.annee = m ? m[1] : '';
    return fiche.marque || fiche.modele ? fiche : null;
}

async function interrogerApi(p) {
    if (!API_KEY || quotaRestant() <= 0) return null;
    const hit = cache.get(p);
    if (hit && Date.now() - hit.t < CACHE_MS) return hit.fiche;
    appels++;
    const url = `https://${API_HOST}/get-vehicule-info?immatriculation=${encodeURIComponent(p)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
        const res = await fetch(url, { headers: { 'x-rapidapi-key': API_KEY, 'x-rapidapi-host': API_HOST }, signal: ctrl.signal });
        if (!res.ok) { console.log(`ℹ️  API plaque : HTTP ${res.status}`); return null; }
        const json = await res.json();
        const fiche = normaliserReponse(json);
        if (!fiche) console.log('ℹ️  API plaque : réponse non reconnue, clés =', Object.keys(json || {}).join(', '));
        cache.set(p, { t: Date.now(), fiche });
        return fiche;
    } catch (e) {
        console.log('ℹ️  API plaque indisponible :', e.message);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of cache) if (now - v.t > CACHE_MS) cache.delete(k);
}, 60 * 60 * 1000).unref();

async function rechercher(saisie) {
    const analyse = plaque.analyser(saisie);
    const fiche = analyse.format === 'siv' || analyse.format === 'fni' ? await interrogerApi(analyse.plaque) : null;
    return { ...analyse, fiche };
}

module.exports = { rechercher, analyser: plaque.analyser, apiActive: () => !!API_KEY, quotaRestant };
