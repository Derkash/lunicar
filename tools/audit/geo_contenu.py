"""Citabilité du contenu selon les méthodes mesurées du papier GEO (Princeton, KDD 2024) et des études 2026 :
statistiques chiffrées, citations attribuées, sources liées, réponse en tête, tableaux, FAQ, prix/fourchettes explicites,
date visible, passages autonomes (134-167 mots), absence de bourrage de mots-clés.

    python3 tools/audit/geo_contenu.py                      # pages piliers + pages d'entrée ChatGPT
    python3 tools/audit/geo_contenu.py /reprise-auto-lyon   # pages données
"""
import html
import re
import sys
from concurrent.futures import ThreadPoolExecutor

from commun import SITE, ecrire, tableau, telecharger

PAGES = ['/', '/rachat-voiture-en-panne', '/rachat-voiture-en-panne-paris', '/rachat-voiture-france', '/reprise-auto-lyon',
         '/reprise-auto-paris', '/reprise-auto-montpellier', '/rachat-voiture-grand-est', '/rachat-voiture-sans-controle-technique',
         '/vendre-vieille-voiture', '/reprise', '/expertise-voiture-a-domicile', '/reprise-voiture-occasion',
         '/article/vendre-voiture-parent-age', '/rachat-voiture-accidentee', '/reprise-bmw', '/comparatif-reprise-auto']
SOURCES_AUTORITE = r'service-public\.fr|legifrance|ants\.gouv|gouv\.fr|insee|argus|largus|ademe|securite-routiere|ccfa|pfa|aaa\s?data|autobiz|cetelem|utac|dekra|autoplus|caradisiac|leboncoin|la\s?centrale'
MOTS_CLES = ['rachat voiture', 'rachat de voiture', 'reprise', 'vendre sa voiture', 'vendre votre voiture']


def corps_principal(h):
    h = re.sub(r'(?is)<(script|style|nav|footer|header|form|noscript)[^>]*>.*?</\1>', ' ', h)
    m = re.search(r'(?is)<main[^>]*>(.*?)</main>', h)
    return m.group(1) if m else h


def analyser(p):
    st, en, h = telecharger(SITE + p)
    if st != 200:
        return {'page': p, 'statut': st}
    c = corps_principal(h)
    t = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', c)))
    mots = len(t.split())
    h1 = re.search(r'(?is)<h1[^>]*>(.*?)</h1>', c)
    apres_h1 = html.unescape(re.sub(r'<[^>]+>', ' ', c[h1.end():h1.end() + 1500])) if h1 else ''
    premier_para = re.sub(r'\s+', ' ', apres_h1).strip()[:300]
    paras = [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', x))).strip() for x in re.findall(r'(?is)<p[^>]*>(.*?)</p>', c)]
    autonomes = sum(1 for x in paras if 100 <= len(x.split()) <= 180)
    stats = len(re.findall(r'\b\d{1,3}(?:[  .]\d{3})*(?:,\d+)?\s?(?:%|€|km|ans|jours|heures|h\b|millions|milliards|véhicules|voitures)', t))
    citations = len(re.findall(r'[«“][^»”]{20,}[»”]', t)) + len(re.findall(r'\bselon (?:l[ae\']|les|un|une)\b', t, re.I))
    liens_sources = len(set(re.findall(r'href="(https?://(?!lunicar\.fr)[^"]+)"', c)))
    liens_autorite = len(set(u for u in re.findall(r'href="(https?://[^"]+)"', c) if re.search(SOURCES_AUTORITE, u, re.I)))
    tableaux = len(re.findall(r'<table', c))
    faq = len(re.findall(r'"@type":\s*"Question"', h))
    prix = len(re.findall(r'\d[\d  ]*\s?€', t))
    date_visible = bool(re.search(r'(mis à jour|actualisé|le \d{1,2} \w+ 20\d\d|20\d\d)', t, re.I))
    date_modif = (re.search(r'"dateModified":\s*"([^"]+)"', h) or [None, ''])[1][:10]
    densite = sum(t.lower().count(k) for k in MOTS_CLES) / max(1, mots) * 100
    reponse_en_tete = bool(premier_para) and len(premier_para.split()) >= 25 and not premier_para.lower().startswith(('vendez', 'votre estimation'))
    speakable = '"SpeakableSpecification"' in h
    score = (min(stats, 8) / 8 * 20 + min(citations, 4) / 4 * 15 + min(liens_autorite, 4) / 4 * 20 + (10 if reponse_en_tete else 0)
             + (10 if tableaux else 0) + (5 if faq else 0) + (5 if prix else 0) + (5 if date_visible or date_modif else 0)
             + min(autonomes, 5) / 5 * 10 - (10 if densite > 2.5 else 0))
    return {'page': p, 'statut': st, 'mots': mots, 'stats': stats, 'citations': citations, 'liens_sortants': liens_sources,
            'liens_autorite': liens_autorite, 'tableaux': tableaux, 'faq': faq, 'prix': prix, 'date': date_modif or ('visible' if date_visible else '—'),
            'autonomes': autonomes, 'densite': round(densite, 1), 'reponse_en_tete': reponse_en_tete, 'speakable': speakable,
            'score': round(score), 'premier_para': premier_para[:140]}


def principal():
    pages = sys.argv[1:] or PAGES
    with ThreadPoolExecutor(5) as ex:
        res = list(ex.map(analyser, pages))
    ecrire('geo_contenu.json', res)
    lignes = [[r['page'], r.get('mots', '—'), r.get('stats', '—'), r.get('citations', '—'), r.get('liens_autorite', '—'), r.get('tableaux', '—'),
               r.get('faq', '—'), r.get('prix', '—'), r.get('date', '—'), r.get('autonomes', '—'), r.get('densite', '—'),
               '✅' if r.get('reponse_en_tete') else '❌', r.get('score', 'ERR ' + str(r.get('statut')))] for r in res]
    md = '## GEO contenu — citabilité par page (méthodes GEO KDD 2024 : statistiques +29 %, citations +39 %, sources +26 %)\n\n'
    md += tableau(lignes, ['Page', 'Mots', 'Chiffres', 'Citations', 'Sources autorité', 'Tableaux', 'FAQ', 'Prix', 'Date', 'Passages 100-180 mots', 'Densité %', 'Réponse en tête', 'Score /100'])
    moy = sum(r.get('score', 0) for r in res) / max(1, len(res))
    md += f'\nScore moyen : **{moy:.0f}/100**. Pages sans aucune source d\'autorité liée : ' + ', '.join(r['page'] for r in res if r.get('liens_autorite') == 0) + '\n'
    md += '\nPremier paragraphe après le H1 (ce que le moteur lit en premier) :\n' + tableau([[r['page'], r.get('premier_para', '')] for r in res], ['Page', 'Début'])
    print(md)


if __name__ == '__main__':
    principal()
