// Collecte Sonar Pricing (Leboncoin Pro) pour la base marché LUNICAR (lib/marche.js).
// À coller dans la console d'un onglet https://www.leboncoin.fr/compte/pro/donnees-auto connecté au compte pro,
// après avoir défini window.__CLE (clé de collecte : admin LUNICAR, POST /api/admin/marche/cle).
// Le script pilote l'interface Sonar comme un utilisateur (saisie de plaque, page de résultat) et lit les
// réponses que la page charge elle-même ; il n'appelle aucune API Leboncoin de son côté.
//
// Lancement : __collecte.lancer({ mode: 'principal' })  — un relevé par plaque au km de la demande
//             __collecte.lancer({ mode: 'grille' })     — mêmes plaques, prix à 50/100/150/200/250 000 km
// Suivi : __collecte.etat()   Arrêt : __collecte.stop()
(() => {
    const API = 'https://lunicar.fr/api/marche';
    const GRILLE = [50000, 100000, 150000, 200000, 250000];
    const pause = ms => new Promise(r => setTimeout(r, ms));

    // Journal des réponses chargées par la page (fetch + XHR), filtré sur les données Sonar.
    if (!window.__sonarLog) {
        window.__sonarLog = [];
        const garder = u => /data-product-api|lbc-values-api/.test(u);
        const of = window.fetch;
        window.fetch = async function (input, init) {
            const url = typeof input === 'string' ? input : input.url;
            const r = await of.apply(this, arguments);
            if (garder(url)) { try { window.__sonarLog.push({ url, body: init && init.body, status: r.status, resp: await r.clone().text(), t: Date.now() }); } catch (e) { /* illisible */ } }
            return r;
        };
        const X = XMLHttpRequest.prototype, oo = X.open, os = X.send;
        X.open = function (m, u) { this.__u = u; return oo.apply(this, arguments); };
        X.send = function (b) { if (garder(this.__u || '')) this.addEventListener('load', () => window.__sonarLog.push({ url: this.__u, body: b, status: this.status, resp: this.responseText, t: Date.now() })); return os.apply(this, arguments); };
    }
    const depuis = t0 => k => [...window.__sonarLog].reverse().find(l => l.t >= t0 && l.url.includes(k));
    async function attendre(t0, cles, ms = 12000) {
        const g = depuis(t0), fin = Date.now() + ms;
        while (Date.now() < fin) { if (cles.every(k => g(k))) return g; await pause(250); }
        return g;
    }
    const json = l => { try { return l && l.status === 200 ? JSON.parse(l.resp) : null; } catch (e) { return null; } };

    // Saisie de la plaque comme au clavier, puis bouton « rechercher ».
    async function plaque(p) {
        window.next.router.push('/compte/pro/donnees-auto');
        await pause(1200);
        const champ = document.querySelector('input[placeholder="AA-111-AA"]');
        if (!champ) throw new Error('champ plaque introuvable');
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(champ, p.replace(/^([A-Z]{2})(\d{3})([A-Z]{2})$/, '$1-$2-$3'));
        champ.dispatchEvent(new Event('input', { bubbles: true }));
        champ.dispatchEvent(new Event('change', { bubbles: true }));
        const t0 = Date.now();
        const bouton = champ.closest('div').parentElement.querySelector('button[aria-label="Suivant"]') || champ.closest('div').parentElement.querySelector('button');
        bouton.click();
        const g = await attendre(t0, ['v2/license'], 10000);
        const l = g('v2/license');
        if (!l) throw new Error('pas de réponse plaque');
        if (l.status === 429 || l.status === 403) throw Object.assign(new Error('freinage ' + l.status), { frein: true });
        return json(l);
    }

    // Version : celle que Sonar suggère, sinon la plus proche du libellé de la demande.
    const mots = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.]+/g, ' ').split(' ').filter(w => w.length > 1);
    function choisir(lic, demande) {
        const toutes = (lic.trims || []).flatMap(t => (t.versions || []).map(v => ({ ...v, trim: t.label })));
        if (!toutes.length) return null;
        const s = toutes.find(v => v.suggested);
        if (s) return { ...s, suggeree: true, choix: 'suggérée par Sonar' };
        const nous = new Set(mots(demande.vehicule));
        const diesel = /diesel/i.test(demande.energie), essence = /essence/i.test(demande.energie) && !/elec/i.test(demande.energie);
        const note = v => {
            const m = mots(v.label + ' ' + v.trim); let x = m.filter(w => nous.has(w)).length * 2;
            const d = /(hdi|dci|tdi|crdi|cdti|jtd|tdci|d4d|bluehdi|blue|multijet|mjt|\bd\b|\dd\b)/i.test(v.label);
            if (diesel && d) x += 3; if (essence && !d) x += 3; if ((diesel && !d) || (essence && d)) x -= 3;
            return x;
        };
        const best = toutes.map(v => ({ v, x: note(v) })).sort((a, b) => b.x - a.x)[0];
        return { ...best.v, suggeree: false, choix: `la plus proche de « ${demande.vehicule} » (score ${best.x}) parmi ${toutes.length}` };
    }

    function lireResultat(g) {
        const veh = json(g('v3/vehicle')) || {}, val = json(g('classified-ad-and-resale-values')) || {}, pos = json(g('car-price-positioning-list')) || {};
        const ext = json(g('extended-transactions')), sd = json(g('supply-and-demand'));
        return {
            veh, moyenne: (val.classified_ad || {}).value || 0, fiabilite: (val.classified_ad || {}).confidence_index_out_of_five || 0,
            tranches: (pos.positioning_list || []).map(t => [t.key, t.label, t.min_value, t.max_value]),
            ventes: ext && ext.transactions_count != null ? { prix: ext.selling_price, jours: ext.turnaround_days, fiabilite: ext.confidence_index, nb: ext.transactions_count,
                liste: (ext.transactions || []).map(t => [t.mileage, t.release_date, t.turnaround_days, t.selling_date, t.selling_price, t.location, t.version_label]) } : null,
            offre_demande: sd && sd.supply_and_demand_information ? sd.supply_and_demand_information.map(m => [m.date, m.ads, m.visits]) : []
        };
    }
    async function resultat(versionId, lic, km, avecTout) {
        const d = String(lic.registration_date || `${lic.year}-06-15`).split('-');
        const t0 = Date.now();
        window.next.router.push(`/compte/pro/donnees-auto?version_id=${versionId}&year=${lic.year}&month=${Number(d[1]) || 6}&day=${Number(d[2]) || 15}&mileage=${km}`);
        const g = await attendre(t0, avecTout ? ['classified-ad-and-resale-values', 'car-price-positioning-list', 'supply-and-demand', 'transactions'] : ['classified-ad-and-resale-values', 'car-price-positioning-list'], 15000);
        const v = g('classified-ad-and-resale-values');
        if (v && (v.status === 429 || v.status === 403)) throw Object.assign(new Error('freinage ' + v.status), { frein: true });
        if (avecTout) await pause(800); // dernières réponses (ventes, offre/demande)
        return lireResultat(depuis(t0));
    }

    async function envoyer(r) {
        const x = await fetch(API + '/releve', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cle': window.__CLE }, body: JSON.stringify(r) });
        if (!x.ok) throw new Error('envoi LUNICAR ' + x.status);
        return x.json();
    }

    const E = window.__collecte = window.__collecte || {};
    E.etat = () => ({ mode: E.mode, faits: E.faits, erreurs: E.erreurs, reste: E.file ? E.file.length - E.i : 0, en_cours: !!E.actif, dernier: E.dernier, derniereErreur: E.derniereErreur });
    E.stop = () => { E.actif = false; return 'arrêt demandé'; };
    E.lancer = async ({ mode = 'principal', limite = 0, depart = 0 } = {}) => {
        if (E.actif) return 'déjà en cours';
        const f = await fetch(API + '/file' + (mode === 'grille' ? '?tout=1' : ''), { headers: { 'X-Cle': window.__CLE } });
        if (!f.ok) return 'file LUNICAR : ' + f.status;
        E.file = await f.json(); E.i = depart; E.mode = mode; E.faits = 0; E.erreurs = 0; E.actif = true;
        (async () => {
            let freins = 0;
            while (E.actif && E.i < E.file.length && (!limite || E.faits < limite)) {
                const dm = E.file[E.i];
                try {
                    const lic = await plaque(dm.plaque);
                    if (!lic || !lic.make) { await envoyer({ plaque: dm.plaque, ref: dm.ref, erreur: 'plaque inconnue de Sonar' }); E.erreurs++; E.i++; continue; }
                    const v = choisir(lic, dm);
                    if (!v) { await envoyer({ plaque: dm.plaque, ref: dm.ref, erreur: 'aucune version proposée' }); E.erreurs++; E.i++; continue; }
                    const km = dm.km >= 1000 && dm.km < 600000 ? dm.km : 150000;
                    const version = { id: v.id, label: v.label, trim: v.trim, make: (lic.make || {}).label, model: (lic.model || {}).label, annee: lic.year, mec: lic.registration_date, suggeree: v.suggeree, choix: v.choix + (km !== dm.km ? ' · km de la demande absent ou aberrant, calcul à 150 000 km' : '') };
                    if (mode === 'grille') {
                        const points = [];
                        for (const k of GRILLE) {
                            if (!E.actif) break;
                            const r = await resultat(v.id, lic, k, false);
                            if (r.moyenne) points.push({ km: k, moyenne: r.moyenne, fiabilite: r.fiabilite, tranches: r.tranches });
                            await pause(700);
                        }
                        await envoyer({ plaque: dm.plaque, ref: dm.ref, grille: true, points });
                    } else {
                        const r = await resultat(v.id, lic, km, true), vh = r.veh || {};
                        Object.assign(version, { make_model: vh.make_model, submodel: vh.avs_submodel, energy: (vh.energy || {}).label, power: vh.commercial_power, gearbox: (vh.gearbox || {}).label, car_type: vh.car_type, seats: vh.seats });
                        await envoyer({ plaque: dm.plaque, ref: dm.ref, km, version, moyenne: r.moyenne, fiabilite: r.fiabilite, tranches: r.tranches, ventes: r.ventes, offre_demande: r.offre_demande, points: r.moyenne ? [{ km, moyenne: r.moyenne, fiabilite: r.fiabilite, tranches: r.tranches }] : [], erreur: r.moyenne ? '' : 'pas de prix Sonar pour cette version' });
                    }
                    E.faits++; E.i++; E.dernier = `${dm.plaque} · ${v.label}`; freins = 0;
                    window.__sonarLog.splice(0, Math.max(0, window.__sonarLog.length - 60));
                    await pause(900 + Math.random() * 900);
                } catch (e) {
                    E.derniereErreur = `${dm.plaque} : ${e.message}`;
                    if (e.frein) { freins++; if (freins >= 4) { E.actif = false; E.derniereErreur += ' — arrêt (Leboncoin freine)'; break; } await pause(60000 * freins); continue; }
                    E.erreurs++; E.i++;
                    try { await envoyer({ plaque: dm.plaque, ref: dm.ref, erreur: e.message }); } catch (e2) { /* rien */ }
                    await pause(2000);
                }
            }
            E.actif = false;
        })();
        return `lancé : ${E.file.length - E.i} plaques (${mode})`;
    };
})();
