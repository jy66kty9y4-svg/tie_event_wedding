import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase,decode,entities,entity,uid} from '../server/db.mjs';
import {bootstrap,execute,register} from '../server/service.mjs';
import {financials} from '../server/model.mjs';
import {grant} from '../server/auth.mjs';
import {listTasks,previewReschedule} from '../server/v2/workflow/index.mjs';
import {getPublishedMicrosite} from '../server/v2/publishing/index.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));let sequence=0;
const command=(db,user,op,body={})=>execute(db,user,{id:`integration_${++sequence}_${uid()}`,op,...body});
const rejects=(fn,status)=>assert.throws(fn,error=>error?.status===status);
const stable=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
function snapshot(db){
 const raw=db.prepare('SELECT * FROM entities ORDER BY id').all(),rows=raw.map(decode),audit=db.prepare('SELECT id,agency_id,project_id,actor_id,entity_id,kind,action,before_json,after_json,created_at FROM audit ORDER BY id').all(),projects=raw.filter(row=>row.kind==='project').map(row=>row.id),scopes=[null,...projects];
 const ledger=Object.fromEntries(scopes.map(scope=>{const value=financials(rows.filter(row=>row.project_id===scope));return [scope??'agency',{agreed:value.agreed,planned:value.planned,unknown:value.unknown,totalPaid:value.totalPaid,due:value.due,custody:value.custody,income:value.income,expense:value.expense,own:value.own,holders:value.holders,paid:value.paid}]}));
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name),counts=Object.fromEntries(tables.map(name=>[name,db.prepare(`SELECT count(*) count FROM "${name}"`).get().count]));
 return {entities:raw.map(row=>({id:row.id,agency_id:row.agency_id,project_id:row.project_id,kind:row.kind,parent_id:row.parent_id,data:JSON.parse(row.data),version:row.version,deleted:row.deleted,updated_at:row.updated_at})),audit,ledger,counts,migrations:db.prepare('SELECT version FROM migrations ORDER BY version').all().map(row=>row.version)};
}
function assertOriginalPreserved(before,after){
 const current=new Map(after.entities.map(row=>[row.id,row]));for(const old of before.entities){const next=current.get(old.id);assert(next,`Потерян entity ${old.id}`);const guestTableMigration=old.kind==='table'&&old.data.key==='guests',guestTemplateMigration=old.kind==='template'&&(old.data.tables||[]).some(table=>table.key==='guests'),guestDefaultsMigration=guestTableMigration||guestTemplateMigration;for(const key of ['id','agency_id','project_id','kind','parent_id','deleted',...(guestDefaultsMigration?[]:['version','updated_at'])])assert.deepEqual(next[key],old[key],`${old.id}: изменено ${key}`);for(const [key,value] of Object.entries(old.data)){if(guestTableMigration&&['columns','semanticMap'].includes(key)||guestTemplateMigration&&key==='tables')continue;assert.deepEqual(next.data[key],value,`${old.id}: потеряно поле ${key}`);}}
 const audits=new Map(after.audit.map(row=>[row.id,row]));for(const old of before.audit)assert.deepEqual(audits.get(old.id),old,`Изменена история ${old.id}`);assert.equal(stable(after.ledger),stable(before.ledger),'Миграция изменила финансовые итоги');
}

test('V1 backup copies migrate without lost IDs, ledger or history and repeated open is stable',async t=>{
 const backupRoot=join(root,'data','backups'),folder=existsSync(backupRoot)?readdirSync(backupRoot).filter(name=>name.startsWith('v1-')).sort().at(-1):null;if(!folder)return t.skip('В репозитории нет локальной V1 backup-копии');
 const sources=['tie.sqlite','demo.sqlite'].map(name=>join(backupRoot,folder,name)).filter(existsSync);assert.equal(sources.length,2);const temp=mkdtempSync(join(tmpdir(),'tie-v2-migration-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
 for(const sourcePath of sources){const source=new DatabaseSync(sourcePath,{readOnly:true}),before=snapshot(source);assert.deepEqual(before.migrations,[1,2,3]);const copyPath=join(temp,sourcePath.endsWith('demo.sqlite')?'demo.sqlite':'tie.sqlite');await backup(source,copyPath);source.close();
  let copy=openDatabase(copyPath),after=snapshot(copy);assertOriginalPreserved(before,after);const originalIds=new Set(before.entities.map(row=>row.id)),added=after.entities.filter(row=>!originalIds.has(row.id)),addedAudit=after.audit.filter(row=>!before.audit.some(old=>old.id===row.id)),createAudit=addedAudit.filter(entry=>entry.action==='create');assert.equal(createAudit.length,added.length);assert(added.every(row=>createAudit.some(entry=>entry.entity_id===row.id)));assert.deepEqual(after.migrations,[1,2,3,4,5,6,7,8,9,10,11,12,13,14]);const coupleRoles=copy.prepare("SELECT permissions FROM roles WHERE key='couple'").all();assert(coupleRoles.every(role=>!JSON.parse(role.permissions).includes('history')));const studentRoles=copy.prepare("SELECT permissions FROM roles WHERE key='student'").all(),agencyCount=copy.prepare('SELECT count(*) count FROM agencies').get().count;assert.equal(studentRoles.length,agencyCount);assert(studentRoles.every(role=>JSON.parse(role.permissions).includes('projects')));const first=stable(after);copy.close();copy=openDatabase(copyPath);assert.equal(stable(snapshot(copy)),first,'Повторное открытие повторило миграцию или импорт');copy.close();
  const original=new DatabaseSync(sourcePath,{readOnly:true});assert.equal(stable(snapshot(original)),stable(before),'Исходная backup-копия была изменена');original.close();
 }
});

test('a clean database contains structure samples but no fake clients, projects or money',t=>{
 const temp=mkdtempSync(join(tmpdir(),'tie-v2-clean-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));const db=openDatabase(join(temp,'clean.sqlite'));assert.equal(db.prepare('SELECT count(*) count FROM agencies').get().count,0);const user=bootstrap(db,{slug:'clean',agencyName:'Чистая установка',email:'owner@example.test',name:'Владелец',password:'strong-password'}).user,kinds=db.prepare('SELECT kind,count(*) count FROM entities GROUP BY kind ORDER BY kind').all();
 assert.equal(kinds.some(row=>['project','application','movement','obligation','selection'].includes(row.kind)),false);const ledger=financials(entities(db,user.agency_id,null));assert.deepEqual({agreed:ledger.agreed,totalPaid:ledger.totalPaid,custody:ledger.custody,income:ledger.income,expense:ledger.expense},{agreed:0,totalPaid:0,custody:0,income:0,expense:0});db.close();
});

function fixture(){const db=openDatabase(':memory:'),slug=`integration-${++sequence}`,admin=bootstrap(db,{slug,agencyName:'Интеграция',email:'owner@example.test',name:'Владелец',password:'strong-password'}).user,project=command(db,admin,'project.create',{data:{name:'Анна и Иван',date:'2027-06-12'}});return {db,admin,project,slug};}

test('central dispatcher rechecks revoked access before replay and generic project date paths stay blocked',()=>{
 const {db,admin,project,slug}=fixture(),member=register(db,{slug,email:'member@example.test',name:'Координатор',password:'strong-password'}).user,role=db.prepare("SELECT id FROM roles WHERE agency_id=? AND key='coordinator'").get(admin.agency_id);grant(db,member,role.id,project.id);
 const task=command(db,admin,'task.create',{projectId:project.id,data:{title:'Проверить зал',dueMode:'relative',offsetDays:-10}}),status={id:`replay_status_${uid()}`,op:'task.setStatus',projectId:project.id,entityId:task.id,version:task.version,status:'doing'};execute(db,member,status);db.prepare('DELETE FROM grants WHERE user_id=?').run(member.id);rejects(()=>execute(db,member,status),403);
 rejects(()=>command(db,admin,'entity.edit',{projectId:project.id,entityId:project.id,version:entity(db,project.id).version,data:{date:'2027-07-01'}}),409);
 const preview=previewReschedule(db,admin,{projectId:project.id,newDate:'2027-07-12'}),moved=command(db,admin,'project.reschedule.apply',{projectId:project.id,newDate:preview.newDate,newTimeZone:preview.newTimeZone,projectVersion:preview.projectVersion,previewDigest:preview.digest,sourceVersions:preview.affected.map(item=>({id:item.id,version:item.version}))}),history=db.prepare("SELECT id FROM audit WHERE entity_id=? AND action='reschedule' ORDER BY rowid DESC LIMIT 1").get(project.id);assert(history);
 rejects(()=>command(db,admin,'entity.restore',{projectId:project.id,entityId:project.id,version:moved.project.version,auditId:history.id}),409);
});

test('field-restricted task list never exposes ungranted task fields',()=>{
 const {db,admin,project,slug}=fixture(),task=command(db,admin,'task.create',{projectId:project.id,data:{title:'Разрешённое название',description:'Скрытая заметка',dueMode:'fixed',fixedDate:'2027-05-01',priority:'urgent'}}),viewer=register(db,{slug,email:'viewer@example.test',name:'Наблюдатель',password:'strong-password'}).user,roleId=uid();db.prepare('INSERT INTO roles(id,agency_id,name,permissions,protected,key) VALUES(?,?,?,?,0,?)').run(roleId,admin.agency_id,'Только название',JSON.stringify(['read']),'title-only');grant(db,viewer,roleId,project.id,{sections:['tasks'],rows:[task.id],fields:['title']});
 const page=listTasks(db,viewer,{projectId:project.id});assert.equal(page.total,1);assert.deepEqual(Object.keys(page.items[0].data),['title']);assert.equal(page.items[0].data.title,'Разрешённое название');assert.equal(JSON.stringify(page).includes('Скрытая заметка'),false);assert.equal(JSON.stringify(page).includes('2027-05-01'),false);
});

test('central guest command returns a one-time raw token but persists only the redacted result',()=>{
 const {db,admin,project}=fixture(),guestTable=entities(db,admin.agency_id,project.id,'table').find(row=>row.data.key==='guests'),mapped=command(db,admin,'guestMapping.save',{projectId:project.id,guestTableId:guestTable.id,schemaVersion:guestTable.version,data:{semanticMap:{guestName:'name',rsvpStatus:'status'}},confirm:true}),guest=command(db,admin,'entity.create',{projectId:project.id,kind:'row',parentId:mapped.id,schemaVersion:mapped.version,data:{name:'Семья Ивановых',status:'Не отправлено'}});
 let site=command(db,admin,'microsite.saveDraft',{projectId:project.id,data:{draft:{coupleNames:'Анна и Иван',dateLabel:'12 июня 2027'},rsvpDeadline:'2027-06-01'}});site=command(db,admin,'microsite.publish',{projectId:project.id,version:site.version});const id=`guest_token_${uid()}`,invitation=execute(db,admin,{id,op:'guestInvite.create',projectId:project.id,guestTableId:mapped.id,schemaVersion:mapped.version,guestRowIds:[guest.id]});assert.equal(typeof invitation.token,'string');assert(invitation.token.length>=32);
 const persisted=db.prepare('SELECT result FROM commands WHERE id=? AND user_id=?').get(id,admin.id);assert(persisted);assert.equal(JSON.parse(persisted.result).token,undefined);assert.equal(db.prepare('SELECT count(*) count FROM commands WHERE result LIKE ?').get(`%${invitation.token}%`).count,0);
});

test('timing schema changes dirty the draft while retaining the immutable published snapshot',()=>{
 const {db,admin,project}=fixture();let site=command(db,admin,'microsite.saveDraft',{projectId:project.id,data:{draft:{coupleNames:'Анна и Иван',dateLabel:'12 июня 2027',schedule:[{time:'15:00',title:'Церемония'}]}}});site=command(db,admin,'microsite.publish',{projectId:project.id,version:site.version});const publicBefore=getPublishedMicrosite(db,site.data.shareId),revisionId=site.data.publishedRevisionId,timing=entities(db,admin.agency_id,project.id,'table').find(row=>row.data.key==='timing');
 command(db,admin,'timing.configure',{projectId:project.id,entityId:timing.id,schemaVersion:timing.version,data:{semanticMap:{title:'title',startTime:'time',endTime:'end'},createMissing:['dayOffset','endDayOffset','required','assignedUserIds']}});const changed=entity(db,site.id);assert.equal(changed.data.dirty,true);assert.equal(changed.data.publishedRevisionId,revisionId);assert.equal(stable(getPublishedMicrosite(db,site.data.shareId)),stable(publicBefore));
});
