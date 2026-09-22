import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,entities,uid} from '../server/db.mjs';
import {bootstrap,execute} from '../server/service.mjs';
import {beginGoogleCalendar,connectAppleCalendar,externalCalendarStatus,finishGoogleCalendar,syncExternalCalendar} from '../server/v2/calendar/external.mjs';

const fixture=()=>{const db=openDatabase(':memory:'),admin=bootstrap(db,{slug:'tie',agencyName:'Тест',email:'owner@example.test',name:'Владелец',password:'strong-password'}).user,project=execute(db,admin,{id:uid(),op:'project.create',data:{name:'Анна и Илья',date:'2027-06-12'}});return {db,admin,project};};
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});
const xml=(value,status=207,headers={})=>new Response(value,{status,headers:{'content-type':'application/xml',...headers}});

test('Google Calendar creates a wedding calendar and synchronizes tasks both ways',async t=>{
 const previous={...process.env};t.after(()=>{for(const key of ['TIE_CALENDAR_SECRET','TIE_PUBLIC_ORIGIN','GOOGLE_CALENDAR_CLIENT_ID','GOOGLE_CALENDAR_CLIENT_SECRET'])previous[key]===undefined?delete process.env[key]:process.env[key]=previous[key];});
 Object.assign(process.env,{TIE_CALENDAR_SECRET:'01234567890123456789012345678901',TIE_PUBLIC_ORIGIN:'http://localhost:4199',GOOGLE_CALENDAR_CLIENT_ID:'client-id',GOOGLE_CALENDAR_CLIENT_SECRET:'client-secret'});
 const {db,admin,project}=fixture(),started=beginGoogleCalendar(db,admin,project.id),state=new URL(started.url).searchParams.get('state');let listRun=0,eventNumber=0;
 const fetchImpl=async(url,options={})=>{const value=String(url),method=options.method||'GET';
  if(value.includes('oauth2.googleapis.com/token'))return json({access_token:'access',refresh_token:'refresh',expires_in:3600});
  if(value.endsWith('/calendars')&&method==='POST')return json({id:'tie-calendar',summary:'tie · Анна и Илья'});
  if(value.includes('/events')&&method==='GET'){listRun++;return listRun===1?json({items:[],nextSyncToken:'sync-1'}):json({items:[{id:'outside-1',summary:'Задача из Google',description:'Добавлена в Google',start:{date:'2027-01-10'},end:{date:'2027-01-11'},updated:'2026-09-23T10:00:00.000Z',etag:'external-1'}],nextSyncToken:'sync-2'});}
  if(value.includes('/events')&&method==='POST'){const body=JSON.parse(options.body);eventNumber++;return json({id:`tie-${eventNumber}`,etag:`etag-${eventNumber}`,updated:'2026-09-23T09:00:00.000Z',...body});}
  throw new Error(`Unexpected Google request: ${method} ${value}`);
 };
 await finishGoogleCalendar(db,state,'code',{fetchImpl});
 assert.equal(externalCalendarStatus(db,admin,project.id).connections[0].provider,'google');
 const first=await syncExternalCalendar(db,admin,{projectId:project.id,provider:'google'},{fetchImpl});assert(first.exported>0);
 const second=await syncExternalCalendar(db,admin,{projectId:project.id,provider:'google'},{fetchImpl});assert.equal(second.imported,1);
 assert(entities(db,admin.agency_id,project.id,'task').some(task=>task.data.title==='Задача из Google'));
 const stored=db.prepare("SELECT secret_json FROM calendar_connections WHERE provider='google'").get().secret_json;assert(!stored.includes('refresh'));
});

test('Apple Calendar discovers iCloud CalDAV and imports an event',async t=>{
 const old=process.env.TIE_CALENDAR_SECRET;t.after(()=>old===undefined?delete process.env.TIE_CALENDAR_SECRET:process.env.TIE_CALENDAR_SECRET=old);process.env.TIE_CALENDAR_SECRET='01234567890123456789012345678901';
 const {db,admin,project}=fixture();let reports=0;
 const fetchImpl=async(url,options={})=>{const value=String(url),method=options.method||'GET';
  if(method==='PROPFIND'&&value==='https://caldav.icloud.com/')return xml('<d:multistatus xmlns:d="DAV:"><d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>');
  if(method==='PROPFIND'&&value.endsWith('/123/principal/'))return xml('<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/123/principal/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>/123/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response></d:multistatus>');
  if(method==='PROPFIND'&&value.endsWith('/123/calendars/'))return xml('<d:multistatus xmlns:d="DAV:"/>');
  if(method==='MKCALENDAR')return new Response('',{status:201});
  if(method==='REPORT'){reports++;const calendarData='BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:apple-1\r\nDTSTART;VALUE=DATE:20270115\r\nDTEND;VALUE=DATE:20270116\r\nSUMMARY:Задача из Apple\r\nDESCRIPTION:Добавлена в iCloud\r\nEND:VEVENT\r\nEND:VCALENDAR';return xml(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/123/calendars/tie/${reports}.ics</d:href><d:propstat><d:prop><d:getetag>apple-etag</d:getetag><c:calendar-data>${calendarData}</c:calendar-data></d:prop></d:propstat></d:response></d:multistatus>`);}
  if(method==='PUT')return new Response('',{status:201,headers:{etag:'saved'}});
  throw new Error(`Unexpected Apple request: ${method} ${value}`);
 };
 await connectAppleCalendar(db,admin,{projectId:project.id,appleId:'owner@icloud.com',password:'abcd-efgh-ijkl-mnop'},{fetchImpl});
 const result=await syncExternalCalendar(db,admin,{projectId:project.id,provider:'apple'},{fetchImpl});assert.equal(result.imported,1);assert(result.exported>0);
 assert(entities(db,admin.agency_id,project.id,'task').some(task=>task.data.title==='Задача из Apple'));
 const stored=db.prepare("SELECT secret_json FROM calendar_connections WHERE provider='apple'").get().secret_json;assert(!stored.includes('abcd-efgh'));
});
