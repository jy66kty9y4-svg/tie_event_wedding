---
type: task
status: complete
updated: 2026-09-13
---
# System and visual UX audit

Scope: read-only production browser walkthrough, current source review, isolated runtime tests. No production writes, fixes, releases or data cleanup authorized by this audit request.

Root: live browser desktop/mobile visual and workflow audit, evidence synthesis.
Workers: ui_accessibility_audit (forms, dialogs, accessibility) and system_flow_audit (saving, offline, permissions). Requested P6 routes: gpt-5.6-sol/high, launched; tool response does not confirm actual model/effort, so actual execution is unconfirmed. Both workers read-only; root owns only audit docs/evidence. Existing application changes remain untouched.

Operational evidence: test-results/audit-2026-09-13/ (the workspace .codex directory is read-only in this session). Deliverable: docs/v2/SYSTEM_UX_AUDIT_2026-09-13.md.

Completed: 16 finding groups, with production-browser observations separated from code-supported risks. Main findings: guest/seating attention deep-link fallback, broken calendar newDate action, microsite closure timezone drift and unsaved internal navigation; mobile seating and guest-list usability, indistinguishable invitations, calendar alignment/styles, retained navigation scroll and public header overflow at 320 px. Menu keyboard focus/Escape issue verified live. All 90 tests passed after permission to bind isolated local HTTP ports; isolated Vite build passed. Live main JS/CSS asset identifiers match fresh build. No production state writes and no application source edits. Other roles, full offline lifecycle, physical touch devices and full server-image parity were not browser-verified.
