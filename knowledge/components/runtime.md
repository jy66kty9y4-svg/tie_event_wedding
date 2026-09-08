---
type: component
tags: [component/runtime]
last_verified: 2026-09-08
source_paths: [src/client.js, public/sw.js, server/http.mjs, scripts/browser-test.mjs, scripts/start.sh]
---

# Local runtime and offline data

The Node HTTP server binds to localhost by default and serves the production bundle and authorized API. API/private file responses are never put in CacheStorage. Explicit project preparation writes permission-filtered snapshots to identity-scoped IndexedDB.

Service worker precaches the shell and same-origin static module dependencies (bounded to 128 literal module imports). The current production bundle is one module. Queue commands preserve versions, schema versions and independent obligation versions. Cross-tab synchronization uses a lock. Failed commands retain their data and error for explicit resolution. Re-preparation does not remove the queue.

Browser acceptance uses separate persistent installed-Chrome profiles: cold offline restart; durable timing edit and 12,345-kopek payment; concurrent/repeated synchronization once; independent 6,789-kopek settlement conflict; removed-column conflict; permission revocation; cross-tab account switch and offline logout. A device cannot learn of permission revocation while disconnected. See scripts/browser-test.mjs.

The launcher changes to its own project directory. PLAYWRIGHT_MODULE_PATH and CHROME_PATH may override browser-test runtime detection.
