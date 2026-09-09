import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHttpServer} from '../server/http.mjs';
import {bootstrap,execute} from '../server/service.mjs';
import {entities,entity,uid} from '../server/db.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH||'/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const temp=mkdtempSync(join(tmpdir(),'tie-visual-')),out=resolve('test-results/visual-review');mkdirSync(out,{recursive:true});
const server=createHttpServer({dbPath:join(temp,'test.sqlite'),distDir:resolve('dist')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`,db=server.db,{user}=bootstrap(db,{slug:'tie',agencyName:'tie · визуальная проверка',name:'Мария',email:'visual@example.test',password:'visual-test-password'}),cmd=(op,body={})=>execute(db,user,{id:uid(),op,...body});
const empty=cmd('project.create',{data:{name:'Новая свадьба',date:'2027-06-12',location:'Москва'}}),filled=cmd('project.create',{data:{name:'Анна и Михаил',date:'2027-06-19',location:'Москва'}});
for(const [title,offset] of [['Обсудить концепцию',-60],['Утвердить меню',-30],['Проверить тайминг',-7]])cmd('task.create',{projectId:filled.id,data:{title,dueMode:'relative',offsetDays:offset,assigneeUserId:user.id}});
for(const title of ['Оформление церемонии','Меню свадебного ужина'])cmd('approval.saveDraft',{projectId:filled.id,data:{title,category:'other',approverUserIds:[user.id],policy:'any',options:[{id:uid(),title:'Основной вариант',price:120000},{id:uid(),title:'Альтернатива',price:90000}]}});
const day=new Intl.DateTimeFormat('sv-SE').format(new Date());
for(const [title,time] of [['Знакомство с парой','10:00'],['Обсуждение площадки','14:00']])cmd('meeting.save',{projectId:filled.id,data:{title,startDate:day,startTime:time,endDate:day,endTime:time.slice(0,2)+':45',timeZone:'Europe/Moscow',assignedUserIds:[user.id],participantUserIds:[],location:'Онлайн'}});
let guests=entities(db,user.agency_id,filled.id,'table').find(t=>t.data.key==='guests');
guests=cmd('entity.edit',{projectId:filled.id,entityId:guests.id,version:guests.version,data:{...guests.data,columns:[...guests.data.columns,{id:'seat_table',name:'Стол рассадки',type:'relation',targetKind:'seatingTable'},{id:'seat_index',name:'Место',type:'number'}]}});
guests=cmd('guestMapping.save',{projectId:filled.id,guestTableId:guests.id,schemaVersion:guests.version,confirm:true,data:{semanticMap:{guestName:'name',rsvpStatus:'status',seatingTable:'seat_table',seatIndex:'seat_index'}}});
const plan=cmd('seatingPlan.save',{projectId:filled.id,data:{name:'План зала',widthM:12,heightM:8,guestTableId:guests.id,zones:[{label:'Танцпол',xM:4,yM:3,widthM:4,heightM:2}]}});
const tables=[];for(let i=0;i<4;i++)tables.push(cmd('seatingTable.create',{projectId:filled.id,planId:plan.id,planVersion:plan.version,data:{label:`Стол ${i+1}`,shape:'round',xM:1+(i%2)*8,yM:1+Math.floor(i/2)*4,widthM:1.6,heightM:1.6,capacity:8}}));
for(const [index,name] of ['Ольга Александровна','Михаил Иванов','София Петрова','Александр Смирнов'].entries()){const initial=cmd('entity.create',{projectId:filled.id,kind:'row',parentId:guests.id,schemaVersion:guests.version,data:{name,status:'Не отправлено'}});const row=cmd('guest.rsvp.set',{projectId:filled.id,guestTableId:guests.id,schemaVersion:guests.version,guestRowId:initial.id,rowVersion:initial.version,data:{values:{rsvp:'confirmed'}}});if(index<2)cmd('seating.assign',{projectId:filled.id,guestTableId:guests.id,schemaVersion:guests.version,guestRowId:row.id,rowVersion:row.version,tableId:tables[0].id,tableVersion:tables[0].version,seatIndex:index+1});}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),context=await browser.newContext(),page=await context.newPage(),report={timestamp:new Date().toISOString(),screens:[],checks:[],errors:[]};
try{
 await page.goto(origin,{waitUntil:'networkidle'});await page.evaluate(async()=>{const csrf=document.cookie.split('; ').find(v=>v.startsWith('tie_csrf=')).split('=')[1];const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({slug:'tie',email:'visual@example.test',password:'visual-test-password'})});if(!r.ok)throw Error('Login failed')});
 page.on('pageerror',e=>report.errors.push(e.message));
 for(const width of [1440,390,320,1710]){
  await page.setViewportSize({width,height:900});
  await page.goto(origin+'/app/today',{waitUntil:'networkidle'});await page.getByRole('heading',{name:/Здравствуйте/}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Форма заявки',exact:true}).count(),1);
  assert.equal(await page.getByLabel('Ссылка на форму заявки').inputValue(),origin+'/app?application=1');
  const agencyFont=await page.locator('.page-header h1').evaluate(e=>getComputedStyle(e).fontSize);assert.equal(agencyFont,width<768?'29px':'36px');
  await page.screenshot({path:join(out,`today-${width}.png`),fullPage:true});
  for(const [kind,project] of [['empty',empty],['filled',filled]])for(const route of ['overview','tasks','approvals','seating']){
   await page.goto(`${origin}/app/projects/${project.id}/${route}`,{waitUntil:'networkidle'});await page.locator('.v2-project-tabs').waitFor();
   const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,tabX:document.querySelector('.v2-project-tabs').getBoundingClientRect().x,headX:document.querySelector('.v2-workflow-header,.v2-seat>header,.v2-metrics')?.getBoundingClientRect().x,projectFont:getComputedStyle(document.querySelector('.v2-project-header h1')).fontSize}));
   assert.equal(geometry.overflow,false,`${kind}/${route}/${width} overflow`);assert(Math.abs(geometry.tabX-geometry.headX)<2,JSON.stringify({kind,route,width,geometry}));assert.equal(geometry.projectFont,width<768?'26px':'29px');
   if(['tasks','approvals'].includes(route)){
    const button=page.getByRole('button',{name:route==='tasks'?'+ Задача':'+ Согласование',exact:true});const style=await button.evaluate(e=>({background:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color,height:e.getBoundingClientRect().height}));assert.equal(style.background,'rgb(173, 78, 108)');assert.equal(style.color,'rgb(255, 255, 255)');assert(style.height>=40);
    await button.click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
   }
   const file=`${kind}-${route}-${width}.png`;await page.screenshot({path:join(out,file),fullPage:true});report.screens.push({kind,route,width,file,geometry});
  }
 }
 report.checks.push('Rose primary buttons: computed background/text, desktop/mobile click opens modal','Shared left edge at 1440/1710/390/320; typography 36/29 and 29/26','Empty and filled overview/task/approval/seating screenshots; no page overflow');
 await page.setViewportSize({width:390,height:844});await page.goto(`${origin}/app/projects/${empty.id}/seating`,{waitUntil:'networkidle'});await page.getByRole('button',{name:'Настроить список гостей'}).click();await page.getByRole('button',{name:'Подключить стандартные поля'}).click();await page.getByRole('button',{name:'Создать план зала'}).waitFor();
 await page.getByRole('button',{name:'Создать план зала'}).click();await page.getByRole('heading',{name:'План зала',exact:true}).waitFor();await page.reload({waitUntil:'networkidle'});await page.getByRole('heading',{name:'План зала',exact:true}).waitFor();assert.equal(entities(db,user.agency_id,empty.id,'row').length,0);assert.equal(entities(db,user.agency_id,empty.id,'seatingPlan').length,1);report.checks.push('Standard guest mapping and plan creation through mobile UI, reload, no fabricated guest rows');
 const visitor=await browser.newContext(),publicPage=await visitor.newPage();await publicPage.goto(origin+'/app?application=1',{waitUntil:'networkidle'});await publicPage.getByRole('dialog').waitFor();assert.equal(await publicPage.getByLabel('Почта').count(),1);await visitor.close();report.checks.push('Shared application link opens real sign-in flow');
 const referencePath=join(temp,'prototype-reference.html');writeFileSync(referencePath,execFileSync('git',['show','c31662f:docs/v2/prototype.html']));report.prototypeRef='c31662f';
 const prototype=await context.newPage();await prototype.setViewportSize({width:1440,height:900});await prototype.goto(pathToFileURL(referencePath).href);await prototype.getByRole('heading',{name:'Здравствуйте, Мария!'}).waitFor();
 for(const route of ['today','overview','tasks','approvals','seating']){await prototype.evaluate(route=>navigate(route),route);await prototype.locator('#content h1').waitFor();await prototype.screenshot({path:join(out,`prototype-${route}-1440.png`),fullPage:true});}await prototype.close();
 assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({passed:true,screens:report.screens.length,checks:report.checks}));
}catch(error){report.passed=false;report.error=error.message;await page.screenshot({path:join(out,'failure.png'),fullPage:true}).catch(()=>{});throw error}finally{writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r))}
