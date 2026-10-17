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
const QUOTA = parseInt(process.env.PLAQUE_API_QUOTA || '380', 10);
// Le compteur vit en mémoire et repart à zéro à chaque déploiement : un plafond
// journalier empêche de dépasser le forfait même avec plusieurs mises en ligne.
const QUOTA_JOUR = parseInt(process.env.PLAQUE_API_QUOTA_JOUR || '20', 10);

// Mémoire courte : évite de payer deux fois la même plaque dans la même journée.
const cache = new Map();
const CACHE_MS = 24 * 60 * 60 * 1000;
let mois = '';
let appels = 0;
let jour = '';
let appelsJour = 0;

function quotaRestant() {
    const d = new Date().toISOString().slice(0, 10);
    if (d.slice(0, 7) !== mois) { mois = d.slice(0, 7); appels = 0; }
    if (d !== jour) { jour = d; appelsJour = 0; }
    return Math.max(0, Math.min(QUOTA - appels, QUOTA_JOUR - appelsJour));
}

// Les fournisseurs ne nomment pas leurs champs de la même façon : on cherche
// la première clé connue, à n'importe quel niveau de la réponse.
// On ne descend que dans les objets (jamais dans les listes) et pas dans les listes de véhicules
// « compatibles » (TecDoc, SRA) : elles contiennent d'autres motorisations (une Mégane essence devenait « dCi »).
const IGNORES = /compatible|liste|tecdoc|sra|variantes|versions/i;
function trouver(obj, cles) {
    const stack = [obj];
    while (stack.length) {
        const o = stack.pop();
        if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
        // Les clés sont essayées dans l'ordre de la liste : la première est la préférée.
        const norm = new Map(Object.entries(o).map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9]/g, ''), v]));
        for (const c of cles) {
            const v = norm.get(c);
            if (v !== undefined && v !== null && v !== '' && typeof v !== 'object') return String(v).trim();
        }
        for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object' && !Array.isArray(v) && !IGNORES.test(k)) stack.push(v);
    }
    return '';
}

function normaliserReponse(json) {
    const fiche = {
        marque: trouver(json, ['marque', 'make', 'brand']),
        modele: trouver(json, ['modeleen', 'modele', 'model', 'modelname']).replace(/\s*\(.*\)\s*$/, ''),
        version: trouver(json, ['version', 'sracommercial', 'finition', 'variant', 'description']),
        energie: trouver(json, ['energiengc', 'energie', 'energy', 'fuel', 'fueltype', 'carburant']),
        puissanceFiscale: trouver(json, ['puisfisc', 'puissancefiscale', 'cvfiscaux', 'fiscalpower', 'puissancefisc']),
        puissanceCh: trouver(json, ['puisfiscreelch', 'puissancedyn', 'puissancech', 'horsepower', 'power', 'puissance']),
        boite: trouver(json, ['boitevitesse', 'boite', 'gearbox', 'transmission']),
        couleur: trouver(json, ['couleur', 'color', 'colour']),
        miseEnCirculation: trouver(json, ['date1ercirfr', 'date1ercir', 'datemiseencirculation', 'date1mec', 'dateimmatriculation', 'firstregistration', 'registrationdate', 'date1erecirculation', 'date1ercirus'])
    };
    // Boîte en une lettre chez certains fournisseurs (M / A).
    fiche.boite = { M: 'Manuelle', A: 'Automatique' }[fiche.boite.toUpperCase()] || fiche.boite;
    const m = /(\d{4})/.exec(fiche.miseEnCirculation);
    fiche.annee = m ? m[1] : '';
    return fiche.marque || fiche.modele ? fiche : null;
}

// Renvoie { fiche, brut } : fiche normalisée pour le formulaire, réponse brute pour l'e-mail.
async function interroger(p) {
    const hit = cache.get(p);
    if (hit && Date.now() - hit.t < CACHE_MS) return hit;
    if (!API_KEY || quotaRestant() <= 0) return null;
    appels++;
    appelsJour++;
    const ctrl = new AbortController();
    // Le fournisseur répond parfois en plus de 10 s : on attend jusqu'à 20 s.
    const timer = setTimeout(() => ctrl.abort(), 20000);
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
        const entree = { t: Date.now(), fiche, brut: (json && json.data) || json };
        cache.set(p, entree);
        return entree;
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
    const r = analyse.format === 'siv' || analyse.format === 'fni' ? await interroger(analyse.plaque) : null;
    return { ...analyse, fiche: r ? r.fiche : null };
}

// Réponse complète de l'API pour l'e-mail de demande (cache 24 h, sinon un appel).
async function ficheComplete(saisie) {
    const analyse = plaque.analyser(saisie || '');
    if (analyse.format !== 'siv' && analyse.format !== 'fni') return null;
    const r = await interroger(analyse.plaque);
    return r && r.fiche ? r.brut : null;
}

// Pour l'admin : fiche normalisée + réponse brute en un appel (cache 24 h).
async function ficheAdmin(saisie) {
    const analyse = plaque.analyser(saisie || '');
    if (analyse.format !== 'siv' && analyse.format !== 'fni') return { erreur: 'Plaque au format inconnu' };
    if (!API_KEY) return { erreur: 'PLAQUE_API_KEY non défini sur le serveur' };
    if (quotaRestant() <= 0 && !cache.get(analyse.plaque)) return { erreur: 'Quota de l\'API plaque atteint pour aujourd\'hui ou ce mois-ci' };
    const r = await interroger(analyse.plaque);
    if (!r || !r.fiche) return { erreur: 'Plaque introuvable chez le fournisseur' };
    return { fiche: r.fiche, brut: r.brut, quota: quotaRestant() };
}

module.exports = { ficheAdmin, rechercher, ficheComplete, analyser: plaque.analyser, apiActive: () => !!API_KEY, quotaRestant, normaliserReponse };
