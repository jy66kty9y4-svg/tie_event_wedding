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

const {chromium,webkit}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH||'/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const root=mkdtempSync(join(tmpdir(),'tie-critical-ui-'));
const server=createHttpServer({dbPath:join(root,'test.sqlite'),distDir:resolve('dist')});
let unavailableBrand=false,unavailableOrigin=false,brandRequests=0;
server.prependListener('request',req=>{
  if(unavailableOrigin)req.socket.destroy();
  if(req.url.startsWith('/brand/tie/')){
    brandRequests++;
    if(unavailableBrand)req.url='/brand/tie/unavailable-test-image.png';
  }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,db=server.db;
const admin=bootstrap(db,{slug:'tie',agencyName:'Тест',name:'Администратор',email:'admin@example.test',password:'test-password'}).user;
const staff=registerTestUser(db,{slug:'tie',name:'Организатор',email:'staff@example.test',password:'test-password'}).user;
grant(db,staff,db.prepare("SELECT id FROM roles WHERE key='organizer'").get().id);
const run=(op,body)=>execute(db,admin,{id:uid(),op,...body});
const project=run('project.create',{data:{name:'Проверка карточки',date:'2027-06-12'}});
const engine=process.env.TEST_BROWSER==='webkit'?'webkit':'chromium';
const browser=await (engine==='webkit'?webkit.launch({headless:true}):chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}));
try {
  const context=await browser.newContext();
  await context.addCookies([{name:'tie_session',value:createSession(db,staff),url:origin,httpOnly:true},{name:'tie_csrf',value:token(),url:origin}]);
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${origin}/app/projects/${project.id}/settings`);
  const heading=page.getByRole('heading',{name:'Данные и команда свадьбы',exact:true});
  await heading.waitFor();
  await page.getByRole('button',{name:'Изменить данные свадьбы',exact:true}).click();
  await page.getByLabel('Заметка для команды',{exact:true}).fill('Описание после изменения');
  await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await heading.waitFor();
  assert.equal(entity(db,project.id).data.notes,'Описание после изменения');
  assert.ok(page.url().includes(`/app/projects/${project.id}/settings`));
  assert.equal(await page.getByText('Нет доступных проектов',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Изменить данные свадьбы',exact:true}).click();
  await page.getByRole('button',{name:'Изменить дату или часовой пояс',exact:true}).click();
  await page.getByLabel('Дата свадьбы',{exact:true}).fill('2027-07-17');
  await page.getByRole('button',{name:'Показать перенос',exact:true}).click();
  await page.getByRole('button',{name:'Подтвердить перенос',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await heading.waitFor();
  assert.equal(entity(db,project.id).data.date,'2027-07-17');
  assert.ok(page.url().includes(`/app/projects/${project.id}/settings`));
  await page.reload();
  await heading.waitFor();
  assert.equal(entity(db,project.id).data.notes,'Описание после изменения');
  assert.deepEqual(errors,[]);
  await context.close();
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const home=await mobile.newPage();
  home.on('pageerror',error=>errors.push(error.message));
  await home.goto(origin+'/');
  await home.getByRole('button',{name:'Войти',exact:true}).waitFor();
  assert.equal(await home.locator('link[rel="apple-touch-icon"]').getAttribute('href'),'/brand/tie/icon-192.png');
  assert.equal(await home.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content'),'yes');
  await home.evaluate(()=>navigator.serviceWorker.ready);
  await home.waitForFunction(()=>!!navigator.serviceWorker.controller);
  // Bypass the ordinary browser HTTP cache and make the brand origin return
  // 404. Installed shell images must come from the current worker's cache.
  unavailableBrand=true;
  const before=brandRequests;
  const cached=await home.evaluate(async()=>Promise.all(['/brand/tie/logo-dark.png','/brand/tie/logo-light.png','/brand/tie/icon-192.png'].map(async url=>{
    const response=await fetch(url,{cache:'no-store'});
    return {status:response.status,type:response.headers.get('content-type'),bytes:(await response.arrayBuffer()).byteLength};
  })));
  assert.ok(cached.every(image=>image.status===200&&image.type==='image/png'&&image.bytes>0));
  assert.equal(brandRequests,before,'Cached logos must not wait for another brand request');
  // WebKit's automation offline switch can fail navigation before reaching
  // a service worker. A disconnected local server exercises real fallback.
  if(engine==='webkit')unavailableOrigin=true;
  else await mobile.setOffline(true);
  await home.reload();
  await home.getByRole('button',{name:'Войти',exact:true}).waitFor();
  await home.waitForFunction(()=>[...document.querySelectorAll('.tie-brand-logo')].some(image=>image.getBoundingClientRect().width>0&&image.complete&&image.naturalWidth>0));
  assert.deepEqual(errors,[]);
  await mobile.close();
  console.log(JSON.stringify({engine,description:'saved-in-project',date:'saved-in-project',reload:'retained',appleTouchIcon:'present',cachedLogos:'no-network-with-failed-origin',mobileOfflineLogo:'decoded',offlineSimulation:engine==='webkit'?'disconnected-server':'browser-offline',errors:0}));
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
