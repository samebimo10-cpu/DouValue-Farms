#!/usr/bin/env bash
#
# Build the directory that GitHub Pages publishes.
#
# The farm app now has a repository to itself, so it is served at the root of
# its own site rather than from a /farm/ sub-path alongside another app:
#
#   _site/          DouValue Farm Manager   -> /douvalue-farm/
#   _site/server/   the sync server         -> /douvalue-farm/server/
#   _site/rules/    the rules JSON          -> /douvalue-farm/rules/
#
# The app references its assets with relative paths, so it does not care which
# of those two addresses it is at; the base path is not written down anywhere
# inside web/.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-$root/_site}"

rm -rf "$out"
mkdir -p "$out"

if [ ! -d "$root/web" ]; then
  echo "error: web/ is missing, so there is no farm app to publish" >&2
  exit 1
fi
cp -R "$root/web/." "$out/"
echo "Farm app   -> $(find "$out" -type f | wc -l | tr -d ' ') files at the site root"

# The sync server is published alongside the app, as .js so Deno will accept it
# as a module, plus a page that tells the farm exactly what to paste and where.
# Copying 600 lines off a phone is not a setup step anyone completes.
if [ -f "$root/server/deno-sync.ts" ]; then
  mkdir -p "$out/server"
  cp "$root/server/deno-sync.ts" "$out/server/deno-entry.js"
  cp "$root/server/page/index.html" "$out/server/index.html"
  echo "Sync server -> /server/ (one-line import and setup page)"
fi

# rules/douvalue_rules_rev5_1.json is the single source of truth, and the repo
# holds exactly one copy of it. Publishing that same file is what lets web/ read
# it over the network without a second copy being committed.
if [ -f "$root/rules/douvalue_rules_rev5_1.json" ]; then
  mkdir -p "$out/rules"
  cp "$root/rules/douvalue_rules_rev5_1.json" "$out/rules/"
  echo "Rules       -> /rules/douvalue_rules_rev5_1.json"
fi

# Pages built through Actions does not run Jekyll, but this makes that explicit
# and keeps any future underscore-prefixed path from being dropped.
touch "$out/.nojekyll"

echo "Site assembled at $out"
