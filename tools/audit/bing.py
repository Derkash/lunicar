"""Bing Webmaster (l'index que lit ChatGPT) : requêtes, trafic, crawl, liens entrants, pages connues.

    BING_API_KEY dans .env (ou l'environnement). python3 tools/audit/bing.py
"""
import json
import os
import re
from datetime import datetime
import urllib.parse
import urllib.request

from commun import RACINE, SITE, ecrire, tableau


def cle():
    if os.environ.get('BING_API_KEY'):
        return os.environ['BING_API_KEY']
    for f in ('.env', '.env.local'):
        p = os.path.join(RACINE, f)
        if os.path.exists(p):
            for l in open(p):
                if l.startswith('BING_API_KEY='):
                    return l.split('=', 1)[1].strip().strip('"\'')
    return ''


def api(methode, **params):
    q = urllib.parse.urlencode({'siteUrl': SITE + '/', 'apikey': cle(), **params})
    try:
        return json.load(urllib.request.urlopen(f'https://ssl.bing.com/webmaster/api.svc/json/{methode}?{q}', timeout=60)).get('d')
    except Exception as e:
        return {'erreur': str(e)[:120]}


def date_bing(v):
    m = re.search(r'(\d{10})', str(v))
    return datetime.utcfromtimestamp(int(m.group(1))).date().isoformat() if m else str(v)[:10]


def principal():
    if not cle():
        print('## Bing\n\nBING_API_KEY absente : section sautée.\n'); return
    req = api('GetQueryStats') or []
    crawl = api('GetCrawlStats') or []
    liens = api('GetLinkCounts', page=0) or {}
    trafic = api('GetRankAndTrafficStats') or []
    pages = api('GetPageStats') or []
    r = {'requetes': req if isinstance(req, list) else [], 'crawl': crawl if isinstance(crawl, list) else [],
         'liens': liens, 'trafic': trafic if isinstance(trafic, list) else [], 'pages': pages if isinstance(pages, list) else []}
    ecrire('bing.json', r)
    md = '## Bing Webmaster (index lu par ChatGPT et Copilot)\n\n'
    if r['requetes']:
        md += f"Requêtes : {len(r['requetes'])} · clics {sum(x.get('Clicks', 0) for x in r['requetes'])} · impressions {sum(x.get('Impressions', 0) for x in r['requetes'])}\n\n"
        md += tableau([[x['Query'], x.get('Clicks'), x.get('Impressions'), x.get('AvgImpressionPosition')] for x in sorted(r['requetes'], key=lambda x: -x.get('Impressions', 0))[:20]],
                      ['Requête', 'Clics', 'Impressions', 'Position'])
    else:
        md += f"Requêtes : {req}\n"
    if r['crawl']:
        d = r['crawl'][-7:]
        md += '\n### Crawl Bing (7 derniers jours)\n' + tableau([[date_bing(x.get('Date', '')), x.get('CrawledPages'), x.get('InIndex'), x.get('InLinks'), x.get('Code2xx'), x.get('Code301'), x.get('Code4xx'), x.get('Code5xx'), x.get('AllOtherCodes'), x.get('BlockedByRobotsTxt')] for x in d],
                                                                ['Date', 'Pages crawlées', 'Dans l\'index', 'Liens entrants', '2xx', '301', '4xx', '5xx', 'Autres (304…)', 'Bloquées robots'])
    if r['crawl']:
        d = r['crawl'][-7:]
        md += f"\nPages dans l'index Bing : **{d[-1].get('InIndex')}** · 4xx/5xx sur 7 jours : {sum((x.get('Code4xx') or 0) + (x.get('Code5xx') or 0) for x in d)} · pages crawlées sur 7 jours : {sum(x.get('CrawledPages') or 0 for x in d)}\n"
    md += f"\n### Liens entrants connus de Bing : **{liens.get('TotalPages', liens)}** pages liées\n"
    if r['pages']:
        md += '\n### Pages les plus vues sur Bing\n' + tableau([[x.get('Query', x.get('Url', '')).replace(SITE, ''), x.get('Clicks'), x.get('Impressions')] for x in sorted(r['pages'], key=lambda x: -x.get('Impressions', 0))[:15]], ['Page', 'Clics', 'Impressions'])
    print(md)


if __name__ == '__main__':
    principal()
