# Audit SEO / GEO de lunicar.fr

Système d'audit maison, **sans dépendance externe** (Python 3.9 stdlib + `npx lighthouse`), qui produit un rapport
Markdown daté dans `work/lunicar-audit/AAAA-MM-JJ-audit/RAPPORT.md` avec les données brutes en JSON à côté.

```sh
sh tools/audit/audit.sh                     # tout (≈ 6 min : 160 inspections d'URL + 80 pages lues + 4 Lighthouse)
sh tools/audit/audit.sh --sans-lighthouse
sh tools/audit/audit.sh --avec-chatgpt      # + relevé ChatGPT 60 questions (clé OpenAI, ≈ 10 min, coût API)
python3 tools/audit/gsc_marque.py           # une section seule, sortie Markdown sur stdout
```

Prérequis : `secrets/gsc-token.json` (jeton OAuth Google partagé, scopes webmasters + analytics — dossier ignoré par git),
`BING_API_KEY` dans `.env`, `OPENAI_API_KEY` dans `.env` pour le relevé ChatGPT.

## Ce qui est audité

| Script | Points contrôlés | Pourquoi |
|---|---|---|
| `gsc_marque.py` | Marque vs hors marque ; **mobile France hors marque** (= humains) vs desktop (robots de suivi) ; tranches de position ; familles de pages (villes, marques, situations…) ; têtes de requête sur 90 j ; requêtes déjà en page 1-2 à pousser ; série hebdo 120 j | Les impressions brutes mentent : seules les impressions mobiles FR hors marque mesurent l'exposition réelle |
| `indexation.py` | Sitemaps GSC ; inspection stratifiée (piliers / grandes villes / petites communes) : indexée, explorée non indexée, détectée, inconnue ; canonique choisie par Google ≠ URL ; pages non recrawlées depuis 60 j | Signal « contenu à l'échelle » et pages périmées chez Google |
| `duplication.py` | Part de texte gabarit par famille (formulaire/nav exclus), part unique, quasi-doublons MinHash (Jaccard ≥ 0,6), poids HTML / formulaire / JSON-LD, liens internes, title/description/H1 dupliqués ou absents, canonical, noindex, img sans alt, pages < 300 mots | Pages satellites et dilution |
| `bots_ia.py` | robots.txt pour 20 robots IA (recherche / lecture / entraînement) ; **joignabilité réelle** avec 7 user-agents (statut, taille, title identiques = pas de WAF ni cloaking) ; llms.txt conforme à la spec llmstxt.org + liens testés ; llms-full.txt ; versions `/md/` ; Last-Modified / ETag / Cache-Control | Un robot bloqué ou une réponse différente = invisible pour ChatGPT |
| `geo_contenu.py` | Par page : chiffres sourcés, citations attribuées, liens vers sources d'autorité, tableaux, FAQ, prix explicites, date, passages autonomes 100-180 mots, densité de mots-clés, réponse en tête, speakable → score /100 | Méthodes mesurées du papier GEO (KDD 2024 : citations +39 %, statistiques +29 %, sources +26 %, bourrage −9 %) et étude 2026 « What Gets Cited » (prix + date récente) |
| `bing.py` | Requêtes, pages, **taille de l'index Bing**, crawl quotidien, erreurs HTTP, liens entrants | ChatGPT search s'appuie sur l'index Bing |
| `lighthouse.sh` | Perf, LCP, TBT, CLS, TTFB, poids sur 4 pages (mobile simulé) | Core Web Vitals lab (pas de CrUX tant que le trafic est faible) |
| `../geo_suivi/suivi.js` | 60 questions à ChatGPT (API Responses + web_search) : cité ?, rang, URL, concurrents, promesses périmées répétées | Part de voix réelle |

## Outils externes (facultatifs, lancés automatiquement s'ils sont installés)

Règle : **n'installer que des dépôts très suivis, lus avant usage, jamais de `npx github:…` d'un dépôt à quelques étoiles.**
Vérifiés le 2026-11-03 (étoiles, dernier commit, licence) :

| Outil | Ajoute | Installation | Risque |
|---|---|---|---|
| [GoogleChrome/lighthouse](https://github.com/GoogleChrome/lighthouse) (31 k ★, Apache-2.0) | déjà utilisé via `npx lighthouse` | — | faible (Google) |
| [janreges/siteone-crawler](https://github.com/janreges/siteone-crawler) (1 k ★, MIT, Rust) | crawl complet des 5 300 pages : codes, redirections, en-têtes, sécurité, accessibilité, rapport HTML | `brew install janreges/tap/siteone-crawler` | faible, binaire tap tiers : lire la formule |
| [raviqqe/muffet](https://github.com/raviqqe/muffet) (2,6 k ★, MIT, Go) | liens cassés et chaînes de redirections sur tout le site | `brew install muffet` | faible (formule Homebrew core) |
| [harlan-zw/unlighthouse](https://github.com/harlan-zw/unlighthouse) (4,9 k ★, MIT) | Lighthouse échantillonné par gabarit de route + budgets | `npx @unlighthouse/cli --site https://lunicar.fr --samples 5` | faible |
| [eliasdabbas/advertools](https://github.com/eliasdabbas/advertools) (1,5 k ★, MIT, Python) | analyse de logs serveur (Googlebot/Bingbot/GPTBot par IP), sitemaps, robots | `pip3 install advertools` | faible |
| [allinurl/goaccess](https://github.com/allinurl/goaccess) (21 k ★, MIT) | tableau de bord des logs (pages crawlées par robot) | `brew install goaccess` | faible |
| [Auriti-Labs/geo-optimizer-skill](https://github.com/Auriti-Labs/geo-optimizer-skill) (1,3 k ★, MIT, Python) | 47 contrôles de citabilité, `geo fix` (prévisualise robots/llms.txt/JSON-LD) | `pip3 install geo-optimizer-skill` — lire le code avant : README promotionnel (geoready.dev) | moyen : jeune, à relire |
| [limelit-co/open](https://github.com/limelit-co/open) (325 ★, Apache-2.0, Go) | suivi industrialisé de la part de voix ChatGPT/Perplexity/Claude avec historique et concurrents (remplaçant possible de geo_suivi) | `go install github.com/limelit-co/open/cmd/limelet@latest` ou Docker | moyen : pré-version 0.1, clés API à lui confier |
| [ekzhu/datasketch](https://github.com/ekzhu/datasketch) (3 k ★, MIT) | MinHash/LSH sur les 5 300 pages en quelques secondes (le MinHash maison suffit pour 80 pages) | `pip3 install datasketch` | faible |
| [merj/bing-webmaster-tools](https://github.com/merj/bing-webmaster-tools) (21 ★, MIT) | client Bing complet (déjà couvert par `bing.py` en direct) | — | inutile |

Écartés volontairement (sécurité ou valeur) : validateurs llms.txt et listes de bots à 0-5 étoiles (réécrits dans `bots_ia.py`),
elmo / getcito / oneglanse (scraping des interfaces ChatGPT via services payants ou comptes connectés), geo-aeo-tracker
(Bright Data obligatoire), cited-score (open-core sans licence), générateurs de schema GitHub, python-seo-analyzer
(licence « all rights reserved »), serpbear (pas de scraper intégré, scraping Google = CGU).

## Références de méthode
- Papier GEO (Princeton, KDD 2024) : https://github.com/GEO-optim/GEO — gains mesurés : citations de sources d'autorité +39 % de visibilité, statistiques +29 %, fluidité +27 %, citer ses sources +26 %, bourrage de mots-clés −9 % ; les gains sont les plus forts pour les sites mal classés (+115 % au rang 5).
- arXiv 2605.25517 « What Gets Cited » (2026, 252 000 essais) : 1) pertinence + position dans la liste, 2) prix explicite + date récente, 3) complétude et signaux de confiance ; la mise en forme seule ne change presque rien.
- arXiv 2606.20065 « GEO at Scale » (2026, 100 k réponses) : 78 % des citations vont à des sites d'entreprise, puis YouTube, Reddit, médias ; les listicles classés font 21 % des citations ; les marques de niche sont visibles dans 11 % des réponses.
- Spec llms.txt : https://github.com/AnswerDotAI/llms-txt (H1 unique, blockquote de résumé, sections H2 de listes `[nom](url): note`, `## Optional`).
- Robots IA et plages IP officielles : https://openai.com/searchbot.json, gptbot.json, chatgpt-user.json ; liste catégorisée https://github.com/askwatch/ai-crawlers (lue, pas exécutée).
