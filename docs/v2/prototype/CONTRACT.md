# Prototype implementation contract

Owner: root. This is an isolated interactive visual prototype, no application API, no production data. Existing application files may be edited by another chat: do not touch them.

Visual reference: docs/v2/prototype-v1.html and docs/v2/references. Warm white #FDFCFC, cards #fff, text #302B2E, muted #756B71, rose #AD4E6C, pale #F8E8EE, line #E5DFE2. Georgia display headings 30/25px, system body 14px. Shell left240/top64/project tabs, compact calm design matching the original. Do not invent a different style.

Classic deferred scripts, all modules an IIFE `(function(T){ ... })(window.Tie);`. No module imports or fetching. Every screen registered with `T.register({screenId: {title:'...',scope:'project'|'agency'|'public',tab:'optional project tab',render:()=>HTML,onMount:()=>void}})`.

Shared API:
- T.data contains projects[{id,name,date,venue,status}], tasks, approvals, guests, tables, vendors, events. Use module-specific `T.data.foo` arrays if needed. All data are fictitious.
- T.state = {route:'today',projectId:'p1',mode:'filled',role:'organizer'}; roles organizer/couple; mode filled/empty/issues. `T.project()` returns current project.
- T.go(route) changes hash and renders. Links use `<button data-go="tasks">` or `<a href="#tasks" data-go="tasks">`.
- T.render() redraws current page.
- T.registerActions({actionName:(element,event)=>...}); HTML uses data-action="name" plus data-id etc. Action names MUST module prefix, e.g. wf-task-open, ev-guest-open, pub-apply.
- T.modal({title,body,footer:'optional HTML',wide:false,onMount:fn}) opens a dialog with ×, escape/backdrop close, focus trap. `T.closeModal()`.
- T.toast(text) only for lightweight confirmations after an actual visual state change. Do not use dead-end toasts as substitutes for screens/forms.
- T.icon(name,size=18) returns inline SVG. Names home,inbox,heart,check,calendar,users,store,file,chart,settings,bell,search,plus,chevron,arrow,close,copy,external,download,edit,trash,clock,warning,mail,image,grid,list,menu,logout,eye,link,help,check-circle,seat,send.
- T.escape(value), T.money(numberRubles), T.avatar(name), T.badge(label,tone='rose'|'green'|'amber'|'gray'|'red').
- T.heading(title,subtitle='',actions='') => section heading HTML; project context header/tabs are added by shell automatically (avoid duplication).
- T.button(label,action,kind='primary'|'secondary'|'ghost',extraAttrs='') => button with data-action; optional icon use direct HTML.
- T.empty(title,body,buttonHTML) => polished empty state.
- T.field(label,controlHTML,wide=false); T.input(name,value='',placeholder='',type='text'); T.select(name,options,value) where options array strings or [value,label].
- T.formValues(form) returns Object.fromEntries(new FormData(form)). Fields use name attributes.
- T.download(name,content,type='text/plain'); client side only.

Shared CSS classes:
.btn(.primary/.secondary/.ghost/.danger/.small), .icon-btn, .badge, .avatar, .panel, .panel-pad, .section-heading, .subtle, .eyebrow, .toolbar, .search-input, .segmented, .active, .table-wrap, .data-table, .row-main, .row-sub, .cards-grid (3cols), .two-col (2:1), .stat-grid(4), .stat-card, .stack, .inline, .spacer, .form-grid(2), .field, .field.full, .notice(.amber/.green), .clickable-row, .empty-state, .divider, .link-button.
CSS component owners may add own prefixed classes in own CSS, imported by root. All controls min40, touch44; mobile no body overflow; tables own scroll. No private technical implementation copy in UI. Demo disclosure is in root toolbar, don't repeat large warnings everywhere.

Routing ownership:
root: today, applications, application-detail, projects, overview, tasks-all, calendar, vendors, vendor-detail, templates, team, agency-finance, settings, notifications, profile, finance, payouts, files, history, project-settings, tables, more, members, offline, content.
workflow: tasks, task-detail, approvals, approval-detail.
event: guests, guest-detail, seating, day.
public: public, stories, story, services, faq, application, login, guest, guest-success.

A route can read T.state.detailId or use local module selectedId. Create/edit in modal; save local data and rerender, persist current screen across back/forward. Root may store session-only state but no credentials. Do not log real data. Every visible CTA needs a clear screen/dialog/action. Images: use image URLs only if grounded/verified or root-provided assets; do not use placeholder box text in finished designs.
