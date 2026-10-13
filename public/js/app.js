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
        if (lead && 'IntersectionObserver' in window) {
            new IntersectionObserver(([e]) => bar.classList.toggle('show', !e.isIntersecting), { threshold: 0.15 }).observe(lead);
        } else {
            bar.classList.add('show');
        }
    }

    document.querySelectorAll('[data-track]').forEach(a => {
        a.addEventListener('click', () => track('contact_' + a.dataset.track, { page: location.pathname }));
    });

    // ---------- Formulaire de demande ----------
    const form = document.getElementById('leadForm');
    if (form) {
        const steps = form.querySelectorAll('.lead-step');
        const dots = form.querySelectorAll('.lead-progress span');
        const errorBox = form.querySelector('.lead-error');
        let started = false;

        const show = name => {
            steps.forEach(s => s.classList.toggle('on', s.dataset.step === String(name)));
            dots.forEach((d, i) => d.classList.toggle('on', name === 'done' || i < Number(name)));
            if (name === 'done') form.querySelector('.lead-head').hidden = true;
            const top = form.getBoundingClientRect().top;
            if (top < 70) window.scrollBy({ top: top - 84, behavior: 'smooth' });
        };

        form.addEventListener('input', e => {
            if (!started) { started = true; track('form_start', { page: location.pathname }); }
            markInvalid(e.target, false);
        });

        // Plaque : majuscules et tirets au format AB-123-CD.
        const plaque = form.elements.plaque;
        plaque.addEventListener('input', () => {
            let v = plaque.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (/^[A-Z]{2}\d{0,3}[A-Z]{0,2}$/.test(v)) v = [v.slice(0, 2), v.slice(2, 5), v.slice(5, 7)].filter(Boolean).join('-');
            plaque.value = v;
        });

        // Kilométrage : espaces de milliers pendant la saisie.
        const km = form.elements.kilometrage;
        km.addEventListener('input', () => {
            const d = km.value.replace(/\D/g, '').slice(0, 7);
            km.value = d.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        });

        const validate = (stepName) => {
            const step = form.querySelector(`.lead-step[data-step="${stepName}"]`);
            let ok = true;
            let first = null;
            step.querySelectorAll('[required]').forEach(input => {
                let bad = !input.value.trim();
                if (!bad && input.name === 'telephone') bad = !phoneOk(input.value);
                if (!bad && input.name === 'codePostal') bad = !/^\d{5}$/.test(input.value.trim());
                if (!markInvalid(input, bad)) { ok = false; first = first || input; }
            });
            if (first) first.focus();
            return ok;
        };

        form.querySelector('[data-next]').addEventListener('click', () => {
            if (!validate(1)) return;
            track('form_step2', { page: location.pathname });
            show(2);
            form.elements.prenom.focus({ preventScroll: true });
        });
        form.querySelector('[data-prev]').addEventListener('click', () => show(1));

        form.addEventListener('submit', async e => {
            e.preventDefault();
            if (!validate(2)) return;
            const btn = form.querySelector('button[type="submit"]');
            const label = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Envoi…';
            errorBox.hidden = true;
            const f = form.elements;
            try {
                const out = await post('/api/reprise', {
                    type: 'estimation',
                    plaque: f.plaque.value,
                    vehicule: f.vehicule.value,
                    annee: f.annee.value,
                    kilometrage: f.kilometrage.value,
                    etat: Array.from(form.querySelectorAll('input[name="etat"]:checked')).map(i => i.value),
                    prenom: f.prenom.value,
                    telephone: f.telephone.value,
                    codePostal: f.codePostal.value,
                    email: f.email.value,
                    site_web: f.site_web.value,
                    source: form.dataset.source,
                    page: location.pathname,
                    provenance: provenance()
                });
                form.querySelector('[data-ref]').textContent = String(out.id).slice(0, 8).toUpperCase();
                show('done');
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
