// Test hors ligne de la Boîte mail (lib/boite.js), sans vraie boîte ni envoi réel :
// parsing des fixtures .eml, classement (utile / Autres), HTML assaini, lien avec une demande du CRM,
// notifications (jour, nuit, regroupement au matin), réponse par un transport factice avec le gabarit LUNICAR.
// Stockage dans un dossier temporaire (le data/crm.json du projet n'est pas touché).
//   node tools/boite/test_boite.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lunicar-boite-'));
for (const k of Object.keys(process.env)) if (/^(SUPABASE_|SMTP_|CONTACT_|IMAP_|APNS_|ANNONCES_IMAP)/.test(k)) delete process.env[k];
Object.assign(process.env, { DATA_DIR: TMP, CONTACT_IMAP_USER: 'contact@lunicar.fr', CONTACT_IMAP_PASS: 'x', CONTACT_FROM: 'LUNICAR <contact@lunicar.fr>', CONTACT_REPLY_TO: 'contact@lunicar.fr' });

const nodemailer = require('nodemailer');
const store = require('../../lib/store');
const contact = require('../../lib/contact-client');
const boite = require('../../lib/boite');

const FIX = path.join(__dirname, 'fixtures');
const lireFix = n => fs.readFileSync(path.join(FIX, n));
let ok = 0;
const vrai = (c, msg) => { assert.ok(c, msg); ok++; };

(async () => {
    // Une demande existante avec l'adresse de Jean (majuscules différentes).
    const d0 = store.ligneDepuisDemande({ id: 'ab12cd34-0000-4000-8000-000000000000', createdAt: '2026-10-20T08:00:00Z', prenom: 'Jean', nom: 'Dupont', email: 'jean.dupont@example.com', vehicule: 'Peugeot 208' });
    await store.enregistrerDemande(d0);

    // ---- Parsing et classement
    const lus = [];
    for (const [i, n] of ['client-lie.eml', 'client-inconnu.eml', 'leboncoin.eml', 'hostinger.eml', 'newsletter.eml', 'nous.eml'].entries()) lus.push(await boite.analyser(lireFix(n), { uid: 100 + i }));
    const [lie, inconnu, lbc, host, news, nous] = lus;
    vrai(lie.fiche.de === 'jean.dupont@example.com' && lie.fiche.nom === 'Jean Dupont', 'expéditeur');
    vrai(lie.fiche.message_id === '<lie-1@example.com>' && lie.fiche.references.includes('<envoi-1@lunicar.fr>'), 'message_id + références');
    vrai(/142 000 km/.test(lie.fiche.texte) && lie.fiche.extrait.length <= 180 && !/a écrit/.test(lie.fiche.extrait), 'texte + extrait sans citation');
    vrai(lie.fiche.pieces.length === 1 && lie.fiche.pieces[0].nom === 'compteur.jpg', 'pièces jointes listées (image intégrée exclue)');
    vrai(inconnu.fiche.pieces[0].nom === 'carte-grise.pdf', 'PDF listé');
    vrai(lie.fiche.categorie === 'utile' && inconnu.fiche.categorie === 'utile', 'clients = utiles');
    vrai(lbc.fiche.categorie === 'autre' && /Leboncoin/.test(lbc.fiche.raison), 'Leboncoin écarté');
    vrai(host.fiche.categorie === 'autre' && news.fiche.categorie === 'autre' && nous.fiche.categorie === 'autre', 'Hostinger, newsletter et nos envois écartés');
    vrai(boite.classer({ de: 'client@gmail.com', objet: 'Réponse automatique : absent', entetes: {} }).categorie === 'autre', 'réponse automatique écartée');

    // ---- HTML assaini
    const h = lie.html;
    vrai(h && !/<script|onerror|onclick|onmouseover|<iframe|<form|<input|<svg|javascript:|<style/i.test(h), 'HTML sans script ni événement ni formulaire');
    vrai(!/ src="https?:/i.test(h) && /data-lunicar-src="https:\/\/track\.example\/pixel\.gif"/.test(h), 'image distante neutralisée');
    vrai(/src="data:image\/png;base64,/.test(h), 'image cid: intégrée en data:');
    vrai(!/url\(/i.test(h) && /color:#123/.test(h), 'style sans url()');
    vrai(/href="https:\/\/lunicar\.fr\/x" target="_blank" rel="noopener noreferrer nofollow"/.test(h), 'lien http gardé');
    vrai(!/jav\s*ascript/i.test(boite.assainir('<a href="jav&#x09;ascript:alert(1)">x</a><img src=x onerror=alert(1)><p title="a>b">ok</p>')), 'javascript: encodé retiré');
    vrai(boite.assainir('<scr<script>ipt>alert(1)</script>') .indexOf('<script') < 0, 'balise script imbriquée retirée');

    // ---- Passage : premier passage sans notification, puis passage normal de jour
    const notifs = [];
    const envoyerNotif = p => { notifs.push(p); };
    const jour = new Date('2026-10-23T08:30:00Z'); // 10 h 30 à Paris
    const j0 = await boite.traiter([lus[3]], { initial: true, maintenant: jour, envoyerNotif });
    vrai(j0.nouveaux === 1 && !notifs.length, 'premier passage : rien notifié');
    const j1 = await boite.traiter(lus, { maintenant: jour, envoyerNotif });
    vrai(j1.nouveaux === 5 && j1.utiles === 2 && j1.autres === 3, 'dédoublonnage + compte');
    vrai(notifs.length === 1 && /2 nouveaux e-mails/.test(notifs[0].titre) && notifs[0].onglet === 'boite', 'notification regroupée');
    vrai(/Jean Dupont : Re: Votre demande/.test(notifs[0].texte), 'texte = expéditeur : objet');
    const j2 = await boite.traiter(lus, { maintenant: jour, envoyerNotif });
    vrai(j2.nouveaux === 0 && notifs.length === 1, 'rejouable sans doublon');

    // ---- Lien avec la demande : pastille + fil de la fiche, sans doublon avec « Vérifier les réponses »
    const liste = await boite.lister();
    const mLie = liste.find(m => m.de === 'jean.dupont@example.com');
    vrai(mLie.ref === d0.ref && j1.lies === 1, 'e-mail relié à la demande');
    let d = await store.lireDemande(d0.ref);
    vrai(d.suivi.emails.length === 1 && d.suivi.emails[0].sens === 'recu' && !/a écrit/.test(d.suivi.emails[0].texte), 'ajouté au fil, citation retirée');
    vrai(/E-mail reçu du client/.test(d.suivi.historique[0].quoi), 'historique');
    const memeViaReponses = { id: contact.idMail('<lie-1@example.com>', 999, 'x'), message_id: '<lie-1@example.com>', date: '2026-10-23T09:15:00.000Z', sens: 'recu' };
    vrai(contact.fusionEmails(d.suivi.emails, [memeViaReponses]).length === 1, 'pas de doublon avec lireReponses');
    vrai(!liste.some(m => 'texte' in m), 'liste sans texte complet');
    const lu = await boite.lire(mLie.id);
    vrai(lu.html && /142 000/.test(lu.html) && lu.message.texte, 'lecture avec HTML assaini');

    // ---- Nuit : retenue, puis regroupée au matin (sauf si lue entre-temps)
    notifs.length = 0;
    const nuit = new Date('2026-10-23T21:30:00Z'); // 23 h 30 à Paris
    vrai(boite.nuit(nuit) && boite.nuit(new Date('2026-10-24T04:30:00Z')) && !boite.nuit(new Date('2026-10-24T05:05:00Z')), 'plage 22 h - 7 h');
    const f1 = { id: 'n1', de: 'paul@example.net', nom: 'Paul', objet: 'Question', ref: '' }, f2 = { id: 'n2', de: 'paul@example.net', nom: 'Paul', objet: 'Photos', ref: '' };
    vrai(await boite.notifier([f1], nuit, envoyerNotif) === null && await boite.notifier([f2], nuit, envoyerNotif) === null && !notifs.length, 'rien la nuit');
    const matin = await boite.notifier([], new Date('2026-10-24T05:10:00Z'), envoyerNotif);
    vrai(matin && matin.titre === '📧 Paul (2 e-mails)' && /Photos\nQuestion/.test(matin.texte), 'regroupée au matin');
    vrai(await boite.notifier([], new Date('2026-10-24T05:13:00Z'), envoyerNotif) === null, 'pas renvoyée');
    const seul = boite.contenuNotif([{ id: 'z', qui: 'Jean Dupont', objet: 'Photos', ref: 'AB12CD34' }]);
    vrai(seul.titre === '📧 Jean Dupont' && seul.texte === 'Photos' && seul.ref === 'AB12CD34' && !seul.onglet, 'un e-mail lié : ouvre la fiche');
    const seul2 = boite.contenuNotif([{ id: 'z', qui: 'marie@example.org', objet: 'Clio', ref: '' }]);
    vrai(seul2.onglet === 'boite' && seul2.mail === 'z', 'non lié : ouvre la boîte sur l\'e-mail');

    // ---- Réponse : transport factice, gabarit, fil, garde-fous
    const envois = [];
    const fake = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    contact.utiliserTransport({ sendMail: async o => { const r = await fake.sendMail(o); envois.push(r.message.toString()); return r; } });
    const mod = boite.modeles(lu.message, await store.lireDemande(d0.ref));
    vrai(mod.some(m => m.id === 'fourchette') && mod.some(m => m.id === 'fonctionnement'), 'modèles de la fiche + généraux');
    const libres = boite.modeles(inconnu.fiche, null), tous = libres.map(m => m.texte).join('\n');
    vrai(/Bonjour Marie,/.test(libres[0].texte), 'salutation avec le prénom');
    vrai(/technicien/.test(tous) && /enlèvement est gratuit, partout en France/i.test(tous) && /virement instantané/.test(tous) && /fourchette indicative/.test(tous), 'règles éditoriales');
    vrai(!/optimerch|depuis paris|24 ?h|\d+ ?(heures|jours)/i.test(tous), 'ni OPTIMERCH, ni « depuis Paris », ni délai chiffré');
    vrai(boite.reObjet('Rachat de ma Clio') === 'Re: Rachat de ma Clio' && boite.reObjet('RE: x') === 'RE: x', 'objet Re:');
    const e = await contact.envoyerReponse({ a: 'marie.martin@example.org', objet: 'Re: Rachat de ma Clio', texte: libres.find(m => m.id === 'fonctionnement').texte, inReplyTo: '<inconnu-1@example.org>', references: [] });
    const brut = envois[0];
    vrai(/In-Reply-To: <inconnu-1@example\.org>/.test(brut) && /References: <inconnu-1@example\.org>/.test(brut), 'en réponse au fil');
    vrai(/text\/html/.test(brut) && /logo-lunicar-blanc-h\.png/.test(brut) && /Vous recevez cet e-mail en r=C3=A9ponse =C3=A0 votre message/.test(brut.replace(/=\n/g, '')), 'gabarit HTML LUNICAR (pied adapté)');
    vrai(/^To: marie\.martin@example\.org$/m.test(brut) && e.sens === 'envoye', 'destinataire');
    await assert.rejects(contact.envoyerReponse({ a: 'x@example.org', objet: 'Re: a', texte: 'Fourchette de [montant bas] €' }), /repère/); ok++;
    await assert.rejects(contact.envoyerReponse({ a: 'x@example.org', objet: 'Re: a', texte: 'Nous venons depuis Paris' }), /depuis Paris/i); ok++;
    await assert.rejects(contact.envoyerReponse({ a: 'pas-une-adresse', objet: 'Re: a', texte: 'x' }), /invalide/); ok++;

    // ---- Créer une demande depuis un e-mail non lié, puis rattachement
    const mInc = (await boite.lister()).find(m => m.de === 'marie.martin@example.org');
    const ligne = store.ligneDepuisDemande({ id: 'ef56ab78-0000-4000-8000-000000000000', prenom: 'Marie', nom: 'Martin', email: mInc.de, origine: 'E-mail' }, { origine: 'email' });
    await store.enregistrerDemande(ligne);
    vrai(await boite.lier([mInc.id], ligne.ref) === 1 && (await boite.lister()).find(m => m.id === mInc.id).ref === ligne.ref, 'lien après création');
    vrai(await boite.rattraper() === 0, 'rattrapage : plus d\'orphelin');

    // ---- Lu / non lu
    await boite.maj(mInc.id, { lu: true });
    vrai((await boite.lister()).find(m => m.id === mInc.id).lu === true, 'marquer lu');

    contact.utiliserTransport(null);
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(`Boîte mail : ${ok} vérifications réussies.`);
})().catch(e => { console.error('ÉCHEC :', e.message); process.exitCode = 1; });
