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
        if (b.statut && store.STATUTS[b.statut] && b.statut !== d.statut) {
            champs.statut = b.statut;
            histo.unshift({ date: new Date().toISOString(), quoi: `Statut : ${store.STATUTS[b.statut]}` });
            // Contact établi ou offre faite : relance automatique à J+4 ouvrés (sauf date choisie à la main).
            if (['contactee', 'offre'].includes(b.statut) && b.rappel_le === undefined) programmer(suivi, histo);
            if (!relances.ACTIFS.includes(b.statut)) suivi.rappel_le = '';
        }
        // Drapeau « À appeler » : la demande remonte en tête de liste jusqu'au prochain appel enregistré.
        if (typeof b.a_appeler === 'boolean' && b.a_appeler !== !!suivi.a_appeler) {
            suivi.a_appeler = b.a_appeler;
            histo.unshift({ date: new Date().toISOString(), quoi: b.a_appeler ? 'Marquée « À appeler »' : 'Drapeau « À appeler » retiré' });
        }
        const LIB = { offre: 'Offre faite', prix_achat: 'Prix d\'achat final', rappel_le: 'Relance prévue le', prix_manuel_max: 'Prix max retenu', prix_manuel_vente: 'Prix de vente retenu' };
        const lisible = (k, v) => !v ? 'effacé' : k === 'rappel_le' ? String(v).slice(0, 10).split('-').reverse().join('/') : `${Number(v).toLocaleString('fr-FR')} €`;
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
        suivi.appels = [{ date: maintenant, resultat: b.resultat, libelle: res_.libelle, texte: note, corrections: faites, offre: offre || null }, ...(suivi.appels || [])].slice(0, 50);
        histo.unshift({ date: maintenant, type: 'appel', quoi: `Appel : ${res_.libelle}${suivi.rappel_le ? ` · relance le ${suivi.rappel_le.split('-').reverse().join('/')}` : ''}`, texte: note, corrections: faites });
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
        let n = 0;
        for (const ref of refs) {
            const d = await store.lireDemande(ref);
            if (!d) continue;
            const suivi = { ...d.suivi };
            const histo = [...(suivi.historique || [])];
            const noter = quoi => histo.unshift({ date: new Date().toISOString(), quoi });
            if (action === 'supprimer') { await store.supprimerDemande(d.ref); n++; continue; }
            if (action === 'estimer') { if (estimation.actif() && (d.data || {}).vehicule) { estimation.planifier(d.ref); n++; } continue; }
            const champs = {};
            if (action === 'statut' && store.STATUTS[valeur] && valeur !== d.statut) {
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
        res.json({ success: true, traitees: n });
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
