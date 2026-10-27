/**
 * LUNICAR - Version Markdown d'une page HTML, pour les robots des assistants IA
 * (ChatGPT, Perplexity, Claude…) qui lisent plus sûrement du texte brut que du HTML.
 *
 * On ne garde que le contenu de <main> : titres, paragraphes, listes, tableaux, liens.
 * Navigation, formulaires, pied de page, scripts et SVG sont retirés.
 */
const { SITE } = require('./config');

const decode = s => String(s)
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(n));

// Texte d'un fragment HTML en ligne (gras, italique, liens), sans balises de bloc.
function inline(h) {
    return decode(String(h)
        .replace(/<(strong|b)>([\s\S]*?)<\/\1>/g, '**$2**')
        .replace(/<(em|i)>([\s\S]*?)<\/\1>/g, '*$2*')
        .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (m, href, t) => {
            const txt = t.replace(/<[^>]+>/g, '').trim();
            if (!txt || /^#/.test(href)) return txt;
            return `[${txt}](${/^https?:/.test(href) ? href : SITE.baseUrl + href})`;
        })
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/[ \t]+/g, ' ')).trim();
}

function table(t) {
    const rows = [...t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(r => [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => inline(c[1]).replace(/\|/g, '/').replace(/\n/g, ' ')));
    if (!rows.length) return '';
    const n = Math.max(...rows.map(r => r.length));
    const line = r => '| ' + [...r, ...Array(n - r.length).fill('')].join(' | ') + ' |';
    return [line(rows[0]), '| ' + Array(n).fill('---').join(' | ') + ' |', ...rows.slice(1).map(line)].join('\n');
}

function list(l, ordered) {
    return [...l.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m, i) => `${ordered ? `${i + 1}.` : '-'} ${inline(m[1]).replace(/\n+/g, ' ')}`).join('\n');
}

// Convertit le HTML complet d'une page en Markdown.
function markdown(doc, { path, title, modified } = {}) {
    let main = (/<main[^>]*>([\s\S]*?)<\/main>/.exec(doc) || [, doc])[1];
    main = main.replace(/<(script|style|svg|form|nav|button|select|textarea|noscript|picture|figure)[\s\S]*?<\/\1>/g, '').replace(/<(img|input|hr)[^>]*>/g, '');
    // Blocs : on remplace chaque élément par sa version Markdown, dans l'ordre d'apparition.
    const out = [];
    const re = /<(h1|h2|h3|h4|p|blockquote|table|ul|ol|dl|details|summary)([^>]*)>([\s\S]*?)<\/\1>/g;
    let m;
    const seen = new Set();
    while ((m = re.exec(main))) {
        const [, tag, , body] = m;
        let md = '';
        if (tag === 'h1') md = `# ${inline(body)}`;
        else if (tag === 'h2') md = `## ${inline(body)}`;
        else if (tag === 'h3') md = `### ${inline(body)}`;
        else if (tag === 'h4') md = `#### ${inline(body)}`;
        else if (tag === 'p' || tag === 'blockquote' || tag === 'summary') md = inline(body.replace(/<(ul|ol|table)[\s\S]*?<\/\1>/g, ''));
        else if (tag === 'table') md = table(body);
        else if (tag === 'ul' || tag === 'ol') md = list(body, tag === 'ol');
        else if (tag === 'dl') md = [...body.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)].map(x => `- **${inline(x[1])}** : ${inline(x[2])}`).join('\n');
        else if (tag === 'details') { re.lastIndex = m.index + m[0].indexOf('>') + 1; continue; }
        md = md.trim();
        if (!md || md.length < 3 || seen.has(md)) continue;
        seen.add(md);
        out.push(md);
    }
    const tete = [title ? `# ${title}` : '', `Source : ${SITE.baseUrl}${path || ''}`, modified ? `Mis à jour le ${modified}` : '', `${SITE.name} · ${SITE.email} · ${SITE.phone ? SITE.phone.display : ''}`].filter(Boolean).join('\n');
    const corps = out.join('\n\n').replace(/^# .*\n\n/, '');
    return `${tete}\n\n${corps}\n`;
}

module.exports = { markdown, inline };
