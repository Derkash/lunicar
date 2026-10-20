/**
 * LUNICAR - Rendu des pages publiques.
 * Chaque fonction renvoie le document HTML complet, prêt à être envoyé.
 *
 * Contenus rédigés : lib/idf.js (départements, situations), data/guides.json
 * (marques et guides), data/local.json (Paris, villes, France, à propos),
 * data/articles.json (conseils). Les gabarits n'ajoutent que la structure.
 */

const fs = require('fs');
const path = require('path');
const { SITE, esc, aVille, deVille } = require('./config');
const L = require('./layout');
const idf = require('./idf');
const zones = require('./zones');
const F = require('./faits');

// Date de la dernière révision éditoriale des gabarits (pages sans date propre).
const TEMPLATE_DATE = '2026-10-21';

// ---------- Blocs propres au maillage ----------

const SITUATION_CARDS = [
    { href: '/vendre-vieille-voiture', t: 'Voiture ancienne', d: 'Plus de 15 ans, peu roulée : on vient la chercher chez vous.' },
    { href: '/rachat-voiture-rapide', t: 'Vendre vite', d: 'Départ, nouvelle voiture qui arrive, besoin de trésorerie.' },
    { href: '/vendre-voiture-credit', t: 'Crédit en cours', d: 'Le solde est réglé au prêteur, la différence vous revient.' },
    { href: '/reprise-voiture-leasing', t: 'Fin de LOA ou LLD', d: 'Lever l\'option puis revendre : quand c\'est intéressant.' },
    { href: '/reprise-voiture-succession', t: 'Succession', d: 'Le véhicule d\'un proche, vendu simplement et sans déplacement.' },
    { href: '/reprise-voiture-haut-kilometrage', t: 'Fort kilométrage', d: '200 000 km et plus : l\'entretien compte plus que le compteur.' },
    { href: '/reprise-voiture-diesel', t: 'Diesel et Crit\'Air', d: 'Une vignette défavorable n\'empêche pas de vendre.' },
    { href: '/rachat-voiture-sans-controle-technique', t: 'Sans contrôle technique', d: 'Non exigé pour une vente à un professionnel.' },
    { href: '/comparatif-reprise-auto', t: 'Comparer les solutions', d: 'Particulier, concession ou professionnel : délais, prix, risques.' }
];
const REPRISE_UPDATED = '2026-10-18';

function situationGrid(title, intro) {
    return `
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">Votre situation</p>
        <h2>${title}</h2>
        ${intro ? `<p class="lede">${intro}</p>` : ''}
        <ul class="cases">
            ${SITUATION_CARDS.map(c => `<li><a href="${c.href}"><strong>${c.t}</strong><span>${c.d}</span></a></li>`).join('')}
        </ul>
    </div>
</section>`;
}

function deptLinks(exceptCode) {
    const all = [idf.PARIS, ...idf.DEPARTMENTS].filter(d => d.code !== exceptCode);
    return `<ul class="pill-links">${all.map(d => `<li><a href="/${d.slug}">${esc(d.departement)} <span>${d.code}</span></a></li>`).join('')}</ul>`;
}

function cityLinks(cities, label = 'Rachat voiture') {
    return `<ul class="city-links">${cities.map(c => `<li><a href="/reprise-auto-${c.slug}">${label ? label + ' ' : ''}${esc(c.nom)}</a></li>`).join('')}</ul>`;
}

function brandLinks(guides) {
    const brands = zones.BRANDS.map(b => guides.find(g => g.slug === `reprise-${b}`)).filter(Boolean);
    return `
<section class="section">
    <div class="wrap">
        <p class="eyebrow">Toutes marques</p>
        <h2>Vendre sa voiture, marque par marque</h2>
        <ul class="pill-links">${brands.map(g => `<li><a href="/${g.slug}">${esc(g.brand)}</a></li>`).join('')}<li><a href="/reprise-voiture-occasion">Toutes les autres marques</a></li></ul>
    </div>
</section>`;
}

const keptIdf = cities => zones.IDF_CITIES.map(s => cities.find(c => c.slug === s)).filter(Boolean);

// Villes gardées les plus proches : même département d'abord, puis code postal voisin.
// Villes gardées les plus proches : même département d'abord, puis même région.
// Jamais une ville d'une autre région (l'écart de codes postaux ne dit rien de la distance).
function nearbyCities(city, cities, n = 8) {
    const cp = parseInt(city.codePostal, 10) || 0;
    return cities
        .filter(c => c.slug !== city.slug && c.slug !== 'paris' && zones.isKeptCity(c) && c.region === city.region)
        .sort((a, b) => (b.departement === city.departement) - (a.departement === city.departement)
            || Math.abs((parseInt(a.codePostal, 10) || 0) - cp) - Math.abs((parseInt(b.codePostal, 10) || 0) - cp))
        .slice(0, n);
}

function deptCode(city) {
    const d = idf.deptByName(city.departement);
    if (d && idf.isIdf(city)) return d.code;
    return String(city.codePostal || '').slice(0, 2);
}

const service = (name, url, areaServed) => ({
    '@context': 'https://schema.org', '@type': 'Service',
    name, serviceType: 'Rachat de véhicules d\'occasion',
    provider: { '@id': `${SITE.baseUrl}/#organisation` },
    areaServed, url: `${SITE.baseUrl}${url}`
});

// ---------- Accueil ----------

function home({ cities, guides, articles }) {
    const faqs = [
        { question: 'Quelles voitures LUNICAR rachète-t-il ?', answer: 'Toutes : voitures récentes encore sous garantie, occasions courantes, SUV, premium, électriques et hybrides, utilitaires, véhicules à fort kilométrage, en panne, accidentés ou sans contrôle technique. Toutes marques, quel que soit l\'âge du véhicule.' },
        { question: 'Comment LUNICAR rachète-t-il ma voiture ?', answer: 'Vous décrivez le véhicule en deux minutes. Un conseiller vous rappelle sous 24 h ouvrées avec une offre de prix, valable 7 jours. Si elle vous convient, nous venons à l\'adresse de votre choix, vérifions le véhicule, signons le certificat de cession et réglons par virement bancaire.' },
        { question: 'Le contrôle technique est-il obligatoire pour vous vendre ma voiture ?', answer: 'Non. Le contrôle technique de moins de six mois n\'est exigé que pour une vente à un particulier. LUNICAR étant un professionnel de l\'automobile, vous pouvez vendre avec un contrôle expiré, refusé ou inexistant.' },
        { question: 'Comment suis-je payé ?', answer: 'Par virement bancaire, émis le jour de la vente. Nous ne payons ni en espèces ni par chèque : le virement est traçable et ne peut pas être contrefait.' },
        { question: 'Dois-je acheter une autre voiture chez vous ?', answer: 'Non. Nous rachetons votre véhicule sans aucune obligation d\'achat. C\'est la différence avec une reprise en concession.' },
        { question: 'Dans quelles villes rachetez-vous des voitures ?', answer: 'Partout en France : Paris, Lyon, Marseille, Bordeaux, Toulouse, Lille, Nantes, Nice, Montpellier et toutes les autres villes. Le déplacement et l\'enlèvement du véhicule sont à notre charge, où que vous soyez.' },
        { question: 'Quels documents faut-il pour vendre ?', answer: 'La carte grise à votre nom, une pièce d\'identité en cours de validité et un RIB. Le certificat de cession et la déclaration de cession sont préparés avec vous au rendez-vous.' },
        { question: 'L\'estimation m\'engage-t-elle ?', answer: 'Non. La demande est gratuite et vous restez libre d\'accepter ou de refuser l\'offre, y compris le jour du rendez-vous.' }
    ];
    const idfMain = keptIdf(cities).filter(c => c.slug !== 'paris').slice(0, 16);
    const franceMain = zones.FRANCE_CITIES.slice(0, 24).map(sl => cities.find(c => c.slug === sl)).filter(Boolean);

    const body = `
${L.showcase({
        eyebrow: 'Rachat de voiture · partout en France',
        h1: 'Nous rachetons votre voiture, <em>toutes marques, récentes ou non.</em>',
        lede: 'Décrivez-la en deux minutes. Un conseiller vous rappelle sous 24 h ouvrées avec une offre, vient à votre adresse sans frais, partout en France, et vous règle par virement bancaire. Sans annonce, sans visites, sans achat imposé.',
        image: 'accueil',
        alt: 'Une Renault Clio 4 grise garée dans une rue haussmannienne de Paris, un acheteur s\'en approche'
    })}
${L.carTypes(null, 'Une citadine de trois ans, un SUV hybride, un utilitaire de société ou une berline qui ne démarre plus : chaque véhicule a un prix, et nous faisons une offre sur chacun.')}
<section class="section section-ink offer" id="offre">
    <div class="wrap offer-in">
        <div class="offer-text">
            <p class="eyebrow">Votre offre</p>
            <h2>Combien vaut votre voiture aujourd'hui ?</h2>
            <p>Quatre informations sur le véhicule, trois pour vous joindre. Un conseiller étudie votre demande et vous rappelle avec un prix, valable 7 jours.</p>
            <ul class="offer-points">
                <li><strong>Gratuit et sans engagement.</strong> Vous pouvez refuser l'offre, même le jour du rendez-vous.</li>
                <li><strong>Un prix expliqué.</strong> Modèle, année, kilométrage, état, entretien : vous savez ce qui fait l'offre.</li>
                <li><strong>Vos données restent chez nous.</strong> Elles servent uniquement à vous faire une offre.</li>
            </ul>
        </div>
        ${L.leadForm({ source: 'accueil' })}
    </div>
</section>
${L.steps(null, true, true)}
<section class="section section-tint" id="ile-de-france">
    <div class="wrap">
        <p class="eyebrow">Zone d'intervention</p>
        <h2>Rachat de voiture à Paris et en Île-de-France</h2>
        <p class="lede">Nous nous déplaçons à Paris et dans les sept départements, sans frais, comme partout en France. Le rendez-vous a lieu chez vous, sur votre lieu de travail ou là où le véhicule est stationné, y compris en parking souterrain.</p>
        ${deptLinks()}
        ${cityLinks(idfMain)}
        <p><a class="text-link" href="/reprise-auto-paris">Rachat de voiture à Paris ${L.ICONS.arrow}</a> &nbsp; <a class="text-link" href="/${idf.HUB_SLUG}">Toute l'Île-de-France ${L.ICONS.arrow}</a></p>
    </div>
</section>
<section class="section">
    <div class="wrap">
        <p class="eyebrow">Partout en France</p>
        <h2>Rachat de voiture dans toute la France</h2>
        <p class="lede">Lyon, Marseille, Bordeaux, Toulouse, Lille, Nantes ou une plus petite ville : décrivez votre voiture, nous vous rappelons sous 24 h ouvrées avec une offre et nous venons à votre adresse, sans frais de déplacement.</p>
        <ul class="pill-links">${Object.entries(zones.REGIONS).map(([name, slug]) => `<li><a href="/${slug}">${esc(name)}</a></li>`).join('')}</ul>
        ${cityLinks(franceMain)}
        <p><a class="text-link" href="/${zones.FRANCE_SLUG}">Rachat de voiture partout en France ${L.ICONS.arrow}</a></p>
    </div>
</section>
${L.comparison()}
${situationGrid('Quelle que soit la raison pour laquelle vous vendez')}
${brandLinks(guides)}
${F.bloc('/')}
${F.articlesLies('/')}
${L.callback()}
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">Conseils</p>
        <h2>Avant de vendre</h2>
        <ul class="article-list">
            ${articles.slice(0, 4).map(a => `<li><a href="/article/${a.slug}"><span class="article-cat">${esc(a.categorie)}</span><strong>${esc(a.titre)}</strong><span>${esc(a.extrait)}</span></a></li>`).join('')}
        </ul>
        <p><a class="text-link" href="/articles">Tous les conseils ${L.ICONS.arrow}</a></p>
    </div>
</section>
${L.faqSection('Vendre sa voiture à LUNICAR', faqs)}
${L.finalCta('Recevez votre offre, gratuitement')}`;

    return L.page({
        path: '/',
        title: 'LUNICAR : rachat de voiture toutes marques, offre sous 24 h',
        description: 'Vendez votre voiture partout en France : récente, d\'occasion, électrique ou en panne. Offre sous 24 h ouvrées, déplacement offert, virement le jour même.',
        preloadImage: 'accueil',
        modified: TEMPLATE_DATE,
        body,
        schemas: [
            { '@context': 'https://schema.org', '@type': 'WebSite', '@id': `${SITE.baseUrl}/#site`, name: 'LUNICAR', url: SITE.baseUrl, inLanguage: 'fr-FR', publisher: { '@id': `${SITE.baseUrl}/#organisation` } },
            L.ORGANIZATION,
            L.faqSchema(faqs)
        ]
    });
}

// ---------- Estimation ----------

function reprise() {
    const faqs = [
        { question: 'Combien vaut ma voiture ?', answer: 'Cela dépend du modèle et de la motorisation, de l\'année, du kilométrage, de l\'entretien et de l\'état réel. Aucun prix sérieux ne se donne sans ces informations : décrivez votre voiture en deux minutes et un conseiller vous rappelle sous 24 h ouvrées avec une offre chiffrée, valable 7 jours.' },
        { question: 'L\'estimation est-elle vraiment gratuite et sans engagement ?', answer: 'Oui. Vous recevez une offre chiffrée et vous décidez librement de l\'accepter ou non, même le jour du rendez-vous. Il n\'y a aucun frais de dossier.' },
        { question: 'Puis-je estimer ma voiture avec la plaque d\'immatriculation ?', answer: 'Oui. Saisissez votre plaque au début du formulaire : elle permet de retrouver la version exacte du véhicule (motorisation, finition, date de mise en circulation). La plaque est facultative : la marque, le modèle, l\'année et le kilométrage suffisent pour une première offre.' },
        { question: 'Pourquoi une offre de rachat est-elle inférieure au prix d\'une annonce ?', answer: 'Le prix affiché dans une annonce entre particuliers est un prix demandé, pas un prix obtenu. Un professionnel paie tout de suite, prend en charge les démarches, la remise en état et la garantie due à son futur acheteur. En échange, vous n\'avez ni annonce, ni visites, ni négociation, ni risque de paiement frauduleux.' },
        { question: 'Ma voiture a peu de kilomètres, sa valeur est-elle plus élevée ?', answer: 'Un faible kilométrage est un atout, à condition qu\'il soit cohérent avec l\'état réel. Sur une voiture ancienne qui a peu roulé, on vérifie aussi ce qui vieillit à l\'arrêt : pneus, batterie, freins, durites. Un carnet d\'entretien à jour fait la différence.' },
        { question: 'Faut-il un contrôle technique pour faire estimer sa voiture ?', answer: 'Non. Le contrôle technique n\'est pas exigé pour une vente à un professionnel. Indiquez simplement la date du dernier contrôle si vous la connaissez.' },
        { question: 'Combien de temps l\'offre reste-t-elle valable ?', answer: 'Sept jours. Vous avez le temps de comparer et de réfléchir.' },
        { question: 'Faut-il me déplacer ?', answer: 'Non. Le rendez-vous a lieu à l\'adresse de votre choix : domicile, garage, parking de résidence ou lieu de travail. Le déplacement est à notre charge.' },
        { question: 'Le prix annoncé peut-il changer le jour du rendez-vous ?', answer: 'Il est confirmé si le véhicule correspond à votre description. Il n\'est revu que si l\'état réel diffère de ce qui a été déclaré.' },
        { question: 'Pourquoi demandez-vous mon téléphone ?', answer: 'Parce qu\'un prix sérieux demande deux ou trois questions sur l\'état réel du véhicule. Un conseiller vous appelle une fois, sous 24 h ouvrées, avec une offre chiffrée. Votre numéro ne sert à rien d\'autre.' }
    ];
    const sections = [
        { h2: 'Comment estimons-nous votre voiture ?', html: `<p>Une estimation sérieuse part de ce qu'une voiture identique se revend réellement aujourd'hui : même modèle, même motorisation, même âge, kilométrage comparable. Nous regardons les annonces de véhicules équivalents et les cotes publiées, puis nous retirons ce que la voiture coûtera à remettre en état avant d'être revendue. C'est ce calcul qui donne l'offre de rachat que vous recevez.</p>
<h3>Les informations qui comptent</h3>
<ul class="ticks">
<li><strong>Le modèle et la motorisation</strong> : deux versions d'un même modèle peuvent valoir des prix très différents. La plaque d'immatriculation permet de retrouver la version exacte.</li>
<li><strong>L'année et le kilométrage</strong> : ils fixent l'ordre de grandeur, sans tout dire.</li>
<li><strong>L'entretien</strong> : carnet tamponné, factures, courroie de distribution faite à temps.</li>
<li><strong>L'état réel</strong> : carrosserie, intérieur, pneus, voyants allumés, bruits connus.</li>
<li><strong>Le contrôle technique</strong> : sa date et ses éventuelles défaillances, s'il existe.</li>
</ul>
<h3>Estimation avec la plaque d'immatriculation</h3>
<p>Saisissez votre plaque au début du formulaire : elle sert à identifier la version précise du véhicule, sa motorisation et sa date de première mise en circulation. Vous n'avez rien d'autre à fournir à ce stade. Si vous ne connaissez pas votre plaque, la marque, le modèle, l'année et le kilométrage suffisent.</p>
<h3>Ce qui change pour une voiture de plus de 15 ans peu roulée</h3>
<p>Sur une voiture ancienne, le kilométrage compte moins que l'état et l'entretien. Une voiture qui a peu roulé mais qui est restée longtemps immobile peut avoir une batterie fatiguée, des pneus durcis ou des freins à revoir : ce n'est pas un motif de refus, c'est simplement pris en compte dans l'offre. Voir notre guide <a href="/vendre-vieille-voiture">vendre une vieille voiture</a>.</p>` },
        { h2: 'Cote, prix d\'annonce, offre de rachat : quelle différence ?', html: `<div class="table-scroll"><table class="compare">
<thead><tr><th scope="col">Repère</th><th scope="col">Ce que c'est</th><th scope="col">À quoi il sert</th></tr></thead>
<tbody>
<tr><td>Cote publiée</td><td>Une valeur moyenne calculée pour un modèle, une année et un kilométrage</td><td>Situer l'ordre de grandeur, à consulter vous-même</td></tr>
<tr><td>Prix d'annonce</td><td>Le prix demandé par un vendeur particulier, avant négociation</td><td>Voir ce que demandent les autres, pas ce qu'ils obtiennent</td></tr>
<tr><td>Offre de rachat</td><td>Un prix chiffré, valable 7 jours, confirmé sur place si l'état correspond à votre description, payé par virement le jour de la vente</td><td>Vendre sans annonce, sans visites et sans risque de paiement</td></tr>
</tbody></table></div>
<p>Comparer ces trois chiffres est la meilleure façon de décider. Notre offre est gratuite et valable 7 jours : elle vous donne un point de comparaison concret avant toute autre démarche. Pour les avantages et les limites de chaque solution, voir notre <a href="/comparatif-reprise-auto">comparatif des solutions de reprise</a>.</p>` },
        { h2: 'Après l\'estimation : vendre sans vous déplacer', html: `<p>Si l'offre vous convient, nous fixons un rendez-vous à l'adresse où se trouve la voiture, à <a href="/reprise-auto-paris">Paris</a>, dans les <a href="/rachat-voiture-hauts-de-seine-92">Hauts-de-Seine</a>, les <a href="/rachat-voiture-yvelines-78">Yvelines</a> ou ailleurs. Le conseiller vérifie que la voiture correspond à sa description, prépare avec vous le certificat de cession et la déclaration de cession, puis le paiement est émis par virement le jour même. Vous n'avez ni annonce à publier, ni visite à organiser.</p>` }
    ];
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Estimation gratuite', path: '/reprise' }]);
    const body = `
${crumbs.html}
${L.hero({
        eyebrow: 'Estimation voiture gratuite',
        h1: 'Estimation voiture gratuite : <em>combien vaut votre voiture ?</em>',
        lede: 'Quatre informations sur le véhicule, trois pour vous joindre. Un conseiller vous rappelle sous 24 h ouvrées avec une offre de rachat chiffrée, valable 7 jours : un vrai prix, ferme, établi d\'après l\'état réel de votre voiture.',
        form: { source: 'estimation' },
        image: 'signature'
    })}
<div class="wrap narrow">${L.updated(REPRISE_UPDATED)}</div>
${L.prose(sections)}
${L.steps(null, true, true)}
${L.documents()}
${F.bloc('/reprise')}
${F.articlesLies('/reprise')}
${L.callback()}
${L.faqSection('Estimation et offre de rachat : vos questions', faqs)}`;
    return L.page({
        path: '/reprise',
        title: 'Estimation voiture gratuite : combien vaut ma voiture ?',
        description: 'Estimez votre voiture gratuitement : ce qui fait son prix, estimation avec la plaque, puis une offre de rachat chiffrée sous 24 h ouvrées, sans vous déplacer.',
        modified: REPRISE_UPDATED,
        preloadImage: 'signature',
        body,
        schemas: [crumbs.schema, L.webPage({ path: '/reprise', name: 'Estimation voiture gratuite', description: 'Comment est estimée votre voiture et demande d\'offre de rachat en deux minutes.', modified: REPRISE_UPDATED }), L.faqSchema(faqs)]
    });
}

// ---------- Paris : page rédigée (data/local.json) ----------

function paris(p, cities) {
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Île-de-France', path: `/${idf.HUB_SLUG}` }, { name: 'Paris', path: '/reprise-auto-paris' }]);
    const around = ['boulogne-billancourt', 'issy-les-moulineaux', 'levallois-perret', 'neuilly-sur-seine', 'clichy', 'saint-ouen', 'saint-denis', 'aubervilliers', 'pantin', 'montreuil', 'ivry-sur-seine', 'villejuif']
        .map(s => cities.find(c => c.slug === s)).filter(Boolean);
    const body = `
${crumbs.html}
${L.hero({ eyebrow: 'Rachat de voiture · Paris 1er au 20e', h1: p.h1, lede: p.lede, points: p.points, form: { source: 'ville:paris', title: 'Votre offre de rachat à Paris' }, image: 'accueil' })}
<div class="wrap narrow">${L.updated(p.updated || TEMPLATE_DATE)}</div>
${L.prose(p.sections)}
${L.carTypes('Les voitures que nous rachetons à Paris')}
${L.steps('à Paris', true)}
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">Autour de Paris</p>
        <h2>Petite couronne et toute l'Île-de-France</h2>
        ${cityLinks(around)}
        ${deptLinks('75')}
    </div>
</section>
${F.bloc('/reprise-auto-paris')}
${F.articlesLies('/reprise-auto-paris')}
${L.callback()}
${L.faqSection(p.faqTitle, p.faq)}
${L.sources(p.sources)}
${L.finalCta('Recevez votre offre de rachat à Paris')}`;
    return L.page({
        path: '/reprise-auto-paris', title: p.title, description: p.description, modified: p.updated || TEMPLATE_DATE, preloadImage: 'accueil', body,
        schemas: [crumbs.schema, service('Rachat de voiture à Paris', '/reprise-auto-paris', { '@type': 'City', name: 'Paris' }),
            L.webPage({ path: '/reprise-auto-paris', name: p.title, description: p.description, modified: p.updated || TEMPLATE_DATE }), L.faqSchema(p.faq)]
    });
}

// ---------- Villes ----------

function city(c, cities, local) {
    if (c.slug === 'paris' && local.paris) return paris(local.paris, cities);
    return idf.isIdf(c) ? cityIdf(c, cities, (local.villes || {})[c.slug] || {}) : cityFrance(c, cities, (local.villes || {})[c.slug] || {});
}

function cityIdf(c, cities, loc) {
    const { nom, slug, departement, codePostal } = c;
    const a = aVille(nom);
    const dept = idf.deptByName(departement);
    const code = deptCode(c);
    const near = nearbyCities(c, cities);
    const faqs = [
        ...(loc.faqLocale ? [loc.faqLocale] : []),
        { question: `Vous déplacez-vous ${a} ?`, answer: `Oui. Le rendez-vous a lieu à l'adresse de votre choix ${a} ou ailleurs ${dept.dans} : domicile, lieu de travail, parking ou garage. Le déplacement et l'enlèvement sont à notre charge.` },
        { question: `Quelles voitures rachetez-vous ${a} ?`, answer: 'Toutes les marques : voitures récentes, occasions courantes, voitures anciennes peu roulées, essence, diesel, hybrides ou électriques, utilitaires, y compris sans contrôle technique valide.' },
        { question: `Faut-il passer à la préfecture ${deVille(dept.prefecture)} ?`, answer: 'Non. Les démarches d\'immatriculation se font en ligne sur le site de l\'ANTS. Nous préparons avec vous le certificat de cession et la déclaration de cession.' }
    ];
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Île-de-France', path: `/${idf.HUB_SLUG}` }, { name: `${dept.departement} (${dept.code})`, path: `/${dept.slug}` }, { name: nom, path: `/reprise-auto-${slug}` }]);
    const body = `
${crumbs.html}
${L.hero({
        eyebrow: `Rachat de voiture · ${departement} (${code})`,
        h1: `Rachat de voiture <em>${a}</em>`,
        lede: `Vendez votre voiture ${a} sans annonce ni visites : offre sous 24 h ouvrées, rendez-vous à votre adresse, paiement par virement. Toutes marques, de la voiture récente à la voiture ancienne peu roulée.`,
        form: { source: `ville:${slug}`, cp: codePostal, title: `Votre offre de rachat ${a}` },
        image: 'accueil'
    })}
<section class="section">
    <div class="wrap narrow prose">
        <p class="eyebrow">${esc(nom)} · ${codePostal}</p>
        <h2>${loc.h2 || `Vendre sa voiture ${a}`}</h2>
        ${loc.intro || `<p>${esc(nom)} fait partie du département ${dept.de} (${dept.code}), où nous nous déplaçons toute la semaine. ${dept.profil}</p>`}
        ${loc.quartiers ? `<p><strong>Secteurs desservis.</strong> ${loc.quartiers}</p>` : ''}
        ${loc.axes ? `<p><strong>Accès.</strong> ${loc.axes}</p>` : ''}
        <p>Votre voiture est ancienne et roule peu ? Voir <a href="/vendre-vieille-voiture">vendre une vieille voiture sans vous déplacer</a>. Pour connaître sa valeur, commencez par une <a href="/reprise">estimation gratuite</a>.</p>
        ${L.updated(loc.updated || TEMPLATE_DATE)}
    </div>
</section>
${loc.bloc2 ? `
<section class="section section-tint">
    <div class="wrap narrow prose">
        <h2>${loc.bloc2.h2}</h2>
        ${loc.bloc2.html}
    </div>
</section>` : ''}
${L.carTypes(`Les voitures que nous rachetons ${a}`)}
${L.steps(a)}
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">Autour ${deVille(nom)}</p>
        <h2>Rachat de voiture ${dept.dans} et à proximité</h2>
        ${near.length ? cityLinks(near) : ''}
        <p><a class="text-link" href="/${dept.slug}">Tout le département ${dept.de} ${L.ICONS.arrow}</a></p>
    </div>
</section>
${L.callback()}
${L.faqSection(`Vendre sa voiture ${a} : vos questions`, faqs)}
${L.finalCta(`Recevez votre offre de rachat ${a}`)}`;
    const title = `Rachat voiture ${nom} (${code}) : offre sous 24 h | LUNICAR`;
    return L.page({
        path: `/reprise-auto-${slug}`,
        title: title.length > 60 ? `Rachat voiture ${nom} (${code}) | LUNICAR` : title,
        description: `Rachat et reprise de voiture ${a} (${codePostal}) : toutes marques, voitures anciennes comprises. Offre sous 24 h ouvrées, rendez-vous chez vous, virement.`.slice(0, 160),
        modified: loc.updated || TEMPLATE_DATE,
        preloadImage: 'accueil',
        body,
        schemas: [crumbs.schema, service(`Rachat de voiture ${a}`, `/reprise-auto-${slug}`, { '@type': 'City', name: nom, containedInPlace: { '@type': 'AdministrativeArea', name: departement } }), L.faqSchema(faqs)]
    });
}

// Hors Île-de-France : texte local rédigé (data/local.json), sans promesse de déplacement.
function cityFrance(c, cities, loc) {
    const { nom, slug, departement, region, codePostal } = c;
    const a = aVille(nom);
    const code = deptCode(c);
    const regionSlug = zones.REGIONS[region];
    const near = nearbyCities(c, cities, 8);
    const faqs = [
        ...(loc.faqLocale ? [loc.faqLocale] : []),
        { question: `Rachetez-vous des voitures ${a} ?`, answer: `Oui. LUNICAR rachète les voitures de toutes marques ${a} et dans tout le département ${departement === nom ? '' : `(${departement}) `}: récentes, d'occasion, électriques, utilitaires, en panne ou accidentées. Un conseiller vous rappelle sous 24 h ouvrées avec une offre.` },
        { question: `Vous déplacez-vous ${a} ?`, answer: `Oui, sans frais. Le rendez-vous a lieu à l'adresse de votre choix ${a} ou dans les environs : domicile, travail, parking ou garage. L'enlèvement du véhicule est à notre charge, même s'il ne roule plus.` },
    ];
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, ...(regionSlug ? [{ name: region, path: `/${regionSlug}` }] : [{ name: 'Partout en France', path: `/${zones.FRANCE_SLUG}` }]), { name: nom, path: `/reprise-auto-${slug}` }]);
    const body = `
${crumbs.html}
${L.hero({
        eyebrow: `Rachat de voiture · ${esc(departement)} (${code})`,
        h1: `Rachat de voiture <em>${a}</em>`,
        lede: `Vendez votre voiture ${a} sans annonce ni visites : offre sous 24 h ouvrées, rendez-vous à votre adresse sans frais de déplacement, paiement par virement. Toutes marques, récentes ou non.`,
        points: ['Toutes marques, tous états', 'Offre sous 24 h ouvrées', 'Déplacement et enlèvement offerts', 'Paiement par virement bancaire'],
        form: { source: `ville:${slug}`, cp: codePostal, title: `Votre offre de rachat ${a}` },
        image: 'accueil'
    })}
<section class="section">
    <div class="wrap narrow prose">
        <p class="eyebrow">${esc(nom)} · ${codePostal}</p>
        <h2>${loc.h2 || `Vendre sa voiture ${a}`}</h2>
        ${loc.intro || ''}
        ${loc.quartiers ? `<p><strong>Secteurs.</strong> ${loc.quartiers}</p>` : ''}
        ${loc.axes ? `<p><strong>Accès.</strong> ${loc.axes}</p>` : ''}
        ${L.updated(loc.updated || TEMPLATE_DATE)}
    </div>
</section>
${loc.bloc2 ? `
<section class="section section-tint">
    <div class="wrap narrow prose">
        <h2>${loc.bloc2.h2}</h2>
        ${loc.bloc2.html}
    </div>
</section>` : ''}
${L.carTypes(`Les voitures que nous rachetons ${a}`)}
${L.steps(a, false, true)}
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">${esc(region)}</p>
        <h2>Rachat de voiture près ${deVille(nom)}</h2>
        ${near.length ? cityLinks(near) : ''}
        <p>${regionSlug ? `<a class="text-link" href="/${regionSlug}">Toute la région ${esc(region)} ${L.ICONS.arrow}</a> &nbsp; ` : ''}<a class="text-link" href="/${zones.FRANCE_SLUG}">Partout en France ${L.ICONS.arrow}</a></p>
    </div>
</section>
${L.callback()}
${L.faqSection(`Vendre sa voiture ${a} : vos questions`, faqs)}
${L.finalCta(`Recevez votre offre de rachat ${a}`)}`;
    const title = `Rachat voiture ${nom} (${code}) : offre sous 24 h | LUNICAR`;
    return L.page({
        path: `/reprise-auto-${slug}`,
        title: title.length > 60 ? `Rachat voiture ${nom} (${code}) | LUNICAR` : title,
        description: `Rachat de voiture ${a} (${codePostal}) : toutes marques, récentes ou non, même en panne. Offre sous 24 h ouvrées, virement le jour de la vente.`.slice(0, 160),
        modified: TEMPLATE_DATE,
        body,
        schemas: [crumbs.schema, service(`Rachat de voiture ${a}`, `/reprise-auto-${slug}`, { '@type': 'City', name: nom, containedInPlace: { '@type': 'AdministrativeArea', name: region } }), L.faqSchema(faqs)]
    });
}

// Région hors Île-de-France : texte rédigé + toutes les communes de la base.
function region(p, cities) {
    const all = cities.filter(c => c.region === p.region).sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
    const kept = all.filter(zones.isKeptCity);
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Partout en France', path: `/${zones.FRANCE_SLUG}` }, { name: p.region, path: `/${p.slug}` }]);
    const modified = p.updated || TEMPLATE_DATE;
    const body = `
${crumbs.html}
${L.hero({ eyebrow: `Rachat de voiture · ${esc(p.region)}`, h1: p.h1, lede: p.lede, points: p.points, form: { source: p.slug, title: `Votre offre de rachat en ${esc(p.region)}` }, image: p.image || 'ile-de-france' })}
<div class="wrap narrow">${L.updated(modified)}</div>
${L.prose(p.sections)}
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">${all.length} communes</p>
        <h2>Rachat de voiture dans les villes de la région</h2>
        ${kept.length ? cityLinks(kept) : ''}
        <p class="commune-list">${all.filter(c => !zones.isKeptCity(c)).map(c => `${esc(c.nom)} <span>${c.codePostal}</span>`).join(' · ')}</p>
    </div>
</section>
${L.carTypes(`Les voitures que nous rachetons en ${esc(p.region)}`)}
${L.steps(null, false, true)}
<section class="section">
    <div class="wrap">
        <p class="eyebrow">Autres régions</p>
        <h2>Partout en France</h2>
        <ul class="pill-links">${Object.entries(zones.REGIONS).filter(([, sl]) => sl !== p.slug).map(([name, sl]) => `<li><a href="/${sl}">${esc(name)}</a></li>`).join('')}<li><a href="/${idf.HUB_SLUG}">Île-de-France</a></li></ul>
    </div>
</section>
${L.callback()}
${L.faqSection(p.faqTitle, p.faq)}
${L.sources(p.sources)}
${L.finalCta(`Votre voiture est en ${esc(p.region)} ? Recevez une offre.`)}`;
    return L.page({
        path: `/${p.slug}`, title: p.title, description: p.description, modified, body,
        schemas: [crumbs.schema, service(`Rachat de voiture en ${p.region}`, `/${p.slug}`, { '@type': 'AdministrativeArea', name: p.region }),
            L.webPage({ path: `/${p.slug}`, name: p.title, description: p.description, modified }), L.faqSchema(p.faq)]
    });
}

// ---------- Île-de-France : région, départements, situations ----------

function hub(cities) {
    const kept = keptIdf(cities);
    const byDept = [idf.PARIS, ...idf.DEPARTMENTS].map(d => ({ d, list: cities.filter(c => idf.isIdf(c) && c.departement === d.departement).sort((x, y) => x.nom.localeCompare(y.nom, 'fr')) }));
    const faqs = [
        { question: 'Dans quels départements d\'Île-de-France intervenez-vous ?', answer: 'Dans les huit : Paris (75), Hauts-de-Seine (92), Seine-Saint-Denis (93), Val-de-Marne (94), Val-d\'Oise (95), Essonne (91), Yvelines (78) et Seine-et-Marne (77).' },
        { question: 'Le déplacement est-il facturé ?', answer: 'Non. Le déplacement du conseiller et l\'enlèvement du véhicule sont à notre charge dans toute l\'Île-de-France.' },
        { question: 'Rachetez-vous les voitures diesel ou mal classées Crit\'Air ?', answer: 'Oui. Une vignette Crit\'Air défavorable n\'empêche pas la vente à un professionnel : nous rachetons les diesels et les essences anciens, quel que soit leur classement.' },
        { question: 'Rachetez-vous aussi les voitures récentes ?', answer: 'Oui. Nous rachetons toutes les voitures, des modèles de moins de trois ans encore sous garantie aux véhicules en panne.' },
        { question: 'En combien de temps la vente est-elle conclue ?', answer: 'Vous recevez une offre sous 24 h ouvrées. Le rendez-vous est ensuite fixé dans les jours suivants, selon vos disponibilités, et la vente se conclut lors de ce rendez-vous.' },
        { question: 'Comment suis-je payé ?', answer: 'Par virement bancaire émis le jour de la vente.' }
    ];
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Île-de-France', path: `/${idf.HUB_SLUG}` }]);
    const body = `
${crumbs.html}
${L.hero({
        eyebrow: 'Paris · 92 · 93 · 94 · 95 · 91 · 78 · 77',
        h1: 'Rachat de voiture <em>en Île-de-France</em>',
        lede: 'Nous rachetons votre voiture dans les huit départements de la région, toutes marques, récente ou non. Offre sous 24 h ouvrées, rendez-vous à votre adresse, paiement par virement bancaire.',
        form: { source: 'idf', title: 'Votre offre de rachat en Île-de-France' },
        image: 'ile-de-france'
    })}
<section class="section">
    <div class="wrap narrow prose">
        <p class="eyebrow">En région parisienne</p>
        <h2>Vendre sa voiture en Île-de-France : ce qui change par rapport à ailleurs</h2>
        <p>La région concentre des contraintes qu'on ne rencontre pas au même degré dans le reste du pays. Le stationnement est rare et souvent payant, donc une voiture qui ne sert plus coûte chaque mois. Beaucoup de véhicules dorment en parking souterrain, d'où il faut les sortir pour un contrôle technique ou une visite. Et les trajets pour rencontrer un acheteur se comptent en heures de bouchons.</p>
        <p>Résultat : en Île-de-France plus qu'ailleurs, on garde trop longtemps un véhicule dont on ne veut plus. Nous prenons le problème à l'envers : c'est nous qui venons jusqu'au véhicule, où qu'il soit dans la région, qu'il roule ou non.</p>
        <p>Les vignettes Crit'Air pèsent aussi sur la valeur des diesels et des essences anciens dans la métropole, et les règles de circulation ont beaucoup évolué. Si votre voiture est concernée, mieux vaut connaître son prix maintenant : nous la rachetons quel que soit son classement. Voir notre guide <a href="/article/vendre-voiture-crit-air-ile-de-france">vendre une voiture Crit'Air en Île-de-France</a>.</p>
        ${L.updated(TEMPLATE_DATE)}
    </div>
</section>
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">Huit départements</p>
        <h2>Rachat de voiture par département</h2>
        ${deptLinks()}
        <h3 class="sub">Principales villes</h3>
        ${cityLinks(kept)}
    </div>
</section>
${L.carTypes('Les voitures que nous rachetons en Île-de-France')}
${L.steps('en Île-de-France')}
${L.comparison()}
<section class="section">
    <div class="wrap">
        <p class="eyebrow">${cities.filter(idf.isIdf).length} communes</p>
        <h2>Toutes les communes desservies</h2>
        <p class="lede">Nous nous déplaçons dans toutes les communes ci-dessous, et dans toutes les autres communes de la région.</p>
        ${byDept.map(({ d, list }) => `<h3 class="sub"><a href="/${d.slug}">${esc(d.departement)} (${d.code})</a></h3><p class="commune-list">${list.map(c => zones.isKeptCity(c) ? `<a href="/reprise-auto-${c.slug}">${esc(c.nom)}</a>` : esc(c.nom)).join(' · ')}</p>`).join('')}
    </div>
</section>
${L.documents()}
${F.bloc(`/${idf.HUB_SLUG}`)}
${F.articlesLies(`/${idf.HUB_SLUG}`)}
${L.callback()}
${L.faqSection('Rachat de voiture en Île-de-France : vos questions', faqs)}
${L.finalCta('Votre voiture est en Île-de-France ? Recevez une offre.')}`;
    return L.page({
        path: `/${idf.HUB_SLUG}`,
        title: 'Rachat voiture Île-de-France : offre sous 24 h | LUNICAR',
        description: 'Rachat de voiture en Île-de-France (75, 77, 78, 91, 92, 93, 94, 95), toutes marques : offre sous 24 h ouvrées, déplacement à votre adresse, virement.',
        modified: TEMPLATE_DATE,
        body,
        schemas: [crumbs.schema, service('Rachat de voiture en Île-de-France', `/${idf.HUB_SLUG}`, { '@type': 'AdministrativeArea', name: 'Île-de-France' }), L.ORGANIZATION, L.faqSchema(faqs)]
    });
}

function department(d, cities) {
    const list = cities.filter(c => c.departement === d.departement && idf.isIdf(c)).sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
    const kept = list.filter(zones.isKeptCity);
    const voisins = d.voisins.map(idf.deptByCode).filter(Boolean);
    const faqs = [
        { question: `Dans quelles communes ${d.de} intervenez-vous ?`, answer: `Dans tout le département, ${deVille(d.prefecture)} aux communes les plus éloignées${list.length ? `, notamment ${list.slice(0, 6).map(c => c.nom).join(', ')}` : ''}. Le rendez-vous a lieu à votre adresse.` },
        { question: `Le déplacement ${d.dans} est-il payant ?`, answer: 'Non. Le déplacement du conseiller et l\'enlèvement du véhicule sont à notre charge.' },
        { question: 'Quelles voitures rachetez-vous ?', answer: 'Toutes les marques et tous les états : voitures récentes, occasions courantes, électriques et hybrides, utilitaires, véhicules à fort kilométrage, en panne, accidentés ou sans contrôle technique.' },
        { question: `Faut-il se rendre à la préfecture ${deVille(d.prefecture)} pour la cession ?`, answer: 'Non. Les démarches d\'immatriculation ne se font plus au guichet depuis 2017 mais en ligne, sur le site de l\'ANTS. Nous préparons avec vous le certificat de cession et la déclaration de cession lors du rendez-vous.' },
        { question: 'Sous quel délai pouvez-vous venir ?', answer: 'Un conseiller vous rappelle sous 24 h ouvrées avec une offre. Si elle vous convient, le rendez-vous est fixé dans les jours suivants selon vos disponibilités.' },
        { question: 'Comment suis-je payé ?', answer: 'Par virement bancaire émis le jour de la vente. Nous ne réglons ni en espèces ni par chèque.' }
    ];
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Île-de-France', path: `/${idf.HUB_SLUG}` }, { name: `${d.departement} (${d.code})`, path: `/${d.slug}` }]);
    const body = `
${crumbs.html}
${L.hero({
        eyebrow: `Département ${d.code} · Île-de-France`,
        h1: d.h1 || `Rachat de voiture <em>${d.dans} (${d.code})</em>`,
        lede: `Nous rachetons votre voiture ${d.dans}, ${deVille(d.prefecture)} à ${d.sousPrefectures.join(', ')} et dans toutes les communes du département. Toutes marques, offre sous 24 h ouvrées, paiement par virement.`,
        form: { source: `dept:${d.code}`, title: `Votre offre de rachat dans le ${d.code}` },
        image: 'ile-de-france'
    })}
<section class="section">
    <div class="wrap narrow prose">
        <p class="eyebrow">${d.departement}</p>
        <h2>Vendre sa voiture ${d.dans}</h2>
        <p>${d.profil}</p>
        <p>Nous circulons dans le département par ses grands axes (${d.axes}) et nous fixons le rendez-vous là où se trouve le véhicule : à domicile, sur un parking d'entreprise, dans une résidence ou chez un garagiste. Le véhicule n'a pas besoin de rouler.</p>
        <p>Côté administratif, rien ne se fait plus au guichet de la préfecture ${deVille(d.prefecture)} ni des sous-préfectures (${d.sousPrefectures.join(', ')}) : la déclaration de cession s'enregistre en ligne sur le site de l'ANTS. Nous la préparons avec vous au moment de la vente.</p>
        ${d.local || ''}
        ${L.updated(d.updated || TEMPLATE_DATE)}
    </div>
</section>
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">${list.length} communes</p>
        <h2>Rachat de voiture dans les communes du ${d.code}</h2>
        ${kept.length ? cityLinks(kept) : ''}
        <p class="commune-list">${list.filter(c => !zones.isKeptCity(c)).map(c => `${esc(c.nom)} <span>${c.codePostal}</span>`).join(' · ')}</p>
    </div>
</section>
${L.carTypes(`Les voitures que nous rachetons ${d.dans}`)}
${L.steps(d.dans)}
${L.comparison()}
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">Départements voisins</p>
        <h2>Autour ${d.de}</h2>
        <ul class="pill-links">${voisins.map(v => `<li><a href="/${v.slug}">${esc(v.departement)} <span>${v.code}</span></a></li>`).join('')}<li><a href="/${idf.HUB_SLUG}">Toute l'Île-de-France</a></li></ul>
    </div>
</section>
${L.callback()}
${L.faqSection(`Rachat de voiture dans le ${d.code} : vos questions`, faqs)}
${L.finalCta(`Votre voiture est dans le ${d.code} ? Recevez une offre.`)}`;
    const title = `Rachat voiture ${d.departement} (${d.code}) : offre 24 h | LUNICAR`;
    return L.page({
        path: `/${d.slug}`,
        title: d.title || (title.length > 60 ? `Rachat voiture ${d.departement} (${d.code}) | LUNICAR` : title),
        description: d.description || `Rachat de voiture ${d.dans} (${d.code}), toutes marques : ${d.prefecture} et tout le département. Offre sous 24 h ouvrées, enlèvement sur place, virement.`.slice(0, 160),
        modified: d.updated || TEMPLATE_DATE,
        preloadImage: 'ile-de-france',
        body,
        schemas: [crumbs.schema, service(`Rachat de voiture ${d.dans}`, `/${d.slug}`, { '@type': 'AdministrativeArea', name: d.departement }), L.faqSchema(faqs)]
    });
}

function situation(s) {
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Île-de-France', path: `/${idf.HUB_SLUG}` }, { name: s.nav, path: `/${s.slug}` }]);
    const others = idf.SITUATIONS.filter(o => o.slug !== s.slug);
    const body = `
${crumbs.html}
${L.hero({
        eyebrow: `${s.nav} · Paris et Île-de-France`,
        h1: s.h1,
        lede: s.lede,
        points: s.points,
        form: { source: `situation:${s.slug}`, etat: s.etat },
        image: s.image
    })}
<div class="wrap narrow">${L.updated(s.updated || TEMPLATE_DATE)}</div>
${L.prose(s.sections)}
${L.steps('à Paris et en Île-de-France')}
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">Zone d'intervention</p>
        <h2>Nous nous déplaçons dans toute l'Île-de-France</h2>
        ${deptLinks()}
        <h3 class="sub">Autres situations</h3>
        <ul class="pill-links">${others.map(o => `<li><a href="/${o.slug}">${o.nav}</a></li>`).join('')}<li><a href="/reprise-voiture-occasion">Toutes les voitures</a></li></ul>
    </div>
</section>
${L.documents()}
${F.bloc(`/${s.slug}`)}
${F.articlesLies(`/${s.slug}`)}
${L.callback()}
${L.faqSection(s.faqTitle, s.faq)}
${L.finalCta('Recevez une offre pour votre véhicule, en l\'état')}`;
    return L.page({
        path: `/${s.slug}`,
        title: s.title,
        description: s.description,
        modified: s.updated || TEMPLATE_DATE,
        body,
        schemas: [
            crumbs.schema,
            service(s.h1.replace(/<[^>]+>/g, ''), `/${s.slug}`, { '@type': 'AdministrativeArea', name: 'Île-de-France' }),
            L.webPage({ path: `/${s.slug}`, name: s.title, description: s.description, modified: s.updated || TEMPLATE_DATE }),
            L.faqSchema(s.faq)
        ]
    });
}

// ---------- Guides rédigés (data/guides.json) : marques, situations, comparatif ----------

function guide(g, guides, models = []) {
    const isBrand = !!g.brand;
    const parent = isBrand ? { name: 'Toutes les voitures', path: '/reprise-voiture-occasion' } : null;
    const crumbItems = [{ name: 'Accueil', path: '/' }, ...(parent && g.slug !== parent.path.slice(1) ? [parent] : []), { name: g.nav, path: `/${g.slug}` }];
    const crumbs = L.breadcrumb(crumbItems);
    const related = isBrand
        ? guides.filter(o => o.brand && o.slug !== g.slug)
        : guides.filter(o => !o.brand && o.slug !== g.slug);
    const modified = g.updated || TEMPLATE_DATE;
    const body = `
${crumbs.html}
${L.hero({ eyebrow: isBrand ? `Rachat ${esc(g.brand)} · partout en France` : `${esc(g.nav)} · partout en France`, h1: g.h1, lede: g.lede, points: g.points, form: { source: `guide:${g.slug}`, etat: g.etat || [] }, image: g.image || 'accueil' })}
<div class="wrap narrow">${L.updated(modified)}</div>
${L.prose(g.sections)}
${g.slug === 'reprise-voiture-occasion' ? L.carTypes('Par type de véhicule') : ''}
${(() => { const ms = g.slug === 'reprise-voiture-occasion' ? models : models.filter(m => m.brandSlug === g.slug); return ms.length ? `<section class="section"><div class="wrap"><p class="eyebrow">Par modèle</p><h2>${isBrand ? `Vendre sa ${esc(g.brand)}, modèle par modèle` : 'Vendre sa voiture, modèle par modèle'}</h2><ul class="pill-links">${ms.map(m => `<li><a href="/${m.slug}">${esc(m.nav)}</a></li>`).join('')}</ul></div></section>` : ''; })()}
${L.steps(null, false, true)}
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">À voir aussi</p>
        <h2>${isBrand ? 'Les autres marques' : 'Autres guides'}</h2>
        <ul class="pill-links">${related.map(o => `<li><a href="/${o.slug}">${esc(o.brand || o.nav)}</a></li>`).join('')}${isBrand ? '<li><a href="/reprise-voiture-occasion">Toutes les marques</a></li>' : ''}</ul>
        <h3 class="sub">Partout en France</h3>
        <ul class="pill-links">${Object.entries(zones.REGIONS).map(([name, slug]) => `<li><a href="/${slug}">${esc(name)}</a></li>`).join('')}<li><a href="/${idf.HUB_SLUG}">Île-de-France</a></li></ul>
    </div>
</section>
${F.bloc(`/${g.slug}`)}
${F.articlesLies(`/${g.slug}`)}
${L.callback()}
${L.faqSection(g.faqTitle, g.faq)}
${L.sources(g.sources)}
${L.finalCta('Recevez votre offre de rachat')}`;
    return L.page({
        path: `/${g.slug}`, title: g.title, description: g.description, modified, body,
        schemas: [
            crumbs.schema,
            service(g.h1.replace(/<[^>]+>/g, ''), `/${g.slug}`, { '@type': 'Country', name: 'France' }),
            L.webPage({ path: `/${g.slug}`, name: g.title, description: g.description, modified }),
            L.faqSchema(g.faq)
        ]
    });
}

// ---------- Pages modèles (data/models.json) : un modèle = une page rédigée, propre au modèle ----------

function model(m, models, guides) {
    const brandGuide = guides.find(g => g.slug === m.brandSlug);
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Toutes les voitures', path: '/reprise-voiture-occasion' },
        ...(brandGuide ? [{ name: m.brand, path: `/${m.brandSlug}` }] : []), { name: m.nav, path: `/${m.slug}` }]);
    const modified = m.updated || '2026-10-18';
    const list = items => `<ul class="ticks">${(items || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
    const sameBrand = models.filter(o => o.brandSlug === m.brandSlug && o.slug !== m.slug);
    const others = models.filter(o => o.brandSlug !== m.brandSlug);
    const sections = [
        { h2: `La ${esc(m.nav)} en bref`, html: `<p>La ${esc(m.nav)} a été produite de ${esc(m.annees)}. Voici ses principales générations et ce qui les distingue.</p>
<ul class="ticks">${(m.generations || []).map(g => `<li><strong>${esc(g.nom)}</strong> (${esc(g.annees)}) : ${esc(g.notes)}</li>`).join('')}</ul>` },
        { h2: `Motorisations, courroie ou chaîne de distribution`, html: `<p>Le type de distribution et son entretien comptent beaucoup dans la valeur d'une ${esc(m.nav)} d'occasion. Les intervalles indiqués sont des repères : seul le carnet d'entretien de votre voiture fait foi.</p>
<div class="table-scroll"><table class="compare">
<thead><tr><th scope="col">Motorisation</th><th scope="col">Carburant</th><th scope="col">Distribution</th><th scope="col">Entretien</th><th scope="col">Points d'attention</th></tr></thead>
<tbody>${(m.motorisations || []).map(x => `<tr><th scope="row">${esc(x.nom)}</th><td>${esc(x.carburant)}</td><td>${esc(x.distribution)}</td><td>${esc(x.entretien)}</td><td>${esc(x.points)}</td></tr>`).join('')}</tbody>
</table></div>` },
        { h2: `Avantages et inconvénients de la ${esc(m.nav)}`, html: `<h3>Ses points forts</h3>${list(m.avantages)}<h3>Ses points faibles</h3>${list(m.inconvenients)}` },
        { h2: `Les problèmes connus sur la ${esc(m.nav)}`, html: `<ul class="ticks">${(m.problemes || []).map(p => `<li><strong>${esc(p.titre)}</strong> : ${esc(p.detail)}</li>`).join('')}</ul>
<p>Un problème connu n'empêche pas la vente : décrivez simplement la voiture telle qu'elle est, l'offre en tient compte et vous n'avez rien à réparer avant.</p>` },
        { h2: `Un modèle ancien ? En bon état, ça change tout`, html: `<p>${esc(m.age)}</p>
<h3>Ce qui soutient la valeur d'une ${esc(m.nav)}</h3>${list(m.valeurPlus)}
<h3>Ce qui la fait baisser</h3>${list(m.valeurMoins)}` },
        { h2: `Ce que nous vérifions au rendez-vous`, html: `${list(m.controles)}<p>La vérification se fait chez vous, en quelques minutes, sans démontage. Le prix annoncé est confirmé si la voiture correspond à sa description.</p>` },
        { h2: `Préparer la vente de votre ${esc(m.nav)}`, html: `${list(m.preparation)}<p>Voir aussi <a href="/article/preparer-voiture-immobilisee-avant-vente">préparer une voiture restée longtemps immobile</a> et <a href="/article/documents-necessaires-vente-voiture">les documents nécessaires pour vendre sa voiture</a>.</p>` },
        { h2: `Faire estimer et vendre votre ${esc(m.nav)}, sans obligation d'achat`, html: `<p>Décrivez votre ${esc(m.nav)} en deux minutes, avec la plaque si vous l'avez. Un conseiller vous rappelle sous 24 h ouvrées avec une offre chiffrée, gratuite et valable 7 jours. Vous n'avez aucun autre véhicule à acheter : nous rachetons votre voiture seule. Si l'offre vous convient, nous venons la chercher chez vous, à <a href="/reprise-auto-paris">Paris</a>, dans les <a href="/rachat-voiture-hauts-de-seine-92">Hauts-de-Seine</a>, les <a href="/rachat-voiture-yvelines-78">Yvelines</a> ou ailleurs en France, et le paiement se fait par virement le jour de la vente. Le contrôle technique n'est pas exigé.</p>
<p>Votre voiture a plus de quinze ans ? Voir <a href="/vendre-vieille-voiture">vendre une vieille voiture sans vous déplacer</a> et <a href="/article/combien-vaut-une-voiture-ancienne">combien vaut une voiture ancienne</a>.</p>` }
    ];
    const body = `
${crumbs.html}
${L.hero({
        eyebrow: `${esc(m.nav)} · estimation gratuite`,
        h1: m.h1,
        lede: m.lede,
        points: ['Estimation gratuite, sans engagement', 'Aucune obligation d\'achat', 'Nous venons chez vous', 'Virement le jour de la vente'],
        form: { source: `modele:${m.slug}`, vehicule: `${m.brand} ${m.model}`, title: `Faites estimer votre ${esc(m.nav)}` },
        image: 'accueil'
    })}
<div class="wrap narrow">${L.updated(modified)}</div>
${L.prose(sections)}
${L.steps(null, false, true)}
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">Par modèle</p>
        <h2>${sameBrand.length ? `Les autres ${esc(m.brand)}` : 'Autres modèles'}</h2>
        <ul class="pill-links">${sameBrand.map(o => `<li><a href="/${o.slug}">${esc(o.nav)}</a></li>`).join('')}${brandGuide ? `<li><a href="/${brandGuide.slug}">Toutes les ${esc(m.brand)}</a></li>` : ''}</ul>
        ${others.length ? `<h3 class="sub">Autres modèles</h3><ul class="pill-links">${others.map(o => `<li><a href="/${o.slug}">${esc(o.nav)}</a></li>`).join('')}</ul>` : ''}
    </div>
</section>
${L.callback()}
${L.faqSection(`Vendre sa ${esc(m.nav)} : vos questions`, m.faq)}
${L.sources(m.sources)}
${L.finalCta(`Recevez une offre pour votre ${esc(m.nav)}`)}`;
    return L.page({
        path: `/${m.slug}`, title: m.title, description: m.description, modified, preloadImage: 'accueil', body,
        schemas: [crumbs.schema,
            service(`Rachat de ${m.nav}`, `/${m.slug}`, { '@type': 'Country', name: 'France' }),
            L.webPage({ path: `/${m.slug}`, name: m.title, description: m.description, modified }),
            L.faqSchema(m.faq)]
    });
}

// Page nationale et page « Qui sommes-nous » : même mécanique, sans formulaire de marque.
function standalone(p, opts = {}) {
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: p.nav, path: `/${p.slug}` }]);
    const modified = p.updated || TEMPLATE_DATE;
    const body = `
${crumbs.html}
${L.hero({ eyebrow: opts.eyebrow || p.nav, h1: p.h1, lede: p.lede, points: p.points, form: { source: p.slug, title: opts.formTitle }, image: p.image || 'signature' })}
<div class="wrap narrow">${L.updated(modified)}</div>
${L.prose(p.sections)}
${opts.after || ''}
${F.bloc(`/${p.slug}`)}
${F.articlesLies(`/${p.slug}`)}
${L.faqSection(p.faqTitle, p.faq)}
${L.sources(p.sources)}
${L.finalCta('Recevez votre offre de rachat')}`;
    return L.page({
        path: `/${p.slug}`, title: p.title, description: p.description, modified, body,
        schemas: [crumbs.schema, opts.type === 'about'
            ? { '@context': 'https://schema.org', '@type': 'AboutPage', url: `${SITE.baseUrl}/${p.slug}`, name: p.title, dateModified: modified, mainEntity: { '@id': `${SITE.baseUrl}/#organisation` } }
            : L.webPage({ path: `/${p.slug}`, name: p.title, description: p.description, modified }),
        L.ORGANIZATION, L.faqSchema(p.faq)]
    });
}

function france(p, cities) {
    const groups = Object.entries(zones.REGIONS).map(([name, slug]) => ({
        name, slug,
        list: zones.FRANCE_CITIES.map(sl => cities.find(c => c.slug === sl)).filter(c => c && c.region === name).sort((x, y) => x.nom.localeCompare(y.nom, 'fr'))
    }));
    return standalone(p, {
        eyebrow: 'Partout en France',
        formTitle: 'Votre offre de rachat',
        after: `<section class="section section-tint"><div class="wrap"><p class="eyebrow">Régions et villes</p><h2>Rachat de voiture par région</h2>
${groups.map(g => `<h3 class="sub"><a href="/${g.slug}">${esc(g.name)}</a></h3>${g.list.length ? cityLinks(g.list) : ''}`).join('')}
<h3 class="sub"><a href="/${idf.HUB_SLUG}">Île-de-France</a></h3>${cityLinks(keptIdf(cities).slice(0, 16))}</div></section>
${L.carTypes()}`
    });
}

function aPropos(p) {
    return standalone(p, { eyebrow: 'Qui sommes-nous', type: 'about', after: `${L.steps(null, true)}` });
}

// ---------- Conseils (articles) ----------

function articles(list) {
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Conseils', path: '/articles' }]);
    const body = `
${crumbs.html}
<section class="page-head">
    <div class="wrap narrow">
        <p class="eyebrow">Conseils</p>
        <h1>Bien vendre sa voiture</h1>
        <p class="hero-lede">Démarches, documents, contrôle technique, prix d'une voiture en panne, Crit'Air : ce qu'il faut savoir avant de céder son véhicule, sources officielles à l'appui.</p>
    </div>
</section>
<section class="section">
    <div class="wrap">
        <ul class="article-list">
            ${list.map(a => `<li><a href="/article/${a.slug}"><span class="article-cat">${esc(a.categorie)} · ${esc(a.tempsLecture)} min</span><strong>${esc(a.titre)}</strong><span>${esc(a.extrait)}</span></a></li>`).join('')}
        </ul>
    </div>
</section>
${L.finalCta('Prêt à vendre ? Recevez une offre.', null).replace('#estimation', '/reprise')}`;
    return L.page({
        path: '/articles', hasForm: false,
        title: 'Conseils pour vendre sa voiture : démarches, prix | LUNICAR',
        description: 'Guides pratiques pour vendre sa voiture : documents, déclaration de cession ANTS, contrôle technique, prix d\'une voiture en panne, Crit\'Air en Île-de-France.',
        modified: list.reduce((m, a) => (a.dateModified || a.dateISO) > m ? (a.dateModified || a.dateISO) : m, TEMPLATE_DATE),
        body, schemas: [crumbs.schema, {
            '@context': 'https://schema.org', '@type': 'CollectionPage', url: `${SITE.baseUrl}/articles`, name: 'Conseils pour vendre sa voiture',
            hasPart: list.map(a => ({ '@type': 'Article', headline: a.titre, url: `${SITE.baseUrl}/article/${a.slug}` }))
        }]
    });
}

function article(a, list) {
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Conseils', path: '/articles' }, { name: a.titre, path: `/article/${a.slug}` }]);
    const others = list.filter(o => o.slug !== a.slug).slice(0, 3);
    const modified = a.dateModified || a.dateISO;
    const body = `
${crumbs.html}
<article class="section">
    <div class="wrap narrow prose">
        <p class="eyebrow">${esc(a.categorie)} · ${esc(a.tempsLecture)} min de lecture</p>
        <h1 class="article-title">${esc(a.titre)}</h1>
        <p class="article-meta">Par ${esc(a.auteur || 'Rédaction LUNICAR')} · ${L.updated(modified).replace(/<\/?p[^>]*>/g, '')}</p>
        <p class="lede">${esc(a.extrait)}</p>
        ${a.contenu}
        <aside class="inline-cta">
            <p><strong>Vous vendez votre voiture ?</strong> Décrivez-la en deux minutes, nous vous rappelons avec une offre de rachat.</p>
            <a class="btn btn-gold" href="/reprise">Recevoir mon offre gratuite</a>
        </aside>
    </div>
</article>
${a.faq && a.faq.length ? L.faqSection('Questions fréquentes', a.faq) : ''}
${L.sources(a.sources)}
<section class="section section-tint">
    <div class="wrap">
        <h2>À lire aussi</h2>
        <ul class="article-list">
            ${others.map(o => `<li><a href="/article/${o.slug}"><span class="article-cat">${esc(o.categorie)}</span><strong>${esc(o.titre)}</strong><span>${esc(o.extrait)}</span></a></li>`).join('')}
        </ul>
    </div>
</section>`;
    return L.page({
        path: `/article/${a.slug}`, hasForm: false, ogType: 'article', modified,
        title: a.metaTitle || `${a.titre} | LUNICAR`,
        description: a.metaDescription || a.extrait,
        body,
        schemas: [crumbs.schema, {
            '@context': 'https://schema.org', '@type': 'Article',
            headline: a.titre, description: a.metaDescription || a.extrait,
            datePublished: a.dateISO, dateModified: modified, inLanguage: 'fr-FR',
            image: `${SITE.baseUrl}/images/og-lunicar.jpg`,
            author: { '@type': 'Organization', name: a.auteur || 'Rédaction LUNICAR', url: `${SITE.baseUrl}/a-propos` },
            publisher: { '@id': `${SITE.baseUrl}/#organisation` },
            mainEntityOfPage: `${SITE.baseUrl}/article/${a.slug}`,
            ...(a.sources && a.sources.length ? { citation: a.sources.map(s => s.url) } : {})
        }, ...(a.faq && a.faq.length ? [L.faqSchema(a.faq)] : [])]
    });
}

// ---------- Chiffres clés : faits officiels sourcés (lib/faits.js) ----------

function chiffres() {
    const path = `/${F.PAGE_SLUG}`;
    const modified = F.derniereVerif() || TEMPLATE_DATE;
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Conseils', path: '/articles' }, { name: 'Chiffres clés', path }]);
    const fait = id => F.FAITS.find(f => f.id === id) || {};
    const faqs = [
        { question: 'Combien de voitures d\'occasion sont vendues chaque année en France ?', answer: fait('marche-vo-volume-2025').fait },
        { question: 'Quel est l\'âge moyen des voitures en France ?', answer: fait('parc-age-moyen-2026').fait },
        { question: 'Combien de kilomètres une voiture fait-elle par an en moyenne ?', answer: fait('kilometrage-annuel-2025').fait },
        { question: 'Dans quel délai faut-il déclarer la vente de sa voiture ?', answer: fait('cession-declaration-15-jours').fait },
        { question: 'Faut-il un contrôle technique pour vendre sa voiture ?', answer: fait('ct-dispenses-vente').fait },
        { question: 'Peut-on payer une voiture en espèces à un professionnel ?', answer: fait('paiement-especes-professionnel').fait }
    ].filter(f => f.answer);
    const body = `
${crumbs.html}
<section class="page-head">
    <div class="wrap narrow">
        <p class="eyebrow">Chiffres clés · vérifiés le ${new Date(modified + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</p>
        <h1>Vendre sa voiture d'occasion en France : les chiffres clés</h1>
        <p class="hero-lede">Marché de l'occasion, âge du parc, contrôle technique, démarches de cession, paiement, arnaques, vices cachés : ${F.FAITS.length} repères officiels, chacun avec sa source, pour vendre en connaissance de cause.</p>
    </div>
</section>
${F.parTheme().map(([theme, items], i) => `
<section class="section${i % 2 ? ' section-tint' : ''}">
    <div class="wrap narrow prose">
        <h2>${esc(theme)}</h2>
        <ul class="faits">
            ${items.map(f => `<li id="${esc(f.id)}"><p>${esc(f.fait)}</p><p class="fait-source">Source : ${F.source(f)}${f.annee ? ` · donnée ${esc(f.annee)}` : ''}</p></li>`).join('')}
        </ul>
    </div>
</section>`).join('')}
<section class="section">
    <div class="wrap narrow prose">
        <h2>Comment ces chiffres ont été établis</h2>
        <p>Chaque chiffre provient d'une source publique ou de référence (statistiques du ministère de la Transition écologique, service-public.gouv.fr, organisme technique du contrôle technique, Banque de France, Code civil) et a été relu sur la page d'origine à la date indiquée. Ce sont des données nationales : elles ne disent rien du prix d'une voiture en particulier.</p>
        <p>Pour connaître la valeur de la vôtre, décrivez-la en deux minutes : un conseiller vous rappelle sous 24 h ouvrées avec une offre de rachat chiffrée, valable 7 jours. <a href="/reprise">Faire estimer ma voiture</a>.</p>
    </div>
</section>
${L.faqSection('Les questions les plus posées', faqs)}
${L.finalCta('Recevez une offre pour votre voiture').replace('#estimation', '/reprise')}`;
    const title = 'Vente de voiture d\'occasion : chiffres clés 2026 | LUNICAR';
    const description = 'Marché de l\'occasion, âge du parc, contrôle technique, cession, paiement, vices cachés : les chiffres officiels pour vendre sa voiture, sources à l\'appui.';
    return L.page({
        path, hasForm: false, title, description, modified, body,
        schemas: [crumbs.schema,
            { ...L.webPage({ path, name: title, description, modified }), citation: [...new Set(F.FAITS.map(f => f.source_url))] },
            L.faqSchema(faqs)]
    });
}

// ---------- Garanties, contact, pages légales, 404 ----------

function garanties() {
    const items = [
        ['Offre valable 7 jours', 'Le prix annoncé reste valable sept jours. Il n\'est revu que si l\'état réel du véhicule diffère de la description que vous en avez faite.'],
        ['Paiement par virement bancaire', 'Le règlement est émis par virement le jour de la vente. Ni espèces, ni chèque : la transaction est traçable de bout en bout.'],
        ['Démarches prises en charge', 'Certificat de cession, certificat de situation administrative, déclaration de cession sur le site de l\'ANTS : nous les préparons avec vous.'],
        ['Déplacement et enlèvement à notre charge', 'Partout en France, le conseiller vient à l\'adresse de votre choix et repart avec le véhicule, y compris lorsqu\'il ne roule plus.'],
        ['Prix expliqué', 'Nous vous disons ce qui fait le prix : modèle, année, kilométrage, état, marché de l\'occasion. Vous savez pourquoi l\'offre est ce qu\'elle est.'],
        ['Aucun engagement', 'La demande est gratuite. Vous pouvez refuser l\'offre, y compris le jour du rendez-vous, sans frais.']
    ];
    const faqs = [
        { question: 'Puis-je refuser l\'offre après la vérification du véhicule ?', answer: 'Oui. Si le prix confirmé sur place ne vous convient pas, vous êtes libre de refuser, sans aucun frais.' },
        { question: 'Mon véhicule a des défauts, puis-je quand même le vendre ?', answer: 'Oui. Rayures, bosses, problèmes mécaniques, fort kilométrage : décrivez-les honnêtement lors de la demande pour obtenir un prix juste dès le premier appel.' },
        { question: 'Que se passe-t-il une fois le certificat de cession signé ?', answer: 'La vente est définitive et votre responsabilité sur le véhicule cesse à la date et l\'heure de la cession. Vous recevez un exemplaire du certificat pour votre assureur.' },
        { question: 'Y a-t-il des frais de dossier ?', answer: 'Non. Le prix annoncé est le montant que vous recevez.' }
    ];
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Garanties', path: '/garanties' }]);
    const body = `
${crumbs.html}
<section class="page-head">
    <div class="wrap narrow">
        <p class="eyebrow">Nos engagements</p>
        <h1>Ce à quoi nous nous engageons</h1>
        <p class="hero-lede">Six règles simples, les mêmes pour chaque vente, quel que soit le véhicule.</p>
    </div>
</section>
<section class="section">
    <div class="wrap">
        <ol class="pledges">
            ${items.map(([t, d], i) => `<li><span class="case-n">${String(i + 1).padStart(2, '0')}</span><h2>${t}</h2><p>${d}</p></li>`).join('')}
        </ol>
    </div>
</section>
${L.photoBand('signature', 'Le certificat de cession est signé avec vous, le jour de la vente.', 'Signature d\'un document sur le capot d\'une voiture, clés à côté')}
${L.faqSection('Garanties : vos questions', faqs)}
${L.finalCta('Recevez votre offre de rachat').replace('#estimation', '/reprise')}`;
    return L.page({
        path: '/garanties', hasForm: false, modified: TEMPLATE_DATE,
        title: 'Nos garanties : offre 7 jours, virement, démarches | LUNICAR',
        description: 'Les engagements de LUNICAR pour le rachat de votre voiture : offre valable 7 jours, paiement par virement, démarches prises en charge, aucun frais.',
        body, schemas: [crumbs.schema, L.faqSchema(faqs)]
    });
}

function contact() {
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Contact', path: '/contact' }]);
    const body = `
${crumbs.html}
<section class="page-head">
    <div class="wrap narrow">
        <p class="eyebrow">Contact</p>
        <h1>Nous contacter</h1>
        <p class="hero-lede">Pour une offre de rachat, le plus rapide reste <a href="/reprise">la demande d'estimation</a>. Pour toute autre question, écrivez-nous ici.</p>
    </div>
</section>
<section class="section">
    <div class="wrap contact-grid">
        <div class="prose">
            <h2>Coordonnées</h2>
            <ul class="contact-list">
                ${SITE.phone ? `<li><span>Téléphone</span>${L.phoneLink('text-link')}</li>` : ''}
                ${SITE.whatsapp ? `<li><span>WhatsApp</span>${L.whatsappLink('text-link', SITE.whatsapp.display)}</li>` : ''}
                <li><span>E-mail</span><a class="text-link" href="mailto:${SITE.email}">${SITE.email}</a></li>
                <li><span>Horaires</span>${SITE.hours}</li>
                <li><span>Zone</span>Partout en France, déplacement à notre charge</li>
                <li><span>Société</span><a href="/a-propos">LUNICAR, marque d'OPTIMERCH</a></li>
            </ul>
        </div>
        <form class="contact-form" id="contactForm" novalidate>
            <label class="field"><span class="field-label">Nom</span><input type="text" name="nom" required autocomplete="name"></label>
            <div class="field-row">
                <label class="field"><span class="field-label">E-mail</span><input type="email" name="email" required autocomplete="email"></label>
                <label class="field"><span class="field-label">Téléphone <em>facultatif</em></span><input type="tel" name="telephone" autocomplete="tel"></label>
            </div>
            <label class="field"><span class="field-label">Votre message</span><textarea name="message" rows="5" required></textarea></label>
            <label class="hp" aria-hidden="true">Ne pas remplir <input type="text" name="site_web" tabindex="-1" autocomplete="off"></label>
            <button type="submit" class="btn btn-gold">Envoyer</button>
            <p class="callback-msg" role="status" hidden></p>
            <p class="lead-legal">Vos informations servent uniquement à vous répondre. <a href="/politique-confidentialite">Confidentialité</a></p>
        </form>
    </div>
</section>`;
    return L.page({
        path: '/contact', hasForm: false,
        title: 'Contact | LUNICAR, rachat de voiture partout en France',
        description: 'Contactez LUNICAR : une question sur le rachat de votre voiture, une demande en cours ou un document à transmettre. Réponse sous 24 h ouvrées par e-mail.',
        body, schemas: [crumbs.schema, { '@context': 'https://schema.org', '@type': 'ContactPage', url: `${SITE.baseUrl}/contact`, mainEntity: { '@id': `${SITE.baseUrl}/#organisation` } }]
    });
}

function legal(slug, title, description) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'content', `${slug}.html`), 'utf-8');
    return L.page({
        path: `/${slug}`, hasForm: false, title, description,
        body: `<div class="legal">${html}</div>`
    });
}

function notFound() {
    return L.page({
        path: '/404', hasForm: false, noindex: true,
        title: 'Page introuvable | LUNICAR',
        description: 'Cette page n\'existe pas ou plus.',
        body: `
<section class="page-head">
    <div class="wrap narrow">
        <p class="eyebrow">Erreur 404</p>
        <h1>Cette page n'existe pas</h1>
        <p class="hero-lede">L'adresse a peut-être changé. Vous pouvez repartir de l'accueil ou demander directement une offre de rachat.</p>
        <p class="final-cta-actions"><a class="btn btn-gold" href="/reprise">Faire estimer ma voiture</a> <a class="btn btn-outline" href="/">Accueil</a></p>
    </div>
</section>`
    });
}

module.exports = { chiffres, TEMPLATE_DATE, model, home, reprise, city, hub, department, situation, guide, region, france, aPropos, articles, article, garanties, contact, legal, notFound };
