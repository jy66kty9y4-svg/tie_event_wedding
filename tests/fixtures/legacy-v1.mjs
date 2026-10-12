import {DatabaseSync} from 'node:sqlite';

// Frozen historical schema, deliberately independent of current migration code.
// All contents are fictional; this fixture replaces dependence on private backups.
export function writeLegacyV1(path,{slug='legacy-unit',empty=false}={}) {
  const db=new DatabaseSync(path),at=new Date().toISOString();
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
    CREATE TABLE agencies(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,name TEXT NOT NULL,settings TEXT NOT NULL DEFAULT '{}',version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE users(id TEXT PRIMARY KEY,agency_id TEXT NOT NULL REFERENCES agencies(id),email TEXT NOT NULL COLLATE NOCASE,name TEXT NOT NULL,password TEXT NOT NULL,protected INTEGER NOT NULL DEFAULT 0,disabled INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,UNIQUE(agency_id,email));
    CREATE TABLE sessions(digest TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE roles(id TEXT PRIMARY KEY,agency_id TEXT NOT NULL REFERENCES agencies(id),name TEXT NOT NULL,permissions TEXT NOT NULL,protected INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,key TEXT);
    CREATE TABLE grants(id TEXT PRIMARY KEY,agency_id TEXT NOT NULL REFERENCES agencies(id),user_id TEXT NOT NULL REFERENCES users(id),role_id TEXT NOT NULL REFERENCES roles(id),project_id TEXT,restrictions TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE entities(id TEXT PRIMARY KEY,agency_id TEXT NOT NULL REFERENCES agencies(id),project_id TEXT,kind TEXT NOT NULL,parent_id TEXT,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
    CREATE TABLE audit(id TEXT PRIMARY KEY,agency_id TEXT NOT NULL,project_id TEXT,actor_id TEXT NOT NULL,entity_id TEXT NOT NULL,kind TEXT NOT NULL,action TEXT NOT NULL,before_json TEXT,after_json TEXT,created_at TEXT NOT NULL);
    CREATE TABLE commands(id TEXT NOT NULL,user_id TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(id,user_id));
    CREATE TABLE invitations(digest TEXT PRIMARY KEY,agency_id TEXT NOT NULL REFERENCES agencies(id),project_id TEXT NOT NULL,email TEXT NOT NULL,role_id TEXT NOT NULL REFERENCES roles(id),expires INTEGER NOT NULL,used_by TEXT,restrictions TEXT NOT NULL DEFAULT '{}',created_by TEXT REFERENCES users(id),revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE blobs(id TEXT PRIMARY KEY REFERENCES entities(id),content BLOB NOT NULL);
    CREATE TABLE attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until_ms INTEGER NOT NULL);
  `);
  for(const version of [1,2,3])db.prepare('INSERT INTO migrations VALUES(?,?)').run(version,at);
  db.prepare('INSERT INTO agencies(id,slug,name) VALUES(?,?,?)').run('legacy-agency',slug,'Fictional legacy agency');
  db.prepare('INSERT INTO users(id,agency_id,email,name,password,protected) VALUES(?,?,?,?,?,1)').run('legacy-owner','legacy-agency','owner@example.test','Legacy Owner','preserved-fictional-password');
  for(const [key,name,permissions] of [['admin','Администратор',['read','edit','projects','finance','history']],['couple','Участник пары',['read','edit','history']]])db.prepare('INSERT INTO roles(id,agency_id,name,permissions,key) VALUES(?,?,?,?,?)').run(`legacy-${key}`,'legacy-agency',name,JSON.stringify(permissions),key);
  db.prepare('INSERT INTO grants(id,agency_id,user_id,role_id) VALUES(?,?,?,?)').run('legacy-grant','legacy-agency','legacy-owner','legacy-admin');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('legacy-digest','legacy-owner',Date.now()+86400000);
  if(!empty) {
    const records=[
      ['legacy-project',null,'project',null,{name:'Fictional wedding',date:'2027-06-12',status:'planning',limit:300000}],
      ['legacy-guests','legacy-project','table',null,{key:'guests',name:'Гости',columns:[{id:'name',name:'Имя',type:'text'}]}],
      ['legacy-guest','legacy-project','row','legacy-guests',{name:'Fictional Guest'}],
      ['legacy-obligation','legacy-project','obligation',null,{title:'Venue',agreed:1000000,planned:1200000,fee:false,priceKind:'amount'}],
      ['legacy-deposit','legacy-project','movement',null,{type:'deposit',amount:500000,holderId:'legacy-owner',date:'2027-06-01'}],
      ['legacy-payment','legacy-project','movement',null,{type:'payment',amount:250000,source:'direct',obligationId:'legacy-obligation',date:'2027-06-01'}],
      ['legacy-income',null,'movement',null,{type:'income',amount:123456,date:'2027-06-01'}],
      ['legacy-template',null,'template',null,{name:'Legacy reusable',tables:[{key:'guests',name:'Гости',columns:[{id:'name',name:'Имя',type:'text'}]}]}]
    ];
    for(const [id,p,kind,parent,data] of records) {
      db.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?,3,0,?)').run(id,'legacy-agency',p,kind,parent,JSON.stringify(data),at);
      const row=db.prepare('SELECT * FROM entities WHERE id=?').get(id);
      db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?,?,?)').run(`audit-${id}`,'legacy-agency',p,'legacy-owner',id,kind,'create',null,JSON.stringify(row),at);
    }
  }
  db.close();
}
