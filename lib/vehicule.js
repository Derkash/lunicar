/**
 * LUNICAR - Fiche véhicule à partir de la plaque.
 *
 * 1. Toujours : le décodeur maison (public/js/plaque.js), gratuit et illimité,
 *    qui date la plaque.
 * 2. En option : une API payante pour les caractéristiques techniques
 *    (marque, modèle, version, énergie, puissance, boîte, 1re mise en circulation).
 *    Active seulement si PLAQUE_API_KEY est défini, et plafonnée par
 *    PLAQUE_API_QUOTA appels par mois.
 *
 *    Fournisseurs (PLAQUE_API_PROVIDER) :
 *    - "apiplaque" (par défaut) : apiplaqueimmatriculation.com,
 *      POST https://api.apiplaqueimmatriculation.com/plaque?immatriculation=…&token=…&pays=FR
 *    - "rapidapi" : API SIV hébergée sur RapidAPI (PLAQUE_API_HOST).
 *
 * Règle SIV (guide ministériel de réutilisation, §5.2) : sans licence propre,
 * les données SIV ne doivent pas être stockées en base. On ne les garde qu'en
 * mémoire, le temps de la demande, et on ne recopie dans le dossier que ce que
 * le vendeur a lui-même validé dans le formulaire.
 */

const plaque = require('../public/js/plaque');

const API_KEY = process.env.PLAQUE_API_KEY || '';
const PROVIDER = (process.env.PLAQUE_API_PROVIDER || 'apiplaque').toLowerCase();
const API_HOST = process.env.PLAQUE_API_HOST || 'api-plaque-immatriculation-siv.p.rapidapi.com';
const QUOTA = parseInt(process.env.PLAQUE_API_QUOTA || '300', 10);

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
        version: trouver(json, ['version', 'sracommercial', 'finition', 'variant', 'description']),
        energie: trouver(json, ['energiengc', 'energie', 'energy', 'fuel', 'fueltype', 'carburant']),
        puissanceFiscale: trouver(json, ['puisfisc', 'puissancefiscale', 'cvfiscaux', 'fiscalpower', 'puissancefisc']),
        puissanceCh: trouver(json, ['puisfiscreelch', 'puissancedyn', 'puissancech', 'horsepower', 'power', 'puissance']),
        boite: trouver(json, ['boitevitesse', 'boite', 'gearbox', 'transmission']),
        couleur: trouver(json, ['couleur', 'color', 'colour']),
        miseEnCirculation: trouver(json, ['date1ercirfr', 'date1ercir', 'datemiseencirculation', 'date1mec', 'dateimmatriculation', 'firstregistration', 'registrationdate', 'date1erecirculation', 'date1ercirus'])
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
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
        const res = PROVIDER === 'rapidapi'
            ? await fetch(`https://${API_HOST}/get-vehicule-info?immatriculation=${encodeURIComponent(p)}`,
                { headers: { 'x-rapidapi-key': API_KEY, 'x-rapidapi-host': API_HOST }, signal: ctrl.signal })
            : await fetch(`https://api.apiplaqueimmatriculation.com/plaque?immatriculation=${encodeURIComponent(p)}&token=${encodeURIComponent(API_KEY)}&pays=FR`,
                { method: 'POST', headers: { Accept: 'application/json' }, signal: ctrl.signal });
        if (!res.ok) { console.log(`ℹ️  API plaque : HTTP ${res.status}`); return null; }
        const json = await res.json();
        const erreur = trouver(json, ['erreur', 'error', 'message']);
        if (erreur && !trouver(json, ['marque', 'make'])) { console.log('ℹ️  API plaque : réponse en erreur :', erreur.slice(0, 120)); return null; }
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

module.exports = { rechercher, analyser: plaque.analyser, apiActive: () => !!API_KEY, quotaRestant, normaliserReponse };
