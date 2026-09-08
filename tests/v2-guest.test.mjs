import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, entity, insert } from '../server/db.mjs';
import { bootstrap, execute } from '../server/service.mjs';
import { entities } from '../server/db.mjs';
import { configureGuestHooks, context, exchange, execute as executeGuest, migrate, respond, seatingSnapshot, validateGuestRowMutation, validateGuestSchemaMutation } from '../server/v2/guest/index.mjs';

let n=0;
const id=()=>`guestcmd_${++n}`;
const v1=(db,u,op,body={})=>execute(db,u,{id:id(),op,...body});
const v2=(db,u,op,body={})=>executeGuest(db,u,{id:id(),op,...body});
const failure=(fn,status=400)=>assert.throws(fn,error=>error?.status===status);

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
  const seated=v2(db,user,'seating.assign',{projectId:project.id,guestTableId:table.id,guestRowId:row.id,rowVersion:row.version,tableId:seat.id,seatIndex:1});
  insert(db,user,'microsite',{shareId:'z'.repeat(24),status:'published',publishedRevisionId:'revision',rsvpDeadline:'2099-08-10',closesAt:null},project.id);
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
  assert.equal(db.prepare("SELECT count(*) AS n FROM audit WHERE actor_id=? AND action LIKE 'guest_%'").get(invitation.inviteId).n,2);
  assert.equal(seatingSnapshot(db,user,project.id,plan.id).unseated.length,0);
  configureGuestHooks({});
});

test('seating prevents double booking and refuses a table delete until its assignments are confirmed',()=>{
  const {db,user,project,table,row}=fixture();
  const second=v1(db,user,'entity.create',{projectId:project.id,kind:'row',parentId:table.id,schemaVersion:table.version,data:{name:'Макс',status:'Приглашён',meal:'',contact:'',seat_table:'',seat_index:''}});
  const plan=v2(db,user,'seatingPlan.save',{projectId:project.id,data:{name:'Зал',widthM:10,heightM:6,guestTableId:table.id}});
  const seat=v2(db,user,'seatingTable.create',{projectId:project.id,planId:plan.id,planVersion:plan.version,data:{label:'Семья',shape:'rect',xM:1,yM:1,widthM:2,heightM:1,capacity:2}});
  const first=v2(db,user,'seating.assign',{projectId:project.id,guestTableId:table.id,guestRowId:row.id,rowVersion:row.version,tableId:seat.id,seatIndex:1});
  failure(()=>v2(db,user,'seating.assign',{projectId:project.id,guestTableId:table.id,guestRowId:second.id,rowVersion:second.version,tableId:seat.id,seatIndex:1}),409);
  failure(()=>v2(db,user,'seatingTable.delete',{projectId:project.id,entityId:seat.id,version:seat.version,guestTableId:table.id}),409);
  const deleted=v2(db,user,'seatingTable.delete',{projectId:project.id,entityId:seat.id,version:seat.version,guestTableId:table.id,confirmUnassign:true,rows:[{id:row.id,version:first.version}]});
  assert.equal(deleted.deleted,true); assert.equal(entity(db,row.id).data.seat_table,'');
});
