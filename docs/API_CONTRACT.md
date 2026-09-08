# Shared implementation contract v1

Node >=22.13, React 19, Vite 8, SQLite. Build with `node node_modules/vite/bin/vite.js build`. Bundled node: `/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`. Local dependency symlink may point to `/Users/cabinpxrn/Documents/ChatGPT/ГУТВ/node_modules`, never change that target.

## HTTP API (runtime worker owns)

GET /api/public?agency=tie → publicInfo; POST /api/setup → bootstrap only when DB empty, POST /api/register, /api/login → register/authenticate sets session cookie. POST /api/logout clears server session. GET /api/state?project=ID → snapshot. GET /api/offline?project=ID → snapshot(...,true). POST /api/command → execute. POST /api/files?project=ID → upload JSON base64. GET /api/files/ID → authorized download. GET /api/health. Server imports db/auth/service. Errors `{error,details}`, status from Fault, no raw stack. All mutation requests same-origin JSON, rate limiting, 12 MB request ceiling. Serve dist shell for SPA routes. Static service worker MUST NOT cache API/private network responses.

State shape: `{user,agency,grants,projects,applications,notifications,global,roles,users,assignments,financials}`. `loadState(project)` returns `{user,agency,grants,project,entities,members,history,financials}`. Entity `{id,agency_id,project_id,kind,parent_id,data,version,deleted,updated_at}`. Tables data `{name,key,sectionId,order,archived,offline,columns:[{id,name,type,options?,formula?}]}`. Rows have parent_id table ID, data is column ID/value map. Both timing views use one `key:timing` table, seating uses `key:guests`.

## Frontend client module (runtime worker owns src/client.js)

`api(path, options?)` JSON fetch with same-origin credentials, throws Error with `.status` and `.details`.

`loadState(projectId = null)` server snapshot online, prepared snapshot offline. `command(body)` adds crypto.randomUUID id when absent, sends online; queues only row edits and movement.save in prepared project offline, returns `{queued:true,id}`. On successful queued mutation update local snapshot. Never queue non-network server errors. `prepareProject(projectId)` explicitly fetches permitted configured offline snapshot, saves into IndexedDB. `getOfflineStatus(projectId?)` → `{preparedAt,expiresAt,pending,conflicts,projects:[{id,name}]}`; pending count, conflicts array `{id,command,error,status,details}`. `syncQueue()` sequential authorized replay, keep failed commands for user decisions. `discardCommand(id)` removes a failed command only on user click; `retryCommand(id, replacements)` explicitly changes versions/schema versions after user review (new id when changing content). `logout()` clears private storage and server session (offline logout clears locally, next online session cannot restore old identity). `subscribe(callback)` returns unsubscribe for window online/offline/client data event; `initClient()` registers SW and checks/sanitizes identity on online account switch. Use plain event/callback API, UI owns React state. Exports must exist.

## Commands (server worker owns domain)

All `{id,op,projectId?}`. Mutations return entity/result; UI reloads afterward.

- project.create `{data:{name,date,location?,limit?},templateId?}`
- application.create `{data:{name,date,contact,message}}` registered user; application.review `{entityId,version,status,reason}`
- invite.create `{projectId,email,roleId,restrictions?}` returns token; invite.accept `{token}`
- invite.revoke `{invitationId}`; creation returns `{id,token,email,expiresAt}` and defaults to the couple role when roleId is omitted. Acceptance rechecks the issuer's current authority.
- application.respond `{entityId,version,data:{name,date,contact,message}}` lets the applicant resubmit after clarification/rejection.
- role.save `{roleId?,version?,name,permissions:[...]}`; grants.save `{userId,version,disabled,grants:[{roleId,projectId,restrictions:{sections,rows,fields}}]}`
- settings.save `{version,name,settings:{tagline,description,contact,services:[string],portfolio:[{title,image,description?}]}}`
- entity.create `{projectId?,kind,parentId?,data,schemaVersion?}`; entity.edit `{projectId?,entityId,version,data,schemaVersion?}` patches fields; entity.delete `{projectId?,entityId,version,schemaVersion?,confirm?}` soft delete with reference warning; entity.restore `{...,auditId?}`
- movement.save `{projectId?,entityId?,version?,obligationVersion?,data:{type,amount,date,description,source:'custody'|'direct',from?,to?,obligationId?,categoryId?,fileId?}}`; movement.delete `{projectId?,entityId,version}`. Money is integer kopecks. Types deposit, payment, refund, transfer, fee (wedding), income/expense (agency).

Native kinds: obligation `{title,priceKind:'amount'|'unknown'|'included',agreed:number|null,planned:number|null,categoryId?,dueDate,condition?,responsible?,fee:boolean}`; selection `{title,vendorId?,price:number|null,selected:boolean,terms?,dueDate?}` gets server obligationId when selected; vendor `{name,categoryId?,contact,portfolio,price,services,terms,notes,updatedOn,archived}`; category `{name,scope,archived}`; vendorCategory `{name,archived}`. Global kinds use projectId null. Template schema in model.initialTemplate. `src/shared.js` exports money,cents,dateLabel,today,permissions,permissionLabels,fieldTypes,statuses,movementLabels,compute.

Project data editing uses entity.edit with entityId=projectId and projectId=projectId (project stored globally but permission scope project). data `{name,date,location,status,limit,offline:['payouts'],notes}`. Table offline boolean configured independently. Finance snapshot `{agreed,planned,unknown,paid:{obligationId:cents},totalPaid,due,holders:{userId:cents},custody,own,byCategory}`. Offline obligations have paid/due fields but no full ledger.

Project snapshots also expose `custodians:[{id,name}]`, `members`, and `inviteRoles`. Use custodians for money holders; a couple account cannot become a staff cash holder. Tables may set `data.rowOrder:[rowId,...]`; schema removals preserve values for restoration and validate formula references.

Movement data additionally accepts optional `counterparty` (1–500 characters) and `method` (1–100 characters); omit empty optional values. `fileId` points to an authorized confirmation. `from`/`to` remain staff holder IDs. Agency finance adds `incomeByCategory` and `expenseByCategory`; estimate `byCategory` remains separate. History includes `current_version` and `current_deleted` for safe restoration. Empty online sections are visible only when directly authorized.

Do not put original XLSX personal details, credentials or source databases in artifacts. Demo uses separate data/demo.sqlite, clean default data/tie.sqlite. Tests use in-memory databases and invented people.
