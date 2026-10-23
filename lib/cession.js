// Certificat de cession d'un véhicule d'occasion (Cerfa n° 15776*01) pré-rempli : le particulier vend à la société.
// Le formulaire officiel (assets/cerfa_15776-01.pdf) est rempli champ par champ, sur les deux exemplaires.
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const MODELE = path.join(__dirname, '..', 'assets', 'cerfa_15776-01.pdf');

// Société acheteuse par défaut (le SIRET est ajouté par l'utilisateur et mémorisé dans le réglage « societe »).
const SOCIETE_DEFAUT = {
    raison: 'YAK SERVICES', siret: '', num: '12', extension: '', type_voie: 'Rue', voie: 'du Général Lecorguillier',
    cp: '93330', commune: 'Neuilly-sur-Marne', lieu_signature: 'Neuilly-sur-Marne'
};

const trois = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? [m[3], m[2], m[1]] : ['', '', '']; };
const frDate = iso => { const [j, m, a] = trois(iso); return j ? `${j}/${m}/${a}` : ''; };

async function generer(c) {
    const doc = await PDFDocument.load(fs.readFileSync(MODELE), { ignoreEncryption: true });
    const form = doc.getForm();
    const police = await doc.embedFont(StandardFonts.Helvetica);
    for (const page of ['Page1', 'Page2']) {
        const nom = k => `topmostSubform[0].${page}[0].${k}[0]`;
        const texte = (k, v) => { try { const f = form.getTextField(nom(k)); const max = f.getMaxLength(); let t = String(v == null ? '' : v); if (max) t = t.slice(0, max); f.setText(t); } catch (e) { /* champ absent */ } };
        const radio = (k, v) => { try { if (v) form.getRadioGroup(nom(k)).select(v); } catch (e) { /* option absente */ } };
        const coche = (k, v) => { try { const f = form.getCheckBox(nom(k)); v ? f.check() : f.uncheck(); } catch (e) { /* */ } };
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
        radio('Groupe_de_boutons_radio3', c.vendeur_morale ? '1' : '2');
        if (!c.vendeur_morale && c.vendeur_sexe) radio('Groupe_de_boutons_radio2', c.vendeur_sexe === 'F' ? '2' : '1');
        texte('txt_IdentitéVendeur', c.vendeur_nom); texte('Num_Siret', c.vendeur_siret);
        texte('num_VoieAdresse', c.vendeur_num); texte('txt_ExtensionAdresse', c.vendeur_extension); texte('txt_TypeVoieAdresse', c.vendeur_type_voie);
        texte('txt_NomVoie', c.vendeur_voie); texte('num_CodePostalAdresse', c.vendeur_cp); texte('txt_CommuneAdresse', c.vendeur_commune);
        radio('Groupe_de_boutons_radio4', c.destruction ? '2' : '1');
        const [vj, vm, va] = trois(c.date_vente); const [hh, mm] = String(c.heure_vente || '').split(':');
        texte('num_DateVenteJour', vj); texte('num_DateVenteMois', vm); texte('num_DateVenteAnnée', va); texte('num_HoraireVente1', hh || ''); texte('num_HoraireVente2', mm || '');
        coche('ckb_ValidationDéclaration1', c.certif_situation); coche('ckb_ValidationDéclaration2', c.sans_transformation); coche('ckb_ValidationDéclaration3', false);
        texte('txt_LieuDéclaration1', c.lieu_signature); texte('num_DateDéclaration', frDate(c.date_vente));
        // Nouveau propriétaire (la société)
        radio('Groupe_de_boutons_radio5', '1');
        texte('txt_IdentitéAcheteur', c.acheteur_nom); texte('num_SiretAcheteur', String(c.acheteur_siret || '').replace(/\s/g, ''));
        texte('num_VoieAdresseAcheteur', c.acheteur_num); texte('txt_ExtensionAdresseAcheteur', c.acheteur_extension); texte('txt_TypeVoieAdresseAcheteur', c.acheteur_type_voie);
        texte('txt_NomVoieAdresseAcheteur', c.acheteur_voie); texte('num_CodePostalAdresseAcheteur', c.acheteur_cp); texte('txt_CommuneAdresseAcheteur', c.acheteur_commune);
        coche('ckb_ValidationDéclarationA1', true); coche('ckb_ValidationDéclarationA2', true);
        texte('txt_LieuDéclaration2', c.lieu_signature); texte('txt_dateDéclaration', frDate(c.date_vente));
    }
    form.updateFieldAppearances(police);
    return Buffer.from(await doc.save());
}

module.exports = { generer, SOCIETE_DEFAUT };
