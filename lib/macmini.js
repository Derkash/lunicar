// État du Mac mini (collecte Sonar + analyse approfondie), visible dans l'admin (23/11/2026).
// Le Mac mini envoie un battement à chaque tour (toutes les minutes environ) : Chrome, session Leboncoin, collecte,
// analyse, clé Claude. Tout autre contact (file, relevé, analyse) compte aussi comme signe de vie.
// Silence de plus de 15 min : notification « Mac mini hors ligne », puis « de retour » quand il revient.
const store = require('./store');
const push = require('./push');

const CLE = 'macmini_etat';
const RETARD_MS = 3 * 60e3, HORS_LIGNE_MS = 15 * 60e3;
let etat = null, sauve = 0;

async function charger() {
    if (etat) return etat;
    etat = (await store.lireReglage(CLE, null).catch(() => null)) || { dernier: 0, info: {}, alerte: false };
    return etat;
}
async function persister(force) {
    if (!force && Date.now() - sauve < 60e3) return;
    sauve = Date.now();
    await store.ecrireReglage(CLE, etat).catch(() => {});
}

// Battement complet envoyé par veille.js.
async function battement(info = {}) {
    await charger();
    const s = (v, m = 200) => String(v == null ? '' : v).slice(0, m);
    etat.dernier = Date.now();
    etat.info = {
        lbc: ['connecte', 'deconnecte', 'inconnu'].includes(info.lbc) ? info.lbc : 'inconnu', chrome: !!info.chrome,
        collecte: s(info.collecte, 300), analyse: !!info.analyse, cle_claude: !!info.cle_claude, version: s(info.version, 40),
        derniere_erreur: s(info.derniere_erreur), derniere_erreur_le: s(info.derniere_erreur_le, 30), derniere_analyse: s(info.derniere_analyse, 200),
        depuis: s(info.depuis, 30), machine: s(info.machine, 60)
    };
    await revenu();
    await persister();
}
// Contact quelconque (file, relevé) : signe de vie sans détail.
async function toucher() { await charger(); etat.dernier = Date.now(); await revenu(); await persister(); }

async function revenu() {
    if (!etat.alerte) return;
    etat.alerte = false;
    await persister(true);
    push.notifier({ titre: '✅ Mac mini de retour', texte: 'La collecte Sonar et l\'analyse des demandes reprennent.', onglet: 'marche' }).catch(() => {});
}

async function statut() {
    await charger();
    const age = etat.dernier ? Date.now() - etat.dernier : null;
    const niveau = age == null ? 'jamais' : age < RETARD_MS ? 'ok' : age < HORS_LIGNE_MS ? 'retard' : 'hors_ligne';
    const i = etat.info || {};
    const problemes = [];
    if (niveau === 'hors_ligne' || niveau === 'jamais') problemes.push(niveau === 'jamais' ? 'Aucun signal reçu du Mac mini' : 'Aucun signal depuis plus de 15 min (éteint, en veille, session fermée ou réseau coupé)');
    else {
        if (i.lbc === 'deconnecte') problemes.push('Leboncoin déconnecté : reconnecter le compte pro dans le Chrome du Mac mini');
        if (!i.chrome) problemes.push('Chrome de collecte non joignable');
        if (!i.analyse) problemes.push('Analyse approfondie non installée (tools/macmini/installer-analyse.sh)');
        else if (!i.cle_claude) problemes.push('Clé Claude absente : textes et fiches moteur non analysés');
    }
    let attente = 0;
    try { attente = Object.keys((await store.lireReglage('notif_attente', {})) || {}).length; } catch (e) { /* rien */ }
    return { niveau, dernier: etat.dernier ? new Date(etat.dernier).toISOString() : null, age_s: age == null ? null : Math.round(age / 1000), info: i, problemes, notifications_en_attente: attente };
}

// Surveillance : une notification quand il se tait plus de 15 min (une seule fois), une autre à son retour.
async function surveiller() {
    await charger();
    if (!etat.dernier || etat.alerte) return;
    if (Date.now() - etat.dernier > HORS_LIGNE_MS) {
        etat.alerte = true;
        await persister(true);
        const h = new Date(etat.dernier).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
        push.notifier({ titre: '⚠️ Mac mini hors ligne', texte: `Plus de signal depuis ${h} : Sonar et l'analyse des demandes sont arrêtés. Vérifier qu'il est allumé, session ouverte et connecté au réseau.`, onglet: 'marche' }).catch(() => {});
    }
}
function planifier() {
    const t = setInterval(() => surveiller().catch(() => {}), 2 * 60e3);
    t.unref && t.unref();
}

module.exports = { battement, toucher, statut, surveiller, planifier };
