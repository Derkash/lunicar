// Rendez-vous de rachat au format iCalendar : un fichier par rendez-vous (fiche) et un flux
// d'abonnement pour le Calendrier de l'iPhone (mis à jour tout seul).
const { SITE } = require('./config');

const AVEC = { abdoul: 'Abdoul-Khader', youssouf: 'Youssouf', deux: 'Abdoul-Khader et Youssouf' };
const esc = v => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
// Heure de Paris → UTC (gère l'heure d'été sans dépendance).
function utc(date, heure, plusMin = 0) {
    const [y, m, j] = date.split('-').map(Number), [h, mi] = heure.split(':').map(Number);
    let t = Date.UTC(y, m - 1, j, h, mi) + plusMin * 60000;
    const decal = new Date(t).toLocaleString('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'shortOffset' }).match(/GMT([+-]\d+)/);
    t -= (decal ? Number(decal[1]) : 1) * 3600000;
    return new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
// Ligne iCalendar repliée à 75 caractères.
const plier = l => l.match(/.{1,73}/g).join('\r\n ');

function evenement(d) {
    const x = d.data || {}, r = d.suivi.rdv;
    const nom = [x.prenom, x.nom].filter(Boolean).join(' ') || 'Vendeur';
    const titre = `${r.statut === 'annule' ? 'ANNULÉ · ' : ''}Rachat ${x.vehicule || 'véhicule'} · ${nom}`;
    const desc = [r.prix ? `Prix convenu : ${r.prix.toLocaleString('fr-FR')} €` : '', x.telephone ? `Tél. : ${x.telephone}` : '',
        [x.vehicule, x.annee, x.kilometrage ? `${Number(x.kilometrage).toLocaleString('fr-FR')} km` : ''].filter(Boolean).join(' · '),
        x.plaque ? `Plaque : ${x.plaque}` : '', `Qui y va : ${AVEC[r.avec] || ''}`, r.note ? `Note : ${r.note}` : '',
        `Fiche : ${SITE.baseUrl}/admino/demande/${d.ref}`].filter(Boolean).join('\n');
    return ['BEGIN:VEVENT', `UID:rdv-${d.ref}@lunicar.fr`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
        `DTSTART:${utc(r.date, r.heure)}`, `DTEND:${utc(r.date, r.heure, r.duree || 45)}`, `SUMMARY:${esc(titre)}`,
        `LOCATION:${esc(r.lieu || [x.code_postal, x.ville].filter(Boolean).join(' '))}`, `DESCRIPTION:${esc(desc)}`,
        `URL:${SITE.baseUrl}/admino/demande/${d.ref}`, `STATUS:${r.statut === 'annule' ? 'CANCELLED' : 'CONFIRMED'}`,
        ...(r.statut === 'prevu' ? ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Rendez-vous de rachat', 'TRIGGER:-PT90M', 'END:VALARM'] : []),
        'END:VEVENT'].map(plier);
}

function ics(demandes) {
    const ev = demandes.filter(d => d.suivi && d.suivi.rdv && d.suivi.rdv.date).flatMap(evenement);
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LUNICAR//Rendez-vous//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        'X-WR-CALNAME:Lunicar · rendez-vous', 'X-WR-TIMEZONE:Europe/Paris', 'REFRESH-INTERVAL;VALUE=DURATION:PT15M', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

module.exports = { ics, utc };
