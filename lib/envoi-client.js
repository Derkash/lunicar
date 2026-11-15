// Liens envoyés au vendeur par SMS depuis l'admin : une page pour photographier sa carte grise, une autre pour
// envoyer les photos de la voiture. Chaque lien est propre à une demande (réf. + jeton signé) : ce qui est envoyé
// est rangé dans le dossier de la demande, la carte grise est lue par l'IA et complète la fiche (sans rien écraser).
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const store = require('./store');
const { SITE, esc } = require('./config');

const TYPES = {
    'carte-grise': { titre: 'Photo de votre carte grise', bouton: 'Photographier la carte grise', aide: 'Posez la carte grise à plat, bien éclairée, et prenez-la en entier (recto). Si elle est en plusieurs morceaux, ajoutez plusieurs photos.', max: 4 },
    photos: { titre: 'Photos de votre voiture', bouton: 'Ajouter des photos', aide: 'Avant, arrière, les deux côtés, l\'intérieur, le compteur allumé (kilométrage visible) et les éventuels défauts (rayures, chocs, voyants).', max: 20 }
};

// Secret des jetons : tiré une fois puis gardé dans les réglages (indépendant du mot de passe admin).
let secret = null;
async function cle() {
    if (secret) return secret;
    secret = await store.lireReglage('envoi_client_secret', null);
    if (!secret) { secret = crypto.randomBytes(32).toString('hex'); await store.ecrireReglage('envoi_client_secret', secret); }
    return secret;
}
const signer = async (ref, type) => crypto.createHmac('sha256', await cle()).update(`${ref}:${type}`).digest('hex').slice(0, 20);   // minuscules : les URL du site sont remises en minuscules
const egal = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function liens(ref) {
    const o = {};
    for (const t of Object.keys(TYPES)) o[t === 'carte-grise' ? 'carte_grise' : t] = `${SITE.baseUrl}/envoi/${ref.toLowerCase()}/${t}/${await signer(ref, t)}`;
    return o;
}

async function verifier(req) {
    const ref = String(req.params.ref || '').toUpperCase(), type = String(req.params.type || ''), jeton = String(req.params.jeton || '').toLowerCase();
    if (!/^[0-9A-F]{8}$/.test(ref) || !TYPES[type] || !egal(jeton, await signer(ref, type))) return null;
    const d = await store.lireDemande(ref).catch(() => null);
    return d ? { d, ref, type } : null;
}

const page = (titre, corps) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(titre)} · LUNICAR</title>
<style>
:root{--n:#0D2541;--b:#2453A6;--f:#F5F1E8;--t:#1B1F27;--s:#5B6472}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:var(--t);background:var(--f)}
header{background:var(--n);padding:16px 20px}header img{height:30px;display:block}
main{max-width:520px;margin:0 auto;padding:24px 16px 40px}h1{font-size:22px;line-height:1.25;margin:0 0 8px;color:var(--n)}
p{margin:0 0 16px;color:var(--s)}.veh{color:var(--t);font-weight:600}
label.pick{display:block;background:var(--n);color:#fff;text-align:center;padding:16px;border-radius:12px;font-weight:700;font-size:17px;cursor:pointer}
input[type=file]{display:block;width:100%;margin:12px 0 18px;font-size:15px}
button{width:100%;border:0;background:#1E7A46;color:#fff;font-size:17px;font-weight:700;padding:16px;border-radius:12px;cursor:pointer}
.ok{background:#fff;border-radius:12px;padding:20px}.ok h1{color:#1E7A46}small{display:block;margin-top:18px;color:var(--s);font-size:13px}
</style></head><body><header><img src="${SITE.baseUrl}/images/logo-lunicar-blanc-h.png" alt="LUNICAR"></header><main>${corps}</main></body></html>`;

const formulaire = (d, type, action) => {
    const T = TYPES[type], x = d.data || {};
    return page(T.titre, `<h1>${esc(T.titre)}</h1>
<p>Bonjour${x.prenom ? ' ' + esc(x.prenom) : ''}, ${x.vehicule ? `pour votre <span class="veh">${esc(x.vehicule)}</span>` : 'pour votre demande'} (réf. ${esc(d.ref)}).</p>
<p>${esc(T.aide)}</p>
<form method="post" action="${esc(action)}" enctype="multipart/form-data">
<input type="file" name="fichiers" accept="image/*${type === 'carte-grise' ? ',application/pdf' : ''}" ${T.max > 1 ? 'multiple' : ''} required>
<button type="submit">Envoyer</button></form>
<small>Vos photos sont transmises uniquement à LUNICAR pour votre dossier.</small>`);
};

const recu = (type, n) => page('Merci', `<div class="ok"><h1>Merci, c'est bien reçu</h1><p>${type === 'carte-grise' ? 'Votre carte grise' : `${n} photo${n > 1 ? 's' : ''}`} ${type === 'carte-grise' ? 'a été ajoutée' : n > 1 ? 'ont été ajoutées' : 'a été ajoutée'} à votre dossier. Vous pouvez fermer cette page${type === 'photos' ? ' ou revenir en envoyer d\'autres avec le même lien' : ''}.</p></div>`);
const erreur = (texte, status) => [status, page('Lien invalide', `<h1>Envoi impossible</h1><p>${esc(texte)}</p><p>Vous pouvez aussi nous écrire à <a href="mailto:contact@lunicar.fr">contact@lunicar.fr</a>.</p>`)];

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 20 },
    fileFilter: (req, f, cb) => cb(null, /^(image\/|application\/pdf)/.test(f.mimetype))
}).array('fichiers', 20);

function routes(app, { tooManySends, ipClient }) {
    const envoyer = (res, [status, doc]) => res.status(status).set('X-Robots-Tag', 'noindex, nofollow').set('Cache-Control', 'no-store').type('html').send(doc);

    app.get('/envoi/:ref/:type/:jeton', async (req, res) => {
        const v = await verifier(req).catch(() => null);
        if (!v) return envoyer(res, erreur('Ce lien n\'est pas valide ou a expiré.', 404));
        envoyer(res, [200, formulaire(v.d, v.type, req.originalUrl.split('?')[0])]);
    });

    app.post('/envoi/:ref/:type/:jeton', (req, res) => upload(req, res, async e => {
        try {
            const v = await verifier(req);
            if (!v) return envoyer(res, erreur('Ce lien n\'est pas valide ou a expiré.', 404));
            if (e) return envoyer(res, erreur(e.code === 'LIMIT_FILE_SIZE' ? 'Une photo est trop lourde (15 Mo maximum).' : 'Fichiers refusés : envoyez des photos.', 400));
            if (tooManySends(`envoi:${ipClient(req)}`, 15)) return envoyer(res, erreur('Trop d\'envois en peu de temps, réessayez dans une heure.', 429));
            const files = (req.files || []).slice(0, TYPES[v.type].max);
            if (!files.length) return envoyer(res, erreur('Aucune photo reçue.', 400));
            const x = v.d.data || {}, qui = [x.prenom, x.nom].filter(Boolean).join(' ') || 'Le vendeur';
            if (v.type === 'carte-grise') {
                const r = await require('./carte-grise').traiterPieces(v.ref, files.map((f, i) => ({ nom: `carte-grise_${i + 1}${path.extname(f.originalname || '').toLowerCase() || (/pdf/.test(f.mimetype) ? '.pdf' : '.jpg')}`, type: f.mimetype, contenu: f.buffer })), { origine: 'lien SMS du client' });
                require('./push').notifier({ titre: `🪪 Carte grise reçue · ${x.vehicule || v.ref}`, texte: `${qui} a envoyé sa carte grise${r.carte_grise ? ' : fiche complétée' : ' (lecture à vérifier)'}.`, ref: v.ref }).catch(() => {});
            } else {
                const jour = new Date().toISOString().slice(0, 10), ajout = [];
                for (const [i, f] of files.entries()) ajout.push(await store.ajouterPhoto(v.d.dossier, `${jour}_client_${Date.now()}_${i + 1}${path.extname(f.originalname || '').toLowerCase() || '.jpg'}`, f.buffer));
                const frais = (await store.lireDemande(v.ref)) || v.d, maintenant = new Date().toISOString();
                const suivi = { ...frais.suivi, historique: [{ date: maintenant, quoi: `${ajout.length} photo${ajout.length > 1 ? 's' : ''} envoyée${ajout.length > 1 ? 's' : ''} par le client (lien SMS)` }, ...((frais.suivi || {}).historique || [])].slice(0, 300) };
                await store.majDemande(v.ref, { photos: [...(frais.photos || []), ...ajout], suivi });
                require('./push').notifier({ titre: `📷 ${ajout.length} photo${ajout.length > 1 ? 's' : ''} reçue${ajout.length > 1 ? 's' : ''} · ${x.vehicule || v.ref}`, texte: `${qui} a envoyé des photos de sa voiture.`, ref: v.ref }).catch(() => {});
            }
            console.log(`📥 ${files.length} fichier(s) ${v.type} reçus par lien pour ${v.ref}`);
            envoyer(res, [200, recu(v.type, files.length)]);
        } catch (err) {
            console.error('Envoi client :', err.message);
            envoyer(res, erreur('Une erreur est survenue, réessayez dans un instant.', 500));
        }
    }));
}

module.exports = { routes, liens, TYPES };
