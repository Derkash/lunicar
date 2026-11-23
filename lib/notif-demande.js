// Une seule notification par demande, envoyée quand l'estimation est prête (règle du 22/11/2026).
// Avant : une alerte à la réception, puis une 2e quand le Mac mini rendait le prix Leboncoin (Sonar).
// Maintenant : la demande avec plaque attend le relevé Sonar du Mac mini (ou son échec) et part avec le prix ;
// au plus tard après NOTIF_ATTENTE_MIN minutes (10 par défaut) si le Mac mini ne répond pas.
// Les demandes en attente sont gardées dans le réglage `notif_attente` : un redéploiement ne les perd pas.
const store = require('./store');
const push = require('./push');

// Depuis le 23/11/2026 : la notification attend la fin de l'analyse approfondie du Mac mini (lib/analyse-vehicule.js) :
// Sonar, recherches Leboncoin par tranches de km, annonce du vendeur, lecture des textes, offre précise. Filet de
// sécurité : au bout de NOTIF_ATTENTE_MIN minutes (45 par défaut) sans réponse du Mac mini, elle part quand même
// en le disant. ANALYSE_MACMINI=0 revient à l'ancien comportement (attente du seul relevé Sonar, 10 min).
// L'attente de l'analyse ne joue que si le Mac mini fait vraiment l'analyse (il a demandé la file depuis moins de 30 min).
const ANALYSE_ON = process.env.ANALYSE_MACMINI !== '0';
const analyseActive = () => { try { return ANALYSE_ON && require('./analyse-vehicule').macActif(); } catch (e) { return false; } };
const ATTENTE_MIN = parseFloat(process.env.NOTIF_ATTENTE_MIN) || 0;
const attenteMs = () => (ATTENTE_MIN || (analyseActive() ? 45 : 10)) * 60 * 1000;
const ATTENTE = attenteMs();
const CLE = 'notif_attente';
const minuteurs = new Map();
let file = Promise.resolve();
const enSerie = fn => { const p = file.then(fn, fn); file = p.catch(() => {}); return p; };
const eur = v => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')} €`;

// Ligne « estimation » : prix Leboncoin (Sonar) et achat max, sinon l'estimation IA.
async function ligneEstimation(ref) {
    const d = await store.lireDemande(ref).catch(() => null);
    if (!d) return '';
    if (ANALYSE_ON) {
        try { const AV = require('./analyse-vehicule'); const l = AV.ligneNotification(await AV.calculer(d)); if (l) return l; } catch (e) { /* analyse indisponible : repli */ }
    }
    try {
        const MA = require('./marche-analyse'), a = MA.analyser(d, await MA.reglages());
        if (a && a.prix) return [`Leboncoin ${eur(a.prix)}`, a.achat_max ? `achat max ${eur(a.achat_max)}` : '', a.demande ? `il demande ${eur(a.demande.prix)}` : '',
            a.demande ? { acheter: 'achetable', negocier: 'à négocier', trop_cher: 'trop cher' }[a.demande.verdict] || '' : ''].filter(Boolean).join(' · ');
    } catch (e) { /* analyse indisponible */ }
    const p = (d.estimation || {}).prix || {};
    return p.max_achat ? `achat max ${eur(p.max_achat)}` : 'estimation indisponible : à estimer dans l\'admin';
}

async function envoyer(ref, base) {
    const est = await ligneEstimation(ref);
    await push.notifier({ titre: base.titre, texte: [base.texte, est].filter(Boolean).join('\n'), ref }).catch(e => console.error('Push :', e.message));
}

// Retire la demande de l'attente et envoie sa notification (une seule fois, même si deux signaux arrivent ensemble).
const partir = (ref, motif) => enSerie(async () => {
    clearTimeout(minuteurs.get(ref)); minuteurs.delete(ref);
    const l = await store.lireReglage(CLE, {}) || {};
    const base = l[ref];
    if (!base) return false;
    delete l[ref];
    await store.ecrireReglage(CLE, l).catch(() => {});
    console.log(`🔔 ${ref} : notification (${motif})`);
    await envoyer(ref, motif === 'délai' && base.analyse ? { ...base, texte: [base.texte, '⚠️ Mac mini sans réponse : analyse incomplète'].filter(Boolean).join('\n') } : base);
    // Le Mac mini n'a rien rendu : la finition / motorisation se cherche sur les sites.
    if (motif === 'délai') require('./finition').completer(ref).catch(() => {});
    return true;
});

function minuter(ref, ms) {
    clearTimeout(minuteurs.get(ref));
    const t = setTimeout(() => partir(ref, 'délai').catch(() => {}), Math.max(0, ms));
    t.unref && t.unref();
    minuteurs.set(ref, t);
}

// Demande avec plaque : attendre le relevé du Mac mini (sauf plaque déjà relevée : départ immédiat).
async function attendre(ref, base, plaque) {
    const rel = plaque ? require('./marche').releve(plaque) : null;
    await enSerie(async () => {
        const l = await store.lireReglage(CLE, {}) || {};
        l[ref] = { titre: base.titre, texte: base.texte, depuis: Date.now(), analyse: analyseActive(), attente: attenteMs() };
        await store.ecrireReglage(CLE, l);
    });
    if (!analyseActive() && rel && (rel.moyenne || (rel.annonces && rel.annonces.nb))) return partir(ref, 'plaque déjà relevée');
    minuter(ref, attenteMs());
}

// Relevé Sonar reçu (prix, ou échec) : la notification part si la demande l'attendait. Rien sinon.
// Avec l'analyse approfondie, le relevé Sonar n'est qu'une étape : la notification attend analyseRecue().
const releveRecu = async ref => {
    ref = String(ref || '').toUpperCase();
    const l = await store.lireReglage(CLE, {}) || {};
    if (l[ref] && l[ref].analyse) return false;   // elle attend l'analyse complète, pas seulement Sonar
    return partir(ref, 'relevé Mac mini');
};
// Analyse approfondie terminée par le Mac mini : c'est le seul déclencheur (avec le délai de secours).
const analyseRecue = ref => partir(String(ref || '').toUpperCase(), 'analyse Mac mini');

// Notification immédiate (rappel, abandon, demande sans plaque une fois l'estimation IA faite).
const maintenant = (ref, base) => envoyer(ref, base);

// Au démarrage : reprendre les attentes en cours (redéploiement Render).
async function reprendre() {
    const l = await store.lireReglage(CLE, {}) || {};
    for (const [ref, b] of Object.entries(l)) minuter(ref, (b.depuis || 0) + (b.attente || ATTENTE) - Date.now());
}

module.exports = { attendre, releveRecu, analyseRecue, maintenant, reprendre, ATTENTE };
