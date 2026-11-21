#!/bin/sh
# Rebuilds the Zotero plugin (.xpi) from the readable source in ../zotero/.
# Only needed if you change zotero/bootstrap.js or zotero/manifest.json.
set -e
cd "$(dirname "$0")/../zotero"
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
rm -f "goodnotes-sync-$VERSION.xpi"
zip -q -X "goodnotes-sync-$VERSION.xpi" manifest.json bootstrap.js
echo "built zotero/goodnotes-sync-$VERSION.xpi"
