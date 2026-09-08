---
type: component
version: 2
source_paths: [server/v2/guest/index.mjs, src/v2/guest/Workspace.jsx, server/service.mjs]
last_verified: 2026-09-08
---
# Guest and seating integration

Merged domain uses existing guest table rows. Semantic mapping binds stable column IDs; RSVP and seating edits use dedicated commands, generic edits protect those fields. Deleting a guest clears seat fields; restoration never reclaims the old seat. Native relation validation permits only row or explicit seatingTable targets.

Guest sessions are independent of staff sessions. Tokens are hashed and transmitted in fragments, exchange produces session and CSRF values for the HTTP adapter. Guest history uses actor_type guest_invite and actor_ref, with an empty legacy actor_id. Share lookup must match exactly; never fall back to another published microsite.

Synchronous onRespond hook runs inside the RSVP transaction and writes durable notification work. Guest invites store expiry as integer milliseconds. Publication status/deadline and row/schema/invite versions are rechecked per response.

Evidence at integration: 18 V1 domain and 6 guest tests pass together; production Vite build passes. Full HTTP guest-session and production browser acceptance remains a root integration task, including public publication lifecycle and exports.
