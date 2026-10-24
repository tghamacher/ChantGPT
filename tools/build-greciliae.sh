#!/bin/sh
# Builds fonts/greciliae.ttf from Gregorio's sources, as Gregorio's own Makefile does, and makes js/greciliae.js, the
# table of its glyphs. Needs git, FontForge with its Python module (Debian/Ubuntu: fontforge-nox python3-fontforge).
# usage: sh tools/build-greciliae.sh [gregorio version tag, default v6.2.0]
set -e
TAG=${1:-v6.2.0}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
git clone -q --depth 1 --branch "$TAG" https://github.com/gregorio-project/gregorio.git "$WORK/gregorio"
cd "$WORK/gregorio/fonts"
fontforge -lang=py -script squarize.py greciliae-base.sfd -o greciliae.ttf -c greciliae.json
fontforge -lang=py -script simplify.py greciliae.ttf
cp greciliae.ttf "$ROOT/fonts/greciliae.ttf"
VERSION=${TAG#v} fontforge -lang=py -script "$ROOT/tools/greciliae-table.py" "$ROOT/fonts/greciliae.ttf" "$ROOT/js/greciliae.js"
rm -rf "$WORK"
echo "Built fonts/greciliae.ttf and js/greciliae.js from Gregorio $TAG"
