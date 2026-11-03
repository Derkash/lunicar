#!/bin/sh
# Lighthouse mobile (npx, dépôt officiel GoogleChrome/lighthouse) sur une page par famille.
# Sortie : $AUDIT_DIR/lighthouse-<nom>.json + résumé Markdown sur stdout.
set -u
SITE="${AUDIT_SITE:-https://lunicar.fr}"
DIR="${AUDIT_DIR:-.}"
mkdir -p "$DIR"
echo "## Lighthouse mobile (lab, simulation 4G)"
echo
echo "| Page | Perf | LCP | TBT | CLS | TTFB | Poids |"
echo "|---|---|---|---|---|---|---|"
for p in "/" "/rachat-voiture-en-panne" "/reprise-auto-marseille" "/reprise-bmw"; do
  nom=$(echo "$p" | tr '/' '_'); [ "$nom" = "_" ] && nom="_accueil"
  npx -y lighthouse "$SITE$p" --preset=perf --form-factor=mobile --screenEmulation.mobile --throttling-method=simulate \
    --output=json --output-path="$DIR/lighthouse$nom.json" --chrome-flags="--headless=new --no-sandbox" --quiet >/dev/null 2>&1
  python3 - "$DIR/lighthouse$nom.json" "$p" <<'EOF'
import json, sys
try:
    d = json.load(open(sys.argv[1])); a = d['audits']
    v = lambda k: a.get(k, {}).get('displayValue', '—')
    print(f"| {sys.argv[2]} | {round(d['categories']['performance']['score'] * 100)} | {v('largest-contentful-paint')} | {v('total-blocking-time')} | {v('cumulative-layout-shift')} | {v('server-response-time')} | {v('total-byte-weight')} |")
except Exception as e:
    print(f"| {sys.argv[2]} | erreur {e} | | | | | |")
EOF
done
