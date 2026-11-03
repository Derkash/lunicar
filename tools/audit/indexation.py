"""Indexation Google : état des sitemaps + inspection d'un échantillon stratifié d'URL (API URL Inspection).

    python3 tools/audit/indexation.py                 # 40 piliers + 80 villes + 40 petites communes
    AUDIT_ECHANTILLON=20 python3 tools/audit/indexation.py

Quota Google : 2 000 inspections/jour par propriété. Les résultats sont datés pour suivre l'évolution.
"""
import json
import os
import random
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

from commun import PROPRIETE, RACINE, SITE, ecrire, google_get, google_post, sitemap_urls, tableau, type_page

N = int(os.environ.get('AUDIT_ECHANTILLON', 40))


def inspecter(url):
    try:
        s = google_post('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
                        {'inspectionUrl': url, 'siteUrl': PROPRIETE})['inspectionResult']['indexStatusResult']
        return {'url': url, 'etat': s.get('coverageState'), 'crawl': s.get('lastCrawlTime', '')[:10],
                'canonique_google': s.get('googleCanonical', ''), 'robots': s.get('robotsTxtState'),
                'indexation': s.get('indexingState')}
    except Exception as e:
        return {'url': url, 'etat': 'ERREUR ' + str(e)[:80]}


def principal():
    sm = google_get(f'https://www.googleapis.com/webmasters/v3/sites/{urllib.parse.quote(PROPRIETE, safe="")}/sitemaps').get('sitemap', [])
    sitemaps = [[s['path'].replace(SITE, ''), s.get('lastDownloaded', '')[:10], s.get('errors', 0), s.get('warnings', 0),
                 sum(int(c.get('submitted', 0)) for c in s.get('contents', []))] for s in sm]

    urls = sitemap_urls()
    villes = json.load(open(os.path.join(RACINE, 'data', 'cities.json')))
    # Villes Île-de-France (cœur de cible) vs villes hors IDF (vagues nationales)
    idf = {c['slug'] for c in villes if c.get('dep') in ('75', '77', '78', '91', '92', '93', '94', '95')}
    piliers = [u for u in urls if type_page(u) not in ('ville',)]
    v_all = [u for u in urls if type_page(u) == 'ville']
    v_redigees = [u for u in v_all if u.split('/reprise-auto-')[-1] in idf]
    v_autres = [u for u in v_all if u not in set(v_redigees)]
    random.seed(int(os.environ.get('AUDIT_GRAINE', 42)))
    strates = {
        'piliers (situations, marques, régions, départements, articles)': random.sample(piliers, min(N, len(piliers))),
        'villes Île-de-France': random.sample(v_redigees, min(2 * N, len(v_redigees))) if v_redigees else [],
        'villes hors Île-de-France': random.sample(v_autres, min(N, len(v_autres))),
    }
    resultats = {}
    for nom, lst in strates.items():
        with ThreadPoolExecutor(5) as ex:
            resultats[nom] = list(ex.map(inspecter, lst))

    etats, canon = [], []
    for nom, lst in resultats.items():
        c = {}
        for r in lst:
            c[r['etat']] = c.get(r['etat'], 0) + 1
            if r.get('canonique_google') and r['canonique_google'] != r['url']:
                canon.append([r['url'].replace(SITE, ''), r['canonique_google'].replace(SITE, '')])
        n = len(lst) or 1
        idx = c.get('Submitted and indexed', 0)
        etats.append([nom, len(lst), idx, f'{100 * idx // n} %', c.get('Crawled - currently not indexed', 0),
                      c.get('Discovered - currently not indexed', 0), c.get('URL is unknown to Google', 0),
                      sum(v for k, v in c.items() if k not in ('Submitted and indexed', 'Crawled - currently not indexed', 'Discovered - currently not indexed', 'URL is unknown to Google'))])
    # Crawl trop ancien : indexée mais pas revue depuis > 60 jours → version périmée chez Google
    from datetime import date, timedelta
    vieux = [[r['url'].replace(SITE, ''), r['crawl']] for lst in resultats.values() for r in lst
             if r.get('crawl') and r['crawl'] < (date.today() - timedelta(days=60)).isoformat()]

    ecrire('indexation.json', {'sitemaps': sitemaps, 'strates': resultats, 'canoniques_differentes': canon, 'crawl_ancien': vieux,
                               'total_sitemap': len(urls), 'piliers': len(piliers), 'villes': len(v_all)})
    md = '## Indexation Google\n\n### Sitemaps (Search Console)\n'
    md += tableau(sitemaps, ['Sitemap', 'Téléchargé', 'Erreurs', 'Avert.', 'URL'])
    md += f'\nURL dans les sitemaps : {len(urls)} ({len(piliers)} piliers, {len(v_all)} villes).\n\n### Échantillon inspecté\n'
    md += tableau(etats, ['Strate', 'Inspectées', 'Indexées', '%', 'Explorée non indexée', 'Détectée non indexée', 'Inconnue', 'Autre'])
    if canon:
        md += '\n### Canonique choisie par Google ≠ URL (doublon perçu)\n' + tableau(canon, ['URL', 'Canonique Google'])
    if vieux:
        md += f'\n### Pages non recrawlées depuis plus de 60 jours ({len(vieux)})\n' + tableau(vieux[:25], ['URL', 'Dernier crawl'])
    print(md)


if __name__ == '__main__':
    principal()
