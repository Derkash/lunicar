/**
 * LUNICAR - City SEO Pages Script
 * Mega SEO optimization with 2000+ words dynamic content
 */

(function() {
    'use strict';

    const BASE_URL = 'https://lunicar.fr';

    // Villes avec ZFE (Zone a Faibles Emissions)
    const ZFE_CITIES = ['paris', 'lyon', 'marseille', 'toulouse', 'nice', 'montpellier', 'strasbourg', 'grenoble', 'rouen', 'reims', 'saint-etienne', 'toulon', 'aix-en-provence'];

    // Villes proches par region
    const NEARBY_CITIES_MAP = {
        'paris': ['villepinte', 'saint-denis', 'montreuil', 'bobigny', 'creteil', 'nanterre', 'boulogne-billancourt', 'argenteuil', 'versailles', 'vitry-sur-seine'],
        'lyon': ['villeurbanne', 'venissieux', 'vaulx-en-velin', 'bron', 'saint-priest', 'caluire-et-cuire', 'oullins', 'meyzieu'],
        'marseille': ['aix-en-provence', 'aubagne', 'martigues', 'istres', 'vitrolles', 'salon-de-provence', 'la-ciotat', 'marignane'],
        'toulouse': ['blagnac', 'colomiers', 'tournefeuille', 'muret', 'balma', 'ramonville-saint-agne', 'cugnaux'],
        'nice': ['cannes', 'antibes', 'grasse', 'cagnes-sur-mer', 'menton', 'saint-laurent-du-var', 'vallauris'],
        'nantes': ['saint-herblain', 'reze', 'saint-nazaire', 'orvault', 'vertou', 'carquefou', 'la-chapelle-sur-erdre'],
        'bordeaux': ['merignac', 'pessac', 'talence', 'villenave-d-ornon', 'begles', 'gradignan', 'le-bouscat'],
        'lille': ['roubaix', 'tourcoing', 'villeneuve-d-ascq', 'wattrelos', 'marcq-en-baroeul', 'lambersart', 'croix'],
        'strasbourg': ['schiltigheim', 'illkirch-graffenstaden', 'lingolsheim', 'bischheim', 'hoenheim', 'ostwald'],
        'villepinte': ['paris', 'saint-denis', 'aulnay-sous-bois', 'sevran', 'tremblay-en-france', 'le-blanc-mesnil', 'drancy']
    };

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

    function hasZFE(citySlug) {
        return ZFE_CITIES.includes(citySlug.toLowerCase());
    }

    function generateFAQ(city) {
        const { nom, departement, region } = city;
        return [
            {
                question: `Comment faire reprendre ma voiture à ${nom} ?`,
                answer: `Pour faire reprendre votre voiture à ${nom}, c'est simple et rapide avec LUNICAR. Commencez par remplir notre formulaire d'estimation en ligne en renseignant votre plaque d'immatriculation et quelques informations sur votre véhicule. En 2 minutes, vous obtenez une première estimation. Un conseiller LUNICAR vous recontacte ensuite sous 24h pour affiner l'offre et répondre à vos questions. Si vous acceptez, nous gérons toutes les démarches administratives et le paiement est effectué sous 24h par virement sécurisé.`
            },
            {
                question: `Quel est le prix de reprise de ma voiture à ${nom} ?`,
                answer: `Le prix de reprise de votre voiture à ${nom} dépend de plusieurs critères : la marque, le modèle, l'année de mise en circulation, le kilométrage, l'état général du véhicule et ses équipements. Notre algorithme analyse le marché automobile local pour vous proposer le meilleur prix. L'estimation est gratuite et sans engagement. Vous pouvez obtenir une première estimation en 2 minutes sur notre site.`
            },
            {
                question: `Faut-il un contrôle technique pour vendre sa voiture à ${nom} ?`,
                answer: `Non, le contrôle technique n'est pas obligatoire pour vendre votre voiture à LUNICAR à ${nom}. Contrairement à une vente entre particuliers où le CT de moins de 6 mois est requis, nous rachetons votre véhicule avec ou sans contrôle technique valide. Que votre CT soit expiré, présente des défaillances majeures ou même s'il n'a jamais été réalisé, nous reprenons votre véhicule. C'est un gain de temps et d'argent considérable pour vous.`
            },
            {
                question: `Comment se passe le paiement lors d'une reprise à ${nom} ?`,
                answer: `Le paiement de votre véhicule à ${nom} est effectué sous 24 heures après validation de la vente. Nous procédons exclusivement par virement bancaire sécurisé directement sur votre compte. Pas de chèque, pas d'espèces, donc aucun risque d'arnaque. Le montant correspond exactement à l'offre acceptée, sans frais cachés ni déduction de dernière minute. C'est simple, rapide et totalement sécurisé.`
            },
            {
                question: `LUNICAR reprend-il les voitures en panne à ${nom} ?`,
                answer: `Oui, LUNICAR reprend les voitures en panne à ${nom} et ses environs. Que votre véhicule ait un problème moteur, une panne électrique, un embrayage défaillant ou tout autre problème mécanique, nous l'achetons. Nous reprenons également les véhicules accidentés, avec moteur HS ou hors d'usage. L'état de votre voiture est pris en compte dans l'estimation, mais cela ne vous empêche pas de la vendre rapidement.`
            },
            {
                question: `Quels sont les délais de reprise à ${nom} ?`,
                answer: `Les délais de reprise à ${nom} sont très courts avec LUNICAR. Après avoir rempli le formulaire d'estimation (2 minutes), vous recevez une offre sous 24h. Si vous acceptez, nous organisons la récupération de votre véhicule dans les jours qui suivent, selon vos disponibilités. Le paiement est effectué sous 24h après validation. Au total, vous pouvez vendre votre voiture en moins d'une semaine, parfois en 48h seulement.`
            },
            {
                question: `Reprenez-vous les voitures accidentées à ${nom} ?`,
                answer: `Absolument, nous reprenons les voitures accidentées à ${nom}. Que votre véhicule ait subi un accident de la route, un sinistre, une inondation ou tout autre dommage, LUNICAR peut vous faire une offre de rachat. L'état du véhicule est évalué lors de l'estimation et le prix proposé tient compte des réparations nécessaires. C'est une solution idéale pour vous débarrasser d'un véhicule accidenté sans avoir à chercher un acheteur.`
            },
            {
                question: `Les démarches administratives sont-elles prises en charge à ${nom} ?`,
                answer: `Oui, toutes les démarches administratives sont 100% prises en charge par LUNICAR à ${nom}. Nous nous occupons du certificat de cession, de la déclaration de vente sur le site de l'ANTS, du changement de carte grise et de toutes les formalités nécessaires. Vous n'avez qu'à nous fournir les documents de base (carte grise, pièce d'identité, RIB) et nous gérons tout le reste. C'est un gain de temps considérable.`
            },
            {
                question: `Puis-je faire reprendre ma voiture sans acheter de nouveau véhicule à ${nom} ?`,
                answer: `Bien sûr ! Contrairement aux concessions automobiles qui conditionnent souvent la reprise à l'achat d'un nouveau véhicule, LUNICAR rachète votre voiture à ${nom} sans aucune obligation d'achat. Vous vendez simplement votre véhicule et recevez votre argent. Aucune contrepartie, aucune condition. C'est un service de reprise pure, adapté à tous ceux qui veulent vendre sans racheter.`
            },
            {
                question: `Comment obtenir une estimation gratuite à ${nom} ?`,
                answer: `Pour obtenir une estimation gratuite de votre véhicule à ${nom}, rendez-vous sur notre formulaire en ligne. Entrez votre plaque d'immatriculation et répondez à quelques questions simples sur l'état de votre voiture (kilométrage, état général, options). En 2 minutes, vous obtenez une première estimation. Un conseiller LUNICAR vous recontacte ensuite pour affiner l'offre. L'estimation est totalement gratuite et sans aucun engagement de votre part.`
            }
        ];
    }

    function generateIntroText(city) {
        const { nom, departement, region } = city;
        const hasZfe = hasZFE(city.slug);

        let intro = `<p>Vous souhaitez <strong>vendre votre voiture à ${nom}</strong> ? LUNICAR est votre partenaire de confiance pour la <strong>reprise automobile à ${nom}</strong> et dans toute la région ${region}. Notre service de rachat de véhicules vous permet d'obtenir une estimation gratuite en seulement 2 minutes, de bénéficier d'une offre de prix garantie pendant 7 jours et de recevoir votre paiement sous 24 heures par virement bancaire sécurisé.</p>`;

        intro += `<p>Spécialiste du <strong>rachat de voiture à ${nom}</strong>, LUNICAR simplifie toutes les étapes de la vente de votre véhicule. Pas besoin de contrôle technique valide, nous rachetons votre voiture même avec un CT expiré ou présentant des défaillances. Toutes les marques sont acceptées : Renault, Peugeot, Citroën, Volkswagen, BMW, Mercedes, Audi, Toyota, et bien d'autres. Que votre véhicule soit en parfait état, en panne ou même accidenté, nous avons une solution pour vous.</p>`;

        if (hasZfe) {
            intro += `<p>La ville de ${nom} fait partie des villes concernées par la <strong>Zone à Faibles Émissions (ZFE)</strong>. Si votre véhicule ne répond plus aux critères Crit'Air nécessaires pour circuler, LUNICAR vous offre une solution rapide pour le vendre et financer l'achat d'un véhicule conforme. Ne laissez pas votre voiture perdre de la valeur, agissez maintenant.</p>`;
        }

        intro += `<p>Les démarches administratives vous semblent compliquées ? Avec LUNICAR, c'est de l'histoire ancienne. Nous prenons en charge 100% des formalités : certificat de cession, déclaration de vente, changement de carte grise. Vous n'avez qu'à nous fournir les documents de base et nous nous occupons du reste. <strong>Vendre sa voiture à ${nom}</strong> n'a jamais été aussi simple et rapide.</p>`;

        return intro;
    }

    function generateLocalInfo(city) {
        const { nom, departement, region, codePostal } = city;
        const hasZfe = hasZFE(city.slug);

        let html = '<div class="local-info-grid">';

        html += `
            <div class="local-info-card">
                <h4>Localisation</h4>
                <p><strong>${nom}</strong> est située dans le département <strong>${departement}</strong>, en région <strong>${region}</strong>${codePostal ? ` (code postal : ${codePostal})` : ''}. Notre service de reprise automobile couvre l'ensemble de la ville et ses environs. Que vous habitiez en centre-ville ou en périphérie, nous pouvons organiser la récupération de votre véhicule à l'adresse de votre choix.</p>
            </div>
            <div class="local-info-card">
                <h4>Zones desservies</h4>
                <p>LUNICAR intervient dans toutes les communes autour de ${nom}. Notre réseau couvre également les villes limitrophes et l'ensemble de la région ${region}. Vous bénéficiez du même service de qualité, des mêmes garanties et des mêmes délais de paiement, où que vous soyez situé.</p>
            </div>
        `;

        html += '</div>';

        if (hasZfe) {
            html += `
                <div class="zfe-warning">
                    <h4>Zone à Faibles Émissions (ZFE) à ${nom}</h4>
                    <p>${nom} fait partie des villes concernées par la ZFE. Les véhicules les plus polluants (Crit'Air 4, 5 et non classés) ne peuvent plus circuler dans certaines zones. Si votre voiture est concernée, c'est le moment idéal pour la vendre avant qu'elle ne perde davantage de valeur. LUNICAR rachète tous les véhicules, y compris ceux qui ne sont plus autorisés à circuler dans la ZFE.</p>
                </div>
            `;
        }

        return html;
    }

    function updatePageContent(city) {
        if (!city) return;

        const { nom, slug, departement, region } = city;

        // Update page title - SEO optimized
        document.title = `Reprise Voiture ${nom} (${departement}) | Rachat Auto Paiement 24h | LUNICAR`;

        // Update meta description
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
            metaDesc.content = `Vendez votre voiture à ${nom} (${departement}) avec LUNICAR. Estimation gratuite, reprise immédiate sans CT, paiement sécurisé sous 24h. Toutes marques acceptées.`;
        }

        // Update canonical URL
        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) canonical.href = `${BASE_URL}/reprise-auto-${slug}`;

        // Update Open Graph tags
        const ogUrl = document.querySelector('meta[property="og:url"]');
        if (ogUrl) ogUrl.content = `${BASE_URL}/reprise-auto-${slug}`;

        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) ogTitle.content = `Reprise Voiture ${nom} | Rachat Auto | LUNICAR`;

        const ogDesc = document.querySelector('meta[property="og:description"]');
        if (ogDesc) ogDesc.content = `Rachat de voiture à ${nom}. Estimation gratuite, paiement sous 24h, sans CT.`;

        // Update Twitter tags
        const twitterTitle = document.querySelector('meta[name="twitter:title"]');
        if (twitterTitle) twitterTitle.content = `Reprise Voiture ${nom} | LUNICAR`;

        const twitterDesc = document.querySelector('meta[name="twitter:description"]');
        if (twitterDesc) twitterDesc.content = `Rachat de voiture à ${nom}. Estimation gratuite.`;

        // Update Schema.org LocalBusiness
        const schemaScript = document.getElementById('schemaLocalBusiness');
        if (schemaScript) {
            const schema = {
                "@context": "https://schema.org",
                "@type": "LocalBusiness",
                "name": `LUNICAR - Reprise Auto ${nom}`,
                "description": `Service de reprise automobile à ${nom}. Rachat de voiture avec estimation gratuite et paiement sous 24h. Sans contrôle technique obligatoire.`,
                "url": `${BASE_URL}/reprise-auto-${slug}`,
                "email": "contact@lunicar.fr",
                "areaServed": {"@type": "City", "name": nom},
                "priceRange": "$$",
                "serviceType": ["Reprise automobile", "Rachat de vehicule", "Estimation gratuite"]
            };
            schemaScript.textContent = JSON.stringify(schema);
        }

        // Update Schema.org FAQPage
        const faqSchema = document.getElementById('schemaFAQ');
        if (faqSchema) {
            const faqs = generateFAQ(city);
            const schema = {
                "@context": "https://schema.org",
                "@type": "FAQPage",
                "mainEntity": faqs.map(faq => ({
                    "@type": "Question",
                    "name": faq.question,
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": faq.answer
                    }
                }))
            };
            faqSchema.textContent = JSON.stringify(schema);
        }

        // Update Schema.org BreadcrumbList
        const breadcrumbSchema = document.getElementById('schemaBreadcrumb');
        if (breadcrumbSchema) {
            const schema = {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Accueil", "item": BASE_URL + "/"},
                    {"@type": "ListItem", "position": 2, "name": "Reprise auto", "item": BASE_URL + "/reprise"},
                    {"@type": "ListItem", "position": 3, "name": `Reprise auto ${nom}`, "item": `${BASE_URL}/reprise-auto-${slug}`}
                ]
            };
            breadcrumbSchema.textContent = JSON.stringify(schema);
        }

        // Update Schema.org Service
        const serviceSchema = document.getElementById('schemaService');
        if (serviceSchema) {
            const schema = {
                "@context": "https://schema.org",
                "@type": "Service",
                "serviceType": "Reprise automobile",
                "provider": {"@type": "Organization", "name": "LUNICAR", "url": BASE_URL},
                "areaServed": {"@type": "City", "name": nom},
                "description": `Service de reprise et rachat automobile à ${nom}. Estimation gratuite, paiement sous 24h.`
            };
            serviceSchema.textContent = JSON.stringify(schema);
        }

        // Update breadcrumb
        const breadcrumbCity = document.getElementById('breadcrumbCity');
        if (breadcrumbCity) breadcrumbCity.textContent = nom;

        // Update H1
        const h1 = document.getElementById('cityH1');
        if (h1) h1.textContent = `Reprise Voiture à ${nom} - Rachat Auto Paiement 24h`;

        // Update subtitle
        const subtitle = document.getElementById('citySubtitle');
        if (subtitle) {
            subtitle.textContent = `Vendez votre voiture à ${nom} rapidement. Estimation gratuite en 2 minutes, paiement sous 24h, sans contrôle technique. Service disponible à ${nom} et ses environs.`;
        }

        // Update introduction
        const introText = document.getElementById('introText');
        if (introText) {
            introText.innerHTML = generateIntroText(city);
        }

        // Update section titles
        const howItWorksTitle = document.getElementById('howItWorksTitle');
        if (howItWorksTitle) howItWorksTitle.textContent = `Comment ca marche a ${nom}`;

        const whyTitle = document.getElementById('whyTitle');
        if (whyTitle) whyTitle.textContent = `Pourquoi choisir LUNICAR a ${nom} ?`;

        const vehiclesTitle = document.getElementById('vehiclesTitle');
        if (vehiclesTitle) vehiclesTitle.textContent = `Quels vehicules reprenons-nous a ${nom} ?`;

        const vehiclesIntro = document.getElementById('vehiclesIntro');
        if (vehiclesIntro) {
            vehiclesIntro.textContent = `LUNICAR rachete une large gamme de vehicules a ${nom} et dans le ${departement}, quel que soit leur etat ou leur age. Notre objectif est de vous proposer une solution simple et rapide pour vendre votre voiture, sans les contraintes habituelles des ventes entre particuliers ou en concession.`;
        }

        const estimationTitle = document.getElementById('estimationTitle');
        if (estimationTitle) estimationTitle.textContent = `Estimation gratuite de votre vehicule a ${nom}`;

        const estimationText = document.getElementById('estimationText');
        if (estimationText) {
            estimationText.textContent = `Pour vous proposer le meilleur prix de rachat a ${nom}, notre algorithme analyse plusieurs criteres essentiels de votre vehicule. Cette estimation est basee sur les donnees du marche automobile actuel dans le ${departement} et tient compte de la cote Argus et des transactions recentes dans votre region.`;
        }

        const localInfoTitle = document.getElementById('localInfoTitle');
        if (localInfoTitle) localInfoTitle.textContent = `Informations pratiques a ${nom}`;

        const localInfoContent = document.getElementById('localInfoContent');
        if (localInfoContent) {
            localInfoContent.innerHTML = generateLocalInfo(city);
        }

        const faqTitle = document.getElementById('faqTitle');
        if (faqTitle) faqTitle.textContent = `Questions frequentes sur la reprise auto a ${nom}`;

        // Generate FAQ accordion
        const faqAccordion = document.getElementById('faqAccordion');
        if (faqAccordion) {
            const faqs = generateFAQ(city);
            faqAccordion.innerHTML = faqs.map((faq, index) => `
                <div class="faq-item" data-index="${index}">
                    <div class="faq-question">${faq.question}</div>
                    <div class="faq-answer"><p>${faq.answer}</p></div>
                </div>
            `).join('');

            // Add click handlers
            faqAccordion.querySelectorAll('.faq-question').forEach(question => {
                question.addEventListener('click', function() {
                    const item = this.parentElement;
                    const wasOpen = item.classList.contains('open');

                    // Close all
                    faqAccordion.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));

                    // Open clicked if it wasn't open
                    if (!wasOpen) item.classList.add('open');
                });
            });
        }

        const brandsTitle = document.getElementById('brandsTitle');
        if (brandsTitle) brandsTitle.textContent = `Marques de voitures reprises a ${nom}`;

        const nearbyCitiesTitle = document.getElementById('nearbyCitiesTitle');
        if (nearbyCitiesTitle) nearbyCitiesTitle.textContent = `Reprise auto dans les villes proches de ${nom}`;

        const ctaTitle = document.getElementById('ctaTitle');
        if (ctaTitle) ctaTitle.textContent = `Vendez votre voiture a ${nom} maintenant`;

        const ctaText = document.getElementById('ctaText');
        if (ctaText) {
            ctaText.textContent = `Estimation gratuite en 2 minutes. Prix garanti 7 jours. Paiement sous 24h par virement securise. Sans controle technique obligatoire. Service disponible dans tout le ${departement}.`;
        }

        // Update nearby cities
        updateNearbyCitiesLinks(city);
    }

    function updateNearbyCitiesLinks(city) {
        const linksContainer = document.getElementById('nearbyCitiesLinks');
        if (!linksContainer) return;

        const { slug, departement } = city;

        // Check if we have predefined nearby cities
        const predefinedNearby = NEARBY_CITIES_MAP[slug];

        if (predefinedNearby && predefinedNearby.length > 0) {
            // Use predefined nearby cities
            linksContainer.innerHTML = `
                <div class="nearby-cities-grid">
                    ${predefinedNearby.map(citySlug => {
                        const cityName = citySlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                        return `<a href="/reprise-auto-${citySlug}" class="nearby-city-link">Reprise auto ${cityName}</a>`;
                    }).join('')}
                </div>
            `;
        } else {
            // Fetch cities from same department via API
            fetch('/api/villes')
                .then(res => res.json())
                .then(cities => {
                    const nearbyCities = cities
                        .filter(c => c.departement === departement && c.slug !== slug)
                        .slice(0, 8);

                    if (nearbyCities.length > 0) {
                        linksContainer.innerHTML = `
                            <div class="nearby-cities-grid">
                                ${nearbyCities.map(c => `<a href="/reprise-auto-${c.slug}" class="nearby-city-link">Reprise auto ${c.nom}</a>`).join('')}
                            </div>
                        `;
                    }
                })
                .catch(() => {});
        }
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

            // Add slug to city object
            city.slug = slug;

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
