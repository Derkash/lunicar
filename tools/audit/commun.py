"""Briques communes de l'audit SEO/GEO : jeton Google, requêtes Search Console, écriture des sorties.

Aucune dépendance hors bibliothèque standard (Python 3.9+).
Jeton Google OAuth (scopes webmasters + analytics.readonly) : secrets/gsc-token.json
(ou variable GSC_TOKEN). Le fichier n'est jamais lu ailleurs ni affiché.
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date, timedelta

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
SITE = os.environ.get('AUDIT_SITE', 'https://lunicar.fr')
PROPRIETE = os.environ.get('GSC_PROPRIETE', 'sc-domain:lunicar.fr')
GA4 = os.environ.get('GA4_PROPRIETE', '502773704')
MARQUE = re.compile(os.environ.get('AUDIT_MARQUE', r'luni|lunicar|winacar'), re.I)
SORTIE = os.environ.get('AUDIT_DIR') or os.path.join(
    os.path.expanduser('~/Library/Mobile Documents/com~apple~CloudDocs/Projects/work/lunicar-audit'),
    date.today().isoformat() + '-audit')

_jeton = None


def jeton():
    """Jeton d'accès Google rafraîchi depuis le refresh_token local."""
    global _jeton
    if _jeton:
        return _jeton
    chemin = os.environ.get('GSC_TOKEN') or os.path.join(RACINE, 'secrets', 'gsc-token.json')
    if not os.path.exists(chemin):
        sys.exit(f'Jeton Google absent : {chemin} (voir tools/audit/README.md)')
    t = json.load(open(chemin))
    corps = urllib.parse.urlencode({
        'client_id': t['client_id'], 'client_secret': t['client_secret'],
        'refresh_token': t['refresh_token'], 'grant_type': 'refresh_token'}).encode()
    r = urllib.request.urlopen(urllib.request.Request(t.get('token_uri', 'https://oauth2.googleapis.com/token'), corps))
    _jeton = json.load(r)['access_token']
    return _jeton


def google_post(url, corps):
    r = urllib.request.Request(url, json.dumps(corps).encode(),
                               {'Authorization': 'Bearer ' + jeton(), 'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(r, timeout=120))


def google_get(url):
    r = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + jeton()})
    return json.load(urllib.request.urlopen(r, timeout=120))


def gsc(debut, fin, dimensions, filtres=None, limite=25000):
    """Lignes Search Analytics (dataState=all pour inclure les jours provisoires)."""
    corps = {'startDate': str(debut), 'endDate': str(fin), 'dimensions': dimensions,
             'rowLimit': limite, 'dataState': 'all'}
    if filtres:
        corps['dimensionFilterGroups'] = [{'filters': filtres}]
    url = f'https://www.googleapis.com/webmasters/v3/sites/{urllib.parse.quote(PROPRIETE, safe="")}/searchAnalytics/query'
    return google_post(url, corps).get('rows', [])


def agreger(lignes):
    """(clics, impressions, position moyenne pondérée) d'une liste de lignes."""
    c = sum(r['clicks'] for r in lignes)
    i = sum(r['impressions'] for r in lignes)
    p = sum(r['position'] * r['impressions'] for r in lignes) / i if i else 0
    return c, i, round(p, 1)


def fenetres(jours=28, fin=None):
    """Fenêtre courante et fenêtre précédente de même longueur (fin = avant-hier par défaut, données stables)."""
    fin = fin or (date.today() - timedelta(days=2))
    debut = fin - timedelta(days=jours - 1)
    return debut, fin, debut - timedelta(days=jours), debut - timedelta(days=1)


def telecharger(url, ua='Mozilla/5.0 (compatible; LunicarAudit/1.0)', delai=30):
    """(statut, en-têtes, corps texte) ; ne suit pas les redirections pour pouvoir les mesurer."""
    class SansRedirection(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    ouvreur = urllib.request.build_opener(SansRedirection)
    try:
        r = ouvreur.open(urllib.request.Request(url, headers={'User-Agent': ua}), timeout=delai)
        return r.status, {k.title(): v for k, v in r.headers.items()}, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, {k.title(): v for k, v in e.headers.items()}, e.read().decode('utf-8', 'replace')
    except Exception as e:
        return 0, {}, str(e)


def sitemap_urls(url=None):
    """Toutes les URL d'un sitemap ou d'un index de sitemaps."""
    url = url or SITE + '/sitemap.xml'
    _, _, x = telecharger(url)
    sous = re.findall(r'<sitemap>\s*<loc>([^<]+)', x)
    if sous:
        return [u for s in sous for u in sitemap_urls(s)]
    return re.findall(r'<loc>([^<]+)', x)


def type_page(url):
    """Famille d'une URL lunicar.fr : accueil, ville, departement, region, marque, modele, situation, article, autre."""
    p = url.replace(SITE, '') or '/'
    if p == '/':
        return 'accueil'
    if p.startswith('/article'):
        return 'article'
    if re.match(r'/reprise-auto-', p):
        return 'ville'
    if re.match(r'/rachat-voiture-[a-z-]+-\d{2,3}$', p) or re.match(r'/rachat-voiture-corse-du-sud-2a|/rachat-voiture-haute-corse-2b', p):
        return 'departement'
    if re.match(r'/rachat-voiture-(ile-de-france|bretagne|normandie|grand-est|occitanie|corse|hauts-de-france|nouvelle-aquitaine|pays-de-la-loire|centre-val-de-loire|bourgogne-franche-comte|auvergne-rhone-alpes|provence-alpes-cote-d-azur)$', p):
        return 'region'
    if re.match(r'/reprise-[a-z]+$', p) and p != '/reprise':
        return 'marque'
    if re.match(r'/reprise-[a-z]+-[a-z0-9-]+$', p):
        return 'modele'
    if p.startswith('/rachat-voiture') or p.startswith('/vendre') or p.startswith('/rachat-'):
        return 'situation'
    return 'autre'


def ecrire(nom, donnees):
    """Écrit un JSON dans le dossier d'audit du jour et renvoie son chemin."""
    os.makedirs(SORTIE, exist_ok=True)
    chemin = os.path.join(SORTIE, nom)
    with open(chemin, 'w') as f:
        json.dump(donnees, f, ensure_ascii=False, indent=1)
    return chemin


def tableau(lignes, entetes):
    """Tableau Markdown."""
    s = '| ' + ' | '.join(entetes) + ' |\n|' + '|'.join('---' for _ in entetes) + '|\n'
    for l in lignes:
        s += '| ' + ' | '.join(str(x) for x in l) + ' |\n'
    return s
