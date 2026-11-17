// Carte grise reçue du client (pièce jointe d'un e-mail, photo ajoutée à la fiche) : rangée avec les photos,
// lue par l'IA, puis la fiche est complétée SANS écraser ce qui est déjà renseigné (titulaire, adresse,
// n° de formule, VIN, plaque, année). Le certificat de cession se sert ensuite de data.carte_grise.
const store = require('./store');

const vide = v => v == null || String(v).trim() === '';
// Une lecture qui ressemble bien à une carte grise (et pas à une facture ou un selfie).
const estCarteGrise = lu => !!lu && (!!lu.numero_formule || (!!lu.immatriculation && !!lu.titulaire) || (!!lu.vin && !!lu.immatriculation));

// La carte grise fait foi : chaque information officielle qu'elle porte REMPLACE celle de la fiche (l'ancienne
// valeur est gardée dans data.corrections et citée dans l'historique). Seuls le nom et le prénom du contact ne sont
// remplis que s'ils sont vides : la personne qui nous contacte n'est pas toujours le titulaire.
const ENERGIES = { GO: 'Diesel', ES: 'Essence', EL: 'Électrique', GP: 'GPL', EG: 'GPL', FE: 'Éthanol', FG: 'Éthanol', EH: 'Hybride', GH: 'Hybride', EE: 'Hybride', GL: 'Hybride', EN: 'Hybride', GN: 'GNV' };
const titre = v => String(v || '').toLowerCase().replace(/(^|[\s-])\S/g, c => c.toUpperCase());
function integrer(data, lu, photoPath) {
    const d = { ...data }, remplis = [], ecarts = [], maintenant = new Date().toISOString();
    d.carte_grise = { ...lu, photo: photoPath || (data.carte_grise || {}).photo || '', lue_le: maintenant };
    const adresse = [[lu.numero, lu.extension, lu.type_voie, lu.voie].filter(Boolean).join(' '), lu.complement].filter(Boolean).join(', ');
    const annee = (lu.date_premiere_immatriculation || '').slice(0, 4);
    const norm = v => String(v == null ? '' : v).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    // remplace : la carte grise gagne ; siVide : complète seulement.
    const pose = (k, v, lib, remplace = true) => {
        if (vide(v)) return;
        v = String(v).trim();
        if (vide(d[k])) { d[k] = v; remplis.push(lib); return; }
        if (norm(d[k]) === norm(v)) return;
        if (!remplace) { ecarts.push(`${lib} : fiche « ${d[k]} », carte grise « ${v} »`); return; }
        d.corrections = [...(d.corrections || []), { champ: k, avant: d[k], apres: v, date: maintenant, source: 'carte grise' }].slice(-50);
        remplis.push(`${lib} (${d[k]} → ${v})`);
        d[k] = v;
    };
    pose('plaque', lu.immatriculation, 'plaque');
    pose('vin', lu.vin, 'VIN');
    pose('annee', annee, 'année');
    pose('date_mise_circulation', lu.date_premiere_immatriculation, 'date de 1re immatriculation');
    pose('numero_formule', lu.numero_formule, 'n° de formule');
    pose('nom_titulaire', lu.titulaire, 'titulaire');
    pose('co_titulaire', lu.co_titulaire, 'co-titulaire');
    pose('adresse', adresse || lu.adresse_complete, 'adresse');
    pose('code_postal', lu.code_postal, 'code postal');
    pose('ville', titre(lu.commune), 'ville');
    pose('marque', titre(lu.marque), 'marque');
    pose('carburant', ENERGIES[String(lu.energie || '').toUpperCase().slice(0, 2)] || '', 'carburant');
    pose('puissance_siv', lu.puissance_fiscale ? `${String(lu.puissance_fiscale).replace(/\D/g, '')} CV` : '', 'puissance fiscale');
    if (lu.date_controle_technique) pose('date_controle_technique', lu.date_controle_technique, 'visite technique');
    if (!lu.personne_morale) { pose('nom', lu.titulaire_nom, 'nom', false); pose('prenom', lu.titulaire_prenom, 'prénom', false); }
    if (d.telephone_intl && vide(d.telephone)) delete d.telephone_intl;
    return { data: d, remplis, ecarts };
}

// fichiers : [{ nom, type, contenu (Buffer) }]. Range tout avec les photos, lit la carte grise si l'IA est active,
// complète la fiche. origine : texte pour l'historique (« réponse e-mail du client »…).
async function traiterPieces(ref, fichiers, { origine = 'e-mail du client' } = {}) {
    const d = await store.lireDemande(ref);
    if (!d || !(fichiers || []).length) return { photos: 0, carte_grise: false };
    const jour = new Date().toISOString().slice(0, 10), photos = [...(d.photos || [])], ajoutees = [];
    for (const f of fichiers.slice(0, 10)) {
        try { const ph = await store.ajouterPhoto(d.dossier, `${jour}_mail_${Date.now()}_${String(f.nom || 'piece').replace(/[^\w.\-]+/g, '_').slice(0, 80)}`, f.contenu); photos.push(ph); ajoutees.push({ f, ph }); } catch (e) { /* pièce illisible */ }
    }
    const histo = [], maintenant = new Date().toISOString();
    let data = d.data, carte = null;
    if (ajoutees.length) histo.push({ date: maintenant, quoi: `${ajoutees.length} pièce${ajoutees.length > 1 ? 's' : ''} jointe${ajoutees.length > 1 ? 's' : ''} (${origine}) ajoutée${ajoutees.length > 1 ? 's' : ''} aux photos : ${ajoutees.map(a => a.f.nom).join(', ')}` });
    // Lecture : au plus 3 pièces, on s'arrête à la première carte grise reconnue.
    const ocr = require('./ocr');
    if (ocr.actif()) {
        for (const a of ajoutees.filter(a => /^(image\/|application\/pdf)/.test(a.f.type || '')).slice(0, 3)) {
            try {
                const lu = await ocr.lireCarteGrise({ buffer: a.f.contenu, mimetype: a.f.type, originalname: a.f.nom });
                if (!estCarteGrise(lu)) continue;
                const r = integrer(data, lu, a.ph.path);
                data = r.data; carte = { lu, remplis: r.remplis, ecarts: r.ecarts, photo: a.ph.path };
                histo.push({ date: new Date().toISOString(), quoi: `Carte grise reçue (${origine}) et lue${lu.titulaire ? ' : ' + lu.titulaire : ''}${r.remplis.length ? ` · fiche mise à jour : ${r.remplis.join(', ')}` : ' · fiche déjà conforme'}${r.ecarts.length ? ` · à vérifier — ${r.ecarts.join(' ; ')}` : ''}${lu.illisibles && lu.illisibles.length ? ` · illisible : ${lu.illisibles.join(', ')}` : ''}${lu.lisible === false ? ' · photo difficile à lire, à contrôler' : ''}` });
                break;
            } catch (e) { console.error(`Carte grise ${ref} :`, e.message); }
        }
    }
    const frais = (await store.lireDemande(ref)) || d;
    const suivi = { ...frais.suivi, historique: [...histo.reverse(), ...((frais.suivi || {}).historique || [])].slice(0, 300) };
    await store.majDemande(ref, { photos: [...(frais.photos || []), ...ajoutees.map(a => a.ph)], suivi, ...(carte ? { data: { ...frais.data, ...data } } : {}) });
    return { photos: ajoutees.length, carte_grise: !!carte, detail: carte };
}

module.exports = { integrer, traiterPieces, estCarteGrise, ENERGIES };
