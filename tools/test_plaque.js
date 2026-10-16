/**
 * Teste l'API plaque avec la clé locale (1 appel consommé).
 *   PLAQUE_API_KEY=xxx node tools/test_plaque.js AB-123-CD
 */
require('dotenv').config();
const v = require('../lib/vehicule');

(async () => {
    const plaque = process.argv[2];
    if (!plaque) return console.log('Usage : node tools/test_plaque.js AB-123-CD');
    if (!v.apiActive()) return console.log('PLAQUE_API_KEY absent : seul le décodeur local répond.');
    const r = await v.rechercher(plaque);
    console.log(JSON.stringify(r, null, 2));
})();
