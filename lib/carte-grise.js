// Carte grise reçue du client (pièce jointe d'un e-mail, photo ajoutée à la fiche) : rangée avec les photos,
// lue par l'IA, puis la fiche est complétée SANS écraser ce qui est déjà renseigné (titulaire, adresse,
// n° de formule, VIN, plaque, année). Le certificat de cession se sert ensuite de data.carte_grise.
const store = require('./store');

const vide = v => v == null || String(v).trim() === '';
// Une lecture qui ressemble bien à une carte grise (et pas à une facture ou un selfie).
const estCarteGrise = lu => !!lu && (!!lu.numero_formule || (!!lu.immatriculation && !!lu.titulaire) || (!!lu.vin && !!lu.immatriculation));

// Complète data avec ce que la carte grise apporte ; renvoie les champs remplis (libellés) et les écarts constatés.
function integrer(data, lu, photoPath) {
    const d = { ...data }, remplis = [], ecarts = [], maintenant = new Date().toISOString();
    d.carte_grise = { ...lu, photo: photoPath || (data.carte_grise || {}).photo || '', lue_le: maintenant };
    const adresse = [lu.numero, lu.extension, lu.type_voie, lu.voie].filter(Boolean).join(' ') + (lu.complement ? ', ' + lu.complement : '');
    const annee = (lu.date_premiere_immatriculation || '').slice(0, 4);
    const pose = (k, v, lib, comparer = true) => {
        if (vide(v)) return;
        if (vide(d[k])) { d[k] = v; remplis.push(lib); return; }
        if (comparer && String(d[k]).replace(/[^A-Za-z0-9]/g, '').toLowerCase() !== String(v).replace(/[^A-Za-z0-9]/g, '').toLowerCase()) ecarts.push(`${lib} : fiche « ${d[k]} », carte grise « ${v} »`);
    };
    pose('nom_titulaire', lu.titulaire, 'titulaire');
    pose('numero_formule', lu.numero_formule, 'n° de formule');
    pose('adresse', adresse.trim(), 'adresse');
    pose('code_postal', lu.code_postal, 'code postal');
    pose('ville', lu.commune, 'ville');
    pose('plaque', lu.immatriculation, 'plaque');
    pose('vin', lu.vin, 'VIN');
    pose('annee', annee, 'année');
    if (!lu.personne_morale) { pose('nom', lu.titulaire_nom, 'nom', false); pose('prenom', lu.titulaire_prenom, 'prénom', false); }
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
                histo.push({ date: new Date().toISOString(), quoi: `Carte grise reçue (${origine}) et lue${lu.titulaire ? ' : ' + lu.titulaire : ''}${r.remplis.length ? ` · fiche complétée : ${r.remplis.join(', ')}` : ' · rien à compléter'}${r.ecarts.length ? ` · à vérifier — ${r.ecarts.join(' ; ')}` : ''}` });
                break;
            } catch (e) { console.error(`Carte grise ${ref} :`, e.message); }
        }
    }
    const frais = (await store.lireDemande(ref)) || d;
    const suivi = { ...frais.suivi, historique: [...histo.reverse(), ...((frais.suivi || {}).historique || [])].slice(0, 300) };
    await store.majDemande(ref, { photos: [...(frais.photos || []), ...ajoutees.map(a => a.ph)], suivi, ...(carte ? { data: { ...frais.data, ...data } } : {}) });
    return { photos: ajoutees.length, carte_grise: !!carte, detail: carte };
}

module.exports = { integrer, traiterPieces, estCarteGrise };
