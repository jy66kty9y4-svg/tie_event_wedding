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
 const state=await page.evaluate(()=>fetch('/api/state').then(response=>response.json()));assert.equal(state.user.protected,1);report.projectCount=state.projects.length;report.checks.push('Protected administrator; existing projects retained, verification creates no business data');
 assert.equal(await page.getByLabel('Ссылка на форму заявки').inputValue(),origin+'/app?application=1');
 await page.screenshot({path:resolve(out,'dashboard-desktop.png'),fullPage:true});
 for(const path of ['/app/calendar','/app/tasks','/app/public-site','/app']){await page.goto(origin+path,{waitUntil:'networkidle'});await page.locator('.app-shell').waitFor();assert.equal(await page.locator('body').evaluate(body=>body.scrollWidth>innerWidth),false);}
 report.checks.push('Authenticated routes and desktop overflow');
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:900});await page.goto(origin+'/app/today',{waitUntil:'networkidle'});await page.getByRole('heading',{name:/Здравствуйте/}).waitFor();assert.equal(await page.locator('.page-header h1').evaluate(e=>getComputedStyle(e).fontSize),width===1440?'36px':'29px');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:resolve(out,`dashboard-${width}.png`),fullPage:true});
  const project=state.projects[0];if(project)for(const route of ['overview','tasks','approvals','seating']){
   await page.goto(`${origin}/app/projects/${project.id}/${route}`,{waitUntil:'networkidle'});await page.locator('.v2-project-tabs').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const geometry=await page.evaluate(()=>({tab:document.querySelector('.v2-project-tabs').getBoundingClientRect().x,head:document.querySelector('.v2-workflow-header,.v2-seat>header,.v2-metrics')?.getBoundingClientRect().x,font:getComputedStyle(document.querySelector('.v2-project-header h1')).fontSize}));assert(Math.abs(geometry.tab-geometry.head)<2);assert.equal(geometry.font,width===1440?'29px':'26px');
   if(['tasks','approvals'].includes(route)){const button=page.getByRole('button',{name:route==='tasks'?'+ Задача':'+ Согласование',exact:true});assert.equal(await button.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(173, 78, 108)');await button.click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});}
   await page.screenshot({path:resolve(out,`${route}-${width}.png`),fullPage:true});
  }
 }
 report.checks.push('1440/390/320px dashboards and existing project routes; typography, alignment, primary colors and modal opening without saving');
 assert.deepEqual(report.errors,[]);assert.deepEqual(failures,[]);report.passed=true;
 console.log(JSON.stringify({passed:true,checks:report.checks},null,2));
} catch(error){report.passed=false;report.errors.push(error.message);throw error}finally{writeFileSync(resolve(out,'verification.json'),JSON.stringify(report,null,2));await browser.close()}
