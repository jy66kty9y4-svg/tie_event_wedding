import {readFileSync,renameSync,writeFileSync,chmodSync} from 'node:fs';

const [envPath,credentialsPath]=process.argv.slice(2);
if(!envPath||!credentialsPath)throw new Error('Usage: configure-google-calendar.mjs <env-path> <credentials-json>');
const source=JSON.parse(readFileSync(credentialsPath,'utf8'));
const credentials=source.web;
if(!credentials?.client_id||!credentials?.client_secret)throw new Error('OAuth JSON must contain web client credentials');
if(!credentials.redirect_uris?.includes('https://tie-event.cabinpxrn.ru/api/v2/calendar/google/callback'))throw new Error('Required redirect URI is missing');
if(!/^[A-Za-z0-9._-]+$/.test(credentials.client_id)||!/^[A-Za-z0-9._-]+$/.test(credentials.client_secret))throw new Error('OAuth credentials contain unsupported characters');

const values={GOOGLE_CALENDAR_CLIENT_ID:credentials.client_id,GOOGLE_CALENDAR_CLIENT_SECRET:credentials.client_secret};
const seen=new Set(),lines=readFileSync(envPath,'utf8').split(/\r?\n/).map(line=>{
 const match=line.match(/^([A-Z0-9_]+)=/);
 if(!match||!(match[1] in values))return line;
 seen.add(match[1]);
 return `${match[1]}=${values[match[1]]}`;
});
for(const [key,value] of Object.entries(values))if(!seen.has(key))lines.push(`${key}=${value}`);
const temporary=`${envPath}.google-calendar.tmp`;
writeFileSync(temporary,`${lines.filter((line,index)=>line||index<lines.length-1).join('\n')}\n`,{mode:0o600});
chmodSync(temporary,0o600);
renameSync(temporary,envPath);
console.log('Google Calendar OAuth configured');
