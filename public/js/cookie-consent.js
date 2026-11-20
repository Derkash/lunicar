/**
 * LUNICAR - Cookie Consent RGPD
 * Manages cookie consent and Google Analytics loading
 */

(function() {
    'use strict';

    const CONSENT_COOKIE_NAME = 'lunicar_cookie_consent';
    const CONSENT_DURATION_DAYS = 365;
    const GA_ID = 'G-MYS8P4VYJ3';

    // Get consent status from cookie
    function getConsent() {
        const cookie = document.cookie
            .split('; ')
            .find(row => row.startsWith(CONSENT_COOKIE_NAME + '='));

        if (cookie) {
            try {
                return JSON.parse(decodeURIComponent(cookie.split('=')[1]));
            } catch (e) {
                return null;
            }
        }
        return null;
    }

    // Save consent to cookie
    function saveConsent(consent) {
        const expires = new Date();
        expires.setDate(expires.getDate() + CONSENT_DURATION_DAYS);

        document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(consent))}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
    }

    // Load Google Analytics
    function loadGoogleAnalytics() {
        if (window.gaLoaded) return;

        // Load gtag.js script
        const script = document.createElement('script');
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
        document.head.appendChild(script);

        // Initialize gtag
        window.dataLayer = window.dataLayer || [];
        function gtag() { dataLayer.push(arguments); }
        window.gtag = gtag;
        // Consent Mode v2, mode basique : le tag n'est chargé qu'après un accord. On transmet à Google
        // le détail de cet accord (mesure d'audience / publicité), tout est refusé par défaut.
        const c = getConsent() || {};
        gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
        majConsentement(c);
        gtag('js', new Date());
        // Jamais de plaque d'immatriculation dans les adresses envoyées à Google (donnée personnelle).
        const loc = new URL(location.href);
        ['plaque', 'immat'].forEach(k => loc.searchParams.delete(k));
        gtag('config', GA_ID, { page_location: loc.toString() });

        window.gaLoaded = true;
    }

    // Transmet le choix du visiteur à Google (Consent Mode v2).
    function majConsentement(c) {
        if (typeof window.gtag !== 'function') return;
        const v = ok => ok ? 'granted' : 'denied';
        window.gtag('consent', 'update', { analytics_storage: v(c.analytics), ad_storage: v(c.ads), ad_user_data: v(c.ads), ad_personalization: v(c.ads) });
    }

    // Applique un choix : enregistré, transmis à Google, tag chargé si au moins une mesure est acceptée.
    function appliquer(c) {
        saveConsent(c);
        if (c.analytics || c.ads) { if (window.gaLoaded) majConsentement(c); else loadGoogleAnalytics(); }
        else majConsentement(c);
    }

    // Create and show the cookie banner
    function showBanner() {
        // Check if banner already exists
        if (document.getElementById('cookieBanner')) return;

        const banner = document.createElement('div');
        banner.id = 'cookieBanner';
        banner.className = 'cookie-banner';
        banner.innerHTML = `
            <div class="cookie-banner-content">
                <div class="cookie-banner-text">
                    <p>Nous utilisons des cookies pour mesurer l'audience du site et l'efficacité de nos annonces Google.
                    <a href="/politique-confidentialite">En savoir plus</a></p>
                </div>
                <div class="cookie-banner-actions">
                    <button type="button" class="cookie-btn cookie-btn-accept" id="cookieAcceptAll">Accepter tout</button>
                    <button type="button" class="cookie-btn cookie-btn-refuse" id="cookieRefuse">Refuser</button>
                    <button type="button" class="cookie-btn cookie-btn-customize" id="cookieCustomize">Personnaliser</button>
                </div>
            </div>
            <div class="cookie-banner-customize" id="cookieCustomizePanel" style="display: none;">
                <div class="cookie-option">
                    <label>
                        <input type="checkbox" checked disabled>
                        <span class="cookie-option-text"><span>Cookies essentiels</span><small>Nécessaires au fonctionnement du site</small></span>
                    </label>
                </div>
                <div class="cookie-option">
                    <label>
                        <input type="checkbox" id="cookieAnalytics">
                        <span class="cookie-option-text"><span>Cookies de mesure d'audience</span><small>Google Analytics : pages vues et parcours, sans donnée revendue</small></span>
                    </label>
                </div>
                <div class="cookie-option">
                    <label>
                        <input type="checkbox" id="cookieAds">
                        <span class="cookie-option-text"><span>Cookies publicitaires</span><small>Google Ads : mesurer quelles annonces amènent une demande</small></span>
                    </label>
                </div>
                <div class="cookie-customize-actions">
                    <button type="button" class="cookie-btn cookie-btn-save" id="cookieSavePrefs">Enregistrer mes choix</button>
                </div>
            </div>
        `;

        document.body.appendChild(banner);

        // Event listeners
        document.getElementById('cookieAcceptAll').addEventListener('click', function() {
            appliquer({ essential: true, analytics: true, ads: true });
            hideBanner();
        });

        document.getElementById('cookieRefuse').addEventListener('click', function() {
            appliquer({ essential: true, analytics: false, ads: false });
            hideBanner();
        });

        document.getElementById('cookieCustomize').addEventListener('click', function() {
            const panel = document.getElementById('cookieCustomizePanel');
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        });

        document.getElementById('cookieSavePrefs').addEventListener('click', function() {
            appliquer({ essential: true, analytics: document.getElementById('cookieAnalytics').checked, ads: document.getElementById('cookieAds').checked });
            hideBanner();
        });

        // Show banner with animation
        setTimeout(function() {
            banner.classList.add('cookie-banner-visible');
        }, 100);
    }

    // Hide the cookie banner
    function hideBanner() {
        const banner = document.getElementById('cookieBanner');
        if (banner) {
            banner.classList.remove('cookie-banner-visible');
            setTimeout(function() {
                banner.remove();
            }, 300);
        }
    }

    // Initialize
    function init() {
        const consent = getConsent();

        if (consent === null || !('ads' in consent)) {
            // Pas encore de choix, ou choix d'avant l'option publicité (on redemande une fois)
            showBanner();
        } else if (consent.analytics || consent.ads) {
            // User accepted analytics, load GA
            loadGoogleAnalytics();
        }
        // If consent exists but analytics is false, do nothing (GA stays blocked)
    }

    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
