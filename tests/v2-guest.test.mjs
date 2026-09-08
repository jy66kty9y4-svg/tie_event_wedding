import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, entity, insert } from '../server/db.mjs';
import { bootstrap, execute, register } from '../server/service.mjs';
import { entities } from '../server/db.mjs';
import { configureGuestHooks, context, exchange, execute as executeGuest, guestInvites, guestList, migrate, redactGuestCommandResult, respond, seatingSnapshot, validateGuestRowMutation, validateGuestSchemaMutation } from '../server/v2/guest/index.mjs';

let n=0;
const id=()=>`guestcmd_${++n}`;
const v1=(db,u,op,body={})=>execute(db,u,{id:id(),op,...body});
const v2=(db,u,op,body={})=>executeGuest(db,u,{id:id(),op,...body});
const failure=(fn,status=400)=>assert.throws(fn,error=>error?.status===status);

function publishedSite(db,user,project,{shareId='z'.repeat(24),rsvpDeadline='2099-08-10',closesAt=null,displayFields={mealEnabled:true,transportEnabled:true}}={}) {
  const site=insert(db,user,'microsite',{shareId,status:'published',publishedRevisionId:null,rsvpDeadline,closesAt},project.id);
  const revision=insert(db,user,'micrositeRevision',{revision:1,displayFields},project.id,site.id);
  db.prepare('UPDATE entities SET data=?,version=version+1 WHERE id=?').run(JSON.stringify({...site.data,publishedRevisionId:revision.id}),site.id);
  return entity(db,site.id);
}

function fixture() {
  const db=openDatabase(':memory:'); const {user}=bootstrap(db,{slug:'guest-test',agencyName:'Тест',email:'owner@example.test',name:'Владелец',password:'strong-pass-1'}); migrate(db);
  const project=v1(db,user,'project.create',{data:{name:'Ира и Макс',date:'2027-08-14',location:'Москва'}});
  let table=entities(db,user.agency_id,project.id,'table').find(item=>item.data.key==='guests');
  table=v1(db,user,'entity.edit',{projectId:project.id,entityId:table.id,version:table.version,data:{...table.data,columns:[...table.data.columns,{id:'seat_table',name:'Стол (ID)',type:'relation',targetKind:'seatingTable'},{id:'seat_index',name:'Место',type:'number'}]}});
  const row=v1(db,user,'entity.create',{projectId:project.id,kind:'row',parentId:table.id,schemaVersion:table.version,data:{name:'Ира',status:'Приглашён',meal:'',contact:'',seat_table:'',seat_index:''}});
  table=v2(db,user,'guestMapping.save',{projectId:project.id,guestTableId:table.id,schemaVersion:table.version,data:{semanticMap:{guestName:'name',rsvpStatus:'status',diet:'meal',contact:'contact',seatingTable:'seat_table',seatIndex:'seat_index',rsvpValues:{unanswered:'Не отправлено',confirmed:'Подтвердил',declined:'Отказ',tentative:'Приглашён'}}},confirm:true});
  return {db,user,project,table,row};
}

test('guest mapping preserves V1 columns and generic mapped mutations are blocked',()=>{
  const {table,row}=fixture();
  assert.equal(table.data.semanticMap.guestName,'name');
  assert.equal(validateGuestSchemaMutation(table,{...table,data:{...table.data,columns:table.data.columns.filter(column=>column.id!=='status')}}).ok,false);
  failure(()=>validateGuestRowMutation(table,row,{...row.data,status:'Подтвердил'},['status']),409);
  assert.doesNotThrow(()=>validateGuestRowMutation(table,row,{...row.data,status:'Подтвердил'},['status'],{specialized:true}));
});

test('family invitation is scoped, sessioned, idempotent and a declined RSVP frees the same-row seat',()=>{
  const {db,user,project,table,row}=fixture();
  const plan=v2(db,user,'seatingPlan.save',{projectId:project.id,data:{name:'Зал',widthM:12,heightM:8,scale:1,guestTableId:table.id}});
  const seat=v2(db,user,'seatingTable.create',{projectId:project.id,planId:plan.id,planVersion:plan.version,data:{label:'Стол 1',shape:'round',xM:1,yM:1,widthM:1.5,heightM:1.5,capacity:4}});
  const seated=v2(db,user,'seating.assign',{projectId:project.id,guestTableId:table.id,schemaVersion:table.version,guestRowId:row.id,rowVersion:row.version,tableId:seat.id,tableVersion:seat.version,seatIndex:1,confirmNonConfirmed:true});
  publishedSite(db,user,project);
  const invitation=v2(db,user,'guestInvite.create',{projectId:project.id,guestTableId:table.id,schemaVersion:table.version,guestRowIds:[row.id],expiresAt:new Date(Date.now()+86400000).toISOString()});
  assert.equal(typeof invitation.token,'string');
  const session=exchange(db,{shareId:'z'.repeat(24),token:invitation.token});
  const before=context(db,{shareId:'z'.repeat(24),sessionToken:session.sessionToken,csrfToken:session.csrfToken});
  assert.equal(before.guests.length,1); assert.equal(before.guests[0].name,'Ира');
  let hook; configureGuestHooks({onRespond:(_db,actor,projectId,affected,commandId)=>{hook={actor,projectId,affected,commandId};}});
  const payload={shareId:'z'.repeat(24),sessionToken:session.sessionToken,csrfToken:session.csrfToken,commandId:'rsvp_command_01',inviteVersion:before.inviteVersion,schemaVersion:before.schemaVersion,changes:[{rowId:row.id,rowVersion:seated.version,values:{rsvp:'declined',diet:'Без мяса'}}]};
  const saved=respond(db,payload); const replay=respond(db,payload);
  assert.deepEqual(replay,saved); assert.equal(hook.actor.actorType,'guest_invite'); assert.equal(hook.projectId,project.id);
  const changed=entity(db,row.id); assert.equal(changed.data.status,'Отказ'); assert.equal(changed.data.seat_table,''); assert.equal(changed.data.seat_index,'');
  assert.equal(db.prepare("SELECT count(*) AS n FROM audit WHERE actor_ref=? AND actor_type='guest_invite' AND action LIKE 'guest_%'").get(invitation.inviteId).n,2);
  assert.equal(seatingSnapshot(db,user,project.id,plan.id).unseated.length,0);
  configureGuestHooks({});
});

test('seating prevents double booking and refuses a table delete until its assignments are confirmed',()=>{
  const {db,user,project,table,row}=fixture();
  const second=v1(db,user,'entity.create',{projectId:project.id,kind:'row',parentId:table.id,schemaVersion:table.version,data:{name:'Макс',status:'Приглашён',meal:'',contact:'',seat_table:'',seat_index:''}});
  const plan=v2(db,user,'seatingPlan.save',{projectId:project.id,data:{name:'Зал',widthM:10,heightM:6,guestTableId:table.id}});
  const seat=v2(db,user,'seatingTable.create',{projectId:project.id,planId:plan.id,planVersion:plan.version,data:{label:'Семья',shape:'rect',xM:1,yM:1,widthM:2,heightM:1,capacity:2}});
  const first=v2(db,user,'seating.assign',{projectId:project.id,guestTableId:table.id,schemaVersion:table.version,guestRowId:row.id,rowVersion:row.version,tableId:seat.id,tableVersion:seat.version,seatIndex:1,confirmNonConfirmed:true});
  failure(()=>v2(db,user,'seating.assign',{projectId:project.id,guestTableId:table.id,schemaVersion:table.version,guestRowId:second.id,rowVersion:second.version,tableId:seat.id,tableVersion:seat.version,seatIndex:1,confirmNonConfirmed:true}),409);
  failure(()=>v2(db,user,'seatingTable.delete',{projectId:project.id,entityId:seat.id,version:seat.version,guestTableId:table.id}),409);
  const deleted=v2(db,user,'seatingTable.delete',{projectId:project.id,entityId:seat.id,version:seat.version,guestTableId:table.id,confirmUnassign:true,rows:[{id:row.id,version:first.version}]});
  assert.equal(deleted.deleted,true); assert.equal(entity(db,row.id).data.seat_table,'');
});

test('specialized organizer RSVP clears a seat, and capacity cannot shrink under occupants',()=>{
  const {db,user,project,table,row}=fixture();
  const plan=v2(db,user,'seatingPlan.save',{projectId:project.id,data:{name:'Зал',widthM:10,heightM:6,guestTableId:table.id}});
  const seat=v2(db,user,'seatingTable.create',{projectId:project.id,planId:plan.id,planVersion:plan.version,data:{label:'У окна',shape:'rect',xM:1,yM:1,widthM:2,heightM:1,capacity:2}});
  const seated=v2(db,user,'seating.assign',{projectId:project.id,guestTableId:table.id,schemaVersion:table.version,guestRowId:row.id,rowVersion:row.version,tableId:seat.id,tableVersion:seat.version,seatIndex:1,confirmNonConfirmed:true});
  failure(()=>v2(db,user,'seatingTable.edit',{projectId:project.id,entityId:seat.id,version:seat.version,guestTableId:table.id,data:{...seat.data,capacity:0}}),400);
  const declined=v2(db,user,'guest.rsvp.set',{projectId:project.id,guestTableId:table.id,schemaVersion:table.version,guestRowId:row.id,rowVersion:seated.version,data:{values:{rsvp:'declined'}}});
  assert.equal(declined.data.status,'Отказ'); assert.equal(declined.data.seat_table,'');
});

test('legacy text-table preview preserves source values before explicit import',async()=>{
  const {db,user,project,table,row}=fixture();
  const legacy=v1(db,user,'entity.edit',{projectId:project.id,entityId:table.id,version:table.version,data:{...table.data,columns:[...table.data.columns,{id:'old_table',name:'Старый стол',type:'text'}]}});
  const changed=v1(db,user,'entity.edit',{projectId:project.id,entityId:row.id,version:row.version,schemaVersion:legacy.version,data:{...row.data,old_table:'Семья'}});
  const {legacySeatingPreview}=await import('../server/v2/guest/index.mjs');
  const preview=legacySeatingPreview(db,user,project.id,legacy.id,'old_table');
  assert.deepEqual(preview.groups.map(group=>group.sourceValue),['Семья']);
  assert.deepEqual(preview.groups[0].originalValues,[{rowId:changed.id,version:changed.version,value:'Семья'}]);
});

test('field-scoped guest reads omit private row data and RSVP/seat aggregates',()=>{
  const {db,user,project,table,row}=fixture();
  const viewer=register(db,{slug:'guest-test',email:'viewer@example.test',name:'Только имя',password:'strong-pass-2'}).user;
  const role=v1(db,user,'role.save',{name:'Ограниченный просмотр',permissions:['read']});
  const current=db.prepare('SELECT version FROM users WHERE id=?').get(viewer.id);
  v1(db,user,'grants.save',{userId:viewer.id,version:current.version,disabled:false,grants:[{roleId:role.id,projectId:project.id,restrictions:{sections:[table.id,'seating'],rows:[row.id],fields:['name']}}]});
  const listed=guestList(db,viewer,project.id,table.id);
  assert.deepEqual(listed.items[0].data,{name:'Ира'}); assert.equal(listed.items[0].rsvp,undefined); assert.equal(listed.items[0].tableId,undefined);
  const plan=v2(db,user,'seatingPlan.save',{projectId:project.id,data:{name:'Зал',widthM:8,heightM:6,guestTableId:table.id}});
  const snapshot=seatingSnapshot(db,viewer,project.id,plan.id);
  assert.equal(snapshot.guestNamesVisible,false); assert.deepEqual(snapshot.unseated,[]);
});

test('published revision and default invite expiry are validated, and the command redaction hook strips raw tokens',()=>{
  const {db,user,project,table,row}=fixture();
  const unpublished=insert(db,user,'microsite',{shareId:'q'.repeat(24),status:'published',publishedRevisionId:'missing-revision',rsvpDeadline:'2099-08-10',closesAt:null},project.id);
  failure(()=>v2(db,user,'guestInvite.create',{projectId:project.id,guestTableId:table.id,schemaVersion:table.version,guestRowIds:[row.id]}),404);
  db.prepare('UPDATE entities SET deleted=1 WHERE id=?').run(unpublished.id);
  publishedSite(db,user,project,{shareId:'w'.repeat(24)});
  const invitation=v2(db,user,'guestInvite.create',{projectId:project.id,guestTableId:table.id,schemaVersion:table.version,guestRowIds:[row.id]});
  assert.equal(invitation.expiresAt,'2027-08-21T20:59:59.999Z');
  const safe=redactGuestCommandResult('guestInvite.create',invitation);
  assert.equal(safe.token,undefined); assert.equal(safe.inviteId,invitation.inviteId);
});

test('legacy import requires every visible row version and an explicit confirmation for non-confirmed guests',async()=>{
  const {db,user,project,table,row}=fixture();
  const legacy=v1(db,user,'entity.edit',{projectId:project.id,entityId:table.id,version:table.version,data:{...table.data,columns:[...table.data.columns,{id:'old_table',name:'Старый стол',type:'text'}]}});
  const changed=v1(db,user,'entity.edit',{projectId:project.id,entityId:row.id,version:row.version,schemaVersion:legacy.version,data:{...row.data,old_table:'Семья'}});
  const plan=v2(db,user,'seatingPlan.save',{projectId:project.id,data:{name:'Зал',widthM:8,heightM:6,guestTableId:legacy.id}});
  const command={projectId:project.id,guestTableId:legacy.id,schemaVersion:legacy.version,planId:plan.id,planVersion:plan.version,columnId:'old_table',tables:[{sourceValue:'Семья',capacity:2,xM:1,yM:1}]};
  failure(()=>v2(db,user,'seating.legacyImport',command),409);
  failure(()=>v2(db,user,'seating.legacyImport',{...command,rowVersions:[{id:changed.id,version:changed.version}]}),409);
  const imported=v2(db,user,'seating.legacyImport',{...command,rowVersions:[{id:changed.id,version:changed.version}],confirmNonConfirmed:true});
  assert.equal(entity(db,changed.id).data.seat_table.length>0,true); assert.equal(imported.data.legacyImport.originalValues[0].value,'Семья');
});

test('invite authorization checks every mapped public field before idempotent replay and revoke',()=>{
  const {db,user,project,table,row}=fixture(); publishedSite(db,user,project,{shareId:'e'.repeat(24)});
  const viewer=register(db,{slug:'guest-test',email:'scoped@example.test',name:'Ограниченный',password:'strong-pass-3'}).user;
  const role=v1(db,user,'role.save',{name:'Ограниченный приглашатель',permissions:['read','manageGuestInvites']});
  const grant=(fields)=>{const current=db.prepare('SELECT version FROM users WHERE id=?').get(viewer.id);return v1(db,user,'grants.save',{userId:viewer.id,version:current.version,disabled:false,grants:[{roleId:role.id,projectId:project.id,restrictions:{sections:[table.id],rows:[row.id],fields}}]});};
  grant(['name','status','meal','contact']);
  const command={id:'invite_scope_replay',op:'guestInvite.create',projectId:project.id,guestTableId:table.id,schemaVersion:table.version,guestRowIds:[row.id],expiresAt:new Date(Date.now()+86400000).toISOString()};
  const invitation=executeGuest(db,viewer,command); assert.equal(typeof invitation.token,'string');
  grant(['name','status','meal']);
  failure(()=>executeGuest(db,viewer,command),403);
  failure(()=>v2(db,viewer,'guestInvite.revoke',{projectId:project.id,inviteId:invitation.inviteId,version:invitation.version}),403);
  assert.deepEqual(guestInvites(db,viewer,project.id,table.id),[]);
});

test('guest.row.edit validates ordinary cells and applies RSVP and seating in one atomic command',()=>{
  const {db,user,project,table,row}=fixture();
  const plan=v2(db,user,'seatingPlan.save',{projectId:project.id,data:{name:'Зал',widthM:8,heightM:6,guestTableId:table.id}});
  const seat=v2(db,user,'seatingTable.create',{projectId:project.id,planId:plan.id,planVersion:plan.version,data:{label:'Терраса',shape:'round',xM:1,yM:1,widthM:1.6,heightM:1.6,capacity:2}});
  const edited=v2(db,user,'guest.row.edit',{projectId:project.id,guestTableId:table.id,guestRowId:row.id,rowVersion:row.version,schemaVersion:table.version,data:{name:'Ирина'}});
  assert.equal(edited.data.name,'Ирина');
  const assign={projectId:project.id,guestTableId:table.id,guestRowId:row.id,rowVersion:edited.version,schemaVersion:table.version,data:{seat_table:seat.id,seat_index:1}};
  failure(()=>v2(db,user,'guest.row.edit',assign),409);
  failure(()=>v2(db,user,'guest.row.edit',{...assign,tableVersion:seat.version}),409);
  failure(()=>v2(db,user,'guest.row.edit',{...assign,tableVersion:seat.version,confirmNonConfirmed:true,data:{name:'Не сохранить',seat_table:seat.id,seat_index:99}}),400);
  assert.equal(entity(db,row.id).data.name,'Ирина');
  const seated=v2(db,user,'guest.row.edit',{...assign,tableVersion:seat.version,confirmNonConfirmed:true});
  assert.equal(seated.data.seat_table,seat.id); assert.equal(seated.data.seat_index,1);
  const declined=v2(db,user,'guest.row.edit',{projectId:project.id,guestTableId:table.id,guestRowId:row.id,rowVersion:seated.version,schemaVersion:table.version,data:{status:'declined'}});
  assert.equal(declined.data.status,'Отказ'); assert.equal(declined.data.seat_table,null); assert.equal(declined.data.seat_index,null);
});

test('full mapping disable revokes guest access but preserves old cells for later column removal',()=>{
  const {db,user,project,table,row}=fixture(); publishedSite(db,user,project);
  const invitation=v2(db,user,'guestInvite.create',{projectId:project.id,guestTableId:table.id,schemaVersion:table.version,guestRowIds:[row.id],expiresAt:new Date(Date.now()+86400000).toISOString()});
  const session=exchange(db,{shareId:'z'.repeat(24),token:invitation.token}), before=entity(db,row.id).data;
  const disabled=v2(db,user,'guestMapping.save',{projectId:project.id,guestTableId:table.id,schemaVersion:table.version,data:{semanticMap:{disable:true}},confirm:true});
  assert.deepEqual(disabled.data.semanticMap,{}); assert.deepEqual(entity(db,row.id).data,before);
  failure(()=>context(db,{shareId:'z'.repeat(24),sessionToken:session.sessionToken,csrfToken:session.csrfToken}),403);
  failure(()=>exchange(db,{shareId:'z'.repeat(24),token:invitation.token}),404);
  const removed=v1(db,user,'entity.edit',{projectId:project.id,entityId:disabled.id,version:disabled.version,data:{...disabled.data,confirmStructure:true,columns:disabled.data.columns.filter(column=>!['name','status'].includes(column.id))}});
  assert.equal(removed.data.columns.some(column=>column.id==='name'),false); assert.equal(entity(db,row.id).data.name,'Ира');
});

test('public RSVP fields follow the active published revision switches',()=>{
  const {db,user,project,table,row}=fixture(); publishedSite(db,user,project,{displayFields:{mealEnabled:false,transportEnabled:false}});
  const invitation=v2(db,user,'guestInvite.create',{projectId:project.id,guestTableId:table.id,schemaVersion:table.version,guestRowIds:[row.id],expiresAt:new Date(Date.now()+86400000).toISOString()});
  const session=exchange(db,{shareId:'z'.repeat(24),token:invitation.token}), before=context(db,{shareId:'z'.repeat(24),sessionToken:session.sessionToken,csrfToken:session.csrfToken});
  assert.deepEqual(before.enabledFields,{meal:false,transport:false}); assert.equal(before.guests[0].diet,undefined); assert.equal(before.guests[0].transfer,undefined);
  failure(()=>respond(db,{shareId:'z'.repeat(24),sessionToken:session.sessionToken,csrfToken:session.csrfToken,commandId:'hidden_meal_01',inviteVersion:before.inviteVersion,schemaVersion:before.schemaVersion,changes:[{rowId:row.id,rowVersion:row.version,values:{diet:'Без мяса'}}]}),404);
});

test('guest mapping rejects incompatible columns and invalid RSVP choices before writes',()=>{
 const {db,user,project,table}=fixture();const base={projectId:project.id,guestTableId:table.id,schemaVersion:table.version,confirm:true};
 failure(()=>v2(db,user,'guestMapping.save',{...base,data:{semanticMap:{diet:'seat_index'}}}));
 failure(()=>v2(db,user,'guestMapping.save',{...base,data:{semanticMap:{diet:'contact'}}}));
 failure(()=>v2(db,user,'guestMapping.save',{...base,data:{semanticMap:{rsvpValues:{confirmed:'Несуществующий вариант'}}}}));
 assert.equal(entity(db,table.id).version,table.version);
});

test('seating geometry validates rotated bounds and safe zone numeric values',()=>{
 const {db,user,project,table}=fixture();const plan=v2(db,user,'seatingPlan.save',{projectId:project.id,data:{name:'Зал',widthM:10,heightM:10,guestTableId:table.id,zones:[]}});
 failure(()=>v2(db,user,'seatingPlan.save',{projectId:project.id,entityId:plan.id,version:plan.version,data:{...plan.data,zones:[{label:'Зона',xM:'\" onload=alert(1)',yM:0,widthM:1,heightM:1}]}}));
 failure(()=>v2(db,user,'seatingTable.create',{projectId:project.id,planId:plan.id,planVersion:plan.version,data:{label:'Выход за край',shape:'rect',xM:0,yM:0,widthM:3,heightM:1,rotationDeg:45,capacity:4}}),409);
 const accepted=v2(db,user,'seatingPlan.save',{projectId:project.id,entityId:plan.id,version:plan.version,data:{...plan.data,zones:[{label:'Танцпол',xM:3,yM:3,widthM:2,heightM:2,rotationDeg:45}]}});assert.equal(accepted.data.zones[0].rotationDeg,45);
 const altered={...table,data:{...table.data,columns:table.data.columns.map(c=>c.id==='status'?{...c,options:['Подтвердил']}:c)}};assert.equal(validateGuestSchemaMutation(table,altered).ok,false);
});
