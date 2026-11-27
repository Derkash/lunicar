"""Resoumission immédiate à Google : sitemaps (Search Console) + notification URL_UPDATED (Indexing API).
Usage : python3 tools/audit/google_resoumettre.py /chemin1 /chemin2 ...
Jeton : secrets/gsc-token.json (portées webmasters + indexing)."""
import json, sys, urllib.request, urllib.parse
from pathlib import Path

RACINE = Path(__file__).resolve().parents[2]
TOKEN = RACINE / 'secrets' / 'gsc-token.json'
BASE = 'https://lunicar.fr'

def jeton():
    t = json.loads(TOKEN.read_text())
    data = urllib.parse.urlencode({'client_id': t['client_id'], 'client_secret': t['client_secret'],
                                   'refresh_token': t['refresh_token'], 'grant_type': 'refresh_token'}).encode()
    return json.load(urllib.request.urlopen(t['token_uri'], data))['access_token']

def appel(methode, url, at, corps=None):
    req = urllib.request.Request(url, method=methode, data=json.dumps(corps).encode() if corps else None,
                                 headers={'Authorization': f'Bearer {at}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r: return r.status, r.read().decode()[:200]
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:200]

at = jeton()
for site in ['sc-domain:lunicar.fr', f'{BASE}/']:
    for sm in ['sitemap.xml', 'sitemap-pages.xml', 'sitemap-villes.xml']:
        u = f"https://www.googleapis.com/webmasters/v3/sites/{urllib.parse.quote(site, safe='')}/sitemaps/{urllib.parse.quote(BASE + '/' + sm, safe='')}"
        print('sitemap', site, sm, appel('PUT', u, at)[0])
for chemin in sys.argv[1:]:
    st, txt = appel('POST', 'https://indexing.googleapis.com/v3/urlNotifications:publish', at, {'url': BASE + chemin, 'type': 'URL_UPDATED'})
    print('indexing', chemin, st, '' if st == 200 else txt)
