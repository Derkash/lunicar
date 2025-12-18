/**
 * LUNICAR - City SEO Pages Script
 * Handles dynamic content loading for city-specific reprise pages
 */

(function() {
    'use strict';

    function getCitySlug() {
        const path = window.location.pathname;
        const match = path.match(/^\/reprise-auto-(.+)$/);
        return match ? match[1] : null;
    }

    function formatPlaque(input) {
        let value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (value.length > 2) value = value.slice(0, 2) + '-' + value.slice(2);
        if (value.length > 6) value = value.slice(0, 6) + '-' + value.slice(6);
        if (value.length > 9) value = value.slice(0, 9);
        input.value = value;
    }

    function updatePageContent(city) {
        if (!city) return;

        const { nom, slug, departement, region } = city;
        const baseUrl = 'https://lunicar.fr';

        // Update page title - optimized for SEO
        document.title = `Reprise auto ${nom} | Rachat voiture - LUNICAR`;

        // Update meta description
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
            metaDesc.content = `Vendez votre voiture a ${nom} (${departement}). Estimation gratuite en 2 min, paiement sous 24h, sans CT. LUNICAR rachete votre vehicule.`;
        }

        // Update canonical URL
        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) canonical.href = `${baseUrl}/reprise-auto-${slug}`;

        // Update Open Graph tags
        const ogUrl = document.querySelector('meta[property="og:url"]');
        if (ogUrl) ogUrl.content = `${baseUrl}/reprise-auto-${slug}`;

        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) ogTitle.content = `Reprise auto ${nom} | LUNICAR`;

        const ogDesc = document.querySelector('meta[property="og:description"]');
        if (ogDesc) ogDesc.content = `Rachat de voiture a ${nom}. Estimation gratuite, paiement sous 24h.`;

        // Update Twitter tags
        const twitterTitle = document.querySelector('meta[name="twitter:title"]');
        if (twitterTitle) twitterTitle.content = `Reprise auto ${nom} | LUNICAR`;

        const twitterDesc = document.querySelector('meta[name="twitter:description"]');
        if (twitterDesc) twitterDesc.content = `Rachat de voiture a ${nom}. Estimation gratuite.`;

        // Update Schema.org LocalBusiness
        const schemaScript = document.getElementById('schemaLocalBusiness');
        if (schemaScript) {
            const schema = {
                "@context": "https://schema.org",
                "@type": "LocalBusiness",
                "name": `LUNICAR ${nom}`,
                "description": `Service de reprise automobile a ${nom}. Rachat de voiture avec estimation gratuite et paiement sous 24h.`,
                "url": `${baseUrl}/reprise-auto-${slug}`,
                "email": "contact@lunicar.fr",
                "areaServed": {
                    "@type": "City",
                    "name": nom
                },
                "priceRange": "$$",
                "serviceType": "Reprise automobile"
            };
            schemaScript.textContent = JSON.stringify(schema, null, 2);
        }

        // Add FAQPage Schema
        const faqSchema = document.getElementById('schemaFAQ');
        if (faqSchema) {
            const schema = {
                "@context": "https://schema.org",
                "@type": "FAQPage",
                "mainEntity": [
                    {
                        "@type": "Question",
                        "name": `Comment vendre ma voiture a ${nom} ?`,
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": `Pour vendre votre voiture a ${nom}, remplissez notre formulaire en ligne avec les informations de votre vehicule. Vous recevez une offre de rachat sous 24h. Si vous acceptez, nous gerons tout : demarches administratives et paiement immediat par virement.`
                        }
                    },
                    {
                        "@type": "Question",
                        "name": `Faut-il un controle technique valide a ${nom} ?`,
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": `Non, le controle technique n'est pas obligatoire pour nous vendre votre voiture a ${nom}. Nous rachetons les vehicules avec ou sans CT valide, meme expire.`
                        }
                    },
                    {
                        "@type": "Question",
                        "name": `Quel est le delai de paiement a ${nom} ?`,
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": `Le paiement est effectue sous 24h par virement bancaire securise apres validation de la vente a ${nom}.`
                        }
                    }
                ]
            };
            faqSchema.textContent = JSON.stringify(schema, null, 2);
        }

        // Add BreadcrumbList Schema
        const breadcrumbSchema = document.getElementById('schemaBreadcrumb');
        if (breadcrumbSchema) {
            const schema = {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Accueil", "item": baseUrl + "/"},
                    {"@type": "ListItem", "position": 2, "name": "Reprise auto", "item": baseUrl + "/reprise"},
                    {"@type": "ListItem", "position": 3, "name": `Reprise auto ${nom}`, "item": `${baseUrl}/reprise-auto-${slug}`}
                ]
            };
            breadcrumbSchema.textContent = JSON.stringify(schema, null, 2);
        }

        // Update H1
        const h1 = document.getElementById('cityH1');
        if (h1) h1.textContent = `Reprise auto a ${nom} - Rachat de voiture immediat`;

        // Update introduction paragraph
        const introText = document.getElementById('introText');
        if (introText) {
            introText.innerHTML = `<p>Vous souhaitez <strong>vendre votre voiture a ${nom}</strong> ? LUNICAR vous propose un service de reprise automobile simple, rapide et transparent dans le ${departement}. Obtenez une estimation gratuite en 2 minutes, recevez une offre de rachat sous 24h et beneficiez d'un paiement immediat par virement securise.</p>
            <p>Notre service de <strong>rachat de vehicule a ${nom}</strong> est accessible a tous : pas besoin de controle technique valide, nous rachetons toutes les marques et tous les modeles, meme les vehicules en panne ou accidentes. Les demarches administratives sont 100% prises en charge par nos equipes.</p>`;
        }

        // Update subtitle
        const subtitle = document.getElementById('citySubtitle');
        if (subtitle) {
            subtitle.textContent = `Estimation gratuite en 2 min, paiement sous 24h, sans controle technique. Service disponible dans tout le ${departement}.`;
        }

        // Update section titles
        const whyTitle = document.getElementById('whyTitle');
        if (whyTitle) whyTitle.textContent = `Pourquoi vendre votre voiture a ${nom} avec LUNICAR ?`;

        const advantagesTitle = document.getElementById('advantagesTitle');
        if (advantagesTitle) advantagesTitle.textContent = `Notre service de reprise a ${nom}`;

        const expertiseText = document.getElementById('expertiseText');
        if (expertiseText) {
            expertiseText.textContent = `Nos experts connaissent le marche automobile de ${nom} et ${region} pour vous proposer le meilleur prix de rachat.`;
        }

        const faqTitle = document.getElementById('faqTitle');
        if (faqTitle) faqTitle.textContent = `Questions sur la reprise auto a ${nom}`;

        // Update FAQ content
        const faq1Title = document.getElementById('faq1Title');
        if (faq1Title) faq1Title.textContent = `Comment vendre ma voiture a ${nom} ?`;

        const faq1Text = document.getElementById('faq1Text');
        if (faq1Text) {
            faq1Text.textContent = `Pour vendre votre voiture a ${nom}, remplissez notre formulaire d'estimation en ligne (2 minutes). Nous vous envoyons une offre de rachat sous 24h. Si vous acceptez, nous nous occupons de tout : demarches administratives, recuperation du vehicule et paiement immediat par virement securise.`;
        }

        const faq2Title = document.getElementById('faq2Title');
        if (faq2Title) faq2Title.textContent = `Le controle technique est-il obligatoire a ${nom} ?`;

        const faq2Text = document.getElementById('faq2Text');
        if (faq2Text) {
            faq2Text.textContent = `Non, le controle technique n'est pas obligatoire pour nous vendre votre vehicule a ${nom}. Nous rachetons les voitures avec ou sans CT valide, meme si celui-ci est expire ou presente des defaillances.`;
        }

        const faq3Title = document.getElementById('faq3Title');
        if (faq3Title) faq3Title.textContent = `Quel est le delai de paiement a ${nom} ?`;

        const faq3Text = document.getElementById('faq3Text');
        if (faq3Text) {
            faq3Text.textContent = `Le paiement est effectue sous 24h maximum apres validation de la vente. Nous procedons exclusivement par virement bancaire securise sur votre compte.`;
        }

        const faq4Title = document.getElementById('faq4Title');
        if (faq4Title) faq4Title.textContent = `Quels vehicules rachetez-vous a ${nom} ?`;

        const faq4Text = document.getElementById('faq4Text');
        if (faq4Text) {
            faq4Text.textContent = `Nous rachetons tous types de vehicules a ${nom} : voitures essence, diesel, hybrides, electriques, utilitaires, SUV, berlines. Toutes marques acceptees : Renault, Peugeot, Citroen, Volkswagen, BMW, Mercedes, Toyota, etc.`;
        }

        // Update CTA section
        const ctaTitle = document.getElementById('ctaTitle');
        if (ctaTitle) ctaTitle.textContent = `Vendez votre voiture a ${nom}`;

        const ctaText = document.getElementById('ctaText');
        if (ctaText) {
            ctaText.textContent = `Estimation gratuite en 2 min. Paiement sous 24h. Sans controle technique obligatoire.`;
        }

        // Update nearby cities links
        updateNearbyCitiesLinks(city);
    }

    function updateNearbyCitiesLinks(city) {
        const linksContainer = document.getElementById('nearbyCitiesLinks');
        if (!linksContainer) return;

        // Get department from city
        const dept = city.departement;

        // Fetch cities from same department
        fetch('/api/villes')
            .then(res => res.json())
            .then(cities => {
                const nearbyCities = cities
                    .filter(c => c.departement === dept && c.slug !== city.slug)
                    .slice(0, 6);

                if (nearbyCities.length > 0) {
                    linksContainer.innerHTML = `
                        <h3>Reprise auto dans le ${dept}</h3>
                        <ul>
                            ${nearbyCities.map(c => `<li><a href="/reprise-auto-${c.slug}">Reprise auto ${c.nom}</a></li>`).join('')}
                        </ul>
                    `;
                }
            })
            .catch(() => {});
    }

    function show404() {
        document.body.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; text-align: center; padding: 20px;">
                <h1 style="font-size: 4rem; color: #0F172A; margin-bottom: 20px;">404</h1>
                <p style="font-size: 1.2rem; color: #666; margin-bottom: 30px;">Cette page n'existe pas.</p>
                <a href="/" style="background: #F59E0B; color: #0F172A; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Retour a l'accueil</a>
            </div>
        `;
    }

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

    document.addEventListener('DOMContentLoaded', function() {
        loadCityData();

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
