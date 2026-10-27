#!/usr/bin/env bash
# Télécharge les sources de données (cartes, scripts, chaînes, banlists) de Project Ignis.
set -euo pipefail
DIR="${DATA_DIR:-.data}"
mkdir -p "$DIR"
for repo in BabelCDB CardScripts Distribution LFLists; do
  if [ -d "$DIR/$repo/.git" ]; then
    git -C "$DIR/$repo" pull -q --ff-only
  else
    git clone -q --depth 1 "https://github.com/ProjectIgnis/$repo" "$DIR/$repo"
  fi
done
echo "Données dans $DIR"
