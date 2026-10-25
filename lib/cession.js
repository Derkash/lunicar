// Certificat de cession d'un véhicule d'occasion (Cerfa n° 15776*01) pré-rempli : le particulier vend à la société.
// Fond utilisé : assets/certificat-cession-yak-services.pdf, scan du Cerfa portant déjà le tampon YAK SERVICES
// (sans champs remplissables). Les valeurs y sont écrites aux emplacements exacts des champs du formulaire
// officiel (assets/cerfa_15776-01.pdf, même format A4), sur les deux exemplaires.
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const MODELE = path.join(__dirname, '..', 'assets', 'cerfa_15776-01.pdf');               // positions des champs
const FOND = path.join(__dirname, '..', 'assets', 'certificat-cession-yak-services.pdf'); // scan tamponné
// Le scan est très légèrement décalé et étiré verticalement par rapport au formulaire officiel :
// correction réglée sur un rendu de test (points PDF). y corrigé = y + ech × (y − pivot).
const CALAGE = { dx: 1.5, dy: 0, ech: 0.0087, pivot: 409 };
// Mesures prises sur le scan vierge (300 dpi), par page et par champ : ligne de base (« base ») et, pour les
// champs en cases, la position de chaque séparateur (« cases »). Régénérer si le scan change.
const MESURES = require('./cession-calage.json');

// Société acheteuse par défaut (le SIRET est ajouté par l'utilisateur et mémorisé dans le réglage « societe »).
const SOCIETE_DEFAUT = {
    raison: 'YAK SERVICES', siret: '13193005900012', num: '12', extension: '', type_voie: 'Rue', voie: 'du Général Lecorguillier',
    cp: '93330', commune: 'Neuilly-sur-Marne', lieu_signature: 'Neuilly-sur-Marne'
};

const trois = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? [m[3], m[2], m[1]] : ['', '', '']; };
const frDate = iso => { const [j, m, a] = trois(iso); return j ? `${j}/${m}/${a}` : ''; };

async function generer(c) {
    const modele = await PDFDocument.load(fs.readFileSync(MODELE), { ignoreEncryption: true });
    const form = modele.getForm();
    const doc = await PDFDocument.load(fs.readFileSync(FOND));
    const police = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    ['Page1', 'Page2'].forEach((page, ip) => {
        const feuille = pages[ip];
        const nom = k => `topmostSubform[0].${page}[0].${k}[0]`;
        const rect = w => { const r = w.getRectangle(); return { x: r.x + CALAGE.dx, y: r.y + CALAGE.dy + CALAGE.ech * (r.y - CALAGE.pivot), width: r.width, height: r.height }; };
        // Texte dans la case du champ : en cases séparées (champ « peigne ») ou aligné à gauche.
        const mes = k => (MESURES[page] || {})[k] || {};
        const texte = (k, v) => {
            let f; try { f = form.getTextField(nom(k)); } catch (e) { return; }
            let t = String(v == null ? '' : v).trim(); if (!t) return;
            const max = f.getMaxLength(); if (max) t = t.slice(0, max);
            const r = rect(f.acroField.getWidgets()[0]);
            const m = mes(k);
            const y = m.base != null ? m.base + 1.8 : r.y + 3.2;   // juste au-dessus de la ligne imprimée
            let taille = Math.min(9, r.height * 0.78);
            if (max && f.isCombed()) {
                const cases = m.cases && m.cases.length === max + 1 ? m.cases : Array.from({ length: max + 1 }, (_, i) => r.x + i * r.width / max);
                [...t].forEach((ch, i) => {
                    const w = police.widthOfTextAtSize(ch, taille);
                    feuille.drawText(ch, { x: (cases[i] + cases[i + 1]) / 2 - w / 2, y, size: taille, font: police });
                });
                return;
            }
            while (taille > 5 && police.widthOfTextAtSize(t, taille) > r.width - 2) taille -= 0.5;
            feuille.drawText(t, { x: r.x + 1.5, y, size: taille, font: police });
        };
        // Croix dans la case : position mesurée sur le scan si disponible, sinon celle du formulaire officiel.
        const croix = (r, cle) => {
            const q = ((MESURES[page] || {})._cases || {})[cle];
            if (q && q.score >= 0.8) r = { x: q.x, y: q.y, width: q.w, height: q.w };
            const m = Math.min(r.width, r.height) * 0.2;
            const o = { thickness: 1.1 };
            feuille.drawLine({ start: { x: r.x + m, y: r.y + m }, end: { x: r.x + r.width - m, y: r.y + r.height - m }, ...o });
            feuille.drawLine({ start: { x: r.x + m, y: r.y + r.height - m }, end: { x: r.x + r.width - m, y: r.y + m }, ...o });
        };
        const radio = (k, v) => {
            if (!v) return;
            let g; try { g = form.getRadioGroup(nom(k)); } catch (e) { return; }
            const opts = g.getOptions();
            g.acroField.getWidgets().forEach((w, i) => {
                const on = w.getOnValue && w.getOnValue();
                const val = on ? on.decodeText() : opts[i];
                if (String(val) === String(v)) croix(rect(w), `${k}#${val}`);
            });
        };
        const coche = (k, v) => { if (!v) return; try { croix(rect(form.getCheckBox(nom(k)).acroField.getWidgets()[0]), k); } catch (e) { /* */ } };
        // Le véhicule
        texte('num_Immatriculation', c.immatriculation); texte('num_Identification', c.vin);
        const [ij, im, ia] = trois(c.date_immatriculation);
        texte('num_DateImmatriculationJour', ij); texte('num_DateImmatriculationMois', im); texte('num_DateImmatriculationAnnée', ia);
        texte('txt_MarqueVéhicule', c.marque); texte('txt_TypeVarianteVersionVéhicule', c.type_version); texte('txt_GenreNational', c.genre);
        texte('txt_DénominationCommerciale', c.denomination); texte('num_KilométrageCompteur', c.kilometrage);
        if (c.certificat_present) {
            radio('Groupe_de_boutons_radio1', '1');
            // Les deux premiers chiffres « 20 » sont déjà imprimés sur le formulaire.
            texte('num_Formule', String(c.numero_formule || '').replace(/\s/g, '').replace(/^20/, ''));
            const [cj, cm, ca] = String(c.numero_formule || '').trim() ? ['', '', ''] : trois(c.date_certificat); // ancien format seulement
            texte('num_DateCertificatJour', cj); texte('num_DateCertificatMois', cm); texte('num_DateCertificatAnnée', ca);
        } else {
            radio('Groupe_de_boutons_radio1', '2'); texte('txt_MotifAbscenceCertificat', c.motif_absence);
        }
        // Ancien propriétaire (le vendeur)
        // Personne physique / morale : cochée à la main par le technicien, sauf « personne morale » cochée explicitement.
        if (c.vendeur_morale) radio('Groupe_de_boutons_radio3', '1');
        if (!c.vendeur_morale && c.vendeur_sexe) radio('Groupe_de_boutons_radio2', c.vendeur_sexe === 'F' ? '2' : '1');
        texte('txt_IdentitéVendeur', c.vendeur_nom); texte('Num_Siret', c.vendeur_siret);
        texte('num_VoieAdresse', c.vendeur_num); texte('txt_ExtensionAdresse', c.vendeur_extension); texte('txt_TypeVoieAdresse', c.vendeur_type_voie);
        texte('txt_NomVoie', c.vendeur_voie); texte('num_CodePostalAdresse', c.vendeur_cp); texte('txt_CommuneAdresse', c.vendeur_commune);
        radio('Groupe_de_boutons_radio4', c.destruction ? '2' : '1');
        const [vj, vm, va] = trois(c.date_vente); const [hh, mm] = String(c.heure_vente || '').split(':');
        texte('num_DateVenteJour', vj); texte('num_DateVenteMois', vm); texte('num_DateVenteAnnée', va); texte('num_HoraireVente1', hh || ''); texte('num_HoraireVente2', mm || '');
        coche('ckb_ValidationDéclaration1', c.certif_situation); coche('ckb_ValidationDéclaration2', c.sans_transformation);
        texte('txt_LieuDéclaration1', c.lieu_signature); texte('num_DateDéclaration', frDate(c.date_vente));
        // Nouveau propriétaire (la société)
        radio('Groupe_de_boutons_radio5', '1');
        texte('txt_IdentitéAcheteur', c.acheteur_nom); texte('num_SiretAcheteur', String(c.acheteur_siret || '').replace(/\s/g, ''));
        texte('num_VoieAdresseAcheteur', c.acheteur_num); texte('txt_ExtensionAdresseAcheteur', c.acheteur_extension); texte('txt_TypeVoieAdresseAcheteur', c.acheteur_type_voie);
        texte('txt_NomVoieAdresseAcheteur', c.acheteur_voie); texte('num_CodePostalAdresseAcheteur', c.acheteur_cp); texte('txt_CommuneAdresseAcheteur', c.acheteur_commune);
        coche('ckb_ValidationDéclarationA1', true); coche('ckb_ValidationDéclarationA2', true);
        texte('txt_LieuDéclaration2', c.lieu_signature); texte('txt_dateDéclaration', frDate(c.date_vente));
    });
    return Buffer.from(await doc.save());
}

module.exports = { generer, SOCIETE_DEFAUT };
