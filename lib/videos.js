/**
 * LUNICAR - Vidéos de présentation (motion design, projet personal/lunicar-motion).
 * Fichiers dans public/videos/ (mp4 + affiche jpg), hébergés sur le site : la CSP reste inchangée
 * et chaque page porte son VideoObject (indexation vidéo Google, citations IA).
 * Une vidéo par page au plus, placée juste sous l'en-tête.
 */
const { esc, SITE, jsonLd } = require('./config');

const VIDEOS = {
    presentation: { titre: 'LUNICAR en 30 secondes : vendre sa voiture au juste prix, sans tracas', duree: 'PT31S',
        desc: 'Votre voiture décrite en ligne, une fourchette de prix indicative, un technicien chez vous sans frais, un prix définitif libre de refuser, puis un virement instantané reçu avant de signer.' },
    ct: { titre: 'Votre voiture ne passe pas le contrôle technique ?', duree: 'PT31S',
        desc: 'Défaillance majeure, contre-visite sous deux mois et devis qui grimpe : LUNICAR étudie la voiture dans l’état où elle est, sans réparation à avancer. Technicien chez vous sans frais, prix définitif libre de refuser, payé avant de signer.' },
    deces: { titre: 'Vendre la voiture d’un proche décédé, sans précipitation', duree: 'PT31S',
        desc: 'Héritiers, papiers, distance : si le décès date de moins de trois mois, la voiture peut être vendue sans refaire la carte grise. LUNICAR vient à l’adresse sans frais ; les héritiers signent ensemble, une fois l’argent reçu.' },
    panne: { titre: 'Voiture en panne : réparer ou vendre en l’état ?', duree: 'PT29S',
        desc: 'Comparez le devis à la valeur de la voiture. Une voiture qui ne roule plus ne se vend qu’à un professionnel : LUNICAR l’étudie dans son état, technicien chez vous sans frais, enlèvement offert même non roulante.' },
    particulier: { titre: 'Vendre sa voiture à un particulier : les risques', duree: 'PT28S',
        desc: 'Faux virement, essai qui tourne mal, appels à toute heure, action pour vice caché pendant deux ans après sa découverte. Avec LUNICAR, vous vendez en l’état à un professionnel qui vérifie la voiture : aucune garantie ne vous est demandée.' },
    km: { titre: '200 000 km au compteur : votre voiture a encore de la valeur', duree: 'PT26S',
        desc: 'Les acheteurs particuliers fuient ou négocient sans fin. LUNICAR regarde l’entretien et l’état réel, pas seulement le compteur : technicien chez vous sans frais, prix définitif libre de refuser.' },
};

const PAR_PAGE = {
    '/': 'presentation',
    '/rachat-voiture-sans-controle-technique': 'ct',
    '/reprise-voiture-succession': 'deces',
    '/rachat-voiture-en-panne': 'panne',
    '/risques-vente-voiture-particulier': 'particulier',
    '/reprise-voiture-haut-kilometrage': 'km',
};

const DATE = '2026-11-27';

function bloc(chemin) {
    const id = PAR_PAGE[chemin];
    const v = id && VIDEOS[id];
    if (!v) return '';
    const base = (SITE.baseUrl || 'https://lunicar.fr').replace(/\/$/, '');
    const ld = {
        '@context': 'https://schema.org', '@type': 'VideoObject',
        name: v.titre, description: v.desc, uploadDate: DATE, duration: v.duree, inLanguage: 'fr-FR',
        thumbnailUrl: `${base}/videos/${id}.jpg`, contentUrl: `${base}/videos/${id}.mp4`,
        publisher: { '@type': 'Organization', name: 'LUNICAR', url: base }
    };
    return `
<section class="section section-video">
    <div class="wrap narrow">
        <p class="eyebrow">${id === 'presentation' ? 'LUNICAR en 30 secondes' : 'En vidéo'}</p>
        <figure class="video-frame">
            <video controls playsinline preload="none" poster="/videos/${id}.jpg" aria-label="${esc(v.titre)}">
                <source src="/videos/${id}.mp4" type="video/mp4">
            </video>
            <figcaption>${esc(v.titre)}</figcaption>
        </figure>
    </div>
    ${jsonLd(ld)}
</section>`;
}

module.exports = { VIDEOS, PAR_PAGE, bloc };
