import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, entity, entities, uid } from '../server/db.mjs';
import { defaults, grant, passwordHash, createSession, userSession } from '../server/auth.mjs';
import { bootstrap, register, snapshot, execute, upload, download } from '../server/service.mjs';
import { validateColumns } from '../server/model.mjs';
import { compute } from '../src/shared.js';

let commandNumber=0;
const command=(db,user,op,body={})=>execute(db,user,{id:`command_${++commandNumber}`,op,...body});
const fails=(fn,status=400)=>assert.throws(fn,error=>error?.status===status);

function fixture() {
  const db=openDatabase(':memory:');
  const setup=bootstrap(db,{slug:'tie',agencyName:'Тестовое агентство',email:'owner@example.test',name:'Владелец',password:'strong-pass-1'});
  return {db,admin:setup.user};
}

function project(db,admin,name='Анна и Илья') {
  return command(db,admin,'project.create',{data:{name,date:'2027-06-12',location:'Москва',limit:5000000}});
}

function registered(db,email,name='Участник') {
  return register(db,{slug:'tie',email,name,password:'strong-pass-2'}).user;
}

test('new weddings start with the shared normal-priority task plan',()=>{
  const {db,admin}=fixture(),wedding=project(db,admin),tasks=entities(db,admin.agency_id,wedding.id,'task'),invites=tasks.find(row=>row.data.sourceTemplateKey==='invites');
  const guests=rowTable(db,admin,wedding.id,'guests'),vendorCategories=entities(db,admin.agency_id,null,'vendorCategory');
  assert.equal(wedding.data.location,'');
  assert.deepEqual(guests.data.columns.slice(0,8).map(column=>column.name),['ФИО','Фото','Чей гость','Кем приходится','Пищевые аллергии','Алкоголь','Контакт','Приглашение']);
  assert.equal(guests.data.semanticMap.allergies,'allergies');assert(vendorCategories.some(category=>category.data.name==='Фотограф'));assert(vendorCategories.some(category=>category.data.name==='Видеограф'));
  assert.equal(tasks.length,25);assert(tasks.every(row=>row.data.priority==='normal'));assert(invites);assert.equal(invites.data.title,'Поиск пригласительных');assert.equal(invites.data.offsetDays,-180);assert.equal(invites.data.dueDate,'2026-12-14');
  for(const title of ['Поиск площадки','Поиск ведущего','Поиск фотографа','Поиск видеографа','Поиск свадебного торта','Подобрать техническое оборудование','Поиск декоратора','Поиск стилиста','Подготовить раздаточные материалы','Подготовить welcome-зону']) assert(tasks.some(row=>row.data.title===title),title);
});

test('the couple never receives or changes the organizer budget limit',()=>{
  const {db,admin}=fixture(),p=project(db,admin),couple=registered(db,'hidden-limit@example.test','Пара');
  const coupleRole=db.prepare("SELECT id FROM roles WHERE agency_id=? AND key='couple'").get(admin.agency_id);assign(db,admin,couple,[{roleId:coupleRole.id,projectId:p.id,restrictions:{}}]);
  const organizerState=snapshot(db,admin,p.id),coupleState=snapshot(db,couple,p.id);
  assert.equal(organizerState.project.data.limit,5000000);assert.equal(organizerState.canViewBudgetLimit,true);assert.equal(organizerState.canManageWeddingDetails,true);
  assert.equal(Object.hasOwn(coupleState.project.data,'limit'),false);assert.equal(coupleState.canViewBudgetLimit,false);assert.equal(coupleState.canManageWeddingDetails,false);
  fails(()=>command(db,couple,'entity.edit',{projectId:p.id,entityId:p.id,version:p.version,data:{limit:100}}),403);
  const edited=command(db,couple,'entity.edit',{projectId:p.id,entityId:p.id,version:p.version,data:{notes:'Заметка пары'}});
  assert.equal(Object.hasOwn(edited.data,'limit'),false);assert.equal(Object.hasOwn(snapshot(db,couple,p.id),'history'),false);
});

function role(db,admin,name,permissions) {
  const saved=command(db,admin,'role.save',{name,permissions});
  return db.prepare('SELECT * FROM roles WHERE id=?').get(saved.id);
}

function assign(db,admin,user,items,disabled=false) {
  command(db,admin,'grants.save',{userId:user.id,version:db.prepare('SELECT version FROM users WHERE id=?').get(user.id).version,disabled,grants:items});
}

function rowTable(db,admin,projectId,key='timing') {
  return entities(db,admin.agency_id,projectId,'table').find(table=>table.data.key===key);
}

function addRow(db,user,projectId,table,data) {
  return command(db,user,'entity.create',{projectId,kind:'row',parentId:table.id,schemaVersion:table.version,data});
}

test('registration stays private until one idempotent approval and invitations join two distinct accounts',()=>{
  const {db,admin}=fixture();
  const first=registered(db,'first@example.test','Анна');
  assert.deepEqual(snapshot(db,first).projects,[]);
  const application=command(db,first,'application.create',{data:{name:'Анна и Илья',date:'2027-06-12',contact:'@anna',message:'Хотим обсудить свадьбу'}});
  assert.deepEqual(snapshot(db,first).projects,[]);

  const approved=command(db,admin,'application.review',{entityId:application.id,version:application.version,status:'approved',reason:''});
  const repeated=command(db,admin,'application.review',{entityId:application.id,version:application.version,status:'approved',reason:''});
  assert.equal(repeated.data.projectId,approved.data.projectId);
  assert.equal(entities(db,admin.agency_id,null,'project').length,1);
  assert.equal(snapshot(db,first).projects[0].id,approved.data.projectId);

  const organizer=registered(db,'organizer@example.test','Организатор');
  const organizerRole=db.prepare("SELECT id FROM roles WHERE agency_id=? AND name='Организатор'").get(admin.agency_id);
  assign(db,admin,organizer,[{roleId:organizerRole.id,projectId:null,restrictions:{}}]);
  assert.deepEqual(snapshot(db,organizer,approved.data.projectId).inviteRoles.map(item=>item.name),['Участник пары']);
  const invitation=command(db,organizer,'invite.create',{projectId:approved.data.projectId,email:'second@example.test'});
  const second=register(db,{slug:'tie',email:'second@example.test',name:'Илья',password:'strong-pass-3',invitation:invitation.token}).user;
  assert.equal(snapshot(db,second).projects[0].id,approved.data.projectId);
  command(db,second,'invite.accept',{token:invitation.token});
  assert.equal(db.prepare('SELECT count(*) AS n FROM grants WHERE user_id=? AND project_id=?').get(second.id,approved.data.projectId).n,1);
  assert.equal(snapshot(db,second,approved.data.projectId).custodians.some(person=>person.id===second.id),false);
  const stranger=registered(db,'stranger@example.test');
  fails(()=>command(db,stranger,'invite.accept',{token:invitation.token}),403);
});

test('tenant, project, row and field scopes do not combine across grants or leak hidden schema',()=>{
  const {db,admin}=fixture();
  const p=project(db,admin);
  const table=rowTable(db,admin,p.id);
  const editedTable=command(db,admin,'entity.edit',{projectId:p.id,entityId:table.id,version:table.version,data:{columns:[
    ...table.data.columns,
    {id:'secret',name:'Секрет',type:'number'},
    {id:'calc',name:'Расчёт',type:'formula',formula:'{secret}+1'}
  ]}});
  const first=addRow(db,admin,p.id,editedTable,{title:'Первое',secret:10});
  const second=addRow(db,admin,p.id,editedTable,{title:'Второе',secret:20});
  const scoped=registered(db,'scoped@example.test','Подрядчик');
  const editor=role(db,admin,'Ограниченный редактор',['read','create','edit']);
  const reader=role(db,admin,'Просмотр формулы',['read']);
  const sourceReader=role(db,admin,'Просмотр источника',['read']);
  assign(db,admin,scoped,[
    {roleId:editor.id,projectId:p.id,restrictions:{sections:[editedTable.id],rows:[first.id],fields:['title']}},
    {roleId:reader.id,projectId:p.id,restrictions:{sections:[editedTable.id],rows:[second.id],fields:['calc']}},
    {roleId:sourceReader.id,projectId:p.id,restrictions:{sections:[editedTable.id],rows:[second.id],fields:['secret']}}
  ]);

  const state=snapshot(db,scoped,p.id);
  assert.equal(state.project.data.notes,undefined);
  assert.equal(state.project.data.limit,undefined);
  const visibleTable=state.entities.find(item=>item.id===editedTable.id);
  assert.deepEqual(visibleTable.data.columns.map(column=>column.id),['title','secret']);
  assert.deepEqual(state.entities.find(item=>item.id===first.id).data,{title:'Первое'});
  assert.deepEqual(state.entities.find(item=>item.id===second.id).data,{secret:20});
  fails(()=>command(db,scoped,'entity.edit',{projectId:p.id,entityId:second.id,version:second.version,schemaVersion:editedTable.version,data:{secret:21}}),403);
  fails(()=>command(db,scoped,'entity.edit',{projectId:p.id,entityId:first.id,version:first.version,schemaVersion:editedTable.version,data:{secret:11}}),403);
  fails(()=>addRow(db,scoped,p.id,editedTable,{title:'Новая'}),403);

  const other=project(db,admin,'Другая свадьба');
  fails(()=>snapshot(db,scoped,other.id),403);
  const agency2=uid(),owner2=uid();
  db.prepare("INSERT INTO agencies(id,slug,name,settings) VALUES(?,?,?, '{}')").run(agency2,'other','Другое агентство');
  db.prepare('INSERT INTO users(id,agency_id,email,name,password,protected) VALUES(?,?,?,?,?,1)').run(owner2,agency2,'other@example.test','Другой владелец',passwordHash('strong-pass-4'));
  const roles2=defaults(db,agency2); grant(db,{id:owner2,agency_id:agency2},roles2[0].id);
  fails(()=>snapshot(db,{id:owner2,agency_id:agency2},p.id),403);
});

test('schema conflicts, deleted parents, restoration and project edits remain consistent',()=>{
  const {db,admin}=fixture();
  const p=project(db,admin);
  const original=rowTable(db,admin,p.id);
  const table=command(db,admin,'entity.edit',{projectId:p.id,entityId:original.id,version:original.version,data:{columns:[...original.data.columns,{id:'note',name:'Заметка',type:'text'}]}});
  const row=addRow(db,admin,p.id,table,{title:'Церемония',note:'Первая версия'});
  fails(()=>command(db,admin,'entity.edit',{projectId:p.id,entityId:table.id,version:table.version,data:{columns:table.data.columns.filter(column=>column.id!=='note')}}),409);
  const changed=command(db,admin,'entity.edit',{projectId:p.id,entityId:table.id,version:table.version,data:{columns:table.data.columns.filter(column=>column.id!=='note'),confirmStructure:true}});
  fails(()=>command(db,admin,'entity.edit',{projectId:p.id,entityId:row.id,version:row.version,schemaVersion:table.version,data:{title:'Позже'}}),409);
  const revised=command(db,admin,'entity.edit',{projectId:p.id,entityId:row.id,version:row.version,schemaVersion:changed.version,data:{title:'Позже'}});
  const removedRow=command(db,admin,'entity.delete',{projectId:p.id,entityId:revised.id,version:revised.version,schemaVersion:changed.version});
  command(db,admin,'entity.restore',{projectId:p.id,entityId:removedRow.id,version:removedRow.version,schemaVersion:changed.version});

  fails(()=>command(db,admin,'entity.delete',{projectId:p.id,entityId:changed.id,version:changed.version}),409);
  const removedTable=command(db,admin,'entity.delete',{projectId:p.id,entityId:changed.id,version:changed.version,confirm:true});
  assert.equal(snapshot(db,admin,p.id).entities.some(item=>item.id===revised.id),false);
  const restoredTable=command(db,admin,'entity.restore',{projectId:p.id,entityId:removedTable.id,version:removedTable.version});
  assert(snapshot(db,admin,p.id).entities.some(item=>item.id===revised.id));
  const editedProject=command(db,admin,'entity.edit',{projectId:p.id,entityId:p.id,version:p.version,data:{notes:'Обновлено'}});
  assert.equal(editedProject.data.notes,'Обновлено');

  const foreignSection=entities(db,admin.agency_id,project(db,admin,'Чужой раздел').id,'section')[0];
  fails(()=>command(db,admin,'entity.create',{projectId:p.id,kind:'table',data:{name:'Ошибка',key:'bad',sectionId:foreignSection.id,columns:[]}}),404);
  assert.equal(restoredTable.deleted,false);
});

test('finance separates unknown, included and zero prices, custody and agency money, idempotency and conflicts',()=>{
  const {db,admin}=fixture();
  const p=project(db,admin);
  const obligation=(title,priceKind,agreed,fee=false)=>command(db,admin,'entity.create',{projectId:p.id,kind:'obligation',data:{title,priceKind,agreed,planned:null,dueDate:'2027-06-01',fee}});
  const unknown=obligation('Цена уточняется','unknown',null);
  obligation('Включено в пакет','included',null);
  obligation('Бесплатно','amount',0);
  let payable=obligation('Фотограф','amount',100000);
  let fee=obligation('Гонорар','amount',20000,true);
  command(db,admin,'movement.save',{projectId:p.id,data:{type:'deposit',amount:150000,date:'2027-05-01',description:'Получено',source:'custody',to:admin.id}});
  const paymentBody={projectId:p.id,obligationVersion:payable.version,data:{type:'payment',amount:40000,date:'2027-05-10',description:'Аванс',source:'custody',from:admin.id,obligationId:payable.id}};
  const payment=command(db,admin,'movement.save',paymentBody);
  const replayId=`command_${++commandNumber}`;
  const replay=execute(db,admin,{id:replayId,op:'movement.save',...{projectId:p.id,obligationVersion:entity(db,payable.id).version,data:{type:'payment',amount:10000,date:'2027-05-11',description:'Доплата',source:'custody',from:admin.id,obligationId:payable.id}}});
  assert.deepEqual(execute(db,admin,{id:replayId,op:'movement.save',projectId:p.id,obligationVersion:entity(db,payable.id).version-1,data:{type:'payment',amount:10000,date:'2027-05-11',description:'Доплата',source:'custody',from:admin.id,obligationId:payable.id}}),replay);
  assert.equal(entities(db,admin.agency_id,p.id,'movement').filter(item=>item.data.obligationId===payable.id).length,2);

  const staleVersion=entity(db,payable.id).version;
  command(db,admin,'movement.save',{projectId:p.id,obligationVersion:staleVersion,data:{type:'payment',amount:5000,date:'2027-05-12',description:'Частично',source:'direct',obligationId:payable.id}});
  fails(()=>command(db,admin,'movement.save',{projectId:p.id,obligationVersion:staleVersion,data:{type:'payment',amount:5000,date:'2027-05-12',description:'Другое устройство',source:'direct',obligationId:payable.id}}),409);
  command(db,admin,'movement.save',{projectId:p.id,obligationVersion:fee.version,data:{type:'fee',amount:20000,date:'2027-05-15',description:'Гонорар',source:'direct',obligationId:fee.id}});

  const corrected=command(db,admin,'movement.save',{projectId:p.id,entityId:payment.id,version:payment.version,obligationVersion:entity(db,payable.id).version,data:{...payment.data,amount:30000}});
  assert.equal(corrected.data.amount,30000);
  const finances=snapshot(db,admin,p.id).financials;
  assert.equal(finances.unknown,1);
  assert.equal(finances.agreed,120000);
  assert.equal(finances.paid[payable.id],45000);
  assert.equal(finances.custody,110000);
  assert.equal(finances.own,20000);
  assert.equal(snapshot(db,admin).financials.own,20000);
  assert.equal(unknown.data.agreed,null);
});

test('row-limited finance allows its obligation payment but denies aggregate and unscoped money movements',()=>{
  const {db,admin}=fixture();
  const p=project(db,admin);
  const ob=command(db,admin,'entity.create',{projectId:p.id,kind:'obligation',data:{title:'Музыка',priceKind:'amount',agreed:50000,planned:null,dueDate:'',fee:false}});
  const user=registered(db,'finance@example.test');
  const view=role(db,admin,'Просмотр проекта',['read']);
  const finance=role(db,admin,'Одна выплата',['read','create','finance']);
  const movementFields=['type','amount','date','description','source','from','obligationId'];
  assign(db,admin,user,[
    {roleId:view.id,projectId:p.id,restrictions:{}},
    {roleId:finance.id,projectId:p.id,restrictions:{sections:['budget'],rows:[ob.id],fields:movementFields}}
  ]);
  command(db,user,'movement.save',{projectId:p.id,obligationVersion:ob.version,data:{type:'payment',amount:10000,date:'2027-01-01',description:'Напрямую',source:'direct',obligationId:ob.id}});
  fails(()=>command(db,user,'movement.save',{projectId:p.id,data:{type:'deposit',amount:10000,date:'2027-01-01',description:'Чужие средства',source:'custody',to:admin.id}}),403);
  const state=snapshot(db,user,p.id);
  assert.equal(state.financials,undefined);
  assert(state.members.some(member=>member.id===admin.id));
  assert(state.members.every(member=>member.email===undefined));
});

test('offline selections are explicit, templates clone independently, files stay scoped and sessions revoke immediately',()=>{
  const {db,admin}=fixture();
  const template=entities(db,admin.agency_id,null,'template')[0];
  const custom=command(db,admin,'entity.edit',{entityId:template.id,version:template.version,data:{offline:['timing','payouts','budget','vendors','files']}});
  const first=command(db,admin,'project.create',{templateId:custom.id,data:{name:'Первая',date:'2027-08-01'}});
  const second=command(db,admin,'project.create',{templateId:custom.id,data:{name:'Вторая',date:'2027-09-01'}});
  assert.deepEqual(first.data.offline,['payouts','budget','vendors','files']);
  const firstTable=rowTable(db,admin,first.id),secondTable=rowTable(db,admin,second.id);
  const firstEdited=command(db,admin,'entity.edit',{projectId:first.id,entityId:firstTable.id,version:firstTable.version,data:{name:'Тайминг первой'}});
  assert.notEqual(entity(db,secondTable.id).data.name,firstEdited.data.name);
  assert.notEqual(entity(db,template.id).data.tables.find(item=>item.key==='timing').name,firstEdited.data.name);
  const timingRow=addRow(db,admin,first.id,firstEdited,{time:'12:00',title:'Сбор гостей'});
  const selection=command(db,admin,'entity.create',{projectId:first.id,kind:'selection',data:{title:'Ведущий',price:70000,selected:true,terms:'Ведёт вечер',dueDate:'2027-07-01'}});
  const file=upload(db,admin,first.id,{name:'план.txt',mime:'text/plain',documentStatus:'pending_signature',content:Buffer.from('plan').toString('base64')});
  assert.equal(file.data.documentStatus,'pending_signature');
  const offline=snapshot(db,admin,first.id,true);
  for(const id of [firstEdited.id,timingRow.id,selection.id,file.id]) assert(offline.entities.some(item=>item.id===id));
  assert.equal(Object.hasOwn(offline.entities.find(item=>item.id===file.id).data,'content'),false);
  fails(()=>download(db,admin,uid()),404);

  const user=registered(db,'revoked@example.test');
  const couple=db.prepare("SELECT id FROM roles WHERE agency_id=? AND name='Участник пары'").get(admin.agency_id);
  assign(db,admin,user,[{roleId:couple.id,projectId:first.id,restrictions:{}}]);
  const session=createSession(db,db.prepare('SELECT * FROM users WHERE id=?').get(user.id));
  assert(userSession(db,session));
  assign(db,admin,user,[],true);
  assert.equal(userSession(db,session),null);
  fails(()=>snapshot(db,user,first.id),403);
});

test('formula language evaluates arithmetic only',()=>{
  assert.equal(compute('({amount}+10)*2',{amount:15}),50);
  assert.equal(compute('{missing}+1',{}),null);
  assert.throws(()=>compute('globalThis.process.exit()',{}));
  assert.throws(()=>validateColumns([{id:'constructor',name:'Опасная',type:'number'}]));
});

test('one assignment must cover every edited field while schema deletion stays reversible',()=>{
  const {db,admin}=fixture();
  const p=project(db,admin),original=rowTable(db,admin,p.id);
  const table=command(db,admin,'entity.edit',{projectId:p.id,entityId:original.id,version:original.version,data:{columns:[...original.data.columns,{id:'private',name:'Внутреннее',type:'text'}]}});
  let row=addRow(db,admin,p.id,table,{title:'Церемония',private:'Сохранить при восстановлении'});
  const scoped=registered(db,'split-fields@example.test');
  const titleEditor=role(db,admin,'Название строки',['read','edit']);
  const privateEditor=role(db,admin,'Внутреннее поле',['read','edit']);
  const fieldDeleter=role(db,admin,'Удаление поля',['read','delete']);
  assign(db,admin,scoped,[
    {roleId:titleEditor.id,projectId:p.id,restrictions:{sections:[table.id],rows:[row.id],fields:['title']}},
    {roleId:privateEditor.id,projectId:p.id,restrictions:{sections:[table.id],rows:[row.id],fields:['private']}},
    {roleId:fieldDeleter.id,projectId:p.id,restrictions:{sections:[table.id],rows:[row.id],fields:['title']}}
  ]);
  fails(()=>command(db,scoped,'entity.edit',{projectId:p.id,entityId:row.id,version:row.version,schemaVersion:table.version,data:{title:'Ужин',private:'Другое'}}),403);
  row=command(db,scoped,'entity.edit',{projectId:p.id,entityId:row.id,version:row.version,schemaVersion:table.version,data:{title:'Ужин'}});
  fails(()=>command(db,scoped,'entity.delete',{projectId:p.id,entityId:row.id,version:row.version,schemaVersion:table.version}),403);

  const splitCreator=registered(db,'split-create@example.test');
  const titleCreator=role(db,admin,'Создание названия',['read','create']);
  const privateCreator=role(db,admin,'Создание внутреннего',['read','create']);
  assign(db,admin,splitCreator,[
    {roleId:titleCreator.id,projectId:p.id,restrictions:{sections:[table.id],fields:['title']}},
    {roleId:privateCreator.id,projectId:p.id,restrictions:{sections:[table.id],fields:['private']}}
  ]);
  fails(()=>addRow(db,splitCreator,p.id,table,{title:'Новая',private:'Скрытая'}),403);

  const withoutPrivate=command(db,admin,'entity.edit',{projectId:p.id,entityId:table.id,version:table.version,data:{columns:table.data.columns.filter(column=>column.id!=='private'),rowOrder:[row.id],confirmStructure:true}});
  assert.deepEqual(snapshot(db,admin,p.id).entities.find(item=>item.id===row.id).data,{title:'Ужин'});
  const restoredSchema=command(db,admin,'entity.edit',{projectId:p.id,entityId:table.id,version:withoutPrivate.version,data:{columns:table.data.columns,rowOrder:[row.id]}});
  assert.equal(snapshot(db,admin,p.id).entities.find(item=>item.id===row.id).data.private,'Сохранить при восстановлении');
  fails(()=>command(db,admin,'entity.edit',{projectId:p.id,entityId:table.id,version:restoredSchema.version,data:{rowOrder:[uid()]}}),409);
});

test('applicants can answer clarification and pending invitations respect revocation',()=>{
  const {db,admin}=fixture();
  const applicant=registered(db,'clarify@example.test','Дарья');
  let application=command(db,applicant,'application.create',{data:{name:'Дарья и Лев',date:'2027-10-02',contact:'@daria',message:'Первая версия'}});
  application=command(db,admin,'application.review',{entityId:application.id,version:application.version,status:'clarification',reason:'Уточните площадку'});
  const stranger=registered(db,'cannot-respond@example.test');
  fails(()=>command(db,stranger,'application.respond',{entityId:application.id,version:application.version,data:{name:'Чужая правка',date:'2027-10-02',contact:'x@example.test',message:'Нет'}}),403);
  application=command(db,applicant,'application.respond',{entityId:application.id,version:application.version,data:{name:'Дарья и Лев',date:'2027-10-02',contact:'@daria',message:'Площадка — веранда'}});
  assert.equal(application.data.status,'review'); assert.equal(application.data.reason,'');

  const organizer=registered(db,'inviter@example.test','Организатор');
  const organizerRole=db.prepare("SELECT id FROM roles WHERE agency_id=? AND name='Организатор'").get(admin.agency_id);
  assign(db,admin,organizer,[{roleId:organizerRole.id,projectId:null,restrictions:{}}]);
  const p=project(db,admin);
  const revoked=command(db,organizer,'invite.create',{projectId:p.id,email:'revoked-invite@example.test'});
  command(db,organizer,'invite.revoke',{invitationId:revoked.id});
  fails(()=>register(db,{slug:'tie',email:'revoked-invite@example.test',name:'Получатель',password:'strong-pass-3',invitation:revoked.token}),403);
  const stale=command(db,organizer,'invite.create',{projectId:p.id,email:'stale-invite@example.test'});
  assign(db,admin,organizer,[]);
  fails(()=>register(db,{slug:'tie',email:'stale-invite@example.test',name:'Получатель',password:'strong-pass-3',invitation:stale.token}),403);
});

test('finance corrections, deletion and custodian options preserve exact balances',()=>{
  const {db,admin}=fixture();
  const p=project(db,admin);
  let obligation=command(db,admin,'entity.create',{projectId:p.id,kind:'obligation',data:{title:'Фотограф',priceKind:'amount',agreed:100000,planned:null,dueDate:'',fee:false}});
  command(db,admin,'movement.save',{projectId:p.id,data:{type:'deposit',amount:100000,date:'2027-01-01',description:'Средства пары',source:'custody',to:admin.id}});
  let payment=command(db,admin,'movement.save',{projectId:p.id,obligationVersion:obligation.version,data:{type:'payment',amount:40000,date:'2027-01-02',description:'Аванс',source:'custody',from:admin.id,obligationId:obligation.id}});
  payment=command(db,admin,'movement.save',{projectId:p.id,entityId:payment.id,version:payment.version,obligationVersion:entity(db,obligation.id).version,data:{...payment.data,amount:25000}});
  command(db,admin,'movement.delete',{projectId:p.id,entityId:payment.id,version:payment.version});
  const projectState=snapshot(db,admin,p.id);
  assert.equal(projectState.financials.totalPaid,0); assert.equal(projectState.financials.custody,100000);
  assert.deepEqual(projectState.custodians,[{id:admin.id,name:admin.name}]);
  const outsider=registered(db,'not-custodian@example.test');
  fails(()=>command(db,admin,'movement.save',{projectId:p.id,data:{type:'deposit',amount:100,date:'2027-01-03',description:'Неверный держатель',source:'custody',to:outsider.id}}));

  command(db,admin,'movement.save',{data:{type:'income',amount:12345,date:'2027-01-01',description:'Доход',source:'direct'}});
  command(db,admin,'movement.save',{data:{type:'expense',amount:2345,date:'2027-01-02',description:'Расход',source:'direct'}});
  const agencyFinance=snapshot(db,admin).financials;
  assert.equal(agencyFinance.income,12345); assert.equal(agencyFinance.expense,2345); assert.equal(agencyFinance.own,10000);
});

test('agency commission is organizer-only and rolls up into wedding cash cards',()=>{
  const {db,admin}=fixture(),p=project(db,admin);
  const selection=command(db,admin,'entity.create',{projectId:p.id,kind:'selection',data:{title:'Фотограф Иван',price:100000,agencyCommission:12000,selected:true,terms:'Полный день',dueDate:'2027-06-01'}});
  const honorarium=command(db,admin,'entity.create',{projectId:p.id,kind:'obligation',data:{title:'Гонорар агентства',priceKind:'amount',agreed:50000,planned:null,agencyCommission:null,dueDate:'2027-06-12',fee:true}});
  const organizerState=snapshot(db,admin,p.id),linked=organizerState.entities.find(row=>row.id===selection.data.obligationId);
  assert.equal(organizerState.canViewAgencyCommission,true);assert.equal(selection.data.agencyCommission,12000);assert.equal(linked.data.agencyCommission,12000);assert.equal(honorarium.data.fee,true);
  const couple=registered(db,'commission-couple@example.test','Пара'),coupleRole=db.prepare("SELECT id FROM roles WHERE agency_id=? AND key='couple'").get(admin.agency_id);assign(db,admin,couple,[{roleId:coupleRole.id,projectId:p.id,restrictions:{}}]);
  const coupleState=snapshot(db,couple,p.id),coupleSelection=coupleState.entities.find(row=>row.id===selection.id),coupleObligation=coupleState.entities.find(row=>row.id===selection.data.obligationId);
  assert.equal(coupleState.canViewAgencyCommission,false);assert.equal(Object.hasOwn(coupleSelection.data,'agencyCommission'),false);assert.equal(Object.hasOwn(coupleObligation.data,'agencyCommission'),false);
  fails(()=>command(db,couple,'entity.edit',{projectId:p.id,entityId:selection.id,version:selection.version,data:{agencyCommission:99999}}),403);
  fails(()=>command(db,couple,'entity.edit',{projectId:p.id,entityId:selection.id,version:selection.version,data:{title:'Фотограф Иван · обновлено'}}),403);assert.equal(Object.hasOwn(snapshot(db,couple,p.id),'history'),false);
  const cash=snapshot(db,admin).agencyRevenue,card=cash.projects.find(item=>item.projectId===p.id);
  assert.equal(card.commissionExpected,12000);assert.equal(card.feeExpected,50000);assert.equal(card.totalExpected,62000);assert.equal(card.items.find(item=>item.type==='commission').counterparty,'Фотограф Иван');assert.equal(cash.totalExpected,62000);
});

test('wedding vendor proposals keep reusable categories and expose final choices without leaking the agency catalog',()=>{
  const {db,admin}=fixture(),p=project(db,admin);
  const category=command(db,admin,'entity.create',{kind:'vendorCategory',data:{name:'Фото',archived:false}});
  const vendor=command(db,admin,'entity.create',{kind:'vendor',data:{name:'Фотограф Анна',categoryId:category.id,price:90000,services:'Полный день'}});
  const proposal=command(db,admin,'entity.create',{projectId:p.id,kind:'selection',data:{title:'Фотограф Анна',vendorId:vendor.id,price:90000,selected:true,services:'Полный день'}});
  assert.equal(proposal.data.categoryId,category.id);assert.equal(proposal.data.categoryName,'Фото');
  const organizerState=snapshot(db,admin,p.id);
  assert(organizerState.catalog.some(item=>item.id===category.id));assert(organizerState.catalog.some(item=>item.id===vendor.id));
  const couple=registered(db,'vendor-choice-couple@example.test','Пара'),coupleRole=db.prepare("SELECT id FROM roles WHERE agency_id=? AND key='couple'").get(admin.agency_id);assign(db,admin,couple,[{roleId:coupleRole.id,projectId:p.id,restrictions:{}}]);
  const coupleState=snapshot(db,couple,p.id),visible=coupleState.entities.find(item=>item.id===proposal.id);
  assert.deepEqual(coupleState.catalog,[]);assert.equal(visible.data.categoryName,'Фото');assert.equal(visible.data.selected,true);
  fails(()=>command(db,couple,'entity.edit',{projectId:p.id,entityId:proposal.id,version:proposal.version,data:{terms:'Новые условия'}}),403);
  const unselected=command(db,couple,'entity.edit',{projectId:p.id,entityId:proposal.id,version:proposal.version,data:{selected:false}});assert.equal(unselected.data.selected,false);
});

test('selected vendor deletion and restoration keep its estimate obligation consistent',()=>{
  const {db,admin}=fixture();
  const p=project(db,admin);
  let selection=command(db,admin,'entity.create',{projectId:p.id,kind:'selection',data:{title:'Ведущий',price:70000,selected:true,terms:'Весь вечер',dueDate:'2027-07-01'}});
  const obligationId=selection.data.obligationId;
  selection=command(db,admin,'entity.delete',{projectId:p.id,entityId:selection.id,version:selection.version,confirm:true});
  assert.equal(entity(db,obligationId).deleted,true);
  selection=command(db,admin,'entity.restore',{projectId:p.id,entityId:selection.id,version:selection.version});
  assert.equal(selection.deleted,false); assert.equal(entity(db,obligationId).deleted,false);
  assert.equal(snapshot(db,admin,p.id).financials.agreed,70000);
});

test('editing a linked obligation updates the selection atomically and requires vendor access',()=>{
  const {db,admin}=fixture();
  const p=project(db,admin);
  const selection=command(db,admin,'entity.create',{projectId:p.id,kind:'selection',data:{title:'Ведущий',price:70000,selected:true,terms:'Весь вечер',dueDate:'2027-07-01'}});
  let obligation=entity(db,selection.data.obligationId),linked=entity(db,selection.id);
  obligation=command(db,admin,'entity.edit',{projectId:p.id,entityId:obligation.id,version:obligation.version,data:{title:'Ведущий и диджей',agreed:80000,condition:'До полуночи'}});
  const updated=entity(db,selection.id);
  assert.equal(updated.version,linked.version+1);
  assert.equal(updated.data.title,'Ведущий и диджей'); assert.equal(updated.data.price,80000); assert.equal(updated.data.terms,'До полуночи');

  const budgetEditor=registered(db,'linked-budget-only@example.test');
  const roleId=role(db,admin,'Только связанная смета',['read','edit','finance']).id;
  assign(db,admin,budgetEditor,[{roleId,projectId:p.id,restrictions:{sections:['budget'],rows:[obligation.id],fields:['agreed']}}]);
  fails(()=>command(db,budgetEditor,'entity.edit',{projectId:p.id,entityId:obligation.id,version:obligation.version,data:{agreed:85000}}),403);
  assert.equal(entity(db,obligation.id).data.agreed,80000); assert.equal(entity(db,selection.id).data.price,80000);
});

test('settings are normalized without mutating the command payload',()=>{
  const {db,admin}=fixture();
  const agency=db.prepare('SELECT * FROM agencies WHERE id=?').get(admin.agency_id);
  const settings={tagline:'  Вместе  ',description:'  Спокойная организация  ',contact:'  hello@example.test  ',services:['  Координация  '],portfolio:[{title:'  Летняя свадьба  ',image:'https://example.test/photo.jpg',description:'  В саду  ',private:'drop'}],private:'drop'};
  const before=structuredClone(settings);
  const result=command(db,admin,'settings.save',{version:agency.version,name:'  Новое имя  ',settings});
  assert.deepEqual(settings,before);
  assert.deepEqual(result.settings,{tagline:'Вместе',description:'Спокойная организация',contact:'hello@example.test',services:['Координация'],portfolio:[{title:'Летняя свадьба',image:'https://example.test/photo.jpg',description:'В саду'}]});
  fails(()=>command(db,admin,'settings.save',{version:agency.version+1,name:'Имя',settings:{...before,services:[{}]}}));
});

test('empty sections remain visible without leaking unrelated structure',()=>{
  const {db,admin}=fixture();
  const p=project(db,admin),table=rowTable(db,admin,p.id);
  const empty=command(db,admin,'entity.create',{projectId:p.id,kind:'section',data:{name:'Пустой раздел',order:10,archived:false}});
  assert(snapshot(db,admin,p.id).entities.some(item=>item.id===empty.id));

  const scoped=registered(db,'section-scope@example.test');
  const reader=role(db,admin,'Одна таблица',['read']);
  assign(db,admin,scoped,[{roleId:reader.id,projectId:p.id,restrictions:{sections:[table.id]}}]);
  const state=snapshot(db,scoped,p.id);
  assert(state.entities.some(item=>item.id===table.data.sectionId));
  assert.equal(state.entities.some(item=>item.id===empty.id),false);
});

test('history exposes current entity state for restoring deleted records',()=>{
  const {db,admin}=fixture();
  const p=project(db,admin),table=rowTable(db,admin,p.id);
  let row=addRow(db,admin,p.id,table,{title:'Удаляемая строка'});
  row=command(db,admin,'entity.delete',{projectId:p.id,entityId:row.id,version:row.version,schemaVersion:table.version});
  const history=snapshot(db,admin,p.id).history.find(item=>item.entity_id===row.id&&item.action==='delete');
  assert.equal(history.current_version,row.version); assert.equal(history.current_deleted,1);
});

test('global resource permissions do not silently grant mutation verbs',()=>{
  const {db,admin}=fixture();
  const vendor=command(db,admin,'entity.create',{kind:'vendor',data:{name:'Каталог',price:null}});
  const user=registered(db,'catalog-reader@example.test');
  const catalogReader=role(db,admin,'Чтение каталога',['read','catalog']);
  assign(db,admin,user,[{roleId:catalogReader.id,projectId:null,restrictions:{}}]);
  assert(snapshot(db,user).global.some(item=>item.id===vendor.id));
  fails(()=>command(db,user,'entity.create',{kind:'vendor',data:{name:'Недопустимое создание',price:null}}),403);
  fails(()=>command(db,user,'entity.edit',{entityId:vendor.id,version:vendor.version,data:{name:'Недопустимая правка'}}),403);
  fails(()=>command(db,user,'entity.delete',{entityId:vendor.id,version:vendor.version}),403);
});

test('custom template keys are normalized before project structure is cloned',()=>{
  const {db,admin}=fixture();
  const template=command(db,admin,'entity.create',{kind:'template',data:{name:'  Свой шаблон  ',sections:[{key:'first',name:'Первый',order:0},{key:' day ',name:'  День  ',order:1}],tables:[{key:'timing',name:'  Тайминг  ',section:'day',columns:[{id:'title',name:'Событие',type:'text'}]}],categories:['  Фото  '],offline:[' timing ']}});
  assert.deepEqual(template.data.offline,['timing']); assert.deepEqual(template.data.categories,['Фото']);
  const p=command(db,admin,'project.create',{templateId:template.id,data:{name:'Шаблонная свадьба',date:'2027-12-01'}});
  const sections=entities(db,admin.agency_id,p.id,'section'),table=rowTable(db,admin,p.id);
  assert.equal(sections.find(section=>section.id===table.data.sectionId).data.name,'День');
  assert.equal(table.data.offline,true);
});

test('movement participant details and agency category totals remain explicit',()=>{
  const {db,admin}=fixture();
  const p=project(db,admin);
  const category=command(db,admin,'entity.create',{kind:'category',data:{name:'Организация',scope:'agency',archived:false}});
  const deposit=command(db,admin,'movement.save',{projectId:p.id,data:{type:'deposit',amount:10000,date:'2027-01-01',description:'Передача средств',source:'custody',to:admin.id,counterparty:'  Анна и Илья  ',method:'  наличные  '}});
  assert.equal(deposit.data.counterparty,'Анна и Илья'); assert.equal(deposit.data.method,'наличные');
  const receipt=upload(db,admin,p.id,{name:'чек.txt',mime:'text/plain',content:Buffer.from('paid').toString('base64')});
  const payable=command(db,admin,'entity.create',{projectId:p.id,kind:'obligation',data:{title:'Фотограф',priceKind:'amount',agreed:3000,planned:null,dueDate:'',fee:false}});
  const payment=command(db,admin,'movement.save',{projectId:p.id,obligationVersion:payable.version,data:{type:'payment',amount:3000,date:'2027-01-02',description:'Оплата фотографу',source:'custody',from:admin.id,obligationId:payable.id,counterparty:'Фотограф',method:'карта',fileId:receipt.id}});
  assert.equal(payment.data.counterparty,'Фотограф'); assert.equal(payment.data.fileId,receipt.id);
  const refund=command(db,admin,'movement.save',{projectId:p.id,data:{type:'refund',amount:2000,date:'2027-01-02',description:'Возврат остатка',source:'custody',from:admin.id,counterparty:'Анна'}});
  assert.equal(refund.data.counterparty,'Анна');
  const obligation=command(db,admin,'entity.create',{projectId:p.id,kind:'obligation',data:{title:'Гонорар',priceKind:'amount',agreed:5000,planned:null,dueDate:'',fee:true}});
  command(db,admin,'movement.save',{projectId:p.id,obligationVersion:obligation.version,data:{type:'fee',amount:5000,date:'2027-01-02',description:'Гонорар',source:'direct',obligationId:obligation.id,categoryId:category.id}});
  command(db,admin,'movement.save',{data:{type:'income',amount:12345,date:'2027-01-03',description:'Консультация',source:'direct',categoryId:category.id}});
  command(db,admin,'movement.save',{data:{type:'expense',amount:2345,date:'2027-01-04',description:'Реклама',source:'direct',categoryId:category.id}});
  const finance=snapshot(db,admin).financials;
  assert.equal(finance.incomeByCategory[category.id],17345);
  assert.equal(finance.expenseByCategory[category.id],2345);
  fails(()=>command(db,admin,'movement.save',{projectId:p.id,data:{type:'refund',amount:100,date:'2027-01-05',description:'Возврат',source:'custody',from:admin.id,counterparty:''}}));
  fails(()=>command(db,admin,'movement.save',{data:{type:'income',amount:100,date:'2027-01-05',description:'Доход',source:'direct',method:'x'.repeat(101)}}));
  fails(()=>command(db,admin,'movement.save',{projectId:p.id,data:{type:'deposit',amount:100,date:'2027-01-05',description:'Без файла',source:'custody',to:admin.id,fileId:uid()}}),404);
});
