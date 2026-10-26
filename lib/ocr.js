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

// Carte grise (certificat d'immatriculation) : ce que l'API plaque ne donne pas — titulaire, adresse,
// numéro de formule, date du certificat — plus les champs du véhicule pour contrôle.
const CONSIGNE_CG = `Tu lis la photo d'un certificat d'immatriculation français (carte grise). Recopie exactement ce qui est imprimé, sans rien inventer ; champ illisible ou absent = "".
- immatriculation (A), date_premiere_immatriculation (B) au format AAAA-MM-JJ.
- titulaire (C.1) : nom complet tel qu'imprimé (NOM puis prénoms, ou raison sociale) ; titulaire_nom et titulaire_prenom séparés si c'est une personne ; personne_morale : true si c'est une société (raison sociale, SIREN/SIRET).
- co_titulaire (C.4.1 ou mention « co-titulaire ») s'il y en a un.
- adresse du titulaire (C.3) découpée : numero (ex. "12"), extension ("bis", "ter" ou ""), type_voie ("rue", "avenue", "bd", "chemin"…), voie (nom de la voie, ex. "des Lilas"), complement (bâtiment, lieu-dit…), code_postal (5 chiffres), commune.
- marque (D.1), type_variante_version (D.2), denomination_commerciale (D.3), vin (E, 17 caractères), genre (J.1, ex. VP), carrosserie (J.3), energie (P.3, ex. GO, ES, EL, EH), puissance_fiscale (P.6), date_certificat (I) au format AAAA-MM-JJ.
- numero_formule : le numéro de formule imprimé en haut du certificat (format AAAABB12345, ex. 2014AB12345), sans espaces.
Réponds UNIQUEMENT par un objet JSON : {"immatriculation":"","date_premiere_immatriculation":"","titulaire":"","titulaire_nom":"","titulaire_prenom":"","personne_morale":false,"co_titulaire":"","numero":"","extension":"","type_voie":"","voie":"","complement":"","code_postal":"","commune":"","marque":"","type_variante_version":"","denomination_commerciale":"","vin":"","genre":"","carrosserie":"","energie":"","puissance_fiscale":"","date_certificat":"","numero_formule":"","lisible":true}`;

async function lireCarteGrise(fichier) {
    if (!client) throw new Error('ANTHROPIC_API_KEY non défini : lecture automatique indisponible');
    const pdf = /pdf/i.test(fichier.mimetype || '') || /\.pdf$/i.test(fichier.originalname || '');
    let bloc;
    if (pdf) bloc = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fichier.buffer.toString('base64') } };
    else {
        let buf = fichier.buffer;
        try { const sharp = require('sharp'); buf = await sharp(buf).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer(); } catch (e) { /* tel quel */ }
        bloc = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } };
    }
    const r = await client.messages.create({ model: process.env.CG_MODEL || 'claude-sonnet-5-5', max_tokens: 1500, messages: [{ role: 'user', content: [bloc, { type: 'text', text: CONSIGNE_CG }] }] });
    const t = r.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    const s = k => String(j[k] == null ? '' : j[k]).trim().slice(0, 200);
    const date = k => /^\d{4}-\d{2}-\d{2}$/.test(s(k)) ? s(k) : '';
    const plaque = s('immatriculation').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^([A-Z]{2})(\d{3})([A-Z]{2})$/, '$1-$2-$3');
    return {
        immatriculation: plaque, date_premiere_immatriculation: date('date_premiere_immatriculation'), titulaire: s('titulaire'), titulaire_nom: s('titulaire_nom'), titulaire_prenom: s('titulaire_prenom'),
        personne_morale: j.personne_morale === true, co_titulaire: s('co_titulaire'), numero: s('numero'), extension: s('extension'), type_voie: s('type_voie'), voie: s('voie'), complement: s('complement'),
        code_postal: /^\d{5}$/.test(s('code_postal')) ? s('code_postal') : '', commune: s('commune'), marque: s('marque'), type_variante_version: s('type_variante_version'),
        denomination_commerciale: s('denomination_commerciale'), vin: s('vin').toUpperCase().replace(/[^A-Z0-9]/g, ''), genre: s('genre'), carrosserie: s('carrosserie'), energie: s('energie'),
        puissance_fiscale: s('puissance_fiscale'), date_certificat: date('date_certificat'), numero_formule: s('numero_formule').toUpperCase().replace(/\s/g, ''), lisible: j.lisible !== false
    };
}

module.exports = { lire, lireCarteGrise, actif: () => !!client, store };
