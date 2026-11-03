"""Search Console : marque vs hors marque, mobile France (humains) vs desktop (robots de suivi),
distribution des positions, familles de pages, têtes de requête, série hebdomadaire.

    python3 tools/audit/gsc_marque.py            # 28 jours finissant avant-hier
    AUDIT_JOURS=90 python3 tools/audit/gsc_marque.py
"""
import os
from datetime import date, timedelta

from commun import MARQUE, agreger, ecrire, fenetres, gsc, tableau, type_page

JOURS = int(os.environ.get('AUDIT_JOURS', 28))
TETES = ['rachat voiture', 'reprise voiture', 'vendre sa voiture', 'vendre ma voiture', 'rachat voiture paris',
         'reprise voiture paris', 'rachat voiture en panne', 'rachat voiture sans controle technique',
         'vendre voiture en panne', 'rachat voiture accidentee', 'vendre sa voiture rapidement',
         'rachat voiture ancienne', 'vendre vieille voiture', 'rachat voiture cash', 'estimation voiture',
         'rachat voiture a domicile', 'qui rachete les voitures']


def hors_marque(lignes):
    return [r for r in lignes if not MARQUE.search(r['keys'][0])]


def principal():
    debut, fin, pdebut, pfin = fenetres(JOURS)
    FR = [{'dimension': 'country', 'expression': 'fra'}]
    MOB = FR + [{'dimension': 'device', 'expression': 'MOBILE'}]
    req = gsc(debut, fin, ['query'])
    req_prec = gsc(pdebut, pfin, ['query'])
    req_fr = gsc(debut, fin, ['query'], FR)
    req_mob = gsc(debut, fin, ['query'], MOB)
    pages = gsc(debut, fin, ['page'])
    pages_prec = gsc(pdebut, pfin, ['page'])
    appareils = gsc(debut, fin, ['device'])
    jours = gsc(fin - timedelta(days=120), fin, ['date'])

    marque = [r for r in req if MARQUE.search(r['keys'][0])]
    hm, hm_prec = hors_marque(req), hors_marque(req_prec)
    hm_fr, hm_mob = hors_marque(req_fr), hors_marque(req_mob)

    tranches = []
    for nom, lo, hi in [('top 3', 0, 3.5), ('4-10', 3.5, 10.5), ('11-20', 10.5, 20.5), ('21-50', 20.5, 50.5), ('> 50', 50.5, 1e9)]:
        x = [r for r in hm_fr if lo <= r['position'] < hi]
        c, i, p = agreger(x)
        tranches.append([nom, len(x), c, i, p])

    familles = {}
    for r in pages:
        a = familles.setdefault(type_page(r['keys'][0]), [0, 0, 0, 0.0])
        a[0] += 1; a[1] += r['clicks']; a[2] += r['impressions']; a[3] += r['position'] * r['impressions']
    familles_l = sorted(([k, a[0], a[1], a[2], round(a[3] / a[2], 1) if a[2] else 0] for k, a in familles.items()), key=lambda x: -x[3])

    t90 = {r['keys'][0]: r for r in gsc(fin - timedelta(days=89), fin, ['query'], FR)}
    tetes = [[t, r['clicks'], r['impressions'], round(r['position'], 1)] if (r := t90.get(t)) else [t, 0, 0, '—'] for t in TETES]

    semaines = {}
    for r in jours:
        k = '%d-S%02d' % date.fromisoformat(r['keys'][0]).isocalendar()[:2]
        a = semaines.setdefault(k, [0, 0, 0.0]); a[0] += r['clicks']; a[1] += r['impressions']; a[2] += r['position'] * r['impressions']
    semaines_l = [[k, a[0], a[1], round(a[2] / a[1], 1) if a[1] else 0] for k, a in sorted(semaines.items())]

    top_impr = sorted(hm_fr, key=lambda r: -r['impressions'])[:40]
    quasi_page1 = sorted([r for r in hm_fr if r['impressions'] >= 5 and r['position'] <= 20], key=lambda r: r['position'])[:40]
    pages_clics = sorted(pages, key=lambda r: -r['clicks'])[:40]
    pages_impr = sorted(pages, key=lambda r: -r['impressions'])[:40]

    res = {
        'fenetre': [str(debut), str(fin)], 'precedente': [str(pdebut), str(pfin)],
        'marque': agreger(marque), 'hors_marque': agreger(hm), 'hors_marque_precedente': agreger(hm_prec),
        'hors_marque_fr': agreger(hm_fr), 'hors_marque_mobile_fr': agreger(hm_mob),
        'nb_requetes_hors_marque_fr': len(hm_fr), 'nb_pages_avec_impressions': len(pages),
        'pages_precedentes': len(pages_prec),
        'appareils': [[r['keys'][0], r['clicks'], r['impressions'], round(r['position'], 1)] for r in appareils],
        'tranches_position': tranches, 'familles': familles_l, 'tetes_90j': tetes, 'semaines': semaines_l,
        'top_impressions_hors_marque': [[r['keys'][0], r['clicks'], r['impressions'], round(r['position'], 1)] for r in top_impr],
        'quasi_page1': [[r['keys'][0], r['clicks'], r['impressions'], round(r['position'], 1)] for r in quasi_page1],
        'pages_clics': [[r['keys'][0], r['clicks'], r['impressions'], round(r['position'], 1)] for r in pages_clics],
        'pages_impressions': [[r['keys'][0], r['clicks'], r['impressions'], round(r['position'], 1)] for r in pages_impr],
    }
    ecrire('gsc_marque.json', res)

    md = f"## Search Console — {debut} → {fin} ({JOURS} j)\n\n"
    md += tableau([
        ['Marque', *res['marque']], ['Hors marque', *res['hors_marque']],
        ['Hors marque, période précédente', *res['hors_marque_precedente']],
        ['Hors marque, France', *res['hors_marque_fr']],
        ['**Hors marque, mobile France (humains)**', *res['hors_marque_mobile_fr']],
    ], ['', 'Clics', 'Impressions', 'Position'])
    md += f"\nPages avec impressions : {len(pages)} (période précédente {len(pages_prec)}). Requêtes hors marque FR : {len(hm_fr)}.\n\n"
    md += '### Appareils\n' + tableau(res['appareils'], ['Appareil', 'Clics', 'Impressions', 'Position'])
    md += '\n### Positions des requêtes hors marque (France)\n' + tableau(tranches, ['Tranche', 'Requêtes', 'Clics', 'Impressions', 'Position'])
    md += '\n### Familles de pages\n' + tableau(familles_l, ['Famille', 'Pages', 'Clics', 'Impressions', 'Position'])
    md += '\n### Têtes de requête (90 j, France)\n' + tableau(tetes, ['Requête', 'Clics', 'Impressions', 'Position'])
    md += '\n### Déjà en page 1-2 (≥ 5 impressions) — à pousser en priorité\n' + tableau(res['quasi_page1'], ['Requête', 'Clics', 'Impressions', 'Position'])
    md += '\n### Pages les plus cliquées\n' + tableau([[p[0].replace('https://lunicar.fr', ''), *p[1:]] for p in res['pages_clics'][:20]], ['Page', 'Clics', 'Impressions', 'Position'])
    md += '\n### Semaines (clics, impressions, position)\n' + tableau(semaines_l, ['Semaine', 'Clics', 'Impressions', 'Position'])
    print(md)


if __name__ == '__main__':
    principal()
