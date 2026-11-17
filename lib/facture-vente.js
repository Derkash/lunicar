// Facture de vente d'un véhicule d'occasion. Régime de la marge par défaut (CGI art. 297 A) : la TVA n'apparaît
// nulle part (art. 297 E) et la mention « Régime particulier – Biens d'occasion » est obligatoire (ann. II art. 242 nonies A, I-16°).
// Régime normal (option art. 297 C) : prix HT, TVA 20 %, TTC.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { enLettres, euros } = require('./montant');

const NOIR = rgb(0.1, 0.1, 0.12), GRIS = rgb(0.42, 0.42, 0.46), FILET = rgb(0.78, 0.78, 0.8), FOND = rgb(0.965, 0.965, 0.97);
const propre = t => String(t == null ? '' : t).replace(/[  ]/g, ' ').replace(/[‐-‒]/g, '-').replace(/[^\x00-\xFF€’‘“”–—…•]/g, '').trim();
const MENTION_MARGE = 'Régime particulier – Biens d\'occasion';

async function generer(f) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    const fr = await doc.embedFont(StandardFonts.Helvetica), gras = await doc.embedFont(StandardFonts.HelveticaBold);
    const G = 48, D = 595.28 - 48, L = D - G;
    const ecrire = (t, x, y, { taille = 9.5, police = fr, couleur = NOIR, max, droite } = {}) => {
        let s = propre(t);
        if (max) while (s && police.widthOfTextAtSize(s, taille) > max) s = s.slice(0, -1);
        page.drawText(s, { x: droite ? x - police.widthOfTextAtSize(s, taille) : x, y, size: taille, font: police, color: couleur });
    };
    const ligne = (x1, x2, y, couleur = FILET, e = 0.6) => page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: e, color: couleur });
    const paragraphe = (t, x, y, larg, taille = 8, couleur = GRIS, police = fr) => {
        let l = '';
        for (const m of propre(t).split(/\s+/)) {
            const essai = l ? l + ' ' + m : m;
            if (police.widthOfTextAtSize(essai, taille) > larg && l) { ecrire(l, x, y, { taille, couleur, police }); y -= taille + 3.5; l = m; } else l = essai;
        }
        if (l) { ecrire(l, x, y, { taille, couleur, police }); y -= taille + 3.5; }
        return y;
    };
    const v = f.vendeur || {}, a = f.acheteur || {}, ve = f.vehicule || {};
    const marge = f.regime !== 'normal', ttc = Number(f.prix_ttc) || 0;
    let y = 790;

    // En-tête : vendeur à gauche, numéro et dates à droite
    ecrire(v.raison, G, y, { taille: 15, police: gras });
    let yv = y - 16;
    for (const t of [v.forme, v.adresse, v.cp_ville, v.email, v.telephone].filter(x => propre(x))) { ecrire(t, G, yv, { taille: 8.5, couleur: GRIS }); yv -= 11.5; }
    ecrire('FACTURE', D, y, { taille: 20, police: gras, droite: true });
    ecrire(`N° ${f.numero}`, D, y - 18, { taille: 10.5, police: gras, droite: true });
    ecrire(`Date de facture : ${f.date}`, D, y - 32, { taille: 8.5, couleur: GRIS, droite: true });
    ecrire(`Date de livraison : ${f.date_livraison || f.date}`, D, y - 43.5, { taille: 8.5, couleur: GRIS, droite: true });
    y = Math.min(yv, y - 56) - 10;
    ligne(G, D, y, NOIR, 1.2); y -= 24;

    // Client
    const xc = G + L / 2 + 10;
    ecrire('FACTURÉ À', xc, y, { taille: 8, police: gras, couleur: GRIS }); ligne(xc, D, y - 5);
    let ya = y - 20;
    const client = [a.societe, [a.prenom, a.nom].filter(Boolean).join(' '), a.adresse, a.cp_ville,
        a.siret && `SIRET ${a.siret}`, a.tva && `N° TVA ${a.tva}`, a.telephone, a.email].filter(x => propre(x));
    client.forEach((t, i) => { ecrire(t, xc, ya, { taille: i === 0 ? 10.5 : 9, police: i === 0 ? gras : fr, max: D - xc }); ya -= i === 0 ? 14 : 12; });
    ecrire('NATURE DE L\'OPÉRATION', G, y, { taille: 8, police: gras, couleur: GRIS }); ligne(G, G + L / 2 - 10, y - 5);
    ecrire('Livraison de biens', G, y - 20, { taille: 9.5 });
    if (propre(f.adresse_livraison)) { ecrire('Lieu de livraison', G, y - 36, { taille: 7.5, couleur: GRIS }); paragraphe(f.adresse_livraison, G, y - 48, L / 2 - 20, 9, NOIR); }
    y = Math.min(ya, y - 64) - 18;

    // Désignation
    page.drawRectangle({ x: G, y: y - 6, width: L, height: 20, color: FOND });
    ecrire('DÉSIGNATION', G + 8, y, { taille: 8, police: gras, couleur: GRIS });
    ecrire('QTÉ', D - 150, y, { taille: 8, police: gras, couleur: GRIS, droite: true });
    ecrire(marge ? 'PRIX' : 'PRIX HT', D - 8, y, { taille: 8, police: gras, couleur: GRIS, droite: true });
    y -= 26;
    const titre = ['Véhicule d\'occasion', ve.marque, ve.modele, ve.version].filter(x => propre(x)).join(' ');
    const ht = marge ? ttc : Math.round(ttc / 1.2 * 100) / 100, tva = Math.round((ttc - ht) * 100) / 100;
    ecrire(titre, G + 8, y, { taille: 10, police: gras, max: L - 190 });
    ecrire('1', D - 150, y, { taille: 10, droite: true });
    ecrire(euros(ht), D - 8, y, { taille: 10, police: gras, droite: true });
    y -= 16;
    const details = [['Immatriculation', ve.immatriculation], ['N° de série (VIN)', ve.vin], ['1re mise en circulation', ve.mise_circulation],
        ['Kilométrage au compteur', ve.kilometrage && `${ve.kilometrage} km`], ['Énergie', ve.energie], ['Couleur', ve.couleur]].filter(([, x]) => propre(x));
    for (const [lib, val] of details) { ecrire(lib, G + 8, y, { taille: 8, couleur: GRIS }); ecrire(val, G + 130, y, { taille: 8.5 }); y -= 12; }
    if (propre(f.observations)) y = paragraphe(f.observations, G + 8, y - 2, L - 190, 8, GRIS) - 2;
    y -= 8; ligne(G, D, y); y -= 20;

    // Totaux
    const xt = D - 230;
    const total = (lib, val, fort) => { ecrire(lib, xt, y, { taille: fort ? 10.5 : 9, police: fort ? gras : fr, couleur: fort ? NOIR : GRIS }); ecrire(val, D - 8, y, { taille: fort ? 11.5 : 9.5, police: fort ? gras : fr, droite: true }); y -= fort ? 20 : 15; };
    if (marge) total('Total à payer', euros(ttc), true);
    else { total('Total HT', euros(ht)); total('TVA 20 %', euros(tva)); total('Total TTC', euros(ttc), true); }
    const acompte = Number(f.acompte) || 0, paye = f.payee ? ttc : acompte;
    if (paye) { total(f.payee ? `Réglé le ${f.payee_le || f.date}${f.mode_reglement ? ' (' + f.mode_reglement + ')' : ''}` : 'Acompte reçu', '- ' + euros(paye)); total('Reste à payer', euros(Math.max(0, ttc - paye)), true); }
    y -= 4;
    y = paragraphe(`Arrêtée la présente facture à la somme de ${enLettres(ttc)}${marge ? '' : ' TTC'}.`, G, y, L, 8.5, NOIR) - 8;

    if (marge) {
        page.drawRectangle({ x: G, y: y - 28, width: L, height: 38, color: FOND });
        ecrire(MENTION_MARGE, G + 10, y - 4, { taille: 10, police: gras });
        ecrire('TVA sur la marge (CGI art. 297 A) : TVA non applicable sur le prix et non récupérable par l\'acheteur.', G + 10, y - 18, { taille: 8, couleur: GRIS });
        y -= 46;
    }

    // Règlement
    if (!f.payee && (propre(v.iban) || propre(f.mode_reglement))) {
        ecrire('RÈGLEMENT', G, y, { taille: 8, police: gras, couleur: GRIS }); ligne(G, D, y - 5); y -= 20;
        if (propre(f.mode_reglement)) { ecrire(`Mode : ${f.mode_reglement}${f.echeance ? ' · à régler le ' + f.echeance : ' · à réception'}`, G, y, { taille: 9 }); y -= 14; }
        if (propre(v.iban)) { ecrire(`Titulaire : ${v.titulaire || v.raison}   IBAN : ${v.iban}${v.bic ? '   BIC : ' + v.bic : ''}`, G, y, { taille: 9, max: L }); y -= 14; }
        y -= 6;
    }
    if (a.pro) y = paragraphe('En cas de retard de paiement : pénalités au taux de 3 fois le taux d\'intérêt légal et indemnité forfaitaire pour frais de recouvrement de 40 € (C. com. art. L441-10). Pas d\'escompte pour paiement anticipé.', G, y, L, 7.5) - 6;
    if (propre(f.conditions)) y = paragraphe(f.conditions, G, y, L, 7.5) - 6;

    // Pied de page : identité légale
    const pied = [[v.raison, v.forme].filter(Boolean).join(' · '), v.siret && `SIRET ${v.siret}`, v.rcs, v.tva && `N° TVA ${v.tva}`, v.ape && `APE ${v.ape}`].filter(x => propre(x)).join(' · ');
    ligne(G, D, 52); ecrire(pied, 595.28 / 2 - fr.widthOfTextAtSize(propre(pied), 7.5) / 2, 40, { taille: 7.5, couleur: GRIS });
    return Buffer.from(await doc.save());
}

module.exports = { generer, MENTION_MARGE };
