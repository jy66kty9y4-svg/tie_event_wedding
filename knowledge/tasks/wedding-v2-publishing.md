---
card_id: wedding-v2-publishing
status: frozen
version: 2
supersedes: null
work_id: wedding-v2
task_id: publishing
purpose: Implement wedding and agency publication workflows end to end
role: developer
card_path: knowledge/tasks/wedding-v2-publishing.md
dependency_shas: []
branch: codex/v2-publishing
write_scope:
  - server/v2/publishing
  - src/v2/publishing
  - tests/v2-publishing.test.mjs
  - docs/v2/PUBLISHING-API.md
forbidden_paths:
  - server/db.mjs
  - server/service.mjs
  - server/http.mjs
  - src/main.jsx
  - src/styles.css
contract_versions:
  input: v2
  output: v2
acceptance_commands:
  - node --test tests/v2-publishing.test.mjs
knowledge_paths:
  - knowledge/INDEX.md
  - knowledge/tasks/wedding-v2-publishing.md
  - knowledge/components/v2-contract.md
---

Wedding microsite draft/editor/preview/publish/unpublish/rotate with immutable allowlisted snapshots, 3 templates/blocks/time fields; public agency real-case/package/FAQ CMS drafts/publication/slug/SEO SSR sitemap, no fictional content. Private-image-to-public raster decoding/reencoding sanitization, separate active ownership-bound assets, EXIF strip 12MB/40MP limits. Optional library installation owned root; tell root exact dependency/version if required after official docs verification, never install into symlinked other project. Own pure public rendering module and React editors/pages, private preview endpoints; UI keeps fields/publication errors. Guest RSVP is separate worker follow microsite shared boundary.

Use common module interface and only scoped files. Implement complete working module and frontend, not placeholders. Run focused tests and build parse check as feasible; root integrates final browser tests. Commit feature changes and return SHA, changed paths, exact passing checks, API hooks and concise knowledge_delta proposal. Do not edit frozen card/shared knowledge. Never spawn or load Orda/routing. Requested P4 Terra/high, runtime model not confirmed until tool response.
