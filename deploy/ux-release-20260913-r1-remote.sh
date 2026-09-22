#!/bin/sh
set -eu

ROOT=/opt/tie-event
RELEASE_ID=${RELEASE_ID:-ux-20260913-r1}
TAG=${TAG:-tie-event:$RELEASE_ID}
EXPECTED_ACTIVE=${EXPECTED_ACTIVE:-tie-event:font-20260911-r3}
ARCHIVE_NAME=tie-event-${RELEASE_ID}-source.tar.gz
CADDY=/opt/ptitsa-plus-releases/20260904T6f38c93/deploy/cloud/Caddyfile
CADDY_SHA=01753bf88e4c74d6135b9fe9b33a627f7ee6e6a77d458db83371aa667e2785d0
COMPOSE_SHA=${EXPECTED_COMPOSE_SHA:-0cdffc4f005a03142deccf890fbdac5ee00e5e65c8c28cc6b63b39dceac444cd}
EXCLUDED_TABLES='sessions attempts guest_sessions notification_outbox'

usage() {
  cat <<'EOF'
Usage on the production host:
  ux-release-20260913-r1-remote.sh stage <archive-path> <expected-sha256>
  RELEASE_GATE=passed ux-release-20260913-r1-remote.sh activate <release-dir>
  RELEASE_GATE=passed ux-release-20260913-r1-remote.sh rollback <previous-image> <previous-env-backup>

stage builds and smoke-tests the candidate only. It cannot change the live compose service.
activate and rollback require the explicit RELEASE_GATE=passed value.
EOF
}

need_gate() {
  [ "${RELEASE_GATE:-}" = passed ] || { echo 'Set RELEASE_GATE=passed only after the root release gate.' >&2; exit 2; }
}

health_wait() {
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' tie-event)
    [ "$health" = healthy ] && return 0
    [ "$health" = unhealthy ] && return 1
    attempt=$((attempt + 1)); sleep 1
  done
  return 1
}

smoke() {
  image=$1
  name="tie-event-${RELEASE_ID}-smoke-$$"
  cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
  trap cleanup EXIT INT TERM
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
    attempt=$((attempt + 1)); sleep 1
  done
  [ "${health:-}" = healthy ] || { docker logs "$name" >&2; exit 1; }
  docker exec "$name" node --input-type=module -e '
    import assert from "node:assert/strict";
    const origin="http://127.0.0.1:4173", health=await fetch(origin+"/api/health"), privateApi=await fetch(origin+"/api/state"), home=await fetch(origin+"/");
    assert.equal(health.status,200); assert.equal(privateApi.status,401); assert.equal(home.status,200);
    const html=await home.text(), assets=[...html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)].map(match=>match[1]); assert.ok(assets.length>0);
    for(const asset of assets) assert.equal((await fetch(origin+asset)).status,200,asset);
    console.log(JSON.stringify({health:health.status,privateApi:privateApi.status,assets},null,2));
  '
  docker exec "$name" node --input-type=module -e 'import sharp from "sharp"; await sharp({create:{width:1,height:1,channels:3,background:"#fff"}}).webp().toBuffer(); await import("./server/http.mjs"); console.log("sharp-and-server-import=ok")'
}

backup_and_fingerprint() {
  stamp=$1
  backup="$ROOT/backups/before-${RELEASE_ID}-${stamp}.sqlite"
  before="$ROOT/backups/${RELEASE_ID}-${stamp}-before.json"
  backup_tmp="/tmp/${RELEASE_ID}-${stamp}.sqlite"
  before_tmp="/tmp/${RELEASE_ID}-${stamp}-before.json"
  helper="$ROOT/releases/$RELEASE_ID/deploy/ux-release-20260913-r1-db-fingerprint.mjs"
  [ -r "$helper" ] || { echo "Fingerprint helper is unavailable: $helper" >&2; exit 1; }

  docker exec tie-event node --input-type=module -e '
    import {DatabaseSync,backup} from "node:sqlite";
    const out=process.argv[1];
    const source=new DatabaseSync("/data/tie.sqlite",{readOnly:true});
    await backup(source,out); source.close();
    const copy=new DatabaseSync(out,{readOnly:true});
    const rows=copy.prepare("PRAGMA quick_check").all(); copy.close();
    if(!rows.every(row=>Object.values(row).includes("ok"))) throw new Error("SQLite quick_check failed");
  ' "$backup_tmp" >/dev/null
  docker exec tie-event sh -c 'test -s "$1"' sh "$backup_tmp"
  stream_container_file "$backup_tmp" "$backup"

  docker exec -i tie-event node --input-type=module - "$backup_tmp" "$before_tmp" < "$helper" >/dev/null
  docker exec tie-event sh -c 'test -s "$1"' sh "$before_tmp"
  stream_container_file "$before_tmp" "$before"
  printf '%s\n' "$backup" "$before"
}

stream_container_file() {
  source_path=$1 destination=$2 partial="${destination}.partial"
  [ ! -e "$destination" ] && [ ! -e "$partial" ] || { echo "Refusing to overwrite evidence: $destination" >&2; exit 1; }
  docker exec tie-event sh -c 'cat "$1"' sh "$source_path" > "$partial"
  [ -s "$partial" ] || { echo "Streamed file is empty: $source_path" >&2; exit 1; }
  chmod 600 "$partial"
  sha256sum "$partial" > "${destination}.sha256"
  chmod 600 "${destination}.sha256"
  mv "$partial" "$destination"
  chmod 600 "$destination"
}

verify_neighbors() {
  check_neighbor(){ url=$1 expected=$2; actual=$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$url"); [ "$actual" = "$expected" ] || { echo "$url returned $actual, expected $expected" >&2; return 1; }; printf '%s %s\n' "$actual" "$url"; }
  check_neighbor https://gutv.tech 200
  check_neighbor https://event.gutv.tech 200
  check_neighbor https://money.gutv.tech 307
  check_neighbor https://admin.cabinpxrn.ru 401
  check_neighbor https://pticaplus.tech 200
}

stage() {
  archive=$1 expected=$2
  [ -f "$archive" ] || { echo "Archive not found: $archive" >&2; exit 1; }
  actual=$(sha256sum "$archive" | awk '{print $1}')
  [ "$actual" = "$expected" ] || { echo 'Archive SHA-256 mismatch' >&2; exit 1; }
  release="$ROOT/releases/$RELEASE_ID"
  [ ! -e "$release" ] || { echo "Release directory already exists: $release" >&2; exit 1; }
  mkdir -p "$release"
  tar -xzf "$archive" -C "$release"
  (cd "$release" && docker build -t "$TAG" .)
  smoke "$TAG"
  docker image inspect "$TAG" --format '{{.Id}} {{index .RepoDigests 0}}' 2>/dev/null || docker image inspect "$TAG" --format '{{.Id}}'
}

activate() {
  need_gate
  release=$1
  [ "$release" = "$ROOT/releases/$RELEASE_ID" ] || { echo 'Unexpected release directory' >&2; exit 1; }
  docker image inspect "$TAG" >/dev/null
  previous_image=$(docker inspect -f '{{.Config.Image}}' tie-event)
  [ "$previous_image" = "$EXPECTED_ACTIVE" ] || { echo "Active image changed from expected $EXPECTED_ACTIVE; stop for root review" >&2; exit 1; }
  compose_actual=$(sha256sum "$ROOT/compose.yaml" | awk '{print $1}')
  [ "$compose_actual" = "$COMPOSE_SHA" ] || { echo 'compose.yaml changed; stop for root review' >&2; exit 1; }
  volume_before=$(docker volume inspect tie-event-data --format '{{.Name}} {{.Mountpoint}}')
  caddy_actual=$(sha256sum "$CADDY" | awk '{print $1}')
  [ "$caddy_actual" = "$CADDY_SHA" ] || { echo 'Caddyfile changed; stop for root review' >&2; exit 1; }
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  umask 077
  cp "$ROOT/.env" "$ROOT/backups/env-before-${RELEASE_ID}-${stamp}"
  backup_and_fingerprint "$stamp" > "$ROOT/backups/${RELEASE_ID}-${stamp}-backup-paths.txt"
  backup=$(sed -n '1p' "$ROOT/backups/${RELEASE_ID}-${stamp}-backup-paths.txt")
  before=$(sed -n '2p' "$ROOT/backups/${RELEASE_ID}-${stamp}-backup-paths.txt")
  [ -s "$backup" ] && [ -s "$before" ] || { echo 'Backup or pre-switch fingerprint is missing' >&2; exit 1; }
  switched=0
  rollback_after_switch() {
    status=$?
    trap - EXIT INT TERM HUP
    if [ "$switched" -eq 1 ]; then
      echo 'Activation verification failed; restoring previous image while retaining current SQLite' >&2
      sed -i "s#^TIE_IMAGE=.*#TIE_IMAGE=$previous_image#" "$ROOT/.env"
      (cd "$ROOT" && docker compose -f compose.yaml up -d app) || true
    fi
    exit "$status"
  }
  trap rollback_after_switch EXIT INT TERM HUP
  sed -i "s#^TIE_IMAGE=.*#TIE_IMAGE=$TAG#" "$ROOT/.env"
  switched=1
  (cd "$ROOT" && docker compose -f compose.yaml up -d app)
  health_wait || { echo 'New service is not healthy' >&2; exit 1; }
  after="$ROOT/backups/${RELEASE_ID}-${stamp}-after.json"
  after_tmp="/tmp/${RELEASE_ID}-${stamp}-after.json"
  before_tmp="/tmp/${RELEASE_ID}-${stamp}-before.json"
  helper="$release/deploy/ux-release-20260913-r1-db-fingerprint.mjs"
  docker exec -i tie-event node --input-type=module - /data/tie.sqlite "$after_tmp" < "$helper" >/dev/null
  docker exec tie-event sh -c 'test -s "$1"' sh "$after_tmp"
  stream_container_file "$after_tmp" "$after"
  docker exec -i tie-event sh -c 'umask 077; cat > "$1"' sh "$before_tmp" < "$before"
  docker exec -i tie-event node --input-type=module - --compare "$before_tmp" "$after_tmp" < "$helper"
  volume_after=$(docker volume inspect tie-event-data --format '{{.Name}} {{.Mountpoint}}')
  [ "$volume_before" = "$volume_after" ] || { echo 'External data volume identity changed' >&2; exit 1; }
  docker exec tie-event node --input-type=module -e 'import assert from "node:assert/strict"; const health=await fetch("http://127.0.0.1:4173/api/health"), privateApi=await fetch("http://127.0.0.1:4173/api/state"); assert.equal(health.status,200); assert.equal(privateApi.status,401);'
  curl -fsSI https://tie-event.cabinpxrn.ru/ | head -n 1
  verify_neighbors
  switched=0
  trap - EXIT INT TERM HUP
  printf 'previous_image=%s\nprevious_env=%s\nbackup=%s\nbefore_fingerprint=%s\nafter_fingerprint=%s\nvolume=%s\n' "$previous_image" "$ROOT/backups/env-before-${RELEASE_ID}-${stamp}" "$backup" "$before" "$after" "$volume_after"
}

rollback() {
  need_gate
  previous_image=$1 previous_env=$2
  [ -f "$previous_env" ] || { echo 'Previous .env backup not found' >&2; exit 1; }
  docker image inspect "$previous_image" >/dev/null
  cp "$previous_env" "$ROOT/.env"
  (cd "$ROOT" && docker compose -f compose.yaml up -d app)
  health_wait
}

case "${1:-}" in
  stage) [ "$#" -eq 3 ] || { usage >&2; exit 2; }; stage "$2" "$3" ;;
  activate) [ "$#" -eq 2 ] || { usage >&2; exit 2; }; activate "$2" ;;
  rollback) [ "$#" -eq 3 ] || { usage >&2; exit 2; }; rollback "$2" "$3" ;;
  *) usage >&2; exit 2 ;;
esac
