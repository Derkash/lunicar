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
    arrow: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

const LOGO = `<svg class="logo-svg" viewBox="0 0 196 44" role="img" aria-label="LUNICAR"><rect x="1" y="2" width="40" height="40" rx="10" fill="#0D2541"/><path d="M14 11v21h15" fill="none" stroke="#D4B26A" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="29" cy="15" r="3.2" fill="#D4B26A"/><text x="52" y="31" font-family="'DM Sans', system-ui, sans-serif" font-size="25" font-weight="700" letter-spacing="2.2" fill="currentColor">LUNI<tspan fill="#B8923A">CAR</tspan></text></svg>`;

// ---------- En-tête / pied ----------

const NAV = [
    { href: '/reprise', label: 'Estimation' },
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
        <a href="/" class="logo" aria-label="LUNICAR, accueil">${LOGO}</a>
        <nav class="site-nav" id="siteNav" aria-label="Navigation principale">
            ${NAV.map(n => `<a href="${n.href}"${n.href === path ? ' aria-current="page"' : ''}>${n.label}</a>`).join('')}
        </nav>
        <div class="site-header-actions">
            ${phoneLink('header-phone')}
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
                <a href="/" class="logo" aria-label="LUNICAR, accueil">${LOGO}</a>
                <p>Rachat de voitures toutes marques, récentes ou non, aux particuliers et aux professionnels, partout en France. Offre sous 24 h ouvrées, déplacement offert, paiement par virement, démarches prises en charge.</p>
                <p class="footer-contact">
                    ${phoneLink('footer-link')}
                    <a class="footer-link" href="mailto:${SITE.email}">${SITE.email}</a>
                    <span>${SITE.hours}</span>
                </p>
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
                    <li><a href="/rachat-voiture-en-panne">En panne ou HS</a></li>
                    <li><a href="/rachat-voiture-accidentee">Accidentée</a></li>
                    <li><a href="/rachat-voiture-sans-controle-technique">Sans contrôle technique</a></li>
                    <li><a href="/rachat-voiture-rapide">Vendre vite</a></li>
                </ul>
            </nav>
            <nav aria-label="Partout en France">
                <h2>Partout en France</h2>
                <ul>
                    <li><a href="/rachat-voiture-france">Rachat de voiture en France</a></li>
                    <li><a href="/reprise-auto-lyon">Lyon</a></li>
                    <li><a href="/reprise-auto-marseille">Marseille</a></li>
                    <li><a href="/reprise-auto-bordeaux">Bordeaux</a></li>
                    <li><a href="/reprise-auto-toulouse">Toulouse</a></li>
                    <li><a href="/reprise-auto-lille">Lille</a></li>
                    <li><a href="/reprise-auto-nantes">Nantes</a></li>
                    <li><a href="/reprise-auto-nice">Nice</a></li>
                    <li><a href="/reprise-auto-montpellier">Montpellier</a></li>
                </ul>
            </nav>
            <nav aria-label="LUNICAR">
                <h2>LUNICAR</h2>
                <ul>
                    <li><a href="/reprise">Faire estimer ma voiture</a></li>
                    <li><a href="/a-propos">Qui sommes-nous</a></li>
                    <li><a href="/garanties">Nos garanties</a></li>
                    <li><a href="/comparatif-reprise-auto">Comparer les solutions</a></li>
                    <li><a href="/articles">Conseils</a></li>
                    <li><a href="/contact">Contact</a></li>
                    <li><a href="/mentions-legales">Mentions légales</a></li>
                    <li><a href="/politique-confidentialite">Confidentialité</a></li>
                </ul>
            </nav>
        </div>
        <p class="footer-legal">© ${year} LUNICAR · Site édité par OPTIMERCH · <a href="/mentions-legales">Mentions légales</a> · Tous droits réservés.</p>
    </div>
</footer>`;
}

// Barre d'action fixe en bas d'écran sur mobile : l'appel d'abord quand il existe.
function ctaBar(hasForm) {
    const target = hasForm ? '#estimation' : '/reprise';
    return `
<div class="cta-bar" id="ctaBar">
    ${phoneLink('cta-bar-btn cta-bar-call', 'Appeler')}
    ${whatsappLink('cta-bar-btn cta-bar-wa', 'WhatsApp')}
    <a class="cta-bar-btn cta-bar-main" href="${target}">Mon offre gratuite</a>
</div>`;
}

// Schéma simplifié d'une carte grise : repère où lire nom, date et numéro de formule.
const CARTE_GRISE_SVG = `<svg class="cg-svg" viewBox="0 0 300 190" role="img" aria-label="Schéma d'une carte grise : nom en C.1, date du certificat en case I, numéro de formule en bas dans le coupon">
<rect x="1" y="1" width="298" height="188" rx="8" fill="#F3EBDD" stroke="#C9BFA9"/>
<g font-family="DM Sans, sans-serif" font-size="9" fill="#6F6B64">
<text x="12" y="20">A. AB-123-CD</text><text x="110" y="20">B. 05/01/2015</text>
<text x="12" y="62">C.3 …</text><text x="12" y="76">D.1 MARQUE</text><text x="12" y="90">D.2 …   E. VF7…</text>
<text x="12" y="104">F.1 …   G …   J …</text><text x="12" y="118">P.1 …   P.3 …   P.6 …</text>
</g>
<rect x="8" y="27" width="150" height="20" rx="4" fill="none" stroke="#B8923A" stroke-width="2.5"/>
<text x="14" y="41" font-family="DM Sans, sans-serif" font-size="10" font-weight="700" fill="#0D2541">C.1 DUPONT</text>
<text x="166" y="41" font-family="DM Sans, sans-serif" font-size="10" font-weight="700" fill="#96762A">① Nom</text>
<rect x="8" y="126" width="110" height="20" rx="4" fill="none" stroke="#B8923A" stroke-width="2.5"/>
<text x="14" y="140" font-family="DM Sans, sans-serif" font-size="10" font-weight="700" fill="#0D2541">I  12/03/2019</text>
<text x="126" y="140" font-family="DM Sans, sans-serif" font-size="10" font-weight="700" fill="#96762A">② Date du certificat</text>
<line x1="1" y1="152" x2="299" y2="152" stroke="#C9BFA9" stroke-dasharray="4 3"/>
<text x="12" y="166" font-family="DM Sans, sans-serif" font-size="9" fill="#6F6B64">AB-123-CD   12/03/2019</text>
<rect x="8" y="170" width="110" height="16" rx="4" fill="none" stroke="#B8923A" stroke-width="2.5"/>
<text x="14" y="182" font-family="DM Sans, sans-serif" font-size="10" font-weight="700" fill="#0D2541">2019AB12345</text>
<text x="126" y="182" font-family="DM Sans, sans-serif" font-size="10" font-weight="700" fill="#96762A">③ N° de formule (coupon)</text>
</svg>`;

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
    const choice = (name, value, label) => `<label class="choice"><input type="radio" name="${name}" value="${value}"><span>${label}</span></label>`;
    const ok = (label = 'Continuer') => `<button type="button" class="btn btn-gold btn-block" data-ok>${label} ${ICONS.arrow}</button>`;
    const direct = [phoneLink('lead-alt-link'), whatsappLink('lead-alt-link', 'Envoyer des photos par WhatsApp')].filter(Boolean).join('');
    return `
<div class="lead" id="estimation">
    <form class="lead-form" id="leadForm" novalidate data-source="${esc(opts.source || '')}">
        <div class="lead-head">
            <p class="lead-title">${opts.title || 'Recevez votre offre de rachat'}</p>
            <p class="lead-sub">Gratuit, sans engagement. Déplacement offert partout en France.</p>
            <div class="lead-meter" aria-hidden="true"><span class="lead-meter-bar"><i></i></span><span class="lead-meter-pct">0 %</span></div>
        </div>

        <div class="q on" data-q="plaque">
            <label class="q-label" for="leadPlate">Quelle est son immatriculation ?</label>
            <span class="plate"><span class="plate-eu">F</span><input id="leadPlate" type="text" name="plaque" inputmode="text" autocomplete="off" autocapitalize="characters" maxlength="10" placeholder="AB-123-CD" aria-describedby="plateInfo"></span>
            <span class="plate-info" id="plateInfo" aria-live="polite" hidden></span>
            <input type="hidden" name="fiche">
            ${ok()}
            <button type="button" class="q-skip" data-skip>Je n'ai pas la plaque sous la main</button>
        </div>

        <div class="q" data-q="vehicule">
            <label class="q-label" for="leadVehicule">Quelle est la marque et le modèle ?</label>
            <input class="q-input" id="leadVehicule" type="text" name="vehicule" list="brandList" required placeholder="Ex. Peugeot 308" autocomplete="off">
            <datalist id="brandList">${BRANDS.map(b => `<option value="${b} ">`).join('')}</datalist>
            ${ok()}
        </div>

        <div class="q" data-q="annee">
            <label class="q-label" for="leadAnnee">En quelle année a-t-elle été mise en circulation ?</label>
            <select class="q-input" id="leadAnnee" name="annee" required>${yearOptions()}</select>
        </div>

        <div class="q" data-q="km">
            <label class="q-label" for="leadKm">Combien de kilomètres a-t-elle ?</label>
            <span class="money"><input id="leadKm" type="text" name="kilometrage" inputmode="numeric" required placeholder="Ex. 120 000" maxlength="9"><span>km</span></span>
            <p class="q-warn" hidden>Ce kilométrage semble inhabituel pour l'année indiquée. Vérifiez-le, puis continuez.</p>
            ${ok()}
        </div>

        <div class="q" data-q="etat">
            <p class="q-label">Dans quel état est-elle ?</p>
            <div class="chips">
                <label class="chip"><input type="checkbox" name="etatOk" value="ok"><span>Elle roule, aucun souci</span></label>
                ${chip('panne', 'En panne / ne roule plus')}
                ${chip('accident', 'Accidentée')}
                ${chip('ct', 'Sans CT valide')}
            </div>
            ${ok()}
        </div>

        <div class="q" data-q="delai">
            <p class="q-label">Quand souhaitez-vous la vendre ?</p>
            <div class="choices">
                ${choice('delai', 'vite', 'Le plus vite possible')}
                ${choice('delai', 'mois', 'Dans le mois')}
                ${choice('delai', '3mois', 'Dans les 3 mois')}
                ${choice('delai', 'info', 'Je me renseigne')}
            </div>
        </div>

        <div class="q" data-q="achat">
            <p class="q-label">Prévoyez-vous d'acheter une autre voiture ?</p>
            <div class="choices choices-3">
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
            <p class="q-label">À quel nom établir l'offre ?</p>
            <div class="field-row">
                <label class="field"><span class="field-label">Prénom</span><input type="text" name="prenom" required autocomplete="given-name"></label>
                <label class="field"><span class="field-label">Nom</span><input type="text" name="nom" required autocomplete="family-name"></label>
            </div>
            ${ok()}
        </div>

        <div class="q" data-q="contact">
            <p class="q-label">Où vous joindre avec votre offre ?</p>
            <div class="field-row">
                <label class="field"><span class="field-label">Téléphone</span><input type="tel" name="telephone" required autocomplete="tel" inputmode="tel" placeholder="06 …"></label>
                <label class="field field-cp"><span class="field-label">Code postal</span><input type="text" name="codePostal" required inputmode="numeric" maxlength="5" autocomplete="postal-code" value="${esc(opts.cp || '')}" placeholder="75011"></label>
            </div>
            ${ok()}
        </div>

        <div class="q" data-q="fin">
            <label class="q-label" for="leadEmail">Votre offre vous attend. Recevez-la aussi par e-mail <em>facultatif</em></label>
            <input class="q-input" id="leadEmail" type="email" name="email" autocomplete="email" placeholder="vous@exemple.fr">
            <label class="check">
                <input type="checkbox" name="whatsapp" value="oui">
                <span>J'accepte d'être contacté sur WhatsApp à ce numéro</span>
            </label>

            <details class="cg">
                <summary>Faciliter l'analyse de mon véhicule <em>facultatif</em></summary>
                <p class="cg-intro">Avec ces informations de votre carte grise, nous consultons l'historique officiel du véhicule (Histovec, service de l'État) et vous faisons une offre plus précise, plus vite.</p>
                <div class="field">
                    <span class="field-label">Êtes-vous titulaire de la carte grise ?</span>
                    <div class="chips">
                        <label class="chip"><input type="radio" name="titulaire" value="oui"><span>Oui</span></label>
                        <label class="chip"><input type="radio" name="titulaire" value="non"><span>Non</span></label>
                    </div>
                </div>
                <label class="field">
                    <span class="field-label">Nom de naissance du titulaire <em>tel qu'inscrit en C.1</em></span>
                    <input type="text" name="nomTitulaire" autocomplete="off">
                </label>
                <div class="field-row">
                    <label class="field">
                        <span class="field-label">Date (case I)</span>
                        <input type="text" name="dateCertificat" inputmode="numeric" placeholder="JJ/MM/AAAA" maxlength="10" autocomplete="off">
                    </label>
                    <label class="field">
                        <span class="field-label">N° de formule</span>
                        <input type="text" name="numeroFormule" placeholder="2019AB12345" maxlength="14" autocapitalize="characters" autocomplete="off">
                    </label>
                </div>
                <details class="cg-help">
                    <summary>Où trouver ces informations ?</summary>
                    ${CARTE_GRISE_SVG}
                    <ul>
                        <li><strong>Nom</strong> : ligne <b>C.1</b>, en haut de la carte grise.</li>
                        <li><strong>Date du certificat</strong> : case <b>I</b>, à gauche, sous la case H. C'est la date d'émission de votre carte grise, pas celle de la 1<sup>re</sup> immatriculation (case B).</li>
                        <li><strong>Numéro de formule</strong> : tout en bas, dans le coupon détachable, sous l'immatriculation et la date. Sur les cartes grises récentes : 4 chiffres, 2 lettres, 5 chiffres (ex. 2019AB12345).</li>
                    </ul>
                </details>
                <label class="check">
                    <input type="checkbox" name="consentHistovec" value="oui">
                    <span>J'autorise LUNICAR à consulter le rapport Histovec de ce véhicule pour établir son offre.</span>
                </label>
            </details>

            <label class="hp" aria-hidden="true">Ne pas remplir <input type="text" name="site_web" tabindex="-1" autocomplete="off"></label>
            <p class="lead-error" role="alert" hidden></p>
            <button type="submit" class="btn btn-gold btn-block">Recevoir mon offre gratuite</button>
            <p class="lead-legal">Vos informations servent uniquement à vous faire une offre de rachat et ne sont jamais revendues. <a href="/politique-confidentialite">Confidentialité</a></p>
        </div>

        <div class="lead-done" data-q="done" hidden aria-live="polite">
            <p class="lead-done-mark">${ICONS.check}</p>
            <p class="lead-title">Demande bien reçue</p>
            <p>Un conseiller vous rappelle sous 24 h ouvrées avec une offre chiffrée. Gardez votre téléphone à portée de main.</p>
            <p class="lead-ref">Référence <strong data-ref></strong></p>
            <div class="histovec-form" id="histovecForm">
                <label class="field"><span class="field-label">Lien de votre rapport Histovec <em>facultatif</em></span>
                <input type="url" name="lien" placeholder="https://histovec.interieur.gouv.fr/…" autocomplete="off"></label>
                <button type="button" class="btn btn-outline btn-block" data-histovec>Envoyer le lien</button>
                <p class="callback-msg" role="status" hidden></p>
            </div>
            <div class="lead-next">
                <p class="lead-next-title">Pour une offre plus précise, deux choses utiles</p>
                <ol>
                    <li><strong>3 ou 4 photos du véhicule</strong>${SITE.whatsapp ? `, à envoyer par WhatsApp :<br>${whatsappLink('lead-next-link', 'Envoyer mes photos')}` : ', que le conseiller vous demandera lors de son appel.'}</li>
                    <li><strong>Son historique officiel, gratuit.</strong> Sur <a href="https://histovec.interieur.gouv.fr" rel="noopener" target="_blank">Histovec</a>, le service de l'État, avec votre carte grise sous les yeux (nom, plaque, numéro de formule, date). Vous obtenez un rapport à nous transmettre par lien${SITE.whatsapp ? ' sur WhatsApp' : ''} ou à <a href="mailto:${SITE.email}">${SITE.email}</a>.</li>
                </ol>
            </div>
        </div>
    </form>
    ${direct ? `<p class="lead-alt">Vous préférez parler à quelqu'un ? ${direct}</p>` : ''}
</div>`;
}

// ---------- Sections réutilisées ----------

// Engagements : uniquement ce que LUNICAR fait réellement, aucun chiffre de preuve sociale.
function promises(extra) {
    const items = extra || ['Toutes marques, récentes ou non', 'Offre sous 24 h ouvrées', 'Paiement par virement bancaire', 'Déplacement offert partout en France'];
    return `<ul class="promises">${items.map(i => `<li>${ICONS.check}<span>${i}</span></li>`).join('')}</ul>`;
}

function steps(lieu, withPhotos, national) {
    const ou = lieu ? ` ${lieu}` : '';
    const ph = (n, alt) => withPhotos ? photo(n, alt, 'step-photo') : '';
    return `
<section class="section">
    <div class="wrap">
        <p class="eyebrow">Déroulé</p>
        <h2>Vendre votre voiture${ou} en trois temps</h2>
        <ol class="steps">
            <li>${ph('accidentee', 'Un vendeur photographie sa voiture avec son téléphone')}<span class="step-n">1</span><h3>Vous décrivez le véhicule</h3><p>Marque, modèle, année, kilométrage et état réel. Deux minutes, sans créer de compte, sans pièce justificative à cette étape.</p></li>
            <li>${ph('sans-ct', 'Vérification du moteur d\'une voiture')}<span class="step-n">2</span><h3>Nous vous appelons avec une offre</h3><p>Un conseiller vous rappelle sous 24 h ouvrées, pose les questions utiles et vous annonce un prix. L'offre reste valable 7 jours.</p></li>
            <li>${ph('cash', 'Remise des clés au-dessus du toit de la voiture')}<span class="step-n">3</span><h3>Nous venons, vous êtes payé</h3><p>Rendez-vous à l'adresse de votre choix, partout en France, sans frais de déplacement. Nous vérifions le véhicule, signons le certificat de cession et réglons par virement bancaire.</p></li>
        </ol>
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
                    ${row('Paiement', 'Virement bancaire', 'À sécuriser vous-même', 'Déduit du prix d\'achat')}
                    ${row('Démarches de cession', 'Prises en charge', 'À votre charge', 'Prises en charge')}
                    ${row('Voiture récente ou premium', 'Rachetée, sans achat en échange', 'Possible, avec du temps', 'Reprise liée à un achat')}
                    ${row('Véhicule en panne ou accidenté', 'Accepté', 'Très difficile à vendre', 'Souvent refusé')}
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
        <p class="eyebrow">Le jour de la vente</p>
        <h2>Les documents à préparer</h2>
        <ul class="doc-list">
            <li><strong>La carte grise</strong> (certificat d'immatriculation) à votre nom. En cas de perte, un duplicata se demande en ligne sur le site de l'ANTS.</li>
            <li><strong>Une pièce d'identité</strong> en cours de validité, au nom du titulaire de la carte grise.</li>
            <li><strong>Un RIB</strong> pour recevoir le virement.</li>
            <li><strong>Les clés</strong>, et le double si vous l'avez.</li>
            <li><strong>Le carnet d'entretien et les factures</strong>, facultatifs, mais ils permettent de mieux valoriser le véhicule.</li>
            <li><strong>Le rapport Histovec</strong>, facultatif et gratuit : l'historique officiel du véhicule (propriétaires, sinistres, gage, contrôles techniques), que vous générez sur <a href="https://histovec.interieur.gouv.fr" rel="noopener" target="_blank">histovec.interieur.gouv.fr</a> avec votre carte grise. Il nous permet de confirmer l'offre plus vite.</li>
        </ul>
        <p class="note">Le certificat de cession (Cerfa 15776), le certificat de situation administrative et la déclaration de cession sur l'ANTS : nous les préparons avec vous au rendez-vous.</p>
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
        <p>${text || 'Deux minutes pour décrire votre véhicule, une offre sous 24 h ouvrées, aucune obligation de vendre.'}</p>
        <div class="final-cta-actions">
            <a class="btn btn-gold" href="#estimation">Recevoir mon offre gratuite</a>
            ${phoneLink('btn btn-ghost-light')}
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
            <p>Laissez votre numéro : un conseiller vous rappelle, pose les questions utiles et vous annonce un prix de vive voix.</p>
            ${[phoneLink('callback-direct'), whatsappLink('callback-direct', 'Écrire sur WhatsApp')].filter(Boolean).join('')}
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

// « Nous rachetons toutes les voitures » : une entrée par famille de véhicules.
const CAR_TYPES = [
    { href: '/reprise-voiture-occasion', img: 'recente', t: 'Récente ou d\'occasion', d: 'Citadine, SUV, berline, break, monospace : toutes marques, tous âges.' },
    { href: '/reprise-voiture-electrique', img: 'electrique', t: 'Électrique ou hybride', d: 'Batterie, câbles, garantie : ce qui compte pour l\'offre.' },
    { href: '/rachat-vehicule-utilitaire', img: 'utilitaire', t: 'Utilitaire', d: 'Fourgonnette ou grand fourgon, de particulier ou de société.' },
    { href: '/rachat-voiture-en-panne', img: 'panne', t: 'En panne', d: 'Elle ne roule plus : nous venons la chercher.' },
    { href: '/rachat-voiture-accidentee', img: 'accidentee', t: 'Accidentée', d: 'Carrosserie touchée ou choc plus lourd, en l\'état.' },
    { href: '/rachat-voiture-sans-controle-technique', img: 'sans-ct', t: 'Sans contrôle technique', d: 'Expiré, refusé ou jamais repassé : non exigé.' }
];

function carTypes(title, intro) {
    return `
<section class="section">
    <div class="wrap">
        <p class="eyebrow">Toutes les voitures</p>
        <h2>${title || 'Nous rachetons toutes les voitures, de la plus récente à celle qui ne roule plus'}</h2>
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
    legalName: 'GUIRAK SERVICES',
    identifier: { '@type': 'PropertyValue', propertyID: 'SIRET', value: '94798285600017' },
    url: SITE.baseUrl,
    logo: `${SITE.baseUrl}/images/logo-lunicar.png`,
    image: `${SITE.baseUrl}/images/og-lunicar.jpg`,
    description: 'Rachat de voitures toutes marques aux particuliers et aux professionnels partout en France : voitures récentes, d\'occasion, électriques, utilitaires, en panne ou accidentées. Offre sous 24 h ouvrées, déplacement et enlèvement offerts partout en France, paiement par virement.',
    slogan: 'Nous rachetons votre voiture, toutes marques, récentes ou non.',
    knowsAbout: ['Rachat de voiture d\'occasion', 'Reprise de véhicule', 'Certificat de cession', 'Déclaration de cession ANTS', 'Histovec'],
    email: SITE.email,
    ...(SITE.phone ? { telephone: `+${SITE.phone.intl}` } : {}),
    address: { '@type': 'PostalAddress', addressLocality: 'Paris', addressRegion: 'Île-de-France', addressCountry: 'FR' },
    areaServed: [{ '@type': 'Country', name: 'France' }, ...['Paris', 'Hauts-de-Seine', 'Seine-Saint-Denis', 'Val-de-Marne', 'Val-d\'Oise', 'Essonne', 'Yvelines', 'Seine-et-Marne']
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
    const schemas = (o.schemas || []).map(jsonLd).join('\n    ');
    return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(o.title)}</title>
    <meta name="description" content="${esc(o.description)}">
    <meta name="robots" content="${o.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}">
    <link rel="canonical" href="${url}">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <meta name="theme-color" content="#0D2541">
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
    <link rel="preload" href="/fonts/fraunces-normal.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/fonts/dmsans-normal.woff2" as="font" type="font/woff2" crossorigin>
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
<script src="/js/plaque.js?v=${v}" defer></script>
<script src="/js/app.js?v=${v}" defer></script>
</body>
</html>`;
}

module.exports = {
    ICONS, ORGANIZATION, BRANDS,
    page, hero, showcase, carTypes, updated, sources, prose, webPage, leadForm, promises, steps, comparison, documents,
    faqSection, faqSchema, breadcrumb, finalCta, callback, photo, photoBand, phoneLink, whatsappLink
};
