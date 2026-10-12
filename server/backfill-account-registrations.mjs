import {pathToFileURL} from 'node:url';
import {realpathSync} from 'node:fs';
import {openDatabase,decode,transaction} from './db.mjs';
import {queueAccountRegistration,processOutbox} from './v2/calendar/index.mjs';

// Restore only real, still-pending registrations from before inbox notifications were connected.
export function restoreRegistrationNotifications(db) {
  const pending=db.prepare("SELECT * FROM entities WHERE kind='accountOnboarding' AND deleted=0 AND json_extract(data,'$.status')='pending'").all().map(decode);
  transaction(db,()=>{for(const entry of pending)queueAccountRegistration(db,null,entry);});
  let delivered=0;
  for(const entry of pending)delivered+=processOutbox(db,Date.now(),100,{sourceId:entry.id}).delivered;
  return{pendingAccounts:pending.length,delivered};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
  const db=openDatabase(process.argv[2]||process.env.TIE_DB_PATH||'data/tie.sqlite');
  try{console.log(JSON.stringify(restoreRegistrationNotifications(db)));}finally{db.close();}
}
