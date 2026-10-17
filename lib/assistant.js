// Assistant IA de l'admin : pannes connues du modèle, points à vérifier, questions libres sur un véhicule.
// Claude avec recherche web (forums, rappels constructeur, fiches fiabilité). Lancé à la main depuis la fiche.
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.ESTIMATION_MODEL || 'claude-sonnet-5-5';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 3 * 60 * 1000, maxRetries: 2 }) : null;

const SYSTEM = `Tu es le mécanicien conseil de LUNICAR, négociant qui rachète des voitures d'occasion (souvent anciennes ou à fort kilométrage) pour les revendre.
On te donne la fiche d'un véhicule. Réponds en français, de façon concrète et vérifiable, pour un acheteur professionnel qui va inspecter la voiture et faire une offre.

Quand on te demande les pannes connues, cherche sur le web (forums spécialisés, rappels constructeur, fiches fiabilité, sites de pièces) et donne :
## Motorisation identifiée
Une ligne (si la fiche officielle SIV et le titre déclaré se contredisent, la fiche SIV fait foi ; signale la contradiction).
## Pannes connues
Pour chaque panne : symptôme, kilométrage typique d'apparition, coût de réparation indicatif en garage indépendant (fourchette en €).
## À vérifier à l'inspection
Liste courte de contrôles concrets (bruits, voyants, fumées, essai routier, documents).
## Entretien lourd à prévoir
Distribution (courroie ou chaîne, périodicité), embrayage, etc., au kilométrage indiqué.
## Impact sur le prix
Une ou deux phrases.

Sois honnête sur l'incertitude : si une information dépend de la motorisation exacte, dis-le. N'invente pas de chiffres ni de sources.`;

function fiche(d) {
    const x = d.data || {};
    const siv = x.fiche_api || null;
    const l = [['Véhicule déclaré par le vendeur', x.vehicule], ['Année', x.annee], ['Kilométrage', x.kilometrage && `${x.kilometrage} km`],
        ['État mécanique déclaré', x.mecanique], ['Carrosserie', x.carrosserie], ['Contrôle technique', x.controle_technique], ['Message du vendeur', x.message]]
        .filter(([, v]) => v).map(([k, v]) => `- ${k} : ${v}`);
    let t = l.join('\n');
    if (siv) {
        const f = Object.entries(siv).filter(([k, v]) => !/^(erreur|logo|photo|tecdoc|k_type|sra|liste_|pneus|collection)/i.test(k) && v !== null && v !== '' && typeof v !== 'object')
            .slice(0, 40).map(([k, v]) => `- ${k} : ${v}`);
        t += `\n\nFiche officielle SIV (fait foi) :\n${f.join('\n')}`;
    }
    return t;
}

async function demander(d, question) {
    if (!client) throw new Error('ANTHROPIC_API_KEY non défini sur le serveur');
    const q = String(question || '').trim() || 'Quelles sont les pannes connues de ce véhicule, et que dois-je vérifier avant de faire une offre ?';
    const messages = [{ role: 'user', content: `${fiche(d)}\n\nQuestion : ${q}` }];
    let resp;
    for (let tour = 0; tour < 4; tour++) {
        resp = await client.beta.messages.create({
            model: MODEL,
            max_tokens: 8000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium' },
            system: SYSTEM,
            tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5, user_location: { type: 'approximate', country: 'FR', timezone: 'Europe/Paris' } }],
            messages
        });
        if (resp.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: resp.content });
    }
    if (resp.stop_reason === 'refusal') throw new Error('Réponse refusée par le modèle');
    const sources = [];
    for (const m of [...messages.filter(m => m.role === 'assistant').map(m => m.content), resp.content]) {
        for (const b of m) if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(s => s.url && !sources.some(x => x.url === s.url) && sources.push({ titre: s.title, url: s.url }));
    }
    const texte = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return { question: q, reponse: texte, sources: sources.slice(0, 12), date: new Date().toISOString() };
}

module.exports = { demander, actif: () => !!client };
