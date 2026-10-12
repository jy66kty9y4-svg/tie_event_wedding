import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHttpServer} from '../server/http.mjs';
import {bootstrap,execute} from '../server/service.mjs';
import {grant,createSession,token} from '../server/auth.mjs';
import {uid,entity} from '../server/db.mjs';
import {registerTestUser} from '../tests/fixtures/account.mjs';

const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH||'/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const root=mkdtempSync(join(tmpdir(),'tie-performance-ui-'));
const server=createHttpServer({dbPath:join(root,'test.sqlite'),distDir:resolve('dist')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,db=server.db;
const admin=bootstrap(db,{slug:'tie',agencyName:'Тест',name:'Администратор',email:'admin@example.test',password:'test-password'}).user;
const staff=registerTestUser(db,{slug:'tie',name:'Организатор',email:'staff@example.test',password:'test-password'}).user;
grant(db,staff,db.prepare("SELECT id FROM roles WHERE key='organizer'").get().id);
const project=execute(db,admin,{id:uid(),op:'project.create',data:{name:'Тест скорости',date:'2027-06-12'}});
let stateRequests=0,assetRequests=0;
server.on('request',req=>{if(req.url==='/api/state')stateRequests++;if(/^\/assets\/.*\.(js|css)$/.test(req.url))assetRequests++});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const context=await browser.newContext();
  await context.addCookies([{name:'tie_session',value:createSession(db,staff),url:origin,httpOnly:true},{name:'tie_csrf',value:token(),url:origin}]);
  await context.addInitScript(()=>{
    const interval=window.setInterval.bind(window);
    window.setInterval=(fn,ms,...args)=>ms===15000?interval(()=>{if(window.__fastPolling)fn(...args)},100):interval(fn,ms,...args);
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/app/projects');
  await page.getByRole('heading',{name:'Тест скорости',exact:true}).waitFor();
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const beforeReload={stateRequests,assetRequests};
  await page.reload();
  await page.getByRole('heading',{name:'Тест скорости',exact:true}).waitFor();
  assert.equal(stateRequests-beforeReload.stateRequests,1,'Returning startup must load agency state once');
  assert.equal(assetRequests-beforeReload.assetRequests,0,'Hashed modules should load from the service worker cache');

  let captured,release;
  const held=new Promise(resolve=>{captured=resolve}),resume=new Promise(resolve=>{release=resolve});
  await page.route('**/api/state',async route=>{
    const response=await route.fetch();captured();await resume;await route.fulfill({response});
  },{times:1});
  await page.evaluate(()=>{window.__fastPolling=true});
  await held;
  await page.evaluate(()=>{window.__fastPolling=false});
  const beforeSave=stateRequests;
  await page.getByRole('button',{name:'Площадка: Не начато',exact:true}).click();
  await page.getByLabel('Комментарий',{exact:true}).fill('Проверено сохранение');
  const started=performance.now();
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.getByRole('button',{name:'Площадка: Закрыто',exact:true}).waitFor();
  const saveMs=Math.round(performance.now()-started);
  assert.equal(stateRequests,beforeSave,'Status save must not reload the entire agency');
  assert.equal(entity(db,project.id).data.weddingControl.stages.venue.comment,'Проверено сохранение');
  const oldResponse=page.waitForResponse(response=>response.url()===origin+'/api/state');
  release();
  await (await oldResponse).finished();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.getByRole('button',{name:'Площадка: Закрыто',exact:true}).waitFor();
  await page.reload();
  await page.getByRole('button',{name:'Площадка: Закрыто',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({startupStateRequests:1,reloadAssetRequests:0,statusExtraStateRequests:0,saveMs,stalePoll:'ignored',persisted:true}));
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
