// Lecture d'une note de frais (photo ou PDF) : montants TTC / HT / TVA, date, fournisseur, catégorie, plaque citée.
// Claude lit le justificatif ; l'utilisateur vérifie toujours avant d'enregistrer.
const Anthropic = require('@anthropic-ai/sdk');
const store = require('./store');

const MODEL = process.env.OCR_MODEL || 'claude-haiku-4-5-20251001';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 60 * 1000, maxRetries: 2 }) : null;

const CONSIGNE = (categories) => `Tu lis un justificatif de dépense (ticket, facture, reçu, billet de train, péage, plein de carburant…) pour la comptabilité d'une société française qui rachète et revend des voitures d'occasion.
Extrais ce qui est réellement écrit, sans rien inventer. Montants en euros, avec le point décimal.
- montant_ttc : total payé TTC.
- montant_ht et tva : si la TVA figure sur le document (ou se déduit sans ambiguïté du taux affiché) ; sinon null.
- taux_tva : taux principal en % (20, 10, 5.5, 2.1) si indiqué, sinon null. S'il y a plusieurs taux, donne le détail dans "lignes_tva".
- tva_recuperable : true si c'est une facture ou un ticket détaillé faisant apparaître la TVA au nom ou utilisable par une entreprise (carburant gazole, péages, réparations, pièces, fournitures) ; false pour un billet de train de particulier sans TVA détaillée, une amende, une dépense sans justificatif de TVA ; null si incertain.
- date au format AAAA-MM-JJ.
- fournisseur : nom de l'enseigne ou de la société.
- categorie : la plus proche parmi ${JSON.stringify(categories)}.
- generale : true si c'est un frais général de la société (création de société, comptable, banque, logiciel, téléphone, assurance générale, publicité…), false s'il concerne a priori un véhicule précis (carburant, péage, train pour aller chercher une voiture, réparation, pièces, contrôle technique, carte grise…).
- plaque : immatriculation d'un véhicule si elle apparaît (format AB-123-CD), sinon null.
- libelle : courte description (ex. « Plein gazole Total Rungis », « Billet Paris → Lyon »).
- explication : une phrase pour le comptable disant à quoi sert cette dépense dans l'activité de rachat-revente de voitures (ex. « Carburant pour aller chercher une voiture achetée à Lyon »), formulée prudemment si le document ne le dit pas.
Réponds UNIQUEMENT par un objet JSON : {"montant_ttc": 0, "montant_ht": null, "tva": null, "taux_tva": null, "lignes_tva": [], "tva_recuperable": null, "date": "", "fournisseur": "", "categorie": "", "generale": true, "plaque": null, "libelle": "", "explication": "", "lisible": true}`;

async function lire(fichier, categories) {
    if (!client) throw new Error('ANTHROPIC_API_KEY non défini : lecture automatique indisponible');
    const pdf = /pdf/i.test(fichier.mimetype || '') || /\.pdf$/i.test(fichier.originalname || '');
    let bloc;
    if (pdf) {
        bloc = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fichier.buffer.toString('base64') } };
    } else {
        // Photo d'iPhone (HEIC, très grande) : convertie en JPEG raisonnable.
        let buf = fichier.buffer;
        try { const sharp = require('sharp'); buf = await sharp(buf).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(); } catch (e) { /* on envoie tel quel */ }
        bloc = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } };
    }
    const r = await client.messages.create({
        model: MODEL, max_tokens: 1200,
        messages: [{ role: 'user', content: [bloc, { type: 'text', text: CONSIGNE(categories) }] }]
    });
    const t = r.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    const num = v => v == null || v === '' ? null : Math.round(Number(String(v).replace(',', '.')) * 100) / 100;
    return {
        montant_ttc: num(j.montant_ttc), montant_ht: num(j.montant_ht), tva: num(j.tva), taux_tva: num(j.taux_tva),
        lignes_tva: Array.isArray(j.lignes_tva) ? j.lignes_tva.slice(0, 5) : [], tva_recuperable: typeof j.tva_recuperable === 'boolean' ? j.tva_recuperable : null,
        date: /^\d{4}-\d{2}-\d{2}$/.test(j.date || '') ? j.date : '', fournisseur: String(j.fournisseur || '').slice(0, 120),
        categorie: categories.includes(j.categorie) ? j.categorie : '', generale: j.generale !== false,
        plaque: j.plaque ? String(j.plaque).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^([A-Z]{2})(\d{3})([A-Z]{2})$/, '$1-$2-$3') : null,
        libelle: String(j.libelle || '').slice(0, 200), lisible: j.lisible !== false
    };
}

// Carte grise (certificat d'immatriculation) : lecture de TOUTES les rubriques imprimées (A à Z), pour mettre
// la fiche à jour avec les valeurs officielles et préparer le certificat de cession.
const RUBRIQUES_CG = [
    ['immatriculation', 'A', 'Immatriculation'], ['date_premiere_immatriculation', 'B', '1re immatriculation', 'date'],
    ['titulaire', 'C.1', 'Titulaire'], ['titulaire_nom', 'C.1.1', 'Nom ou raison sociale'], ['titulaire_prenom', 'C.1.2', 'Prénom(s)'],
    ['adresse_complete', 'C.3', 'Adresse du titulaire'], ['proprietaire', 'C.4a', 'Propriétaire du véhicule'], ['co_titulaire', 'C.4.1', 'Co-titulaire'],
    ['marque', 'D.1', 'Marque'], ['type_variante_version', 'D.2', 'Type, variante, version'], ['cnit', 'D.2.1', 'CNIT'], ['denomination_commerciale', 'D.3', 'Dénomination commerciale'],
    ['vin', 'E', 'N° d\'identification (VIN)'], ['ptac_technique', 'F.1', 'Masse max. technique (kg)'], ['ptac', 'F.2', 'PTAC (kg)'], ['ptra', 'F.3', 'PTRA (kg)'],
    ['masse_en_service', 'G', 'Masse en service (kg)'], ['poids_vide', 'G.1', 'Poids à vide national (kg)'], ['periode_validite', 'H', 'Période de validité'],
    ['date_certificat', 'I', 'Date du certificat', 'date'], ['categorie_ce', 'J', 'Catégorie CE'], ['genre', 'J.1', 'Genre national'], ['carrosserie_ce', 'J.2', 'Carrosserie CE'],
    ['carrosserie', 'J.3', 'Carrosserie nationale'], ['reception', 'K', 'N° de réception par type'], ['cylindree', 'P.1', 'Cylindrée (cm³)'], ['puissance_kw', 'P.2', 'Puissance nette (kW)'],
    ['energie', 'P.3', 'Énergie'], ['puissance_fiscale', 'P.6', 'Puissance fiscale (CV)'], ['rapport_puissance_masse', 'Q', 'Rapport puissance/masse (kW/kg)'],
    ['places_assises', 'S.1', 'Places assises'], ['places_debout', 'S.2', 'Places debout'], ['niveau_sonore', 'U.1', 'Niveau sonore à l\'arrêt (dB)'], ['regime_moteur', 'U.2', 'Régime moteur (min-1)'],
    ['co2', 'V.7', 'CO2 (g/km)'], ['classe_environnementale', 'V.9', 'Classe environnementale'], ['date_controle_technique', 'X.1', 'Visite technique', 'date'],
    ['taxe_regionale', 'Y.1', 'Taxe régionale (€)'], ['taxe_formation', 'Y.2', 'Taxe formation pro. (€)'], ['taxe_co2', 'Y.3', 'Taxe CO2 / malus (€)'], ['taxe_gestion', 'Y.4', 'Taxe de gestion (€)'],
    ['redevance_acheminement', 'Y.5', 'Redevance d\'acheminement (€)'], ['taxes_total', 'Y.6', 'Total des taxes (€)'], ['mentions', 'Z', 'Mentions spécifiques (Z.1 à Z.4)'],
    ['numero_formule', '', 'N° de formule']
];
const CONSIGNE_CG = `Tu lis la photo d'un certificat d'immatriculation français (carte grise). Lis TOUTES les rubriques imprimées et recopie-les exactement, sans rien inventer ; rubrique illisible ou absente = "".
Rubriques attendues (clé JSON = rubrique) :
${RUBRIQUES_CG.map(([k, code, lib, t]) => `- ${k} : ${code ? '(' + code + ') ' : ''}${lib}${t === 'date' ? ', au format AAAA-MM-JJ' : ''}`).join('\n')}
Précisions :
- titulaire : nom complet tel qu'imprimé (NOM puis prénoms, ou raison sociale) ; personne_morale : true si c'est une société (raison sociale, SIREN/SIRET).
- proprietaire (C.4a) : "oui" si la mention « EST LE PROPRIÉTAIRE DU VÉHICULE » est imprimée, "non" si elle est absente, "" si illisible.
- Adresse du titulaire (C.3) recopiée en entier dans adresse_complete, ET découpée : numero ("12"), extension ("bis", "ter" ou ""), type_voie ("rue", "avenue", "bd"…), voie (nom de la voie), complement (bâtiment, lieu-dit…), code_postal (5 chiffres), commune.
- vin : 17 caractères. numero_formule : le numéro de formule imprimé en haut (format AAAABB12345), sans espaces.
- Masses, cylindrée, puissances, places, CO2, montants : nombre seul, sans unité (point décimal).
- mentions : toutes les mentions Z.1 à Z.4 (ex. « véhicule de collection », « VGA », gage…) séparées par « ; ».
- Pour une carte grise ancien format (avant 2009), mets les informations équivalentes dans les mêmes clés.
- lisible : false si la photo est floue, coupée ou si ce n'est pas une carte grise ; illisibles : liste des rubriques que tu n'as pas pu lire avec certitude.
Réponds UNIQUEMENT par un objet JSON avec toutes ces clés plus "personne_morale", "numero", "extension", "type_voie", "voie", "complement", "code_postal", "commune", "lisible", "illisibles".`;

async function lireCarteGrise(fichier) {
    if (!client) throw new Error('ANTHROPIC_API_KEY non défini : lecture automatique indisponible');
    const pdf = /pdf/i.test(fichier.mimetype || '') || /\.pdf$/i.test(fichier.originalname || '');
    let bloc;
    if (pdf) bloc = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fichier.buffer.toString('base64') } };
    else {
        let buf = fichier.buffer;
        try { const sharp = require('sharp'); buf = await sharp(buf).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer(); } catch (e) { /* tel quel */ }
        bloc = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } };
    }
    const r = await client.messages.create({ model: process.env.CG_MODEL || 'claude-sonnet-5-5', max_tokens: 3000, messages: [{ role: 'user', content: [bloc, { type: 'text', text: CONSIGNE_CG }] }] });
    const t = r.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    const s = k => String(j[k] == null ? '' : j[k]).trim().slice(0, 300);
    const date = k => { const v = s(k), m = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/.exec(v); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
    const o = {};
    for (const [k, , , type] of RUBRIQUES_CG) o[k] = type === 'date' ? date(k) : s(k);
    o.immatriculation = o.immatriculation.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^([A-Z]{2})(\d{3})([A-Z]{2})$/, '$1-$2-$3');
    o.vin = o.vin.toUpperCase().replace(/[^A-Z0-9]/g, '');
    o.numero_formule = o.numero_formule.toUpperCase().replace(/\s/g, '');
    for (const k of ['numero', 'extension', 'type_voie', 'voie', 'complement', 'commune']) o[k] = s(k);
    o.code_postal = /^\d{5}$/.test(s('code_postal')) ? s('code_postal') : '';
    o.personne_morale = j.personne_morale === true;
    o.lisible = j.lisible !== false;
    o.illisibles = Array.isArray(j.illisibles) ? j.illisibles.map(String).slice(0, 40) : [];
    return o;
}

module.exports = { lire, lireCarteGrise, RUBRIQUES_CG, actif: () => !!client, store };
