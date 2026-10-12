import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHttpServer} from '../server/http.mjs';
import {bootstrap,execute} from '../server/service.mjs';
import {createSession,token,grant} from '../server/auth.mjs';
import {registerTestUser} from '../tests/fixtures/account.mjs';
import {uid,entities,entity} from '../server/db.mjs';
const {chromium,webkit}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH||'/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const engine=process.env.TEST_BROWSER==='webkit'?'webkit':'chromium',root=mkdtempSync(join(tmpdir(),'tie-wedding-template-'));
const server=createHttpServer({dbPath:join(root,'test.sqlite'),distDir:resolve('dist')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const db=server.db,origin=`http://127.0.0.1:${server.address().port}`;
const admin=bootstrap(db,{slug:'tie',agencyName:'Тест шаблонов',name:'Владелец',email:'admin@example.test',password:'template-password'}).user;
const run=(op,body={})=>execute(db,admin,{id:uid(),op,...body});
const project=run('project.create',{data:{name:'Образец структуры',date:'2027-06-12'}}),projectId=project.id;
const section=run('entity.create',{projectId,kind:'section',data:{name:'Контроль',order:5}});
run('entity.create',{projectId,kind:'table',data:{key:'control',name:'Особая таблица',sectionId:section.id,columns:[{id:'title',name:'Название',type:'text'},{id:'amount',name:'Цена',type:'money'},{id:'calculated',name:'Расчёт',type:'formula',formula:'{amount} * 2'}]}});
run('coupleBudget.cell',{projectId,row:9,field:'name',value:'Аренда из шаблона'});
run('coupleBudget.cell',{projectId,row:9,field:'actual',value:999001});
run('task.create',{projectId,data:{title:'Особая задача',description:'PRIVATE-DESCRIPTION',dueMode:'none'}});
const couple=registerTestUser(db,{slug:'tie',name:'Пара',email:'couple@example.test',password:'password-123'}).user;
grant(db,couple,db.prepare("SELECT id FROM roles WHERE agency_id=? AND key='couple'").get(admin.agency_id).id,projectId);
const browser=await (engine==='webkit'?webkit.launch({headless:true}):chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})),errors=[];
const previews='/private/tmp/tie-wedding-template-previews';mkdirSync(previews,{recursive:true});
async function contextFor(user,width){const context=await browser.newContext({timezoneId:'Europe/Moscow',viewport:{width,height:956},...(width<768?{isMobile:true,hasTouch:true}:{})});await context.addCookies([{name:'tie_session',value:createSession(db,user),url:origin,httpOnly:true},{name:'tie_csrf',value:token(),url:origin}]);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return {context,page}}
async function waitDb(check){const end=Date.now()+8000;while(!check()){if(Date.now()>end)throw new Error('Database condition timed out');await new Promise(resolve=>setTimeout(resolve,25))}}
try{
 for(const width of [440,1280]){
  const {context,page}=await contextFor(admin,width);await page.goto(origin+'/app/projects',{waitUntil:'networkidle'});
  const card=page.locator('.wedding-status-card').filter({hasText:'Образец структуры'});await card.waitFor();
  await card.getByRole('button',{name:'Меню свадьбы Образец структуры',exact:true}).click();await page.getByRole('button',{name:'Сохранить как шаблон',exact:true}).waitFor();
  const menu=await page.locator('.wedding-actions-menu').boundingBox();assert(menu.x>=0&&menu.x+menu.width<=width);
  await page.screenshot({path:join(previews,`menu-${engine}-${width}.png`)});
  await page.keyboard.press('Escape');assert.equal(await page.locator('.wedding-actions-menu').count(),0);
  await card.getByRole('button',{name:'Меню свадьбы Образец структуры',exact:true}).click();await page.getByRole('button',{name:'Изменить свадьбу',exact:true}).click();await page.getByRole('dialog',{name:'Данные свадьбы'}).waitFor();await page.getByRole('button',{name:'Отмена',exact:true}).click();
  await card.getByRole('button',{name:'Меню свадьбы Образец структуры',exact:true}).click();await page.getByRole('button',{name:'Сохранить как шаблон',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Сохранить свадьбу как шаблон'}),name=`Автошаблон ${width}`;await dialog.getByLabel('Название шаблона',{exact:true}).fill(name);await page.screenshot({path:join(previews,`dialog-${engine}-${width}.png`)});await dialog.getByRole('button',{name:'Сохранить шаблон',exact:true}).click();
  await waitDb(()=>entities(db,admin.agency_id,null,'template').some(t=>t.data.name===name));await dialog.waitFor({state:'hidden'});console.log('Captured',width);
  const saved=entities(db,admin.agency_id,null,'template').find(t=>t.data.name===name);assert(!JSON.stringify(saved.data).includes('999001'));assert(!JSON.stringify(saved.data).includes('PRIVATE-DESCRIPTION'));
  await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'Новая свадьба',exact:true}).click();const create=page.getByRole('dialog',{name:'Новая свадьба'});await create.getByLabel('Название',{exact:true}).fill(`Из шаблона ${width}`);await create.getByRole('combobox').selectOption(saved.id);await create.getByRole('button',{name:'Создать свадьбу',exact:true}).click();console.log('Created',width);
  await waitDb(()=>entities(db,admin.agency_id,null,'project').some(p=>p.data.name===`Из шаблона ${width}`));
  const next=entities(db,admin.agency_id,null,'project').find(p=>p.data.name===`Из шаблона ${width}`),rows=entities(db,admin.agency_id,next.id);
  assert.equal(rows.find(r=>r.kind==='coupleBudget').data.names[9],'Аренда из шаблона');assert.equal(rows.find(r=>r.kind==='coupleBudget').data.actual,undefined);assert.equal(rows.find(r=>r.kind==='table'&&r.data.key==='control').data.columns[2].formula,'{amount} * 2');assert.equal(rows.find(r=>r.kind==='task'&&r.data.title==='Особая задача').data.dueDate,'');
  await page.goto(origin+`/app/projects/${next.id}/finance/estimate`,{waitUntil:'networkidle'});await page.getByLabel('Поиск по смете',{exact:true}).waitFor();await page.getByLabel('Поиск по смете',{exact:true}).fill('Аренда из шаблона');await page.getByText('Аренда из шаблона',{exact:true}).first().waitFor();await page.screenshot({path:join(previews,`new-budget-${engine}-${width}.png`)});
  await page.goto(origin+'/app/projects',{waitUntil:'networkidle'});await page.getByRole('heading',{name:'Свадьбы',exact:true}).waitFor();await page.setViewportSize({width:320,height:956});await card.getByRole('button',{name:'Меню свадьбы Образец структуры',exact:true}).click();const small=await page.locator('.wedding-actions-menu').boundingBox();assert(small.x>=0&&small.x+small.width<=320);assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1));await page.waitForLoadState('networkidle');await context.close();
 }
 const {context,page}=await contextFor(couple,440);await page.goto(origin+`/app/projects/${projectId}/overview`,{waitUntil:'networkidle'});await page.locator('.v2-main-column h1').first().waitFor();assert.equal(await page.getByRole('button',{name:'Сохранить как шаблон',exact:true}).count(),0);await page.waitForLoadState('networkidle');await context.close();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({engine,viewports:[320,440,1280],menu:true,automaticCapture:true,newWedding:true,privacy:true,errors}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
