#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RESULTS=${RESULTS:-"$ROOT/test-results/ux-fixes-2026-09-13/release"}
RELEASE_ID=${RELEASE_ID:-ux-20260913-r1}
TAG=${TAG:-tie-event:$RELEASE_ID}
NODE_BIN=${NODE_BIN:-/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}

usage() {
  cat <<'EOF'
Usage:
  deploy/ux-release-20260913-r1.sh archive
  deploy/ux-release-20260913-r1.sh validate-archive <archive.tar.gz>
  deploy/ux-release-20260913-r1.sh smoke [image-tag]

archive creates the release source archive and a SHA-256 manifest after source freeze.
smoke runs a candidate image with an empty temporary /data filesystem, no network,
read-only root, dropped capabilities, and no production volume.
EOF
}

archive() {
  mkdir -p "$RESULTS"
  archive="$RESULTS/tie-event-${RELEASE_ID}-source.tar.gz"
  temp="$archive.tmp"
  rm -f "$temp"
  COPYFILE_DISABLE=1 tar --no-xattrs -czf "$temp" -C "$ROOT" \
    Dockerfile .dockerignore package.json pnpm-lock.yaml index.html vite.config.js \
    public src server \
    deploy/ux-release-20260913-r1-remote.sh \
    deploy/ux-release-20260913-r1-db-fingerprint.mjs
  mv "$temp" "$archive"
  "$0" validate-archive "$archive"
  "$0" verify-source-entries "$archive"
  (cd "$RESULTS" && shasum -a 256 "$(basename "$archive")" > "${RELEASE_ID}-source.sha256")
  tar -tzf "$archive" | LC_ALL=C sort > "$RESULTS/${RELEASE_ID}-source-members.txt"
  tar -tzf "$archive" | awk '/^(src|server)\/[^\/]+/ && $0 !~ /\/$/' | LC_ALL=C sort > "$RESULTS/${RELEASE_ID}-src-server-files.txt"
  printf '%s\n' "$archive"
}

validate_archive() {
  archive=$1
  [ -f "$archive" ] || { echo "Archive not found: $archive" >&2; exit 1; }
  bad=$(tar -tzf "$archive" | awk '
    $0 ~ /^\// || $0 ~ /(^|\/)(\.\.?)(\/|$)/ || $0 ~ /(^|\/)\._[^\/]+$/ || $0 ~ /(^|\/)\.DS_Store$/ { print; next }
    $0 !~ /^(Dockerfile|\.dockerignore|package\.json|pnpm-lock\.yaml|index\.html|vite\.config\.js|deploy\/ux-release-20260913-r1-(remote\.sh|db-fingerprint\.mjs))$/ && $0 !~ /^(public|src|server)\// { print }
  ')
  [ -z "$bad" ] || { echo "Unsafe or out-of-scope archive members:" >&2; printf '%s\n' "$bad" >&2; exit 1; }
  tar -tzf "$archive" | grep -Eq '^Dockerfile$' || { echo 'Archive has no Dockerfile' >&2; exit 1; }
  tar -tzf "$archive" | grep -Eq '^server/http\.mjs$' || { echo 'Archive has no server/http.mjs' >&2; exit 1; }
  tar -tzf "$archive" | grep -Eq '^src/main\.jsx$' || { echo 'Archive has no src/main.jsx' >&2; exit 1; }
  tar -tzf "$archive" | grep -Eq '^public/' || { echo 'Archive has no public assets' >&2; exit 1; }
}

verify_source_entries() {
  archive=$1
  tar -tzf "$archive" | while IFS= read -r member; do
    case "$member" in
      src/*|server/*)
        case "$member" in */) continue ;; esac
        [ -f "$ROOT/$member" ] || { echo "Archive source member is not a regular workspace file: $member" >&2; exit 1; }
        tar -xOf "$archive" "$member" | cmp - "$ROOT/$member" || { echo "Archive source differs from workspace: $member" >&2; exit 1; }
        ;;
    esac
  done
}

smoke() {
  image=${1:-$TAG}
  command -v docker >/dev/null || { echo 'docker is required' >&2; exit 1; }
  [ -x "$NODE_BIN" ] || { echo "Node runtime unavailable: $NODE_BIN" >&2; exit 1; }
  name="tie-event-ux-smoke-$$"
  cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
  trap cleanup EXIT INT TERM
  docker image inspect "$image" >/dev/null
  docker run -d --name "$name" \
    --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --memory 384m --pids-limit 128 \
    --tmpfs /tmp:rw,nosuid,nodev,size=32m,mode=1777 \
    --tmpfs /data:rw,nosuid,nodev,size=32m,mode=1777 \
    "$image" >/dev/null
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name")
    [ "$health" = healthy ] && break
    [ "$health" = unhealthy ] && { docker logs "$name" >&2; exit 1; }
    attempt=$((attempt + 1))
    sleep 1
  done
  [ "${health:-}" = healthy ] || { docker logs "$name" >&2; echo 'Timed out waiting for healthy container' >&2; exit 1; }
  docker exec "$name" node --input-type=module -e '
    import assert from "node:assert/strict";
    const origin="http://127.0.0.1:4173";
    const health=await fetch(origin+"/api/health"); assert.equal(health.status,200);
    const privateApi=await fetch(origin+"/api/state"); assert.equal(privateApi.status,401);
    const home=await fetch(origin+"/"); assert.equal(home.status,200);
    const html=await home.text();
    const assets=[...html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)].map(match=>match[1]);
    assert.ok(assets.length>0,"no JS/CSS assets found in HTML");
    for(const asset of assets){const response=await fetch(origin+asset);assert.equal(response.status,200,asset);}
    console.log(JSON.stringify({health:health.status,privateApi:privateApi.status,assets},null,2));
  '
  docker exec "$name" node --input-type=module -e 'import sharp from "sharp"; await sharp({create:{width:1,height:1,channels:3,background:"#fff"}}).webp().toBuffer(); console.log("sharp=ok")'
  docker exec "$name" node --input-type=module -e 'await import("./server/http.mjs"); console.log("server-import=ok")'
  docker inspect -f '{{.State.Status}} {{.State.Health.Status}} {{.RestartCount}}' "$name"
}

case "${1:-}" in
  archive) archive ;;
  validate-archive) [ "$#" -eq 2 ] || { usage >&2; exit 2; }; validate_archive "$2" ;;
  verify-source-entries) [ "$#" -eq 2 ] || { usage >&2; exit 2; }; verify_source_entries "$2" ;;
  smoke) shift; smoke "$@" ;;
  *) usage >&2; exit 2 ;;
esac
