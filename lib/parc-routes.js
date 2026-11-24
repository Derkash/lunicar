// Routes du suivi de vente du parc (lib/parc.js). Côté Mac mini (clé de collecte X-Cle) :
//   GET  /api/marche/parc/taches           ce qu'il doit faire maintenant (relevé de nos annonces, stratégies prêtes)
//   POST /api/marche/parc/annonces         relevé de nos annonces Leboncoin + forfait
//   POST /api/marche/parc/diag             dossiers du diagnostic mécanique (copie locale du dépôt diagnostic)
//   GET  /api/marche/parc/dossier/:vid     tout ce que Claude doit savoir d'un véhicule
//   POST /api/marche/parc/strategie/:vid   stratégie renvoyée par Claude
//   GET  /api/marche/parc/global           dossier du parc entier (plan du jour)   POST idem : plan
// Côté admin : GET /api/admin/parc (stratégies + annonces + plan), POST /api/admin/parc/lier, POST /api/admin/parc/relancer.
const express = require('express');
const store = require('./store');
const compta = require('./compta');
const marche = require('./marche');
const P = require('./parc');
const AV = require('./analyse-vehicule');

const EN_VENTE = ['stock', 'preparation', 'pret', 'en_vente'];
const heureParis = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }));
const num = v => { const x = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')); return Number.isFinite(x) ? x : 0; };

// Bandes Leboncoin d'un calcul : tba = { min, max, bandes: { ba, eq, ls } } (bornes hautes des tranches suivantes).
function bandes(c) {
    if (!c || !c.tba) return null;
    const t = c.tba.tranches || [], haut = re => { const x = t.find(z => re.test(z.libelle)); return x ? x.max : null; };
    return { min: c.tba.min, max: c.tba.max, bandes: { ba: haut(/^bonne/i), eq: haut(/quitable/i), ls: haut(/l[ée]g[eè]rement/i) } };
}
const annonceDe = vid => Object.entries(P.lire().annonces).filter(([, e]) => e.vid === vid).sort((a, b) => String(b[1].dernier_releve).localeCompare(String(a[1].dernier_releve)))[0];

async function dossier(v, C) {
    const d = v.ref ? await store.lireDemande(v.ref) : null;
    const c = d ? await AV.calculer({ ...d, statut: 'achetee', data: { ...(d.data || {}), kilometrage: v.kilometrage || (d.data || {}).kilometrage } }).catch(() => null) : null;
    const rel = marche.releve(v.plaque || (d && d.data && d.data.plaque));
    const an = annonceDe(v.id), L = P.lire();
    const A = c && c.marche && c.marche.annonces;
    return {
        vid: v.id, libelle: v.libelle, plaque: v.plaque, annee: v.annee, km: num(v.kilometrage), statut: v.statut, date_achat: v.date_achat, jours_en_stock: v.bilan.jours,
        achat: num(v.prix_achat), cout_engage: v.bilan.cout, travaux: v.bilan.travaux, travaux_detail: (v.travaux || []).map(t => ({ poste: t.poste || t.libelle, fait: !!t.fait, cout: (t.couts || []).reduce((a, k) => a + num(k.montant), 0), note: t.note || '' })),
        estimation_vente_saisie: num(v.estimation_vente) || null, notes: String(v.notes || '').slice(0, 1500),
        version: rel && rel.version ? { label: rel.version.label, finition: rel.version.trim, energie: rel.version.energy, boite: rel.version.gearbox, puissance: rel.version.power } : null,
        tba: c && c.tba, revente_score: c && c.marche ? { score: c.marche.revente_score, verdict: c.marche.revente_verdict } : null,
        marche: c && c.marche ? { prix_retenu: c.marche.prix_retenu, composantes: c.marche.composantes, ecart_sonar_annonces: c.marche.ecart_sonar_annonces, ventes_reelles: c.marche.ventes_reelles,
            annonces: A ? { n: A.n, part_pct: A.part_pct, jours_median: A.jours_median, anciennes_pct: A.anciennes_pct, baisses_pct: A.baisses_pct, dispersion: A.dispersion, part: A.part, pro: A.pro, pente_10000km: A.pente_10000km, exemples: (A.exemples || []).slice(0, 15) } : null } : null,
        sonar: rel ? { releve_le: rel.date, km: rel.km, moyenne: rel.moyenne, fiabilite: rel.fiabilite,
            ventes: rel.ventes ? { nb: rel.ventes.nb, prix: rel.ventes.prix, delai_median_jours: rel.ventes.jours, liste: (rel.ventes.liste || []).slice(0, 20).map(t => ({ km: t[0], annee: t[1], delai_jours: t[2], vendue_le: t[3], prix: t[4], lieu: t[5] })) } : null,
            offre_demande_12_mois: (rel.offre_demande || []).map(t => ({ mois: t[0], annonces: t[1], indice_visites: t[2] })) } : null,
        risques: c ? c.risques.map(r => ({ niveau: r.niveau, titre: r.titre, detail: r.detail, provision: r.provision })) : [],
        fiche_moteur: c && c.fiche_moteur, textes_vendeur: c && c.textes ? { resume: c.textes.resume, faits: c.textes.faits } : null,
        diagnostic: L.diag[P.plaqueCle(v.plaque)] || null,
        notre_annonce: an ? { titre: an[1].titre, ref_yak: an[1].ref_yak, en_ligne: an[1].en_ligne, publiee: an[1].publiee, hors_ligne_le: an[1].hors_ligne_le, serie: P.serie(an[1]).slice(-45) } : null,
        concurrents_observes: P.vitesseMarche(v.id, bandes(c)),
        strategie_precedente: L.strategies[v.id] ? { le: L.strategies[v.id].recu_le, prix_conseille: L.strategies[v.id].prix_conseille, actions: (L.strategies[v.id].actions || []).slice(0, 3), historique: L.strategies[v.id].historique } : null,
        analyse_le: c && c.analyse_le, avertissements: c ? c.avertissements : [], forfait: C.forfait, aujourdhui: P.jourParis()
    };
}

async function parcEnVente() { const T = await compta.tout(); return { T, l: T.vehicules.filter(v => EN_VENTE.includes(v.statut)) }; }
// Prêt pour la stratégie du jour : annonces relevées aujourd'hui, analyse du jour finie (ou relance lancée il y a plus de 3 h), pas encore faite aujourd'hui.
function pret(v, L, j) {
    const st = L.strategies[v.id]; if (st && P.jourParis(new Date(st.recu_le)) === j) return false;
    // Dossier servi il y a moins d'une heure (stratégie en cours ou en échec) : pas de nouvel appel à Claude en boucle.
    if (L.tentatives && Date.now() - new Date(L.tentatives[v.id] || 0) < 3600e3) return false;
    if (!L.annonces_le || P.jourParis(new Date(L.annonces_le)) !== j) return false;
    const A = v.ref ? AV.analyse(v.ref) : null;
    if (!A) return true;
    if (A.etat === 'terminee' && A.termine_le && P.jourParis(new Date(A.termine_le)) === j) return true;
    return Date.now() - new Date(A.maj || 0) > 3 * 3600e3;
}

// Une annonce Leboncoin en ligne rattachée fait passer le véhicule « En vente » (jamais en arrière).
async function passerEnVente(T) {
    const passes = [];
    for (const e of Object.values(P.lire().annonces)) {
        const v = e.en_ligne && e.vid && T.vehicules.find(x => x.id === e.vid);
        if (v && ['stock', 'preparation', 'pret'].includes(v.statut)) { await compta.majVehicule(v.id, { statut: 'en_vente' }); passes.push(v.libelle); }
    }
    return passes;
}

module.exports = function (app, { cors, authAdmin }) {
    const L = () => P.lire();
    app.get('/api/marche/parc/taches', cors, async (req, res) => {
        try {
            const j = P.jourParis(), h = heureParis(), B = L();
            // Relance quotidienne (Sonar au km exact + annonces concurrentes) des véhicules achetés, à partir de 6 h.
            const { l } = await parcEnVente();
            // Seulement les voitures encore en vente (pas les vendues) + les RDV à venir.
            if (h >= 6 && B.relance_le !== j) { B.relance_le = j; P.sauver(); await AV.relancerLot({ achetees: false, rdv: true, refs: l.map(v => v.ref).filter(Boolean) }); }
            const annonces = h >= 7 && (!B.annonces_le || P.jourParis(new Date(B.annonces_le)) !== j);
            const strategies = annonces ? [] : l.filter(v => pret(v, B, j)).map(v => ({ vid: v.id, libelle: v.libelle }));
            const plan = !annonces && !strategies.length && Date.now() - new Date(B.plan_tente_le || 0) > 3600e3 && l.length && (!B.plan || P.jourParis(new Date(B.plan.recu_le)) !== j) && l.every(v => B.strategies[v.id] && P.jourParis(new Date(B.strategies[v.id].recu_le)) === j);
            res.json({ annonces, strategies, plan: !!plan, diag_connus: Object.fromEntries(Object.entries(B.diag).map(([p, d]) => [p, d.maj])) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/marche/parc/annonces', cors, express.json({ limit: '300kb' }), async (req, res) => {
        try { const { T } = await parcEnVente(); const r = P.enregistrerAnnonces(req.body || {}, T.vehicules); res.json({ ...r, passes_en_vente: await passerEnVente(T) }); } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/marche/parc/diag', cors, express.json({ limit: '2mb' }), (req, res) => {
        try { res.json({ ok: true, n: P.enregistrerDiag((req.body || {}).dossiers) }); } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.get('/api/marche/parc/dossier/:vid', cors, async (req, res) => {
        try { const { T } = await parcEnVente(); const v = T.vehicules.find(x => x.id === req.params.vid); if (!v) return res.status(404).json({ error: 'Véhicule introuvable' }); const B = L(); B.tentatives = { ...(B.tentatives || {}), [v.id]: new Date().toISOString() }; P.sauver(); res.json(await dossier(v, B)); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/marche/parc/strategie/:vid', cors, express.json({ limit: '300kb' }), (req, res) => {
        try { P.enregistrerStrategie(req.params.vid, req.body || {}); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // Dossier global : chaque véhicule en vente résumé + stratégie du jour, ventes passées (apprentissage), forfait.
    app.get('/api/marche/parc/global', cors, async (req, res) => {
        try {
            const { T, l } = await parcEnVente(), B = L();
            B.plan_tente_le = new Date().toISOString(); P.sauver();
            const vendus = T.vehicules.filter(v => v.statut === 'vendu').map(v => {
                const an = annonceDe(v.id), rel = marche.releve(v.plaque), tb = rel && (rel.tranches || []).find(t => /tr[eè]s bonne/i.test(t[1]));
                return { libelle: v.libelle, achat: num(v.prix_achat), cout: v.bilan.cout, vente: num(v.prix_vente), marge: v.bilan.marge, date_achat: v.date_achat, date_vente: v.date_vente, jours_stock: v.bilan.jours, canal: v.canal_vente || '',
                    tba_actuel_sonar: tb ? { min: tb[2], max: tb[3], km_releve: rel.km } : null, annonce: an ? { publiee: an[1].publiee, serie: P.serie(an[1]) } : null, notes: String(v.notes || '').slice(0, 400) };
            });
            res.json({ aujourdhui: P.jourParis(), forfait: B.forfait, resume_lbc: B.resume_lbc,
                vehicules: l.map(v => { const st = B.strategies[v.id] || {}; const an = annonceDe(v.id); return { vid: v.id, libelle: v.libelle, statut: v.statut, jours_en_stock: v.bilan.jours, cout_engage: v.bilan.cout, en_ligne: !!(an && an[1].en_ligne), prix_en_ligne: an ? (P.serie(an[1]).slice(-1)[0] || {}).prix : null, strategie: { synthese: st.synthese, prix_conseille: st.prix_conseille, probabilite: st.probabilite, delai_estime_jours: st.delai_estime_jours, actions: (st.actions || []).slice(0, 3), demande: st.demande } }; }),
                annonces_non_rattachees: Object.entries(B.annonces).filter(([, e]) => e.en_ligne && !e.vid).map(([k, e]) => ({ cle: k, titre: e.titre })),
                ventes_passees: vendus, plan_precedent: B.plan ? { le: B.plan.recu_le, synthese: B.plan.synthese } : null });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/marche/parc/global', cors, express.json({ limit: '200kb' }), (req, res) => { try { P.enregistrerPlan(req.body || {}); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); } });

    // ---- Admin
    app.get('/api/admin/parc', authAdmin, (req, res) => {
        const B = L();
        res.json({ plan: B.plan, forfait: B.forfait, resume_lbc: B.resume_lbc, annonces_le: B.annonces_le, strategies: B.strategies,
            annonces: Object.fromEntries(Object.entries(B.annonces).map(([k, e]) => [k, { titre: e.titre, ref_yak: e.ref_yak, vid: e.vid, en_ligne: e.en_ligne, publiee: e.publiee, serie: P.serie(e).slice(-30) }])) });
    });
    app.get('/api/admin/parc/dossier/:vid', authAdmin, async (req, res) => {
        try { const { T } = await parcEnVente(); const v = T.vehicules.find(x => x.id === req.params.vid); if (!v) return res.status(404).json({ error: 'Véhicule introuvable' }); const D = await dossier(v, L()); res.json({ concurrents_observes: D.concurrents_observes, notre_annonce: D.notre_annonce, sonar: D.sonar, diagnostic: D.diagnostic ? { fichier: D.diagnostic.fichier, maj: D.diagnostic.maj, cas: D.diagnostic.cas.map(c => c.dossier) } : null }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });
    // Relevé de nos annonces saisi depuis l'admin (même format que le Mac mini) : utile tant que le Mac mini n'est pas installé.
    // Une annonce en ligne rattachée fait passer le véhicule « En vente » (jamais en arrière).
    app.post('/api/admin/parc/annonces', authAdmin, express.json({ limit: '300kb' }), async (req, res) => {
        try {
            const b = req.body || {};
            for (const [cle, vid] of Object.entries(b.liens || {})) P.lier(cle, vid);
            const { T } = await parcEnVente(), r = P.enregistrerAnnonces(b, T.vehicules);
            res.json({ ...r, passes_en_vente: await passerEnVente(T) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/admin/parc/strategie/:vid', authAdmin, express.json({ limit: '300kb' }), (req, res) => {
        try { P.enregistrerStrategie(req.params.vid, req.body || {}); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/admin/parc/plan', authAdmin, express.json({ limit: '200kb' }), (req, res) => {
        try { P.enregistrerPlan(req.body || {}); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/admin/parc/lier', authAdmin, express.json(), (req, res) => { P.lier(String((req.body || {}).cle || ''), (req.body || {}).vid || null); res.json({ ok: true }); });
    // Refaire la stratégie d'un véhicule (ou de tous) au prochain passage du Mac mini.
    app.post('/api/admin/parc/relancer', authAdmin, express.json(), (req, res) => {
        const B = L(), vid = (req.body || {}).vid;
        for (const k of vid ? [vid] : Object.keys(B.strategies)) if (B.strategies[k]) B.strategies[k].recu_le = '2000-01-01T00:00:00.000Z';
        if (!vid && B.plan) B.plan.recu_le = '2000-01-01T00:00:00.000Z';
        B.tentatives = vid ? { ...(B.tentatives || {}), [vid]: null } : {}; B.plan_tente_le = null;
        P.sauver(); res.json({ ok: true });
    });
};
