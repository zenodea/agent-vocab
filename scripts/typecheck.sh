#!/bin/sh
# Typecheck against the pi installation on this machine. Pi ships the type
# declarations the extension imports; this links them into node_modules/ so
# ordinary module resolution finds them. node_modules/ is gitignored.
set -e
cd "$(dirname "$0")/.."
PI_BIN="$(command -v pi)" || { echo "pi is not installed" >&2; exit 1; }
PI_ROOT="$(cd "$(dirname "$(readlink -f "$PI_BIN")")" && while [ ! -f package.json ] && [ "$PWD" != / ]; do cd ..; done; pwd)"
rm -rf node_modules && mkdir -p node_modules/@earendil-works
ln -s "$PI_ROOT" node_modules/@earendil-works/pi-coding-agent
ln -s "$PI_ROOT/node_modules/@earendil-works/pi-tui" node_modules/@earendil-works/pi-tui
ln -s "$PI_ROOT/node_modules/@types" node_modules/@types
exec npx -y -p typescript tsc --noEmit -p tsconfig.json
