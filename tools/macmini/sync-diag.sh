#!/bin/bash
# Copie les dossiers du diagnostic mécanique YAK (dépôt local yak-services/diagnostic) vers ~/lunicar-sonar/diagnostic
# du Mac mini, où parc.js les lit pour la stratégie de vente. Lancé par l'installeur ; à relancer après un nouveau diagnostic.
set -uo pipefail
HOTE="${MACMINI:-derka@Mac-mini-de-Derka.local}"
CLE_SSH="${MACMINI_CLE:-$HOME/.ssh/id_macmini}"
SRC="${DIAG_SRC:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/Projects/work/yak-services/diagnostic}"
[ -d "$SRC/parc" ] || { echo "dépôt diagnostic introuvable : $SRC"; exit 1; }
rsync -a --delete -e "ssh -i $CLE_SSH -o ConnectTimeout=6 -o BatchMode=yes -o StrictHostKeyChecking=accept-new" \
  --include='parc/***' --include='diagnostics/***' --include='connaissances/***' --exclude='*' \
  "$SRC/" "$HOTE:lunicar-sonar/diagnostic/" && echo "  diagnostic copié sur le Mac mini"
