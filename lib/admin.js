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

    // ---------------- Demandes
    r.get('/api/admin/demandes', ok(async (req, res) => res.json(await store.listerDemandes())));

    r.get('/api/admin/demandes/:ref', ok(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        return d ? res.json(d) : res.status(404).json({ error: 'Demande introuvable' });
    }));

    // Suivi : statut, notes, offre faite, prix d'achat, prix retenus à la main. Chaque changement est historisé.
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
            if (['contactee', 'offre'].includes(b.statut) && b.rappel_le === undefined) {
                suivi.rappel_le = relances.ajouterJoursOuvres(relances.aujourdhui(), relances.DELAI);
                histo.unshift({ date: new Date().toISOString(), quoi: `Relance programmée le ${suivi.rappel_le.split('-').reverse().join('/')}` });
            }
            if (!relances.ACTIFS.includes(b.statut)) suivi.rappel_le = '';
        }
        for (const k of ['notes', 'offre', 'prix_achat', 'rappel_le', 'prix_manuel_max', 'prix_manuel_vente']) {
            if (b[k] === undefined) continue;
            const v = typeof b[k] === 'string' ? b[k].slice(0, 5000) : b[k];
            if (k !== 'notes' && String(v) !== String(suivi[k] || '')) histo.unshift({ date: new Date().toISOString(), quoi: `${k.replace(/_/g, ' ')} : ${v || '—'}` });
            suivi[k] = v;
        }
        suivi.historique = histo.slice(0, 100);
        res.json(await store.majDemande(d.ref, { ...champs, suivi }));
    }));

    // Journal d'appel : résultat -> statut, historique et prochaine relance (jours ouvrés).
    r.post('/api/admin/demandes/:ref/appel', ok(async (req, res) => {
        const d = await store.lireDemande(req.params.ref);
        if (!d) return res.status(404).json({ error: 'Demande introuvable' });
        const res_ = relances.RESULTATS[(req.body || {}).resultat];
        if (!res_) return res.status(400).json({ error: 'Résultat inconnu' });
        const note = String((req.body || {}).note || '').slice(0, 500);
        const suivi = { ...d.suivi, nb_appels: (Number((d.suivi || {}).nb_appels) || 0) + 1, dernier_appel: new Date().toISOString() };
        if (!suivi.premier_contact && req.body.resultat !== 'injoignable') suivi.premier_contact = suivi.dernier_appel;
        const champs = {};
        let statut = res_.statut;
        if (!statut && d.statut === 'nouvelle' && req.body.resultat !== 'injoignable') statut = 'contactee';
        if (statut && statut !== d.statut) champs.statut = statut;
        suivi.rappel_le = res_.relance ? relances.ajouterJoursOuvres(relances.aujourdhui(), res_.relance) : '';
        const histo = [...(suivi.historique || [])];
        histo.unshift({ date: new Date().toISOString(), quoi: `Appel : ${res_.libelle}${note ? ` (${note})` : ''}${suivi.rappel_le ? ` · relance le ${suivi.rappel_le.split('-').reverse().join('/')}` : ''}` });
        suivi.historique = histo.slice(0, 100);
        res.json(await store.majDemande(d.ref, { ...champs, suivi }));
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
        for (const k of Object.keys(estimation.REGLAGES_DEFAUT)) if (b[k] !== undefined && b[k] !== '') v[k] = Math.max(0, Number(b[k]) || 0);
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
        const lignes = (await store.listerDemandes()).map(d => {
            const x = d.data || {}; const p = (d.estimation || {}).prix || {}; const s = d.suivi || {};
            return [d.ref, d.created_at.slice(0, 16).replace('T', ' '), store.STATUTS[d.statut] || d.statut, d.origine, d.type, x.prenom, x.nom, x.telephone, x.email, x.code_postal, x.ville, x.vehicule, x.annee, x.kilometrage, x.plaque, x.mecanique, x.carrosserie, x.controle_technique, x.prix_souhaite, s.prix_manuel_max || p.max_achat, p.leboncoin, p.argus, s.prix_manuel_vente || p.vente_estime, s.offre, s.prix_achat, (d.photos || []).length, s.notes].map(cell).join(';');
        });
        res.attachment(`lunicar-demandes-${new Date().toISOString().slice(0, 10)}.csv`).type('text/csv; charset=utf-8')
            .send('﻿' + [cols.join(';'), ...lignes].join('\r\n'));
    }));

    // Conversions hors ligne Google Ads : les voitures achetées issues d'un clic publicitaire.
    // À importer dans Google Ads > Objectifs > Conversions > Importer (fichier CSV).
    r.get('/api/admin/conversions-ads.csv', ok(async (req, res) => {
        const nom = String(req.query.nom || 'Voiture achetée');
        const lignes = [];
        for (const d of await store.listerDemandes()) {
            const clic = (d.data || {}).clic_ads || '';
            if (d.statut !== 'achetee' || !clic) continue;
            const [type, id] = clic.split('=');
            const s = d.suivi || {};
            const quand = ((s.historique || []).find(h => /Achetée/.test(h.quoi)) || {}).date || d.updated_at;
            const t = new Date(quand).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' });
            const vente = Number(s.prix_manuel_vente || ((d.estimation || {}).prix || {}).vente_estime) || 0;
            const marge = vente && Number(s.prix_achat) ? Math.max(0, vente - Number(s.prix_achat)) : '';
            lignes.push([type === 'gclid' ? id : '', type === 'gbraid' ? id : '', type === 'wbraid' ? id : '', nom, t, marge, marge === '' ? '' : 'EUR']);
        }
        const cell = v => `"${String(v).replace(/"/g, '""')}"`;
        res.attachment(`lunicar-conversions-ads-${new Date().toISOString().slice(0, 10)}.csv`).type('text/csv; charset=utf-8')
            .send(['Parameters:TimeZone=Europe/Paris', 'Google Click ID,GBRAID,WBRAID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency',
                ...lignes.map(l => l.map(cell).join(','))].join('\r\n'));
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
