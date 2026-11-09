// Anonymisation automatique des photos du dossier de vente, au moment où elles arrivent :
// plaques d'immatriculation sur les photos du véhicule, données personnelles (titulaire, adresse,
// naissance, signature, contact, IBAN, numéros de pièce) sur les documents photographiés.
// Claude repère les zones, sharp les pixelise avec une marge ; la photo d'origine n'est pas conservée.
// Sans clé API ou en cas d'échec, la photo est gardée telle quelle et reste « à flouter » à la main.
const Anthropic = require('@anthropic-ai/sdk');
const sharp = require('sharp');

const MODEL = process.env.FLOU_MODEL || process.env.OCR_MODEL || 'claude-haiku-4-5-20251001';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 60 * 1000, maxRetries: 1 }) : null;
const LARGEUR_ANALYSE = 1400;

const CONSIGNE = {
    vehicule: (w, h) => `Photo d'un véhicule d'occasion destinée à une annonce entre professionnels. L'image fait ${w} pixels de large sur ${h} de haut.
Repère TOUTES les plaques d'immatriculation visibles (avant, arrière, plaque posée dans l'habitacle, plaque d'un autre véhicule en arrière-plan, reflet lisible), même partiellement visibles ou floues.
Repère aussi tout texte personnel lisible : nom ou adresse sur un document posé dans la voiture, étiquette de garage avec nom de client.
Pour chaque zone, donne un rectangle en pixels de l'image fournie, légèrement plus grand que la zone (marge d'environ 10 %), avec x,y = coin supérieur gauche.
Réponds UNIQUEMENT par un JSON : {"zones":[{"type":"plaque"|"perso","x":0,"y":0,"w":0,"h":0}],"plaque_visible":true|false,"certitude":"haute"|"moyenne"|"faible"}
"plaque_visible" = false si aucune plaque n'apparaît du tout (intérieur, moteur, détail). "certitude" = ta confiance qu'il ne reste aucune plaque lisible en dehors des zones données.`,
    document: (w, h) => `Photo d'un document lié à un véhicule (certificat d'immatriculation, contrôle technique, facture, carnet d'entretien, pièce administrative). L'image fait ${w} pixels de large sur ${h} de haut.
Repère TOUTES les zones contenant des données personnelles du propriétaire ou du client, à masquer avant partage à des acheteurs professionnels :
- nom, prénom, raison sociale d'un particulier, co-titulaire (C.1, C.4.1 sur une carte grise), signature, cachet nominatif ;
- adresse postale complète (C.3), code postal et ville ;
- date et lieu de naissance, numéro de permis, pièce d'identité, numéro de sécurité sociale ;
- téléphone, e-mail, IBAN / RIB, numéro de client ;
- numéro d'immatriculation (A) et numéro de formule / certificat.
NE masque PAS les données du véhicule (marque, modèle, VIN, dates, kilométrage, énergie, puissance, montants, défauts constatés, garage émetteur).
Pour chaque zone, donne un rectangle en pixels de l'image fournie, légèrement plus grand que la zone (marge d'environ 10 %), avec x,y = coin supérieur gauche.
Réponds UNIQUEMENT par un JSON : {"zones":[{"type":"perso"|"plaque","x":0,"y":0,"w":0,"h":0}],"plaque_visible":true|false,"certitude":"haute"|"moyenne"|"faible"}`,
};

// Rectangles en pixels de l'image analysée → rectangles de l'image d'origine, bornés et élargis.
function normaliser(zones, echelle, W, H, marge = 0.12) {
    const out = [];
    for (const z of Array.isArray(zones) ? zones : []) {
        let x = Number(z.x) * echelle, y = Number(z.y) * echelle, w = Number(z.w) * echelle, h = Number(z.h) * echelle;
        if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
        const mx = w * marge, my = h * marge;
        x -= mx; y -= my; w += 2 * mx; h += 2 * my;
        x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
        w = Math.min(W - x, Math.round(w)); h = Math.min(H - y, Math.round(h));
        if (w >= 4 && h >= 4) out.push({ type: z.type === 'plaque' ? 'plaque' : 'perso', x, y, w, h });
    }
    return out;
}

// Pixelisation : la zone est réduite à quelques blocs puis réagrandie sans lissage, impossible à inverser.
async function pixeliser(buffer, zones) {
    if (!zones.length) return buffer;
    let img = sharp(buffer).rotate();
    const meta = await img.metadata();
    const base = await img.jpeg({ quality: 90 }).toBuffer();
    const calques = [];
    for (const z of zones) {
        const pas = Math.max(8, Math.round(Math.max(z.w, z.h) / 7));
        // Deux pipelines distincts : sharp n'applique qu'un seul redimensionnement par pipeline.
        const minuscule = await sharp(base).extract({ left: z.x, top: z.y, width: z.w, height: z.h })
            .resize({ width: Math.max(1, Math.round(z.w / pas)), height: Math.max(1, Math.round(z.h / pas)), fit: 'fill' }).png().toBuffer();
        const petit = await sharp(minuscule).resize({ width: z.w, height: z.h, fit: 'fill', kernel: 'nearest' }).png().toBuffer();
        calques.push({ input: petit, left: z.x, top: z.y });
    }
    return sharp(base).composite(calques).jpeg({ quality: 88, mozjpeg: true }).toBuffer().then(b => ({ buffer: b, largeur: meta.width, hauteur: meta.height }));
}

// type : 'vehicule' | 'document'. Retourne { buffer, zones, floutee, certitude, actif }.
// floutee = on peut considérer la photo sûre (plaques masquées, ou aucune plaque visible avec une bonne certitude).
async function anonymiser(buffer, type = 'vehicule') {
    if (!client) return { buffer, zones: [], floutee: false, certitude: 'inactif', actif: false };
    try {
        // Analyse sur une version réduite (coût, vitesse) ; les coordonnées sont ramenées à la taille d'origine.
        const orig = sharp(buffer).rotate();
        const meta = await orig.metadata();
        const W = meta.width, H = meta.height;
        const echelle = W > LARGEUR_ANALYSE ? W / LARGEUR_ANALYSE : 1;
        const w = Math.round(W / echelle), h = Math.round(H / echelle);
        const reduite = await sharp(buffer).rotate().resize({ width: w, height: h, fit: 'fill' }).jpeg({ quality: 85 }).toBuffer();
        const r = await client.messages.create({
            model: MODEL, max_tokens: 800,
            messages: [{ role: 'user', content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: reduite.toString('base64') } },
                { type: 'text', text: CONSIGNE[type === 'document' ? 'document' : 'vehicule'](w, h) },
            ] }],
        });
        const t = r.content.filter(b => b.type === 'text').map(b => b.text).join('');
        const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
        const zones = normaliser(j.zones, echelle, W, H);
        const sortie = zones.length ? await pixeliser(buffer, zones) : { buffer };
        const plaques = zones.filter(z => z.type === 'plaque').length;
        const certitude = ['haute', 'moyenne', 'faible'].includes(j.certitude) ? j.certitude : 'moyenne';
        // Photo du véhicule : sûre si une plaque a été masquée, ou si le modèle est sûr qu'il n'y en a aucune.
        // Document : les données personnelles masquées suffisent, la plaque éventuelle est traitée comme les autres zones.
        const floutee = type === 'document' ? true : (plaques > 0 ? certitude !== 'faible' : (j.plaque_visible === false && certitude === 'haute'));
        return { buffer: sortie.buffer, zones, floutee, certitude, actif: true, plaques };
    } catch (e) {
        console.log('anonymiseur :', e.message);
        return { buffer, zones: [], floutee: false, certitude: 'erreur', actif: true, erreur: e.message };
    }
}

module.exports = { anonymiser, pixeliser, normaliser, MODEL };
