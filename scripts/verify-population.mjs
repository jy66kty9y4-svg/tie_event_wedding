import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const m=JSON.parse(readFileSync(process.argv[2]||'data/population-live-20260911/manifest.json'));
const base=process.env.TIE_VERIFY_ORIGIN||m.origin,results=[];
const prefixes=process.env.TIE_VERIFY_PREFIXES?.split(',');
for(const a of m.accounts.filter(a=>!prefixes||prefixes.includes(a.email.split('@')[0]))){
 const init=await fetch(base+'/app'),csrf=init.headers.getSetCookie().find(c=>c.startsWith('tie_csrf=')).split(';')[0],token=csrf.slice('tie_csrf='.length);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Cookie:csrf,'X-CSRF-Token':token,Origin:base},body:JSON.stringify({slug:'tie',email:a.email,password:a.password})});assert.equal(login.status,200,a.name+' login');
 const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const get=async path=>{const r=await fetch(base+path,{headers:{Cookie:cookie}});assert.equal(r.status,200,a.name+' '+path);return r.json()};
 const s=await get('/api/state');assert.equal(s.user.id,a.userId);let rows=0,tasks=0;
 for(const p of a.projects){const state=await get('/api/state?project='+p);rows+=state.entities.filter(e=>e.kind==='row').length;const work=await get('/api/v2/workflow/tasks?projectId='+p);tasks+=work.items.length;if(a.role==='Подрядчик'){assert.equal(work.items.length,1);assert.equal(work.items[0].data.assigneeUserId,a.userId);assert(!state.entities.some(e=>['obligation','movement'].includes(e.kind)||e.kind==='table'&&e.data.key==='guests'));}}
 if(a.role==='Участник пары')assert.equal(s.projects.length,1);
 if(a.role==='Заявитель'){assert.equal(s.applications.length,1);assert.equal(s.projects.length,0);}
 if(a.role==='Финансовый менеджер')assert(s.global.some(e=>e.kind==='movement'));
 results.push({name:a.name,role:a.role,authenticated:true,projects:s.projects.length,rows,tasks});
 await fetch(base+'/api/logout',{method:'POST',headers:{Cookie:cookie,Origin:base,'X-CSRF-Token':token}});
}
for(const path of ['/','/stories','/services','/faq',...m.projects.map(p=>new URL(p.invitationUrl).pathname)]){const r=await fetch(base+path);assert.equal(r.status,200,path);const html=await r.text();assert(!/визуальная фикстура|тестовые данные|demo@example/i.test(html),path+' labels');}
const output='data/population-live-20260911/verification.json',previous=prefixes&&existsSync(output)?JSON.parse(readFileSync(output)).results:[],combined=[...previous.filter(r=>!results.some(n=>n.name===r.name)),...results];
writeFileSync(output,JSON.stringify({checkedAt:new Date().toISOString(),results:combined},null,2),{mode:0o600});
console.log(JSON.stringify({accounts:results.length,allLoginsPassed:true,cabinetIsolationPassed:true,publicPagesPassed:true}));
