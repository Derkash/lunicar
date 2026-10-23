/**
 * LUNICAR - Gabarit des e-mails envoyés aux clients depuis l'admin.
 *
 * Un e-mail n'est pas une page web : tableaux, styles en ligne, 600 px de large,
 * logo en PNG (le WebP ne s'affiche pas dans Outlook) avec un texte alternatif
 * stylé quand les images sont bloquées. Identité du site : bandeau marine,
 * filet or, carte blanche.
 * Pas de texte d'aperçu caché (display:none) : certains filtres écartent
 * l'e-mail en silence (constaté sur Diatigui).
 */
const { SITE } = require('./config');

const C = {
    page: '#F3F1EC', card: '#FFFFFF', marine: '#0D2541', gold: '#B8923A', goldSoft: '#D4B26A',
    ink: '#121826', inkSoft: '#4A5163', inkMuted: '#6B7280', line: '#E7E2D8'
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Liens et adresses rendus cliquables dans le texte libre de l'admin.
const liens = s => s
    .replace(/\b(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${C.marine};font-weight:600">$1</a>`)
    .replace(/(^|[\s(])(lunicar\.fr)(?![\w/@-]|\.\w)/g, `$1<a href="${SITE.baseUrl}" style="color:${C.marine};font-weight:600;text-decoration:none">$2</a>`);

const P = t => `<p style="margin:0 0 16px;font-family:${FONT};font-size:15.5px;line-height:1.6;color:${C.ink}">${t}</p>`;

// Texte saisi dans l'admin -> HTML : paragraphes, listes « - », signature mise en forme.
function corps(texte) {
    const blocs = String(texte).replace(/\r\n?/g, '\n').split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
    return blocs.map(b => {
        const lignes = b.split('\n');
        if (/^(bien cordialement|cordialement|bonne journée|à bientôt)/i.test(lignes[0])) {
            return `<p style="margin:22px 0 0;padding-top:18px;border-top:1px solid ${C.line};font-family:${FONT};font-size:14.5px;line-height:1.55;color:${C.inkSoft}">${esc(lignes[0])}<br><strong style="color:${C.marine}">${esc(lignes[1] || "L'équipe LUNICAR")}</strong>${lignes.slice(2).map(l => `<br><span style="font-size:13.5px">${liens(esc(l))}</span>`).join('')}</p>`;
        }
        // Une phrase d'introduction puis des « - » : la phrase reste un paragraphe, les tirets une liste.
        const debut = lignes.findIndex(l => /^\s*[-•]\s+/.test(l));
        if (debut >= 0 && lignes.slice(debut).every(l => /^\s*[-•]\s+/.test(l))) {
            const intro = debut ? P(liens(esc(lignes.slice(0, debut).join(' ')))) : '';
            const items = lignes.slice(debut).map(l => `<tr><td style="width:18px;vertical-align:top;padding:0 0 8px;font-family:${FONT};font-size:15px;color:${C.gold}">&#9670;</td><td style="padding:0 0 8px;font-family:${FONT};font-size:15px;line-height:1.5;color:${C.ink}">${liens(esc(l.replace(/^\s*[-•]\s+/, '')))}</td></tr>`).join('');
            return `${intro}<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:-4px 0 16px">${items}</table>`;
        }
        return P(lignes.map(l => liens(esc(l))).join('<br>'));
    }).join('\n');
}

function layout({ titre, texte, pied = 'Vous recevez cet e-mail en réponse à votre demande sur lunicar.fr.' }) {
    const tel = SITE.phone ? `<span style="color:${C.inkMuted}"> · </span><a href="tel:+${SITE.phone.intl}" style="color:${C.marine};font-weight:600;text-decoration:none">${esc(SITE.phone.display)}</a>` : '';
    return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(titre)}</title></head>
<body style="margin:0;padding:0;background:${C.page}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}"><tr><td align="center" style="padding:26px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
  <tr><td style="background:${C.marine};border-radius:16px 16px 0 0;padding:22px 30px">
    <a href="${SITE.baseUrl}" style="text-decoration:none"><img src="${SITE.baseUrl}/images/logo-lunicar-blanc-h.png" width="176" height="38" alt="LUNICAR" style="display:block;border:0;width:176px;height:auto;font-family:${FONT};font-size:22px;font-weight:800;letter-spacing:.12em;color:#FFFFFF"></a>
  </td></tr>
  <tr><td style="background:${C.card};border-top:3px solid ${C.gold};border-radius:0 0 16px 16px;padding:32px 30px 28px">
    ${corps(texte)}
  </td></tr>
  <tr><td style="padding:20px 12px 0">
    <p style="margin:0 0 6px;font-family:${SERIF};font-style:italic;font-size:16px;color:${C.marine}">Vendez votre voiture simplement, partout en France.</p>
    <p style="margin:0 0 12px;font-family:${FONT};font-size:12.5px;line-height:1.5;color:${C.inkSoft}">Estimation gratuite, vérification par un technicien Lunicar à votre adresse, paiement par virement instantané si la vente est conclue.</p>
    <p style="margin:0 0 10px;font-family:${FONT};font-size:12.5px"><a href="${SITE.baseUrl}" style="color:${C.marine};font-weight:700;text-decoration:none">lunicar.fr</a><span style="color:${C.inkMuted}"> · </span><a href="mailto:${SITE.email}" style="color:${C.marine};font-weight:700;text-decoration:none">${SITE.email}</a>${tel}</p>
    <p style="margin:0;font-family:${FONT};font-size:11px;color:${C.inkMuted}">${esc(pied)}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

module.exports = { layout };
