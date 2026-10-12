import {cpSync,mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.argv[2]||join(root,'test-results/unit-coverage/mutations.json'));
const targets=[
  ['money-loses-kopecks','src/shared.js',"Number(fraction.padEnd(2, '0'))",'0','shared-validation'],
  ['unknown-formula-value-becomes-zero','src/shared.js',"v === '' || v == null ? null :", "v === '' || v == null ? 0 :",'shared-validation'],
  ['invalid-calendar-day-normalizes','server/model.mjs',"Number.isFinite(instant)&&new Date(instant).toISOString().slice(0,10)===v",'Number.isFinite(instant)','shared-validation'],
  ['excessive-money-accepted','server/model.mjs','v<=1e12','v<=1e13','shared-validation'],
  ['inherited-column-type-accepted','server/model.mjs',"typeof c.type==='string'&&Object.hasOwn(fieldTypes,c.type)",'fieldTypes[c.type]','schema-unit'],
  ['grant-ignores-project','server/auth.mjs','if (g.project_id !== null && g.project_id !== project) return false;','if (false) return false;','auth-invariants'],
  ['grant-accepts-some-fields','server/auth.mjs','requested.some(key=>!r.fields.includes(key))','requested.every(key=>!r.fields.includes(key))','auth-invariants'],
  ['replay-skips-current-authorization','server/v2/common.mjs','operation.authorize(db,u,cmd);','/* authorization removed */','db-command-invariants'],
  ['failed-transaction-commits','server/db.mjs',"db.exec('ROLLBACK'); throw e;","db.exec('COMMIT'); throw e;",'db-command-invariants'],
  ['default-template-order-changes','server/clean-reset.mjs','new Date(definitionTime+index).toISOString()','new Date(definitionTime).toISOString()','clean-reset-boundaries'],
  ['zero-rent-override-ignored','src/venue-profile.js','if(v.rentOverride!=null)','if(v.rentOverride)','venue-vendor-unit'],
  ['duplicate-photo-accepted','src/venue-profile.js','||new Set(value).size!==value.length','','venue-vendor-unit'],
  ['commission-leaks-in-export','src/finance-sheet.js',"column.id!=='agencyCommission'||state.canViewAgencyCommission",'true','finance-export-unit'],
  ['money-export-loses-unit-conversion','src/xlsx.js',"typeName==='money'?Number(value)/100:Number(value)","Number(value)",'finance-export-unit'],
  ['seating-ignores-sine','src/v2/guest/geometry.mjs','sin = Math.abs(Math.sin(angle))','sin = 0','seating-geometry-unit'],
  ['csrf-header-omitted','src/client.js',"headers.set('X-CSRF-Token', csrf())","headers.set('X-CSRF-Token', '')",'client-transport']
];
const temporary=mkdtempSync(join(tmpdir(),'tie-unit-mutations-')),results=[];
function run(files){return spawnSync(process.execPath,['--test','--test-reporter=tap',...files.map(name=>`tests/${name}.test.mjs`)],{cwd:temporary,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});}
try {
  for(const folder of ['src','server','tests'])cpSync(join(root,folder),join(temporary,folder),{recursive:true});
  writeFileSync(join(temporary,'package.json'),'{"type":"module"}');
  symlinkSync(join(root,'node_modules'),join(temporary,'node_modules'),'dir');
  const files=[...new Set(targets.map(target=>target[4]))],baseline=run(files);
  if(baseline.status!==0)throw new Error(`Mutation baseline failed: ${baseline.stderr}\n${baseline.stdout.slice(-6000)}`);
  for(const [name,path,from,to,file] of targets) {
    const original=readFileSync(join(root,path),'utf8'),target=join(temporary,path);
    if(!original.includes(from))throw new Error(`Mutation anchor has changed: ${name}`);
    writeFileSync(target,original.replaceAll(from,to));
    let result;try{result=run([file]);}finally{writeFileSync(target,original);}
    const log=result.stdout||'',failedAssertions=/^not ok /m.test(log)&&/# fail [1-9]/.test(log);
    const detected=result.status===1&&!result.error&&failedAssertions&&!/SyntaxError:|ERR_MODULE_NOT_FOUND/.test(log+result.stderr);
    results.push({name,path,test:`tests/${file}.test.mjs`,detected,exitCode:result.status,error:result.error?.message,failedTests:Number(log.match(/# fail (\d+)/)?.[1]||0)});
    console.log(`${detected?'PASS':'FAIL'} ${name}`);
  }
  mkdirSync(dirname(output),{recursive:true});
  const report={checkedAt:new Date().toISOString(),scope:'16 targeted regressions; not an exhaustive mutation score',baselinePassed:true,detected:results.filter(r=>r.detected).length,total:results.length,results};
  writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(`Detected ${report.detected}/${report.total} targeted mutations. Report: ${output}`);
  if(report.detected!==report.total)process.exitCode=1;
}finally{rmSync(temporary,{recursive:true,force:true});}
