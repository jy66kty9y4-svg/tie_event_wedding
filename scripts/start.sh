#!/bin/sh
set -eu

BUNDLED_NODE=/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
if [ -x "$BUNDLED_NODE" ]; then
  NODE_BIN=$BUNDLED_NODE
elif command -v node >/dev/null 2>&1; then
  NODE_BIN=$(command -v node)
else
  echo "Node.js >=22.13 is required." >&2
  exit 1
fi

exec "$NODE_BIN" server/http.mjs
