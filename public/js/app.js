// LUNICAR - interactions des pages publiques : menu, formulaire de demande, rappel, contact.
(function () {
    'use strict';

    // Mesure : uniquement si l'audience a été acceptée (gtag n'existe pas sinon).
    function track(name, params) {
        if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
    }

    // D'où vient le visiteur : conservé pour la durée de la visite et joint à la demande.
    function provenance() {
        try {
            let p = sessionStorage.getItem('lunicar_prov');
            if (!p) {
                const q = new URLSearchParams(location.search);
                const utm = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid'].filter(k => q.get(k)).map(k => `${k}=${q.get(k)}`).join('&');
                p = [utm, document.referrer && !document.referrer.includes(location.host) ? `ref=${document.referrer}` : '', `entree=${location.pathname}`].filter(Boolean).join(' | ');
                sessionStorage.setItem('lunicar_prov', p);
            }
            return p;
        } catch (e) { return ''; }
    }
    provenance();

    // Identifiant de clic Google Ads (gclid, ou gbraid/wbraid sur iOS), gardé 90 jours :
    // il relie une voiture achetée au clic d'origine (import des conversions hors ligne).
    function clicAds() {
        try {
            const q = new URLSearchParams(location.search);
            const k = ['gclid', 'gbraid', 'wbraid'].find(x => q.get(x));
            if (k) localStorage.setItem('lunicar_clic', JSON.stringify({ v: `${k}=${q.get(k)}`, t: Date.now() }));
            const c = JSON.parse(localStorage.getItem('lunicar_clic') || 'null');
            return c && Date.now() - c.t < 90 * 864e5 ? c.v : '';
        } catch (e) { return ''; }
    }
    clicAds();

    async function post(url, data) {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) throw Object.assign(new Error(json.error || 'Une erreur est survenue. Réessayez dans un instant.'), { field: json.field });
        return json;
    }

    // Mêmes formes acceptées que le serveur (lib/config.js parsePhone) : 06…, +33 6…, 0033 6…, 33 6….
    const phoneOk = v => /^0[1-9]\d{8}$/.test(String(v).replace(/[^\d+]/g, '').replace(/^(\+33|0033|33(?=\d{9}$))/, '0'));

    function markInvalid(input, bad) {
        const field = input.closest('.field');
        if (field) field.classList.toggle('invalid', bad);
        return !bad;
    }

    // ---------- Menu mobile ----------
    const toggle = document.querySelector('.nav-toggle');
    const nav = document.getElementById('siteNav');
    if (toggle && nav) {
        toggle.addEventListener('click', () => {
            const open = nav.classList.toggle('open');
            toggle.setAttribute('aria-expanded', String(open));
        });
    }

    // ---------- Barre d'action mobile : visible dès que le formulaire sort de l'écran ----------
    const bar = document.getElementById('ctaBar');
    const lead = document.getElementById('estimation');
    if (bar) {
        const targets = [lead, document.getElementById('quickStart')].filter(Boolean);
        if (targets.length && 'IntersectionObserver' in window) {
            const seen = new Map();
            const io = new IntersectionObserver(entries => {
                entries.forEach(e => seen.set(e.target, e.isIntersecting));
                bar.classList.toggle('show', ![...seen.values()].some(Boolean));
            }, { threshold: 0.15 });
            targets.forEach(t => io.observe(t));
        } else {
            bar.classList.add('show');
        }
    }

    document.querySelectorAll('[data-track]').forEach(a => {
        a.addEventListener('click', () => track('contact_' + a.dataset.track, { page: location.pathname }));
    });

    // ---------- Formulaire de demande ----------
    const form = document.getElementById('leadForm');

    // Plaque transmise par l'adresse (?immat=) : reprise dans le formulaire puis retirée de l'URL.
    try {
        const q = new URLSearchParams(location.search);
        const immat = q.get('immat') || q.get('plaque');
        if (immat || q.has('immat') || q.has('plaque')) {
            q.delete('immat'); q.delete('plaque');
            history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
        }
        if (immat && form) {
            form.elements.plaque.value = immat;
            setTimeout(() => form.elements.plaque.dispatchEvent(new Event('input', { bubbles: true })), 0);
        }
    } catch (e) { /* navigateur ancien */ }

    // Accueil : la saisie de plaque du bandeau alimente le formulaire complet.
    const quick = document.getElementById('quickStart');
    if (quick && form) {
        const qp = quick.querySelector('input');
        qp.addEventListener('input', () => {
            let v = qp.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (/^[A-Z]{2}\d{0,3}[A-Z]{0,2}$/.test(v)) v = [v.slice(0, 2), v.slice(2, 5), v.slice(5, 7)].filter(Boolean).join('-');
            qp.value = v;
        });
        quick.addEventListener('submit', e => {
            e.preventDefault();
            track('plaque_saisie', { page: location.pathname, renseignee: qp.value ? 'oui' : 'non' });
            if (qp.value) {
                form.elements.plaque.value = qp.value;
                form.elements.plaque.dispatchEvent(new Event('input', { bubbles: true }));
            }
            document.getElementById('estimation').scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(() => (qp.value ? form.elements.kilometrage : form.elements.plaque).focus({ preventScroll: true }), 450);
        });
    }

    if (form) {
        const qs = Array.from(form.querySelectorAll('.q'));
        // Identifiant du brouillon : relie les sauvegardes intermédiaires à la demande finale.
        const draftId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
        let envoyee = false;
        let etape = 'vehicule';
        const errorBox = form.querySelector('.lead-error');
        const meterBar = form.querySelector('.lead-meter-bar i');
        const meterPct = form.querySelector('.lead-meter-pct');
        let started = false;

        // Jauge : part des questions déjà franchies.
        const meter = pct => {
            meterBar.style.width = pct + '%';
            meterPct.textContent = pct + ' %';
        };
        const progress = () => meter(Math.min(99, Math.round(100 * qs.filter(q => q.classList.contains('done')).length / qs.length)));

        // Valide les champs obligatoires d'une question ; la première erreur prend le focus.
        const valid = q => {
            let ok = true; let first = null;
            q.querySelectorAll('[required]').forEach(input => {
                let bad = !input.value.trim();
                if (!bad && input.name === 'telephone') bad = !phoneOk(input.value);
                if (!bad && input.name === 'codePostal') bad = !/^\d{5}$/.test(input.value.trim());
                if (!markInvalid(input, bad)) { ok = false; first = first || input; }
            });
            q.querySelectorAll('.choices[data-required]').forEach(g => {
                const bad = !g.querySelector('input:checked');
                g.classList.toggle('invalid', bad);
                if (bad) ok = false;
            });
            if (first) first.focus();
            return ok;
        };

        // Questions conditionnelles (data-if="champ=val1,val2") : affichées seulement si la réponse correspond.
        const radio0 = name => (form.querySelector(`input[name="${name}"]:checked`) || {}).value || '';
        const pertinente = q => {
            const c = q.dataset.if;
            if (!c) return true;
            const [champ, vals] = c.split('=');
            return vals.split(',').includes(radio0(champ));
        };
        const viderQ = q => q.querySelectorAll('input[type=radio], input[type=checkbox]').forEach(i => { i.checked = false; });
        // Réévalue les questions conditionnelles déjà atteintes après un changement de réponse.
        const majConditions = () => qs.forEach(q => {
            if (!q.dataset.if || !q.classList.contains('on')) return;
            const ok = pertinente(q);
            if (!ok && !q.hidden) { q.hidden = true; q.classList.add('done'); viderQ(q); }
            else if (ok && q.hidden) { q.hidden = false; q.classList.remove('done'); }
        });

        // Révèle la question suivante sous celle qui vient d'être remplie.
        const next = q => {
            if (!valid(q)) return;
            q.classList.add('done');
            etape = q.dataset.q;
            let i = qs.indexOf(q);
            let n = qs[i + 1];
            while (n && n.dataset.if && !pertinente(n)) { n.hidden = true; n.classList.add('done', 'on'); viderQ(n); n = qs[qs.indexOf(n) + 1]; }
            if (n && n.dataset.if && n.hidden) n.hidden = false;
            if (n && !n.classList.contains('on')) {
                n.classList.add('on');
                track('lead_question', { question: n.dataset.q, page: location.pathname });
                const field = n.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select');
                setTimeout(() => {
                    n.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    if (field && !field.value) field.focus({ preventScroll: true });
                }, 60);
            }
            progress();
            sauverBrouillon();
        };

        qs.forEach(q => {
            q.querySelectorAll('[data-ok]').forEach(b => b.addEventListener('click', () => next(q)));
            q.querySelectorAll('[data-skip]').forEach(b => b.addEventListener('click', () => {
                // « Je préfère votre estimation » / « Je ne l'ai pas sous la main » : rien de la question n'est envoyé.
                q.querySelectorAll('input[type=text], input[type=tel]').forEach(i => { i.value = ''; });
                next(q);
            }));
            // Choix uniques : on avance dès la réponse (sauf « titulaire : non », qui demande un nom,
            // et les questions à plusieurs groupes, validées par « Continuer »).
            const plusieurs = q.querySelectorAll('.choices').length > 1;
            q.querySelectorAll('.choice input[type=radio]').forEach(el => el.addEventListener('change', () => {
                el.closest('.choices').classList.remove('invalid');
                majConditions();
                if (plusieurs) return;
                if (q.dataset.q === 'titulaire') {
                    const sub = q.querySelector('.q-sub');
                    sub.hidden = el.value !== 'non';
                    if (el.value === 'non') { sub.querySelector('input').focus(); return; }
                }
                next(q);
            }));
            // Entrée = Continuer.
            q.addEventListener('keydown', e => {
                if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'submit' && q.dataset.q !== 'fin') {
                    e.preventDefault();
                    next(q);
                }
            });
        });

        form.addEventListener('input', e => {
            if (!started) { started = true; track('lead_form_start', { page: location.pathname }); }
            markInvalid(e.target, false);
        });

        // Plaque : majuscules et tirets au format AB-123-CD.
        const plaque = form.elements.plaque;
        plaque.addEventListener('input', () => {
            let v = plaque.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (/^[A-Z]{2}\d{0,3}[A-Z]{0,2}$/.test(v)) v = [v.slice(0, 2), v.slice(2, 5), v.slice(5, 7)].filter(Boolean).join('-');
            plaque.value = v;
        });

        // Plaque reconnue : datation immédiate (décodeur local), puis fiche véhicule si le serveur en a une.
        const info = form.querySelector('#plateInfo');
        let derniere = '';
        let anneeAuto = false;
        const showInfo = (txt, muted) => { info.textContent = txt; info.classList.toggle('muted', !!muted); info.hidden = !txt; };
        async function lirePlaque() {
            const P = window.LunicarPlaque;
            if (!P) return;
            const a = P.analyser(plaque.value);
            if (a.format === 'inconnu' || a.plaque === derniere) {
                if (a.format === 'inconnu') {
                    // Plaque complète mais illisible : on le dit, la saisie manuelle reste possible.
                    const brut = plaque.value.replace(/[^A-Z0-9]/gi, '');
                    showInfo(brut.length >= 7 ? 'Format de plaque non reconnu. Vérifiez-la, ou renseignez simplement la marque et le modèle ci-dessous.' : '', true);
                }
                return;
            }
            derniere = a.plaque;
            showInfo(a.libelle, a.format !== 'siv');
            const sel = form.elements.annee;
            if (a.annee && (!sel.value || anneeAuto)) { sel.value = String(a.annee); anneeAuto = true; }
            track('plaque_reconnue', { format: a.format });
            if (a.format === 'siv' || a.format === 'fni') showInfo(a.libelle + ' · recherche des caractéristiques du véhicule…', true);
            try {
                const r = await fetch('/api/vehicule/' + encodeURIComponent(a.plaque)).then(x => x.ok ? x.json() : null);
                if (derniere === a.plaque && !(r && r.fiche)) {
                    showInfo(a.libelle + '. Véhicule non trouvé automatiquement : renseignez la marque, le modèle et le kilométrage ci-dessous.', true);
                    form.elements.vehicule.focus({ preventScroll: true });
                }
                const f = r && r.fiche;
                if (!f || derniere !== a.plaque) return;
                const nom = [f.marque, f.modele, f.version].filter(Boolean).join(' ');
                const veh = form.elements.vehicule;
                // Remplace un modèle déjà rempli par une plaque précédente, jamais une saisie manuelle.
                if (nom && (!veh.value.trim() || veh.dataset.auto === '1')) { veh.value = nom; veh.dataset.auto = '1'; }
                if (f.annee && (!sel.value || anneeAuto)) sel.value = f.annee;
                const det = [nom, f.energie, f.boite, f.puissanceFiscale ? f.puissanceFiscale + ' CV' : '', f.miseEnCirculation ? 'mise en circulation ' + f.miseEnCirculation : ''].filter(Boolean).join(' · ');
                form.elements.fiche.value = det;
                showInfo('Véhicule reconnu : ' + det + '. Corrigez si besoin.');
            } catch (e) { /* la datation locale suffit */ }
        }
        plaque.addEventListener('input', lirePlaque);
        form.elements.vehicule.addEventListener('input', e => { e.target.dataset.auto = ''; });
        form.elements.annee.addEventListener('change', () => { anneeAuto = false; });

        // Kilométrage : espaces de milliers, alerte si incohérent avec l'année (sans bloquer).
        const km = form.elements.kilometrage;
        const warn = form.querySelector('.q-warn');
        km.addEventListener('input', () => {
            const d = km.value.replace(/\D/g, '').slice(0, 7);
            km.value = d.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
            const kms = parseInt(d, 10) || 0;
            const an = parseInt(form.elements.annee.value, 10);
            const age = an ? Math.max(0.5, new Date().getFullYear() - an + 0.5) : 0;
            warn.hidden = !(kms && age && (kms / age > 45000 || (age > 3 && kms / age < 1500)));
        });

        // N° du certificat en majuscules.
        const nf = form.elements.numeroFormule;
        nf.addEventListener('input', () => { nf.value = nf.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

        // Code postal -> commune(s) affichée(s) ; plusieurs communes : le vendeur choisit.
        const cp = form.elements.codePostal;
        const villeBox = form.querySelector('.cp-ville');
        const villeInput = form.elements.ville;
        let cpCherche = '';
        async function chercherVille() {
            const v = cp.value.replace(/\D/g, '').slice(0, 5);
            cp.value = v;
            if (v.length !== 5) { villeBox.hidden = true; villeInput.value = ''; cpCherche = ''; return; }
            if (v === cpCherche) return;
            cpCherche = v;
            try {
                const r = await fetch('/api/ville/' + v).then(x => x.ok ? x.json() : { villes: [] });
                if (cp.value !== v) return;
                const villes = r.villes || [];
                if (!villes.length) { villeBox.textContent = 'Code postal inconnu, vérifiez-le.'; villeBox.className = 'cp-ville err'; villeBox.hidden = false; villeInput.value = ''; return; }
                villeInput.value = villes[0];
                villeBox.className = 'cp-ville';
                villeBox.innerHTML = villes.length === 1
                    ? '<span>' + villes[0].replace(/</g, '&lt;') + '</span>'
                    : '<select aria-label="Votre commune">' + villes.map(n => '<option>' + n.replace(/</g, '&lt;') + '</option>').join('') + '</select>';
                const sel = villeBox.querySelector('select');
                if (sel) sel.addEventListener('change', () => { villeInput.value = sel.value; });
                villeBox.hidden = false;
            } catch (e) { villeBox.hidden = true; }
        }
        cp.addEventListener('input', chercherVille);
        if (cp.value) chercherVille();

        // Prix souhaité : mêmes espaces de milliers.
        const prix = form.elements.prix;
        prix.addEventListener('input', () => {
            prix.value = prix.value.replace(/\D/g, '').slice(0, 6).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        });

        const radio = name => (form.querySelector(`input[name="${name}"]:checked`) || {}).value || '';
        const coches = name => Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map(i => i.value);
        const collecte = () => {
            const f = form.elements;
            return {
                type: 'estimation', draftId, etape,
                plaque: f.plaque.value, vehicule: f.vehicule.value, annee: f.annee.value, kilometrage: f.kilometrage.value,
                prix: f.prix.value, fiche: f.fiche.value,
                mecanique: radio('mecanique'), carrosserie: radio('carrosserie'), ct: radio('ct'), delai: radio('delai'), achat: radio('achat'),
                organes: coches('organes'), panne: radio('panne'), deplacable: radio('deplacable'), voyant: radio('voyant'), degats: coches('degats'),
                cles: radio('cles'), carnet: radio('carnet'), premiere_main: radio('premiere_main'), importee: radio('importee'), financement: radio('financement'),
                prenom: f.prenom.value, nom: f.nom.value, telephone: f.telephone.value, codePostal: f.codePostal.value, ville: f.ville.value,
                titulaire: radio('titulaire'), nomTitulaire: radio('titulaire') === 'non' ? f.nomTitulaire.value : '', numeroFormule: f.numeroFormule.value,
                email: f.email.value, message: f.message.value, site_web: f.site_web.value,
                source: form.dataset.source, page: location.pathname, provenance: provenance(), clicAds: clicAds()
            };
        };
        // Dès que le téléphone est connu, l'état du formulaire est gardé côté serveur :
        // une demande quittée en cours de route vous parvient comme « abandonnée ».
        function sauverBrouillon(beacon) {
            if (envoyee || !phoneOk(form.elements.telephone.value)) return;
            const body = JSON.stringify(collecte());
            if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/reprise/brouillon', new Blob([body], { type: 'text/plain' })); return; }
            fetch('/api/reprise/brouillon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
        }
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') sauverBrouillon(true); });
        window.addEventListener('pagehide', () => sauverBrouillon(true));

        form.addEventListener('submit', async e => {
            e.preventDefault();
            // Toutes les questions obligatoires doivent avoir été franchies.
            const missing = qs.find(q => q.dataset.q !== 'fin' && !q.hidden && (!q.classList.contains('on') || !valid(q)));
            if (missing) { missing.classList.add('on'); missing.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
            const btn = form.querySelector('button[type="submit"]');
            const label = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Envoi…';
            errorBox.hidden = true;
            const f = form.elements;
            try {
                const out = await post('/api/reprise', collecte());
                envoyee = true;
                form.querySelector('[data-ref]').textContent = String(out.id).slice(0, 8).toUpperCase();
                form.dataset.demande = out.id;
                qs.forEach(q => { q.hidden = true; });
                form.querySelector('.lead-photos').hidden = false;
                meter(95);
                form.scrollIntoView({ behavior: 'smooth', block: 'start' });
                track('generate_lead', { type: 'estimation', page: location.pathname, source: form.dataset.source });
            } catch (err) {
                errorBox.textContent = err.message;
                errorBox.hidden = false;
                if (err.field && f[err.field]) markInvalid(f[err.field], true);
                btn.disabled = false;
                btn.textContent = label;
            }
        });
    }

    // ---------- Photos après la demande (facultatif) ----------
    const photosBox = form && form.querySelector('.lead-photos');
    if (photosBox) {
        const grid = photosBox.querySelector('.photo-grid');
        const sendBtn = photosBox.querySelector('[data-photos-send]');
        const err = photosBox.querySelector('.photo-error');
        const fichiers = [];
        const terminer = () => {
            photosBox.hidden = true;
            form.querySelector('.lead-done').hidden = false;
            // Demande envoyée : le déroulé générique de la page n'a plus d'utilité, l'écran de fin donne les étapes.
            document.querySelectorAll('.section-steps').forEach(sec => { sec.hidden = true; });
            const bar = form.querySelector('.lead-meter-bar i');
            bar.style.width = '100%';
            form.querySelector('.lead-meter-pct').textContent = '100 %';
            form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        // Réduit chaque photo (1600 px max, JPEG) : envoi rapide même en 4G.
        const reduire = file => new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                const k = Math.min(1, 1600 / Math.max(img.width, img.height));
                const c = document.createElement('canvas');
                c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                c.toBlob(b => { URL.revokeObjectURL(img.src); resolve(b || file); }, 'image/jpeg', 0.82);
            };
            img.onerror = () => resolve(file);
            img.src = URL.createObjectURL(file);
        });
        const afficher = () => {
            grid.innerHTML = '';
            fichiers.forEach((f, i) => {
                const li = document.createElement('li');
                const im = document.createElement('img');
                im.src = URL.createObjectURL(f); im.alt = 'Photo ' + (i + 1);
                const del = document.createElement('button');
                del.type = 'button'; del.className = 'photo-del'; del.setAttribute('aria-label', 'Retirer la photo ' + (i + 1)); del.textContent = '×';
                del.addEventListener('click', () => { fichiers.splice(i, 1); afficher(); });
                li.append(im, del); grid.append(li);
            });
            sendBtn.disabled = !fichiers.length;
        };
        photosBox.querySelectorAll('[data-photos]').forEach(input => input.addEventListener('change', async () => {
            for (const f of Array.from(input.files || []).slice(0, 12 - fichiers.length)) fichiers.push(await reduire(f));
            input.value = '';
            afficher();
        }));
        sendBtn.addEventListener('click', async () => {
            if (!fichiers.length) return;
            sendBtn.disabled = true;
            const label = sendBtn.innerHTML;
            sendBtn.textContent = 'Envoi des photos…';
            err.hidden = true;
            const fd = new FormData();
            fichiers.forEach((f, i) => fd.append('photos', f, 'photo-' + (i + 1) + '.jpg'));
            try {
                const r = await fetch('/api/reprise/' + encodeURIComponent(form.dataset.demande) + '/photos', { method: 'POST', body: fd });
                const j = await r.json().catch(() => ({}));
                if (!r.ok || !j.success) throw new Error(j.error || 'Envoi impossible, réessayez.');
                track('photos_envoyees', { nombre: fichiers.length });
                terminer();
            } catch (e) {
                err.textContent = e.message; err.hidden = false;
                sendBtn.disabled = false; sendBtn.innerHTML = label;
            }
        });
        photosBox.querySelector('[data-photos-skip]').addEventListener('click', terminer);
    }

    // ---------- Rappel et contact : même mécanique ----------
    function simpleForm(id, url, build, okText, eventName) {
        const el = document.getElementById(id);
        if (!el) return;
        const msg = el.querySelector('.callback-msg');
        el.addEventListener('input', e => markInvalid(e.target, false));
        el.addEventListener('submit', async e => {
            e.preventDefault();
            let ok = true;
            el.querySelectorAll('[required]').forEach(input => {
                let bad = !input.value.trim();
                if (!bad && input.name === 'telephone') bad = !phoneOk(input.value);
                if (!bad && input.type === 'email') bad = !/^\S+@\S+\.\S+$/.test(input.value.trim());
                if (!markInvalid(input, bad)) ok = false;
            });
            if (!ok) return;
            const btn = el.querySelector('button[type="submit"]');
            btn.disabled = true;
            try {
                await post(url, build(el.elements));
                msg.textContent = okText;
                msg.classList.remove('err');
                msg.hidden = false;
                el.querySelectorAll('.field, button[type="submit"]').forEach(n => { n.hidden = true; });
                track(eventName, { page: location.pathname });
            } catch (err) {
                msg.textContent = err.message;
                msg.classList.add('err');
                msg.hidden = false;
                btn.disabled = false;
            }
        });
    }

    simpleForm('callbackForm', '/api/reprise', f => ({
        type: 'rappel', prenom: f.prenom.value, telephone: f.telephone.value, site_web: f.site_web.value,
        source: 'rappel', page: location.pathname, provenance: provenance(), clicAds: clicAds()
    }), 'C\'est noté : un conseiller vous rappelle rapidement pour étudier votre voiture.', 'generate_lead');

    simpleForm('contactForm', '/api/contact', f => ({
        nom: f.nom.value, email: f.email.value, telephone: f.telephone.value, message: f.message.value, site_web: f.site_web.value
    }), 'Message envoyé. Nous vous répondons rapidement.', 'contact_message');
})();
