// Stockage des demandes, messages, réglages et photos de l'espace admin.
// Production : Supabase (Postgres + bucket privé « demandes »), car le disque de Render est effacé
// à chaque déploiement. Sans SUPABASE_URL / SUPABASE_SERVICE_KEY : fichiers locaux (développement).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET || 'demandes';
const distant = !!(SB_URL && SB_KEY);
const disque = !distant && !!process.env.DATA_DIR;

const refDe = id => String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
// Un dossier lisible par demande : 2026-10-17_AB12CD34_peugeot-308
const nomDossier = (ref, date, vehicule) => [String(date || new Date().toISOString()).slice(0, 10), ref, slug(vehicule) || 'vehicule'].join('_');

// ---------------------------------------------------------------- Supabase
async function sb(p, { method = 'GET', body, headers = {}, raw = false } = {}) {
    const res = await fetch(`${SB_URL}${p}`, {
        method,
        headers: {
            apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
            ...(body !== undefined && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}),
            ...headers
        },
        body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Supabase ${method} ${p.split('?')[0]} : ${res.status} ${(await res.text()).slice(0, 300)}`);
    if (raw) return res;
    const t = await res.text();
    return t ? JSON.parse(t) : null;
}
const q = encodeURIComponent;

// ---------------------------------------------------------------- Local
// DATA_DIR : disque persistant Render (ex. /var/data). Sans lui, dossier du projet (effacé à chaque déploiement).
const DATA_DIR = process.env.DATA_DIR || '';
const LOCAL_FILE = DATA_DIR ? path.join(DATA_DIR, 'crm.json') : path.join(ROOT, 'data', 'crm.json');
const LOCAL_PHOTOS = DATA_DIR ? path.join(DATA_DIR, 'photos') : path.join(ROOT, 'uploads', 'demandes');
function lireLocal() {
    let db = { demandes: [], messages: [], reglages: {} };
    try { db = { ...db, ...JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf-8')) }; } catch (e) {
        // Première fois : reprise de l'ancien data/demandes.json (format à plat).
        try {
            const anciennes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'demandes.json'), 'utf-8'));
            db.demandes = anciennes.map(d => ligneDepuisDemande(d, { origine: 'site', statut: d.statut === 'nouvelle' ? 'nouvelle' : (d.statut || 'nouvelle') }));
        } catch (e2) { /* rien à reprendre */ }
    }
    return db;
}
function ecrireLocal(db) {
    fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

// ---------------------------------------------------------------- Modèle
// Une demande (objet construit par server.js) -> ligne stockée.
function ligneDepuisDemande(d, { origine = 'site', statut = 'nouvelle' } = {}) {
    const { id, createdAt, statut: _s, ...data } = d;
    const ref = refDe(id);
    const created = createdAt || new Date().toISOString();
    return {
        ref, id, created_at: created, updated_at: new Date().toISOString(),
        type: d.type || 'estimation', origine, statut,
        dossier: nomDossier(ref, created, d.vehicule),
        data, estimation: null, estimation_at: null, suivi: {}, photos: []
    };
}

const STATUTS = {
    nouvelle: 'Nouvelle', contactee: 'Contactée', offre: 'Offre faite', rdv: 'Rendez-vous',
    achetee: 'Achetée', vendue_ailleurs: 'Vendue ailleurs', refusee: 'Refusée par le vendeur', sans_suite: 'Sans suite'
};

// ---------------------------------------------------------------- Demandes
async function listerDemandes() {
    if (!distant) return lireLocal().demandes.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const out = [];
    for (let from = 0; ; from += 1000) {
        const page = await sb(`/rest/v1/demandes?select=*&order=created_at.desc`, { headers: { Range: `${from}-${from + 999}` } });
        out.push(...page);
        if (page.length < 1000) return out;
    }
}

async function lireDemande(ref) {
    ref = String(ref || '').toUpperCase();
    if (!distant) return lireLocal().demandes.find(d => d.ref === ref) || null;
    const rows = await sb(`/rest/v1/demandes?ref=eq.${q(ref)}&select=*`);
    return rows[0] || null;
}

// Création ou fusion : ce qui est déjà connu (suivi, statut, photos, estimation) est conservé.
async function enregistrerDemande(ligne) {
    const exist = await lireDemande(ligne.ref);
    const fusion = exist ? {
        ...exist, ...ligne,
        created_at: exist.created_at < ligne.created_at ? exist.created_at : ligne.created_at,
        dossier: exist.dossier,
        statut: exist.statut !== 'nouvelle' ? exist.statut : ligne.statut,
        origine: exist.origine === 'site' && ligne.origine !== 'site' ? 'site' : (ligne.origine === 'site' ? 'site' : exist.origine),
        data: { ...exist.data, ...Object.fromEntries(Object.entries(ligne.data || {}).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length))) },
        estimation: ligne.estimation || exist.estimation, estimation_at: ligne.estimation_at || exist.estimation_at,
        suivi: { ...exist.suivi, ...ligne.suivi },
        photos: fusionPhotos(exist.photos, ligne.photos)
    } : ligne;
    fusion.updated_at = new Date().toISOString();
    if (!distant) {
        const db = lireLocal();
        db.demandes = db.demandes.filter(d => d.ref !== fusion.ref);
        db.demandes.unshift(fusion);
        ecrireLocal(db);
        return fusion;
    }
    const rows = await sb(`/rest/v1/demandes?on_conflict=ref`, {
        method: 'POST', body: fusion, headers: { Prefer: 'resolution=merge-duplicates,return=representation' }
    });
    return rows[0];
}
const fusionPhotos = (a = [], b = []) => {
    const vus = new Set(a.map(p => p.path));
    return [...a, ...b.filter(p => !vus.has(p.path))];
};

async function majDemande(ref, champs) {
    ref = String(ref || '').toUpperCase();
    champs = { ...champs, updated_at: new Date().toISOString() };
    if (!distant) {
        const db = lireLocal();
        const d = db.demandes.find(x => x.ref === ref);
        if (!d) return null;
        Object.assign(d, champs);
        ecrireLocal(db);
        return d;
    }
    const rows = await sb(`/rest/v1/demandes?ref=eq.${q(ref)}`, { method: 'PATCH', body: champs, headers: { Prefer: 'return=representation' } });
    return rows[0] || null;
}

async function supprimerDemande(ref) {
    const d = await lireDemande(ref);
    if (!d) return false;
    for (const p of d.photos || []) await supprimerPhoto(p.path).catch(() => {});
    if (!distant) {
        const db = lireLocal();
        db.demandes = db.demandes.filter(x => x.ref !== d.ref);
        ecrireLocal(db);
        return true;
    }
    await sb(`/rest/v1/demandes?ref=eq.${q(d.ref)}`, { method: 'DELETE' });
    return true;
}

// ---------------------------------------------------------------- Photos (un dossier par demande)
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic', '.pdf': 'application/pdf' };
const mimeDe = name => MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';

// Photos réduites à 1600 px en JPEG (≈ 250 Ko) : assez pour juger un véhicule, et le disque tient.
async function compresser(nom, buffer) {
    if (!/\.(jpe?g|png|webp|heic|heif)$/i.test(nom) || buffer.length < 400 * 1024) return { nom, buffer };
    try {
        const sharp = require('sharp');
        sharp.cache(false); sharp.concurrency(1); // serveur à 512 Mo
        const out = await sharp(buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
        return { nom: nom.replace(/\.(png|webp|heic|heif)$/i, '.jpg'), buffer: out.length < buffer.length ? out : buffer };
    } catch (e) { return { nom, buffer }; }
}

async function ajouterPhoto(dossier, nom, buffer) {
    ({ nom, buffer } = await compresser(nom, buffer));
    const p = `${dossier}/${nom.replace(/[^\w.-]+/g, '_')}`;
    if (!distant) {
        const full = path.join(LOCAL_PHOTOS, p);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, buffer);
    } else {
        await sb(`/storage/v1/object/${BUCKET}/${p.split('/').map(q).join('/')}`, {
            method: 'POST', body: buffer, headers: { 'Content-Type': mimeDe(nom), 'x-upsert': 'true' }
        });
    }
    return { path: p, name: path.basename(p), size: buffer.length, at: new Date().toISOString() };
}

async function lirePhoto(p) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(p)) throw new Error('Chemin invalide');
    if (!distant) return { buffer: fs.readFileSync(path.join(LOCAL_PHOTOS, p)), type: mimeDe(p) };
    const res = await sb(`/storage/v1/object/${BUCKET}/${p.split('/').map(q).join('/')}`, { raw: true });
    return { buffer: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || mimeDe(p) };
}

async function supprimerPhoto(p) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(p)) throw new Error('Chemin invalide');
    if (!distant) { try { fs.unlinkSync(path.join(LOCAL_PHOTOS, p)); } catch (e) { /* déjà absente */ } return; }
    await sb(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', body: { prefixes: [p] } });
}

// ---------------------------------------------------------------- Messages de contact
async function ajouterMessage(m) {
    const { id, createdAt, lu, ...data } = m;
    const ligne = { id, created_at: createdAt || new Date().toISOString(), lu: !!lu, data };
    if (!distant) { const db = lireLocal(); db.messages.unshift(ligne); ecrireLocal(db); return ligne; }
    await sb('/rest/v1/messages', { method: 'POST', body: ligne, headers: { Prefer: 'resolution=ignore-duplicates' } });
    return ligne;
}
async function listerMessages() {
    if (!distant) return lireLocal().messages;
    return sb('/rest/v1/messages?select=*&order=created_at.desc&limit=1000');
}
async function marquerMessage(id, lu) {
    if (!distant) { const db = lireLocal(); const m = db.messages.find(x => x.id === id); if (m) m.lu = !!lu; ecrireLocal(db); return; }
    await sb(`/rest/v1/messages?id=eq.${q(id)}`, { method: 'PATCH', body: { lu: !!lu } });
}

// ---------------------------------------------------------------- Réglages
async function lireReglage(cle, defaut) {
    if (!distant) { const v = lireLocal().reglages[cle]; return v === undefined ? defaut : v; }
    const rows = await sb(`/rest/v1/reglages?cle=eq.${q(cle)}&select=valeur`);
    return rows[0] ? rows[0].valeur : defaut;
}
async function ecrireReglage(cle, valeur) {
    if (!distant) { const db = lireLocal(); db.reglages[cle] = valeur; ecrireLocal(db); return; }
    await sb('/rest/v1/reglages?on_conflict=cle', { method: 'POST', body: { cle, valeur }, headers: { Prefer: 'resolution=merge-duplicates' } });
}

module.exports = {
    distant, disque, STATUTS, refDe, nomDossier, ligneDepuisDemande,
    listerDemandes, lireDemande, enregistrerDemande, majDemande, supprimerDemande,
    ajouterPhoto, lirePhoto, supprimerPhoto, compresser,
    ajouterMessage, listerMessages, marquerMessage,
    lireReglage, ecrireReglage
};
