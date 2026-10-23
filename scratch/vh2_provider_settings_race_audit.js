'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('virtual_humans/frontend/vh2-horde-integration.js','utf8');
const code=source.slice(source.indexOf('async function vh2Poll('),source.indexOf('async function vh2PollOwned('));
let release,reads=0;const gate=new Promise(r=>release=r),timeline={id:'fixture',vh2:{imageProvider:{enabled:false}}};
const savedProvider={configured:true,enabled:true,model:'fixture',version:'saved'};
const ctx={Map,Promise,timeline,mcpBridgeRequest:async()=>savedProvider,vh2Request:async()=>savedProvider,safeJsonClone:value=>structuredClone(value),vh2ImageStudioFingerprint:()=> 'fixture',saveVirtualHumansState:async()=>{},vh2PollOwned:async(c,t)=>{reads++;if(reads===1){await gate;}else t.vh2.imageProvider={enabled:true,version:'saved'};}};
vm.createContext(ctx);vm.runInContext('const vh2PollLocks=new Map();\n'+code,ctx);
(async()=>{
 const old=ctx.vh2Poll({},timeline);await Promise.resolve();const saving=ctx.vh2SaveImageProvider({},timeline,{});await new Promise(resolve=>setImmediate(resolve));assert.equal(timeline.vh2.imageProvider.enabled,true,'POST receipt immediately records enabled');release();await old;await saving;assert.equal(reads,2,'saving forces a new settings read after the in-flight poll');
 const failure={status:'rejected',reason:Error('Temporary connection failure')};const retained=ctx.vh2ProviderRead(failure,{enabled:true,version:'saved'});assert.equal(retained.enabled,true);assert.equal(retained.stale,true);assert.equal(ctx.vh2ProviderRead(failure,undefined).enabled,undefined,'unknown is never fabricated as disabled');
 const good=ctx.vh2ProviderRead({status:'fulfilled',value:{enabled:true}},retained);assert.equal(good.stale,false);
 console.log('PASS provider settings: authoritative save receipt, forced post-save read, outage retains enabled, recovery clears stale status.');
})().catch(e=>{console.error(e);process.exitCode=1;});
