import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createHttpServer } from '../server/http.mjs';
import { entity, entities, insert } from '../server/db.mjs';
import { bootstrap, execute, register } from '../server/service.mjs';

const chromePath=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const playwrightPath=process.env.PLAYWRIGHT_MODULE_PATH||'/Users/cabinpxrn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
async function loadPlaywright(){try{return await import('playwright')}catch{return import(pathToFileURL(playwrightPath))}}
const {chromium}=await loadPlaywright();
const out=resolve('test-results/v2'); mkdirSync(out,{recursive:true});
const temp=mkdtempSync(join(tmpdir(),'tie-v2-browser-'));
const dbPath=join(temp,'v2.sqlite'),dist=resolve('dist');
assert(existsSync(join(dist,'index.html')),'Сначала соберите клиент: npm run build');
const server=createHttpServer({dbPath,distDir:dist});
await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
const origin=`http://127.0.0.1:${server.address().port}`;
const db=server.db, checks=[],failures=[],browserErrors=[];
const command=(user,op,body={})=>execute(db,user,{id:randomUUID(),op,...body});
const check=async(name,work)=>{try{const detail=await work();checks.push({name,ok:true,...(detail===undefined?{}:{detail})})}catch(error){checks.push({name,ok:false,error:error.message,details:error.details});failures.push({name,error:error.message,details:error.details})}};
const current=(id)=>entity(db,id);
const sleep=ms=>new Promise(resolveSleep=>setTimeout(resolveSleep,ms));
let browser,staffContext,guestContext,phoneContext,seatingPhoneContext;

function rsvpMap(){return {guestName:'name',rsvpStatus:'status',diet:'meal',allergies:'allergies',transfer:'transport',accommodation:'hotel',contact:'contact',comment:'note',seatingTable:'seat_table',seatIndex:'seat_index',rsvpValues:{unanswered:'Не отправлено',confirmed:'Подтвердил',declined:'Отказ',tentative:'Приглашён'}}}
function guestData(index,{status='Не отправлено'}={}){return {name:`QA гость ${index}`,status,meal:'',allergies:'',transport:'',hotel:'',contact:'',note:'',seat_table:null,seat_index:null}}
async function api(page,path,body){return page.evaluate(async({path,body})=>{const csrf=document.cookie.split('; ').find(x=>x.startsWith('tie_csrf='))?.slice('tie_csrf='.length)||'';const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(body)});const data=await response.json();return {status:response.status,data}},{path,body})}
async function loginStaff(page,email,password){await page.goto(origin,{waitUntil:'networkidle'});const result=await api(page,'/api/login',{slug:'tie',email,password});assert.equal(result.status,200,result.data.error)}

try {
  const {user:admin}=bootstrap(db,{slug:'tie',agencyName:'V2 browser QA',name:'QA организатор',email:'qa-admin@example.test',password:'qa-admin-password'});
  const project=command(admin,'project.create',{data:{name:'QA пара',date:'2027-08-14',location:'Москва'}});
  let guests=entities(db,admin.agency_id,project.id,'table').find(row=>row.data.key==='guests');
  guests=command(admin,'entity.edit',{projectId:project.id,entityId:guests.id,version:guests.version,data:{...guests.data,columns:[...guests.data.columns,{id:'allergies',name:'Аллергии',type:'text'},{id:'seat_table',name:'Стол ID',type:'relation',targetKind:'seatingTable'},{id:'seat_index',name:'Место',type:'number'}],confirmStructure:true}});
  const primary=command(admin,'entity.create',{projectId:project.id,kind:'row',parentId:guests.id,schemaVersion:guests.version,data:guestData(1)});
  const second=command(admin,'entity.create',{projectId:project.id,kind:'row',parentId:guests.id,schemaVersion:guests.version,data:guestData(2)});
  guests=command(admin,'guestMapping.save',{projectId:project.id,guestTableId:guests.id,schemaVersion:guests.version,data:{semanticMap:rsvpMap()},confirm:true});
  let site=command(admin,'microsite.saveDraft',{projectId:project.id,data:{rsvpDeadline:'2099-08-10',draft:{coupleNames:'QA пара',title:'Приглашение QA',intro:'Только для приглашённой семьи',dateLabel:'14 августа 2027',mealEnabled:true,transportEnabled:true}}});
  site=command(admin,'microsite.publish',{projectId:project.id,version:site.version});
  const invitation=command(admin,'guestInvite.create',{projectId:project.id,guestTableId:guests.id,schemaVersion:guests.version,guestRowIds:[primary.id],expiresAt:new Date(Date.now()+86400000).toISOString()});

  const plan=command(admin,'seatingPlan.save',{projectId:project.id,data:{name:'QA зал',widthM:12,heightM:8,guestTableId:guests.id}});
  const table=command(admin,'seatingTable.create',{projectId:project.id,planId:plan.id,planVersion:plan.version,data:{label:'QA стол',shape:'round',xM:1,yM:1,widthM:1.6,heightM:1.6,capacity:4}});
  const secondTable=command(admin,'seatingTable.create',{projectId:project.id,planId:plan.id,planVersion:plan.version,data:{label:'QA стол 2',shape:'rect',xM:4,yM:1,widthM:1.8,heightM:1.2,capacity:4}});
  const firstConfirmed=command(admin,'guest.rsvp.set',{projectId:project.id,guestTableId:guests.id,schemaVersion:guests.version,guestRowId:second.id,rowVersion:second.version,data:{values:{rsvp:'confirmed'}}});
  const thirdDraft=command(admin,'entity.create',{projectId:project.id,kind:'row',parentId:guests.id,schemaVersion:guests.version,data:guestData(3)});
  const third=command(admin,'guest.rsvp.set',{projectId:project.id,guestTableId:guests.id,schemaVersion:guests.version,guestRowId:thirdDraft.id,rowVersion:thirdDraft.version,data:{values:{rsvp:'confirmed'}}});
  await check('competing seat assignments preserve one owner',async()=>{
    const a=command(admin,'guest.row.edit',{projectId:project.id,guestTableId:guests.id,guestRowId:firstConfirmed.id,rowVersion:firstConfirmed.version,schemaVersion:guests.version,tableVersion:table.version,data:{seat_table:table.id,seat_index:1}});
    assert.equal(a.data.seat_table,table.id);
    assert.throws(()=>command(admin,'guest.row.edit',{projectId:project.id,guestTableId:guests.id,guestRowId:third.id,rowVersion:third.version,schemaVersion:guests.version,tableVersion:table.version,data:{seat_table:table.id,seat_index:1}}),error=>error?.status===409);
    assert.equal(current(third.id).data.seat_table,null);
  });

  const one=register(db,{slug:'tie',name:'QA согласующий 1',email:'qa-one@example.test',password:'qa-one-password'}).user;
  const two=register(db,{slug:'tie',name:'QA согласующий 2',email:'qa-two@example.test',password:'qa-two-password'}).user;
  const coupleRole=db.prepare("SELECT id FROM roles WHERE agency_id=? AND key='couple'").get(admin.agency_id);
  for(const person of [one,two]){const version=db.prepare('SELECT version FROM users WHERE id=?').get(person.id).version;command(admin,'grants.save',{userId:person.id,version,disabled:false,grants:[{roleId:coupleRole.id,projectId:project.id,restrictions:{}}]})}
  await check('two approvers vote concurrently once and create no payment',async()=>{
    const approval=command(admin,'approval.saveDraft',{projectId:project.id,data:{title:'QA выбор',category:'other',draft:'Проверка конкуренции',approverUserIds:[one.id,two.id],policy:'all',options:[{id:'qa_option',title:'Вариант QA',price:1000}]}});
    const published=command(admin,'approval.publish',{projectId:project.id,entityId:approval.id,version:approval.version});
    await Promise.all([Promise.resolve().then(()=>command(one,'approval.vote',{projectId:project.id,entityId:published.approval.id,revisionId:published.revision.id,decision:'approve',optionId:'qa_option'})),Promise.resolve().then(()=>command(two,'approval.vote',{projectId:project.id,entityId:published.approval.id,revisionId:published.revision.id,decision:'approve',optionId:'qa_option'}))]);
    command(one,'approval.vote',{projectId:project.id,entityId:published.approval.id,revisionId:published.revision.id,decision:'approve',optionId:'qa_option'});
    assert.equal(db.prepare('SELECT count(*) AS n FROM approval_votes WHERE revision_id=?').get(published.revision.id).n,2);
    assert.equal(current(published.approval.id).data.state,'approved');
    assert.equal(entities(db,admin.agency_id,project.id,'movement').length,0);
  });

  // Temporary stress fixture: typed list APIs are paginated; shared table/canvas use the V1 guest registry snapshot.
  for(let i=4;i<=500;i++) insert(db,admin,'row',guestData(i),project.id,guests.id);
  for(let i=2;i<=59;i++) insert(db,admin,'seatingTable',{label:`Нагрузочный стол ${i}`,shape:'round',xM:((i-2)%10)+.1,yM:Math.floor((i-2)/10)+.1,widthM:.7,heightM:.7,rotationDeg:0,capacity:4},project.id,plan.id);
  for(let i=1;i<=300;i++) insert(db,admin,'task',{title:`Нагрузочная задача ${i}`,description:'',phaseKey:'qa',status:'todo',assigneeUserId:null,participantUserIds:[],dueMode:'fixed',fixedDate:'2027-08-14',offsetDays:null,dueDate:'2027-08-14',dependencyIds:[],priority:'normal',approvalId:null,selectionId:null,fileIds:[],skipReason:'',order:i},project.id);
  for(let i=1;i<=100;i++) insert(db,admin,'approval',{title:`Нагрузочное согласование ${i}`,state:'draft',options:[],approverUserIds:[],policy:'any',currentRevisionId:null,outcomeOptionId:null,discussion:false},project.id);

  browser=await chromium.launch({executablePath:chromePath,headless:true});
  staffContext=await browser.newContext({viewport:{width:1440,height:900}}); const staff=await staffContext.newPage();
  await staffContext.addInitScript(()=>{window.print=()=>{}});
  await loginStaff(staff,'qa-admin@example.test','qa-admin-password');
  guestContext=await browser.newContext({viewport:{width:1440,height:900}}); const guest=await guestContext.newPage();
  phoneContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true}); const phone=await phoneContext.newPage();
  for(const page of [staff,guest,phone]){page.on('pageerror',error=>browserErrors.push({type:'pageerror',message:error.message}));page.on('console',message=>{if(message.type()==='error')browserErrors.push({type:'console',message:message.text()})})}
  const commandPayloads=[];staff.on('request',request=>{if(request.url().includes('/api/command')&&request.method()==='POST'){try{commandPayloads.push(JSON.parse(request.postData()||'{}'))}catch{}}});

  await check('seating UI assigns, persists, unassigns, and generic table re-seats with a target version',async()=>{
    await staff.goto(`${origin}/app/projects/${project.id}/seating`,{waitUntil:'networkidle'});
    await staff.getByRole('heading',{name:'QA зал'}).waitFor();
    const seatButtons=staff.locator('.v2-seat-table'); const seatLabels=await seatButtons.evaluateAll(items=>items.map(item=>item.innerText));
    const tableIndex=seatLabels.findIndex(label=>label.split('\n')[0]==='QA стол'); assert(tableIndex>=0,`QA table is missing: ${seatLabels.join(' | ')}`);
    const tableButton=seatButtons.nth(tableIndex);
    await tableButton.focus(); await staff.keyboard.press('Enter');
    await staff.getByRole('heading',{name:'Свойства стола'}).waitFor();
    const thirdCard=staff.locator('.v2-seat-guest').filter({hasText:/QA гость 3(?!\d)/}).first();
    await thirdCard.getByLabel('Место').fill('2'); await thirdCard.getByRole('button',{name:'Посадить'}).click();
    await staff.locator('.v2-seat-guest').filter({hasText:/QA гость 3(?!\d)/}).getByRole('button',{name:'Убрать с места'}).waitFor();
    assert.equal(current(third.id).data.seat_table,table.id); assert.equal(current(third.id).data.seat_index,2);
    await staff.reload({waitUntil:'networkidle'});
    const seated=staff.locator('.v2-seat-guest').filter({hasText:/QA гость 3(?!\d)/}).getByRole('button',{name:'Убрать с места'});
    await seated.click(); await staff.locator('.v2-seat-guest').filter({hasText:/QA гость 3(?!\d)/}).getByRole('button',{name:'Посадить'}).waitFor();
    assert.equal(current(third.id).data.seat_table,''); assert.equal(current(third.id).data.seat_index,'');
    await staff.goto(`${origin}/app/projects/${project.id}/tables/${guests.id}`,{waitUntil:'networkidle'});
    const tableRows=staff.locator('tbody tr'),rowIndex=await tableRows.evaluateAll(items=>items.findIndex(item=>/QA гость 3(?!\d)/.test(item.innerText))); assert(rowIndex>=0,'QA guest 3 is missing from the generic table');
    const row=tableRows.nth(rowIndex); await row.getByRole('button',{name:'Изменить'}).click();
    await row.getByLabel('Стол ID').selectOption(secondTable.id); await row.getByLabel('Место').fill('2');
    const from=commandPayloads.length; await row.getByRole('button',{name:'Сохранить'}).click();
    await row.getByRole('button',{name:'Изменить'}).waitFor();
    const rowEdit=commandPayloads.slice(from).find(payload=>payload.op==='guest.row.edit');
    assert(rowEdit,'UI must issue the guarded guest-row edit command');
    assert.equal(rowEdit.tableVersion,secondTable.version); assert.equal(rowEdit.data.seat_table,secondTable.id); assert.equal(rowEdit.data.seat_index,2);
    assert.equal(current(third.id).data.seat_table,secondTable.id); assert.equal(current(third.id).data.seat_index,2);
    await staff.goto(`${origin}/app/projects/${project.id}/seating`,{waitUntil:'networkidle'});
    await staff.getByRole('heading',{name:'QA зал'}).waitFor();
    await staff.screenshot({path:join(out,'seating-desktop-1440.png'),fullPage:false});
    seatingPhoneContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true}); const seatingPhone=await seatingPhoneContext.newPage();
    await loginStaff(seatingPhone,'qa-admin@example.test','qa-admin-password');
    seatingPhone.on('pageerror',error=>browserErrors.push({type:'pageerror',message:error.message}));seatingPhone.on('console',message=>{if(message.type()==='error')browserErrors.push({type:'console',message:message.text()})});
    await seatingPhone.goto(`${origin}/app/projects/${project.id}/seating`,{waitUntil:'networkidle'}); await seatingPhone.getByRole('heading',{name:'QA зал'}).waitFor();
    await seatingPhone.screenshot({path:join(out,'seating-mobile-390.png'),fullPage:false});
  });
  await check('seating print popup has a repeating name-only list and exports PDF',async()=>{
    await staff.goto(`${origin}/app/projects/${project.id}/seating`,{waitUntil:'networkidle'}); await staff.getByRole('heading',{name:'QA зал'}).waitFor();
    const format=staff.getByLabel('Формат печати'); assert.equal(await format.locator('option').count(),2); await format.selectOption('A4');
    const printButton=staff.getByRole('button',{name:'Печать A4/A3'}); assert.equal(await printButton.count(),1,`Seating print UI unavailable at ${staff.url()}`);
    const popupPromise=staffContext.waitForEvent('page'); await printButton.click(); const popup=await popupPromise;
    await popup.waitForLoadState('domcontentloaded'); const html=await popup.content();
    assert.match(html,/@page\{size:A4 landscape(?:;[^}]*)?\}/); assert.match(html,/<thead[^>]*style="display:table-header-group"/); assert.match(html,/>Гость</); assert.match(html,/Версия/); assert.doesNotMatch(html,/Контакт/);
    await popup.emulateMedia({media:'print'}); await popup.pdf({path:join(out,'seating-print.pdf'),format:'A4',landscape:true,printBackground:true});
    await popup.screenshot({path:join(out,'seating-print-page-1.png'),fullPage:false}); await popup.close();
  });
  await check('project routes survive browser back and forward',async()=>{
    await staff.goto(`${origin}/app/projects/${project.id}/seating`,{waitUntil:'networkidle'}); await staff.getByRole('heading',{name:'QA зал'}).waitFor();
    await staff.goto(`${origin}/app/projects/${project.id}/guests`,{waitUntil:'networkidle'}); await staff.getByRole('heading',{name:'Гости'}).waitFor();
    await staff.goBack({waitUntil:'networkidle'}); await staff.getByRole('heading',{name:'QA зал'}).waitFor();
    await staff.goForward({waitUntil:'networkidle'}); await staff.getByRole('heading',{name:'Гости'}).waitFor();
  });
  await check('modal keeps keyboard focus contained and restores it on Escape',async()=>{
    await staff.goto(`${origin}/app/projects/${project.id}/calendar`,{waitUntil:'networkidle'}); const trigger=staff.getByRole('button',{name:'+ Встреча'}); await trigger.click();
    const dialog=staff.getByRole('dialog',{name:/встречу/}); await sleep(150); assert.equal(await dialog.count(),1,(await staff.locator('body').innerText()).slice(0,1000)); assert.equal(await staff.locator('.app-shell').evaluate(node=>node.inert),true);
    await staff.keyboard.press('Tab'); assert.equal(await dialog.evaluate((node)=>node.contains(document.activeElement)),true);
    await staff.keyboard.press('Escape'); await assert.rejects(dialog.waitFor({state:'visible',timeout:300}),/Timeout/); assert.equal(await trigger.evaluate(node=>document.activeElement===node),true);
  });

  const requested=[];guest.on('request',request=>requested.push(request.url()));
  await check('public RSVP opens from fragment, removes token, and does not load staff state',async()=>{
    await guest.goto(`${origin}/w/${site.data.shareId}#invite=${invitation.token}`,{waitUntil:'networkidle'});
    await guest.getByRole('heading',{name:'Ваш ответ на приглашение'}).waitFor();
    assert.equal(new URL(guest.url()).hash,'');
    const body=await guest.locator('body').innerText(); assert.match(body,/QA гость 1/); assert.doesNotMatch(body,/QA гость 500/);
    assert.equal(requested.some(url=>url.includes('/api/state')),false);
    await guest.screenshot({path:join(out,'public-desktop.png'),fullPage:true});
    await phone.goto(`${origin}/w/${site.data.shareId}#invite=${invitation.token}`,{waitUntil:'networkidle'});
    await phone.getByRole('heading',{name:'Ваш ответ на приглашение'}).waitFor(); await phone.screenshot({path:join(out,'public-mobile-390.png'),fullPage:true});
  });
  await check('public UI saves an RSVP and shows it after reload',async()=>{
    const card=guest.locator('.v2-rsvp fieldset').first(); await card.locator('select').selectOption('confirmed');
    await guest.getByRole('button',{name:'Отправить ответ'}).click(); await guest.getByText('Ответ сохранён',{exact:true}).waitFor();
    await guest.reload({waitUntil:'networkidle'}); await guest.getByRole('heading',{name:'Ваш ответ на приглашение'}).waitFor();
    assert.equal(await guest.locator('.v2-rsvp fieldset').first().locator('select').inputValue(),'confirmed');
  });
  await check('stale public RSVP returns 409 and cannot overwrite organizer change',async()=>{
    const stale=await guest.evaluate(()=>fetch(`/api/public/rsvp/context?shareId=${encodeURIComponent(location.pathname.split('/').pop())}`).then(response=>response.json()));
    const live=current(primary.id); const organizer=await api(staff,'/api/command',{id:randomUUID(),op:'guest.rsvp.set',projectId:project.id,guestTableId:guests.id,schemaVersion:guests.version,guestRowId:primary.id,rowVersion:live.version,data:{values:{rsvp:'tentative'}}}); assert.equal(organizer.status,200,organizer.data.error);
    const rejected=await guest.evaluate(async stale=>{const csrf=document.cookie.split('; ').find(x=>x.startsWith('tie_guest_csrf='))?.slice('tie_guest_csrf='.length)||'';const response=await fetch('/api/public/rsvp/respond',{method:'POST',headers:{'content-type':'application/json','x-guest-csrf-token':csrf},body:JSON.stringify({shareId:location.pathname.split('/').pop(),commandId:'stale_public_command',inviteVersion:stale.inviteVersion,schemaVersion:stale.schemaVersion,changes:[{rowId:stale.guests[0].id,rowVersion:stale.guests[0].version,values:{rsvp:'declined'}}]})});return {status:response.status,body:await response.json()}},stale);
    assert.equal(rejected.status,409); assert.equal(current(primary.id).data.status,'Приглашён');
  });
  await check('published display switches hide disabled guest fields',async()=>{
    site=current(site.id); site=command(admin,'microsite.saveDraft',{projectId:project.id,version:site.version,data:{draft:{...site.data.draft,mealEnabled:false,transportEnabled:false}}}); site=command(admin,'microsite.publish',{projectId:project.id,version:site.version});
    await guest.reload({waitUntil:'networkidle'}); await guest.getByRole('heading',{name:'Ваш ответ на приглашение'}).waitFor();
    const text=await guest.locator('.v2-rsvp').innerText(); assert.doesNotMatch(text,/Питание|Аллергии|Трансфер/);
  });
  await check('rotated invite rejects the old guest session',async()=>{
    const old=db.prepare('SELECT * FROM guest_invites WHERE id=?').get(invitation.inviteId); const rotated=command(admin,'guestInvite.rotate',{projectId:project.id,inviteId:old.id,version:old.version,schemaVersion:guests.version,expiresAt:new Date(Date.now()+86400000).toISOString()}); assert.equal(typeof rotated.token,'string');
    await guest.reload({waitUntil:'networkidle'}); await sleep(100); assert.notEqual(await guest.getByRole('heading',{name:'Ваш ответ на приглашение'}).count(),1);
  });
  await check('large list reads are paginated and record actual latency',async()=>{
    const read=async path=>{const start=performance.now();const result=await staff.evaluate(async path=>{const response=await fetch(path);return {status:response.status,data:await response.json()}},path);return {...result,elapsedMs:Number((performance.now()-start).toFixed(2))}};
    const [guestPage,approvalPage,taskPage]=await Promise.all([read(`/api/v2/guests?projectId=${project.id}&guestTableId=${guests.id}&limit=50`),read(`/api/v2/workflow/approvals?projectId=${project.id}&limit=50`),read(`/api/v2/workflow/tasks?projectId=${project.id}&limit=50`)]);
    for(const result of [guestPage,approvalPage,taskPage]) assert.equal(result.status,200,JSON.stringify(result.data));
    assert(guestPage.data.items.length<=50); assert(approvalPage.data.items.length<=50); assert(taskPage.data.items.length<=50);
    return {guests:guestPage.elapsedMs,approvals:approvalPage.elapsedMs,tasks:taskPage.elapsedMs,guestTotal:guestPage.data.total,approvalTotal:approvalPage.data.total,taskTotal:taskPage.data.total};
  });
} catch(error) {
  failures.push({name:'fixture or browser setup',error:error.message,stack:error.stack});
} finally {
  if(seatingPhoneContext) await seatingPhoneContext.close(); if(guestContext) await guestContext.close(); if(phoneContext) await phoneContext.close(); if(staffContext) await staffContext.close(); if(browser) await browser.close();
  await new Promise(resolveClose=>server.close(resolveClose));
}

// The stale-write and rotated-session assertions intentionally exercise these
// HTTP failures through the browser UI. Other browser errors still fail QA.
const isExpectedBrowserStatus=error=>['status of 409 (Conflict)','status of 403 (Forbidden)'].some(expected=>error.message.includes(expected));
const expectedBrowserErrors=browserErrors.filter(isExpectedBrowserStatus);
const unexpectedBrowserErrors=browserErrors.filter(error=>!isExpectedBrowserStatus(error));
for(const error of unexpectedBrowserErrors) failures.push({name:'browser console',...error});
const report={origin,temp,checks,failures,expectedBrowserErrors,unexpectedBrowserErrors,createdAt:new Date().toISOString()};
writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2));
writeFileSync(join(out,'errors.json'),JSON.stringify({failures,unexpectedBrowserErrors},null,2));
if(failures.length){console.error(`V2 browser QA failed: ${failures.map(item=>item.name).join(', ')}`);process.exitCode=1}else console.log('V2 browser QA passed');
