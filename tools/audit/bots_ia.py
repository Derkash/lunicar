"""GEO technique : robots.txt par robot IA, joignabilité réelle avec chaque user-agent (anti-WAF, anti-cloaking),
llms.txt conforme à la spec llmstxt.org, versions Markdown /md/, en-têtes de fraîcheur, X-Robots-Tag.

    python3 tools/audit/bots_ia.py

Liste des robots tenue à jour à la main depuis les docs officielles (OpenAI, Anthropic, Perplexity, Google, Microsoft,
Apple, Mistral, Amazon, Common Crawl) — aucune dépendance externe.
"""
import re
from concurrent.futures import ThreadPoolExecutor

from commun import SITE, ecrire, tableau, telecharger

# (user-agent, opérateur, rôle) — rôle : recherche = alimente les réponses avec recherche web ; lecture = va chercher une
# page à la demande de l'utilisateur ; entraînement = corpus d'entraînement (sans effet direct sur les citations).
ROBOTS = [
    ('OAI-SearchBot', 'OpenAI', 'recherche (ChatGPT search)'), ('ChatGPT-User', 'OpenAI', 'lecture'), ('GPTBot', 'OpenAI', 'entraînement'),
    ('PerplexityBot', 'Perplexity', 'recherche'), ('Perplexity-User', 'Perplexity', 'lecture'),
    ('Claude-SearchBot', 'Anthropic', 'recherche'), ('Claude-User', 'Anthropic', 'lecture'), ('ClaudeBot', 'Anthropic', 'entraînement'),
    ('Googlebot', 'Google', 'recherche (Google + AI Overviews)'), ('Google-Extended', 'Google', 'entraînement Gemini'),
    ('Bingbot', 'Microsoft', 'recherche (Bing + Copilot + ChatGPT)'), ('DuckAssistBot', 'DuckDuckGo', 'recherche'),
    ('MistralAI-User', 'Mistral', 'lecture'), ('Applebot', 'Apple', 'recherche (Siri)'), ('Applebot-Extended', 'Apple', 'entraînement'),
    ('Amazonbot', 'Amazon', 'recherche (Alexa)'), ('CCBot', 'Common Crawl', 'entraînement'), ('meta-externalagent', 'Meta', 'entraînement'),
    ('Bytespider', 'ByteDance', 'entraînement'), ('YouBot', 'You.com', 'recherche'),
]
PAGES_TEST = ['/', '/rachat-voiture-en-panne', '/reprise-auto-lyon', '/rachat-voiture-france']
UA_FORMAT = {
    'OAI-SearchBot': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
    'ChatGPT-User': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    'GPTBot': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot',
    'PerplexityBot': 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
    'Claude-SearchBot': 'Mozilla/5.0 (compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)',
    'Bingbot': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
    'Googlebot': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
}


def regles_robots(txt):
    """{agent minuscule: [(allow|disallow, chemin), ...]} — regroupement des User-agent consécutifs."""
    groupes, courants = {}, []
    for ligne in txt.splitlines():
        ligne = ligne.split('#')[0].strip()
        if not ligne:
            continue
        cle, _, val = ligne.partition(':')
        cle, val = cle.strip().lower(), val.strip()
        if cle == 'user-agent':
            if courants and any(groupes.get(a) for a in courants):
                courants = []
            courants.append(val.lower()); groupes.setdefault(val.lower(), [])
        elif cle in ('allow', 'disallow') and courants:
            for a in courants:
                groupes[a].append((cle, val))
    return groupes


def autorise(groupes, agent, chemin):
    regles = groupes.get(agent.lower()) or groupes.get('*') or []
    meilleur = ('allow', '')
    for typ, p in regles:
        if p and chemin.startswith(p) and len(p) >= len(meilleur[1]):
            meilleur = (typ, p)
        elif not p and typ == 'disallow':
            pass  # Disallow vide = tout autorisé
    return meilleur[0] == 'allow'


def principal():
    s, _, robots = telecharger(SITE + '/robots.txt')
    groupes = regles_robots(robots) if s == 200 else {}
    lignes_robots = [[ua, op, role, 'explicite' if ua.lower() in groupes else 'via *',
                      '✅' if all(autorise(groupes, ua, p) for p in PAGES_TEST) else '❌ BLOQUÉ'] for ua, op, role in ROBOTS]

    # Joignabilité réelle : même page servie à chaque robot (statut, taille, title) = pas de WAF ni de cloaking
    def essai(args):
        ua, p = args
        st, h, corps = telecharger(SITE + p, UA_FORMAT[ua])
        t = re.search(r'<title>([^<]*)', corps)
        return [ua, p, st, len(corps) // 1024, (t.group(1) if t else '')[:50], h.get('X-Robots-Tag', '')]
    with ThreadPoolExecutor(4) as ex:
        acces = list(ex.map(essai, [(ua, p) for ua in UA_FORMAT for p in PAGES_TEST[:2]]))
    tailles = {}
    for ua, p, st, ko, t, _ in acces:
        tailles.setdefault(p, set()).add((st, ko // 2))  # tolérance 2 Ko
    cloaking = [p for p, v in tailles.items() if len(v) > 1]

    # llms.txt selon la spec : H1 unique, blockquote de résumé, sections H2 de listes [nom](url): note, text/plain|markdown
    st, h, llms = telecharger(SITE + '/llms.txt')
    rapport_llms = {'statut': st, 'type': h.get('Content-Type', ''), 'octets': len(llms)}
    if st == 200:
        lignes = llms.splitlines()
        h1 = [l for l in lignes if l.startswith('# ')]
        rapport_llms.update({
            'h1_unique': len(h1) == 1, 'resume_blockquote': any(l.startswith('> ') for l in lignes[:8]),
            'sections_h2': len([l for l in lignes if l.startswith('## ')]),
            'liens': len(re.findall(r'^- \[[^\]]+\]\(https?://[^)]+\)', llms, re.M)),
            'liens_hors_format': len([l for l in lignes if l.startswith('- ') and not re.match(r'- \[[^\]]+\]\(https?://[^)]+\)', l)]),
            'section_optional': '## Optional' in llms, 'dernier_mot': llms.strip()[-80:],
        })
        liens = re.findall(r'\]\((https?://[^)]+)\)', llms)
        import random
        random.seed(1)
        ech = random.sample(liens, min(30, len(liens)))
        with ThreadPoolExecutor(5) as ex:
            morts = [[u.replace(SITE, ''), s2] for u, s2 in zip(ech, ex.map(lambda u: telecharger(u)[0], ech)) if s2 != 200]
        rapport_llms['liens_testes'] = len(ech); rapport_llms['liens_morts'] = morts
    st_full, h_full, _ = telecharger(SITE + '/llms-full.txt')
    rapport_llms['llms_full'] = st_full

    # Versions Markdown et fraîcheur
    md_pages = []
    for p in PAGES_TEST:
        st, h, corps = telecharger(SITE + '/md' + p)
        st2, h2, _ = telecharger(SITE + p)
        md_pages.append([p, st, h.get('Content-Type', '')[:20], len(corps) // 1024, h2.get('Last-Modified', '')[:16], h2.get('ETag', '')[:12], h2.get('Cache-Control', '')[:30]])

    ecrire('bots_ia.json', {'robots': lignes_robots, 'acces': acces, 'cloaking': cloaking, 'llms': rapport_llms, 'md': md_pages})
    md = '## GEO technique\n\n### robots.txt par robot IA\n' + tableau(lignes_robots, ['Robot', 'Opérateur', 'Rôle', 'Règle', 'Accès'])
    md += '\n### Joignabilité réelle par user-agent\n' + tableau(acces, ['Robot', 'Page', 'Statut', 'Ko', 'Title', 'X-Robots-Tag'])
    md += ('\n⚠️ Réponse différente selon le robot (cloaking ou WAF) sur : ' + ', '.join(cloaking) if cloaking else '\nMême page servie à tous les robots : ✅') + '\n'
    md += '\n### llms.txt\n' + tableau([[k, v] for k, v in rapport_llms.items() if k != 'liens_morts'], ['Contrôle', 'Valeur'])
    if rapport_llms.get('liens_morts'):
        md += 'Liens morts : ' + ', '.join(f'{u} ({s})' for u, s in rapport_llms['liens_morts']) + '\n'
    md += '\n### Versions Markdown et fraîcheur\n' + tableau(md_pages, ['Page', '/md statut', 'Type', 'Ko', 'Last-Modified', 'ETag', 'Cache-Control'])
    print(md)


if __name__ == '__main__':
    principal()
