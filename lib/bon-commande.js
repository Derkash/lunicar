// Bon de commande remis à l'acheteur d'un véhicule revendu : la société vend (coordonnées + RIB), l'acheteur
// et le véhicule sont pré-remplis, le prix reste en blanc pour être écrit à la main.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// Vendeur et compte de règlement par défaut (modifiables dans l'écran, mémorisés dans le réglage « bon_commande »).
const VENDEUR_DEFAUT = {
    raison: 'YAK SERVICES', siret: '13193005900012', representant: 'Youssouf GUIRASSY',
    adresse: '12 rue du Général Lecorguillier', cp_ville: '93330 Neuilly-sur-Marne', email: 'yakautoservices@gmail.com', telephone: '',
    // RIB jamais dans le code (dépôt public) : variables Render, sinon saisi une fois dans l'écran et mémorisé.
    titulaire: 'YAK SERVICES', iban: process.env.BON_COMMANDE_IBAN || '', bic: process.env.BON_COMMANDE_BIC || '', banque: process.env.BON_COMMANDE_BANQUE || '',
    conditions: 'Véhicule d\'occasion vendu en l\'état, tel que vu par l\'acheteur. Le véhicule et ses documents sont remis après encaissement de la totalité du prix sur le compte ci-dessus.'
};

const NOIR = rgb(0.1, 0.1, 0.12), GRIS = rgb(0.42, 0.42, 0.46), FILET = rgb(0.78, 0.78, 0.8);

// Helvetica (WinAnsi) : on remplace ce qu'elle ne sait pas écrire.
const propre = t => String(t == null ? '' : t).replace(/[  ]/g, ' ').replace(/[‐-‒]/g, '-').replace(/[^\x00-\xFF€’‘“”–—…•]/g, '').trim();

async function generer(b) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    const fr = await doc.embedFont(StandardFonts.Helvetica), gras = await doc.embedFont(StandardFonts.HelveticaBold);
    const G = 48, D = 595.28 - 48, L = D - G;
    let y = 790;
    const ecrire = (t, x, yy, { taille = 9.5, police = fr, couleur = NOIR, max } = {}) => {
        let s = propre(t);
        if (max) while (s && police.widthOfTextAtSize(s, taille) > max) s = s.slice(0, -1);
        page.drawText(s, { x, y: yy, size: taille, font: police, color: couleur });
    };
    const ligne = (x1, x2, yy, couleur = FILET, e = 0.6) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: e, color: couleur });
    // Texte sur plusieurs lignes dans une largeur donnée ; renvoie le y suivant.
    const paragraphe = (t, x, yy, larg, taille = 8.5, couleur = GRIS) => {
        const mots = propre(t).split(/\s+/); let l = '';
        for (const m of mots) {
            const essai = l ? l + ' ' + m : m;
            if (fr.widthOfTextAtSize(essai, taille) > larg && l) { ecrire(l, x, yy, { taille, couleur }); yy -= taille + 3.5; l = m; } else l = essai;
        }
        if (l) { ecrire(l, x, yy, { taille, couleur }); yy -= taille + 3.5; }
        return yy;
    };
    const titre = (t, yy) => { ecrire(t.toUpperCase(), G, yy, { taille: 8, police: gras, couleur: GRIS }); ligne(G, D, yy - 5); return yy - 20; };

    // En-tête
    ecrire('BON DE COMMANDE', G, y, { taille: 20, police: gras });
    ecrire('Véhicule d\'occasion', G, y - 17, { taille: 10, couleur: GRIS });
    const n = `N° ${propre(b.numero)}`, dt = `Date : ${propre(b.date) || '____ / ____ / ________'}`;
    ecrire(n, D - fr.widthOfTextAtSize(propre(n), 9.5), y + 4);
    ecrire(dt, D - fr.widthOfTextAtSize(propre(dt), 9.5), y - 12);
    y -= 44; ligne(G, D, y, NOIR, 1.2); y -= 26;

    // Vendeur | Acheteur
    const col = (x, larg, entete, lignes) => {
        let yy = y;
        ecrire(entete.toUpperCase(), x, yy, { taille: 8, police: gras, couleur: GRIS }); ligne(x, x + larg, yy - 5); yy -= 20;
        for (const [lib, val, fort] of lignes) {
            if (lib) ecrire(lib, x, yy, { taille: 7.5, couleur: GRIS });
            const xv = fort ? x : x + 72;
            if (propre(val)) ecrire(val, xv, yy, { taille: fort ? 10.5 : 9.5, police: fort ? gras : fr, max: x + larg - xv });
            else ligne(xv, x + larg, yy - 2, FILET, 0.5);
            yy -= 17;
        }
        return yy;
    };
    const lc = (L - 28) / 2;
    const v = b.vendeur || {}, a = b.acheteur || {};
    const y1 = col(G, lc, 'Le vendeur', [
        ['', v.raison, true], ['SIRET', v.siret], ['Représenté par', v.representant], ['Adresse', v.adresse], ['', v.cp_ville],
        ['E-mail', v.email], ...(propre(v.telephone) ? [['Téléphone', v.telephone]] : [])
    ]);
    const y2 = col(G + lc + 28, lc, 'L\'acheteur', [
        ['Société', a.societe], ['SIRET', a.siret], ['Nom', a.nom], ['Prénom', a.prenom], ['Adresse', a.adresse], ['CP, ville', a.cp_ville],
        ['Téléphone', a.telephone], ['E-mail', a.email]
    ]);
    y = Math.min(y1, y2) - 14;

    // Véhicule : grille de 2 colonnes
    y = titre('Le véhicule', y);
    const ve = b.vehicule || {};
    const champs = [['Marque', ve.marque], ['Modèle', ve.modele], ['Version', ve.version], ['Immatriculation', ve.immatriculation],
        ['N° de série (VIN)', ve.vin], ['1re mise en circulation', ve.mise_circulation], ['Kilométrage au compteur', ve.kilometrage ? `${ve.kilometrage} km` : ''],
        ['Énergie', ve.energie], ['Boîte de vitesses', ve.boite], ['Couleur', ve.couleur], ['Puissance', ve.puissance], ['N° de formule (carte grise)', ve.numero_formule]];
    const lv = L / 2;
    champs.forEach(([lib, val], i) => {
        const x = G + (i % 2) * lv, yy = y - Math.floor(i / 2) * 22;
        ecrire(lib, x, yy, { taille: 7.5, couleur: GRIS });
        if (propre(val)) ecrire(val, x + 112, yy, { taille: 9.5, police: gras, max: lv - 120 }); else ligne(x + 112, x + lv - 14, yy - 2, FILET, 0.5);
    });
    y -= Math.ceil(champs.length / 2) * 22 + 4;
    if (propre(ve.observations)) { ecrire('Observations', G, y, { taille: 7.5, couleur: GRIS }); y = paragraphe(ve.observations, G + 112, y, L - 112, 9, NOIR) - 4; }
    y -= 10;

    // Prix : laissé en blanc, écrit à la main
    y = titre('Le prix', y);
    const prix = [['Prix de vente TTC', '€'], ['Acompte versé à la commande', '€'], ['Solde à régler avant enlèvement', '€']];
    for (const [lib, u] of prix) {
        ecrire(lib, G, y, { taille: 10, police: gras });
        ligne(G + 220, D - 16, y - 3, NOIR, 0.6); ecrire(u, D - 10, y, { taille: 10 });
        y -= 24;
    }
    ecrire('Prix en toutes lettres', G, y, { taille: 7.5, couleur: GRIS }); ligne(G + 112, D, y - 2, NOIR, 0.6); y -= 30;

    // Règlement
    y = titre('Règlement par virement', y);
    const rib = [['Titulaire', v.titulaire], ['IBAN', v.iban], ['BIC', v.bic], ['Banque', v.banque]];
    page.drawRectangle({ x: G, y: y - rib.length * 17 + 8, width: L, height: rib.length * 17 + 6, color: rgb(0.965, 0.965, 0.97) });
    for (const [lib, val] of rib) { ecrire(lib, G + 10, y - 2, { taille: 7.5, couleur: GRIS }); ecrire(val, G + 90, y - 2, { taille: lib === 'IBAN' ? 11 : 9.5, police: lib === 'IBAN' || lib === 'Titulaire' ? gras : fr }); y -= 17; }
    y -= 14;
    if (propre(v.conditions)) y = paragraphe(v.conditions, G, y, L) - 10;

    // Signatures
    ecrire('Fait en deux exemplaires, à ______________________________ , le ____ / ____ / ________', G, y, { taille: 8.5, couleur: GRIS });
    y -= 26;
    const ls = (L - 28) / 2;
    [['Le vendeur', 'Cachet et signature'], ['L\'acheteur', 'Mention « Bon pour commande », signature']].forEach(([t, s], i) => {
        const x = G + i * (ls + 28);
        ecrire(t, x, y, { taille: 9.5, police: gras }); ecrire(s, x, y - 13, { taille: 7.5, couleur: GRIS });
        page.drawRectangle({ x, y: y - 92, width: ls, height: 72, borderColor: FILET, borderWidth: 0.6 });
    });

    return Buffer.from(await doc.save());
}

module.exports = { generer, VENDEUR_DEFAUT };
