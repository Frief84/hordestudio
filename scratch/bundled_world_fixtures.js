'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {buildContext}=require('./app_source');
function definitions(){
 const ctx={console};buildContext(vm,['createThronefallSandboxWorld','createBellwether2005World'],ctx);
 const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),start=app.indexOf('const STARTER_WORLDS = ['),end=app.indexOf('\n];',start)+3;
 vm.runInContext(app.slice(start,end)+'\nglobalThis.starters=STARTER_WORLDS;',ctx);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../policy-panic-world.js'),'utf8'),ctx);
 return JSON.parse(JSON.stringify([...ctx.starters,...ctx.HORDE_INCLUDED_WORLDS]));
}
module.exports={definitions};
