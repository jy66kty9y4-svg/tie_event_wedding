import {openDatabase} from '../../server/db.mjs';
import {defaults,grant} from '../../server/auth.mjs';

// No live records, credentials or server bootstrap. Each test owns an isolated DB.
export function unitDb(t) {
  const db=openDatabase(':memory:');t.after(()=>db.close());
  for(const [id,slug] of [['agency-a','unit-a'],['agency-b','unit-b']])db.prepare('INSERT INTO agencies(id,slug,name) VALUES(?,?,?)').run(id,slug,slug);
  const user=(id,agency='agency-a',protectedUser=false)=>{
    db.prepare('INSERT INTO users(id,agency_id,email,name,password,protected) VALUES(?,?,?,?,?,?)').run(id,agency,`${id}@example.test`,id,'fictional-unused-hash',Number(protectedUser));
    return db.prepare('SELECT * FROM users WHERE id=?').get(id);
  };
  const admin=user('unit-admin','agency-a',true),member=user('unit-member'),foreign=user('unit-foreign','agency-b');
  const roles=defaults(db,'agency-a');
  grant(db,admin,roles.find(r=>r.key==='admin').id);
  const role=(permissions,key=null,agency='agency-a')=>{
    const id=`unit-role-${db.prepare('SELECT count(*) n FROM roles').get().n}`;
    db.prepare('INSERT INTO roles(id,agency_id,name,permissions,key) VALUES(?,?,?,?,?)').run(id,agency,id,JSON.stringify(permissions),key);
    return id;
  };
  return {db,admin,member,foreign,roles,role,user};
}
