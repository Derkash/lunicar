/**
 * LUNICAR - Gabarit commun et composants rendus côté serveur.
 *
 * Toutes les pages publiques passent par page() : un seul <head>, un seul
 * en-tête, un seul pied de page, un seul formulaire de demande. Plus aucun
 * contenu n'est injecté côté client.
 */

const { SITE, esc, jsonLd } = require('./config');

// ---------- Pictogrammes maison (tracés simples, aucun jeu d'icônes tiers) ----------

const ICONS = {
    check: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    phone: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.2 2.5h2.6l1.3 3.6-1.8 1.3a9 9 0 0 0 5.3 5.3l1.3-1.8 3.6 1.3v2.6a1.7 1.7 0 0 1-1.9 1.7C9 16 4 11 3.5 4.4a1.7 1.7 0 0 1 1.7-1.9z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    chat: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.6a7.3 7.3 0 0 0-6.2 11.1L3 17.2l3.6-.8A7.3 7.3 0 1 0 10 2.6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M7.4 8.2c.2 1.9 1.9 3.6 3.9 4l1.1-1.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    arrow: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    camera: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6.5h3l1.4-2h5.2l1.4 2h3v9.5H3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="10" cy="11" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
    image: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 14l4.5-4.5 3.5 3.5 2-2 4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="13.5" cy="7.5" r="1.4" fill="currentColor"/></svg>'
};

// Pictogrammes des réseaux, dessinés au trait comme les autres icônes du site (pas de bibliothèque).
const SOCIAL_ICONS = {
    youtube: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="4.5" width="16" height="11" rx="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.4 7.6v4.8l4.2-2.4z" fill="currentColor"/></svg>',
    instagram: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="4" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="10" cy="10" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="14.2" cy="5.8" r="1" fill="currentColor"/></svg>',
    linkedin: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="15" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6.6 9v5M6.6 6.3v.1M9.6 14V9m0 2.4c0-1.4 1-2.4 2.2-2.4s2 .8 2 2.3V14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    facebook: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M11.2 17.4v-6.2h2l.3-2.3h-2.3V7.6c0-.7.2-1.1 1.1-1.1h1.3V4.5a14 14 0 0 0-1.9-.1c-1.9 0-3 1.1-3 3.1v1.4H6.8v2.3h1.9v6.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    tiktok: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 3v9.4a2.9 2.9 0 1 1-2.6-2.9M11 3c.3 2.2 1.8 3.7 4 3.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    trustpilot: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.8l2.1 4.6 5 .5-3.8 3.4 1.1 4.9L10 13.7l-4.4 2.5 1.1-4.9L2.9 7.9l5-.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>'
};

// Liens vers les comptes officiels (SITE.social) : « me » indique aux moteurs que ce sont bien nos profils.
function socialLinks(cls = 'social-links') {
    const list = SITE.social || [];
    if (!list.length) return '';
    return `<ul class="${cls}">${list.map(r => `<li><a href="${r.url}" rel="me noopener" target="_blank" aria-label="LUNICAR sur ${r.nom}">${SOCIAL_ICONS[r.cle] || ''}<span>${r.nom}</span></a></li>`).join('')}</ul>`;
}

// Logo officiel (kit octobre 2026) : version marine pour fonds clairs, version blanche pour fonds sombres.
const LOGO = (blanc = false) => `<img class="logo-img" src="/images/logo-lunicar${blanc ? '-blanc' : ''}.webp?v=${SITE.assetVersion}" width="556" height="120" alt="LUNICAR">`;

// ---------- En-tête / pied ----------

const NAV = [
    // Doublon du bouton « Estimation gratuite » : affiché seulement dans le menu replié, où ce bouton est masqué.
    { href: '/reprise', label: 'Estimation', menuOnly: true },
    { href: '/comment-ca-marche', label: 'Comment ça marche' },
    { href: '/reprise-voiture-occasion', label: 'Toutes les voitures' },
    { href: '/rachat-voiture-france', label: 'Partout en France' },
    { href: '/rachat-voiture-ile-de-france', label: 'Île-de-France' },
    { href: '/articles', label: 'Conseils' },
    { href: '/a-propos', label: 'Qui sommes-nous' }
];

function phoneLink(cls, label) {
    if (!SITE.phone) return '';
    return `<a class="${cls}" href="tel:+${SITE.phone.intl}" data-track="appel">${ICONS.phone}<span>${label || SITE.phone.display}</span></a>`;
}

function whatsappLink(cls, label) {
    if (!SITE.whatsapp) return '';
    const text = encodeURIComponent('Bonjour, je souhaite faire estimer ma voiture.');
    return `<a class="${cls}" href="https://wa.me/${SITE.whatsapp.intl}?text=${text}" rel="noopener" data-track="whatsapp">${ICONS.chat}<span>${label || 'WhatsApp'}</span></a>`;
}

function header(path, hasForm) {
    const cta = hasForm ? '#estimation' : '/reprise';
    return `
<header class="site-header">
    <div class="wrap site-header-in">
        <a href="/" class="logo" aria-label="LUNICAR, accueil">${LOGO()}</a>
        <nav class="site-nav" id="siteNav" aria-label="Navigation principale">
            ${NAV.map(n => `<a href="${n.href}"${n.menuOnly ? ' class="nav-menu-only"' : ''}${n.href === path ? ' aria-current="page"' : ''}>${n.label}</a>`).join('')}
        </nav>
        <div class="site-header-actions">
            <a href="${cta}" class="btn btn-gold btn-sm">Estimation gratuite</a>
            <button class="nav-toggle" aria-label="Ouvrir le menu" aria-controls="siteNav" aria-expanded="false"><span></span><span></span><span></span></button>
        </div>
    </div>
</header>`;
}

function footer() {
    const year = new Date().getFullYear();
    return `
<footer class="site-footer">
    <div class="wrap">
        <div class="footer-grid">
            <div class="footer-brand">
                <a href="/" class="logo" aria-label="LUNICAR, accueil">${LOGO(true)}</a>
                <p>Rachat de voitures toutes marques, récentes ou non, aux particuliers et aux professionnels, partout en France. Estimation indicative rapide, technicien Lunicar à votre adresse sans frais, virement instantané à la vente, démarches prises en charge.</p>
                <p class="footer-contact">
                    ${phoneLink('footer-link')}
                    <a class="footer-link" href="mailto:${SITE.email}">${SITE.email}</a>
                    <span>${SITE.hours}</span>
                </p>
                ${SITE.social && SITE.social.length ? `<div class="footer-social"><p>Suivez-nous</p>${socialLinks()}</div>` : ''}
            </div>
            <nav aria-label="Île-de-France">
                <h2>Île-de-France</h2>
                <ul>
                    <li><a href="/rachat-voiture-ile-de-france">Rachat voiture Île-de-France</a></li>
                    <li><a href="/reprise-auto-paris">Paris (75)</a></li>
                    <li><a href="/rachat-voiture-hauts-de-seine-92">Hauts-de-Seine (92)</a></li>
                    <li><a href="/rachat-voiture-seine-saint-denis-93">Seine-Saint-Denis (93)</a></li>
                    <li><a href="/rachat-voiture-val-de-marne-94">Val-de-Marne (94)</a></li>
                    <li><a href="/rachat-voiture-val-d-oise-95">Val-d'Oise (95)</a></li>
                    <li><a href="/rachat-voiture-essonne-91">Essonne (91)</a></li>
                    <li><a href="/rachat-voiture-yvelines-78">Yvelines (78)</a></li>
                    <li><a href="/rachat-voiture-seine-et-marne-77">Seine-et-Marne (77)</a></li>
                </ul>
            </nav>
            <nav aria-label="Votre voiture">
                <h2>Votre voiture</h2>
                <ul>
                    <li><a href="/reprise-voiture-occasion">Toutes marques, tous modèles</a></li>
                    <li><a href="/reprise-voiture-electrique">Électrique ou hybride</a></li>
                    <li><a href="/reprise-voiture-diesel">Diesel</a></li>
                    <li><a href="/reprise-voiture-haut-kilometrage">Fort kilométrage</a></li>
                    <li><a href="/rachat-vehicule-utilitaire">Utilitaire</a></li>
                    <li><a href="/vendre-vieille-voiture">Voiture ancienne</a></li>
                    <li><a href="/vendre-voiture-sans-controle-technique-paris">Sans CT à Paris</a></li>
                    <li><a href="/rachat-voiture-sans-controle-technique">Sans contrôle technique</a></li>
                    <li><a href="/rachat-voiture-rapide">Vendre vite</a></li>
                </ul>
            </nav>
            <nav aria-label="Communes">
                <h2>Communes</h2>
                <ul>
                    <li><a href="/reprise-auto-versailles">Versailles</a></li>
                    <li><a href="/reprise-auto-saint-germain-en-laye">Saint-Germain-en-Laye</a></li>
                    <li><a href="/reprise-auto-le-chesnay">Le Chesnay-Rocquencourt</a></li>
                    <li><a href="/reprise-auto-boulogne-billancourt">Boulogne-Billancourt</a></li>
                    <li><a href="/reprise-auto-neuilly-sur-seine">Neuilly-sur-Seine</a></li>
                    <li><a href="/reprise-auto-nanterre">Nanterre</a></li>
                    <li><a href="/reprise-auto-rueil-malmaison">Rueil-Malmaison</a></li>
                    <li><a href="/reprise-auto-issy-les-moulineaux">Issy-les-Moulineaux</a></li>
                    <li><a href="/rachat-voiture-france">Partout en France</a></li>
                </ul>
            </nav>
            <nav aria-label="LUNICAR">
                <h2>LUNICAR</h2>
                <ul>
                    <li><a href="/reprise">Faire estimer ma voiture</a></li>
                    <li><a href="/comment-ca-marche">Comment fonctionne Lunicar</a></li>
                    <li><a href="/a-propos">Qui sommes-nous</a></li>
                    <li><a href="/garanties">Nos engagements</a></li>
                    <li><a href="/comparatif-reprise-auto">Comparer les solutions</a></li>
                    <li><a href="/chiffres-cles-vente-voiture-occasion">Chiffres clés de l'occasion</a></li>
                    <li><a href="/articles">Conseils</a></li>
                    <li><a href="/contact">Contact</a></li>
                    <li><a href="/mentions-legales">Mentions légales</a></li>
                    <li><a href="/politique-confidentialite">Confidentialité</a></li>
                </ul>
            </nav>
        </div>
        <p class="footer-legal">© ${year} LUNICAR · <a href="/mentions-legales">Mentions légales</a> · Tous droits réservés.</p>
    </div>
</footer>`;
}

// Barre d'action fixe en bas d'écran sur mobile : le formulaire seul (décision du 2026-10-17 :
// le numéro n'est jamais mis en avant, il reste au pied de page et sur la page Contact).
function ctaBar(hasForm) {
    const target = hasForm ? '#estimation' : '/reprise';
    return `
<div class="cta-bar" id="ctaBar">
    <a class="cta-bar-btn cta-bar-main" href="${target}">Mon estimation gratuite</a>
</div>`;
}

// ---------- Formulaire de demande (2 étapes, coordonnées en 3 champs) ----------

const BRANDS = ['Renault', 'Peugeot', 'Citroën', 'Dacia', 'Volkswagen', 'Toyota', 'Ford', 'Opel', 'BMW', 'Mercedes', 'Audi', 'Fiat', 'Nissan', 'Hyundai', 'Kia', 'Seat', 'Skoda', 'Mini', 'Volvo', 'Suzuki', 'Honda', 'Mazda', 'Tesla', 'DS', 'Jeep', 'Land Rover', 'Mitsubishi', 'Smart', 'Alfa Romeo', 'Porsche', 'MG', 'Cupra', 'Lexus', 'Jaguar', 'Chevrolet', 'Iveco'];

function yearOptions() {
    const now = new Date().getFullYear();
    let out = '<option value="">Année</option>';
    for (let y = now; y >= 1995; y--) out += `<option>${y}</option>`;
    return out + '<option value="avant 1995">Avant 1995</option>';
}

/**
 * Formulaire progressif : une question à la fois, les réponses restent visibles
 * au-dessus, une jauge indique l'avancement (modèle des grands acheteurs en ligne).
 *
 * opts.title   : titre de la carte
 * opts.etat    : cases précochées parmi 'panne', 'accident', 'ct'
 * opts.cp      : code postal prérempli (pages villes)
 * opts.source  : libellé de la page d'origine, transmis avec la demande
 */
function leadForm(opts = {}) {
    const etat = opts.etat || [];
    const chip = (value, label) => `<label class="chip"><input type="checkbox" name="etat" value="${value}"${etat.includes(value) ? ' checked' : ''}><span>${label}</span></label>`;
    const choice = (name, value, label, checked) => `<label class="choice"><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''}><span>${label}</span></label>`;
    const multi = (name, items) => `<div class="chips">${items.map(([v, l]) => `<label class="chip"><input type="checkbox" name="${name}" value="${v}"><span>${l}</span></label>`).join('')}</div>`;
    const ok = (label = 'Continuer') => `<button type="button" class="btn btn-gold btn-block" data-ok>${label} ${ICONS.arrow}</button>`;
    const direct = '';
    return `
<div class="lead" id="estimation">
    <form class="lead-form" id="leadForm" novalidate data-source="${esc(opts.source || '')}">
        <div class="lead-head">
            <p class="lead-title">${opts.title || 'Faites estimer votre voiture'}</p>
            <p class="lead-sub">Gratuit, sans engagement. Nous intervenons partout en France, sans frais.</p>
            <div class="lead-meter" aria-hidden="true"><span class="lead-meter-bar"><i></i></span><span class="lead-meter-pct">0 %</span></div>
        </div>

        <div class="q on" data-q="vehicule">
            <p class="q-label">Votre véhicule</p>
            <label class="field">
                <span class="field-label">Immatriculation <em>facultatif, remplit le reste pour vous</em></span>
                <span class="plate"><span class="plate-eu">F</span><input id="leadPlate" type="text" name="plaque" inputmode="text" autocomplete="off" autocapitalize="characters" maxlength="10" placeholder="AB-123-CD" aria-describedby="plateInfo"></span>
                <span class="plate-info" id="plateInfo" aria-live="polite" hidden></span>
            </label>
            <input type="hidden" name="fiche">
            <label class="field">
                <span class="field-label">Marque et modèle</span>
                <input class="q-input" id="leadVehicule" type="text" name="vehicule" list="brandList" required placeholder="Ex. Peugeot 308" autocomplete="off"${opts.vehicule ? ` value="${esc(opts.vehicule)}"` : ''}>
                <datalist id="brandList">${BRANDS.map(b => `<option value="${b} ">`).join('')}</datalist>
            </label>
            <div class="field-row">
                <label class="field">
                    <span class="field-label">Année</span>
                    <select class="q-input" id="leadAnnee" name="annee" required>${yearOptions()}</select>
                </label>
                <label class="field">
                    <span class="field-label">Kilométrage</span>
                    <span class="money"><input id="leadKm" type="text" name="kilometrage" inputmode="numeric" required placeholder="120 000" maxlength="9"><span>km</span></span>
                </label>
            </div>
            <p class="q-warn" hidden>Ce kilométrage semble inhabituel pour l'année indiquée. Vérifiez-le, puis continuez.</p>
            ${ok()}
        </div>

        <div class="q" data-q="mecanique">
            <p class="q-label">Dans quel état mécanique est-elle ?</p>
            <div class="choices choices-1" data-required>
                ${choice('mecanique', 'ok', 'Elle roule, aucun souci')}
                ${choice('mecanique', 'soucis', 'Elle roule mais a des soucis mécaniques')}
                ${choice('mecanique', 'panne', 'Ne roule plus (en panne)', etat.includes('panne'))}
                ${choice('mecanique', 'accident', 'Accidentée', etat.includes('accident'))}
            </div>
            ${etat.includes('panne') || etat.includes('accident') ? ok() : ''}
        </div>

        <div class="q" data-q="soucis" data-if="mecanique=soucis">
            <p class="q-label">Qu'est-ce qui pose problème ? <em>plusieurs choix possibles</em></p>
            ${multi('organes', [['moteur', 'Moteur'], ['boite', 'Boîte de vitesses'], ['embrayage', 'Embrayage'], ['freins', 'Freins'], ['direction', 'Direction'], ['suspensions', 'Suspensions'], ['clim', 'Climatisation'], ['autre', 'Autre / je ne sais pas']])}
            ${ok()}
        </div>

        <div class="q" data-q="panne" data-if="mecanique=panne">
            <p class="q-label">Quelle est la nature de la panne ?</p>
            <div class="choices" data-required>
                ${choice('panne', 'moteur', 'Moteur')}
                ${choice('panne', 'turbo', 'Turbo')}
                ${choice('panne', 'boite', 'Boîte de vitesses')}
                ${choice('panne', 'embrayage', 'Embrayage')}
                ${choice('panne', 'distribution', 'Distribution')}
                ${choice('panne', 'culasse', 'Joint de culasse')}
                ${choice('panne', 'demarreur', 'Démarreur / batterie')}
                ${choice('panne', 'autre', 'Autre ou inconnue')}
            </div>
            <p class="q-label q-label-2">Peut-elle se déplacer sans dépanneuse ?</p>
            <div class="choices choices-3" data-required>
                ${choice('deplacable', 'oui', 'Oui')}
                ${choice('deplacable', 'non', 'Non')}
                ${choice('deplacable', 'nsp', 'Je ne sais pas')}
            </div>
            ${ok()}
        </div>

        <div class="q" data-q="voyant" data-if="mecanique=ok,soucis">
            <p class="q-label">Un voyant reste-t-il allumé au tableau de bord ?</p>
            <div class="choices choices-3" data-required>
                ${choice('voyant', 'non', 'Non')}
                ${choice('voyant', 'oui', 'Oui')}
                ${choice('voyant', 'nsp', 'Je ne sais pas')}
            </div>
        </div>

        <div class="q" data-q="carrosserie" data-if="mecanique=ok,soucis">
            <p class="q-label">Dans quel état est la carrosserie ?</p>
            <div class="choices choices-1" data-required>
                ${choice('carrosserie', 'tbe', 'Très bon état')}
                ${choice('carrosserie', 'rayures', 'Quelques rayures ou petits chocs')}
                ${choice('carrosserie', 'abimee', 'Carrosserie abîmée')}
            </div>
        </div>

        <div class="q" data-q="degats" data-if="carrosserie=rayures,abimee">
            <p class="q-label">Quels défauts sur la carrosserie ? <em>plusieurs choix possibles</em></p>
            ${multi('degats', [['rayures', 'Rayures'], ['bosses', 'Bosses'], ['rouille', 'Rouille'], ['impacts', 'Éclats, impacts'], ['grele', 'Grêle'], ['parebrise', 'Pare-brise fissuré'], ['parechocs', 'Pare-chocs abîmé']])}
            ${ok()}
        </div>

        <div class="q" data-q="ct">
            <p class="q-label">Le contrôle technique est-il à jour ?</p>
            <div class="choices choices-1" data-required>
                ${choice('ct', 'oui6', 'Oui, passé il y a moins de 6 mois')}
                ${choice('ct', 'oui', 'Oui, passé il y a plus de 6 mois')}
                ${choice('ct', 'non', 'Non, expiré ou jamais passé', etat.includes('ct'))}
                ${choice('ct', 'nsp', 'Je ne sais pas')}
            </div>
            ${etat.includes('ct') ? ok() : ''}
        </div>

        <div class="q" data-q="historique">
            <p class="q-label">Combien de clés avez-vous ?</p>
            <div class="choices choices-3" data-required>
                ${choice('cles', '1', '1 clé')}
                ${choice('cles', '2', '2 clés ou plus')}
                ${choice('cles', '0', 'Aucune')}
            </div>
            <p class="q-label q-label-2">Avez-vous le carnet d'entretien ou les factures ?</p>
            <div class="choices choices-3" data-required>
                ${choice('carnet', 'oui', 'Oui')}
                ${choice('carnet', 'partiel', 'En partie')}
                ${choice('carnet', 'non', 'Non')}
            </div>
            <p class="q-label q-label-2">Êtes-vous le premier propriétaire ?</p>
            <div class="choices choices-3" data-required>
                ${choice('premiere_main', 'oui', 'Oui')}
                ${choice('premiere_main', 'non', 'Non')}
                ${choice('premiere_main', 'nsp', 'Je ne sais pas')}
            </div>
            <p class="q-label q-label-2">La voiture a-t-elle été importée de l'étranger ?</p>
            <div class="choices choices-3" data-required>
                ${choice('importee', 'non', 'Non')}
                ${choice('importee', 'oui', 'Oui')}
                ${choice('importee', 'nsp', 'Je ne sais pas')}
            </div>
            <p class="q-label q-label-2">Un crédit, une LOA ou une LLD est-il en cours ?</p>
            <div class="choices choices-3" data-required>
                ${choice('financement', 'non', 'Non')}
                ${choice('financement', 'oui', 'Oui')}
                ${choice('financement', 'nsp', 'Je ne sais pas')}
            </div>
            ${ok()}
        </div>

        <div class="q" data-q="delai">
            <p class="q-label">Quand souhaitez-vous la vendre ?</p>
            <div class="choices" data-required>
                ${choice('delai', 'vite', 'Le plus vite possible')}
                ${choice('delai', 'mois', 'Dans le mois')}
                ${choice('delai', '3mois', 'Dans les 3 mois')}
                ${choice('delai', 'info', 'Je me renseigne')}
            </div>
        </div>

        <div class="q" data-q="achat">
            <p class="q-label">Prévoyez-vous d'acheter une autre voiture ?</p>
            <div class="choices choices-3" data-required>
                ${choice('achat', 'oui', 'Oui')}
                ${choice('achat', 'deja', 'C\'est déjà fait')}
                ${choice('achat', 'non', 'Non')}
            </div>
        </div>

        <div class="q" data-q="prix">
            <label class="q-label" for="leadPrix">Avez-vous un prix en tête ? <em>facultatif</em></label>
            <span class="money"><input id="leadPrix" type="text" name="prix" inputmode="numeric" placeholder="Ex. 4 500" maxlength="9"><span>€</span></span>
            ${ok()}
            <button type="button" class="q-skip" data-skip>Je préfère votre estimation</button>
        </div>

        <div class="q" data-q="identite">
            <p class="q-label">À quel nom établir l'estimation ?</p>
            <div class="field-row">
                <label class="field"><span class="field-label">Prénom</span><input type="text" name="prenom" required autocomplete="given-name"></label>
                <label class="field"><span class="field-label">Nom</span><input type="text" name="nom" required autocomplete="family-name"></label>
            </div>
            ${ok()}
        </div>

        <div class="q" data-q="contact">
            <p class="q-label">Où vous joindre avec votre estimation ?</p>
            <div class="field-row">
                <label class="field"><span class="field-label">Téléphone</span><input type="tel" name="telephone" required autocomplete="tel" inputmode="tel" placeholder="06 …"></label>
                <label class="field field-cp"><span class="field-label">Code postal</span><input type="text" name="codePostal" required inputmode="numeric" maxlength="5" autocomplete="postal-code" value="${esc(opts.cp || '')}" placeholder="75011"></label>
            </div>
            <div class="cp-ville" aria-live="polite" hidden></div>
            <input type="hidden" name="ville">
            ${ok()}
        </div>

        <div class="q" data-q="titulaire">
            <p class="q-label">Êtes-vous titulaire de la carte grise ?</p>
            <div class="choices" data-required>
                ${choice('titulaire', 'oui', 'Oui')}
                ${choice('titulaire', 'non', 'Non')}
            </div>
            <div class="q-sub" hidden>
                <label class="field"><span class="field-label">Nom et prénom du titulaire <em>facultatif</em></span><input type="text" name="nomTitulaire" autocomplete="off"></label>
                ${ok()}
            </div>
        </div>

        <div class="q" data-q="certificat">
            <label class="q-label" for="leadFormule">Numéro du certificat d'immatriculation <em>facultatif</em></label>
            <input class="q-input" id="leadFormule" type="text" name="numeroFormule" placeholder="2009AS05284" maxlength="14" autocapitalize="characters" autocomplete="off">
            <div class="cg-where">
                <p class="cg-where-title">Où le trouver ?</p>
                <img class="cg-photo" src="/images/numero-certificat.webp" width="858" height="301" alt="Carte grise : le numéro du certificat (ex. 2009AS05284) figure sur le coupon détachable et en haut à droite du certificat">
                <p class="cg-intro">Sur la carte grise, le numéro du certificat (4 chiffres, 2 lettres, 5 chiffres) figure sur le coupon détachable et sous le titre « Certificat d'immatriculation ».</p>
            </div>
            ${ok()}
            <button type="button" class="q-skip" data-skip>Je ne l'ai pas sous la main</button>
        </div>

        <div class="q" data-q="fin">
            <label class="q-label" for="leadMessage">Un détail à nous signaler ? <em>facultatif</em></label>
            <textarea class="q-input q-text" id="leadMessage" name="message" rows="3" maxlength="2000" placeholder="Voyant allumé, bruit, choc, options, entretien récent…"></textarea>
            <label class="q-label" for="leadEmail">Votre e-mail <em>facultatif</em></label>
            <input class="q-input" id="leadEmail" type="email" name="email" autocomplete="email" placeholder="vous@exemple.fr">
            <label class="hp" aria-hidden="true">Ne pas remplir <input type="text" name="site_web" tabindex="-1" autocomplete="off"></label>
            <p class="lead-error" role="alert" hidden></p>
            <button type="submit" class="btn btn-gold btn-block">Recevoir mon estimation gratuite</button>
            <p class="lead-legal">Vos informations servent uniquement à étudier votre demande de rachat et ne sont jamais revendues. <a href="/politique-confidentialite">Confidentialité</a></p>
        </div>

        <div class="lead-photos" hidden>
            <p class="q-label">Ajoutez des photos de votre véhicule <em>facultatif</em></p>
            <p class="lead-photos-intro">Avant, arrière, côtés, intérieur, compteur et défauts éventuels : les photos nous aident à affiner votre estimation.</p>
            <div class="photo-actions">
                <label class="btn btn-outline photo-btn">${ICONS.camera}<span>Prendre une photo</span><input type="file" accept="image/*" capture="environment" data-photos hidden></label>
                <label class="btn btn-outline photo-btn">${ICONS.image}<span>Choisir mes photos</span><input type="file" accept="image/*" multiple data-photos hidden></label>
            </div>
            <ul class="photo-grid" aria-live="polite"></ul>
            <p class="lead-error photo-error" role="alert" hidden></p>
            <button type="button" class="btn btn-gold btn-block" data-photos-send disabled>Envoyer mes photos ${ICONS.arrow}</button>
            <button type="button" class="q-skip" data-photos-skip>Passer cette étape</button>
        </div>

        <div class="lead-done" data-q="done" hidden aria-live="polite">
            <p class="lead-done-mark">${ICONS.check}</p>
            <p class="lead-title">Demande bien reçue</p>
            <p class="lead-ref">Référence <strong data-ref></strong></p>
            <p class="lead-next-title">Les prochaines étapes</p>
            <ol class="lead-next">
                <li><strong>Analyse par nos équipes</strong><span>Nous étudions votre demande et les informations sur votre véhicule.</span></li>
                <li><strong>Nous vous recontactons</strong><span>Un conseiller vous appelle rapidement : gardez votre téléphone à portée de main.</span></li>
                <li><strong>Une proposition si votre véhicule correspond à nos critères</strong><span>Nous vous communiquons une fourchette de prix indicative.</span></li>
                <li><strong>Un technicien Lunicar vient à votre adresse</strong><span>Sur rendez-vous, sans frais, pour les dernières vérifications du véhicule.</span></li>
                <li><strong>Si tout est conforme, la vente est conclue</strong><span>Le prix définitif vous est confirmé, les documents sont préparés ensemble et le paiement se fait par virement instantané.</span></li>
            </ol>
            <p class="lead-next-link"><a href="/comment-ca-marche">En savoir plus sur notre méthode</a></p>
        </div>
    </form>
    ${direct ? `<p class="lead-alt">Vous préférez parler à quelqu'un ? ${direct}</p>` : ''}
</div>`;
}

// ---------- Sections réutilisées ----------

// Engagements : uniquement ce que LUNICAR fait réellement, aucun chiffre de preuve sociale.
function promises(extra) {
    const items = extra || ['Toutes marques, récentes ou non', 'Estimation rapide', 'Virement instantané à la vente', 'Technicien chez vous, sans frais'];
    return `<ul class="promises">${items.map(i => `<li>${ICONS.check}<span>${i}</span></li>`).join('')}</ul>`;
}

function steps(lieu, withPhotos, national) {
    const ou = lieu ? ` ${lieu}` : '';
    const ph = (n, alt) => withPhotos ? photo(n, alt, 'step-photo') : '';
    return `
<section class="section section-steps">
    <div class="wrap">
        <p class="eyebrow">Déroulé</p>
        <h2>Vendre votre voiture${ou} en trois temps</h2>
        <ol class="steps">
            <li>${ph('recente', 'Une voiture d\'occasion garée devant chez son propriétaire')}<span class="step-n">1</span><h3>Vous décrivez le véhicule</h3><p>Marque, modèle, année, kilométrage et état réel. Deux minutes, sans créer de compte, sans pièce justificative à cette étape.</p></li>
            <li>${ph('sans-ct', 'Vérification du moteur d\'une voiture')}<span class="step-n">2</span><h3>Nous vous rappelons avec une estimation</h3><p>Notre équipe étudie la demande ; un conseiller vous rappelle rapidement, pose les questions utiles et vous communique une fourchette de prix indicative.</p></li>
            <li>${ph('cash', 'Remise des clés au-dessus du toit de la voiture')}<span class="step-n">3</span><h3>Un technicien vérifie, vous décidez</h3><p>Si la fourchette vous convient, un technicien Lunicar vient à votre adresse, sans frais. Après vérification, nous vous présentons le prix définitif ; si vous l'acceptez, le paiement se fait par virement instantané.</p></li>
        </ol>
        <p><a class="text-link" href="/comment-ca-marche">Le déroulé détaillé, étape par étape ${ICONS.arrow}</a></p>
    </div>
</section>`;
}

function comparison() {
    const row = (label, a, b, c) => `<tr><th scope="row">${label}</th><td class="us">${a}</td><td>${b}</td><td>${c}</td></tr>`;
    return `
<section class="section section-tint">
    <div class="wrap">
        <p class="eyebrow">Comparer</p>
        <h2>Vente à un professionnel, annonce ou reprise en concession</h2>
        <div class="table-scroll">
            <table class="compare">
                <thead><tr><td></td><th scope="col" class="us">LUNICAR</th><th scope="col">Annonce entre particuliers</th><th scope="col">Reprise en concession</th></tr></thead>
                <tbody>
                    ${row('Délai pour vendre', 'Quelques jours', 'Plusieurs semaines en général', 'Le jour de l\'achat du nouveau véhicule')}
                    ${row('Contrôle technique', 'Non exigé', 'Obligatoire, moins de 6 mois', 'Variable')}
                    ${row('Obligation d\'acheter', 'Aucune', 'Aucune', 'Oui, le plus souvent')}
                    ${row('Paiement', 'Virement instantané', 'À sécuriser vous-même', 'Déduit du prix d\'achat')}
                    ${row('Démarches de cession', 'Prises en charge', 'À votre charge', 'Prises en charge')}
                    ${row('Voiture récente ou premium', 'Étudiée, sans achat en échange', 'Possible, avec du temps', 'Reprise liée à un achat')}
                    ${row('Véhicule ancien ou très kilométré', 'Étudié au cas par cas', 'Difficile à vendre', 'Peu valorisé')}
                </tbody>
            </table>
        </div>
    </div>
</section>`;
}

function documents() {
    return `
<section class="section">
    <div class="wrap narrow">
        <p class="eyebrow">Au rendez-vous</p>
        <h2>Les documents à préparer</h2>
        <ul class="doc-list">
            <li><strong>La carte grise</strong> (certificat d'immatriculation) à votre nom. En cas de perte, un duplicata se demande en ligne sur le site de l'ANTS.</li>
            <li><strong>Une pièce d'identité</strong> en cours de validité, au nom du titulaire de la carte grise.</li>
            <li><strong>Un RIB</strong> pour recevoir le virement.</li>
            <li><strong>Les clés</strong>, et le double si vous l'avez.</li>
            <li><strong>Le carnet d'entretien et les factures</strong>, facultatifs, mais ils permettent de mieux valoriser le véhicule.</li>
            <li><strong>Le rapport Histovec</strong>, facultatif et gratuit : l'historique officiel du véhicule (propriétaires, sinistres, gage, contrôles techniques), que vous générez sur <a href="https://histovec.interieur.gouv.fr" rel="noopener" target="_blank">histovec.interieur.gouv.fr</a> avec votre carte grise. Il nous permet d'établir le prix définitif plus vite.</li>
        </ul>
        <p class="note">Le certificat de cession (Cerfa 15776), le certificat de situation administrative et la déclaration de cession sur l'ANTS : si la vente est conclue, nous les préparons avec vous au rendez-vous.</p>
    </div>
</section>`;
}

function faqSection(title, faqs, intro) {
    if (!faqs || faqs.length === 0) return '';
    return `
<section class="section" id="faq">
    <div class="wrap narrow">
        <p class="eyebrow">Questions fréquentes</p>
        <h2>${title}</h2>
        ${intro ? `<p class="lede">${intro}</p>` : ''}
        <div class="faq">
            ${faqs.map(f => `<details><summary>${esc(f.question)}</summary><div class="faq-a"><p>${f.answer}</p></div></details>`).join('')}
        </div>
    </div>
</section>`;
}

function faqSchema(faqs) {
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs.map(f => ({
            '@type': 'Question',
            name: f.question,
            acceptedAnswer: { '@type': 'Answer', text: String(f.answer).replace(/<[^>]+>/g, '') }
        }))
    };
}

function breadcrumb(items) {
    const html = `<nav class="crumbs" aria-label="Fil d'Ariane"><div class="wrap"><ol>${items.map((it, i) => i === items.length - 1 ? `<li aria-current="page">${esc(it.name)}</li>` : `<li><a href="${it.path}">${esc(it.name)}</a></li>`).join('')}</ol></div></nav>`;
    const schema = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: SITE.baseUrl + it.path }))
    };
    return { html, schema };
}

function finalCta(title, text) {
    return `
<section class="section final-cta">
    <div class="wrap narrow">
        <h2>${title}</h2>
        <p>${text || 'Deux minutes pour décrire votre véhicule, une estimation indicative rapide, aucune obligation de vendre.'}</p>
        <div class="final-cta-actions">
            <a class="btn btn-gold" href="#estimation">Estimer ma voiture gratuitement</a>
        </div>
    </div>
</section>`;
}

// Voie courte : prénom + téléphone, pour ceux qui ne veulent rien remplir.
function callback(title) {
    return `
<section class="section section-ink" id="rappel">
    <div class="wrap callback">
        <div>
            <h2>${title || 'Pas le temps de remplir un formulaire ?'}</h2>
            <p>Laissez votre numéro : un conseiller vous rappelle, pose les questions utiles et vous communique de vive voix une fourchette de prix indicative.</p>
        </div>
        <form class="callback-form" id="callbackForm" novalidate>
            <label class="field"><span class="field-label">Prénom</span><input type="text" name="prenom" required autocomplete="given-name"></label>
            <label class="field"><span class="field-label">Téléphone</span><input type="tel" name="telephone" required autocomplete="tel" inputmode="tel" placeholder="06 …"></label>
            <label class="hp" aria-hidden="true">Ne pas remplir <input type="text" name="site_web" tabindex="-1" autocomplete="off"></label>
            <button type="submit" class="btn btn-gold">Être rappelé</button>
            <p class="callback-msg" role="status" hidden></p>
        </form>
    </div>
</section>`;
}

// Hero commun : texte à gauche, formulaire à droite (dessous sur mobile).
function photo(name, alt, cls, eager) {
    if (!name) return '';
    const v = SITE.assetVersion;
    return `<picture class="${cls}"><img src="/images/photos/${name}-1600.webp?v=${v}" srcset="/images/photos/${name}-800.webp?v=${v} 800w, /images/photos/${name}-1600.webp?v=${v} 1600w" sizes="100vw" alt="${esc(alt || '')}" width="1600" height="893"${eager ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"'}></picture>`;
}

// Bande photo pleine largeur entre deux sections, avec légende.
function photoBand(name, caption, alt) {
    return `
<figure class="photo-band">
    ${photo(name, alt || caption, 'photo-band-img')}
    ${caption ? `<figcaption><span class="wrap">${caption}</span></figcaption>` : ''}
</figure>`;
}

function hero({ eyebrow, h1, lede, form, points, image }) {
    return `
<section class="hero${image ? ' hero-has-photo' : ''}">
    ${photo(image, '', 'hero-photo', true)}
    <div class="wrap hero-in">
        <div class="hero-text">
            ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}
            <h1>${h1}</h1>
            <p class="hero-lede">${lede}</p>
        </div>
        ${leadForm(form)}
        ${promises(points)}
    </div>
</section>`;
}

// Accueil : la voiture en grand d'un côté, la saisie de plaque de l'autre.
// La plaque pré-remplit le formulaire complet plus bas (#estimation).
function showcase({ eyebrow, h1, lede, image, alt }) {
    return `
<section class="showcase">
    <div class="showcase-text">
        <div class="showcase-in">
            ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}
            <h1>${h1}</h1>
            <p class="hero-lede">${lede}</p>
            <form class="quick" id="quickStart" action="/reprise" method="get" novalidate>
                <label class="quick-label" for="quickPlate">Votre immatriculation</label>
                <div class="quick-row">
                    <span class="plate"><span class="plate-eu">F</span><input id="quickPlate" type="text" name="immat" inputmode="text" autocomplete="off" autocapitalize="characters" maxlength="10" placeholder="AB-123-CD"></span>
                    <button type="submit" class="btn btn-gold">Estimer ma voiture ${ICONS.arrow}</button>
                </div>
                <a class="quick-alt" href="#estimation">Je n'ai pas la plaque sous la main</a>
            </form>
            ${promises()}
        </div>
    </div>
    <figure class="showcase-photo">
        ${photo(image, alt, 'showcase-img', true)}
    </figure>
</section>`;
}

// Familles de véhicules : toute voiture peut être étudiée, sans promesse de rachat.
const CAR_TYPES = [
    { href: '/reprise-voiture-occasion', img: 'recente', t: 'Récente ou d\'occasion', d: 'Citadine, SUV, berline, break, monospace : toutes marques, tous âges.' },
    { href: '/reprise-voiture-electrique', img: 'electrique', t: 'Électrique ou hybride', d: 'Batterie, câbles, garantie : ce qui compte pour l\'estimation.' },
    { href: '/rachat-vehicule-utilitaire', img: 'utilitaire', t: 'Utilitaire', d: 'Fourgonnette ou grand fourgon, de particulier ou de société.' },
    { href: '/rachat-voiture-en-panne', img: 'panne', t: 'En panne', d: 'Elle ne roule plus : décrivez la panne, nous l\'étudions.' },
    { href: '/rachat-voiture-sans-controle-technique', img: 'sans-ct', t: 'Sans contrôle technique', d: 'Expiré, refusé ou jamais repassé : non exigé.' }
];

function carTypes(title, intro) {
    return `
<section class="section">
    <div class="wrap">
        <p class="eyebrow">Toutes marques</p>
        <h2>${title || 'Toute voiture peut être étudiée, de la plus récente à celle qui ne roule plus'}</h2>
        ${intro ? `<p class="lede">${intro}</p>` : ''}
        <ul class="types">
            ${CAR_TYPES.map(c => `<li><a href="${c.href}">${photo(c.img, '', 'type-img')}<strong>${c.t}</strong><span>${c.d}</span></a></li>`).join('')}
        </ul>
    </div>
</section>`;
}

// Date de mise à jour visible (le même jour que dateModified en JSON-LD).
function updated(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00Z');
    const txt = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    return `<p class="updated">Mis à jour le <time datetime="${iso}">${txt}</time></p>`;
}

function sources(list) {
    if (!list || !list.length) return '';
    return `
<section class="section section-sources">
    <div class="wrap narrow">
        <h2 class="sub">Sources officielles</h2>
        <ul class="sources">${list.map(s => `<li><a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.label)}</a></li>`).join('')}</ul>
    </div>
</section>`;
}

// Sections rédigées (pages guides, situations, Paris) : alternance fond clair / teinté.
function prose(sections, offset = 0) {
    return (sections || []).map((sec, i) => `
<section class="section${(i + offset) % 2 ? ' section-tint' : ''}">
    <div class="wrap narrow prose">
        <h2>${sec.h2}</h2>
        ${sec.html}
    </div>
</section>`).join('');
}

function webPage(o) {
    return {
        '@context': 'https://schema.org', '@type': 'WebPage',
        '@id': `${SITE.baseUrl}${o.path}#page`, url: `${SITE.baseUrl}${o.path}`,
        name: o.name, description: o.description, inLanguage: 'fr-FR',
        ...(o.modified ? { dateModified: o.modified } : {}),
        isPartOf: { '@type': 'WebSite', '@id': `${SITE.baseUrl}/#site` },
        publisher: { '@id': `${SITE.baseUrl}/#organisation` }
    };
}

const ORGANIZATION = {
    '@context': 'https://schema.org',
    '@type': 'AutomotiveBusiness',
    '@id': `${SITE.baseUrl}/#organisation`,
    name: 'LUNICAR',
    url: SITE.baseUrl,
    logo: `${SITE.baseUrl}/images/logo-lunicar.png`,
    image: `${SITE.baseUrl}/images/og-lunicar.jpg`,
    description: 'Rachat de voitures toutes marques aux particuliers et aux professionnels partout en France : toute voiture peut faire l\'objet d\'une demande d\'estimation, sans promesse de rachat systématique. Fourchette indicative communiquée rapidement, vérification par un technicien Lunicar à l\'adresse du vendeur, prix définitif après vérification, enlèvement offert et paiement par virement instantané si la vente est conclue.',
    slogan: 'Vendez votre voiture simplement, partout en France.',
    // Comptes officiels (à compléter à chaque nouveau réseau) : relie la marque à ses profils pour Google et les IA.
    sameAs: (SITE.social || []).map(r => r.url),
    knowsAbout: ['Rachat de voiture d\'occasion', 'Reprise de véhicule', 'Vente d\'une voiture ancienne', 'Estimation de voiture', 'Contrôle technique', 'Certificat de cession', 'Déclaration de cession ANTS', 'Histovec'],
    email: SITE.email,
    ...(SITE.phone ? { telephone: `+${SITE.phone.intl}` } : {}),
    // Zone nationale : la France et ses 13 régions métropolitaines (pas seulement l'Île-de-France).
    areaServed: [{ '@type': 'Country', name: 'France' }, ...['Île-de-France', 'Auvergne-Rhône-Alpes', 'Bourgogne-Franche-Comté', 'Bretagne', 'Centre-Val de Loire', 'Corse', 'Grand Est', 'Hauts-de-France', 'Normandie', 'Nouvelle-Aquitaine', 'Occitanie', 'Pays de la Loire', 'Provence-Alpes-Côte d\'Azur']
        .map(name => ({ '@type': 'AdministrativeArea', name }))],
    contactPoint: { '@type': 'ContactPoint', contactType: 'customer service', email: SITE.email, areaServed: 'FR', availableLanguage: 'French' },
    openingHoursSpecification: [
        { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '19:00' },
        { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Saturday', opens: '10:00', closes: '18:00' }
    ]
};

/**
 * Document HTML complet.
 * o.title, o.description, o.path (canonique), o.body, o.schemas[], o.hasForm, o.noindex, o.ogType
 */
function page(o) {
    const url = SITE.baseUrl + (o.path === '/' ? '/' : o.path);
    const v = SITE.assetVersion;
    const hasForm = o.hasForm !== false;
    const list = o.schemas || [];
    if (!o.noindex && !list.some(x => x && x['@type'] === 'AutomotiveBusiness')) list.push(ORGANIZATION);
    const schemas = list.map(jsonLd).join('\n    ');
    return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="msvalidate.01" content="A822D045FCC2B8E74C3A1984261E558F">
    <title>${esc(o.title)}</title>
    <meta name="description" content="${esc(o.description)}">
    <meta name="robots" content="${o.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}">
    ${o.noindex ? '' : `<link rel="canonical" href="${url}">`}
    <link rel="icon" href="/favicon.ico?v=${v}" sizes="48x48">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=${v}">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png?v=${v}">
    <link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png?v=${v}">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=${v}">
    <link rel="manifest" href="/site.webmanifest">
    <meta name="theme-color" content="#0C223B">
    <meta property="og:type" content="${o.ogType || 'website'}">
    <meta property="og:url" content="${url}">
    <meta property="og:title" content="${esc(o.ogTitle || o.title)}">
    <meta property="og:description" content="${esc(o.description)}">
    <meta property="og:image" content="${SITE.baseUrl}/images/og-lunicar.jpg?v=${v}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:locale" content="fr_FR">
    <meta property="og:site_name" content="LUNICAR">
    <meta name="twitter:card" content="summary_large_image">
    ${o.modified ? `<meta property="article:modified_time" content="${o.modified}">` : ''}
    <link rel="preload" href="/fonts/geist.woff2" as="font" type="font/woff2" crossorigin>
    ${o.preloadImage ? `<link rel="preload" as="image" href="/images/photos/${o.preloadImage}-1600.webp?v=${v}" imagesrcset="/images/photos/${o.preloadImage}-800.webp?v=${v} 800w, /images/photos/${o.preloadImage}-1600.webp?v=${v} 1600w" imagesizes="100vw" fetchpriority="high">` : ''}
    <link rel="stylesheet" href="/css/app.css?v=${v}">
    <link rel="stylesheet" href="/css/cookie-consent.css?v=${v}">
    ${schemas}
</head>
<body class="${hasForm ? 'has-form' : ''}">
<a class="skip" href="#contenu">Aller au contenu</a>
${header(o.path, hasForm)}
<main id="contenu">
${o.body}
</main>
${footer()}
${ctaBar(hasForm)}
<script src="/js/cookie-consent.js?v=${v}" defer></script>
<script src="/js/suivi.js?v=${v}" defer></script>
<script src="/js/plaque.js?v=${v}" defer></script>
<script src="/js/app.js?v=${v}" defer></script>
</body>
</html>`;
}

module.exports = {
    socialLinks,
    ICONS, ORGANIZATION, BRANDS,
    page, hero, showcase, carTypes, updated, sources, prose, webPage, leadForm, promises, steps, comparison, documents,
    faqSection, faqSchema, breadcrumb, finalCta, callback, photo, photoBand, phoneLink, whatsappLink
};
