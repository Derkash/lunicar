/**
 * LUNICAR - Rendu des pages publiques.
 * Chaque fonction renvoie le document HTML complet, prêt à être envoyé.
 */

const fs = require('fs');
const path = require('path');
const { SITE, esc, aVille } = require('./config');
const L = require('./layout');
const idf = require('./idf');

// ---------- Blocs propres au maillage ----------

const TOP_BRANDS = ['renault', 'peugeot', 'citroen', 'dacia', 'volkswagen', 'toyota', 'ford', 'opel', 'bmw', 'mercedes', 'audi', 'fiat', 'nissan', 'hyundai', 'kia', 'seat', 'skoda', 'mini', 'volvo', 'tesla'];

const SITUATION_CARDS = [
    { href: '/rachat-voiture-en-panne-paris', t: 'En panne, moteur HS', d: 'Elle ne démarre plus ou le devis de réparation dépasse sa valeur.' },
    { href: '/vendre-voiture-sans-controle-technique-paris', t: 'Sans contrôle technique', d: 'CT expiré, refusé, ou contre-visite jamais passée.' },
    { href: '/rachat-voiture-accidentee-paris', t: 'Accidentée', d: 'Carrosserie, choc structurel, véhicule classé irréparable.' },
    { href: '/rachat-voiture-cash-paris', t: 'À vendre vite', d: 'Départ, besoin de trésorerie, nouvelle voiture qui arrive.' },
    { href: '/rachat-utilitaire-paris', t: 'Utilitaire', d: 'Fourgon ou fourgonnette, même à fort kilométrage.' },
    { href: '/reprise-voiture-haut-kilometrage', t: 'Fort kilométrage', d: 'Plus de 200 000 km au compteur, diesel ancien.' },
    { href: '/reprise-voiture-succession', t: 'Succession', d: 'Le véhicule d\'un proche à vendre après un décès.' },
    { href: '/vendre-voiture-credit', t: 'Crédit en cours', d: 'Le solde est réglé au prêteur, la différence vous revient.' }
];

function situationGrid(title, intro) {
    return `
<section class="section">
    <div class="wrap">
        <p class="eyebrow">Votre situation</p>
        <h2>${title}</h2>
        ${intro ? `<p class="lede">${intro}</p>` : ''}
        <ul class="cases">
            ${SITUATION_CARDS.map((c, i) => `<li><a href="${c.href}"><span class="case-n">${String(i + 1).padStart(2, '0')}</span><strong>${c.t}</strong><span>${c.d}</span></a></li>`).join('')}
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

function brandLinks(themes) {
    const brands = TOP_BRANDS.map(b => themes.find(t => t.slug === `reprise-${b}`)).filter(Boolean);
    return `
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">Toutes marques</p>
        <h2>Par marque</h2>
        <ul class="city-links">${brands.map(t => `<li><a href="/${t.slug}">${esc(t.h1.replace(/^Reprise /, 'Rachat '))}</a></li>`).join('')}</ul>
    </div>
</section>`;
}

// Villes les plus proches : même département, puis code postal le plus voisin.
function nearbyCities(city, cities, n = 10) {
    const cp = parseInt(city.codePostal, 10) || 0;
    return cities
        .filter(c => c.slug !== city.slug && c.departement === city.departement)
        .sort((a, b) => Math.abs((parseInt(a.codePostal, 10) || 0) - cp) - Math.abs((parseInt(b.codePostal, 10) || 0) - cp))
        .slice(0, n);
}

function deptCode(city) {
    const d = idf.deptByName(city.departement);
    if (d && idf.isIdf(city)) return d.code;
    return String(city.codePostal || '').slice(0, 2);
}

// ---------- Accueil ----------

function home({ cities, themes, articles }) {
    const idfMain = ['paris', 'boulogne-billancourt', 'saint-denis', 'montreuil', 'argenteuil', 'nanterre', 'creteil', 'vitry-sur-seine', 'versailles', 'aubervilliers', 'colombes', 'asnieres-sur-seine', 'courbevoie', 'rueil-malmaison', 'champigny-sur-marne', 'saint-maur-des-fosses', 'drancy', 'aulnay-sous-bois', 'noisy-le-grand', 'cergy', 'evry', 'meaux', 'massy', 'sarcelles']
        .map(s => cities.find(c => c.slug === s)).filter(Boolean);
    const franceMain = ['lyon', 'marseille', 'toulouse', 'bordeaux', 'lille', 'nice', 'nantes', 'strasbourg', 'montpellier', 'rennes', 'reims', 'toulon', 'grenoble', 'dijon', 'angers', 'rouen', 'brest', 'clermont-ferrand', 'la-rochelle', 'avignon', 'metz', 'nancy', 'orleans', 'tours']
        .map(s => cities.find(c => c.slug === s)).filter(Boolean);

    const faqs = [
        { question: 'Comment LUNICAR rachète-t-il ma voiture ?', answer: 'Vous décrivez le véhicule en deux minutes. Un conseiller vous rappelle sous 24 h ouvrées avec une offre de prix, valable 7 jours. Si elle vous convient, nous venons à l\'adresse de votre choix, vérifions le véhicule, signons le certificat de cession et réglons par virement bancaire.' },
        { question: 'Le contrôle technique est-il obligatoire pour vous vendre ma voiture ?', answer: 'Non. Le contrôle technique de moins de six mois n\'est exigé que pour une vente à un particulier. LUNICAR étant un professionnel de l\'automobile, vous pouvez vendre avec un contrôle expiré, refusé ou inexistant.' },
        { question: 'Rachetez-vous les voitures en panne ou accidentées ?', answer: 'Oui. Moteur HS, boîte de vitesses, véhicule accidenté ou non roulant : nous faisons une offre sur le véhicule en l\'état et nous organisons son enlèvement sur place.' },
        { question: 'Comment suis-je payé ?', answer: 'Par virement bancaire, émis le jour de la vente. Nous ne payons ni en espèces ni par chèque : le virement est traçable et ne peut pas être contrefait.' },
        { question: 'Dois-je acheter une autre voiture chez vous ?', answer: 'Non. Nous rachetons votre véhicule sans aucune obligation d\'achat.' },
        { question: 'Dans quelles villes intervenez-vous ?', answer: 'À Paris et dans toute l\'Île-de-France en priorité (Hauts-de-Seine, Seine-Saint-Denis, Val-de-Marne, Val-d\'Oise, Essonne, Yvelines, Seine-et-Marne), et sur demande dans le reste de la France.' },
        { question: 'Quels documents faut-il pour vendre ?', answer: 'La carte grise à votre nom, une pièce d\'identité en cours de validité et un RIB. Le certificat de cession et la déclaration de cession sont préparés avec vous au rendez-vous.' },
        { question: 'L\'estimation m\'engage-t-elle ?', answer: 'Non. La demande est gratuite et vous restez libre d\'accepter ou de refuser l\'offre.' }
    ];

    const body = `
${L.hero({
        eyebrow: 'Rachat de voiture · Paris et Île-de-France',
        h1: 'Nous rachetons votre voiture, <em>même en panne ou sans contrôle technique.</em>',
        lede: 'Décrivez votre véhicule en deux minutes. Un conseiller vous rappelle avec une offre, vient le chercher à votre adresse et vous règle par virement bancaire.',
        form: { source: 'accueil' },
        image: 'accueil'
    })}
${situationGrid('Quelle que soit la raison pour laquelle vous vendez', 'Les voitures faciles à vendre trouvent preneur partout. Les autres, celles qu\'une concession refuse et qu\'une annonce ne vend pas, sont celles que nous rachetons le plus souvent.')}
${L.photoBand('panne', 'Voiture en panne, garée dans la rue ou au sous-sol : nous venons la chercher.', 'Une voiture en panne chargée sur une dépanneuse plateau')}
${L.steps(null, true)}
<section class="section section-tint" id="ile-de-france">
    <div class="wrap">
        <p class="eyebrow">Zone d'intervention</p>
        <h2>Rachat de voiture en Île-de-France</h2>
        <p class="lede">Nous nous déplaçons à Paris et dans les sept départements de la région. Le rendez-vous a lieu chez vous, sur votre lieu de travail ou là où le véhicule est stationné.</p>
        ${deptLinks()}
        ${cityLinks(idfMain)}
        <p><a class="text-link" href="/${idf.HUB_SLUG}">Toutes les communes d'Île-de-France ${L.ICONS.arrow}</a></p>
    </div>
</section>
${L.comparison()}
${L.documents()}
${L.callback()}
${brandLinks(themes)}
<section class="section">
    <div class="wrap">
        <p class="eyebrow">Conseils</p>
        <h2>Avant de vendre</h2>
        <ul class="article-list">
            ${articles.slice(0, 3).map(a => `<li><a href="/article/${a.slug}"><span class="article-cat">${esc(a.categorie)}</span><strong>${esc(a.titre)}</strong><span>${esc(a.extrait)}</span></a></li>`).join('')}
        </ul>
        <p><a class="text-link" href="/articles">Tous les conseils ${L.ICONS.arrow}</a></p>
    </div>
</section>
${L.faqSection('Vendre sa voiture à LUNICAR', faqs)}
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">Ailleurs en France</p>
        <h2>Rachat de voiture dans les grandes villes</h2>
        ${cityLinks(franceMain)}
    </div>
</section>
${L.finalCta('Combien vaut votre voiture aujourd\'hui ?')}`;

    return L.page({
        path: '/',
        title: 'Rachat de voiture à Paris et en Île-de-France : offre sous 24 h | LUNICAR',
        description: 'LUNICAR rachète votre voiture à Paris et en Île-de-France, même en panne, accidentée ou sans contrôle technique. Offre gratuite sous 24 h, enlèvement sur place, paiement par virement.',
        body,
        schemas: [
            { '@context': 'https://schema.org', '@type': 'WebSite', name: 'LUNICAR', url: SITE.baseUrl, inLanguage: 'fr-FR' },
            L.ORGANIZATION,
            L.faqSchema(faqs)
        ]
    });
}

// ---------- Estimation ----------

function reprise() {
    const faqs = [
        { question: 'L\'estimation est-elle vraiment gratuite ?', answer: 'Oui, gratuite et sans engagement. Vous recevez une offre et vous décidez librement de l\'accepter ou non.' },
        { question: 'Pourquoi demandez-vous mon téléphone ?', answer: 'Parce qu\'un prix sérieux demande deux ou trois questions sur l\'état réel du véhicule. Un conseiller vous appelle une fois, sous 24 h ouvrées, avec une offre chiffrée. Votre numéro ne sert à rien d\'autre.' },
        { question: 'Je ne connais pas ma plaque par cœur, est-ce bloquant ?', answer: 'Non, l\'immatriculation est facultative. La marque, le modèle, l\'année et le kilométrage suffisent pour une première offre.' },
        { question: 'Combien de temps l\'offre reste-t-elle valable ?', answer: 'Sept jours. Vous avez le temps de comparer et de réfléchir.' },
        { question: 'Le prix annoncé peut-il changer le jour du rendez-vous ?', answer: 'Il est confirmé si le véhicule correspond à votre description. Il n\'est revu que si l\'état réel diffère de ce qui a été déclaré.' },
        { question: 'Où a lieu le rendez-vous ?', answer: 'À l\'adresse de votre choix : domicile, lieu de travail, parking où stationne le véhicule.' },
        { question: 'Puis-je vendre un véhicule encore sous crédit ?', answer: 'Oui dans la plupart des cas : le solde est réglé à l\'organisme prêteur et la différence vous est versée. Munissez-vous du décompte de remboursement anticipé.' },
        { question: 'Que se passe-t-il pour mon assurance ?', answer: 'La cession met fin à votre responsabilité à la date et l\'heure indiquées sur le certificat. Vous transmettez ensuite ce certificat à votre assureur pour résilier le contrat.' }
    ];
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Estimation gratuite', path: '/reprise' }]);
    const body = `
${crumbs.html}
${L.hero({
        eyebrow: 'Estimation gratuite',
        h1: 'Faites estimer votre voiture <em>en deux minutes.</em>',
        lede: 'Quatre informations sur le véhicule, trois pour vous joindre. Un conseiller vous rappelle avec une offre de rachat chiffrée.',
        form: { source: 'estimation' },
        image: 'signature'
    })}
${L.steps(null, true)}
${situationGrid('Nous rachetons aussi les véhicules difficiles à vendre')}
${L.documents()}
${L.comparison()}
${L.callback()}
${L.faqSection('L\'estimation et l\'offre de rachat', faqs)}`;
    return L.page({
        path: '/reprise',
        title: 'Estimation gratuite de votre voiture : offre de rachat sous 24 h | LUNICAR',
        description: 'Faites estimer votre voiture gratuitement : décrivez-la en deux minutes et recevez une offre de rachat sous 24 h. Avec ou sans contrôle technique, paiement par virement.',
        body,
        schemas: [crumbs.schema, L.faqSchema(faqs)]
    });
}

// ---------- Page ville ----------

function city(c, cities) {
    const { nom, slug, departement, region, codePostal } = c;
    const a = aVille(nom);
    const inIdf = idf.isIdf(c);
    const dept = inIdf ? idf.deptByName(departement) : null;
    const code = deptCode(c);
    const isParis = slug === 'paris';
    const near = isParis
        ? ['boulogne-billancourt', 'montreuil', 'saint-denis', 'vincennes', 'ivry-sur-seine', 'levallois-perret', 'neuilly-sur-seine', 'pantin', 'issy-les-moulineaux', 'saint-ouen', 'clichy', 'montrouge'].map(s => cities.find(x => x.slug === s)).filter(Boolean)
        : nearbyCities(c, cities);
    const cpLabel = isParis ? '75001 à 75020' : codePostal;

    const faqs = [
        { question: `Comment vendre ma voiture ${a} avec LUNICAR ?`, answer: `Vous décrivez le véhicule en ligne en deux minutes. Un conseiller vous rappelle sous 24 h ouvrées avec une offre, valable 7 jours. Si vous l'acceptez, nous nous déplaçons ${a} pour vérifier le véhicule, signer le certificat de cession et vous régler par virement bancaire.` },
        { question: `Vous déplacez-vous ${a} ?`, answer: `Oui. Le rendez-vous a lieu à l'adresse de votre choix ${a}${dept && !isParis ? ` ou ailleurs ${dept.dans}` : ''} : domicile, lieu de travail ou emplacement où le véhicule est stationné.` },
        { question: `Faut-il un contrôle technique pour vendre sa voiture ${a} ?`, answer: 'Pas pour vendre à un professionnel. Le contrôle technique de moins de six mois n\'est obligatoire que pour une vente entre particuliers. Nous rachetons avec un contrôle expiré, refusé ou inexistant.' },
        { question: `Rachetez-vous les voitures en panne ou accidentées ${a} ?`, answer: 'Oui. Moteur HS, boîte de vitesses, carrosserie endommagée, véhicule non roulant : nous faisons une offre sur le véhicule en l\'état et nous organisons son enlèvement sur place.' },
        { question: 'Comment se fait le paiement ?', answer: 'Par virement bancaire, émis le jour de la vente. Nous ne réglons ni en espèces ni par chèque.' },
        { question: `Où faire les démarches de cession ${a} ?`, answer: `Nulle part en personne : depuis 2017, les démarches d'immatriculation ne se font plus au guichet${dept && dept.prefecture ? ` de la préfecture de ${dept.prefecture}` : ' de la préfecture'} mais en ligne, sur le site de l'ANTS. Nous préparons avec vous le certificat de cession et la déclaration de cession.` }
    ];

    const crumbItems = [{ name: 'Accueil', path: '/' }];
    if (inIdf) crumbItems.push({ name: 'Île-de-France', path: `/${idf.HUB_SLUG}` });
    if (dept && !isParis) crumbItems.push({ name: `${dept.departement} (${dept.code})`, path: `/${dept.slug}` });
    crumbItems.push({ name: nom, path: `/reprise-auto-${slug}` });
    const crumbs = L.breadcrumb(crumbItems);

    const localIntro = isParis
        ? `<p>À Paris, vendre une voiture par annonce est plus compliqué qu'ailleurs : pas de place pour recevoir un acheteur, un véhicule souvent garé en sous-sol ou à plusieurs rues de chez soi, un contrôle technique à repasser alors que la voiture roule peu. Beaucoup de Parisiens gardent ainsi pendant des mois un véhicule qui ne leur sert plus et qui leur coûte chaque mois en stationnement et en assurance.</p>
<p>Nous intervenons dans les vingt arrondissements, du 1<sup>er</sup> au 20<sup>e</sup>, rive droite comme rive gauche. Le conseiller se déplace jusqu'au véhicule, y compris en parking souterrain, et repart avec : vous n'avez rien à conduire nulle part.</p>`
        : dept
            ? `<p>${nom} (${cpLabel}) fait partie du département ${dept.de} (${dept.code}), où nous nous déplaçons toute la semaine. ${dept.profil}</p>
<p>Concrètement, pour une voiture ${a} : vous nous la décrivez, nous vous appelons avec un prix, puis nous venons sur place. Le véhicule n'a pas besoin de rouler, ni d'avoir un contrôle technique valide.</p>`
            : `<p>LUNICAR rachète les voitures des particuliers et des professionnels ${a} (${cpLabel}), dans le département ${departement} et le reste de la région ${region}. Vous nous décrivez le véhicule, nous vous appelons avec un prix, puis nous organisons le rendez-vous à votre adresse.</p>
<p>Le véhicule n'a pas besoin d'avoir un contrôle technique valide, ni même de rouler : nous faisons une offre sur les voitures en panne, accidentées ou à fort kilométrage.</p>`;

    const body = `
${crumbs.html}
${L.hero({
        eyebrow: inIdf ? `Rachat de voiture · ${departement} (${code})` : `Rachat de voiture · ${departement}`,
        h1: `Rachat de voiture <em>${a}</em>`,
        lede: `Vendez votre voiture ${a} sans annonce ni visites : une offre sous 24 h ouvrées, un rendez-vous à votre adresse, un paiement par virement bancaire. Avec ou sans contrôle technique, même en panne.`,
        form: { source: `ville:${slug}`, cp: isParis ? '' : codePostal, title: `Votre offre de rachat ${a}` },
        image: inIdf ? 'accueil' : 'ile-de-france'
    })}
<section class="section">
    <div class="wrap narrow prose">
        <p class="eyebrow">${nom} · ${cpLabel}</p>
        <h2>Vendre sa voiture ${a}, sans passer par une annonce</h2>
        ${localIntro}
    </div>
</section>
${L.steps(a, true)}
${situationGrid(`Les véhicules que nous rachetons ${a}`)}
${L.comparison()}
${L.documents()}
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">Autour ${isParis ? 'de Paris' : `de ${nom}`}</p>
        <h2>${isParis ? 'Rachat de voiture en petite couronne et dans toute l\'Île-de-France' : `Rachat de voiture près ${a.replace(/^à /, 'de ').replace(/^au /, 'du ').replace(/^aux /, 'des ')}`}</h2>
        ${near.length ? cityLinks(near) : ''}
        ${inIdf ? `<h3 class="sub">Par département</h3>${deptLinks(isParis ? '75' : null)}` : ''}
    </div>
</section>
${L.callback()}
${L.faqSection(`Vendre sa voiture ${a} : vos questions`, faqs)}
${L.finalCta(`Recevez votre offre de rachat ${a}`)}`;

    const title = `Rachat voiture ${nom} (${code}) : offre sous 24 h, même en panne | LUNICAR`;
    return L.page({
        path: `/reprise-auto-${slug}`,
        title: title.length > 68 ? `Rachat voiture ${nom} (${code}) : offre sous 24 h | LUNICAR` : title,
        description: `Rachat de voiture ${a} (${isParis ? '75' : codePostal}) : offre gratuite sous 24 h, rendez-vous à votre adresse, paiement par virement. Avec ou sans contrôle technique, même en panne ou accidentée.`,
        body,
        schemas: [
            crumbs.schema,
            {
                '@context': 'https://schema.org', '@type': 'Service',
                name: `Rachat de voiture ${a}`, serviceType: 'Rachat de véhicules d\'occasion',
                provider: { '@id': `${SITE.baseUrl}/#organisation` },
                areaServed: { '@type': 'City', name: nom, containedInPlace: { '@type': 'AdministrativeArea', name: departement } },
                url: `${SITE.baseUrl}/reprise-auto-${slug}`
            },
            L.ORGANIZATION,
            L.faqSchema(faqs)
        ]
    });
}

// ---------- Île-de-France : région, départements, situations ----------

function hub(cities) {
    const byDept = [idf.PARIS, ...idf.DEPARTMENTS].map(d => ({ d, list: cities.filter(c => idf.isIdf(c) && c.departement === d.departement).sort((x, y) => x.nom.localeCompare(y.nom, 'fr')) }));
    const faqs = [
        { question: 'Dans quels départements d\'Île-de-France intervenez-vous ?', answer: 'Dans les huit : Paris (75), Hauts-de-Seine (92), Seine-Saint-Denis (93), Val-de-Marne (94), Val-d\'Oise (95), Essonne (91), Yvelines (78) et Seine-et-Marne (77).' },
        { question: 'Le déplacement est-il facturé ?', answer: 'Non. Le déplacement du conseiller et l\'enlèvement du véhicule sont à notre charge dans toute l\'Île-de-France.' },
        { question: 'Rachetez-vous les voitures qui ne peuvent plus circuler dans la zone à faibles émissions ?', answer: 'Oui. Une vignette Crit\'Air défavorable n\'empêche pas la vente : nous rachetons les diesels et essences anciens, quel que soit leur classement.' },
        { question: 'Faut-il un contrôle technique ?', answer: 'Non, pas pour vendre à un professionnel de l\'automobile. L\'obligation ne vaut que pour une vente entre particuliers.' },
        { question: 'En combien de temps la vente est-elle conclue ?', answer: 'Vous recevez une offre sous 24 h ouvrées. Le rendez-vous est ensuite fixé dans les jours suivants, selon vos disponibilités, et la vente se conclut lors de ce rendez-vous.' },
        { question: 'Comment suis-je payé ?', answer: 'Par virement bancaire émis le jour de la vente.' }
    ];
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Île-de-France', path: `/${idf.HUB_SLUG}` }]);
    const body = `
${crumbs.html}
${L.hero({
        eyebrow: 'Paris · 92 · 93 · 94 · 95 · 91 · 78 · 77',
        h1: 'Rachat de voiture <em>en Île-de-France</em>',
        lede: 'Nous rachetons votre voiture à Paris, en petite et en grande couronne. Offre sous 24 h ouvrées, rendez-vous à votre adresse, paiement par virement bancaire. Avec ou sans contrôle technique.',
        form: { source: 'idf', title: 'Votre offre de rachat en Île-de-France' },
        image: 'ile-de-france'
    })}
<section class="section">
    <div class="wrap narrow prose">
        <p class="eyebrow">En région parisienne</p>
        <h2>Vendre sa voiture en Île-de-France : ce qui change par rapport à ailleurs</h2>
        <p>La région concentre des contraintes qu'on ne rencontre pas au même degré dans le reste du pays. Le stationnement est rare et payant, donc une voiture qui ne sert plus coûte chaque mois. Beaucoup de véhicules dorment en parking souterrain, d'où il faut les sortir pour un contrôle technique ou une visite. Et les trajets pour rencontrer un acheteur se comptent en heures de bouchon.</p>
        <p>Résultat : en Île-de-France plus qu'ailleurs, on garde trop longtemps un véhicule dont on ne veut plus. Nous prenons le problème à l'envers. C'est nous qui venons jusqu'au véhicule, où qu'il soit dans la région, qu'il roule ou non.</p>
        <p>Les restrictions de circulation liées aux vignettes Crit'Air pèsent aussi sur la valeur des diesels et des essences anciens à l'intérieur de l'A86. Si votre voiture est concernée, mieux vaut connaître son prix maintenant : nous la rachetons quel que soit son classement.</p>
    </div>
</section>
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">Huit départements</p>
        <h2>Rachat de voiture par département</h2>
        ${deptLinks()}
    </div>
</section>
${situationGrid('Les véhicules que nous rachetons en Île-de-France')}
${L.steps('en Île-de-France')}
${L.comparison()}
<section class="section">
    <div class="wrap">
        <p class="eyebrow">${cities.filter(idf.isIdf).length} communes</p>
        <h2>Toutes les communes desservies</h2>
        ${byDept.map(({ d, list }) => `<h3 class="sub"><a href="/${d.slug}">${esc(d.departement)} (${d.code})</a></h3>${cityLinks(list, '')}`).join('')}
    </div>
</section>
${L.documents()}
${L.callback()}
${L.faqSection('Rachat de voiture en Île-de-France : vos questions', faqs)}
${L.finalCta('Votre voiture est en Île-de-France ? Recevez une offre.')}`;
    return L.page({
        path: `/${idf.HUB_SLUG}`,
        title: 'Rachat voiture Île-de-France : offre sous 24 h, enlèvement sur place | LUNICAR',
        description: 'Rachat de voiture en Île-de-France (75, 77, 78, 91, 92, 93, 94, 95) : offre gratuite sous 24 h, déplacement à votre adresse, paiement par virement. Avec ou sans CT, même en panne.',
        body,
        schemas: [crumbs.schema, L.ORGANIZATION, L.faqSchema(faqs)]
    });
}

function department(d, cities) {
    const list = cities.filter(c => c.departement === d.departement && idf.isIdf(c)).sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
    const voisins = d.voisins.map(idf.deptByCode).filter(Boolean);
    const faqs = [
        { question: `Dans quelles communes ${d.de} intervenez-vous ?`, answer: `Dans tout le département, de ${d.prefecture} aux communes les plus éloignées${list.length ? `, notamment ${list.slice(0, 6).map(c => c.nom).join(', ')}` : ''}. Le rendez-vous a lieu à votre adresse.` },
        { question: `Le déplacement ${d.dans} est-il payant ?`, answer: 'Non. Le déplacement du conseiller et l\'enlèvement du véhicule sont à notre charge.' },
        { question: 'Rachetez-vous une voiture en panne ou sans contrôle technique ?', answer: 'Oui. Nous faisons une offre sur le véhicule en l\'état : contrôle technique expiré ou refusé, moteur HS, véhicule accidenté ou non roulant.' },
        { question: `Faut-il se rendre à la préfecture de ${d.prefecture} pour la cession ?`, answer: `Non. Les démarches d'immatriculation ne se font plus au guichet depuis 2017 mais en ligne, sur le site de l'ANTS. Nous préparons avec vous le certificat de cession et la déclaration de cession lors du rendez-vous.` },
        { question: 'Sous quel délai pouvez-vous venir ?', answer: 'Un conseiller vous rappelle sous 24 h ouvrées avec une offre. Si elle vous convient, le rendez-vous est fixé dans les jours suivants selon vos disponibilités.' },
        { question: 'Comment suis-je payé ?', answer: 'Par virement bancaire émis le jour de la vente. Nous ne réglons ni en espèces ni par chèque.' }
    ];
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Île-de-France', path: `/${idf.HUB_SLUG}` }, { name: `${d.departement} (${d.code})`, path: `/${d.slug}` }]);
    const body = `
${crumbs.html}
${L.hero({
        eyebrow: `Département ${d.code} · Île-de-France`,
        h1: `Rachat de voiture <em>${d.dans} (${d.code})</em>`,
        lede: `Nous rachetons votre voiture ${d.dans}, de ${d.prefecture} à ${d.sousPrefectures.join(', ')} et dans toutes les communes du département. Offre sous 24 h ouvrées, rendez-vous à votre adresse, paiement par virement.`,
        form: { source: `dept:${d.code}`, title: `Votre offre de rachat dans le ${d.code}` },
        image: 'ile-de-france'
    })}
<section class="section">
    <div class="wrap narrow prose">
        <p class="eyebrow">${d.departement}</p>
        <h2>Vendre sa voiture ${d.dans}</h2>
        <p>${d.profil}</p>
        <p>Nous circulons dans le département par ses grands axes (${d.axes}) et nous fixons le rendez-vous là où se trouve le véhicule : à domicile, sur un parking d'entreprise, dans une résidence ou chez un garagiste. Le véhicule n'a pas besoin de rouler.</p>
        <p>Côté administratif, rien ne se fait plus au guichet de la préfecture de ${d.prefecture} ni des sous-préfectures (${d.sousPrefectures.join(', ')}) : la déclaration de cession s'enregistre en ligne sur le site de l'ANTS. Nous la préparons avec vous au moment de la vente.</p>
    </div>
</section>
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">${list.length} communes</p>
        <h2>Rachat de voiture dans les communes du ${d.code}</h2>
        ${cityLinks(list)}
    </div>
</section>
${situationGrid(`Les véhicules que nous rachetons ${d.dans}`)}
${L.steps(d.dans)}
${L.comparison()}
${L.documents()}
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
    return L.page({
        path: `/${d.slug}`,
        title: `Rachat voiture ${d.departement} (${d.code}) : offre sous 24 h | LUNICAR`,
        description: `Rachat de voiture ${d.dans} (${d.code}) : ${d.prefecture}, ${d.sousPrefectures.join(', ')} et tout le département. Offre gratuite sous 24 h, enlèvement sur place, paiement par virement, avec ou sans CT.`,
        body,
        schemas: [
            crumbs.schema,
            {
                '@context': 'https://schema.org', '@type': 'Service',
                name: `Rachat de voiture ${d.dans}`, serviceType: 'Rachat de véhicules d\'occasion',
                provider: { '@id': `${SITE.baseUrl}/#organisation` },
                areaServed: { '@type': 'AdministrativeArea', name: d.departement },
                url: `${SITE.baseUrl}/${d.slug}`
            },
            L.ORGANIZATION,
            L.faqSchema(faqs)
        ]
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
${s.sections.map((sec, i) => `
<section class="section${i % 2 ? ' section-tint' : ''}">
    <div class="wrap narrow prose">
        <h2>${sec.h2}</h2>
        ${sec.html}
    </div>
</section>`).join('')}
${L.steps('à Paris et en Île-de-France')}
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">Zone d'intervention</p>
        <h2>Nous nous déplaçons dans toute l'Île-de-France</h2>
        ${deptLinks()}
        <h3 class="sub">Autres situations</h3>
        <ul class="pill-links">${others.map(o => `<li><a href="/${o.slug}">${o.nav}</a></li>`).join('')}</ul>
    </div>
</section>
${L.documents()}
${L.callback()}
${L.faqSection(s.faqTitle, s.faq)}
${L.finalCta('Recevez une offre pour votre véhicule, en l\'état')}`;
    return L.page({
        path: `/${s.slug}`,
        title: s.title,
        description: s.description,
        body,
        schemas: [
            crumbs.schema,
            {
                '@context': 'https://schema.org', '@type': 'Service',
                name: s.h1.replace(/<[^>]+>/g, ''), serviceType: 'Rachat de véhicules d\'occasion',
                provider: { '@id': `${SITE.baseUrl}/#organisation` },
                areaServed: { '@type': 'AdministrativeArea', name: 'Île-de-France' },
                url: `${SITE.baseUrl}/${s.slug}`
            },
            L.ORGANIZATION,
            L.faqSchema(s.faq)
        ]
    });
}

// ---------- Pages thématiques nationales (data/themes.json) ----------

const THEME_ETAT = {
    'rachat-voiture-accidentee': ['accident'],
    'rachat-voiture-sans-controle-technique': ['ct']
};

// Renvoi vers la page Île-de-France correspondante quand elle existe.
const THEME_TO_SITUATION = {
    'rachat-voiture-accidentee': 'rachat-voiture-accidentee-paris',
    'rachat-voiture-sans-controle-technique': 'vendre-voiture-sans-controle-technique-paris',
    'rachat-voiture-rapide': 'rachat-voiture-cash-paris',
    'rachat-voiture-paiement-cash': 'rachat-voiture-cash-paris',
    'rachat-vehicule-utilitaire': 'rachat-utilitaire-paris'
};

const THEME_IMAGE = {
    'rachat-voiture-accidentee': 'accidentee',
    'rachat-voiture-sans-controle-technique': 'sans-ct',
    'rachat-voiture-rapide': 'cash',
    'rachat-voiture-paiement-cash': 'cash',
    'reprise-auto-cheque-de-banque': 'cash',
    'rachat-vehicule-utilitaire': 'utilitaire',
    'reprise-voiture-succession': 'signature',
    'vendre-voiture-credit': 'signature',
    'reprise-voiture-leasing': 'signature'
};

function theme(t, themes) {
    const isBrand = t.category === 'marques';
    const brand = isBrand ? t.h1.replace(/^Reprise /, '') : null;
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Estimation', path: '/reprise' }, { name: t.h1, path: `/${t.slug}` }]);
    const related = themes.filter(o => o.category === t.category && o.slug !== t.slug).slice(0, 14);
    const sit = THEME_TO_SITUATION[t.slug] && idf.situationBySlug(THEME_TO_SITUATION[t.slug]);
    const faqs = [
        ...t.faq,
        { question: 'Faut-il un contrôle technique pour vendre ?', answer: 'Non. Le contrôle technique n\'est exigé que pour une vente entre particuliers, pas pour une vente à un professionnel de l\'automobile.' },
        { question: 'Comment suis-je payé ?', answer: 'Par virement bancaire, émis le jour de la vente.' },
        { question: 'Où a lieu le rendez-vous ?', answer: 'À l\'adresse de votre choix. Nous nous déplaçons à Paris et dans toute l\'Île-de-France en priorité, et sur demande dans le reste de la France.' }
    ];
    const body = `
${crumbs.html}
${L.hero({
        eyebrow: isBrand ? `Rachat ${brand}` : 'Rachat de voiture',
        h1: isBrand ? `Rachat de votre <em>${esc(brand)}</em>` : esc(t.h1),
        lede: `${esc(t.subtitle)} Offre sous 24 h ouvrées, rendez-vous à votre adresse, paiement par virement bancaire.`,
        form: { source: `theme:${t.slug}`, etat: THEME_ETAT[t.slug] || [] },
        image: THEME_IMAGE[t.slug] || (t.category === 'sans-contraintes' ? 'panne' : 'accueil')
    })}
<section class="section">
    <div class="wrap">
        <p class="eyebrow">En bref</p>
        <h2>${isBrand ? `Vendre sa ${esc(brand)} à LUNICAR` : esc(t.h1) + ' : l\'essentiel'}</h2>
        <ul class="facts">
            ${t.advantages.map(adv => `<li><strong>${esc(adv.title)}</strong><span>${esc(adv.text)}</span></li>`).join('')}
        </ul>
        ${isBrand ? `<p class="lede">Nous rachetons les ${esc(brand)} de toutes générations, essence, diesel, hybrides ou électriques, quel que soit le kilométrage. Un historique d'entretien suivi et des factures valorisent le véhicule ; un contrôle technique expiré ou une panne ne l'excluent pas.</p>` : ''}
        ${sit ? `<p><a class="text-link" href="/${sit.slug}">${sit.nav} à Paris et en Île-de-France : le détail ${L.ICONS.arrow}</a></p>` : ''}
    </div>
</section>
${L.steps()}
${L.comparison()}
${L.documents()}
${L.callback()}
${L.faqSection(`${esc(t.h1)} : vos questions`, faqs)}
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">À voir aussi</p>
        <h2>${isBrand ? 'Autres marques' : 'Autres situations'}</h2>
        <ul class="city-links">${related.map(o => `<li><a href="/${o.slug}">${esc(isBrand ? o.h1.replace(/^Reprise /, 'Rachat ') : o.h1)}</a></li>`).join('')}</ul>
        <h3 class="sub">En Île-de-France</h3>
        ${deptLinks()}
    </div>
</section>
${L.finalCta('Recevez votre offre de rachat')}`;
    return L.page({
        path: `/${t.slug}`,
        title: t.title,
        description: t.metaDescription,
        body,
        schemas: [crumbs.schema, L.faqSchema(faqs)]
    });
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
        <p class="hero-lede">Démarches, documents, prix, pièges à éviter : ce qu'il faut savoir avant de céder son véhicule.</p>
    </div>
</section>
<section class="section">
    <div class="wrap">
        <ul class="article-list">
            ${list.map(a => `<li><a href="/article/${a.slug}"><span class="article-cat">${esc(a.categorie)} · ${esc(a.date)}</span><strong>${esc(a.titre)}</strong><span>${esc(a.extrait)}</span></a></li>`).join('')}
        </ul>
    </div>
</section>
${L.finalCta('Prêt à vendre ? Recevez une offre.', null).replace('#estimation', '/reprise')}`;
    return L.page({
        path: '/articles', hasForm: false,
        title: 'Conseils pour vendre sa voiture : démarches, prix, documents | LUNICAR',
        description: 'Guides pratiques pour vendre sa voiture : préparer le véhicule, réunir les documents, comprendre le contrôle technique, choisir entre particulier et professionnel.',
        body, schemas: [crumbs.schema]
    });
}

function article(a, list) {
    const crumbs = L.breadcrumb([{ name: 'Accueil', path: '/' }, { name: 'Conseils', path: '/articles' }, { name: a.titre, path: `/article/${a.slug}` }]);
    const others = list.filter(o => o.slug !== a.slug).slice(0, 3);
    const body = `
${crumbs.html}
<article class="section">
    <div class="wrap narrow prose">
        <p class="eyebrow">${esc(a.categorie)} · ${esc(a.dateModified || a.date)} · ${esc(a.tempsLecture)} min de lecture</p>
        <h1 class="article-title">${esc(a.titre)}</h1>
        <p class="lede">${esc(a.extrait)}</p>
        ${a.contenu}
        <aside class="inline-cta">
            <p><strong>Vous vendez votre voiture ?</strong> Décrivez-la en deux minutes, nous vous rappelons avec une offre de rachat.</p>
            <a class="btn btn-gold" href="/reprise">Recevoir mon offre gratuite</a>
        </aside>
    </div>
</article>
<section class="section section-tint">
    <div class="wrap">
        <h2>À lire aussi</h2>
        <ul class="article-list">
            ${others.map(o => `<li><a href="/article/${o.slug}"><span class="article-cat">${esc(o.categorie)}</span><strong>${esc(o.titre)}</strong><span>${esc(o.extrait)}</span></a></li>`).join('')}
        </ul>
    </div>
</section>`;
    return L.page({
        path: `/article/${a.slug}`, hasForm: false, ogType: 'article',
        title: a.metaTitle || `${a.titre} | LUNICAR`,
        description: a.metaDescription || a.extrait,
        body,
        schemas: [crumbs.schema, {
            '@context': 'https://schema.org', '@type': 'Article',
            headline: a.titre, description: a.metaDescription || a.extrait,
            datePublished: a.dateISO, dateModified: a.dateISO,
            author: { '@type': 'Organization', name: 'LUNICAR', url: SITE.baseUrl },
            publisher: { '@id': `${SITE.baseUrl}/#organisation` },
            mainEntityOfPage: `${SITE.baseUrl}/article/${a.slug}`
        }]
    });
}

// ---------- Garanties, contact, pages légales, 404 ----------

function garanties() {
    const items = [
        ['Offre valable 7 jours', 'Le prix annoncé reste valable sept jours. Il n\'est revu que si l\'état réel du véhicule diffère de la description que vous en avez faite.'],
        ['Paiement par virement bancaire', 'Le règlement est émis par virement le jour de la vente. Ni espèces, ni chèque : la transaction est traçable de bout en bout.'],
        ['Démarches prises en charge', 'Certificat de cession, certificat de situation administrative, déclaration de cession sur le site de l\'ANTS : nous les préparons avec vous.'],
        ['Déplacement et enlèvement à notre charge', 'Le conseiller vient à l\'adresse de votre choix et repart avec le véhicule, y compris lorsqu\'il ne roule plus.'],
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
        path: '/garanties', hasForm: false,
        title: 'Nos garanties : offre 7 jours, paiement par virement, démarches incluses | LUNICAR',
        description: 'Les engagements de LUNICAR pour le rachat de votre voiture : offre valable 7 jours, paiement par virement bancaire, démarches prises en charge, déplacement à notre charge.',
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
                <li><span>Zone</span>Paris, Île-de-France, et sur demande dans le reste de la France</li>
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
        title: 'Contact | LUNICAR, rachat de voiture à Paris et en Île-de-France',
        description: 'Contactez LUNICAR : une question sur le rachat de votre voiture, une demande en cours ou un document à transmettre. Réponse sous 24 h ouvrées.',
        body, schemas: [crumbs.schema]
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

module.exports = { home, reprise, city, hub, department, situation, theme, articles, article, garanties, contact, legal, notFound };
