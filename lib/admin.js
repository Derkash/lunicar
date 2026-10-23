// API de l'espace admin (/admino) : demandes, suivi, estimations, photos par dossier, import Gmail.
const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const store = require('./store');
const estimation = require('./estimation');
const gmail = require('./gmail-import');
const fichePlaque = require('./vehicule');
const assistant = require('./assistant');
const relances = require('./relances');
const push = require('./push');
const compta = require('./compta');
const calendrier = require('./calendrier');
const ocr = require('./ocr');
const cession = require('./cession');
const contact = require('./contact-client');
const veille = require('./veille');
const annonces = require('./annonces');
const { origine, canal } = require('./origine');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024, files: 30 },
    fileFilter: (req, f, cb) => cb(null, /^(image\/|application\/pdf)/.test(f.mimetype))
});

let importEnCours = null;

module.exports = function adminRouter(authAdmin) {
    const r = express.Router();
    r.use('/api/admin', authAdmin);
    const ok = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
        console.error('Admin :', e.message);
        res.status(500).json({ error: e.message });
    });

    r.get('/api/admin/etat', ok(async (req, res) => {
        res.json({
            stockage: store.distant ? 'supabase' : store.disque ? 'disque' : 'local',
            estimation: estimation.etat(),
            email: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
            import_gmail: { en_cours: !!importEnCours, dernier: await store.lireReglage('gmail_import', null) },
            statuts: store.STATUTS,
            resultats: Object.fromEntries(Object.entries(relances.RESULTATS).map(([k, v]) => [k, v.libelle])),
            aujourdhui: relances.aujourdhui()
        });
    }));

    // ---------------- Notifications de l'app iOS
    r.post('/api/admin/push', ok(async (req, res) => {
        await push.enregistrer((req.body || {}).token, { nom: (req.body || {}).nom });
        res.json({ success: true, actif: push.actif() });
    }));

    // ---------------- Demandes
    // Chaque demande porte son canal (pub, google, ia, autres, inconnu) pour le tableau de bord.
    r.get('/api/admin/demandes', ok(async (req, res) => res.json((await store.listerDemandes()).map(d => {
        const x = d.data || {};
        return { ...d, canal: canal(x), origine_txt: x.origine || (x.provenance || x.clic_ads ? origine(x) : '') };
    }))));

    r.get('/api/admin/demandes/:ref', ok(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        return d ? res.json(d) : res.status(404).json({ error: 'Demande introuvable' });
    }));

    // Suivi : statut, notes, offre faite, prix d'achat, prix retenus à la main. Chaque changement est historisé.
    // Contact ou offre : on relance le vendeur 4 jours ouvrés plus tard (le décompte repart à chaque échange).
    const programmer = (suivi, histo) => {
        // Un rappel convenu avec le client (date à venir) n'est pas écrasé par la relance automatique.
        if (suivi.rappel_convenu && String(suivi.rappel_le || '').slice(0, 10) >= relances.aujourdhui()) return;
        suivi.rappel_convenu = false; suivi.rappel_heure = '';
        suivi.rappel_le = relances.ajouterJoursOuvres(relances.aujourdhui(), relances.DELAI);
        histo.unshift({ date: new Date().toISOString(), quoi: `Relance programmée le ${suivi.rappel_le.split('-').reverse().join('/')}` });
    };

    r.patch('/api/admin/demandes/:ref', ok(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        if (!d) return res.status(404).json({ error: 'Demande introuvable' });
        const b = req.body || {};
        const suivi = { ...d.suivi };
        const histo = [...(suivi.historique || [])];
        const champs = {};
        // Une demande achetée ne change plus de statut (le suivi continue dans « Nos véhicules »).
        if (b.statut && d.statut === 'achetee' && b.statut !== 'achetee') return res.status(400).json({ error: 'Véhicule déjà acheté : le statut ne peut plus revenir en arrière' });
        if (b.statut && store.STATUTS[b.statut] && b.statut !== d.statut) {
            champs.statut = b.statut;
            histo.unshift({ date: new Date().toISOString(), quoi: `Statut : ${store.STATUTS[b.statut]}` });
            // Contact établi ou offre faite : relance automatique à J+4 ouvrés (sauf date choisie à la main).
            if (['contactee', 'offre'].includes(b.statut) && b.rappel_le === undefined) programmer(suivi, histo);
            if (!relances.ACTIFS.includes(b.statut)) suivi.rappel_le = '';
            if (b.statut === 'sans_suite' && !suivi.archivee) { suivi.archivee = true; histo.unshift({ date: new Date().toISOString(), quoi: 'Archivée' }); }
        }
        // Drapeau « À appeler » : la demande remonte en tête de liste jusqu'au prochain appel enregistré.
        if (typeof b.a_appeler === 'boolean' && b.a_appeler !== !!suivi.a_appeler) {
            suivi.a_appeler = b.a_appeler;
            histo.unshift({ date: new Date().toISOString(), quoi: b.a_appeler ? 'Marquée « À appeler »' : 'Drapeau « À appeler » retiré' });
        }
        const LIB = { offre: 'Offre faite', prix_achat: 'Prix d\'achat final', rappel_le: 'Relance prévue le', prix_manuel_max: 'Prix max retenu', prix_manuel_vente: 'Prix de vente retenu' };
        const lisible = (k, v) => !v ? 'effacé' : k === 'rappel_le' ? String(v).slice(0, 10).split('-').reverse().join('/') : `${Number(v).toLocaleString('fr-FR')} €`;
        if (b.rappel_le !== undefined && String(b.rappel_le || '').slice(0, 10) !== String(suivi.rappel_le || '').slice(0, 10)) { suivi.rappel_convenu = false; suivi.rappel_heure = ''; }
        for (const k of ['notes', 'offre', 'prix_achat', 'rappel_le', 'prix_manuel_max', 'prix_manuel_vente']) {
            if (b[k] === undefined) continue;
            const v = typeof b[k] === 'string' ? b[k].slice(0, 5000) : b[k];
            if (k !== 'notes' && String(v) !== String(suivi[k] || '')) histo.unshift({ date: new Date().toISOString(), quoi: `${LIB[k]}${k === 'rappel_le' ? '' : ' :'} ${lisible(k, v)}` });
            suivi[k] = v;
        }
        // Nouvelle offre saisie : statut « Offre faite » et relance à J+4 ouvrés (sauf date de relance changée à la main).
        const nouvelleOffre = b.offre !== undefined && String(b.offre || '') && String(b.offre) !== String((d.suivi || {}).offre || '');
        const rappelManuel = b.rappel_le !== undefined && String(b.rappel_le || '') !== String((d.suivi || {}).rappel_le || '').slice(0, 10);
        if (nouvelleOffre && ['nouvelle', 'contactee'].includes(champs.statut || d.statut)) {
            champs.statut = 'offre';
            histo.unshift({ date: new Date().toISOString(), quoi: `Statut : ${store.STATUTS.offre}` });
        }
        if (nouvelleOffre && relances.ACTIFS.includes(champs.statut || d.statut) && !rappelManuel) programmer(suivi, histo);
        suivi.historique = histo.slice(0, 300);
        const maj = await store.majDemande(d.ref, { ...champs, suivi });
        // Achetée : le véhicule entre dans la compta (une seule fois) ; le prix d'achat saisi ensuite le complète.
        const v = await compta.syncDemande(maj).catch(e => { console.error('Compta :', e.message); return null; });
        if (v && v.id && maj.statut === 'achetee' && b.prix_achat !== undefined && Number(b.prix_achat) && !Number(v.prix_achat)) await compta.majVehicule(v.id, { prix_achat: b.prix_achat }).catch(() => {});
        res.json(maj);
    }));

    // Note de suivi : ajoutée au fil (les notes ne s'écrasent plus).
    r.post('/api/admin/demandes/:ref/note', ok(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        if (!d) return res.status(404).json({ error: 'Demande introuvable' });
        const texte = String((req.body || {}).texte || '').trim().slice(0, 5000);
        if (!texte) return res.status(400).json({ error: 'Note vide' });
        const suivi = { ...d.suivi };
        const histo = [{ date: new Date().toISOString(), quoi: texte, type: 'note' }, ...(suivi.historique || [])];
        const champs = {};
        // Une note = un échange avec le vendeur : « Nouvelle » passe à « Contactée », et le décompte de relance repart à J+4 ouvrés.
        if (d.statut === 'nouvelle') {
            champs.statut = 'contactee';
            histo.unshift({ date: new Date().toISOString(), quoi: `Statut : ${store.STATUTS.contactee}` });
        }
        if (relances.ACTIFS.includes(champs.statut || d.statut) && !suivi.archivee) programmer(suivi, histo);
        suivi.historique = histo.slice(0, 300);
        res.json(await store.majDemande(d.ref, { ...champs, suivi }));
    }));

    // ---------------- E-mails au client (fil de conversation de la fiche). Rien ne part sans clic de l'admin.
    const essai = fn => async (req, res) => {
        try { await fn(req, res); } catch (e) {
            if (!e.status) console.error('E-mail client :', e.message);
            res.status(e.status || 500).json({ error: e.message });
        }
    };
    const fusionEmails = (avant, ajout) => {
        const vus = new Set((avant || []).map(m => m.message_id || m.id));
        return [...ajout.filter(m => !vus.has(m.message_id || m.id)), ...(avant || [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 200);
    };

    r.get('/api/admin/demandes/:ref/email', ok(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        if (!d) return res.status(404).json({ error: 'Demande introuvable' });
        res.json({ etat: contact.etat(), objet: contact.objetPar(d), modeles: contact.modeles(d), refus: contact.refus(d),
            email_valide: contact.emailValide(String((d.data || {}).email || '').trim()), limites: { objet: contact.LIMITE_OBJET, texte: contact.LIMITE_TEXTE } });
    }));

    // Message libre (modèles insérables côté interface). Un e-mail envoyé = un échange : « Nouvelle » passe à « Contactée », relance à J+4 ouvrés.
    r.post('/api/admin/demandes/:ref/email', essai(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        if (!d) return res.status(404).json({ error: 'Demande introuvable' });
        const b = req.body || {};
        const m = await contact.envoyer(d, { objet: b.objet, texte: b.texte, type: 'libre' });
        const frais = (await store.lireDemande(d.ref)) || d;
        const suivi = { ...frais.suivi }, histo = [...(suivi.historique || [])], champs = {};
        suivi.emails = fusionEmails(suivi.emails, [m]);
        histo.unshift({ date: m.date, type: 'email', quoi: `E-mail envoyé au client : ${m.objet}` });
        if (frais.statut === 'nouvelle') { champs.statut = 'contactee'; histo.unshift({ date: m.date, quoi: `Statut : ${store.STATUTS.contactee}` }); }
        if (relances.ACTIFS.includes(champs.statut || frais.statut) && !suivi.archivee) programmer(suivi, histo);
        suivi.historique = histo.slice(0, 300);
        res.json(await store.majDemande(d.ref, { ...champs, suivi }));
    }));

    // Aperçu d'un message à des adresses internes (rien n'est historisé, le statut ne bouge pas).
    r.post('/api/admin/demandes/:ref/email/apercu', essai(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        if (!d) return res.status(404).json({ error: 'Demande introuvable' });
        const b = req.body || {};
        res.json(await contact.apercu(d, { objet: b.objet, texte: b.texte, a: b.a }));
    }));

    // « Pas intéressé » : e-mail de refus (texte relu et modifiable), puis statut « Sans suite ».
    // Si l'e-mail ne part pas, rien ne change, sauf choix explicite « marquer sans envoyer » (sans_envoi).
    r.post('/api/admin/demandes/:ref/pas-interesse', essai(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        if (!d) return res.status(404).json({ error: 'Demande introuvable' });
        if (d.statut === 'achetee') return res.status(400).json({ error: 'Véhicule déjà acheté : il ne peut plus passer « Sans suite »' });
        const b = req.body || {};
        const m = b.sans_envoi === true ? null : await contact.envoyer(d, { objet: b.objet, texte: b.texte, type: 'pas_interesse' });
        const frais = (await store.lireDemande(d.ref)) || d;
        const suivi = { ...frais.suivi }, histo = [...(suivi.historique || [])], champs = {}, maintenant = new Date().toISOString();
        if (m) {
            suivi.emails = fusionEmails(suivi.emails, [m]);
            histo.unshift({ date: m.date, type: 'email', quoi: `E-mail de refus envoyé au client : ${m.objet}` });
        }
        histo.unshift({ date: maintenant, quoi: m ? 'Pas intéressé : véhicule non retenu, client prévenu par e-mail' : 'Pas intéressé : véhicule non retenu, classée sans e-mail au client' });
        if (frais.statut !== 'sans_suite') { champs.statut = 'sans_suite'; histo.unshift({ date: maintenant, quoi: `Statut : ${store.STATUTS.sans_suite}` }); }
        if (suivi.rdv && suivi.rdv.statut === 'prevu') {
            suivi.rdv = { ...suivi.rdv, statut: 'annule', motif: 'Véhicule non retenu', maj: maintenant };
            histo.unshift({ date: maintenant, quoi: 'Rendez-vous annulé (véhicule non retenu)' });
        }
        suivi.motif_fin = 'non_retenue';
        suivi.rappel_le = ''; suivi.a_appeler = false;
        // Sans suite = archivée (sort de la liste de travail, reste dans « Archivées »).
        if (!suivi.archivee) { suivi.archivee = true; histo.unshift({ date: maintenant, quoi: 'Archivée' }); }
        suivi.historique = histo.slice(0, 300);
        const maj = await store.majDemande(d.ref, { ...champs, suivi });
        await compta.syncDemande(maj).catch(e => console.error('Compta :', e.message));
        res.json(maj);
    }));

    // Réponses du client : lues dans la boîte IMAP de contact et ajoutées au fil (sans doublon).
    r.post('/api/admin/demandes/:ref/email/reponses', essai(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        if (!d) return res.status(404).json({ error: 'Demande introuvable' });
        const recus = await contact.lireReponses(d);
        const frais = (await store.lireDemande(d.ref)) || d;
        const avant = (frais.suivi || {}).emails || [];
        const emails = fusionEmails(avant, recus);
        const nouveaux = emails.length - avant.length;
        const suivi = { ...frais.suivi, emails, reponses_lues: new Date().toISOString() };
        if (nouveaux) suivi.historique = [{ date: new Date().toISOString(), type: 'email', quoi: `${nouveaux} réponse${nouveaux > 1 ? 's' : ''} du client récupérée${nouveaux > 1 ? 's' : ''}` }, ...(suivi.historique || [])].slice(0, 300);
        res.json({ ...(await store.majDemande(d.ref, { suivi })), nouveaux });
    }));

    // ---------------- Rendez-vous (fixé au téléphone : date, heure, lieu, prix convenu, qui y va)
    const jj = iso => String(iso || '').slice(0, 10).split('-').reverse().join('/');
    const AVEC = { abdoul: 'Abdoul-Khader', youssouf: 'Youssouf', deux: 'Les deux' };
    r.post('/api/admin/demandes/:ref/rdv', ok(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        if (!d) return res.status(404).json({ error: 'Demande introuvable' });
        const b = req.body || {};
        if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || !/^\d{2}:\d{2}$/.test(b.heure || '')) return res.status(400).json({ error: 'Date et heure du rendez-vous obligatoires' });
        const suivi = { ...d.suivi }, histo = [...(suivi.historique || [])], champs = {}, maintenant = new Date().toISOString();
        const avant = suivi.rdv && suivi.rdv.statut === 'prevu' ? suivi.rdv : null;
        const prix = Math.max(0, Math.round(Number(String(b.prix || '').replace(',', '.')) || 0));
        suivi.rdv = {
            date: b.date, heure: b.heure, duree: Math.min(240, Math.max(15, parseInt(b.duree, 10) || 45)),
            lieu: String(b.lieu || '').trim().slice(0, 300), prix, avec: AVEC[b.avec] ? b.avec : 'abdoul',
            note: String(b.note || '').trim().slice(0, 1000), statut: 'prevu', cree_le: avant ? avant.cree_le : maintenant, maj: maintenant
        };
        histo.unshift({ date: maintenant, quoi: `${avant ? 'Rendez-vous déplacé' : 'Rendez-vous fixé'} : ${jj(b.date)} à ${b.heure}${prix ? ` · prix convenu ${prix.toLocaleString('fr-FR')} €` : ''} · ${AVEC[suivi.rdv.avec]}` });
        if (prix && String(prix) !== String(suivi.offre || '')) { suivi.offre = prix; histo.unshift({ date: maintenant, quoi: `Offre faite : ${prix.toLocaleString('fr-FR')} €` }); }
        if (!['achetee'].includes(d.statut) && d.statut !== 'rdv') { champs.statut = 'rdv'; histo.unshift({ date: maintenant, quoi: `Statut : ${store.STATUTS.rdv}` }); }
        // Appel de confirmation la veille (jour ouvré), plus de relance automatique d'ici là.
        const veille = (() => { let x = new Date(b.date + 'T12:00:00Z'); do { x = new Date(x.getTime() - 864e5); } while (!relances.ouvre(x.toISOString().slice(0, 10))); return x.toISOString().slice(0, 10); })();
        suivi.rappel_le = veille >= relances.aujourdhui() ? veille : '';
        suivi.a_appeler = false;
        suivi.historique = histo.slice(0, 300);
        const maj = await store.majDemande(d.ref, { ...champs, suivi });
        await compta.syncDemande(maj).catch(e => console.error('Compta :', e.message));
        res.json(maj);
    }));

    // Rendez-vous fait (voiture achetée ou non) ou annulé.
    r.patch('/api/admin/demandes/:ref/rdv', ok(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        if (!d || !(d.suivi || {}).rdv) return res.status(404).json({ error: 'Rendez-vous introuvable' });
        const b = req.body || {}, suivi = { ...d.suivi }, histo = [...(suivi.historique || [])], champs = {}, maintenant = new Date().toISOString();
        if (!['fait', 'annule'].includes(b.statut)) return res.status(400).json({ error: 'Statut inconnu' });
        suivi.rdv = { ...suivi.rdv, statut: b.statut, maj: maintenant, ...(b.motif ? { motif: String(b.motif).slice(0, 300) } : {}) };
        if (b.statut === 'fait' && b.achetee) {
            const prix = Math.round(Number(String(b.prix_achat || suivi.rdv.prix || '').replace(',', '.')) || 0);
            if (prix) suivi.prix_achat = prix;
            champs.statut = 'achetee'; suivi.rappel_le = '';
            histo.unshift({ date: maintenant, quoi: `Rendez-vous fait : voiture achetée${prix ? ` ${prix.toLocaleString('fr-FR')} €` : ''}` }, { date: maintenant, quoi: `Statut : ${store.STATUTS.achetee}` });
        } else if (b.statut === 'fait') {
            histo.unshift({ date: maintenant, quoi: `Rendez-vous fait, pas d'achat${b.motif ? ` (${b.motif})` : ''}` });
            suivi.rappel_le = relances.ajouterJoursOuvres(relances.aujourdhui(), 2);
            if (d.statut === 'rdv') champs.statut = 'offre';
        } else {
            histo.unshift({ date: maintenant, quoi: `Rendez-vous annulé${b.motif ? ` (${b.motif})` : ''}` });
            suivi.rappel_le = relances.ajouterJoursOuvres(relances.aujourdhui(), 1);
            if (d.statut === 'rdv') champs.statut = 'offre';
        }
        suivi.historique = histo.slice(0, 300);
        const maj = await store.majDemande(d.ref, { ...champs, suivi });
        await compta.syncDemande(maj).catch(e => console.error('Compta :', e.message));
        res.json(maj);
    }));

    // Un rendez-vous en .ics (bouton « Ajouter au calendrier » de la fiche).
    r.get('/api/admin/demandes/:ref/rdv.ics', ok(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        if (!d || !(d.suivi || {}).rdv) return res.status(404).send('Rendez-vous introuvable');
        res.type('text/calendar; charset=utf-8').set('Content-Disposition', `attachment; filename="rdv-${d.ref}.ics"`).send(calendrier.ics([d]));
    }));

    // Journal d'appel : résultat -> statut, historique et prochaine relance (jours ouvrés).
    r.post('/api/admin/demandes/:ref/appel', ok(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        if (!d) return res.status(404).json({ error: 'Demande introuvable' });
        const res_ = relances.RESULTATS[(req.body || {}).resultat];
        if (!res_) return res.status(400).json({ error: 'Résultat inconnu' });
        const b = req.body || {};
        const note = String(b.note || '').trim().slice(0, 4000);
        // L'appel est passé : le drapeau « À appeler » tombe.
        const suivi = { ...d.suivi, a_appeler: false, nb_appels: (Number((d.suivi || {}).nb_appels) || 0) + 1, dernier_appel: new Date().toISOString() };
        if (!suivi.premier_contact && req.body.resultat !== 'injoignable') suivi.premier_contact = suivi.dernier_appel;
        const champs = {};
        let statut = res_.statut;
        if (!statut && d.statut === 'nouvelle' && req.body.resultat !== 'injoignable') statut = 'contactee';
        if (statut && statut !== d.statut) champs.statut = statut;
        suivi.rappel_le = res_.relance ? relances.ajouterJoursOuvres(relances.aujourdhui(), res_.relance) : '';
        // Rappel convenu avec le client : la date (et l'heure) saisies remplacent la relance automatique.
        let convenu = '';
        if (res_.dateConvenue) {
            const jour = /^\d{4}-\d{2}-\d{2}$/.test(String(b.rappel_date || '')) ? b.rappel_date : '';
            if (!jour || jour < relances.aujourdhui()) return res.status(400).json({ error: 'Indiquez la date du rappel convenu (aujourd\'hui ou plus tard).' });
            const heure = /^\d{2}:\d{2}$/.test(String(b.rappel_heure || '')) ? b.rappel_heure : '';
            suivi.rappel_le = jour; suivi.rappel_heure = heure; suivi.rappel_convenu = true;
            convenu = `rappel convenu le ${jour.split('-').reverse().join('/')}${heure ? ` à ${heure.replace(':', ' h ')}` : ''}`;
        } else { suivi.rappel_heure = ''; suivi.rappel_convenu = false; }
        const histo = [...(suivi.historique || [])], maintenant = new Date().toISOString();
        // Informations corrigées au téléphone : elles remplacent celles du formulaire (anciennes valeurs gardées).
        const CORR = { kilometrage: 'Kilométrage', prix_souhaite: 'Prix souhaité', mecanique: 'État mécanique', controle_technique: 'Contrôle technique', carrosserie: 'Carrosserie', delai: 'Vendre quand', annee: 'Année' };
        const data = { ...d.data }, faites = [];
        for (const [k, lib] of Object.entries(CORR)) {
            const v = b.corrections && b.corrections[k] !== undefined ? String(b.corrections[k]).trim().slice(0, 200) : '';
            if (!v || v === String(data[k] || '')) continue;
            faites.push(`${lib} : ${data[k] || '—'} → ${v}`);
            data.corrections = [...(data.corrections || []), { champ: k, avant: data[k] || '', apres: v, date: maintenant }].slice(-50);
            data[k] = k === 'kilometrage' || k === 'prix_souhaite' ? v.replace(/[^\d]/g, '') : v;
        }
        const offre = Math.round(Number(String(b.offre || '').replace(/[^\d.]/g, '')) || 0);
        if (offre && String(offre) !== String(suivi.offre || '')) {
            suivi.offre = offre; histo.unshift({ date: maintenant, quoi: `Offre faite : ${offre.toLocaleString('fr-FR')} €` });
            if (['nouvelle', 'contactee'].includes(champs.statut || d.statut) && !res_.statut) champs.statut = 'offre';
        }
        suivi.appels = [{ date: maintenant, resultat: b.resultat, libelle: convenu ? `Rappel prévu · ${convenu.replace('rappel convenu ', '')}` : res_.libelle, texte: note, corrections: faites, offre: offre || null }, ...(suivi.appels || [])].slice(0, 50);
        histo.unshift({ date: maintenant, type: 'appel', quoi: `Appel : ${res_.libelle}${convenu ? ` · ${convenu}` : suivi.rappel_le ? ` · relance le ${suivi.rappel_le.split('-').reverse().join('/')}` : ''}`, texte: note, corrections: faites });
        suivi.historique = histo.slice(0, 300);
        const maj = await store.majDemande(d.ref, { ...champs, suivi, ...(faites.length ? { data } : {}) });
        // Estimation remise à jour avec ce qui a été dit (sur demande).
        if (b.reestimer && estimation.actif() && (maj.data || {}).vehicule) estimation.planifier(maj.ref);
        await compta.syncDemande(maj).catch(() => {});
        res.json(maj);
    }));

    // Actions groupées sur une sélection de demandes.
    r.post('/api/admin/lot', ok(async (req, res) => {
        const { refs, action, valeur } = req.body || {};
        if (!Array.isArray(refs) || !refs.length || refs.length > 1000) return res.status(400).json({ error: 'Sélection vide' });
        let n = 0, envoyes = 0;
        const echecs = [];
        for (const ref of refs) {
            const d = await store.lireDemande(ref);
            if (!d) continue;
            const suivi = { ...d.suivi };
            const histo = [...(suivi.historique || [])];
            const noter = quoi => histo.unshift({ date: new Date().toISOString(), quoi });
            if (action === 'supprimer') { await store.supprimerDemande(d.ref); n++; continue; }
            if (action === 'estimer') { if (estimation.actif() && (d.data || {}).vehicule) { estimation.planifier(d.ref); n++; } continue; }
            const champs = {};
            if (action === 'statut' && d.statut === 'achetee') continue; // achetée : statut figé
            if (action === 'statut' && valeur === 'sans_suite') {
                const dejaPrevenu = (suivi.emails || []).some(m => m.type === 'pas_interesse');
                if (!dejaPrevenu && contact.emailValide(((d.data || {}).email || '').trim())) {
                    try {
                        const t = contact.refus(d);
                        const m = await contact.envoyer(d, { objet: t.objet, texte: t.texte, type: 'pas_interesse' });
                        suivi.emails = fusionEmails(suivi.emails, [m]);
                        histo.unshift({ date: m.date, type: 'email', quoi: `E-mail de refus envoyé au client : ${m.objet}` });
                        envoyes++;
                    } catch (e) { echecs.push(`${d.ref} : ${e.message}`); continue; }
                }
                if (d.statut !== 'sans_suite') { champs.statut = 'sans_suite'; noter(`Statut : ${store.STATUTS.sans_suite} (action groupée)`); }
                suivi.motif_fin = 'non_retenue'; suivi.rappel_le = ''; suivi.a_appeler = false;
                if (suivi.rdv && suivi.rdv.statut === 'prevu') { suivi.rdv = { ...suivi.rdv, statut: 'annule', motif: 'Véhicule non retenu' }; noter('Rendez-vous annulé (véhicule non retenu)'); }
                if (!suivi.archivee) { suivi.archivee = true; noter('Archivée'); }
            } else if (action === 'statut' && store.STATUTS[valeur] && valeur !== d.statut) {
                champs.statut = valeur; noter(`Statut : ${store.STATUTS[valeur]} (action groupée)`);
                if (['contactee', 'offre'].includes(valeur)) suivi.rappel_le = relances.ajouterJoursOuvres(relances.aujourdhui(), relances.DELAI);
                if (!relances.ACTIFS.includes(valeur)) suivi.rappel_le = '';
            } else if (action === 'rappel' && /^\d{4}-\d{2}-\d{2}$/.test(String(valeur || ''))) {
                suivi.rappel_le = valeur; noter(`Relance programmée le ${valeur.split('-').reverse().join('/')} (action groupée)`);
            } else if (action === 'appeler' || action === 'pas_appeler') {
                if (suivi.a_appeler === (action === 'appeler')) continue;
                suivi.a_appeler = action === 'appeler'; noter(suivi.a_appeler ? 'Marquée « À appeler » (action groupée)' : 'Drapeau « À appeler » retiré (action groupée)');
            } else if (action === 'archiver') { suivi.archivee = true; noter('Archivée');
            } else if (action === 'desarchiver') { suivi.archivee = false; noter('Désarchivée');
            } else continue;
            suivi.historique = histo.slice(0, 300);
            const maj = await store.majDemande(d.ref, { ...champs, suivi });
            if (champs.statut) await compta.syncDemande(maj).catch(() => {});
            n++;
        }
        res.json({ success: true, traitees: n, emails: envoyes, echecs });
    }));

    r.delete('/api/admin/demandes/:ref', ok(async (req, res) => res.json({ success: await store.supprimerDemande(req.params.ref) })));

    // ---------------- Estimations
    r.post('/api/admin/demandes/:ref/estimer', ok(async (req, res) => {
        if (!estimation.actif()) return res.status(400).json({ error: 'ANTHROPIC_API_KEY non défini sur le serveur' });
        const d = await store.lireDemande(req.params.ref);
        if (!d) return res.status(404).json({ error: 'Demande introuvable' });
        estimation.planifier(d.ref);
        res.status(202).json({ success: true });
    }));

    r.post('/api/admin/estimer-tout', ok(async (req, res) => {
        if (!estimation.actif()) return res.status(400).json({ error: 'ANTHROPIC_API_KEY non défini sur le serveur' });
        const max = Math.min(200, parseInt((req.body || {}).max, 10) || 20);
        const a = (await store.listerDemandes()).filter(d => !d.estimation && d.type !== 'rappel' && (d.data || {}).vehicule).slice(0, max);
        a.forEach(d => estimation.planifier(d.ref));
        res.status(202).json({ success: true, planifiees: a.length });
    }));

    r.get('/api/admin/reglages', ok(async (req, res) => res.json(await estimation.reglages())));
    r.put('/api/admin/reglages', ok(async (req, res) => {
        const b = req.body || {};
        const v = {};
        for (const k of Object.keys(estimation.REGLAGES_DEFAUT)) {
            if (b[k] === undefined || b[k] === '') continue;
            if (k === 'depart_cp') { if (/^\d{5}$/.test(String(b[k]).trim())) v[k] = String(b[k]).trim(); continue; }
            v[k] = Math.max(0, Number(String(b[k]).replace(',', '.')) || 0);
        }
        await store.ecrireReglage('estimation', v);
        res.json(await estimation.reglages());
    }));

    // ---------------- API plaque à la demande (consomme le quota du forfait)
    r.post('/api/admin/demandes/:ref/plaque', ok(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        if (!d) return res.status(404).json({ error: 'Demande introuvable' });
        const plaque = String((req.body || {}).plaque || (d.data || {}).plaque || '').toUpperCase();
        if (!plaque) return res.status(400).json({ error: 'Aucune plaque sur cette demande' });
        const r2 = await fichePlaque.ficheAdmin(plaque);
        if (r2.erreur) return res.status(400).json({ error: r2.erreur });
        const f = r2.fiche;
        const data = { ...d.data, plaque, fiche_api: r2.brut, vin: (r2.brut && r2.brut.vin) || d.data.vin || '',
            vehicule_siv: [f.marque, f.modele, f.version].filter(Boolean).join(' '), energie_siv: f.energie, boite_siv: f.boite,
            annee_siv: f.annee, puissance_siv: f.puissanceFiscale ? `${f.puissanceFiscale} CV` : '' };
        res.json({ ...(await store.majDemande(d.ref, { data })), quota: r2.quota });
    }));

    // ---------------- Assistant IA : pannes connues et questions libres
    r.post('/api/admin/demandes/:ref/assistant', ok(async (req, res) => {
        if (!assistant.actif()) return res.status(400).json({ error: 'ANTHROPIC_API_KEY non défini sur le serveur' });
        const d = await store.lireDemande(req.params.ref);
        if (!d) return res.status(404).json({ error: 'Demande introuvable' });
        const rep = await assistant.demander(d, (req.body || {}).question);
        const frais = await store.lireDemande(d.ref);
        const suivi = { ...frais.suivi, assistant: [rep, ...((frais.suivi || {}).assistant || [])].slice(0, 20) };
        res.json(await store.majDemande(d.ref, { suivi }));
    }));

    // ---------------- Photos (un dossier par demande)
    r.get('/api/admin/photo', ok(async (req, res) => {
        const { buffer, type } = await store.lirePhoto(String(req.query.path || ''));
        res.set('Cache-Control', 'private, max-age=3600').type(type).send(buffer);
    }));

    r.post('/api/admin/demandes/:ref/photos', upload.array('photos', 30), ok(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        if (!d) return res.status(404).json({ error: 'Demande introuvable' });
        const jour = new Date().toISOString().slice(0, 10);
        const ajout = [];
        for (const [i, f] of (req.files || []).entries()) ajout.push(await store.ajouterPhoto(d.dossier, `${jour}_admin_${Date.now()}_${i + 1}_${f.originalname}`, f.buffer));
        res.json(await store.majDemande(d.ref, { photos: [...(d.photos || []), ...ajout] }));
    }));

    // ---------------- Compta : véhicules achetés, dépenses, soldes entre associés
    const justif = upload.single('justificatif');
    r.get('/api/admin/compta', ok(async (req, res) => res.json(await compta.tout())));
    r.get('/api/admin/compta/export.csv', ok(async (req, res) => {
        res.attachment(`lunicar-compta-${new Date().toISOString().slice(0, 10)}.csv`).type('text/csv; charset=utf-8').send(await compta.csv());
    }));
    r.post('/api/admin/compta/vehicules', ok(async (req, res) => {
        const b = req.body || {};
        if (b.ref) { const d = await store.lireDemande(b.ref); const v = d && await compta.syncDemande(d); if (v && v.id) return res.json(v); }
        res.json(await compta.creerVehicule(b));
    }));
    r.patch('/api/admin/compta/vehicules/:id', ok(async (req, res) => {
        const v = await compta.majVehicule(req.params.id, req.body || {});
        // Prix d'achat saisi ici : reporté sur la demande d'origine pour que la fiche affiche le même chiffre.
        if (v.ref && (req.body || {}).prix_achat !== undefined) {
            const d = await store.lireDemande(v.ref);
            if (d && String((d.suivi || {}).prix_achat || '') !== String(v.prix_achat || '')) await store.majDemande(d.ref, { suivi: { ...d.suivi, prix_achat: v.prix_achat || '' } });
        }
        res.json(v);
    }));
    r.delete('/api/admin/compta/vehicules/:id', ok(async (req, res) => res.json({ success: await compta.supprimerVehicule(req.params.id) })));
    r.post('/api/admin/compta/depenses', justif, ok(async (req, res) => res.json(await compta.ajouterDepense(req.body || {}, req.file))));
    r.patch('/api/admin/compta/depenses/:id', justif, ok(async (req, res) => res.json(await compta.majDepense(req.params.id, req.body || {}, req.file))));
    // Note de frais : lecture automatique du justificatif (photo ou PDF) pour pré-remplir la saisie.
    r.post('/api/admin/compta/lire', justif, ok(async (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
        const c = await compta.tout();
        res.json(await ocr.lire(req.file, [...new Set([...c.categories.vehicule, ...c.categories.generales])]));
    }));
    // Documents d'un véhicule
    r.post('/api/admin/compta/vehicules/:id/documents', justif, ok(async (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
        res.json(await compta.ajouterDocument(req.params.id, (req.body || {}).type, req.file));
    }));
    r.delete('/api/admin/compta/vehicules/:id/documents', ok(async (req, res) => res.json(await compta.supprimerDocument(req.params.id, String(req.query.path || '')))));
    // Certificat de cession : données pré-remplies (véhicule, vendeur, société), puis PDF du Cerfa 15776*01.
    r.get('/api/admin/compta/vehicules/:id/cession', ok(async (req, res) => {
        const c = await compta.tout(), v = c.vehicules.find(x => x.id === req.params.id);
        if (!v) return res.status(404).json({ error: 'Véhicule introuvable' });
        const d = v.ref ? await store.lireDemande(v.ref) : null, x = (d && d.data) || {}, f = x.fiche_api || {}, soc = await compta.societe();
        const r1 = (d && d.suivi && d.suivi.rdv) || v.rdv || {};
        const dateIso = t => { const m = /(\d{2})[-/](\d{2})[-/](\d{4})/.exec(String(t || '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : /^\d{4}-\d{2}-\d{2}/.test(String(t || '')) ? String(t).slice(0, 10) : ''; };
        // Adresse du rendez-vous découpée comme sur le Cerfa (n°, extension, type de voie, nom, code postal, commune).
        const adr = String(r1.lieu || '').match(/^\s*(\d+)\s*(bis|ter)?\s*,?\s*(rue|avenue|boulevard|bd|chemin|allée|allee|place|impasse|route|quai|cours|square|villa|cité|cite|résidence|residence)?\s*([^,]*?)\s*,?\s*(\d{5})?\s*([^,\d]*)$/i);
        const auj = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
        res.json({
            immatriculation: v.plaque || x.plaque || '', vin: v.vin || x.vin || f.vin || '',
            date_immatriculation: dateIso(f.date1erCir_fr || f.date1erCir || ''), marque: String(f.marque || (x.vehicule || v.libelle || '').split(' ')[0] || '').toUpperCase(),
            type_version: f.type_mine || f.cnit || f.version || f.sra_commercial || '', genre: f.genreVCGNGC || f.genre || 'VP',
            denomination: f.modele || (x.vehicule || v.libelle || '').split(' ').slice(1).join(' '), kilometrage: v.kilometrage || x.kilometrage || '',
            certificat_present: true, numero_formule: x.numero_formule || '', date_certificat: '', motif_absence: '',
            vendeur_morale: false, vendeur_sexe: '', vendeur_nom: (x.nom_titulaire || [String(x.nom || '').toUpperCase(), x.prenom].filter(Boolean).join(' ')).trim(), vendeur_siret: '',
            vendeur_num: adr ? adr[1] || '' : '', vendeur_extension: adr ? adr[2] || '' : '', vendeur_type_voie: adr && adr[3] ? adr[3][0].toUpperCase() + adr[3].slice(1).toLowerCase() : '',
            vendeur_voie: adr ? adr[4] || '' : '', vendeur_cp: (adr && adr[5]) || x.code_postal || '', vendeur_commune: (adr && adr[6] && adr[6].trim()) || x.ville || '',
            date_vente: v.date_achat || r1.date || auj, heure_vente: r1.heure || new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }),
            destruction: false, certif_situation: true, sans_transformation: true, lieu_signature: (adr && adr[6] && adr[6].trim()) || x.ville || soc.lieu_signature,
            acheteur_nom: soc.raison, acheteur_siret: soc.siret, acheteur_num: soc.num, acheteur_extension: soc.extension, acheteur_type_voie: soc.type_voie,
            acheteur_voie: soc.voie, acheteur_cp: soc.cp, acheteur_commune: soc.commune
        });
    }));
    r.post('/api/admin/compta/vehicules/:id/cession', ok(async (req, res) => {
        const b = req.body || {}, c = await compta.tout(), v = c.vehicules.find(x => x.id === req.params.id);
        if (!v) return res.status(404).json({ error: 'Véhicule introuvable' });
        // Société : ce qui est saisi ici (SIRET compris) devient la valeur par défaut des prochaines cessions.
        await compta.majSociete({ raison: b.acheteur_nom, siret: b.acheteur_siret, num: b.acheteur_num, extension: b.acheteur_extension, type_voie: b.acheteur_type_voie, voie: b.acheteur_voie, cp: b.acheteur_cp, commune: b.acheteur_commune });
        const bool = k => b[k] === true || b[k] === 'true' || b[k] === 'on';
        const pdf = await cession.generer({ ...b, certificat_present: bool('certificat_present'), vendeur_morale: bool('vendeur_morale'), destruction: bool('destruction'), certif_situation: bool('certif_situation'), sans_transformation: bool('sans_transformation') });
        const nom = `certificat-cession-${String(b.immatriculation || v.plaque || v.id).replace(/[^\w-]/g, '')}.pdf`;
        // Rangé dans les documents du véhicule ; une nouvelle génération remplace la précédente.
        for (const dd of (v.documents || []).filter(x => x.type === 'cession_achat' && x.genere)) await compta.supprimerDocument(v.id, dd.path).catch(() => {});
        let w = await compta.ajouterDocument(v.id, 'cession_achat', { originalname: nom, buffer: pdf }, `${new Date().toISOString().slice(0, 10)}_${nom}`);
        const doc = w.documents[w.documents.length - 1];
        await compta.marquerGenere(v.id, doc.path);
        res.json({ ok: true, document: doc });
    }));
    // Annuler un achat ou une vente saisis par erreur (motif obligatoire, tracé dans l'historique de la demande).
    r.post('/api/admin/compta/vehicules/:id/annuler', ok(async (req, res) => {
        const motif = String((req.body || {}).motif || '').trim().slice(0, 300);
        if (!motif) return res.status(400).json({ error: 'Indiquez la raison de l\'annulation' });
        const avant = (await compta.tout()).vehicules.find(x => x.id === req.params.id);
        const { v, quoi } = await compta.annulerAchat(req.params.id);
        const ref = (avant && avant.ref) || null;
        if (ref && quoi === 'achat') {
            const d = await store.lireDemande(ref);
            if (d) {
                const suivi = { ...d.suivi, prix_achat: '' }, maintenant = new Date().toISOString();
                const histo = [{ date: maintenant, quoi: `Achat annulé (erreur) : ${motif}` }, ...(suivi.historique || [])];
                let statut = d.statut;
                if (suivi.rdv) { suivi.rdv = { ...suivi.rdv, statut: 'prevu', maj: maintenant }; statut = 'rdv'; } else statut = suivi.offre ? 'offre' : 'contactee';
                histo.unshift({ date: maintenant, quoi: `Statut : ${store.STATUTS[statut]}` });
                suivi.historique = histo.slice(0, 300);
                await store.majDemande(d.ref, { statut, suivi });
            }
        } else if (ref && quoi === 'vente') {
            const d = await store.lireDemande(ref);
            if (d) await store.majDemande(d.ref, { suivi: { ...d.suivi, historique: [{ date: new Date().toISOString(), quoi: `Vente annulée (erreur) : ${motif}` }, ...((d.suivi || {}).historique || [])].slice(0, 300) } });
        }
        res.json({ ok: true, quoi, vehicule: v, ref });
    }));
    r.get('/api/admin/compta/societe', ok(async (req, res) => res.json(await compta.societe())));
    r.put('/api/admin/compta/societe', ok(async (req, res) => res.json(await compta.majSociete(req.body || {}))));
    r.delete('/api/admin/compta/depenses/:id', ok(async (req, res) => res.json({ success: await compta.supprimerDepense(req.params.id) })));

    // ---------------- Diagnostic mécanique : explication libre + captures de la valise (codes défaut, ediag…).
    // Pris en compte par l'estimation, prioritaire sur l'état déclaré par le vendeur.
    r.post('/api/admin/demandes/:ref/diagnostic', upload.array('captures', 12), ok(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        if (!d) return res.status(404).json({ error: 'Demande introuvable' });
        const diag = { texte: '', captures: [], ...((d.suivi || {}).diagnostic || {}) };
        const avant = { t: diag.texte, n: diag.captures.length };
        if (typeof (req.body || {}).texte === 'string') diag.texte = req.body.texte.trim().slice(0, 8000);
        const jour = new Date().toISOString().slice(0, 10);
        for (const [i, f] of (req.files || []).entries()) {
            if (!/^image\//.test(f.mimetype || '') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.originalname)) continue;
            diag.captures.push(await store.ajouterPhoto(d.dossier, `${jour}_diag_${Date.now()}_${i + 1}_${f.originalname}`, f.buffer));
        }
        diag.maj = new Date().toISOString();
        const suivi = { ...d.suivi, diagnostic: diag };
        const quoi = [diag.texte !== avant.t && 'explication', diag.captures.length > avant.n && `${diag.captures.length - avant.n} capture(s)`].filter(Boolean).join(' et ');
        if (quoi) suivi.historique = [{ date: diag.maj, quoi: `Diagnostic mécanique : ${quoi} ajouté(es)` }, ...(suivi.historique || [])].slice(0, 300);
        res.json(await store.majDemande(d.ref, { suivi }));
    }));

    r.delete('/api/admin/demandes/:ref/diagnostic', ok(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        const p = String(req.query.path || '');
        const diag = ((d && d.suivi) || {}).diagnostic;
        if (!diag || !(diag.captures || []).some(x => x.path === p)) return res.status(404).json({ error: 'Capture introuvable' });
        await store.supprimerPhoto(p).catch(() => {});
        res.json(await store.majDemande(d.ref, { suivi: { ...d.suivi, diagnostic: { ...diag, captures: diag.captures.filter(x => x.path !== p) } } }));
    }));

    r.delete('/api/admin/demandes/:ref/photos', ok(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        const p = String(req.query.path || '');
        if (!d || !(d.photos || []).some(x => x.path === p)) return res.status(404).json({ error: 'Photo introuvable' });
        await store.supprimerPhoto(p);
        res.json(await store.majDemande(d.ref, { photos: d.photos.filter(x => x.path !== p) }));
    }));

    // Tout le dossier en .zip (photos + fiche texte de la demande)
    r.get('/api/admin/demandes/:ref/zip', ok(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        if (!d) return res.status(404).json({ error: 'Demande introuvable' });
        res.attachment(`${d.dossier}.zip`);
        const zip = archiver('zip', { zlib: { level: 1 } });
        zip.on('error', e => { console.error('Zip :', e.message); res.end(); });
        zip.pipe(res);
        zip.append(ficheTexte(d), { name: `${d.dossier}/fiche.txt` });
        for (const p of d.photos || []) {
            try { zip.append((await store.lirePhoto(p.path)).buffer, { name: `${d.dossier}/${p.name}` }); } catch (e) { /* photo manquante */ }
        }
        await zip.finalize();
    }));

    // ---------------- Export
    r.get('/api/admin/export.csv', ok(async (req, res) => {
        const cols = ['ref', 'date', 'statut', 'origine', 'type', 'prenom', 'nom', 'telephone', 'email', 'code_postal', 'ville', 'vehicule', 'annee', 'kilometrage', 'plaque', 'mecanique', 'carrosserie', 'controle_technique', 'prix_souhaite', 'prix_max_achat', 'prix_leboncoin', 'cote_argus', 'prix_vente_estime', 'offre', 'prix_achat', 'nb_photos', 'notes'];
        const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
        const choix = req.query.refs ? new Set(String(req.query.refs).toUpperCase().split(',')) : null;
        const lignes = (await store.listerDemandes()).filter(d => !choix || choix.has(d.ref)).map(d => {
            const x = d.data || {}; const p = (d.estimation || {}).prix || {}; const s = d.suivi || {};
            return [d.ref, d.created_at.slice(0, 16).replace('T', ' '), store.STATUTS[d.statut] || d.statut, d.origine, d.type, x.prenom, x.nom, x.telephone, x.email, x.code_postal, x.ville, x.vehicule, x.annee, x.kilometrage, x.plaque, x.mecanique, x.carrosserie, x.controle_technique, x.prix_souhaite, s.prix_manuel_max || p.max_achat, p.leboncoin, p.argus, s.prix_manuel_vente || p.vente_estime, s.offre, s.prix_achat, (d.photos || []).length, s.notes].map(cell).join(';');
        });
        res.attachment(`lunicar-demandes-${new Date().toISOString().slice(0, 10)}.csv`).type('text/csv; charset=utf-8')
            .send('﻿' + [cols.join(';'), ...lignes].join('\r\n'));
    }));

    // Conversions hors ligne Google Ads : les voitures achetées issues d'un clic publicitaire.
    // À importer dans Google Ads > Objectifs > Conversions > Importer (fichier CSV).
    r.get('/api/admin/conversions-ads.csv', ok(async (req, res) => {
        res.attachment(`lunicar-conversions-ads-${new Date().toISOString().slice(0, 10)}.csv`).type('text/csv; charset=utf-8')
            .send(csvConversions(await store.listerDemandes()));
    }));

    // ---------------- Import Gmail (anciennes demandes)
    r.post('/api/admin/import-gmail', ok(async (req, res) => {
        if (importEnCours) return res.status(409).json({ error: 'Import déjà en cours' });
        importEnCours = gmail.importer({ depuis: (req.body || {}).depuis })
            .catch(e => { console.error('Import Gmail :', e.message); return store.ecrireReglage('gmail_import', { date: new Date().toISOString(), erreur: e.message }); })
            .finally(() => { importEnCours = null; });
        res.status(202).json({ success: true });
    }));

    // ---------------- Messages de contact
    r.get('/api/admin/messages', ok(async (req, res) => res.json(await store.listerMessages())));
    r.patch('/api/admin/messages/:id', ok(async (req, res) => { await store.marquerMessage(req.params.id, (req.body || {}).lu); res.json({ success: true }); }));

    // ---------------- Veille forums : suggestions de réponses à poster à la main (le robot ne poste jamais)
    r.get('/api/admin/veille', ok(async (req, res) => {
        const journal = (await store.lireReglage('veille_journal', [])) || [];
        res.json({ suggestions: await veille.lireSuggestions(), etat: veille.etat(), dernier: journal[0] || null });
    }));
    r.post('/api/admin/veille/chercher', ok(async (req, res) => {
        const deja = veille.etat().en_cours;
        if (!deja) veille.passage('manuel').catch(e => console.error('Veille :', e.message));
        res.status(202).json({ success: true, deja_en_cours: deja });
    }));
    r.patch('/api/admin/veille/:id', ok(async (req, res) => {
        const s = await veille.majSuggestion(req.params.id, req.body || {});
        return s ? res.json(s) : res.status(404).json({ error: 'Suggestion introuvable' });
    }));

    // ---------------- Annonces Leboncoin : tri des e-mails d'alertes (le robot ne visite pas leboncoin.fr)
    r.get('/api/admin/annonces', ok(async (req, res) => {
        const journal = (await store.lireReglage('annonces_journal', [])) || [];
        const total = journal.reduce((s, j) => s + (j.alertes || 0), 0);
        res.json({ annonces: await annonces.lireAnnonces(), etat: await annonces.etat(), dernier: journal[0] || null, alertes_recues: total });
    }));
    r.post('/api/admin/annonces/relever', ok(async (req, res) => {
        const deja = (await annonces.etat()).en_cours;
        if (!deja) annonces.passage('manuel').then(j => annonces.notifier(j.interessantes)).catch(e => console.error('Annonces :', e.message));
        res.status(202).json({ success: true, deja_en_cours: deja });
    }));
    r.patch('/api/admin/annonces/:id', ok(async (req, res) => {
        const b = req.body || {};
        const a = await annonces.majAnnonce(req.params.id, { statut: b.statut, ...(typeof b.note === 'string' ? { note: b.note } : {}) });
        return a ? res.json(a) : res.status(404).json({ error: 'Annonce introuvable' });
    }));
    // Estimation complète (avec recherche web, ≈ 0,15 à 0,30 €) : seulement à la demande, une à la fois.
    r.post('/api/admin/annonces/:id/estimation', ok(async (req, res) => {
        const id = req.params.id;
        const a = (await annonces.lireAnnonces()).find(x => x.id === id);
        if (!a) return res.status(404).json({ error: 'Annonce introuvable' });
        if (!estimation.actif()) return res.status(503).json({ error: 'ANTHROPIC_API_KEY non défini : estimation désactivée' });
        if (a.estimation_complete_statut === 'en_cours') return res.status(202).json({ success: true, deja_en_cours: true });
        await annonces.majAnnonce(id, { estimation_complete_statut: 'en_cours', estimation_complete_erreur: null });
        const d = { ref: 'LBC', created_at: new Date().toISOString(), data: annonces.versDemande(a), suivi: {}, photos: [] };
        estimation.estimer(d)
            .then(e => annonces.majAnnonce(id, { estimation_complete: { prix: e.prix, resume: e.resume, attractivite: e.attractivite && { score: e.attractivite.score, verdict: e.attractivite.verdict, resume: e.attractivite.resume }, points_attention: (e.points_attention || []).slice(0, 4), questions_a_poser: (e.questions_a_poser || []).slice(0, 5), date: e.date, modele: e.modele }, estimation_complete_statut: 'ok' }))
            .catch(e => { console.error('Annonces, estimation complète :', e.message); return annonces.majAnnonce(id, { estimation_complete_statut: 'erreur', estimation_complete_erreur: e.message.slice(0, 300) }); });
        res.status(202).json({ success: true });
    }));
    // Crée une demande dans le CRM, origine « Leboncoin », pré-remplie avec l'annonce (sans téléphone : on contacte via Leboncoin).
    r.post('/api/admin/annonces/:id/demande', ok(async (req, res) => {
        const id = req.params.id;
        const a = (await annonces.lireAnnonces()).find(x => x.id === id);
        if (!a) return res.status(404).json({ error: 'Annonce introuvable' });
        if (a.demande_ref && await store.lireDemande(a.demande_ref)) return res.json({ ref: a.demande_ref, existante: true });
        const ligne = store.ligneDepuisDemande({ id: require('crypto').randomUUID(), createdAt: new Date().toISOString(), type: 'estimation', ...annonces.versDemande(a) }, { origine: 'leboncoin' });
        if (a.estimation_complete && a.estimation_complete.prix) ligne.suivi = { notes: `Estimation complète faite depuis l'écran Annonces : prix max ${a.estimation_complete.prix.max_achat} €, revente ${a.estimation_complete.prix.vente_estime} €.` };
        const d = await store.enregistrerDemande(ligne);
        await annonces.majAnnonce(id, { demande_ref: d.ref });
        res.json({ ref: d.ref });
    }));

    return r;
};

// Conversions hors ligne pour Google Ads, à partir du gclid enregistré avec la demande (aucun cookie requis).
// Niveau 1 « Lead qualifié » : toute demande envoyée depuis un clic Ads, à sa date de réception (formulaires abandonnés
// et demandes rangées « Sans suite » — les fantaisistes — exclus). Niveau 2 « Voiture achetée » : achat, marge en valeur.
function csvConversions(demandes, entete = true) {
    const lignes = [];
    const heure = iso => {
        const d = new Date(iso), local = d.toLocaleString('sv-SE', { timeZone: 'Europe/Paris' });
        if (entete) return local;
        const ecart = Math.round((new Date(local.replace(' ', 'T') + 'Z') - d) / 60000);
        const p = n => String(Math.floor(Math.abs(n))).padStart(2, '0');
        return `${local.replace(' ', 'T')}${ecart >= 0 ? '+' : '-'}${p(ecart / 60)}:${p(ecart % 60)}`;
    };
    for (const d of demandes) {
        const clic = (d.data || {}).clic_ads || '';
        if (!clic || d.origine === 'abandon' || d.statut === 'sans_suite') continue;
        const [type, id] = clic.split('=');
        const ids = [type === 'gclid' ? id : '', type === 'gbraid' ? id : '', type === 'wbraid' ? id : ''];
        const s = d.suivi || {}, histo = s.historique || [];
        // Google refuse une conversion plus de 90 jours après le clic (≈ la date de la demande).
        const limite = new Date(d.created_at).getTime() + 88 * 864e5;
        lignes.push([...ids, 'Lead qualifié', heure(d.created_at), '', '']);
        if (d.statut === 'achetee') {
            const quand = (histo.find(h => /Achetée/.test(h.quoi)) || {}).date || d.updated_at;
            const vente = Number(s.prix_manuel_vente || ((d.estimation || {}).prix || {}).vente_estime) || 0;
            const marge = vente && Number(s.prix_achat) ? Math.max(0, vente - Number(s.prix_achat)) : '';
            if (new Date(quand).getTime() <= limite) lignes.push([...ids, 'Voiture achetée', heure(quand), marge, marge === '' ? '' : 'EUR']);
        }
    }
    // Guillemets seulement si nécessaire (le Gestionnaire de données valide mal les champs vides entre guillemets).
    const cell = v => /[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    return [...(entete ? ['Parameters:TimeZone=Europe/Paris'] : []), 'Google Click ID,GBRAID,WBRAID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency',
        ...lignes.map(l => l.map(cell).join(','))].join('\r\n');
}

function ficheTexte(d) {
    const x = d.data || {}; const e = d.estimation; const s = d.suivi || {};
    const l = [`LUNICAR · demande ${d.ref} · ${d.created_at.slice(0, 16).replace('T', ' ')}`, ''];
    const champs = [['Vendeur', [x.prenom, x.nom].filter(Boolean).join(' ')], ['Téléphone', x.telephone], ['E-mail', x.email], ['Ville', [x.code_postal, x.ville].filter(Boolean).join(' ')],
        ['Véhicule', x.vehicule], ['Année', x.annee], ['Kilométrage', x.kilometrage], ['Plaque', x.plaque], ['VIN', x.vin || (x.fiche_api || {}).vin],
        ['Mécanique', x.mecanique], ['Carrosserie', x.carrosserie], ['Contrôle technique', x.controle_technique], ['Prix souhaité', x.prix_souhaite], ['Message', x.message],
        ['Statut', store.STATUTS[d.statut]], ['Offre faite', s.offre], ['Prix d\'achat', s.prix_achat], ['Notes', s.notes]];
    champs.forEach(([k, v]) => v && l.push(`${k} : ${v}`));
    if (e && e.prix) {
        l.push('', 'ESTIMATION', `Prix max d'achat : ${e.prix.max_achat} €`, `Leboncoin (médiane) : ${e.prix.leboncoin} €`, `Cote Argus : ${e.prix.argus} €`, `Prix de vente estimé : ${e.prix.vente_estime} €`, '', e.resume || '');
    }
    return l.join('\n');
}

module.exports.csvConversions = csvConversions;
