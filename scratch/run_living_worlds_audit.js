'use strict';
// Re-run only the explicitly inspected suites recorded by this audit.
const fs=require('node:fs'), path=require('node:path'), {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'), out=path.join(__dirname,'living-worlds-audit-20261112');
const results=[];
for(const file of fs.readdirSync(out).filter(f=>f.endsWith('.log')).sort()) {
 const name=file.slice(0,-4), script=path.join(__dirname,name+'.js');
 if(!fs.existsSync(script)||name==='run_living_worlds_audit') continue;
 const started=Date.now();
 const run=spawnSync(process.execPath,[script],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024,
  env:{...process.env,HORDE_RESOLVED_LIVE_MODEL:'',HORDE_RESOLVED_SKIP_LIFECYCLE:'',HORDE_STRESS_PROFILE:''}});
 fs.writeFileSync(path.join(out,file),(run.stdout||'')+(run.stderr||''));
 results.push({name,exit:run.status,error:run.error?.message||null,ms:Date.now()-started});
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
 console.log(`${name}: ${run.status===0?'PASS':'FAIL'} (${Date.now()-started}ms)`);
}
console.log(JSON.stringify({total:results.length,passed:results.filter(r=>r.exit===0).length,failed:results.filter(r=>r.exit!==0).map(r=>r.name)}));
process.exitCode=results.some(r=>r.exit!==0)?1:0;
