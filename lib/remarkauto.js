// Passerelle vers la place de marché pro : chaque véhicule acheté (statut stock,
// préparation ou en vente dans « Nos véhicules ») est créé en brouillon côté
// remarkauto, où la fiche est ensuite complétée (photos floutées, essai, vidéo).
// Configuration : REMARKAUTO_URL + REMARKAUTO_IMPORT_TOKEN (groupe d'environnement
// Render partagé avec le service remarkauto). Sans ces variables : inactif.
const store = require('./store');
const compta = require('./compta');

const URL = (process.env.REMARKAUTO_URL || '').replace(/\/$/, '');
const TOKEN = process.env.REMARKAUTO_IMPORT_TOKEN || '';
const STATUTS = ['stock', 'preparation', 'en_vente'];
const MARQUES_2_MOTS = ['land rover', 'alfa romeo', 'aston martin', 'rolls royce', 'ds automobiles', 'mg rover'];

const actif = () => Boolean(URL && TOKEN);

// « Ford Fiesta 2016 » → { marque: 'Ford', modele: 'Fiesta' } ; l'année est lue à part.
function decouper(libelle) {
    const mots = String(libelle || '').replace(/\b(19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!mots.length) return null;
    const deux = (mots[0] + ' ' + (mots[1] || '')).toLowerCase();
    const n = MARQUES_2_MOTS.includes(deux) ? 2 : 1;
    const marque = mots.slice(0, n).join(' ').replace(/^mercedes$/i, 'Mercedes-Benz').replace(/^citroen$/i, 'Citroën');
    const modele = mots.slice(n).join(' ') || 'Modèle à préciser';
    return { marque: marque.charAt(0).toUpperCase() + marque.slice(1), modele };
}

function charge(v) {
    const d = decouper(v.libelle);
    if (!d) return null;
    const annee = Number(String(v.annee || '').match(/(19|20)\d{2}/)?.[0]) || null;
    const km = Number(String(v.kilometrage || '').replace(/[^\d]/g, '')) || null;
    return {
        source: 'lunicar', source_id: v.id, immat: v.plaque || undefined,
        vehicule: {
            marque: d.marque, modele: d.modele,
            mise_circulation: annee ? String(annee) : null, annee_construction: annee, km: km ?? 0,
            vin: v.vin ? String(v.vin).toUpperCase() : null,
            lieu_ville: 'Neuilly-sur-Marne', lieu_cp: '93330', pays_origine: 'FR', pays_derniere_immat: 'FR',
        },
    };
}

async function pousser(v) {
    const corps = charge(v);
    if (!corps) return null;
    const r = await fetch(`${URL}/api/admin/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-import-token': TOKEN }, body: JSON.stringify(corps) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.erreur || `HTTP ${r.status}`);
    return d;
}

let enCours = false;
// Crée côté remarkauto les véhicules achetés qui n'y sont pas encore ; mémorise les
// correspondances dans le réglage « remarkauto_sync » (id Lunicar → id remarkauto).
async function synchroniser() {
    if (!actif() || enCours) return;
    enCours = true;
    try {
        const { vehicules } = await compta.tout();
        const lien = await store.lireReglage('remarkauto_sync', {});
        let n = 0;
        for (const v of vehicules.filter(x => STATUTS.includes(x.statut) && !lien[x.id])) {
            try {
                const d = await pousser(v);
                if (d) { lien[v.id] = d.id; n++; }
            } catch (e) { console.log(`remarkauto (${v.libelle}) :`, e.message); }
        }
        if (n) { await store.ecrireReglage('remarkauto_sync', lien); console.log(`remarkauto : ${n} brouillon(s) créé(s)`); }
    } finally { enCours = false; }
}

let minuterie = null;
// Déclenchement différé après une écriture (achat, changement de statut).
function planifier(delai = 3000) {
    if (!actif()) return;
    clearTimeout(minuterie);
    minuterie = setTimeout(() => synchroniser().catch(e => console.log('remarkauto :', e.message)), delai);
    if (minuterie.unref) minuterie.unref();
}

function demarrer() {
    if (!actif()) { console.log('remarkauto : passerelle inactive (REMARKAUTO_URL / REMARKAUTO_IMPORT_TOKEN absents)'); return; }
    planifier(15000);
    setInterval(() => synchroniser().catch(e => console.log('remarkauto :', e.message)), 5 * 60 * 1000).unref();
}

module.exports = { demarrer, planifier, synchroniser, decouper };
