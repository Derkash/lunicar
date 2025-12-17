/**
 * LUNICAR - City SEO Pages Script
 * Handles dynamic content loading for city-specific reprise pages
 */

(function() {
    'use strict';

    // Extract city slug from URL
    function getCitySlug() {
        const path = window.location.pathname;
        const match = path.match(/^\/reprise-auto-(.+)$/);
        return match ? match[1] : null;
    }

    // Format license plate input
    function formatPlaque(input) {
        let value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');

        // Format nouveau (AA-123-AA)
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

    // Update page content with city data
    function updatePageContent(city) {
        if (!city) return;

        const { nom, codePostal, departement, region } = city;

        // Update page title
        document.title = `Reprise Auto ${nom} | LUNICAR - Estimation Gratuite`;

        // Update meta description
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
            metaDesc.content = `Vendez votre voiture à ${nom}. Estimation gratuite en 2 min, paiement immédiat. LUNICAR, le spécialiste de la reprise auto en ${departement}.`;
        }

        // Update canonical URL
        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) {
            canonical.href = `https://lunicar.fr/reprise-auto-${city.slug}`;
        }

        // Update Open Graph tags
        const ogUrl = document.querySelector('meta[property="og:url"]');
        if (ogUrl) ogUrl.content = `https://lunicar.fr/reprise-auto-${city.slug}`;

        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) ogTitle.content = `Reprise Auto ${nom} | LUNICAR`;

        const ogDesc = document.querySelector('meta[property="og:description"]');
        if (ogDesc) ogDesc.content = `Vendez votre voiture à ${nom}. Estimation gratuite, paiement sous 24h.`;

        // Update Twitter tags
        const twitterTitle = document.querySelector('meta[name="twitter:title"]');
        if (twitterTitle) twitterTitle.content = `Reprise Auto ${nom} | LUNICAR`;

        const twitterDesc = document.querySelector('meta[name="twitter:description"]');
        if (twitterDesc) twitterDesc.content = `Vendez votre voiture à ${nom}. Estimation gratuite, paiement sous 24h.`;

        // Update Schema.org LocalBusiness
        const schemaScript = document.getElementById('schemaLocalBusiness');
        if (schemaScript) {
            try {
                const schema = JSON.parse(schemaScript.textContent);
                schema.areaServed.name = nom;
                schema.description = `Reprise automobile professionnelle à ${nom}`;
                schemaScript.textContent = JSON.stringify(schema, null, 2);
            } catch (e) {
                console.error('Error updating schema:', e);
            }
        }

        // Update H1
        const h1 = document.getElementById('cityH1');
        if (h1) h1.textContent = `Reprise automobile à ${nom}`;

        // Update subtitle
        const subtitle = document.getElementById('citySubtitle');
        if (subtitle) {
            subtitle.textContent = `Vendez votre voiture à ${nom} rapidement. Estimation gratuite en 2 minutes, paiement immédiat.`;
        }

        // Update section titles
        const whyTitle = document.getElementById('whyTitle');
        if (whyTitle) whyTitle.textContent = `Pourquoi vendre votre voiture à ${nom} avec LUNICAR ?`;

        const advantagesTitle = document.getElementById('advantagesTitle');
        if (advantagesTitle) advantagesTitle.textContent = `Les avantages LUNICAR à ${nom}`;

        const expertiseText = document.getElementById('expertiseText');
        if (expertiseText) {
            expertiseText.textContent = `Nos experts connaissent parfaitement le marché automobile de ${nom} et de ${region} pour vous proposer le meilleur prix.`;
        }

        const faqTitle = document.getElementById('faqTitle');
        if (faqTitle) faqTitle.textContent = `Questions fréquentes sur la reprise auto à ${nom}`;

        // Update FAQ content
        const faq1Title = document.getElementById('faq1Title');
        if (faq1Title) faq1Title.textContent = `Comment fonctionne la reprise de voiture à ${nom} ?`;

        const faq1Text = document.getElementById('faq1Text');
        if (faq1Text) {
            faq1Text.textContent = `C'est simple : vous remplissez notre formulaire en ligne avec les informations de votre véhicule, nous vous envoyons une offre de rachat sous 24h. Si vous acceptez, nous nous occupons de tout à ${nom} : démarches administratives, récupération du véhicule et paiement immédiat.`;
        }

        const faq2Title = document.getElementById('faq2Title');
        if (faq2Title) faq2Title.textContent = `Quels véhicules reprenez-vous à ${nom} ?`;

        const faq3Title = document.getElementById('faq3Title');
        if (faq3Title) faq3Title.textContent = `Combien de temps prend la vente à ${nom} ?`;

        // Update CTA section
        const ctaTitle = document.getElementById('ctaTitle');
        if (ctaTitle) ctaTitle.textContent = `Vendez votre voiture à ${nom} maintenant`;

        const ctaText = document.getElementById('ctaText');
        if (ctaText) {
            ctaText.textContent = `Estimation gratuite en 2 minutes à ${nom}. Paiement sous 24h. Service professionnel et sécurisé en ${region}.`;
        }
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

    // Load city data from API
    async function loadCityData() {
        const slug = getCitySlug();

        if (!slug) {
            show404();
            return;
        }

        try {
            const response = await fetch(`/api/villes/${slug}`);

            if (!response.ok) {
                show404();
                return;
            }

            const city = await response.json();

            if (!city || !city.nom) {
                show404();
                return;
            }

            updatePageContent(city);

        } catch (error) {
            console.error('Error loading city data:', error);
            show404();
        }
    }

    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', function() {
        loadCityData();

        // Setup license plate input formatting
        const plaqueInput = document.getElementById('plaqueInput');
        if (plaqueInput) {
            plaqueInput.addEventListener('input', function() {
                formatPlaque(this);
            });

            // Handle form submission
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
