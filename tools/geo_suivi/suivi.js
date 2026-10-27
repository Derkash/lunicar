/**
 * Suivi hebdomadaire de la visibilité de LUNICAR dans ChatGPT (recherche web).
 *
 *   node tools/geo_suivi/suivi.js                 toutes les questions de questions.json
 *   node tools/geo_suivi/suivi.js q03 q12         seulement ces questions
 *   OPENAI_MODEL=gpt-4.1 node tools/geo_suivi/suivi.js
 *
 * Clé : OPENAI_API_KEY dans l'environnement, sinon dans .env ou .env.local à la racine
 * du projet, sinon dans tools/geo_suivi/.env. La clé n'est jamais affichée ni écrite.
 *
 * Pour chaque question : Lunicar cité ou non, rang parmi les sites cités, URL citée,
 * concurrents cités. Résultats datés dans
 *   ~/Library/Mobile Documents/com~apple~CloudDocs/Projects/work/lunicar-audit/geo-suivi/AAAA-MM-JJ.json (+ .md)
 * (dossier modifiable avec GEO_SUIVI_DIR).
 *
 * Les réponses de ChatGPT varient d'un appel à l'autre : comparer les tendances d'un mois
 * sur l'autre, pas une question isolée.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const RACINE = path.join(__dirname, '..', '..');
const SORTIE = process.env.GEO_SUIVI_DIR
    || path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/Projects/work/lunicar-audit/geo-suivi');
const MODELE = process.env.OPENAI_MODEL || 'gpt-4.1';
const MARQUE = /lunicar/i;
const DOMAINE = 'lunicar.fr';

// Concurrents repérés par leur nom dans le texte, en plus des domaines cités.
const CONCURRENTS = {
    'Aramisauto': /aramis/i, 'Autobiz': /autobiz/i, 'Vendezvotrevoiture.fr': /vendez\s?votre\s?voiture/i,
    'La Centrale': /la\s?centrale/i, 'Spoticar': /spoticar/i, 'Leboncoin': /le\s?bon\s?coin/i,
    'Capcar': /capcar/i, 'Autohero': /autohero/i, 'Allovendu': /allovendu/i, 'AutoScout24': /autoscout/i,
    'Carizy': /carizy/i, 'Reezocar': /reezocar/i, 'Kyump': /kyump/i, 'Wizzas': /wizzas/i,
    'Cash Auto': /cash\s?auto/i, 'Argus': /\bargus\b/i
};

function lireCle() {
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
    for (const f of ['.env', '.env.local', path.join('tools', 'geo_suivi', '.env')]) {
        const p = path.join(RACINE, f);
        if (!fs.existsSync(p)) continue;
        const m = fs.readFileSync(p, 'utf-8').match(/^\s*OPENAI_API_KEY\s*=\s*["']?([^"'\s#]+)/m);
        if (m && m[1]) return m[1];
    }
    return null;
}

const domaine = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

async function interroger(cle, question, outil) {
    const r = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cle}` },
        body: JSON.stringify({
            model: MODELE,
            tools: [{ type: outil, user_location: { type: 'approximate', country: 'FR' } }],
            input: question
        })
    });
    const corps = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error((corps.error && corps.error.message) || `HTTP ${r.status}`); e.status = r.status; throw e; }
    let texte = ''; const urls = [];
    for (const item of corps.output || []) {
        if (item.type !== 'message') continue;
        for (const c of item.content || []) {
            if (c.type !== 'output_text') continue;
            texte += c.text;
            for (const an of c.annotations || []) if (an.type === 'url_citation' && an.url) urls.push(an.url.replace(/[?&]utm_source=openai$/, ''));
        }
    }
    return { texte, urls };
}

function analyser(q, { texte, urls }) {
    const domaines = [...new Set(urls.map(domaine).filter(Boolean))];
    const rang = domaines.findIndex(d => d.endsWith(DOMAINE));
    const concurrentsTexte = Object.entries(CONCURRENTS).filter(([, re]) => re.test(texte) && !domaines.some(d => re.test(d))).map(([n]) => n);
    return {
        id: q.id, type: q.type, question: q.question,
        lunicar_cite: rang >= 0 || MARQUE.test(texte),
        lunicar_lien: rang >= 0,
        rang: rang >= 0 ? rang + 1 : null,
        nb_sites_cites: domaines.length,
        url_lunicar: urls.find(u => domaine(u).endsWith(DOMAINE)) || null,
        sites_cites: domaines,
        concurrents_cites: [...new Set([...domaines.filter(d => !d.endsWith(DOMAINE)), ...concurrentsTexte])],
        // Promesses retirées du site que ChatGPT répète encore (index périmé) : à surveiller jusqu'à disparition.
        erreurs_factuelles: [['24 h', /\b24 ?h\b/i], ['7 jours', /\b7 jours|sept jours/i], ['cash', /\bcash\b/i], ['Paris seulement', /uniquement (à|en|sur) (Paris|Île-de-France)|seulement en Île-de-France/i]].filter(([, re]) => MARQUE.test(texte) && re.test(texte)).map(([n]) => n),
        extrait: texte.slice(0, 600)
    };
}

function resume(rel) {
    const r = rel.resultats;
    const cites = r.filter(x => x.lunicar_cite);
    const conc = {};
    r.forEach(x => x.concurrents_cites.forEach(c => { conc[c] = (conc[c] || 0) + 1; }));
    const top = Object.entries(conc).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const parType = {}; r.forEach(x => { parType[x.type] = parType[x.type] || { n: 0, c: 0 }; parType[x.type].n++; if (x.lunicar_cite) parType[x.type].c++; });
    const fact = r.filter(x => (x.erreurs_factuelles || []).length);
    return `# Visibilité de LUNICAR dans ChatGPT : relevé du ${rel.date}

- Méthode : ${rel.methode}
- Modèle : ${rel.modele}
- Questions posées : ${r.length}
- **LUNICAR cité : ${cites.length} / ${r.length}** (avec lien vers lunicar.fr : ${r.filter(x => x.lunicar_lien).length}) · part de voix ${Math.round(cites.length / r.length * 100)} %
- Par type : ${Object.entries(parType).map(([t, v]) => `${t} ${v.c}/${v.n}`).join(' · ')}
- Erreurs factuelles sur LUNICAR (promesses retirées encore répétées) : ${fact.length ? fact.map(x => `${x.id} (${x.erreurs_factuelles.join(', ')})`).join(', ') : 'aucune'}

| # | Type | Question | Cité | Rang | URL citée |
|---|---|---|---|---|---|
${r.map(x => `| ${x.id} | ${x.type} | ${x.question} | ${x.lunicar_cite ? 'oui' : 'non'} | ${x.rang || '-'} | ${x.url_lunicar || '-'} |`).join('\n')}

## Sites et concurrents les plus cités

| Site ou marque | Questions | Part de voix |
|---|---|---|
| **LUNICAR** | ${cites.length} | ${Math.round(cites.length / r.length * 100)} % |
${top.map(([n, c]) => `| ${n} | ${c} | ${Math.round(c / r.length * 100)} % |`).join('\n')}

${rel.erreurs && rel.erreurs.length ? `## Erreurs\n\n${rel.erreurs.map(e => `- ${e}`).join('\n')}\n` : ''}
Les réponses de ChatGPT varient d'un appel à l'autre : lire les tendances d'un mois sur l'autre.
`;
}

(async () => {
    const cle = lireCle();
    if (!cle) {
        console.log('Aucune clé OPENAI_API_KEY trouvée (environnement, .env, .env.local, tools/geo_suivi/.env).');
        console.log('Ajoutez-la par exemple dans .env (ignoré par git) : OPENAI_API_KEY=...');
        console.log('Rien n\'a été interrogé ni écrit.');
        process.exit(2);
    }
    const toutes = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf-8'));
    const filtre = process.argv.slice(2);
    const questions = filtre.length ? toutes.filter(q => filtre.includes(q.id)) : toutes;
    let outil = 'web_search';
    const resultats = []; const erreurs = [];
    for (const q of questions) {
        try {
            let rep;
            try { rep = await interroger(cle, q.question, outil); } catch (e) {
                if (e.status === 400 && outil === 'web_search') { outil = 'web_search_preview'; rep = await interroger(cle, q.question, outil); } else throw e;
            }
            const a = analyser(q, rep);
            resultats.push(a);
            await new Promise(r => setTimeout(r, Number(process.env.GEO_PAUSE_MS) || 4000));
            console.log(`${q.id} ${a.lunicar_cite ? 'CITÉ' + (a.rang ? ` (rang ${a.rang}/${a.nb_sites_cites})` : '') : 'absent'}  ${q.question}`);
        } catch (e) {
            if (e.status === 401) { console.log('Clé refusée par OpenAI (401). Vérifiez OPENAI_API_KEY.'); process.exit(3); }
            erreurs.push(`${q.id} : ${e.message}`);
            console.log(`${q.id} erreur : ${e.message}`);
        }
    }
    const date = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ, heure locale
    const rel = { date, methode: `API OpenAI Responses, outil ${outil}, localisation FR`, modele: MODELE, resultats, erreurs };
    fs.mkdirSync(SORTIE, { recursive: true });
    fs.writeFileSync(path.join(SORTIE, `${date}.json`), JSON.stringify(rel, null, 2));
    fs.writeFileSync(path.join(SORTIE, `${date}.md`), resume(rel));
    console.log(`\nLUNICAR cité ${resultats.filter(x => x.lunicar_cite).length}/${resultats.length}. Relevé : ${path.join(SORTIE, date)}.json / .md`);
})();
