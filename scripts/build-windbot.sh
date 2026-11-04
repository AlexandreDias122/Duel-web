#!/usr/bin/env bash
# Compile WindBot Ignite (ProjectIgnis/windbot, AGPL-3.0) en WebAssembly .NET dans public/windbot.
# Nécessite le SDK .NET 8 (sans workload : le runtime WebAssembly vient de NuGet).
set -euo pipefail
REV="bffe6b62679c8b2fafea8f59740e03a132517da4" # ProjectIgnis/windbot, 2026-08-27
SRC="windbot/upstream"
if [ ! -d "$SRC/.git" ]; then
  git clone -q https://github.com/ProjectIgnis/windbot "$SRC"
fi
if [ "$(git -C "$SRC" rev-parse HEAD)" != "$REV" ]; then
  git -C "$SRC" fetch -q origin "$REV" || git -C "$SRC" fetch -q origin
  git -C "$SRC" checkout -q "$REV"
fi
dotnet publish windbot/WindBotWasm.csproj -c Release -o windbot/bin/publish -nologo -v quiet
rm -rf public/windbot
mkdir -p public/windbot
cp -r windbot/bin/publish/wwwroot/_framework public/windbot/
# Licence et provenance des sources, servies avec les binaires (AGPL-3.0).
cp "$SRC/LICENSE" public/windbot/LICENSE.txt
echo "https://github.com/ProjectIgnis/windbot/tree/$REV" > public/windbot/SOURCE.txt
node scripts/windbot-decks.mjs "$SRC" public/windbot/bots.json
du -sh public/windbot
