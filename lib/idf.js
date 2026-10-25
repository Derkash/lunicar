/**
 * LUNICAR - Île-de-France : départements et pages par situation.
 *
 * Une page = une intention de recherche. Les variantes proches (en panne, HS,
 * non roulante, moteur HS) sont traitées sur la même page pour ne pas se
 * concurrencer entre elles.
 */

// `departement` reprend exactement l'orthographe de data/cities.json.
const DEPARTMENTS = [
    {
        code: '92', de: 'des Hauts-de-Seine', departement: 'Hauts-de-Seine', slug: 'rachat-voiture-hauts-de-seine-92', dans: 'dans les Hauts-de-Seine',
        title: 'Rachat et reprise voiture Hauts-de-Seine (92) à domicile',
        description: 'Vendez votre voiture dans le 92 sans vous déplacer : Boulogne, Nanterre, Neuilly, Rueil, Issy. Estimation rapide, technicien chez vous, virement.',
        h1: 'Rachat et reprise de voiture <em>dans les Hauts-de-Seine (92)</em>',
        updated: '2026-10-22',
        local: `<h3>Où nous intervenons dans le 92</h3>
<p>Nous intervenons dans toutes les communes du département. Les plus demandées ont leur page : <a href="/reprise-auto-boulogne-billancourt">rachat voiture Boulogne-Billancourt</a>, <a href="/reprise-auto-neuilly-sur-seine">rachat voiture Neuilly-sur-Seine</a>, <a href="/reprise-auto-nanterre">rachat voiture Nanterre</a>, <a href="/reprise-auto-rueil-malmaison">rachat voiture Rueil-Malmaison</a>, <a href="/reprise-auto-issy-les-moulineaux">rachat voiture Issy-les-Moulineaux</a>, <a href="/reprise-auto-levallois-perret">Levallois-Perret</a>, <a href="/reprise-auto-courbevoie">Courbevoie</a>, <a href="/reprise-auto-colombes">Colombes</a>, <a href="/reprise-auto-asnieres-sur-seine">Asnières-sur-Seine</a>, <a href="/reprise-auto-clichy">Clichy</a> et <a href="/reprise-auto-antony">Antony</a>.</p>
<h3>Voitures de résidence, véhicules de fonction, voitures anciennes</h3>
<p>Dans le nord du département, autour de La Défense, beaucoup de véhicules stationnent en parking de tour ou de copropriété : voitures de fonction restituées, citadines qui ne servent plus depuis le passage au télétravail. Dans le sud (Antony, Clamart, Sceaux), on nous propose plus souvent la voiture ancienne d'un pavillon, peu roulée et bien entretenue. Les deux se vendent mal par annonce, pour la même raison : il faut sortir la voiture, refaire le contrôle technique et recevoir des inconnus. Un technicien Lunicar vient la voir là où elle est. Voir aussi <a href="/vendre-vieille-voiture">vendre une vieille voiture</a> et <a href="/vendre-voiture-sans-controle-technique-paris">vendre sa voiture sans CT</a>.</p>`,
        prefecture: 'Nanterre', sousPrefectures: ['Antony', 'Boulogne-Billancourt'],
        axes: 'A86, A13, A14, N118 et le boulevard périphérique ouest',
        profil: 'Dans le 92, beaucoup de véhicules dorment en parking souterrain de copropriété : citadines peu utilisées, voitures de fonction restituées, véhicules dont le contrôle technique est passé depuis des mois. Un véhicule immobilisé en sous-sol se vend très mal par annonce : il faut le sortir, le faire contrôler, recevoir les acheteurs dans la résidence. Un technicien Lunicar vient directement sur place, y compris en parking couvert.',
        voisins: ['75', '93', '95', '78', '91', '94']
    },
    {
        code: '93', de: 'de Seine-Saint-Denis', departement: 'Seine-Saint-Denis', slug: 'rachat-voiture-seine-saint-denis-93', dans: 'en Seine-Saint-Denis',
        prefecture: 'Bobigny', sousPrefectures: ['Saint-Denis', 'Le Raincy'],
        axes: 'A1, A3, A86, A104 et la N2',
        profil: 'En Seine-Saint-Denis, la voiture sert tous les jours et les kilométrages montent vite : diesels de plus de 200 000 km, utilitaires d\'artisans, véhicules stationnés sur voirie dont le contrôle technique a été refusé. Ce sont précisément les véhicules qu\'un particulier a du mal à vendre et qu\'une concession ne reprend pas sans achat. Nous les étudions en l\'état.',
        voisins: ['75', '92', '95', '77', '94']
    },
    {
        code: '94', de: 'du Val-de-Marne', departement: 'Val-de-Marne', slug: 'rachat-voiture-val-de-marne-94', dans: 'dans le Val-de-Marne',
        prefecture: 'Créteil', sousPrefectures: ['L\'Haÿ-les-Roses', 'Nogent-sur-Marne'],
        axes: 'A4, A6, A86, N6 et N19',
        profil: 'Dans le Val-de-Marne, les demandes viennent autant des communes denses proches de Paris (Vincennes, Ivry, Vitry) que des secteurs pavillonnaires du plateau briard. Deuxième voiture du foyer devenue inutile, véhicule d\'un parent qui ne conduit plus, voiture en panne devant le pavillon : nos techniciens interviennent dans tout le département pour l\'examiner sur place.',
        voisins: ['75', '92', '93', '77', '91']
    },
    {
        code: '95', de: 'du Val-d\'Oise', departement: 'Val-d\'Oise', slug: 'rachat-voiture-val-d-oise-95', dans: 'dans le Val-d\'Oise',
        prefecture: 'Cergy-Pontoise', sousPrefectures: ['Argenteuil', 'Sarcelles'],
        axes: 'A15, A115, A1, A16 et la Francilienne (N104)',
        profil: 'Le Val-d\'Oise combine une partie très urbaine au sud (Argenteuil, Sarcelles, Garges) et le Vexin rural au nord-ouest, où l\'on ne se passe pas de voiture. Les trajets domicile-travail sont longs, les véhicules affichent souvent de forts kilométrages. Nous étudions aussi bien la compacte récente que le monospace de 250 000 km.',
        voisins: ['92', '93', '78', '77']
    },
    {
        code: '91', de: 'de l\'Essonne', departement: 'Essonne', slug: 'rachat-voiture-essonne-91', dans: 'en Essonne',
        prefecture: 'Évry-Courcouronnes', sousPrefectures: ['Étampes', 'Palaiseau'],
        axes: 'A6, A10, N20, N118 et la Francilienne (N104)',
        profil: 'En Essonne, la voiture est le premier moyen de transport dès qu\'on s\'éloigne des lignes de RER. Les foyers ont souvent deux ou trois véhicules, et celui qui sert le moins finit par ne plus démarrer. Du plateau de Saclay au sud du département autour d\'Étampes, nous intervenons pour examiner le véhicule là où il se trouve.',
        voisins: ['92', '94', '78', '77']
    },
    {
        code: '78', de: 'des Yvelines', departement: 'Yvelines', slug: 'rachat-voiture-yvelines-78', dans: 'dans les Yvelines',
        title: 'Rachat et reprise voiture Yvelines (78) à domicile',
        description: 'Vendez votre voiture dans le 78 sans vous déplacer : Versailles, Saint-Germain-en-Laye, Le Chesnay. Estimation rapide, technicien chez vous.',
        h1: 'Rachat et reprise de voiture <em>dans les Yvelines (78)</em>',
        updated: '2026-10-22',
        local: `<h3>Versailles, Le Chesnay, Saint-Germain-en-Laye</h3>
<p>Au nord-est du département, la demande vient surtout de Versailles et de ses voisines. À <a href="/reprise-auto-versailles">Versailles</a>, le quartier historique se prête mal à une vente dans la rue ; à <a href="/reprise-auto-le-chesnay">Le Chesnay-Rocquencourt</a>, beaucoup de voitures dorment dans les parkings des résidences de Parly 2 ; à <a href="/reprise-auto-saint-germain-en-laye">Saint-Germain-en-Laye</a>, ce sont souvent des voitures anciennes gardées au garage d'une maison. Dans les trois cas, un technicien Lunicar vient voir la voiture sur place.</p>
<h3>Vallée de la Seine et reste du département</h3>
<p>De <a href="/reprise-auto-sartrouville">Sartrouville</a> à Poissy, Les Mureaux et Mantes-la-Jolie, et au sud jusqu'à Rambouillet, nous intervenons aussi dans toutes les communes, y compris pour une voiture qui ne roule plus beaucoup. Voir <a href="/vendre-vieille-voiture">vendre une vieille voiture sans vous déplacer</a> et notre <a href="/reprise">estimation gratuite</a>.</p>`,
        prefecture: 'Versailles', sousPrefectures: ['Mantes-la-Jolie', 'Rambouillet', 'Saint-Germain-en-Laye'],
        axes: 'A12, A13, A14, N10 et N12',
        profil: 'Dans les Yvelines, le parc automobile est varié : berlines et SUV premium autour de Versailles et Saint-Germain-en-Laye, véhicules plus anciens et utilitaires dans la vallée de la Seine vers Mantes et Les Mureaux. Nous étudions les uns comme les autres, avec une estimation calée sur le marché de l\'occasion et l\'état réel du véhicule.',
        voisins: ['92', '95', '91']
    },
    {
        code: '77', de: 'de Seine-et-Marne', departement: 'Seine-et-Marne', slug: 'rachat-voiture-seine-et-marne-77', dans: 'en Seine-et-Marne',
        prefecture: 'Melun', sousPrefectures: ['Meaux', 'Provins', 'Fontainebleau', 'Torcy'],
        axes: 'A4, A5, A104, N4 et N36',
        profil: 'La Seine-et-Marne couvre à elle seule la moitié de la surface de l\'Île-de-France. Les distances sont longues et un véhicule en panne à Provins ou à Nemours ne se déplace pas facilement jusqu\'à un acheteur. C\'est le technicien Lunicar qui vient à votre adresse : de Marne-la-Vallée au sud du département, le rendez-vous a lieu à votre adresse.',
        voisins: ['93', '94', '91', '95']
    }
];

const PARIS = { code: '75', departement: 'Paris', slug: 'reprise-auto-paris', dans: 'à Paris' };

const HUB_SLUG = 'rachat-voiture-ile-de-france';

function deptBySlug(slug) { return DEPARTMENTS.find(d => d.slug === slug); }
function deptByName(name) { return DEPARTMENTS.find(d => d.departement === name) || (name === 'Paris' ? PARIS : null); }
function deptByCode(code) { return code === '75' ? PARIS : DEPARTMENTS.find(d => d.code === code); }
function isIdf(city) { return city && city.region === 'Île-de-France'; }

// ---------- Pages par situation (Paris et Île-de-France) ----------

const SITUATIONS = [
    {
        slug: 'rachat-voiture-en-panne-paris',
        image: 'panne',
        nav: 'Voiture en panne ou HS',
        etat: ['panne'],
        title: 'Rachat voiture en panne ou HS à Paris et en IDF | LUNICAR',
        description: 'Voiture en panne, moteur HS ou non roulante à Paris et en Île-de-France : étude en l\'état, sans engagement ; si une offre est possible, enlèvement offert.',
        h1: 'Rachat de voiture en panne ou HS <em>à Paris et en Île-de-France</em>',
        lede: 'Moteur cassé, boîte de vitesses bloquée, voiture qui ne démarre plus : elle peut être étudiée dans l\'état où elle se trouve. Décrivez la panne ; selon son importance, une offre n\'est pas toujours possible. Aucune réparation à avancer, aucun contrôle technique à passer.',
        points: ['Véhicule non roulant étudié', 'Enlèvement offert si vente conclue', 'Sans contrôle technique', 'Paiement par virement instantané'],
        sections: [
            {
                h2: 'Quelles pannes pouvons-nous étudier ?',
                html: `<p>Toutes peuvent faire l'objet d'une demande, en particulier celles qui rendent la réparation trop chère au regard de la valeur du véhicule. Certaines pannes ou dégradations importantes peuvent toutefois conduire à une absence d'offre : nous vous le disons dès le rappel. Le cas le plus fréquent en région parisienne : un devis de garage à 3 000 ou 4 000 € sur une voiture qui en vaut à peine plus une fois réparée.</p>
<ul class="ticks">
<li><strong>Moteur HS</strong> : joint de culasse, casse de distribution, turbo, bielle coulée, surchauffe.</li>
<li><strong>Boîte de vitesses ou embrayage</strong> : boîte automatique en défaut, embrayage et volant moteur à remplacer.</li>
<li><strong>Injection et dépollution</strong> : injecteurs, vanne EGR, filtre à particules colmaté, AdBlue en défaut.</li>
<li><strong>Électronique</strong> : calculateur, faisceau, voiture qui ne démarre plus sans cause identifiée.</li>
<li><strong>Immobilisation longue</strong> : batterie morte, freins grippés, véhicule qui n'a pas roulé depuis des mois ou des années.</li>
</ul>
<p>Vous n'avez pas besoin de connaître le diagnostic exact. Décrivez les symptômes, dites depuis quand le véhicule est immobilisé et où il se trouve : cela suffit pour une première estimation.</p>`
            },
            {
                h2: 'Comment se passe l\'enlèvement d\'un véhicule non roulant',
                html: `<p>Un véhicule qui ne roule pas ne peut pas venir à nous, donc un technicien Lunicar va à lui. Le rendez-vous se tient à l'endroit où la voiture est stationnée : devant chez vous, dans une cour, sur une place de parking privée, dans un parking souterrain ou chez le garagiste qui a établi le devis.</p>
<p>Signalez-nous dès la demande les contraintes d'accès : hauteur du parking, rampe étroite, roues bloquées, absence de clé. Nous prévoyons le matériel adapté. Si la vente est conclue, l'enlèvement est à notre charge ; il n'est pas déduit du prix.</p>
<p class="note">Voiture stationnée sur la voie publique à Paris ou en petite couronne ? Ne tardez pas : un véhicule immobile trop longtemps au même endroit s'expose à une mise en fourrière pour stationnement abusif, avec des frais qui s'ajoutent chaque jour.</p>`
            },
            {
                h2: 'Ce qui fait le prix d\'une voiture en panne',
                html: `<p>Une voiture en panne garde une valeur : celle du véhicule réparé, moins le coût de la remise en état, ou celle de ses pièces quand la réparation n'est pas raisonnable. Quatre éléments pèsent le plus :</p>
<ul class="ticks">
<li><strong>Le modèle et l'année</strong> : un modèle recherché en occasion vaut la réparation, un modèle ancien vaut surtout par ses pièces.</li>
<li><strong>La nature de la panne</strong> : un embrayage n'a pas le même coût qu'un moteur complet.</li>
<li><strong>L'état du reste</strong> : carrosserie, intérieur, pneus, historique d'entretien.</li>
<li><strong>Les papiers</strong> : carte grise à votre nom et situation administrative nette (ni gage, ni opposition).</li>
</ul>
<p>Nous communiquons une fourchette indicative au téléphone à partir de votre description, puis le prix définitif après vérification sur place. Si le véhicule correspond à ce que vous avez décrit, nous respectons le positionnement annoncé ; une panne plus grave que décrite peut le modifier.</p>`
            },
            {
                h2: 'Faut-il un contrôle technique pour vendre une voiture en panne ?',
                html: `<p>Non. Le contrôle technique de moins de six mois n'est exigé que pour la vente à un particulier. Lorsque l'acheteur est un professionnel de l'automobile, la loi ne l'impose pas : vous pouvez nous céder un véhicule dont le contrôle est expiré, refusé, ou qui ne peut matériellement plus passer au centre.</p>
<p>C'est ce qui rend la vente d'une voiture en panne à un particulier presque impossible en pratique, et la vente à un professionnel simple : un certificat de cession, la carte grise, et c'est réglé.</p>`
            }
        ],
        faqTitle: 'Vendre une voiture en panne à Paris : vos questions',
        faq: [
            { question: 'Étudiez-vous une voiture qui ne démarre plus du tout ?', answer: 'Oui, elle peut être étudiée. Précisez lors de la demande que la voiture ne démarre pas, ce que vous savez de la panne et où elle est stationnée. Selon l\'importance de la panne, une offre n\'est pas toujours possible ; si la vente est conclue, le véhicule est enlevé sur plateau ou avec le matériel adapté.' },
            { question: 'L\'enlèvement est-il payant ?', answer: 'Non. Le rendez-vous à votre adresse et, si la vente est conclue, l\'enlèvement sont à notre charge à Paris et en Île-de-France, et ne sont pas retranchés du prix.' },
            { question: 'Ma voiture est dans un parking souterrain, est-ce un problème ?', answer: 'Non, mais dites-le dès la demande : la hauteur sous plafond et la largeur de la rampe déterminent le matériel à prévoir. C\'est une situation courante en Île-de-France.' },
            { question: 'Je n\'ai plus de contrôle technique valide, puis-je vendre ?', answer: 'Oui. Le contrôle technique n\'est pas obligatoire pour vendre à un professionnel de l\'automobile. Il ne l\'est que pour une vente entre particuliers.' },
            { question: 'Combien vaut une voiture avec le moteur HS ?', answer: 'Cela dépend du modèle, de l\'année, du kilométrage et de l\'état général. Un modèle récent et recherché conserve une valeur réelle même moteur cassé ; un véhicule ancien vaut surtout par ses pièces. Nous vous donnons une fourchette indicative par téléphone après quelques questions, et le prix définitif après vérification.' },
            { question: 'Faut-il réparer avant de vendre ?', answer: 'Rarement. Sur un véhicule de plus de dix ans, le coût d\'une grosse réparation dépasse souvent le gain à la revente. Demandez une estimation en l\'état avant d\'engager des frais : elle est gratuite et vous permet de comparer.' },
            { question: 'Quels papiers faut-il pour une voiture en panne ?', answer: 'Les mêmes que pour toute vente : la carte grise à votre nom, une pièce d\'identité et un RIB. Nous préparons le certificat de cession et la déclaration de cession avec vous.' }
        ]
    },
    {
        slug: 'vendre-voiture-sans-controle-technique-paris',
        image: 'sans-ct',
        nav: 'Sans contrôle technique',
        etat: ['ct'],
        title: 'Vendre sa voiture sans CT à Paris (contrôle technique)',
        description: 'CT expiré ou refusé à Paris : vous pouvez vendre à un professionnel sans le repasser. Règles, papiers, et estimation rapide, technicien chez vous.',
        h1: 'Vendre sa voiture sans contrôle technique (CT) <em>à Paris et en Île-de-France</em>',
        updated: '2026-10-22',
        lede: 'Contrôle expiré, contre-visite jamais passée, défaillances majeures ou critiques : vous pouvez vendre votre voiture telle quelle. Entre un particulier et un professionnel de l\'automobile, le contrôle technique n\'est pas exigé.',
        points: ['CT expiré ou refusé accepté', 'Aucune réparation à avancer', 'Un technicien vient chez vous', 'Paiement par virement instantané'],
        sections: [
            {
                h2: 'Peut-on vendre sa voiture sans CT à Paris ?',
                html: `<p><strong>Oui, à un professionnel.</strong> Le contrôle technique n'est exigé que pour une vente à un particulier : pour un véhicule de plus de quatre ans, le vendeur doit alors remettre un procès-verbal de moins de six mois, ou de moins de deux mois si une contre-visite a été prescrite. Quand l'acheteur est un professionnel de l'automobile comme LUNICAR, cette obligation ne s'applique pas. Vous pouvez donc vendre à Paris une voiture dont le contrôle est expiré, refusé ou jamais passé, sans le repasser.</p>
<p>La vente reste parfaitement régulière : un certificat de cession est signé et la déclaration de cession est faite sur le site de l'ANTS, ce qui met fin à votre responsabilité à la date et à l'heure de la vente. Un technicien Lunicar vient voir la voiture à Paris, dans les Hauts-de-Seine ou les Yvelines, sans frais, et si la vente est conclue, le paiement se fait par virement instantané.</p>`
            },
            {
                h2: 'CT expiré parce que la voiture roule peu : le cas le plus fréquent à Paris',
                html: `<p>La plupart des voitures que l'on nous propose sans contrôle technique à Paris ne sont pas en mauvais état. Elles roulent simplement trop peu pour que leur propriétaire pense au contrôle : une citadine qui dort au parking de la résidence, la voiture d'un parent qui ne conduit plus, une <a href="/vendre-vieille-voiture">voiture ancienne peu roulée</a> que l'on garde par habitude. L'échéance passe, puis il faudrait sortir la voiture, prendre rendez-vous dans un centre et payer un contrôle pour une voiture qu'on veut vendre.</p>
<p>Dans ce cas, inutile de repasser le contrôle avant de nous la vendre. Décrivez-la telle qu'elle est (date du dernier contrôle si vous la connaissez, kilométrage, entretien) : l'estimation tient compte de son état réel, pas de l'absence du document.</p>`
            },
            {
                h2: 'Ce que dit la règle',
                html: `<p>Pour vendre à un <strong>particulier</strong> une voiture de plus de quatre ans, le vendeur doit remettre un procès-verbal de contrôle technique de moins de six mois, ou de moins de deux mois si une contre-visite a été prescrite. Sans ce document, l'acheteur ne peut pas faire établir la carte grise à son nom.</p>
<p>Pour vendre à un <strong>professionnel de l'automobile</strong>, cette obligation ne s'applique pas. Vous pouvez nous céder un véhicule dont le contrôle est expiré depuis des années, qui a été refusé, ou qui n'a jamais été présenté. La vente est parfaitement régulière : certificat de cession signé, déclaration de cession enregistrée, et votre responsabilité s'arrête à la date et à l'heure de la cession.</p>`
            },
            {
                h2: 'Dans quels cas vend-on sans contrôle technique ?',
                html: `<ul class="ticks">
<li><strong>Le contrôle est simplement arrivé à échéance</strong> parce que la voiture ne roule presque plus.</li>
<li><strong>Le contrôle a été refusé</strong> et le devis de remise en conformité dépasse ce que vous voulez investir dans la voiture.</li>
<li><strong>La contre-visite n'a pas été faite</strong> dans les deux mois et il faudrait tout repasser.</li>
<li><strong>Le véhicule ne roule plus</strong> : impossible de l'amener au centre.</li>
<li><strong>La voiture n'est plus assurée</strong> ou stationne depuis longtemps, et vous voulez en finir sans frais supplémentaires.</li>
<li><strong>Vous vendez pour le compte d'un proche</strong>, dans le cadre d'une succession par exemple, et vous ne connaissez pas l'état réel du véhicule.</li>
</ul>
<p>Dans toutes ces situations, passer un contrôle avant de vendre revient à payer pour apprendre ce qui ne va pas. Une estimation en l'état vous évite cette dépense.</p>`
            },
            {
                h2: 'Faut-il quand même passer le contrôle pour vendre plus cher ?',
                html: `<p>Si la voiture est saine et que le contrôle est simplement arrivé à échéance, un contrôle favorable peut justifier un prix plus élevé auprès d'un particulier, au prix de quelques semaines d'annonce et de visites. Si vous savez que le contrôle sera défavorable, le calcul s'inverse : contrôle, réparations, contre-visite, puis vente. Sur une voiture de plus de dix ans, la somme dépasse fréquemment la différence de prix obtenue.</p>
<p>Notre conseil : demandez d'abord une estimation sans contrôle. Elle ne coûte rien et vous donne un point de comparaison concret avant de dépenser quoi que ce soit.</p>`
            },
            {
                h2: 'Les papiers nécessaires',
                html: `<p>La carte grise à votre nom, une pièce d'identité, un RIB. Si vous possédez un ancien procès-verbal de contrôle, même défavorable, apportez-le : il nous renseigne sur l'état du véhicule, il ne le disqualifie pas. Nous nous chargeons du certificat de cession et de la déclaration sur le site de l'ANTS.</p>`
            }
        ],
        faqTitle: 'Vendre sans contrôle technique : vos questions',
        faq: [
            { question: 'Est-il légal de vendre une voiture sans contrôle technique ?', answer: 'Oui, lorsque l\'acheteur est un professionnel de l\'automobile. L\'obligation de fournir un contrôle de moins de six mois ne concerne que la vente à un particulier.' },
            { question: 'Mon contrôle technique est expiré depuis deux ans, est-ce un problème ?', answer: 'Non. La date d\'expiration n\'a pas d\'incidence sur la possibilité de nous vendre le véhicule. Elle est seulement prise en compte, avec l\'état général, dans l\'estimation.' },
            { question: 'Le contrôle mentionne une défaillance critique, pouvez-vous l\'étudier ?', answer: 'Oui. Une défaillance critique interdit de circuler au-delà du jour du contrôle, mais n\'interdit pas de vendre à un professionnel. Un technicien Lunicar vient voir le véhicule sur place ; selon la gravité des défauts, une offre n\'est pas toujours possible.' },
            { question: 'Puis-je vendre sans contrôle technique à un particulier en le précisant sur l\'annonce ?', answer: 'Non pour un véhicule de plus de quatre ans : même avec l\'accord de l\'acheteur, celui-ci ne pourra pas immatriculer le véhicule à son nom sans procès-verbal valide. Seule la vente à un professionnel échappe à cette règle.' },
            { question: 'Le prix est-il fortement réduit sans contrôle technique ?', answer: 'Le prix reflète l\'état réel du véhicule, pas l\'absence du document. Une voiture saine dont le contrôle est simplement arrivé à échéance n\'est pas dévalorisée comme une voiture refusée pour corrosion ou freinage.' },
            { question: 'Sous quel délai pouvez-vous venir ?', answer: 'Après votre demande, un conseiller vous rappelle rapidement avec une fourchette indicative. Si elle vous convient, le rendez-vous avec un technicien Lunicar est fixé selon vos disponibilités, à Paris ou dans votre commune d\'Île-de-France.' }
        ]
    },
    {
        slug: 'rachat-voiture-accidentee-paris',
        image: 'accidentee',
        nav: 'Voiture accidentée',
        etat: ['accident'],
        title: 'Rachat voiture accidentée à Paris et en IDF | LUNICAR',
        description: 'Voiture accidentée ou déclarée économiquement irréparable à Paris et en IDF : LUNICAR l\'étudie selon les dommages, sans promesse d\'offre, sans engagement.',
        h1: 'Rachat de voiture accidentée <em>à Paris et en Île-de-France</em>',
        lede: 'Choc avant, aile enfoncée, airbags déclenchés, véhicule classé économiquement irréparable par l\'expert : nous étudions le véhicule dans son état actuel. Décrivez les dommages ; selon leur gravité, une offre n\'est pas toujours possible.',
        points: ['Dommages légers ou lourds étudiés', 'Véhicule non roulant étudié', 'Enlèvement offert si vente conclue', 'Paiement par virement instantané'],
        sections: [
            {
                h2: 'Les véhicules accidentés que nous pouvons étudier',
                html: `<ul class="ticks">
<li><strong>Dommages de carrosserie</strong> : pare-chocs, ailes, portières, capot, vitrages, rayures profondes.</li>
<li><strong>Chocs structurels</strong> : longeron, train avant, berceau, véhicule qui tire ou dont la géométrie est faussée.</li>
<li><strong>Airbags déclenchés</strong>, dont le remplacement coûte souvent plus cher que la carrosserie.</li>
<li><strong>Dégâts des eaux et incendie partiel</strong>, à signaler précisément lors de la demande.</li>
<li><strong>Véhicules accidentés non assurés tous risques</strong>, pour lesquels aucune indemnisation n'est prévue.</li>
</ul>
<p>Chaque dossier est examiné individuellement : selon la gravité des dommages, une offre n'est pas toujours possible. Quelques photos des dégâts, prises de près et de loin, nous permettent de vous donner une fourchette beaucoup plus précise dès le premier appel.</p>`
            },
            {
                h2: 'Votre assurance a classé le véhicule : ce qu\'il faut savoir',
                html: `<p>Après un sinistre, l'expert mandaté par l'assurance peut déclarer le véhicule <strong>économiquement irréparable</strong> lorsque le coût des réparations dépasse sa valeur avant l'accident. L'assureur vous propose alors de lui céder le véhicule contre une indemnisation.</p>
<p>Vous restez libre de refuser cette offre et de conserver le véhicule. Dans ce cas, vous ne pouvez le vendre qu'à un professionnel de l'automobile, pour réparation ou pour destruction : la vente à un particulier n'est plus possible tant que le véhicule n'a pas été réparé et contrôlé par un expert. Nous pouvons étudier ce type de véhicule.</p>
<p class="note">Avant de répondre à votre assureur, demandez-nous une estimation : vous saurez si conserver le véhicule pour le vendre vous-même est plus intéressant que l'indemnisation proposée.</p>`
            },
            {
                h2: 'Réparer avant de vendre, ou vendre en l\'état ?',
                html: `<p>Pour un dommage léger sur un véhicule récent, la réparation se justifie souvent. Pour un choc important, trois éléments jouent contre vous : le devis de carrosserie, le délai d'immobilisation, et la décote qui subsiste sur un véhicule dont l'historique mentionne un sinistre. Vendre en l'état vous évite d'avancer la réparation sans garantie de la récupérer à la revente.</p>`
            },
            {
                h2: 'L\'enlèvement en région parisienne',
                html: `<p>Le technicien Lunicar examine le véhicule là où il se trouve, et si la vente est conclue, il est récupéré sur place : à votre domicile, dans un parking, chez le carrossier, ou dans le garage où il a été remorqué après l'accident. Si des frais de gardiennage courent chaque jour, précisez-le : nous en tenons compte pour fixer le rendez-vous au plus tôt.</p>`
            }
        ],
        faqTitle: 'Vendre une voiture accidentée : vos questions',
        faq: [
            { question: 'Étudiez-vous une voiture accidentée qui ne roule plus ?', answer: 'Oui, elle peut être étudiée, à Paris comme dans toute l\'Île-de-France. Selon la gravité des dommages, une offre n\'est pas toujours possible. Si la vente est conclue, le véhicule est enlevé sur place avec le matériel adapté, à notre charge.' },
            { question: 'Mon véhicule est classé économiquement irréparable, puis-je vous le vendre ?', answer: 'Il peut être étudié. Si vous refusez l\'offre de votre assureur et conservez le véhicule, la loi vous autorise à le céder à un professionnel de l\'automobile ; la vente à un particulier, elle, n\'est pas possible en l\'état. Selon l\'étendue des dommages, nous ne pouvons pas toujours faire d\'offre.' },
            { question: 'Faut-il un constat ou un rapport d\'expertise ?', answer: 'Ce n\'est pas obligatoire. Si vous disposez du rapport de l\'expert ou d\'un devis de réparation, transmettez-le : il permet une estimation plus précise.' },
            { question: 'Comment est calculé le prix d\'une voiture accidentée ?', answer: 'À partir de la valeur du véhicule avant sinistre, de l\'étendue des dommages et de ce qui reste valorisable : mécanique saine, pièces, équipements. Un modèle récent accidenté à l\'arrière avec un moteur intact conserve une valeur significative.' },
            { question: 'Ma voiture est immobilisée chez un garagiste qui facture le gardiennage, que faire ?', answer: 'Indiquez-le dans votre demande. Le technicien peut examiner le véhicule chez le garagiste et, si la vente est conclue, nous organisons l\'enlèvement sur place, avec votre accord écrit si vous ne pouvez pas être présent.' },
            { question: 'Faut-il un contrôle technique ?', answer: 'Non. Pour une vente à un professionnel, le contrôle technique n\'est pas exigé, quel que soit l\'état du véhicule.' }
        ]
    },
    {
        slug: 'rachat-utilitaire-paris',
        image: 'utilitaire',
        nav: 'Utilitaire',
        etat: [],
        title: 'Rachat utilitaire à Paris et en Île-de-France | LUNICAR',
        description: 'Fourgon, fourgonnette ou camionnette à Paris et en IDF : LUNICAR étudie votre utilitaire, y compris à fort kilométrage. Estimation rapide.',
        h1: 'Rachat d\'utilitaire <em>à Paris et en Île-de-France</em>',
        lede: 'Kangoo, Partner, Berlingo, Trafic, Master, Sprinter, Jumpy, Transit : nous étudions les utilitaires d\'artisans, de commerçants et de particuliers, y compris très kilométrés, aménagés ou immobilisés.',
        points: ['Fort kilométrage étudié', 'Artisans, sociétés, particuliers', 'Avec ou sans contrôle technique', 'Paiement par virement instantané'],
        sections: [
            {
                h2: 'Les utilitaires que nous étudions',
                html: `<ul class="ticks">
<li><strong>Fourgonnettes</strong> : Renault Kangoo, Citroën Berlingo, Peugeot Partner, Volkswagen Caddy, Fiat Doblo, Dacia Dokker.</li>
<li><strong>Fourgons compacts</strong> : Renault Trafic, Peugeot Expert, Citroën Jumpy, Ford Transit Custom, Mercedes Vito, Volkswagen Transporter.</li>
<li><strong>Grands fourgons</strong> : Renault Master, Peugeot Boxer, Citroën Jumper, Fiat Ducato, Mercedes Sprinter, Iveco Daily.</li>
<li><strong>Carrosseries spécifiques</strong> : bennes, plateaux, caisses, frigorifiques, véhicules aménagés atelier.</li>
</ul>
<p>Un utilitaire travaille : 250 000 km, une porte latérale fatiguée ou un plancher marqué n'empêchent pas l'étude. Décrivez l'usage et l'entretien, c'est ce qui compte le plus.</p>`
            },
            {
                h2: 'Vous êtes artisan ou dirigeant de société',
                html: `<p>La cession d'un véhicule inscrit à l'actif de l'entreprise demande quelques documents de plus : un extrait Kbis récent, la carte grise au nom de la société, et la pièce d'identité du représentant légal ou un pouvoir signé de sa main. Nous établissons les documents de cession au nom de l'entreprise pour votre comptabilité.</p>
<p>Cessation d'activité, renouvellement de flotte, véhicule de remplacement devenu inutile : plusieurs véhicules peuvent être examinés lors du même rendez-vous.</p>`
            },
            {
                h2: 'Utilitaire en panne ou sans contrôle technique',
                html: `<p>Un utilitaire immobilisé coûte chaque jour : il occupe une place, il ne produit rien, et son contrôle technique annuel finit par expirer. Injection, boîte de vitesses, embrayage, turbo : décrivez la panne, nous étudions le véhicule en l'état ; selon son importance, une offre n'est pas toujours possible. Si la vente est conclue, il est enlevé sur place, sur un chantier, dans un dépôt ou devant votre local.</p>`
            }
        ],
        faqTitle: 'Vendre un utilitaire : vos questions',
        faq: [
            { question: 'Étudiez-vous les utilitaires de plus de 250 000 km ?', answer: 'Oui. Sur un utilitaire, le kilométrage compte moins que l\'entretien et l\'état de la mécanique. Nous étudions le véhicule quel que soit le compteur.' },
            { question: 'Quels documents pour vendre un véhicule de société ?', answer: 'La carte grise au nom de la société, un extrait Kbis de moins de trois mois, la pièce d\'identité du représentant légal et, si une autre personne signe, un pouvoir. Un RIB de l\'entreprise pour le virement.' },
            { question: 'Fournissez-vous un justificatif pour la comptabilité ?', answer: 'Oui. Le certificat de cession est établi au nom de l\'entreprise, accompagné d\'un justificatif de la transaction et de la preuve de virement.' },
            { question: 'Reprenez-vous un utilitaire avec un aménagement intérieur ?', answer: 'Oui. Étagères, galerie, attelage, habillage bois : indiquez les équipements, certains valorisent le véhicule.' },
            { question: 'Mon utilitaire ne roule plus, pouvez-vous venir le voir ?', answer: 'Oui, un technicien Lunicar vient l\'examiner sur place à Paris et en Île-de-France. Selon la panne, une offre n\'est pas toujours possible ; si la vente est conclue, l\'enlèvement est à notre charge.' },
            { question: 'Pouvez-vous étudier plusieurs véhicules à la fois ?', answer: 'Oui. Précisez le nombre et le type de véhicules dans votre demande ou par téléphone, nous organisons un rendez-vous unique.' }
        ]
    }
];

function situationBySlug(slug) { return SITUATIONS.find(s => s.slug === slug); }

module.exports = { DEPARTMENTS, PARIS, HUB_SLUG, SITUATIONS, deptBySlug, deptByName, deptByCode, isIdf, situationBySlug };
