import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRoute,viewUrl} from '../src/v2/routes.js';
import {calendarGrid} from '../src/v2/calendar/grid.mjs';
import {activeWeddingSection, defaultWeddingView, normalizeWeddingView, visibleWeddingSections, profileProjectId} from '../src/project-navigation.mjs';
import {isVenueSelection} from '../src/vendor-category-tabs.mjs';

test('wedding navigation has the requested order and keeps secondary routes under More', () => {
  const state = {user:{protected:true}, project:{id:'wedding-1'}, entities:[{kind:'table',data:{key:'guests'}},{kind:'table',data:{key:'timing'}}]};
  for (const space of ['organizer','couple']) {
    assert.deepEqual(visibleWeddingSections(state,space).map(([,label])=>label), ['Смета','Площадка','Тайминг','Подрядчики','Документы','Гости','Рассадка','План','Календарь','Ещё']);
    assert.equal(normalizeWeddingView('project:overview',state,space),'project:estimate');
    assert.equal(activeWeddingSection('project:approvals:approval-1',space),'more');
    assert.equal(activeWeddingSection('project:calendar',space),'calendar');
    assert.equal(activeWeddingSection('project:timing-team',space),'timing-pair');
  }
  assert.deepEqual(parseRoute(viewUrl('project:venue:selection-1','wedding-1')), {projectId:'wedding-1',view:'project:venue:selection-1'});
});

test('removed overview redirects to an available wedding section without expanding restricted roles', () => {
  const state = {user:{},project:{id:'wedding-1'},entities:[],grants:[{project_id:'wedding-1',role_key:'couple',permissions:['read'],restrictions:{sections:['vendors','calendar']}}]};
  assert.deepEqual(visibleWeddingSections(state,'couple').map(([id])=>id),['venue','catalog','calendar','more']);
  assert.equal(defaultWeddingView(state,'organizer'),'project:venue');
  assert.equal(normalizeWeddingView('project:approvals:a',state,'couple'),'project:approvals:a');
  const contractor = {...state,grants:[{project_id:'wedding-1',role_key:'contractor',permissions:['read'],restrictions:{sections:['tasks','files']}}]};
  assert.equal(defaultWeddingView(contractor,'organizer'),'project:tasks');
  assert.deepEqual(visibleWeddingSections(contractor,'contractor').map(([id])=>id),['tasks','files','more']);
});

test('account navigation restores the assigned wedding without selecting revoked or ambiguous access',()=>{
  const state={user:{},projects:[{id:'assigned'}],grants:[{project_id:'assigned',role_key:'couple',permissions:['read']}]};
  assert.equal(profileProjectId(state,null),'assigned');
  assert.equal(profileProjectId(state,'revoked'),'assigned');
  assert.equal(normalizeWeddingView('profile',state,'couple'),'profile');
  assert.deepEqual(parseRoute(viewUrl('profile','assigned')),{view:'profile',projectId:null});
  assert.equal(profileProjectId({...state,projects:[]},'revoked'),null);
  const multiple={...state,projects:[{id:'assigned'},{id:'other'}]};
  assert.equal(profileProjectId(multiple,'assigned'),'assigned');
  assert.equal(profileProjectId(multiple,'revoked'),null);
});

test('organizer account stays global while role previews and contractors retain their valid wedding',()=>{
  const state={user:{protected:true},projects:[{id:'wedding-1'},{id:'wedding-2'}],grants:[]};
  assert.equal(profileProjectId(state,'wedding-1','organizer'),null);
  assert.equal(profileProjectId(state,'wedding-2','couple'),'wedding-2');
  assert.equal(profileProjectId({...state,user:{},grants:[{role_key:'contractor'}]},'wedding-1'),'wedding-1');
});

test('venue workspace reuses existing category links and legacy category names', () => {
  const categories=[{id:'v',data:{name:'Площадка'}},{id:'p',data:{name:'Фотограф'}}];
  assert.equal(isVenueSelection({data:{categoryId:'v'}},categories),true);
  assert.equal(isVenueSelection({data:{categoryName:' площадка '}}),true);
  assert.equal(isVenueSelection({data:{categoryId:'p',categoryName:'Площадка'}},categories),false);
  assert.equal(isVenueSelection({data:{categoryName:'Фотограф'}}),false);
});

test('attention routes retain their source ID and resolve to the intended project workspace',()=>{
  const guest=parseRoute('/app/projects/wedding-1/guests/guest-9');
  const seating=parseRoute('/app/projects/wedding-1/seating/guest-9');
  assert.deepEqual(guest,{projectId:'wedding-1',view:'project:guests:guest-9'});
  assert.deepEqual(seating,{projectId:'wedding-1',view:'project:seating:guest-9'});
  assert.equal(viewUrl('project:seating:guest-9','wedding-1'),'/app/projects/wedding-1/seating/guest-9');
});

test('month and week calendar grids start on Monday and contain the selected date',()=>{
  const september=calendarGrid('2026-09-14','month');
  assert.equal(september.start,'2026-08-31');
  assert.equal(september.days.length,42);
  assert.equal(september.days[1],'2026-09-01');
  assert.equal(september.days.includes('2026-09-14'),true);
  const week=calendarGrid('2026-09-14','week');
  assert.deepEqual(week.days,['2026-09-14','2026-09-15','2026-09-16','2026-09-17','2026-09-18','2026-09-19','2026-09-20']);
  assert.equal(calendarGrid('','month').days.length,42);
  assert.equal(calendarGrid(null,'week').days.length,7);
});


test('couple and contractor routes cannot open team timing, and wedding sites follow the admin switch',()=>{
 const state={user:{},project:{id:'w'},entities:[{kind:'table',data:{key:'timing'}}],grants:[{role_key:'couple',project_id:'w',permissions:['read']}]};
 assert.equal(normalizeWeddingView('project:timing-team',state,'couple'),'project:timing-pair');
 assert.equal(normalizeWeddingView('project:timing-team:row-1',state,'couple'),'project:timing-pair');
 assert.equal(normalizeWeddingView('project:site',state,'couple'),'project:more');
 assert.equal(normalizeWeddingView('project:site',{...state,project:{id:'w',data:{personalInvitationsEnabled:true}}},'couple'),'project:site');
 const organizer={...state,grants:[{role_key:'organizer',project_id:null,permissions:['read','projects']}]};
 assert.equal(normalizeWeddingView('project:timing-team',organizer,'organizer'),'project:timing-team');
 const contractor={...state,grants:[{role_key:'contractor',project_id:'w',permissions:['read']}]};
 assert(!visibleWeddingSections(contractor,'contractor').some(([key])=>key==='timing-team'));
 assert.notEqual(normalizeWeddingView('project:timing-team',contractor,'contractor'),'project:timing-team');
});
