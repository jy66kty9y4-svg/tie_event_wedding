import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const origin=process.env.TIE_LIVE_ORIGIN||'https://tie-event.cabinpxrn.ru';
const credentials=JSON.parse(readFileSync(resolve(process.env.TIE_CREDENTIALS||'data/production-setup.json'),'utf8'));
const modulePath=process.env.PLAYWRIGHT_MODULE_PATH||'/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const {chromium}=await import(pathToFileURL(modulePath));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const out=resolve('test-results/live');mkdirSync(out,{recursive:true});
const report={origin,timestamp:new Date().toISOString(),checks:[],errors:[]};
try{
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
 page.on('pageerror',error=>report.errors.push(error.message));
 const failures=[];page.on('response',response=>{if(response.status()>=400&&!response.url().endsWith('/api/state'))failures.push({url:response.url(),status:response.status()})});
 const response=await page.goto(origin,{waitUntil:'networkidle'});assert.equal(response.status(),200);report.tls=await response.securityDetails();assert(report.tls?.issuer);
 await page.getByRole('button',{name:'Войти',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Почта').fill(credentials.email);await dialog.getByLabel('Пароль').fill(credentials.password);await dialog.getByRole('button',{name:'Войти',exact:true}).click();
 await page.locator('.app-shell').waitFor();await page.getByRole('heading',{name:/Здравствуйте/}).waitFor();
 const session=(await context.cookies()).find(cookie=>cookie.name==='tie_session');assert(session?.secure&&session?.httpOnly);report.checks.push('HTTPS certificate and secure HttpOnly session; administrator UI login');
 const state=await page.evaluate(()=>fetch('/api/state').then(response=>response.json()));assert.equal(state.user.protected,1);assert.equal(state.projects.length,0);report.checks.push('Protected administrator and clean working database without demo projects');
 await page.screenshot({path:resolve(out,'dashboard-desktop.png'),fullPage:true});
 for(const path of ['/app/calendar','/app/tasks','/app/public-site','/app']){await page.goto(origin+path,{waitUntil:'networkidle'});await page.locator('.app-shell').waitFor();assert.equal(await page.locator('body').evaluate(body=>body.scrollWidth>innerWidth),false);}
 report.checks.push('Authenticated routes and desktop overflow');
 await page.setViewportSize({width:390,height:844});await page.goto(origin+'/app',{waitUntil:'networkidle'});await page.locator('.app-shell').waitFor();assert.equal(await page.locator('body').evaluate(body=>body.scrollWidth>innerWidth),false);await page.screenshot({path:resolve(out,'dashboard-mobile.png'),fullPage:true});report.checks.push('390px mobile authenticated dashboard');
 assert.deepEqual(report.errors,[]);assert.deepEqual(failures,[]);report.passed=true;
 console.log(JSON.stringify({passed:true,checks:report.checks},null,2));
} catch(error){report.passed=false;report.errors.push(error.message);throw error}finally{writeFileSync(resolve(out,'verification.json'),JSON.stringify(report,null,2));await browser.close()}
