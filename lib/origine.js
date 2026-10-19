// Origine d'une demande : d'où vient le vendeur (pub Google Ads, Google naturel, ChatGPT…).
// Partagé par l'e-mail de demande et le tableau de bord de l'admin.

// Origine lisible d'une demande : pub Google Ads (campagne, groupe, mot-clé), ChatGPT, Google naturel…
function origine(d) {
    const p = String(d.provenance || '');
    const q = k => { const m = p.match(new RegExp(`(?:^|[&| ])${k}=([^&|]+)`)); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() : ''; };
    if (d.clic_ads || /gclid=|gbraid=|wbraid=/.test(p) || /utm_medium=cpc/.test(p)) {
        return ['Google Ads', q('utm_campaign') && `campagne « ${q('utm_campaign')} »`, q('utm_content') && `groupe « ${q('utm_content')} »`, q('utm_term') && `mot-clé « ${q('utm_term')} »`].filter(Boolean).join(' · ');
    }
    const ref = q('ref');
    if (/chatgpt|openai/i.test(ref + q('utm_source'))) return 'ChatGPT';
    if (/perplexity/i.test(ref)) return 'Perplexity';
    if (/google\./i.test(ref)) return 'Google (résultats naturels)';
    if (/bing\.|ecosia|qwant|duckduckgo/i.test(ref)) return 'Moteur de recherche (naturel)';
    if (q('utm_source')) return q('utm_source');
    return ref ? `Lien depuis ${ref.replace(/^https?:\/\//, '').split('/')[0]}` : 'Accès direct';
}

// Canal regroupé pour les statistiques : pub, google, ia, autres, inconnu.
// Les demandes récentes portent `origine` (calculée à la réception) ; les anciennes,
// importées de Gmail, n'ont parfois que la ligne « Provenance » ou rien du tout.
function canal(d) {
    const x = d || {};
    const o = String(x.origine || (x.autres && (x.autres.origine || x.autres.Origine)) || (x.provenance || x.clic_ads ? origine(x) : ''));
    if (!o) return 'inconnu';
    if (/^Google Ads/i.test(o)) return 'pub';
    if (/^Google/i.test(o)) return 'google';
    if (/chatgpt|perplexity|openai|claude|gemini|copilot/i.test(o)) return 'ia';
    return 'autres';
}

module.exports = { origine, canal };
