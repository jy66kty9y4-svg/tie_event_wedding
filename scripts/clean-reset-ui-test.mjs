import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openDatabase,entities,uid} from '../server/db.mjs';
import {bootstrap,execute} from '../server/service.mjs';
import {grant,createSession,token} from '../server/auth.mjs';
import {registerTestUser} from '../tests/fixtures/account.mjs';
import {makeCleanDatabase} from '../server/clean-reset.mjs';
import {createHttpServer} from '../server/http.mjs';
const {chromium,webkit}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH||'/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const engine=process.env.TEST_BROWSER==='webkit'?'webkit':'chromium',root=mkdtempSync(join(tmpdir(),'tie-clean-reset-'));
const source=openDatabase(join(root,'source.sqlite')),admin=bootstrap(source,{slug:'tie',agencyName:'Пустое агентство',name:'Администратор',email:'admin@example.test',password:'reset-password'}).user;
const people=[admin,...['Ангелина','Александра'].map((name,i)=>registerTestUser(source,{slug:'tie',name,email:`staff${i}@example.test`,password:'reset-password'}).user)];
const role=source.prepare("SELECT id FROM roles WHERE agency_id=? AND key='organizer'").get(admin.agency_id);for(const user of people.slice(1))grant(source,user,role.id);
const previous=execute(source,admin,{id:uid(),op:'project.create',data:{name:'PRIVATE-OLD-WEDDING',date:'2027-06-12'}}),oldSession=createSession(source,admin);
const path=join(root,'clean.sqlite'),result=makeCleanDatabase(source,path,{agencyId:admin.agency_id,keepUserIds:people.map(p=>p.id)});result.db.close();source.close();
const server=createHttpServer({dbPath:path,distDir:resolve('dist')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const db=server.db,origin=`http://127.0.0.1:${server.address().port}`;
const browser=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})),errors=[];
const previews='/private/tmp/tie-clean-reset-previews';mkdirSync(previews,{recursive:true});
try{
 const context=await browser.newContext({viewport:{width:440,height:956},isMobile:true,hasTouch:true,timezoneId:'Europe/Moscow'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.addCookies([{name:'tie_session',value:oldSession,url:origin,httpOnly:true},{name:'tie_csrf',value:token(),url:origin}]);
 await page.goto(origin+'/api/health');
 await page.evaluate(async({projectId})=>{
  localStorage.setItem('tie:budget-view:v2:old:phone:scale','.5');sessionStorage.setItem('tie:application-draft',JSON.stringify({name:'PRIVATE-OLD-DRAFT'}));
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('tie-private-v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('meta',{keyPath:'key'});r.result.createObjectStore('snapshots',{keyPath:'key'});r.result.createObjectStore('queue',{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  await new Promise((resolve,reject)=>{const t=db.transaction(['meta','snapshots','queue'],'readwrite');t.objectStore('meta').put({key:'identity',value:'old'});t.objectStore('snapshots').put({key:projectId,snapshot:{project:{id:projectId,data:{name:'PRIVATE-OLD-WEDDING'}}}});t.objectStore('queue').put({id:'old_command',command:{op:'entity.create',data:{name:'PRIVATE-OLD-GUEST'}}});t.oncomplete=resolve;t.onerror=()=>reject(t.error)});db.close();
 },{projectId:previous.id});
 await page.goto(origin+'/',{waitUntil:'networkidle'});await page.getByRole('region',{name:'Войти в tie',exact:true}).waitFor();
 assert.equal(await page.getByText('PRIVATE-OLD-WEDDING',{exact:true}).count(),0);assert.equal(await page.getByText('PRIVATE-OLD-DRAFT',{exact:true}).count(),0);
 const retired=await page.evaluate(async()=>({names:(await indexedDB.databases()).map(d=>d.name),oldScale:localStorage.getItem('tie:budget-view:v2:old:phone:scale'),oldDraft:sessionStorage.getItem('tie:application-draft')}));
 assert(!retired.names.includes('tie-private-v1'));assert(retired.names.includes('tie-private-v2'));assert.equal(retired.oldScale,null);assert.equal(retired.oldDraft,null);
 for(const person of people){const response=await context.request.post(origin+'/api/login',{data:{agency:'tie',email:person.email,password:'reset-password'},headers:{Origin:origin,'X-CSRF-Token':(await context.cookies()).find(c=>c.name==='tie_csrf')?.value||''}});assert.equal(response.status(),200,person.name)}
 await context.clearCookies();await page.reload({waitUntil:'networkidle'});
 const login=page.getByRole('region',{name:'Войти в tie',exact:true});await login.getByRole('button',{name:'Почта',exact:true}).click();await login.getByLabel('Почта',{exact:true}).fill('admin@example.test');await login.getByLabel('Пароль',{exact:true}).fill('reset-password');await login.getByRole('button',{name:'Войти',exact:true}).click();await login.waitFor({state:'hidden'});
 await page.goto(origin+'/app/projects',{waitUntil:'networkidle'});await page.getByRole('heading',{name:'Актуальных свадеб пока нет',exact:true}).waitFor();assert.equal(await page.locator('.wedding-status-card').count(),0);await page.screenshot({path:join(previews,`empty-${engine}.png`)});
 const legacy=entities(db,admin.agency_id,null,'template')[0];execute(db,admin,{id:uid(),op:'entity.edit',entityId:legacy.id,version:legacy.version,data:{taskBlueprints:[{key:'legacy',title:'Сохранённый план',phaseKey:'start',offsetDays:-90,dueMode:'relative'}]}});
 await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'Новая свадьба',exact:true}).first().click();const dialog=page.getByRole('dialog',{name:'Новая свадьба'});await dialog.getByLabel('Название',{exact:true}).fill('Новый чистый проект');await dialog.getByRole('button',{name:'Создать свадьбу',exact:true}).click();await dialog.waitFor({state:'hidden'});
 const project=entities(db,admin.agency_id,null,'project')[0],tasks=entities(db,admin.agency_id,project.id,'task');assert.equal(tasks.length,1);assert(tasks.every(t=>t.data.dueMode==='none'&&t.data.dueDate===''&&t.data.offsetDays===null));
 await page.goto(origin+`/app/projects/${project.id}/tasks`,{waitUntil:'networkidle'});await page.getByText(/Без срока/).first().waitFor();await page.screenshot({path:join(previews,`undated-${engine}.png`)});
 assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1));await page.waitForLoadState('networkidle');await context.close();assert.deepEqual(errors,[]);
 console.log(JSON.stringify({engine,legacyOfflineDataRetired:true,preservedAccountsLogin:3,emptyWeddingList:true,legacyTemplateStartsUndated:true,errors}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
