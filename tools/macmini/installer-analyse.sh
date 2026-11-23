#!/bin/bash
# Installe l'analyse approfondie LUNICAR sur le Mac mini (à lancer depuis le dépôt, sur le Mac de travail) :
#   tools/macmini/installer-analyse.sh
# Copie veille.js + analyse.js dans ~/lunicar-sonar du Mac mini, installe le SDK Claude, vérifie la clé Claude
# (~/lunicar-sonar/anthropic.txt, à créer une fois) et redémarre le service launchd fr.lunicar.sonar.
set -euo pipefail
# Nom Bonjour du Mac mini : son adresse IP change selon la box (192.168.1.184 puis .59 le 23/11/2026).
HOTE="${MACMINI:-derka@Mac-mini-de-Derka.local}"
CLE_SSH="${MACMINI_CLE:-$HOME/.ssh/id_macmini}"
ICI="$(cd "$(dirname "$0")" && pwd)"
SSH=(ssh -i "$CLE_SSH" -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new "$HOTE")

echo "→ Copie de veille.js et analyse.js"
scp -i "$CLE_SSH" -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new "$ICI/veille.js" "$ICI/analyse.js" "$HOTE:lunicar-sonar/"

echo "→ SDK Claude (@anthropic-ai/sdk) dans ~/lunicar-sonar"
"${SSH[@]}" 'cd ~/lunicar-sonar && export PATH="$HOME/lunicar-sonar/node/bin:$PATH" && { [ -f package.json ] || npm init -y >/dev/null; } && npm install --no-audit --no-fund @anthropic-ai/sdk@latest >/dev/null && node -e "require(\"@anthropic-ai/sdk\"); console.log(\"  SDK OK\")"'

echo "→ Clé Claude"
if "${SSH[@]}" 'test -s ~/lunicar-sonar/anthropic.txt'; then echo "  anthropic.txt présent"; else
  echo "  ⚠️  ~/lunicar-sonar/anthropic.txt absent : sans clé, le Mac mini fait le marché mais ne lit pas les textes ni ne rédige de fiche moteur."
  echo "     Créez-le une fois (clé Claude, une seule ligne) : ssh -i $CLE_SSH $HOTE 'cat > ~/lunicar-sonar/anthropic.txt && chmod 600 ~/lunicar-sonar/anthropic.txt'"
fi

echo "→ Redémarrage du service"
"${SSH[@]}" 'launchctl kickstart -k gui/$(id -u)/fr.lunicar.sonar && sleep 3 && tail -5 ~/lunicar-sonar/veille.log'
echo "✓ Installé. Suivi : ssh -i $CLE_SSH $HOTE 'tail -f ~/lunicar-sonar/veille.log'"
