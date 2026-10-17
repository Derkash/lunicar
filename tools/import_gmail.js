// Reprise des anciennes demandes depuis Gmail, en ligne de commande.
// Usage : node tools/import_gmail.js [AAAA-MM-JJ]   (lit .env : SMTP_USER/SMTP_PASS, SUPABASE_*)
require('dotenv').config();
const { importer } = require('../lib/gmail-import');
const store = require('../lib/store');

console.log(`Stockage : ${store.distant ? 'Supabase' : 'local (data/crm.json)'}`);
importer({ depuis: process.argv[2] })
    .then(b => { if (b.erreurs.length) console.log(b.erreurs.join('\n')); })
    .catch(e => { console.error('❌', e.message); process.exit(1); });
