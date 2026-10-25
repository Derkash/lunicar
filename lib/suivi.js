/**
 * LUNICAR - Mesure interne du site : réception des événements (public/js/suivi.js),
 * stockage par tranche horaire dans les réglages (clé « suivi:AAAA-MM-JJTHH »), et
 * analyse pour l'onglet « Analyses » de l'admin (visites, canaux, entonnoir du
 * formulaire question par question, vitesse des pages, lecture, clics).
 *
 * Aucune donnée personnelle : pas d'adresse IP, pas de nom, identifiant de visite
 * aléatoire et éphémère. Les événements bruts sont gardés 120 jours.
 */
const fs = require('fs');
const path = require('path');
const store = require('./store');
const zones = require('./zones');
const idf = require('./idf');

const ROOT = path.join(__dirname, '..');
const readJSON = f => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf-8')); } catch (e) { return []; } };

// ---------------------------------------------------------------- Étapes du formulaire (ordre de lib/layout.js)
const ETAPES = [
    ['vehicule', 'Véhicule (marque, année, km)'], ['mecanique', 'État mécanique'], ['soucis', 'Organes en cause'], ['panne', 'Nature de la panne'],
    ['voyant', 'Voyant allumé'], ['carrosserie', 'Carrosserie'], ['degats', 'Défauts carrosserie'], ['ct', 'Contrôle technique'],
    ['historique', 'Clés, carnet, 1re main, crédit'], ['delai', 'Quand vendre'], ['achat', 'Projet d\'achat'], ['prix', 'Prix en tête'],
    ['identite', 'Prénom et nom'], ['contact', 'Téléphone et code postal'], ['titulaire', 'Titulaire de la carte grise'], ['certificat', 'N° de certificat'],
    ['fin', 'Message et e-mail'], ['envoi', 'Demande envoyée'], ['photos', 'Photos ajoutées']
];
const CONDITIONNELLES = new Set(['soucis', 'panne', 'voyant', 'degats']);
const ORDRE = Object.fromEntries(ETAPES.map(([k], i) => [k, i]));

// ---------------------------------------------------------------- Types de pages
let types = null;
function typePage(p) {
    if (!types) {
        const guides = readJSON('guides.json'), models = readJSON('models.json'), local = readJSON('local.json');
        types = {
            marque: new Set(guides.filter(g => g.brand).map(g => '/' + g.slug)),
            guide: new Set(guides.filter(g => !g.brand).map(g => '/' + g.slug)),
            modele: new Set(models.map(m => '/' + m.slug)),
            situation: new Set((idf.SITUATIONS || []).map(s => '/' + s.slug)),
            region: new Set([...Object.values(local.regions || {}).map(r => '/' + r.slug), '/' + idf.HUB_SLUG]),
            departement: new Set((idf.DEPARTMENTS || []).map(d => '/' + d.slug))
        };
    }
    if (p === '/') return 'accueil';
    if (p === '/reprise') return 'formulaire';
    if (p === '/reprise-auto-paris') return 'paris';
    if (p.startsWith('/reprise-auto-')) return 'ville';
    if (p.startsWith('/article/')) return 'article';
    if (p === '/articles') return 'conseils';
    if (p === '/comment-ca-marche') return 'methode';
    if (p === '/' + zones.FRANCE_SLUG) return 'france';
    for (const [t, set] of Object.entries(types)) if (set.has(p)) return t;
    if (/^\/rachat-voiture-.*-(\d\d|2a|2b)$/.test(p)) return 'departement';
    return 'autre';
}
const LIBELLE_TYPE = { accueil: 'Accueil', formulaire: 'Page estimation', paris: 'Paris', ville: 'Pages villes', region: 'Régions', departement: 'Départements', france: 'Partout en France', situation: 'Situations (panne, sans CT…)', guide: 'Guides', marque: 'Marques', modele: 'Modèles', article: 'Articles conseils', conseils: 'Liste des conseils', methode: 'Comment ça marche', autre: 'Autres pages' };
const LIBELLE_CANAL = { chatgpt: 'ChatGPT', perplexity: 'Perplexity', ia: 'Autres assistants IA', google: 'Google', bing: 'Bing', moteur: 'Autres moteurs', pub: 'Google Ads', reseaux: 'Réseaux sociaux', site: 'Autres sites', direct: 'Accès direct', interne: 'Interne' };
const LIBELLE_APPAREIL = { m: 'Mobile', t: 'Tablette', d: 'Ordinateur' };

// ---------------------------------------------------------------- Réception et stockage
const CHAMPS = {
    t: v => Number.isInteger(v) && v > 1.7e9 && v < 4e9, s: v => /^[a-z0-9]{6,12}$/.test(v), p: v => typeof v === 'string' && v.startsWith('/') && v.length <= 160,
    d: v => ['m', 't', 'd'].includes(v), e: v => ['page', 'debut', 'q', 'envoi', 'photos', 'plaque', 'clic', 'fin'].includes(v),
    r: v => typeof v === 'string' && v.length <= 80, c: v => v in LIBELLE_CANAL, w: v => Number.isInteger(v) && v >= 0 && v < 10000,
    q: v => v in ORDRE, dt: v => Number.isInteger(v) && v >= 0 && v <= 3600, k: v => typeof v === 'string' && v.length <= 40, n: v => Number.isInteger(v) && v >= 0 && v <= 30,
    lcp: v => Number.isInteger(v) && v >= 0 && v < 120000, cls: v => typeof v === 'number' && v >= 0 && v < 100, inp: v => Number.isInteger(v) && v >= 0 && v < 120000,
    ttfb: v => Number.isInteger(v) && v >= 0 && v < 120000, sc: v => Number.isInteger(v) && v >= 0 && v <= 100, dur: v => Number.isInteger(v) && v >= 0 && v <= 86400
};
function nettoyer(ev) {
    if (!ev || typeof ev !== 'object') return null;
    const o = {};
    for (const [k, ok] of Object.entries(CHAMPS)) if (ev[k] !== undefined && ok(ev[k])) o[k] = ev[k];
    if (!o.t || !o.s || !o.p || !o.e) return null;
    // Chemins de villes normalisés en minuscules, sans paramètres (déjà sans « ? » côté client).
    o.p = o.p.toLowerCase().replace(/\/+$/, '') || '/';
    return o;
}

const heureCle = t => { const d = new Date(t * 1000); const iso = d.toLocaleString('sv-SE', { timeZone: 'Europe/Paris', hour12: false }); return 'suivi:' + iso.slice(0, 10) + 'T' + iso.slice(11, 13); };
let tampon = [];
let ecriture = Promise.resolve();
function recevoir(corps) {
    let liste; try { liste = JSON.parse(corps); } catch (e) { return 0; }
    if (!Array.isArray(liste)) return 0;
    const ok = liste.slice(0, 20).map(nettoyer).filter(Boolean);
    tampon.push(...ok);
    return ok.length;
}
// Écriture groupée toutes les minutes : une tranche horaire = un réglage (quelques dizaines de Ko au plus).
async function vider() {
    if (!tampon.length) return;
    const lot = tampon; tampon = [];
    const parCle = new Map();
    lot.forEach(ev => { const k = heureCle(ev.t); if (!parCle.has(k)) parCle.set(k, []); parCle.get(k).push(ev); });
    ecriture = ecriture.then(async () => {
        for (const [cle, evs] of parCle) {
            try {
                const actuel = await store.lireReglage(cle, []);
                await store.ecrireReglage(cle, [...(Array.isArray(actuel) ? actuel : []), ...evs]);
            } catch (e) { console.error('Suivi : écriture', cle, e.message); tampon.push(...evs); }
        }
    }).catch(() => {});
    return ecriture;
}
setInterval(() => vider().catch(() => {}), 60 * 1000).unref();

// Purge hebdomadaire des tranches de plus de 120 jours.
async function purger() {
    const limite = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
    const cles = await store.listerReglages('suivi:');
    for (const c of cles) if (c.cle.slice(6, 16) < limite) await store.supprimerReglage(c.cle).catch(() => {});
}
setInterval(() => purger().catch(() => {}), 7 * 24 * 3600 * 1000).unref();

// ---------------------------------------------------------------- Analyse
const jourParis = t => new Date(t * 1000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
const mediane = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const p75 = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.75))]; };
const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : null;

const cache = new Map();
async function analyser(jours = 30) {
    jours = [7, 30, 90].includes(Number(jours)) ? Number(jours) : 30;
    const c = cache.get(jours);
    if (c && Date.now() - c.t < 5 * 60 * 1000) return c.v;
    await vider().catch(() => {});
    const auj = jourParis(Date.now() / 1000);
    const depuis = new Date(new Date(auj + 'T12:00:00Z').getTime() - (jours - 1) * 864e5).toISOString().slice(0, 10);
    const lignes = await store.listerReglages('suivi:');
    const evs = [];
    let premier = null;
    lignes.forEach(l => { const j = l.cle.slice(6, 16); if (!premier || j < premier) premier = j; if (j >= depuis && Array.isArray(l.valeur)) evs.push(...l.valeur); });
    evs.sort((a, b) => a.t - b.t);

    // Visites : un identifiant = une visite (durée de l'onglet).
    const visites = new Map();
    evs.forEach(ev => {
        let v = visites.get(ev.s);
        if (!v) { v = { s: ev.s, t0: ev.t, j: jourParis(ev.t), d: ev.d, c: null, entree: null, pages: [], etapes: new Map(), envoi: 0, photos: 0, clics: [], fins: [] }; visites.set(ev.s, v); }
        if (ev.e === 'page') { if (!v.entree) { v.entree = ev.p; v.c = ev.c || 'direct'; } v.pages.push(ev.p); if (!v.d) v.d = ev.d; }
        else if (ev.e === 'debut') { if (!v.etapes.has('vehicule')) v.etapes.set('vehicule', { t: ev.t, p: ev.p }); }
        else if (ev.e === 'q') { if (!v.etapes.has('vehicule')) v.etapes.set('vehicule', { t: ev.t, p: ev.p }); if (!v.etapes.has(ev.q)) v.etapes.set(ev.q, { t: ev.t, p: ev.p, dt: ev.dt }); }
        else if (ev.e === 'envoi') { v.envoi++; v.envoiT = ev.t; v.etapes.set('envoi', { t: ev.t, p: ev.p }); }
        else if (ev.e === 'photos') { v.photos++; v.etapes.set('photos', { t: ev.t, p: ev.p }); }
        else if (ev.e === 'clic') v.clics.push(ev.k);
        else if (ev.e === 'fin') v.fins.push(ev);
    });
    const V = [...visites.values()].filter(v => v.pages.length || v.etapes.size);
    V.forEach(v => { if (!v.c) v.c = 'direct'; if (!v.entree) v.entree = (v.etapes.get('vehicule') || {}).p || '/'; v.type = typePage(v.entree); });
    const n = V.length;
    const pagesVues = V.reduce((t, v) => t + v.pages.length, 0);
    const envois = V.filter(v => v.envoi).length;
    const durees = V.map(v => v.fins.reduce((t, f) => t + (f.dur || 0), 0)).filter(x => x > 0);

    const groupe = (cle, libelles) => {
        const m = new Map();
        V.forEach(v => { const k = cle(v); if (!m.has(k)) m.set(k, { k, libelle: libelles ? (libelles[k] || k) : k, visites: 0, envois: 0, debuts: 0, pages: 0, rebonds: 0 }); const g = m.get(k); g.visites++; g.pages += v.pages.length; if (v.envoi) g.envois++; if (v.etapes.size) g.debuts++; if (v.pages.length <= 1 && !v.etapes.size) g.rebonds++; });
        return [...m.values()].map(g => ({ ...g, taux: pct(g.envois, g.visites), taux_debut: pct(g.debuts, g.visites), rebond: pct(g.rebonds, g.visites) })).sort((a, b) => b.visites - a.visites);
    };
    const canaux = groupe(v => v.c, LIBELLE_CANAL);
    const appareils = groupe(v => v.d || 'd', LIBELLE_APPAREIL);
    const typesEntree = groupe(v => v.type, LIBELLE_TYPE);
    const entrees = groupe(v => v.entree).slice(0, 15);

    // Par jour
    const parJour = new Map();
    for (let i = 0; i < jours; i++) { const j = new Date(new Date(depuis + 'T12:00:00Z').getTime() + i * 864e5).toISOString().slice(0, 10); if (j <= auj) parJour.set(j, { j, visites: 0, envois: 0, chatgpt: 0 }); }
    V.forEach(v => { const g = parJour.get(v.j); if (g) { g.visites++; if (v.envoi) g.envois++; if (['chatgpt', 'perplexity', 'ia'].includes(v.c)) g.chatgpt++; } });

    // Entonnoir du formulaire
    const demarre = V.filter(v => v.etapes.size);
    const etapes = ETAPES.map(([k, libelle]) => {
        const atteint = demarre.filter(v => v.etapes.has(k));
        // Abandon : dernière étape vue, sans envoi (pour « envoi » et « photos » : pas de notion d'abandon).
        const abandons = ['envoi', 'photos'].includes(k) ? [] : atteint.filter(v => !v.envoi && [...v.etapes.keys()].every(e => ORDRE[e] <= ORDRE[k]));
        // Temps passé sur l'étape = délai jusqu'à l'étape suivante atteinte.
        const temps = [];
        atteint.forEach(v => { const t = v.etapes.get(k).t; const suiv = [...v.etapes.values()].map(e => e.t).filter(x => x > t).sort((a, b) => a - b)[0]; if (suiv) temps.push(suiv - t); });
        return { k, libelle, conditionnelle: CONDITIONNELLES.has(k), atteint: atteint.length, abandons: abandons.length, abandon_pct: pct(abandons.length, atteint.length), temps_median: mediane(temps), mobile: atteint.filter(v => v.d === 'm').length };
    });
    const dureeForm = demarre.filter(v => v.envoi && v.envoiT).map(v => v.envoiT - v.etapes.get('vehicule').t).filter(x => x > 0 && x < 3600);
    const entonnoir = {
        demarre: demarre.length, envoyes: envois, taux: pct(envois, demarre.length), duree_mediane: mediane(dureeForm),
        par_appareil: ['m', 't', 'd'].map(d => { const x = demarre.filter(v => v.d === d); return { k: d, libelle: LIBELLE_APPAREIL[d], demarre: x.length, envoyes: x.filter(v => v.envoi).length, taux: pct(x.filter(v => v.envoi).length, x.length) }; }).filter(x => x.demarre),
        etapes, plaque: V.filter(v => v.etapes.size && evs.some(e => e.s === v.s && e.e === 'plaque')).length
    };

    // Vitesse des pages (p75 comme Google) par type et par appareil
    const fins = [];
    V.forEach(v => v.fins.forEach(f => fins.push({ ...f, type: typePage(f.p), d: v.d })));
    const perf = liste => ({ n: liste.length, lcp: p75(liste.map(f => f.lcp).filter(Boolean)), cls: liste.length ? Math.round((p75(liste.map(f => f.cls || 0)) || 0) * 1000) / 1000 : null, inp: p75(liste.map(f => f.inp).filter(Boolean)), ttfb: p75(liste.map(f => f.ttfb).filter(Boolean)), scroll: mediane(liste.map(f => f.sc).filter(x => x != null)), duree: mediane(liste.map(f => f.dur).filter(Boolean)) });
    const perfTypes = [...new Set(fins.map(f => f.type))].map(t => ({ k: t, libelle: LIBELLE_TYPE[t] || t, ...perf(fins.filter(f => f.type === t)) })).sort((a, b) => b.n - a.n);
    const perfAppareils = ['m', 't', 'd'].map(d => ({ k: d, libelle: LIBELLE_APPAREIL[d], ...perf(fins.filter(f => f.d === d)) })).filter(x => x.n);
    const scrollTranches = [[0, 25, 'Moins d\'un quart'], [25, 50, 'Un quart à la moitié'], [50, 75, 'La moitié aux trois quarts'], [75, 101, 'Jusqu\'en bas']].map(([a, b, l]) => ({ libelle: l, n: fins.filter(f => f.sc != null && f.sc >= a && f.sc < b).length }));
    const clics = (() => { const m = new Map(); V.forEach(v => v.clics.forEach(k => m.set(k, (m.get(k) || 0) + 1))); return [...m].map(([k, n]) => ({ k, libelle: { tel: 'Appel téléphonique', whatsapp: 'WhatsApp', estimation: 'Bouton « estimer »', formulaire: 'Page estimation' }[k] || k.replace(/^contact_/, 'Contact : '), n })).sort((a, b) => b.n - a.n); })();

    // Ce qu'il faut retenir : règles simples, chiffrées, sans jargon.
    const retenir = [];
    if (n < 30) retenir.push(`Encore peu de visites mesurées (${n}) : les pourcentages se stabiliseront avec quelques jours de plus.`);
    const pires = etapes.filter(e => e.atteint >= 15 && e.abandon_pct >= 20 && !['envoi', 'photos'].includes(e.k)).sort((a, b) => b.abandon_pct - a.abandon_pct);
    if (pires.length) retenir.push(`L'étape « ${pires[0].libelle} » fait perdre ${pires[0].abandon_pct} % des vendeurs qui l'atteignent (${pires[0].abandons} sur ${pires[0].atteint}) : c'est la première à simplifier.`);
    if (entonnoir.demarre >= 20) retenir.push(`${entonnoir.taux} % des vendeurs qui commencent le formulaire l'envoient${entonnoir.duree_mediane ? `, en ${Math.round(entonnoir.duree_mediane / 60)} min ${entonnoir.duree_mediane % 60} s en médiane` : ''}.`);
    const mob = entonnoir.par_appareil.find(x => x.k === 'm'), ord = entonnoir.par_appareil.find(x => x.k === 'd');
    if (mob && ord && mob.demarre >= 15 && ord.demarre >= 15 && Math.abs(mob.taux - ord.taux) >= 10) retenir.push(`Sur mobile, ${mob.taux} % des formulaires commencés sont envoyés, contre ${ord.taux} % sur ordinateur : ${mob.taux < ord.taux ? 'le parcours mobile est à revoir en priorité' : 'le mobile convertit mieux'}.`);
    const bons = canaux.filter(c => c.visites >= 15 && c.taux != null).sort((a, b) => b.taux - a.taux);
    if (bons.length >= 2) retenir.push(`Le canal qui convertit le mieux est ${bons[0].libelle} (${bons[0].taux} % des visites deviennent une demande), le moins bien ${bons[bons.length - 1].libelle} (${bons[bons.length - 1].taux} %).`);
    const lents = perfTypes.filter(t => t.n >= 10 && t.lcp > 2500);
    if (lents.length) retenir.push(`${lents.map(t => t.libelle).join(', ')} : affichage principal en plus de 2,5 s pour un visiteur sur quatre (LCP p75 ${lents.map(t => Math.round(t.lcp / 100) / 10 + ' s').join(', ')}), au-dessus du seuil de Google.`);
    const mobPerf = perfAppareils.find(x => x.k === 'm');
    if (mobPerf && mobPerf.n >= 10 && mobPerf.inp > 200) retenir.push(`Sur mobile, la réponse aux touches dépasse 200 ms pour un visiteur sur quatre (INP p75 ${mobPerf.inp} ms) : du travail JavaScript à alléger.`);
    const villes = typesEntree.find(t => t.k === 'ville');
    if (villes && villes.visites >= 20 && villes.rebond >= 70) retenir.push(`${villes.rebond} % des visiteurs arrivés sur une page ville repartent sans rien faire : renforcer l'accroche et le formulaire en haut de ces pages.`);
    const ia = canaux.filter(c => ['chatgpt', 'perplexity', 'ia'].includes(c.k)).reduce((t, c) => t + c.visites, 0);
    if (n >= 20) retenir.push(`${pct(ia, n)} % des visites viennent de ChatGPT et des assistants IA, ${pct((canaux.find(c => c.k === 'google') || {}).visites || 0, n)} % de Google.`);

    const v = {
        periode: { jours, depuis, jusqu: auj, premier_jour: premier, genere: new Date().toISOString() },
        resume: { visites: n, pages_vues: pagesVues, pages_par_visite: n ? Math.round(pagesVues / n * 10) / 10 : null, demandes: envois, taux: pct(envois, n), rebond: pct(V.filter(v => v.pages.length <= 1 && !v.etapes.size).length, n), mobile_pct: pct(V.filter(v => v.d === 'm').length, n), duree_mediane: mediane(durees), ia_pct: pct(ia, n) },
        jours: [...parJour.values()], canaux, appareils, types: typesEntree, entrees, entonnoir,
        perf: { types: perfTypes, appareils: perfAppareils, seuils: { lcp: [2500, 4000], cls: [0.1, 0.25], inp: [200, 500], ttfb: [800, 1800] } },
        engagement: { scroll: scrollTranches, clics, duree_par_type: perfTypes.map(t => ({ k: t.k, libelle: t.libelle, duree: t.duree, scroll: t.scroll, n: t.n })) },
        retenir
    };
    cache.set(jours, { t: Date.now(), v });
    return v;
}

module.exports = { recevoir, vider, analyser, ETAPES, typePage };
