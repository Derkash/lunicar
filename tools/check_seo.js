/**
 * Contrôle SEO de toutes les pages du sitemap, sur un serveur lancé en local.
 *
 *   PORT=3123 node server.js &   puis   node tools/check_seo.js http://localhost:3123
 *
 * Vérifie : statut 200, title ≤ 60 car., description 110-160 car., un seul H1,
 * canonical = URL, JSON-LD valide, mots interdits (règle « aucune preuve inventée »),
 * liens internes qui répondent 200 (ni 301 ni 404), titres et descriptions uniques.
 */
const base = (process.argv[2] || 'http://localhost:3123').replace(/\/$/, '');
const SITE = 'https://lunicar.fr';
const FORBIDDEN = /\b(expert[es]? (porsche|en|de la)|spécialiste|leader|n°\s?1\b|numéro un|meilleur prix (garanti|assuré)|prix garanti|garanti(e|s)? (le|au)\b|\+\s?\d+\s?%)/i;

const decode = s => s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

(async () => {
    const sm = await (await fetch(`${base}/sitemap.xml`)).text();
    const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replace(SITE, '') || '/');
    const problems = [];
    const titles = new Map(); const descs = new Map();
    const links = new Set();
    for (const u of urls) {
        const r = await fetch(base + u, { redirect: 'manual' });
        const html = await r.text();
        const bad = msg => problems.push(`${u} : ${msg}`);
        if (r.status !== 200) { bad(`HTTP ${r.status}`); continue; }
        const title = decode((html.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
        const desc = decode((html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '');
        if (!title || title.length > 60) bad(`title ${title.length} car. « ${title} »`);
        if (desc.length < 110 || desc.length > 160) bad(`description ${desc.length} car.`);
        const h1 = (html.match(/<h1[\s>]/g) || []).length;
        if (h1 !== 1) bad(`${h1} H1`);
        const canon = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
        if (canon !== SITE + (u === '/' ? '/' : u)) bad(`canonical ${canon}`);
        for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
            try { JSON.parse(m[1]); } catch (e) { bad('JSON-LD invalide'); }
        }
        const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
        const f = text.replace(/exemplaire n°\s?\d/g, '').match(FORBIDDEN);
        if (f) bad(`formulation interdite « ${f[0]} »`);
        titles.set(title, [...(titles.get(title) || []), u]);
        descs.set(desc, [...(descs.get(desc) || []), u]);
        for (const m of html.matchAll(/href="(\/[^"#?]*)/g)) if (!/\.(css|js|svg|png|jpg|webp|woff2|xml|txt)$/.test(m[1])) links.add(m[1]);
    }
    for (const [t, us] of titles) if (us.length > 1) problems.push(`title en double « ${t} » : ${us.join(', ')}`);
    for (const [d, us] of descs) if (us.length > 1) problems.push(`description en double : ${us.join(', ')}`);
    for (const l of links) {
        const r = await fetch(base + l, { redirect: 'manual' });
        if (r.status !== 200) problems.push(`lien interne ${l} -> HTTP ${r.status} ${r.headers.get('location') || ''}`);
    }
    console.log(`${urls.length} pages, ${links.size} liens internes vérifiés`);
    console.log(problems.length ? problems.join('\n') : 'Aucun problème.');
    process.exit(problems.length ? 1 : 0);
})();
