#!/bin/sh
# Audit SEO + GEO complet de lunicar.fr, sans dépendance externe (Python 3.9 stdlib + npx lighthouse).
#
#   sh tools/audit/audit.sh                 # dossier ~/…/work/lunicar-audit/AAAA-MM-JJ-audit/
#   AUDIT_DIR=/tmp/audit sh tools/audit/audit.sh
#   sh tools/audit/audit.sh --sans-lighthouse --sans-chatgpt
#
# Sections (chacune lançable seule : python3 tools/audit/<script>.py) :
#   gsc_marque     Search Console : marque / hors marque / mobile FR, positions, familles, têtes de requête
#   indexation     sitemaps + inspection d'un échantillon stratifié (API URL Inspection)
#   duplication    part gabarit, quasi-doublons MinHash, poids HTML/formulaire, anomalies on-page
#   bots_ia        robots.txt par robot IA, joignabilité par user-agent, llms.txt (spec), /md, fraîcheur
#   geo_contenu    citabilité des pages (chiffres, citations, sources, tableaux, réponse en tête…)
#   bing           index Bing (lu par ChatGPT), crawl, erreurs, liens entrants
#   lighthouse     Lighthouse mobile sur 4 pages (npx, dépôt officiel Google)
#   geo_suivi      relevé ChatGPT 60 questions (tools/geo_suivi/suivi.js, clé OpenAI) — long, facultatif
#
# Outils externes facultatifs (voir README.md) : s'ils sont installés, ils sont lancés en plus.
set -u
ICI=$(cd "$(dirname "$0")" && pwd)
RACINE=$(cd "$ICI/../.." && pwd)
export AUDIT_DIR="${AUDIT_DIR:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/Projects/work/lunicar-audit/$(date +%F)-audit}"
mkdir -p "$AUDIT_DIR"
R="$AUDIT_DIR/RAPPORT.md"
SANS_LH=0; SANS_GPT=1
for a in "$@"; do
  case "$a" in --sans-lighthouse) SANS_LH=1;; --avec-chatgpt) SANS_GPT=0;; esac
done

section() { echo; echo "→ $1"; echo >> "$R"; python3 "$ICI/$1.py" >> "$R" 2>"$AUDIT_DIR/$1.err" || echo "   ⚠️ erreur, voir $AUDIT_DIR/$1.err"; }

{
  echo "# LUNICAR — audit SEO / GEO automatique du $(date +%F)"
  echo
  echo "Produit par tools/audit/audit.sh. Données : Search Console, URL Inspection, Bing Webmaster, pages en ligne, Lighthouse."
} > "$R"

section gsc_marque
section indexation
section duplication
section bots_ia
section geo_contenu
section bing

if [ "$SANS_LH" = 0 ]; then
  echo; echo "→ lighthouse"; echo >> "$R"; sh "$ICI/lighthouse.sh" >> "$R" 2>"$AUDIT_DIR/lighthouse.err" || true
fi

# Outils externes, uniquement s'ils sont présents (installation manuelle, voir README.md)
if command -v siteone-crawler >/dev/null 2>&1; then
  echo; echo "→ SiteOne Crawler"; siteone-crawler --url="${AUDIT_SITE:-https://lunicar.fr}" --max-visited-urls=6000 --output-html-report="$AUDIT_DIR/siteone.html" --output-json-file="$AUDIT_DIR/siteone.json" >/dev/null 2>&1 || true
  printf '\n## SiteOne Crawler\n\nRapport complet : siteone.html (crawl total, codes, redirections, en-têtes, sécurité, accessibilité).\n' >> "$R"
fi
if command -v muffet >/dev/null 2>&1; then
  echo; echo "→ muffet (liens cassés)"; muffet --format=json --max-connections=16 --buffer-size=65536 "${AUDIT_SITE:-https://lunicar.fr}" > "$AUDIT_DIR/liens-casses.json" 2>/dev/null || true
  printf '\n## Liens cassés (muffet)\n\n%s pages avec au moins un lien en erreur : liens-casses.json\n' "$(python3 -c "import json;print(len(json.load(open('$AUDIT_DIR/liens-casses.json'))))" 2>/dev/null || echo '?')" >> "$R"
fi
if command -v geo >/dev/null 2>&1; then
  echo; echo "→ geo-optimizer"; geo audit --url "${AUDIT_SITE:-https://lunicar.fr}" --format json > "$AUDIT_DIR/geo-optimizer.json" 2>/dev/null || true
fi

if [ "$SANS_GPT" = 0 ]; then
  echo; echo "→ relevé ChatGPT (long)"; (cd "$RACINE" && node tools/geo_suivi/suivi.js > "$AUDIT_DIR/geo_suivi.log" 2>&1) || true
  printf '\n## Relevé ChatGPT\n\nVoir work/lunicar-audit/geo-suivi/%s.md\n' "$(date +%F)" >> "$R"
fi

echo
echo "Rapport : $R"
