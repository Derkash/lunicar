/**
 * LUNICAR - Thematic SEO Pages Script
 * Handles dynamic content loading for thematic landing pages
 */

(function() {
    'use strict';

    // Extract theme slug from URL
    function getThemeSlug() {
        const path = window.location.pathname;
        // Remove leading slash
        return path.substring(1);
    }

    // Format license plate input
    function formatPlaque(input) {
        let value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');

        if (value.length > 2) {
            value = value.slice(0, 2) + '-' + value.slice(2);
        }
        if (value.length > 6) {
            value = value.slice(0, 6) + '-' + value.slice(6);
        }
        if (value.length > 9) {
            value = value.slice(0, 9);
        }

        input.value = value;
    }

    // Get icon display based on icon name
    function getIconDisplay(icon) {
        const iconMap = {
            '24h': '24h',
            '48h': '48h',
            '2min': '2\'',
            '7j': '7j',
            'instant': '!',
            'fast': 'fast',
            'simple': '1-2-3',
            'secure': 'lock',
            'no-ct': 'CT',
            'no-service': 'wrench',
            'all': 'all',
            'broken': 'X',
            'truck': 'truck',
            'money': 'EUR',
            'crash': '!',
            'estimate': 'calc',
            'no-wheel': 'wheel',
            'engine': 'motor',
            'docs': 'doc',
            'help': '?',
            'case': 'file',
            'cash': 'EUR',
            'no-check': 'X',
            'trust': 'check',
            'full': '100%',
            'check': 'CHQ',
            'choice': 'opt',
            'wire': 'wire',
            'trace': 'trace',
            'all-brands': 'AB',
            'all-models': 'AM',
            'fair': 'fair',
            'old': '+10',
            'value': 'EUR',
            'km': 'km',
            'honest': 'fair',
            'no-judge': 'ok',
            'van': 'van',
            'pro': 'PRO',
            'suv': 'SUV',
            'demand': 'up',
            'price': 'EUR',
            'sedan': 'car',
            'comfort': 'star',
            'city': 'city',
            'popular': 'star',
            'family': 'fam',
            'space': '7+',
            'diesel': 'D',
            'all-ages': 'all',
            'gas': 'E',
            'eco': 'eco',
            'hybrid': 'HEV',
            'battery': 'bat',
            'electric': 'EV',
            'future': 'up',
            'gpl': 'GPL',
            'niche': 'N',
            'renault': 'R',
            'peugeot': 'P',
            'citroen': 'C',
            'vw': 'VW',
            'german': 'DE',
            'toyota': 'T',
            'reliable': 'rel',
            'ford': 'F',
            'american': 'US',
            'sporty': 'sport',
            'opel': 'O',
            'psa': 'PSA',
            'audi': 'A',
            'premium': 'star',
            'bmw': 'BMW',
            'sport': 'sport',
            'cote': 'up',
            'mercedes': 'MB',
            'luxury': 'lux',
            'nissan': 'N',
            'fiat': 'F',
            'style': 'style',
            'dacia': 'D',
            'hyundai': 'H',
            'warranty': '5y',
            'modern': 'new',
            'kia': 'K',
            'design': 'des',
            'no-visit': 'X',
            'no-nego': 'fix',
            'no-scam': 'safe',
            'legal': 'legal',
            'experience': 'exp',
            'loa': 'LOA',
            'option': 'opt',
            'advice': 'tip',
            'credit': 'cred',
            'solution': 'sol',
            'support': 'help',
            'patience': 'time',
            'discrete': 'priv',
            'flexible': 'flex',
            'worry-free': 'zen',
            'world': 'world',
            'admin': 'admin',
            'no-wait': 'now',
            'direct': 'dir',
            'more': '+20%',
            'no-buy': 'free',
            'compare': 'vs',
            'transparent': 'clear',
            'best': '#1',
            'save': 'save',
            'time': 'time',
            'easy': 'easy',
            'guarantee': 'ok',
            'papers': 'doc'
        };
        return iconMap[icon] || icon;
    }

    // Update page content with theme data
    function updatePageContent(theme) {
        if (!theme) return;

        const { slug, title, h1, subtitle, metaDescription, advantages, faq } = theme;

        // Update page title
        document.title = title + ' | LUNICAR';

        // Update meta description
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
            metaDesc.content = metaDescription;
        }

        // Update canonical URL
        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) {
            canonical.href = `https://lunicar.fr/${slug}`;
        }

        // Update Open Graph tags
        const ogUrl = document.querySelector('meta[property="og:url"]');
        if (ogUrl) ogUrl.content = `https://lunicar.fr/${slug}`;

        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) ogTitle.content = title;

        const ogDesc = document.querySelector('meta[property="og:description"]');
        if (ogDesc) ogDesc.content = metaDescription;

        // Update Twitter tags
        const twitterTitle = document.querySelector('meta[name="twitter:title"]');
        if (twitterTitle) twitterTitle.content = title;

        const twitterDesc = document.querySelector('meta[name="twitter:description"]');
        if (twitterDesc) twitterDesc.content = metaDescription;

        // Update Schema.org
        const schemaScript = document.getElementById('schemaService');
        if (schemaScript) {
            try {
                const schema = JSON.parse(schemaScript.textContent);
                schema.name = `LUNICAR - ${h1}`;
                schema.description = metaDescription;
                schemaScript.textContent = JSON.stringify(schema, null, 2);
            } catch (e) {
                console.error('Error updating schema:', e);
            }
        }

        // Update H1
        const h1El = document.getElementById('themeH1');
        if (h1El) h1El.textContent = h1;

        // Update subtitle
        const subtitleEl = document.getElementById('themeSubtitle');
        if (subtitleEl) subtitleEl.textContent = subtitle;

        // Update advantages
        const advantagesGrid = document.getElementById('advantagesGrid');
        if (advantagesGrid && advantages) {
            advantagesGrid.innerHTML = advantages.map(adv => `
                <div class="theme-advantage-card">
                    <div class="theme-advantage-icon">${getIconDisplay(adv.icon)}</div>
                    <h3>${adv.title}</h3>
                    <p>${adv.text}</p>
                </div>
            `).join('');
        }

        // Update FAQ
        const faqGrid = document.getElementById('faqGrid');
        if (faqGrid && faq) {
            faqGrid.innerHTML = faq.map(item => `
                <div class="theme-faq-item">
                    <h3>${item.question}</h3>
                    <p>${item.answer}</p>
                </div>
            `).join('');
        }

        // Update CTA
        const ctaTitle = document.getElementById('ctaTitle');
        if (ctaTitle) ctaTitle.textContent = h1.includes('Reprise') || h1.includes('Rachat')
            ? `${h1} - Estimation gratuite`
            : `Profitez de notre service maintenant`;

        const ctaText = document.getElementById('ctaText');
        if (ctaText) ctaText.textContent = subtitle;
    }

    // Show 404 page
    function show404() {
        document.body.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; text-align: center; padding: 20px;">
                <h1 style="font-size: 4rem; color: #0F172A; margin-bottom: 20px;">404</h1>
                <p style="font-size: 1.2rem; color: #666; margin-bottom: 30px;">Cette page n'existe pas.</p>
                <a href="/" style="background: #F59E0B; color: #0F172A; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Retour à l'accueil</a>
            </div>
        `;
    }

    // Load theme data from API
    async function loadThemeData() {
        const slug = getThemeSlug();

        if (!slug) {
            show404();
            return;
        }

        try {
            const response = await fetch(`/api/themes/${slug}`);

            if (!response.ok) {
                show404();
                return;
            }

            const theme = await response.json();

            if (!theme || !theme.h1) {
                show404();
                return;
            }

            updatePageContent(theme);

        } catch (error) {
            console.error('Error loading theme data:', error);
            show404();
        }
    }

    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', function() {
        loadThemeData();

        // Setup license plate input formatting
        const plaqueInput = document.getElementById('plaqueInput');
        if (plaqueInput) {
            plaqueInput.addEventListener('input', function() {
                formatPlaque(this);
            });

            const form = plaqueInput.closest('form');
            if (form) {
                form.addEventListener('submit', function(e) {
                    const plaque = plaqueInput.value.replace(/-/g, '');
                    if (plaque.length < 7) {
                        e.preventDefault();
                        plaqueInput.classList.add('invalid');
                        return;
                    }
                    plaqueInput.classList.remove('invalid');
                });
            }
        }
    });

})();
