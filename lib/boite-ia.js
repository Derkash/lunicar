// Lecture IA d'un e-mail de la boîte : Claude repère le vendeur et le véhicule (plaque, modèle, année, km, état…)
// pour créer la fiche (demande) ou compléter celle déjà liée. Rien n'est créé sans validation dans l'admin.
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.BOITE_IA_MODEL || 'claude-sonnet-5-5';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 90 * 1000, maxRetries: 2 }) : null;

const CHAMPS = {
    prenom: 'Prénom du vendeur', nom: 'Nom du vendeur', telephone: 'Téléphone', code_postal: 'Code postal du véhicule', ville: 'Ville',
    plaque: 'Immatriculation', vehicule: 'Véhicule (marque, modèle, version)', annee: 'Année', kilometrage: 'Kilométrage',
    energie: 'Énergie', boite: 'Boîte de vitesses', mecanique: 'État mécanique', carrosserie: 'Carrosserie',
    controle_technique: 'Contrôle technique', prix_souhaite: 'Prix souhaité (€)'
};
const MECANIQUE = ['Roule, aucun souci', 'Roule, avec des soucis mécaniques', 'Ne roule plus (en panne)', 'Accidentée'];
const CARROSSERIE = ['Très bon état', 'Quelques rayures ou petits chocs', 'Abîmée'];

const OUTIL = {
    name: 'fiche_vehicule',
    description: "Informations trouvées dans l'e-mail. Laisser vide ce qui n'est pas écrit : ne rien deviner.",
    input_schema: {
        type: 'object',
        properties: {
            intention: { type: 'string', enum: ['vente', 'suivi', 'question', 'autre'], description: "vente = propose un véhicule à LUNICAR ; suivi = relance ou complément sur une demande ; question = question générale ; autre = sans rapport" },
            resume: { type: 'string', description: "Ce que veut l'expéditeur, en une ou deux phrases" },
            ...Object.fromEntries(Object.keys(CHAMPS).map(k => [k, { type: 'string' }])),
            mecanique: { type: 'string', enum: ['', ...MECANIQUE] },
            carrosserie: { type: 'string', enum: ['', ...CARROSSERIE] },
            defauts: { type: 'string', description: 'Défauts, pannes, réparations à prévoir cités dans le mail' }
        },
        required: ['intention', 'resume']
    }
};

const propre = (k, v) => {
    v = String(v == null ? '' : v).trim().slice(0, 200);
    if (k === 'plaque') return v.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^([A-Z]{2})(\d{3})([A-Z]{2})$/, '$1-$2-$3');
    if (k === 'kilometrage' || k === 'prix_souhaite') return v.replace(/[^\d]/g, '');
    if (k === 'code_postal') return (v.match(/\d{5}/) || [''])[0];
    if (k === 'annee') return (v.match(/(19|20)\d{2}/) || [''])[0];
    return v;
};

async function analyser(m) {
    if (!client) throw Object.assign(new Error("Analyse IA indisponible : ANTHROPIC_API_KEY absente du serveur."), { status: 503 });
    const texte = [`De : ${m.nom ? m.nom + ' ' : ''}<${m.de}>`, `Date : ${m.date}`, `Objet : ${m.objet || ''}`,
        (m.pieces || []).length ? `Pièces jointes : ${m.pieces.map(p => p.nom).join(', ')}` : '', '', String(m.texte || '').slice(0, 12000)].filter(x => x !== '').join('\n');
    const r = await client.messages.create({
        model: MODEL, max_tokens: 1500,
        system: "Tu lis les e-mails reçus par LUNICAR, qui rachète des voitures d'occasion à des particuliers et des professionnels. Extrais le vendeur et le véhicule dont parle l'e-mail (y compris dans la signature et le message cité). Ne mets que ce qui est écrit ; n'invente rien.",
        tools: [OUTIL], tool_choice: { type: 'tool', name: OUTIL.name },
        messages: [{ role: 'user', content: texte }]
    });
    const bloc = (r.content || []).find(b => b.type === 'tool_use');
    if (!bloc) throw Object.assign(new Error("L'IA n'a rien renvoyé, réessayez."), { status: 502 });
    const x = bloc.input || {};
    const champs = Object.fromEntries(Object.keys(CHAMPS).map(k => [k, propre(k, x[k])]));
    return { intention: x.intention || 'autre', resume: String(x.resume || '').slice(0, 500), defauts: String(x.defauts || '').slice(0, 1000), champs, le: new Date().toISOString() };
}

module.exports = { analyser, CHAMPS, MECANIQUE, CARROSSERIE, active: () => !!client };
