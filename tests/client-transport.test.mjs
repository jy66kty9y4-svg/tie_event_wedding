import test from 'node:test';
import assert from 'node:assert/strict';

let sharedClient,sharedChannel;
async function fixture(t,{online=true,cookie='tie_csrf=unit%20csrf',storageError=false,worker}={}) {
  const saved=new Map(),events=[],values=new Map(),channels=[];
  const storage={getItem:key=>{if(storageError)throw new Error('blocked');return values.get(key)||null;},setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const window=new EventTarget();window.addEventListener('tie-client-data',event=>events.push(event.detail));
  for(const [key,value] of Object.entries({navigator:{onLine:online,...(worker?{serviceWorker:worker}:{})},document:{cookie},localStorage:storage,sessionStorage:storage,window,indexedDB:undefined,BroadcastChannel:class {constructor(name){this.name=name;channels.push(this);}addEventListener(name,listener){this.listener=listener;}postMessage(value){this.message=value;}}})) {
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  }
  t.after(()=>{for(const [key,descriptor] of saved)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
  if(!sharedClient){sharedClient=await import('../src/client.js');sharedChannel=channels[0];}
  else {channels.push(sharedChannel);sharedChannel.listener({data:{type:'identity'}});events.length=0;}
  const client=sharedClient;
  return {client,values,events,channels,window};
}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});

test('client API uses same-origin cookies and current CSRF, JSON encodes objects and preserves supplied headers',async t=>{
  const {client}=await fixture(t);let call;
  t.mock.method(globalThis,'fetch',async(path,options)=>{call={path,options};return json({ok:true});});
  assert.deepEqual(await client.api('/api/command',{method:'POST',body:{text:'Русский',amount:0},headers:{'X-Unit':'yes'}}),{ok:true});
  assert.equal(call.options.credentials,'same-origin');assert.equal(call.options.headers.get('X-CSRF-Token'),'unit csrf');assert.equal(call.options.headers.get('Content-Type'),'application/json');assert.equal(call.options.headers.get('X-Unit'),'yes');assert.deepEqual(JSON.parse(call.options.body),{text:'Русский',amount:0});
  await client.api('/api/state');assert.equal(call.options.headers.get('X-CSRF-Token'),null);
  await assert.rejects(client.api('https://other.test/api/state'),/локальные/);
});
test('client FormData uploads keep multipart encoding, while already encoded JSON remains unchanged',async t=>{
  const {client}=await fixture(t);let request;
  t.mock.method(globalThis,'fetch',async(_path,options)=>{request=options;return json({ok:true});});
  const body=new FormData();body.set('name','Unit');await client.api('/api/upload',{method:'POST',body});
  assert.equal(request.body,body);assert.equal(request.headers.get('Content-Type'),null);assert.equal(request.headers.get('X-CSRF-Token'),'unit csrf');
  await client.api('/api/command',{method:'POST',body:'{"zero":0}'});assert.equal(request.body,'{"zero":0}');
});
for(const status of [400,401,403,404,409,410,429,500,503])test(`client retains HTTP ${status} and conflict details instead of treating it as offline`,async t=>{
  const {client}=await fixture(t);t.mock.method(globalThis,'fetch',async()=>json({error:'Unit rejected',details:{current:{version:7}}},status));
  await assert.rejects(client.command({op:'unit.operation',id:'unit-id'}),e=>e.status===status&&e.message==='Unit rejected'&&e.details.current.version===7);
});
test('client reads plain responses and plain HTTP failures and tolerates an invalid CSRF cookie',async t=>{
  const {client}=await fixture(t,{cookie:'tie_csrf=%broken'});let token;
  t.mock.method(globalThis,'fetch',async(_path,options)=>{token=options.headers.get('X-CSRF-Token');return new Response('plain',{headers:{'content-type':'text/plain'}});});
  assert.equal(await client.api('/api/unit',{method:'POST',body:{}}),'plain');assert.equal(token,'');
  t.mock.method(globalThis,'fetch',async()=>new Response('Unavailable',{status:503}));
  await assert.rejects(client.api('/api/unit'),e=>e.status===503&&e.message==='HTTP 503');
});
test('commands receive a stable explicit ID or a new UUID, and missing actions never send a request',async t=>{
  const {client}=await fixture(t);const commands=[];t.mock.method(globalThis,'fetch',async(_path,options)=>{commands.push(JSON.parse(options.body));return json({ok:true});});
  await client.command({op:'unit.a'});await client.command({op:'unit.a'});await client.command({op:'unit.a',id:'fixed-id'});
  assert.match(commands[0].id,/^[0-9a-f-]{36}$/);assert.notEqual(commands[0].id,commands[1].id);assert.equal(commands[2].id,'fixed-id');
  await assert.rejects(client.command({}),/действие/);assert.equal(commands.length,3);
});
test('startup coalesces registration, sends no redundant dashboard request and retries after failure',async t=>{
  let calls=0;const worker={async register(path){calls++;assert.equal(path,'/sw.js');if(calls===1)throw new Error('worker failed');return {};}};
  const {client}=await fixture(t,{worker});t.mock.method(globalThis,'fetch',async()=>assert.fail('startup must not fetch the dashboard'));
  await assert.rejects(client.initClient(),/worker failed/);
  const first=client.initClient(),second=client.initClient();assert.equal(first,second);assert.deepEqual(await first,{online:true});assert.equal(calls,2);
});
test('offline startup can reuse the active worker',async t=>{
  const worker={controller:{},async register(){throw new Error('offline registration');}},a=await fixture(t,{online:false,worker});
  assert.deepEqual(await a.client.initClient(),{online:false});
});
test('offline startup cannot conceal a missing controller',async t=>{
  const worker={controller:null,async register(){throw new Error('offline registration');}},b=await fixture(t,{online:false,worker});
  await assert.rejects(b.client.initClient(),/offline registration/);
});
test('offline logout sets a tombstone, clears startup identity and prevents the next private request',async t=>{
  const {client,values,events}=await fixture(t,{online:false});t.mock.method(globalThis,'fetch',async()=>assert.fail('offline logout must not send'));
  assert.deepEqual(await client.logout(),{ok:true});assert.equal(values.get('tie:pending-server-logout'),'1');assert.equal(events.at(-1).type,'logout');
  await assert.rejects(client.api('/api/state'),e=>e.status===401);await assert.rejects(client.loadState('p'),e=>e.status===401);
});
test('a pending logout finishes before the next authenticated request and survives a failed server logout',async t=>{
  const {client,values}=await fixture(t,{cookie:''});values.set('tie:pending-server-logout','1');const paths=[];
  t.mock.method(globalThis,'fetch',async path=>{paths.push(path);if(path==='/api/logout')return json({error:'Try later'},503);return json({ok:true});});
  await assert.rejects(client.api('/api/state'),e=>e.status===503);assert.deepEqual(paths,['/api/public?agency=tie','/api/logout']);assert.equal(values.get('tie:pending-server-logout'),'1');
  paths.length=0;t.mock.method(globalThis,'fetch',async path=>{paths.push(path);return json({ok:true});});
  await client.api('/api/state');assert.deepEqual(paths,['/api/public?agency=tie','/api/logout','/api/state']);assert.equal(values.has('tie:pending-server-logout'),false);
});
test('browser subscriptions report changes and logout across tabs and remove every listener on disposal',async t=>{
  const {client,window,channels}=await fixture(t),received=[],stop=client.subscribe(detail=>received.push(detail));
  window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('offline'));channels[0].listener({data:{type:'identity',identity:'a:u'}});
  const storage=new Event('storage');Object.assign(storage,{key:'tie:pending-server-logout',newValue:'1'});window.dispatchEvent(storage);
  assert.deepEqual(received,[{type:'online'},{type:'offline'},{type:'identity',identity:'a:u'},{type:'logout'}]);
  stop();window.dispatchEvent(new Event('online'));channels[0].listener({data:{type:'change'}});window.dispatchEvent(storage);assert.equal(received.length,4);
});
test('unavailable local storage and IndexedDB yield a clear storage error without a hanging request',async t=>{
  const {client}=await fixture(t,{online:false,storageError:true});
  await assert.rejects(client.command({op:'entity.edit',projectId:'p'}),/хранилище недоступно/);
  await assert.rejects(client.prepareProject(''),/Выберите проект/);
});
