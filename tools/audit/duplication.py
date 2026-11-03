"""Contenu gabarit vs contenu unique : part du texte commune aux pages, quasi-doublons (MinHash maison),
poids du HTML, du formulaire et du JSON-LD, balises on-page (title/description/H1 dupliqués ou hors gabarit).

    python3 tools/audit/duplication.py                 # 60 pages villes + 20 piliers
    AUDIT_ECHANTILLON=100 python3 tools/audit/duplication.py
"""
import hashlib
import html
import itertools
import os
import random
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from commun import SITE, ecrire, sitemap_urls, tableau, telecharger, type_page

N = int(os.environ.get('AUDIT_ECHANTILLON', 60))
K = 128  # permutations MinHash


def texte(h):
    h = re.sub(r'(?is)<(script|style|nav|footer|header|form|noscript)[^>]*>.*?</\1>', ' ', h)
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', h))).strip()


def shingles(t, n=5):
    w = re.findall(r'\w+', t.lower())
    return {' '.join(w[i:i + n]) for i in range(max(0, len(w) - n))}


def minhash(s):
    hs = [int(hashlib.blake2b(x.encode(), digest_size=8).hexdigest(), 16) for x in s] or [0]
    return [min((h ^ (i * 0x9E3779B97F4A7C15)) & 0xFFFFFFFFFFFFFFFF for h in hs) for i in range(K)]


def meta(h):
    g = lambda p: (re.search(p, h, re.S) or [None, ''])[1]
    return {'title': html.unescape(g(r'<title>([^<]*)')).strip(),
            'description': html.unescape(g(r'<meta name="description" content="([^"]*)')).strip(),
            'h1': html.unescape(re.sub(r'<[^>]+>', '', g(r'<h1[^>]*>(.*?)</h1>'))).strip(),
            'canonical': g(r'<link rel="canonical" href="([^"]*)'),
            'robots': g(r'<meta name="robots" content="([^"]*)'),
            'h2': len(re.findall(r'<h2', h)), 'liens_internes': len(set(re.findall(r'href="(/[^"#?]*)', h))),
            'ldjson': sum(len(x) for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S)),
            'form': sum(len(x) for x in re.findall(r'<form.*?</form>', h, re.S)), 'html': len(h),
            'images_sans_alt': len(re.findall(r'<img(?![^>]*\balt=)[^>]*>', h))}


def principal():
    urls = sitemap_urls()
    random.seed(int(os.environ.get('AUDIT_GRAINE', 42)))
    villes = [u for u in urls if type_page(u) == 'ville']
    piliers = [u for u in urls if type_page(u) != 'ville']
    ech = random.sample(villes, min(N, len(villes))) + random.sample(piliers, min(N // 3, len(piliers)))
    with ThreadPoolExecutor(5) as ex:
        pages = {u: r for u, r in zip(ech, ex.map(lambda u: telecharger(u), ech))}
    ok = {u: h for u, (s, _, h) in pages.items() if s == 200}
    erreurs = [[u.replace(SITE, ''), s] for u, (s, _, _) in pages.items() if s != 200]

    T = {u: texte(h) for u, h in ok.items()}
    S = {u: shingles(t) for u, t in T.items()}
    M = {u: meta(h) for u, h in ok.items()}
    mots = {u: len(t.split()) for u, t in T.items()}

    # Part du texte commune à ≥ 50 % des pages d'une même famille (gabarit) et part propre à la page
    familles = {}
    for u in ok:
        familles.setdefault(type_page(u), []).append(u)
    gabarit = []
    for fam, lst in familles.items():
        if len(lst) < 5:
            continue
        C = Counter(s for u in lst for s in S[u])
        part_gab = [sum(1 for s in S[u] if C[s] >= len(lst) * 0.5) / max(1, len(S[u])) for u in lst]
        part_uniq = [sum(1 for s in S[u] if C[s] == 1) / max(1, len(S[u])) for u in lst]
        m = sorted(mots[u] for u in lst)
        gabarit.append([fam, len(lst), f'{100 * sorted(part_gab)[len(lst) // 2]:.0f} %', f'{100 * sorted(part_uniq)[len(lst) // 2]:.0f} %',
                        m[0], m[len(m) // 2], m[-1]])

    # Quasi-doublons MinHash (Jaccard estimé ≥ 0,6 hors gabarit : texte quasi identique)
    MH = {u: minhash(S[u]) for u in ok}
    doublons = []
    for a, b in itertools.combinations(ok, 2):
        j = sum(1 for x, y in zip(MH[a], MH[b]) if x == y) / K
        if j >= 0.6:
            doublons.append([a.replace(SITE, ''), b.replace(SITE, ''), round(j, 2)])
    doublons.sort(key=lambda x: -x[2])

    # On-page : titles/descriptions/H1 dupliqués, trop longs, canonicals absents ou différents, noindex
    titres = Counter(M[u]['title'] for u in ok)
    descs = Counter(M[u]['description'] for u in ok)
    onpage = []
    for u, m in M.items():
        pb = []
        if titres[m['title']] > 1: pb.append('title dupliqué')
        if descs[m['description']] > 1: pb.append('description dupliquée')
        if not m['title']: pb.append('title absent')
        if len(m['title']) > 65: pb.append(f'title long ({len(m["title"])})')
        if not m['description']: pb.append('description absente')
        if len(m['description']) > 160: pb.append(f'description longue ({len(m["description"])})')
        if not m['h1']: pb.append('H1 absent')
        if m['canonical'] != u: pb.append('canonical ≠ URL')
        if 'noindex' in m['robots']: pb.append('noindex')
        if m['images_sans_alt']: pb.append(f'{m["images_sans_alt"]} img sans alt')
        if mots[u] < 300: pb.append(f'{mots[u]} mots')
        if pb:
            onpage.append([u.replace(SITE, ''), ', '.join(pb)])

    poids = [[fam, len(lst), round(sum(M[u]['html'] for u in lst) / len(lst) / 1024), round(sum(M[u]['form'] for u in lst) / len(lst) / 1024),
              round(sum(M[u]['ldjson'] for u in lst) / len(lst) / 1024), round(sum(M[u]['liens_internes'] for u in lst) / len(lst))]
             for fam, lst in familles.items()]

    ecrire('duplication.json', {'echantillon': len(ok), 'erreurs': erreurs, 'gabarit': gabarit, 'doublons': doublons, 'onpage': onpage,
                                'poids': poids, 'mots': {u.replace(SITE, ''): n for u, n in mots.items()}})
    md = f'## Contenu gabarit et doublons ({len(ok)} pages lues)\n\n'
    if erreurs:
        md += '### Pages en erreur\n' + tableau(erreurs, ['URL', 'Statut']) + '\n'
    md += '### Part gabarit (texte commun à la moitié des pages de la famille, formulaire et navigation exclus)\n'
    md += tableau(gabarit, ['Famille', 'Pages', 'Gabarit (médiane)', 'Unique (médiane)', 'Mots min', 'Mots médiane', 'Mots max'])
    md += '\n### Poids moyen par famille (Ko) et liens internes\n' + tableau(poids, ['Famille', 'Pages', 'HTML', 'Formulaire', 'JSON-LD', 'Liens internes'])
    md += f'\n### Quasi-doublons (MinHash, Jaccard ≥ 0,6) : {len(doublons)}\n' + (tableau(doublons[:20], ['Page A', 'Page B', 'Jaccard']) if doublons else 'Aucun.\n')
    md += f'\n### Anomalies on-page : {len(onpage)}\n' + (tableau(onpage[:30], ['URL', 'Problèmes']) if onpage else 'Aucune.\n')
    print(md)


if __name__ == '__main__':
    principal()
