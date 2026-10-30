// Archivage automatique des demandes jamais traitées (décision du 30/10/2026) : une demande « Nouvelle » restée
// 7 jours sans appel, sans rendez-vous et sans drapeau « À appeler » ne nous intéresse pas. Elle passe « Sans suite »
// (archivée) et le vendeur reçoit l'e-mail de refus poli — le même que le bouton « Pas intéressé » de la fiche.
// Première passe au déploiement : tout l'existant est archivé SANS e-mail (trop ancien pour écrire au vendeur).
const store = require('./store');
const contact = require('./contact-client');

const DELAI_J = 7, MAX_MAILS_PAR_PASSE = 40;

function candidates(liste, maintenant = Date.now()) {
    return liste.filter(d => {
        const s = d.suivi || {};
        return d.statut === 'nouvelle' && !s.archivee && !Number(s.nb_appels) && !(s.appels || []).length && !s.rdv && !s.a_appeler
            && maintenant - new Date(d.created_at).getTime() >= DELAI_J * 864e5;
    });
}

// Archive une demande ; envoie l'e-mail de refus si demandé et si le vendeur a une adresse valide.
async function archiver(d, { mail }) {
    const email = String((d.data || {}).email || '').trim();
    let m = null, erreur = '';
    if (mail && contact.emailValide(email)) {
        try { const r = contact.refus(d); m = await contact.envoyer(d, { objet: r.objet, texte: r.texte, type: 'pas_interesse' }); }
        catch (e) { erreur = e.message; }
    }
    const frais = (await store.lireDemande(d.ref)) || d;
    const suivi = { ...frais.suivi }, histo = [...(suivi.historique || [])], maintenant = new Date().toISOString();
    if (m) { suivi.emails = contact.fusionEmails(suivi.emails, [m]); histo.unshift({ date: m.date, type: 'email', quoi: `E-mail de refus envoyé au client : ${m.objet}` }); }
    histo.unshift({ date: maintenant, quoi: `Archivée automatiquement : ${DELAI_J} jours sans appel ni rendez-vous · ${m ? 'vendeur prévenu par e-mail' : mail ? (erreur ? 'e-mail non envoyé (' + erreur.slice(0, 80) + ')' : 'pas d\'adresse e-mail valide, vendeur non prévenu') : 'sans e-mail (première passe)'}` });
    histo.unshift({ date: maintenant, quoi: `Statut : ${store.STATUTS.sans_suite}` });
    suivi.motif_fin = 'non_retenue'; suivi.rappel_le = ''; suivi.a_appeler = false; suivi.archivee = true; suivi.archivee_auto = maintenant;
    suivi.historique = histo.slice(0, 300);
    await store.majDemande(d.ref, { statut: 'sans_suite', suivi });
    return { ref: d.ref, mail: !!m, erreur };
}

// Une passe : mail = true (quotidien) ou false (première passe sur l'existant).
async function tourner({ mail = true } = {}) {
    const liste = candidates(await store.listerDemandes());
    const faits = [];
    let mails = 0;
    for (const d of liste) {
        const envoyer = mail && mails < MAX_MAILS_PAR_PASSE;
        const r = await archiver(d, { mail: envoyer }).catch(e => ({ ref: d.ref, mail: false, erreur: e.message }));
        if (r.mail) mails++;
        faits.push(r);
    }
    if (faits.length) console.log(`🗄️ Archivage auto : ${faits.length} demande(s), ${mails} e-mail(s) de refus${mail ? '' : ' (première passe, sans e-mail)'}`);
    return { archivees: faits.length, mails, refs: faits.map(f => f.ref) };
}

// Planification : première passe sans e-mail (une seule fois), puis chaque jour à partir de 9 h (heure de Paris).
function planifier({ notifier } = {}) {
    const heureParis = () => Number(new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }));
    const jourParis = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
    const passe = async () => {
        const etat = await store.lireReglage('archivage_auto', {});
        if (!etat.premiere_passe) {
            const r = await tourner({ mail: false });
            await store.ecrireReglage('archivage_auto', { ...etat, premiere_passe: jourParis(), dernier_jour: jourParis() });
            if (r.archivees && notifier) notifier({ titre: `🗄️ ${r.archivees} demandes anciennes archivées`, texte: 'Sans appel depuis plus de 7 jours · aucun e-mail envoyé pour cette première passe' }).catch(() => {});
            return;
        }
        if (heureParis() < 9 || etat.dernier_jour === jourParis()) return;
        await store.ecrireReglage('archivage_auto', { ...etat, dernier_jour: jourParis() });
        const r = await tourner({ mail: true });
        if (r.archivees && notifier) notifier({ titre: `🗄️ ${r.archivees} demande${r.archivees > 1 ? 's' : ''} archivée${r.archivees > 1 ? 's' : ''} automatiquement`, texte: `${r.mails} vendeur${r.mails > 1 ? 's' : ''} prévenu${r.mails > 1 ? 's' : ''} par e-mail de refus (7 jours sans appel)` }).catch(() => {});
    };
    setTimeout(() => passe().catch(e => console.error('Archivage auto :', e.message)), 45 * 1000).unref();
    setInterval(() => passe().catch(e => console.error('Archivage auto :', e.message)), 20 * 60 * 1000).unref();
}

module.exports = { candidates, archiver, tourner, planifier, DELAI_J };
