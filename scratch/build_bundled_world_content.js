'use strict';
// Rebuild only migration data; keep the reviewed update implementation intact.
// The compact fixture contains the public pre-update template fields, no media.
const fs=require('node:fs'),path=require('node:path'),{definitions}=require('./bundled_world_fixtures');
const baseline=require('./fixtures/bundled-worlds-before-content-v1.json');
const fields={locations:['exits'],entities:['startLocation','homeLocation','schedule','playerOriginIds'],startingLives:['intro','description']};
const different=(a,b)=>JSON.stringify(a??null)!==JSON.stringify(b??null);
const patches=definitions().map(world=>{
 const old=baseline.find(row=>row.id===world.id);if(!old)throw Error('Missing baseline for '+world.id);
 const changes=[];
 for(const field of ['intro','description'])if(different(old[field],world[field]))changes.push({collection:null,id:null,fields:{[field]:{before:old[field]??null,after:world[field]}}});
 for(const [collection,keys]of Object.entries(fields)){
  const prior=new Map((old[collection]||[]).map(row=>[row.id,row]));
  for(const row of world[collection]||[]){
   const previous=prior.get(row.id);if(!previous){changes.push({collection,id:row.id,add:row});continue;}
   const changed={};for(const key of keys)if(row[key]!==undefined&&different(previous[key],row[key]))changed[key]={before:previous[key]??null,after:row[key]};
   if(Object.keys(changed).length)changes.push({collection,id:row.id,fields:changed});
  }
 }
 return{worldId:world.id,revision:1,changes};
});
const file=path.join(__dirname,'../assets/worlds/bundled-content.js'),source=fs.readFileSync(file,'utf8');
if(!/^const PATCHES=.*;$/m.test(source))throw Error('Migration data marker was not found');
if(process.argv.includes('--check')){
 const existing=JSON.parse(source.match(/^const PATCHES=(.*);$/m)[1]);require('node:assert/strict').deepEqual(patches,existing);console.log('PASS bundled migration data matches current templates');
}else{fs.writeFileSync(file,source.replace(/^const PATCHES=.*;$/m,'const PATCHES='+JSON.stringify(patches)+';'));console.log('Rebuilt bundled content patches:',patches.map(p=>p.worldId+' '+p.changes.length).join(', '));}
