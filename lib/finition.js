// Finition et motorisation d'une demande, trouvées et inscrites dans la fiche sans intervention (22/11/2026).
//
// 1. Leboncoin Pro (Sonar), interrogé par le Mac mini avec la plaque : quand Sonar SUGGÈRE la version de la plaque,
//    elle est sûre → finition = niveau d'équipement (trim), motorisation = libellé de la version.
// 2. Sinon (plusieurs versions possibles, plaque inconnue de Sonar, Mac mini arrêté) : Claude avec recherche web
//    croise la fiche officielle (API plaque : version commerciale, puissance, énergie, boîte, date de 1re mise en
//    circulation, VIN) avec les sites spécialisés (fiches techniques, pièces auto par type mine, annonces de la même
//    plaque) et les versions proposées par Sonar, puis retient la plus probable avec un niveau de confiance.
//
// Règle : on ne remplace jamais une finition ou une motorisation déjà saisie (vendeur, appel, carte grise).
// Trace dans data.finition_auto : { source, confiance, le, detail, sources }.
const Anthropic = require('@anthropic-ai/sdk');
const store = require('./store');

const MODEL = process.env.FINITION_MODEL || process.env.ESTIMATION_MODEL || 'claude-sonnet-5-5';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 2 * 60 * 1000, maxRetries: 1 }) : null;
const s = (v, m = 80) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, m);
const vide = v => !s(v) || /^(—|-|\?|inconnue?|non renseign[ée]e?)$/i.test(s(v));

// Libellé de motorisation depuis la version Sonar : « 1.5 dCi 90 FAP » (+ puissance / énergie si absentes du libellé).
function moteurSonar(v) {
    let m = s(v.label, 120);
    if (v.trim) m = m.replace(new RegExp('\\s*' + v.trim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i'), '').trim();
    const extra = [];
    if (v.power && !new RegExp('\\b' + v.power + '\\b').test(m)) extra.push(`${v.power} ch`);
    if (v.energy && !/diesel|essence|hybride|[ée]lectrique|gpl|ethanol/i.test(m)) extra.push(v.energy.toLowerCase());
    return s([m, ...extra].filter(Boolean).join(' · '), 100);
}

// Version sûre (suggérée par Sonar pour cette plaque) : rien à chercher.
function depuisSonar(rel) {
    const v = rel && rel.version;
    if (!v || !v.suggeree || !(v.trim || v.label)) return null;
    return { finition: vide(v.trim) ? '' : s(v.trim, 60), motorisation: moteurSonar(v), source: 'Leboncoin Pro (Sonar) · version de la plaque', confiance: 'haute' };
}

function extraireJSON(t) { const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b < a) return null; try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; } }

// Recherche sur les sites : la plaque n'a pas suffi à Sonar.
async function rechercher(d, rel) {
    if (!client) return null;
    const x = d.data || {};
    let f = {};
    try { f = require('./vehicule').normaliserReponse(x.fiche_api || {}) || {}; } catch (e) { f = {}; }
    const api = x.fiche_api || {};
    const v = (rel && rel.version) || {};
    const lignes = [
        ['Titre de la demande', x.vehicule], ['Saisi par le vendeur', x.vehicule_declare], ['Année', x.annee], ['Kilométrage', x.kilometrage && `${x.kilometrage} km`],
        ['Plaque', x.plaque], ['VIN', x.vin || api.vin], ['Fiche officielle : marque / modèle', [f.marque, f.modele].filter(Boolean).join(' ')],
        ['Fiche officielle : version commerciale', f.version], ['Énergie', f.energie || x.energie_siv], ['Puissance (ch)', f.puissanceCh], ['Puissance fiscale', f.puissanceFiscale],
        ['Boîte', f.boite || x.boite_siv], ['1re mise en circulation', f.miseEnCirculation], ['Type mine / CNIT', api.typeVarianteVersion || api.tvv || api.cnit || api.CNIT || api.type_mine || ''],
        ['Code moteur', api.codeMoteur || api.code_moteur || ''], ['Cylindrée', api.cylindree || api.cylindreeCm3 || ''], ['Carrosserie', api.carrosserie || ''],
        ['Version choisie par Sonar (non confirmée)', v.label ? `${v.label}${v.trim ? ' — finition ' + v.trim : ''} (${v.choix || ''})` : ''],
        ['Versions proposées par Sonar pour la plaque', (v.candidats || []).join(' ; ')]
    ].filter(([, val]) => s(val)).map(([k, val]) => `- ${k} : ${s(val, 300)}`).join('\n');
    const consigne = `Tu identifies la FINITION (niveau d'équipement commercial : « Zen », « Allure », « Confortline »…) et la MOTORISATION exacte (cylindrée, nom commercial du moteur, puissance en ch, carburant : « 1.5 dCi 90 ch diesel ») d'une voiture d'occasion française, à partir de sa fiche officielle.
Méthode : cherche sur plusieurs sites (fiches techniques type caradisiac / l'argus / autoplus, sites de pièces auto qui décodent le type mine ou le CNIT comme Oscaro ou Autodoc, et toute annonce de cette plaque ou de ce VIN), puis recoupe : la puissance, l'énergie, la boîte et la date doivent concorder. La finition n'est souvent pas dans la fiche officielle : si plusieurs finitions partagent ce moteur et que rien ne permet de trancher, laisse "finition" vide plutôt que deviner.
Données :
${lignes}
Réponds UNIQUEMENT par un objet JSON : {"finition": "", "motorisation": "", "confiance": "haute|moyenne|faible", "justification": "une phrase"}`;
    const messages = [{ role: 'user', content: consigne }], sources = [];
    let resp;
    for (let tour = 0; tour < 3; tour++) {
        resp = await client.messages.create({
            model: MODEL, max_tokens: 3000,
            tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5, user_location: { type: 'approximate', country: 'FR', timezone: 'Europe/Paris' } }],
            messages
        });
        for (const b of resp.content) if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(r => r.url && sources.length < 8 && !sources.some(y => y.url === r.url) && sources.push({ titre: s(r.title, 120), url: r.url }));
        if (resp.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: resp.content });
    }
    const j = extraireJSON(resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n'));
    if (!j) return null;
    const conf = ['haute', 'moyenne', 'faible'].includes(j.confiance) ? j.confiance : 'faible';
    return { finition: vide(j.finition) ? '' : s(j.finition, 60), motorisation: vide(j.motorisation) ? '' : s(j.motorisation, 100), confiance: conf,
        source: 'recherche sur les sites (fiche officielle + Sonar)', detail: s(j.justification, 300), sources };
}

const enCours = new Set();
// Complète la fiche si la finition ou la motorisation manque. Renvoie ce qui a été inscrit (ou null).
async function completer(ref, { releve = null, rechercheWeb = true } = {}) {
    ref = String(ref || '').toUpperCase();
    if (!ref || enCours.has(ref)) return null;
    enCours.add(ref);
    try {
        const d = await store.lireDemande(ref);
        if (!d || d.type === 'rappel') return null;
        const x = d.data || {};
        if (!vide(x.finition) && !vide(x.motorisation)) return null;
        // Déjà cherché sur les sites : pas de nouvel appel payant (sauf nouvelle version sûre de Sonar).
        const deja = x.finition_auto && x.finition_auto.source;
        const rel = releve || (x.plaque ? require('./marche').releve(x.plaque) : null);
        let r = depuisSonar(rel);
        // Recherche payante seulement pour une demande récente et active (le Mac mini repasse aussi les anciennes).
        const recente = Date.now() - new Date(d.created_at) < 3 * 864e5 && !(d.suivi || {}).archivee;
        if (!r && rechercheWeb && recente && !deja && (x.plaque || x.vin || x.vehicule)) r = await rechercher(d, rel).catch(e => { console.error(`Finition ${ref} :`, e.message); return null; });
        if (!r || (!r.finition && !r.motorisation)) return null;
        const frais = (await store.lireDemande(ref)) || d, fx = frais.data || {};   // relu : un appel a pu compléter la fiche entre-temps
        const ajout = {};
        if (vide(fx.finition) && r.finition) ajout.finition = r.finition;
        if (vide(fx.motorisation) && r.motorisation) ajout.motorisation = r.motorisation;
        const trace = { source: r.source, confiance: r.confiance, le: new Date().toISOString(), ...(r.detail ? { detail: r.detail } : {}), ...(r.sources && r.sources.length ? { sources: r.sources } : {}), ...ajout };
        await store.majDemande(ref, { data: { ...fx, ...ajout, finition_auto: trace } });
        if (Object.keys(ajout).length) console.log(`🔧 ${ref} : ${[ajout.finition, ajout.motorisation].filter(Boolean).join(' · ')} (${r.source}, confiance ${r.confiance})`);
        return ajout;
    } finally { enCours.delete(ref); }
}

module.exports = { completer, depuisSonar, moteurSonar };
