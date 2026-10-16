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
                const utm = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'gclid'].filter(k => q.get(k)).map(k => `${k}=${q.get(k)}`).join('&');
                p = [utm, document.referrer && !document.referrer.includes(location.host) ? `ref=${document.referrer}` : '', `entree=${location.pathname}`].filter(Boolean).join(' | ');
                sessionStorage.setItem('lunicar_prov', p);
            }
            return p;
        } catch (e) { return ''; }
    }
    provenance();

    async function post(url, data) {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) throw Object.assign(new Error(json.error || 'Une erreur est survenue. Réessayez dans un instant.'), { field: json.field });
        return json;
    }

    const phoneOk = v => /^0[1-9]\d{8}$/.test(String(v).replace(/[^\d+]/g, '').replace(/^(\+33|0033)/, '0'));

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
        const errorBox = form.querySelector('.lead-error');
        const meterBar = form.querySelector('.lead-meter-bar i');
        const meterPct = form.querySelector('.lead-meter-pct');
        let started = false;

        // Jauge : part des questions déjà franchies.
        const meter = pct => {
            meterBar.style.width = pct + '%';
            meterPct.textContent = pct + ' %';
        };
        const progress = () => meter(Math.round(100 * qs.filter(q => q.classList.contains('done')).length / qs.length));

        // Valide les champs obligatoires d'une question ; la première erreur prend le focus.
        const valid = q => {
            let ok = true; let first = null;
            q.querySelectorAll('[required]').forEach(input => {
                let bad = !input.value.trim();
                if (!bad && input.name === 'telephone') bad = !phoneOk(input.value);
                if (!bad && input.name === 'codePostal') bad = !/^\d{5}$/.test(input.value.trim());
                if (!markInvalid(input, bad)) { ok = false; first = first || input; }
            });
            if (first) first.focus();
            return ok;
        };

        // Révèle la question suivante sous celle qui vient d'être remplie.
        const next = q => {
            if (!valid(q)) return;
            q.classList.add('done');
            const i = qs.indexOf(q);
            const n = qs[i + 1];
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
        };

        qs.forEach(q => {
            q.querySelectorAll('[data-ok]').forEach(b => b.addEventListener('click', () => next(q)));
            q.querySelectorAll('[data-skip]').forEach(b => b.addEventListener('click', () => {
                q.querySelectorAll('input[name=prix]').forEach(i => { i.value = ''; });
                next(q);
            }));
            // Choix uniques : on avance dès la réponse.
            q.querySelectorAll('.choice input[type=radio]').forEach(el => el.addEventListener('change', () => next(q)));
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

        // État : « aucun souci » exclut les autres cases, et inversement.
        const etatOk = form.elements.etatOk;
        const etats = Array.from(form.querySelectorAll('input[name="etat"]'));
        etatOk.addEventListener('change', () => { if (etatOk.checked) etats.forEach(c => { c.checked = false; }); });
        etats.forEach(c => c.addEventListener('change', () => { if (c.checked) etatOk.checked = false; }));

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

        // Date du certificat : JJ/MM/AAAA pendant la saisie ; n° de formule en majuscules.
        const dc = form.elements.dateCertificat;
        dc.addEventListener('input', () => {
            const d = dc.value.replace(/\D/g, '').slice(0, 8);
            dc.value = [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
        });
        const nf = form.elements.numeroFormule;
        nf.addEventListener('input', () => { nf.value = nf.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
        // Le nom saisi pré-remplit le nom du titulaire, tant qu'il n'a pas été modifié à la main.
        const nt = form.elements.nomTitulaire;
        form.elements.nom.addEventListener('input', e => { if (!nt.dataset.touched) nt.value = e.target.value.toUpperCase(); });
        nt.addEventListener('input', () => { nt.dataset.touched = '1'; });

        // Prix souhaité : mêmes espaces de milliers.
        const prix = form.elements.prix;
        prix.addEventListener('input', () => {
            prix.value = prix.value.replace(/\D/g, '').slice(0, 6).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        });

        form.addEventListener('submit', async e => {
            e.preventDefault();
            // Toutes les questions obligatoires doivent avoir été franchies.
            const missing = qs.find(q => q.dataset.q !== 'fin' && (!q.classList.contains('on') || !valid(q)));
            if (missing) { missing.classList.add('on'); missing.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
            const btn = form.querySelector('button[type="submit"]');
            const label = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Envoi…';
            errorBox.hidden = true;
            const f = form.elements;
            const radio = name => (form.querySelector(`input[name="${name}"]:checked`) || {}).value || '';
            try {
                const out = await post('/api/reprise', {
                    type: 'estimation',
                    plaque: f.plaque.value,
                    vehicule: f.vehicule.value,
                    annee: f.annee.value,
                    kilometrage: f.kilometrage.value,
                    prix: f.prix.value,
                    fiche: f.fiche.value,
                    etat: etats.filter(i => i.checked).map(i => i.value),
                    roule: f.etatOk.checked ? 'oui' : '',
                    delai: radio('delai'),
                    achat: radio('achat'),
                    prenom: f.prenom.value,
                    nom: f.nom.value,
                    telephone: f.telephone.value,
                    codePostal: f.codePostal.value,
                    whatsapp: f.whatsapp.checked ? 'oui' : '',
                    titulaire: radio('titulaire'),
                    nomTitulaire: f.nomTitulaire.value,
                    dateCertificat: f.dateCertificat.value,
                    numeroFormule: f.numeroFormule.value,
                    consentHistovec: f.consentHistovec.checked ? 'oui' : '',
                    email: f.email.value,
                    site_web: f.site_web.value,
                    source: form.dataset.source,
                    page: location.pathname,
                    provenance: provenance()
                });
                form.querySelector('[data-ref]').textContent = String(out.id).slice(0, 8).toUpperCase();
                form.dataset.demande = out.id;
                qs.forEach(q => { q.hidden = true; });
                form.querySelector('.lead-done').hidden = false;
                meter(100);
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

    // ---------- Lien Histovec transmis après la demande ----------
    const hv = document.getElementById('histovecForm');
    if (hv && form) {
        const btn = hv.querySelector('[data-histovec]');
        const input = hv.querySelector('input[name="lien"]');
        const msg = hv.querySelector('.callback-msg');
        btn.addEventListener('click', async () => {
            const lien = input.value.trim();
            if (!lien) { markInvalid(input, true); return; }
            btn.disabled = true;
            try {
                await post('/api/reprise/histovec', { id: form.dataset.demande || '', lien });
                msg.textContent = 'Rapport transmis, merci : il sera joint à votre dossier.';
                msg.classList.remove('err');
                input.closest('.field').hidden = true;
                btn.hidden = true;
                track('histovec_transmis', { page: location.pathname });
            } catch (err) {
                msg.textContent = err.message;
                msg.classList.add('err');
                btn.disabled = false;
            }
            msg.hidden = false;
        });
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
        source: 'rappel', page: location.pathname, provenance: provenance()
    }), 'C\'est noté : un conseiller vous rappelle sous 24 h ouvrées.', 'generate_lead');

    simpleForm('contactForm', '/api/contact', f => ({
        nom: f.nom.value, email: f.email.value, telephone: f.telephone.value, message: f.message.value, site_web: f.site_web.value
    }), 'Message envoyé. Nous vous répondons sous 24 h ouvrées.', 'contact_message');
})();
