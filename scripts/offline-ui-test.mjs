import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openDatabase} from '../server/db.mjs';
import {bootstrap,execute,snapshot} from '../server/service.mjs';
import {createHttpServer} from '../server/http.mjs';

let chromium;
try { ({chromium}=await import('playwright')); }
catch { ({chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH||'/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'))); }
const temp=mkdtempSync(join(tmpdir(),'tie-offline-ui-')),dbPath=join(temp,'test.sqlite');
const db=openDatabase(dbPath);
const {user}=bootstrap(db,{slug:'tie',agencyName:'Offline UI Agency',name:'Offline Coordinator',email:'offline-ui@example.test',password:'offline-ui-password'});
const send=(op,args)=>execute(db,user,{id:crypto.randomUUID(),op,...args});
const project=send('project.create',{data:{name:'Offline UI Wedding',date:'2027-08-08'}});
const state=snapshot(db,user,project.id),table=state.entities.find(e=>e.kind==='table'&&e.data.key==='timing');
const event=send('entity.create',{projectId:project.id,kind:'row',parentId:table.id,schemaVersion:table.version,data:{title:'Начало церемонии',time:'15:00',audience:'Общее'}});
const obligation=send('entity.create',{projectId:project.id,kind:'obligation',data:{title:'Оплата цветов',priceKind:'amount',agreed:12345,planned:null,dueDate:'2027-08-08',fee:false}});
const server=createHttpServer({dbPath,distDir:resolve('dist')});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`;
let context,page;const errors=[];
async function open(offline){context=await chromium.launchPersistentContext(join(temp,'profile'),{executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,viewport:{width:390,height:844}});await context.setOffline(offline);page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);}
async function nav(name){await page.locator('.mobile-menu').click();await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();}
try{
 await open(false);await page.getByRole('button',{name:'Войти',exact:true}).click();let dialog=page.getByRole('dialog');await dialog.getByLabel('Почта').fill('offline-ui@example.test');await dialog.getByLabel('Пароль').fill('offline-ui-password');await dialog.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('heading',{name:'Offline UI Wedding',exact:true}).click();await page.getByRole('button',{name:'Подготовить проект',exact:true}).click();await page.getByRole('heading',{name:'Проект подготовлен',exact:true}).waitFor();await page.evaluate(()=>navigator.serviceWorker.ready);await context.close();context=null;
 await open(true);await page.getByRole('heading',{name:'Предстоящие выплаты',exact:true}).waitFor();await page.getByRole('button',{name:'Оплатить',exact:true}).click();dialog=page.getByRole('dialog');assert.equal(await dialog.getByLabel('Сумма, ₽').inputValue(),'123.45');await dialog.getByLabel('Контур денег').selectOption('direct');await dialog.getByRole('button',{name:'Сохранить движение'}).click();await dialog.waitFor({state:'detached'});await page.getByText('Изменение сохранено в очередь',{exact:true}).waitFor();
 await nav('Тайминг пары');let row=page.locator('tbody tr').first();await row.getByRole('button',{name:'Изменить',exact:true}).click();await row.getByRole('checkbox',{name:'Выполнено',exact:true}).check();await row.getByRole('button',{name:'Сохранить',exact:true}).click();await row.getByText('Да',{exact:true}).waitFor();await context.close();context=null;
 await open(true);await page.getByRole('heading',{name:'Предстоящие выплаты',exact:true}).waitFor();await page.getByLabel('Показать оплаченные').check();await page.getByText('Уже оплачено 123,45',{exact:false}).waitFor();await nav('Тайминг пары');row=page.locator('tbody tr').first();await row.getByText('Да',{exact:true}).waitFor();
 await context.setOffline(false);await page.getByRole('button',{name:/^Синхронизировать/}).click();await page.getByText('Очередь синхронизирована',{exact:true}).waitFor();await page.getByRole('button',{name:/^Синхронизировать/}).click();
 const final=snapshot(db,user,project.id);assert.equal(final.entities.find(e=>e.id===event.id).data.done,true);assert.equal(final.financials.paid[obligation.id],12345);assert.equal(final.entities.filter(e=>e.kind==='movement'&&e.data.obligationId===obligation.id).length,1);assert.deepEqual(errors,[]);
 mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/offline-ui-mobile.png',fullPage:true});console.log('Production UI cold offline restarts, mobile timing edit, exact payment, durable queue and replay once: PASS');
}finally{if(context)await context.close();await new Promise(done=>server.close(done));db.close();}
