---
type: task
tags: [domain/wedding, layer/frontend, capability/quality, risk/medium, status/in-progress, task/review]
last_verified: 2026-09-13
---

# Browser acceptance of UX fixes, 2026-09-13

Owner: `ux_regression` (P4 requested Terra/high; runtime did not confirm the actual model).

Scope is limited to a repeatable, isolated browser regression runner, its evidence and this card. It must not alter application or server source, production state, or a real SQLite database.

The runner uses `scripts/design-preview.mjs` only as its filled, temporary fixture. It reads the resulting `test-results/design-preview.json`, logs in with that dummy account, launches the bundled Chrome/Playwright runtime, and writes structured observations and screenshots to `test-results/ux-fixes-2026-09-13/`.

Acceptance is browser behavior, not source inspection. Record only completed actions as passed; preserve a screenshot and exact reproduction for every failure.

Final local validation used the rebuilt bundle and a newly restarted temporary fixture: 99/99 Node tests and Vite build passed. The preserved full-run evidence is `test-results/ux-fixes-2026-09-13/r2-full-before-focused.json` (15 passed, with the former A05 hard-coded-name harness failure). Focused browser evidence is `test-results/ux-fixes-2026-09-13/results.json`, run against a separate temporary SQLite database at `http://127.0.0.1:4189`: A04-loading, A05, A07, A12 and A14 all passed with no console or asset failures. A05 reads the first displayed unseated guest name from the DOM before filtering; it observed `Алина Мельникова` and then retained only that guest. A07 observed recipient `Нина Орлова` with localized issue/expiry dates and a copied recipient link. A12 asserted `aria-current="page"` while the drawer was open, then verified Escape restored focus to its trigger. A14 dismissed and accepted both unpublish and archive confirmations only in the temporary fixture, then republished the microsite for the remaining focused checks. A04-loading held the initial microsite response and confirmed the editor was absent until the response was released.
