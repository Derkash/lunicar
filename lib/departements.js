/**
 * LUNICAR - Départements hors Île-de-France (data/local.json, clé « departements »).
 *
 * Une page département n'existe que si son texte local est rédigé : sinon le lien
 * mène à la région. Hiérarchie du maillage : région -> département -> ville.
 */
const fs = require('fs');
const path = require('path');

const slugify = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/'/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function load() {
    const local = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'local.json'), 'utf-8'));
    return Object.entries(local.departements || {}).map(([code, d]) => ({ code, ...d, slug: `rachat-voiture-${slugify(d.nom)}-${code.toLowerCase()}` }));
}

const LIST = load();
const byCode = code => LIST.find(d => d.code === code) || null;
const bySlug = slug => LIST.find(d => d.slug === slug) || null;
const ofCity = city => (city && city.dep ? byCode(city.dep) : null);

module.exports = { LIST, byCode, bySlug, ofCity, slugify };
