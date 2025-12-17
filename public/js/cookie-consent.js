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
        gtag('js', new Date());
        gtag('config', GA_ID);

        window.gaLoaded = true;
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
                    <p>Nous utilisons des cookies pour analyser notre trafic et ameliorer votre experience.
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
                        <span>Cookies essentiels</span>
                        <small>Necessaires au fonctionnement du site</small>
                    </label>
                </div>
                <div class="cookie-option">
                    <label>
                        <input type="checkbox" id="cookieAnalytics">
                        <span>Cookies analytiques</span>
                        <small>Google Analytics - mesure d'audience</small>
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
            saveConsent({ essential: true, analytics: true });
            loadGoogleAnalytics();
            hideBanner();
        });

        document.getElementById('cookieRefuse').addEventListener('click', function() {
            saveConsent({ essential: true, analytics: false });
            hideBanner();
        });

        document.getElementById('cookieCustomize').addEventListener('click', function() {
            const panel = document.getElementById('cookieCustomizePanel');
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        });

        document.getElementById('cookieSavePrefs').addEventListener('click', function() {
            const analytics = document.getElementById('cookieAnalytics').checked;
            saveConsent({ essential: true, analytics: analytics });
            if (analytics) {
                loadGoogleAnalytics();
            }
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

        if (consent === null) {
            // No consent yet, show banner
            showBanner();
        } else if (consent.analytics) {
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
