/**
 * LUNICAR - Generateurs de contenu SEO (rendu cote serveur)
 *
 * Ces fonctions produisent le contenu unique par ville / par theme qui etait
 * auparavant genere uniquement cote client (public/js/city-reprise.js et
 * public/js/theme-reprise.js). Le rendre cote serveur le rend visible aux
 * crawlers (Google, Bing) et aux moteurs IA qui n'executent pas le JS.
 *
 * Le texte est volontairement identique a celui des scripts client pour
 * eviter toute divergence entre le HTML initial et le rendu hydrate.
 */

// Villes avec ZFE (Zone a Faibles Emissions)
const ZFE_CITIES = ['paris', 'lyon', 'marseille', 'toulouse', 'nice', 'montpellier', 'strasbourg', 'grenoble', 'rouen', 'reims', 'saint-etienne', 'toulon', 'aix-en-provence'];

// Villes proches predefinies (pour les grandes agglomerations)
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

function hasZFE(citySlug) {
    return ZFE_CITIES.includes(String(citySlug || '').toLowerCase());
}

// Echappement minimal pour le contenu textuel injecte dans le HTML
function esc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function generateFAQ(city) {
    const { nom } = city;
    return [
        { question: `Comment faire reprendre ma voiture à ${nom} ?`, answer: `Pour faire reprendre votre voiture à ${nom}, c'est simple et rapide avec LUNICAR. Commencez par remplir notre formulaire d'estimation en ligne en renseignant votre plaque d'immatriculation et quelques informations sur votre véhicule. En 2 minutes, vous obtenez une première estimation. Un conseiller LUNICAR vous recontacte ensuite sous 24h pour affiner l'offre et répondre à vos questions. Si vous acceptez, nous gérons toutes les démarches administratives et le paiement est effectué sous 24h par virement sécurisé.` },
        { question: `Quel est le prix de reprise de ma voiture à ${nom} ?`, answer: `Le prix de reprise de votre voiture à ${nom} dépend de plusieurs critères : la marque, le modèle, l'année de mise en circulation, le kilométrage, l'état général du véhicule et ses équipements. Notre algorithme analyse le marché automobile local pour vous proposer le meilleur prix. L'estimation est gratuite et sans engagement. Vous pouvez obtenir une première estimation en 2 minutes sur notre site.` },
        { question: `Faut-il un contrôle technique pour vendre sa voiture à ${nom} ?`, answer: `Non, le contrôle technique n'est pas obligatoire pour vendre votre voiture à LUNICAR à ${nom}. Contrairement à une vente entre particuliers où le CT de moins de 6 mois est requis, nous rachetons votre véhicule avec ou sans contrôle technique valide. Que votre CT soit expiré, présente des défaillances majeures ou même s'il n'a jamais été réalisé, nous reprenons votre véhicule. C'est un gain de temps et d'argent considérable pour vous.` },
        { question: `Comment se passe le paiement lors d'une reprise à ${nom} ?`, answer: `Le paiement de votre véhicule à ${nom} est effectué sous 24 heures après validation de la vente. Nous procédons exclusivement par virement bancaire sécurisé directement sur votre compte. Pas de chèque, pas d'espèces, donc aucun risque d'arnaque. Le montant correspond exactement à l'offre acceptée, sans frais cachés ni déduction de dernière minute. C'est simple, rapide et totalement sécurisé.` },
        { question: `LUNICAR reprend-il les voitures en panne à ${nom} ?`, answer: `Oui, LUNICAR reprend les voitures en panne à ${nom} et ses environs. Que votre véhicule ait un problème moteur, une panne électrique, un embrayage défaillant ou tout autre problème mécanique, nous l'achetons. Nous reprenons également les véhicules accidentés, avec moteur HS ou hors d'usage. L'état de votre voiture est pris en compte dans l'estimation, mais cela ne vous empêche pas de la vendre rapidement.` },
        { question: `Quels sont les délais de reprise à ${nom} ?`, answer: `Les délais de reprise à ${nom} sont très courts avec LUNICAR. Après avoir rempli le formulaire d'estimation (2 minutes), vous recevez une offre sous 24h. Si vous acceptez, nous organisons la récupération de votre véhicule dans les jours qui suivent, selon vos disponibilités. Le paiement est effectué sous 24h après validation. Au total, vous pouvez vendre votre voiture en moins d'une semaine, parfois en 48h seulement.` },
        { question: `Reprenez-vous les voitures accidentées à ${nom} ?`, answer: `Absolument, nous reprenons les voitures accidentées à ${nom}. Que votre véhicule ait subi un accident de la route, un sinistre, une inondation ou tout autre dommage, LUNICAR peut vous faire une offre de rachat. L'état du véhicule est évalué lors de l'estimation et le prix proposé tient compte des réparations nécessaires. C'est une solution idéale pour vous débarrasser d'un véhicule accidenté sans avoir à chercher un acheteur.` },
        { question: `Les démarches administratives sont-elles prises en charge à ${nom} ?`, answer: `Oui, toutes les démarches administratives sont 100% prises en charge par LUNICAR à ${nom}. Nous nous occupons du certificat de cession, de la déclaration de vente sur le site de l'ANTS, du changement de carte grise et de toutes les formalités nécessaires. Vous n'avez qu'à nous fournir les documents de base (carte grise, pièce d'identité, RIB) et nous gérons tout le reste. C'est un gain de temps considérable.` },
        { question: `Puis-je faire reprendre ma voiture sans acheter de nouveau véhicule à ${nom} ?`, answer: `Bien sûr ! Contrairement aux concessions automobiles qui conditionnent souvent la reprise à l'achat d'un nouveau véhicule, LUNICAR rachète votre voiture à ${nom} sans aucune obligation d'achat. Vous vendez simplement votre véhicule et recevez votre argent. Aucune contrepartie, aucune condition. C'est un service de reprise pure, adapté à tous ceux qui veulent vendre sans racheter.` },
        { question: `Comment obtenir une estimation gratuite à ${nom} ?`, answer: `Pour obtenir une estimation gratuite de votre véhicule à ${nom}, rendez-vous sur notre formulaire en ligne. Entrez votre plaque d'immatriculation et répondez à quelques questions simples sur l'état de votre voiture (kilométrage, état général, options). En 2 minutes, vous obtenez une première estimation. Un conseiller LUNICAR vous recontacte ensuite pour affiner l'offre. L'estimation est totalement gratuite et sans aucun engagement de votre part.` }
    ];
}

function generateIntroText(city) {
    const { nom, region } = city;
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

function capitalizeSlug(citySlug) {
    return citySlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Genere le bloc "villes proches" cote serveur.
// allCities : tableau complet des villes (data/cities.json) pour le fallback departemental.
function generateNearbyCities(city, allCities) {
    const { slug, departement } = city;
    const predefined = NEARBY_CITIES_MAP[slug];
    let items = [];

    if (predefined && predefined.length > 0) {
        items = predefined.map(citySlug => ({ slug: citySlug, nom: capitalizeSlug(citySlug) }));
    } else {
        items = (allCities || [])
            .filter(c => c.departement === departement && c.slug !== slug)
            .slice(0, 8)
            .map(c => ({ slug: c.slug, nom: c.nom }));
    }

    if (items.length === 0) return '';
    return `<div class="nearby-cities-grid">${items
        .map(c => `<a href="/reprise-auto-${c.slug}" class="nearby-city-link">Reprise auto ${esc(c.nom)}</a>`)
        .join('')}</div>`;
}

function renderCityFAQAccordion(faqs) {
    return faqs.map((faq, index) => `
                <div class="faq-item" data-index="${index}">
                    <div class="faq-question">${faq.question}</div>
                    <div class="faq-answer"><p>${faq.answer}</p></div>
                </div>`).join('');
}

// ---------- Pages thematiques ----------

const ICON_MAP = {
    '24h': '24h', '48h': '48h', '2min': '2\'', '7j': '7j', 'instant': '!', 'fast': 'fast', 'simple': '1-2-3', 'secure': 'lock', 'no-ct': 'CT', 'no-service': 'wrench', 'all': 'all', 'broken': 'X', 'truck': 'truck', 'money': 'EUR', 'crash': '!', 'estimate': 'calc', 'no-wheel': 'wheel', 'engine': 'motor', 'docs': 'doc', 'help': '?', 'case': 'file', 'cash': 'EUR', 'no-check': 'X', 'trust': 'check', 'full': '100%', 'check': 'CHQ', 'choice': 'opt', 'wire': 'wire', 'trace': 'trace', 'all-brands': 'AB', 'all-models': 'AM', 'fair': 'fair', 'old': '+10', 'value': 'EUR', 'km': 'km', 'honest': 'fair', 'no-judge': 'ok', 'van': 'van', 'pro': 'PRO', 'suv': 'SUV', 'demand': 'up', 'price': 'EUR', 'sedan': 'car', 'comfort': 'star', 'city': 'city', 'popular': 'star', 'family': 'fam', 'space': '7+', 'diesel': 'D', 'all-ages': 'all', 'gas': 'E', 'eco': 'eco', 'hybrid': 'HEV', 'battery': 'bat', 'electric': 'EV', 'future': 'up', 'gpl': 'GPL', 'niche': 'N', 'renault': 'R', 'peugeot': 'P', 'citroen': 'C', 'vw': 'VW', 'german': 'DE', 'toyota': 'T', 'reliable': 'rel', 'ford': 'F', 'american': 'US', 'sporty': 'sport', 'opel': 'O', 'psa': 'PSA', 'audi': 'A', 'premium': 'star', 'bmw': 'BMW', 'sport': 'sport', 'cote': 'up', 'mercedes': 'MB', 'luxury': 'lux', 'nissan': 'N', 'fiat': 'F', 'style': 'style', 'dacia': 'D', 'hyundai': 'H', 'warranty': '5y', 'modern': 'new', 'kia': 'K', 'design': 'des', 'no-visit': 'X', 'no-nego': 'fix', 'no-scam': 'safe', 'legal': 'legal', 'experience': 'exp', 'loa': 'LOA', 'option': 'opt', 'advice': 'tip', 'credit': 'cred', 'solution': 'sol', 'support': 'help', 'patience': 'time', 'discrete': 'priv', 'flexible': 'flex', 'worry-free': 'zen', 'world': 'world', 'admin': 'admin', 'no-wait': 'now', 'direct': 'dir', 'more': '+20%', 'no-buy': 'free', 'compare': 'vs', 'transparent': 'clear', 'best': '#1', 'save': 'save', 'time': 'time', 'easy': 'easy', 'guarantee': 'ok', 'papers': 'doc'
};

function getIconDisplay(icon) {
    return ICON_MAP[icon] || icon;
}

function renderThemeAdvantages(advantages) {
    if (!Array.isArray(advantages) || advantages.length === 0) return '';
    return advantages.map(adv => `
                <div class="theme-advantage-card">
                    <div class="theme-advantage-icon">${esc(getIconDisplay(adv.icon))}</div>
                    <h3>${esc(adv.title)}</h3>
                    <p>${esc(adv.text)}</p>
                </div>`).join('');
}

function renderThemeFAQ(faq) {
    if (!Array.isArray(faq) || faq.length === 0) return '';
    return faq.map(item => `
                <div class="theme-faq-item">
                    <h3>${esc(item.question)}</h3>
                    <p>${esc(item.answer)}</p>
                </div>`).join('');
}

module.exports = {
    hasZFE,
    generateFAQ,
    generateIntroText,
    generateLocalInfo,
    generateNearbyCities,
    renderCityFAQAccordion,
    renderThemeAdvantages,
    renderThemeFAQ
};
