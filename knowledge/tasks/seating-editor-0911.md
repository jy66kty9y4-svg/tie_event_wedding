---
type: task
status: complete
updated: 2026-09-11
---
# Seating editor browser feedback

Root implemented and published all nine browser comments without delegation. Changes are scoped to guest Workspace/CSS, new ContourEditor, interaction helpers, zone validation and regression tests. Existing auth, finance, assignments, optimistic versions and shared infrastructure remain in place.

Release: tie-event:seating-20260911-r1. Evidence/limits: docs/v2/SEATING_EDITOR_2026-09-11.md. Deployment/rollback: docs/DEPLOYMENT.md. 90 tests pass; local CUA checks filled interactions, production checks read-only entry. Before/after checksums match for 21 nonvolatile tables, 23 entities preserved.

Important: numeric drafts stay strings until validation; geometric preview uses last valid saved number for temporarily empty fields. Draft contour closes only on first-point activation. Pointer selection must not hide tool panels on pointerdown because changing canvas origin produces drag jumps. Custom zone outlines share normalized geometry validation with tables.
