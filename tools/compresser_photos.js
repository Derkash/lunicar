// Recompresse les photos déjà sur le disque (DATA_DIR/photos) : 1600 px, JPEG.
// Usage (shell Render) : node tools/compresser_photos.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { compresser } = require('../lib/store');

const racine = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'uploads'), process.env.DATA_DIR ? 'photos' : 'demandes');
(async () => {
    let avant = 0, apres = 0, n = 0;
    for (const dossier of fs.readdirSync(racine)) {
        for (const nom of fs.readdirSync(path.join(racine, dossier))) {
            const f = path.join(racine, dossier, nom);
            const buf = fs.readFileSync(f);
            const r = await compresser(nom, buf);
            if (r.buffer === buf) continue;
            fs.writeFileSync(f, r.buffer); // même nom : les fiches pointent toujours dessus
            avant += buf.length; apres += r.buffer.length; n++;
        }
    }
    console.log(`${n} photos recompressées : ${(avant / 1e6).toFixed(0)} Mo -> ${(apres / 1e6).toFixed(0)} Mo`);
})();
