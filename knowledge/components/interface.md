---
type: component
tags: [component/interface]
last_verified: 2026-09-28
source_paths: [src/main.jsx, src/ui, src/styles.css, src/v2/guest/GuestRegistrySheet.jsx, src/v2/guest/guest-sheet.css, scripts/ui-test.mjs, scripts/management-ui-test.mjs, scripts/offline-ui-test.mjs]
---

# Wedding interface

Public settings and portfolio are independent of private wedding projects. Authentication handles installation slugs and invitation URLs. A newly registered client without a project sees a dedicated single-page waiting screen: it asks for an application if none exists, thanks them after submission, shows the agency contact and any clarification request, and opens the couple workspace only after approval creates a project. A couple with one project opens it directly. Mobile navigation includes logout.

ProjectTools provides editable section/table schemas, independent payouts, invitation links and conflict comparison. ManagementForms handles multiple scoped grants, templates and category naming/archiving. TableWorkspace preserves integer money, filters/sorts and sums visible rows, resolves row/file links, and sends only changed editable fields. Guests/seating and both timing audiences share records.

Forms retain errors without closing. Structural changes show consequences and history supports restore. Selected vendor terms and estimate prices share a transactional obligation. Wedding custody and agency balances have separate views. Production offline acceptance uses actual rendered forms and two cold browser restarts; runtime conflict/isolation tests remain separate.

The admin shell offers organizer, couple and contractor workspace navigation with a project picker for the latter two. The selected space is kept per browser tab and restored with browser history. It changes the interface context, not the signed-in account's server permissions. The dedicated browser check is `scripts/workspace-switch-test.mjs`.

As of 2026-09-28, the admin space switch is a dropdown inside agency Settings, not a sidebar block. Settings groups Site (details and publishing), Access (all registered users with search; actions are scoped by server-provided `manageable`), Integrations, and Directories (vendors, vendor categories, templates, agency categories). Administrators can return to Settings from couple and contractor views. The live release is `tie-event:product-20260928-r2`. Wedding lists split by local date, and wedding vendor tabs show only categories with active proposals; category renames propagate their labels to selections while deletion requires removing live references.

The Team screen lets administrators and global organizers create accounts with a scoped role, reset passwords, soft-remove accounts and restore them. Organizers cannot manage protected or higher-privilege accounts, and changing a password or removing an account revokes its sessions. `scripts/user-management-test.mjs` exercises the account UI.

Project finances now open on the couple's seven-section «Смета» copied from «Шаблон для пар.xlsx» (96 starting articles, four money columns and notes). The sheet supports search, inline renaming/note/amount edits, rows added within each section, and custom sections via controls inside the table. Project-scoped `coupleBudget` data stores sparse cell edits and custom structure; `src/couple-budget.js` calculates overall, section and organizer-only totals, including added rows. The workbook has source defects in E33 and C/D/E135; site calculations use consistent actual-minus-prepaid and include row 134 in its section subtotal. The legacy obligations/movements screen remains under «Реестр выплат» and is a separate ledger, not an automatic source for the copied sheet. The sheet is available offline only if the project enables the `budget` offline section; structural additions require a connection.

The project «Гости» page now uses `src/v2/guest/GuestRegistrySheet.jsx`: inline guest creation and per-cell edits on the same table, including RSVP through its specialized command. It preserves invitation selection/link management and a route to the full registry. The shared default is exactly seven visible fields: «ФИО», «Чей гость», «Кем приходится», «Пищевые аллергии», «Алкоголь», «Контакт», «Приглашение»; seating IDs remain hidden. The dense fixed table layout keeps these fields in one desktop view, and invitation recipients are selected in the explicit «Для ссылки» column. Structure-capable users can add, rename, reorder and delete visible columns in place; «ФИО» and «Приглашение» remain required. New and existing boolean fields render as checkboxes, including the inline new-guest form. Editing honors field-scoped permissions; the mobile table scrolls within its own container. The former display-only guest registry remains as unused legacy code in `Workspace.jsx` pending cleanup.

Evidence is recorded in docs/ACCEPTANCE.md and executable scripts. Brand/content are provisional. Local preview uses separate clean and fictional demo databases. Source services and the original workbook are not modified.
