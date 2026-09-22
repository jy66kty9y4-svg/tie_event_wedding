import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, insert, uid } from '../server/db.mjs';
import { bootstrap } from '../server/service.mjs';
import { executeModule } from '../server/v2/common.mjs';
import { listTasks, migrate, operations } from '../server/v2/workflow/index.mjs';

test('active task filter returns todo and doing before pagination',()=>{
  const db=openDatabase(':memory:');
  const setup=bootstrap(db,{slug:'ux-filter',agencyName:'Тест',email:'owner@example.test',name:'Владелец',password:'strong-pass-1'});
  migrate(db);
  const project=insert(db,setup.user,'project',{name:'Тестовая свадьба',date:'2027-06-12',timeZone:'Europe/Moscow'});
  const command=data=>executeModule(db,setup.user,{id:uid(),op:'task.create',projectId:project.id,data},operations);
  const todo=command({title:'Запланировано',dueMode:'fixed',fixedDate:'2027-05-01'});
  const doing=command({title:'В работе',dueMode:'fixed',fixedDate:'2027-05-02',status:'doing'});
  const done=command({title:'Готово',dueMode:'fixed',fixedDate:'2027-05-03',status:'done'});
  const active=listTasks(db,setup.user,{projectId:project.id,status:'active',limit:1});
  assert.equal(active.total,2);
  assert.equal(active.items.length,1);
  assert.notEqual(active.items[0].id,done.id);
  assert.equal(active.nextOffset,1);
  const second=listTasks(db,setup.user,{projectId:project.id,status:'active',offset:active.nextOffset,limit:1});
  assert.equal(second.items.length,1);
  assert.deepEqual(new Set([...active.items,...second.items].map(item=>item.id)),new Set([todo.id,doing.id]));
});

test('task search matches title and description keywords before pagination',()=>{
  const db=openDatabase(':memory:');
  const setup=bootstrap(db,{slug:'ux-search',agencyName:'Тест',email:'owner@example.test',name:'Владелец',password:'strong-pass-1'});
  migrate(db);
  const project=insert(db,setup.user,'project',{name:'Тестовая свадьба',date:'2027-06-12',timeZone:'Europe/Moscow'});
  const command=(op,body)=>executeModule(db,setup.user,{id:uid(),op,projectId:project.id,...body},operations);
  const decor=command('task.create',{data:{title:'Согласовать декор',description:'Розовые пионы и высокие свечи',dueMode:'fixed',fixedDate:'2027-05-01'}});
  command('task.create',{data:{title:'Выбрать музыку',description:'Плейлист для приветственного коктейля',dueMode:'fixed',fixedDate:'2027-05-02'}});
  const result=listTasks(db,setup.user,{projectId:project.id,query:'ПИОНЫ декор',limit:1});
  assert.equal(result.total,1);
  assert.equal(result.items[0].id,decor.id);
  assert.equal(listTasks(db,setup.user,{projectId:project.id,query:'коктейля'}).total,1);
  assert.equal(listTasks(db,setup.user,{projectId:project.id,query:'несуществующее слово'}).total,0);
  command('task.setOrganizerFocus',{entityId:decor.id,version:decor.version,focused:true});
  assert.deepEqual(listTasks(db,setup.user,{query:'розовые свечи'}).items.map(item=>item.id),[decor.id]);
});
