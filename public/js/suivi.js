/**
 * LUNICAR - Mesure interne du site (onglet « Analyses » de l'admin).
 *
 * Première partie, sans cookie, sans identifiant persistant : un identifiant de visite tiré au
 * hasard et gardé le temps de l'onglet (sessionStorage), jamais l'adresse IP, jamais le nom ni le
 * téléphone. On note : la page vue et d'où vient le visiteur (hôte du site référent, canal),
 * l'appareil (mobile / tablette / ordinateur), chaque question du formulaire atteinte et le temps
 * passé dessus, l'envoi, les photos, les clics sur les boutons d'action, la profondeur de lecture,
 * la durée de la visite et les mesures de vitesse de la page (LCP, CLS, INP, TTFB).
 * Le signal « Global Privacy Control » du navigateur est respecté : rien n'est envoyé.
 */
(function () {
    if (navigator.globalPrivacyControl) return;
    const sid = (() => {
        try { let s = sessionStorage.getItem('lsid'); if (!s) { s = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('lsid', s); } return s; }
        catch (e) { return Math.random().toString(36).slice(2, 10); }
    })();
    const dev = matchMedia('(max-width: 760px)').matches ? 'm' : matchMedia('(max-width: 1100px)').matches ? 't' : 'd';
    const page = location.pathname;
    const ref = (() => { try { return document.referrer ? new URL(document.referrer).host.replace(/^www\./, '') : ''; } catch (e) { return ''; } })();
    const qs = new URLSearchParams(location.search);
    const src = (qs.get('utm_source') || '').toLowerCase();
    const canal = /gclid|gbraid|wbraid/.test(location.search) || qs.get('utm_medium') === 'cpc' ? 'pub'
        : /chatgpt|openai/.test(ref + src) ? 'chatgpt'
        : /perplexity/.test(ref + src) ? 'perplexity'
        : /claude|gemini|mistral|copilot|you\.com/.test(ref + src) ? 'ia'
        : /^bing\.|bing\.com/.test(ref) ? 'bing'
        : /google\./.test(ref) ? 'google'
        : /duckduckgo|ecosia|qwant|yahoo/.test(ref) ? 'moteur'
        : /facebook|instagram|linkedin|tiktok|t\.co|twitter|x\.com|youtube/.test(ref) ? 'reseaux'
        : ref === location.host.replace(/^www\./, '') ? 'interne'
        : ref ? 'site' : 'direct';
    const t0 = performance.timeOrigin || Date.now();
    const file = [];
    let timer;
    function flush() {
        if (!file.length) return;
        const body = JSON.stringify(file.splice(0));
        if (navigator.sendBeacon) { navigator.sendBeacon('/api/suivi', new Blob([body], { type: 'text/plain' })); return; }
        fetch('/api/suivi', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
    }
    function push(ev) {
        file.push(Object.assign({ t: Math.round(Date.now() / 1000), s: sid, p: page, d: dev }, ev));
        clearTimeout(timer);
        timer = setTimeout(flush, 2500);
        if (file.length >= 15) flush();
    }

    push({ e: 'page', r: ref, c: canal, w: innerWidth });

    // Vitesse de la page (mêmes définitions que les Core Web Vitals de Google).
    let lcp = 0, cls = 0, inp = 0;
    try { new PerformanceObserver(l => { const e = l.getEntries(); if (e.length) lcp = e[e.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {}
    try { new PerformanceObserver(l => { l.getEntries().forEach(e => { if (!e.hadRecentInput) cls += e.value; }); }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
    try { new PerformanceObserver(l => { l.getEntries().forEach(e => { if (e.interactionId && e.duration > inp) inp = e.duration; }); }).observe({ type: 'event', buffered: true, durationThreshold: 40 }); } catch (e) {}
    const nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    const ttfb = nav ? Math.round(nav.responseStart) : 0;

    // Profondeur de lecture (pourcentage de la page atteint).
    let maxScroll = 0;
    const mesurerScroll = () => { const h = document.documentElement.scrollHeight - innerHeight; maxScroll = Math.max(maxScroll, h > 0 ? Math.min(100, Math.round(scrollY / h * 100)) : 100); };
    addEventListener('scroll', mesurerScroll, { passive: true });
    setTimeout(mesurerScroll, 1000);

    // Boutons d'action : estimation, appel, WhatsApp, rappel.
    document.addEventListener('click', e => {
        const a = e.target.closest('a[href^="#estimation"], a[href^="tel:"], a[href*="wa.me"], a[href^="/reprise"], [data-track]');
        if (!a) return;
        const href = a.getAttribute('href') || '';
        push({ e: 'clic', k: href.startsWith('tel:') ? 'tel' : href.includes('wa.me') ? 'whatsapp' : a.dataset.track ? 'contact_' + a.dataset.track : href.startsWith('#') ? 'estimation' : 'formulaire' });
    });

    // Formulaire : appelé par app.js à chaque événement (début, question atteinte, envoi, photos).
    let dernier = Date.now();
    window.lunicarSuivi = function (nom, params) {
        const p = params || {};
        const maintenant = Date.now();
        const dt = Math.min(3600, Math.round((maintenant - dernier) / 1000));
        dernier = maintenant;
        if (nom === 'lead_form_start') push({ e: 'debut' });
        else if (nom === 'lead_question') push({ e: 'q', q: String(p.question || '').slice(0, 20), dt });
        else if (nom === 'generate_lead') push({ e: 'envoi', k: String(p.type || 'estimation').slice(0, 20), dt });
        else if (nom === 'photos_envoyees') push({ e: 'photos', n: Number(p.nombre) || 0 });
        else if (nom === 'plaque_reconnue') push({ e: 'plaque' });
    };

    // Fin de la visite de la page : vitesse, lecture, durée.
    let fini = false;
    const fin = () => {
        if (fini) return;
        fini = true;
        mesurerScroll();
        push({ e: 'fin', lcp: Math.round(lcp), cls: Math.round(cls * 1000) / 1000, inp: Math.round(inp), ttfb, sc: maxScroll, dur: Math.round((Date.now() - t0) / 1000) });
        flush();
    };
    addEventListener('pagehide', fin);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') fin(); });
})();
