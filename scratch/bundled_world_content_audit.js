'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),{buildContext}=require('./app_source');
const api=require('../assets/worlds/bundled-content'),{definitions}=require('./bundled_world_fixtures');
const old=require('./fixtures/bundled-worlds-before-content-v1.json'),worlds=definitions();
const copy=v=>JSON.parse(JSON.stringify(v));
function graph(w){const ids=new Map(w.locations.map(l=>[l.id,l])),names=new Map(w.locations.map(l=>[l.name.toLowerCase(),l.id])),edges=new Map();
 for(const l of w.locations){assert.equal(ids.size,w.locations.length);const targets=[];for(const e of l.exits||[]){const text=typeof e==='string'?e:e.text;const id=e.targetLocationId||names.get(text.replace(/^.*?\bto\s+/i,'').toLowerCase());assert(ids.has(id),l.id+' -> '+text);targets.push(id);}edges.set(l.id,targets);if(l.parentLocationId)assert(ids.has(l.parentLocationId));}
 const reaches=start=>{const seen=new Set([start]),q=[start];while(q.length)for(const n of edges.get(q.shift())||[])if(!seen.has(n)){seen.add(n);q.push(n);}return seen;};
 assert.equal(reaches(w.startLocationId).size,w.locations.length,w.name+' reachable map');
 // Every authored origin can reach the same connected world, and get home.
 for(const l of w.startingLives||[])assert.equal(reaches(l.startLocationId).size,w.locations.length,l.id);
 for(const n of w.entities.filter(n=>n.type==='npc')){assert(ids.has(n.startLocation),n.id);for(const b of n.schedule||[]){assert(ids.has(b.locationId),n.id+' schedule');assert(/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time));}for(let i=1;i<(n.schedule||[]).length;i++)assert(reaches(n.schedule[i-1].locationId).has(n.schedule[i].locationId),n.id+' commute');}
}
const scheduleContext={console};buildContext(vm,['isScheduleBlockForWorldDay'],scheduleContext);
for(const w of worlds){
 const time=String(w.hudConfig.startTimeHours).padStart(2,'0')+':'+String(w.hudConfig.startTimeMinutes||0).padStart(2,'0');
 for(const npc of w.entities.filter(n=>n.type==='npc')){
  const blocks=(npc.schedule||[]).filter(b=>scheduleContext.isScheduleBlockForWorldDay(w,b,1)).sort((a,b)=>a.time.localeCompare(b.time));
  const active=blocks.filter(b=>b.time<=time).at(-1)||blocks.at(-1);if(active)assert.equal(npc.startLocation,active.locationId,npc.id+' opening schedule');
 }
 graph(w);const baseline=copy(old.find(v=>v.id===w.id));const result=api.update(baseline);assert(result.changed);assert.deepEqual(result.skipped,[],JSON.stringify(result.skipped));graph(baseline);assert.equal(api.update(baseline).changed,false);}
const bell=worlds.find(w=>w.id==='world_bellwether_2005');for(const n of bell.entities){assert(n.homeLocation,n.id);assert(n.schedule.some(b=>b.time==='00:00'&&b.locationId===n.homeLocation)||n.id.startsWith('bw_resident_'));}
const edited=copy(old.find(w=>w.id==='world_policy_panic_bramble_pike'));
edited.intro='MY OPENING';edited.startingLives[0].intro='MY ROLE';edited.locations.find(l=>l.id==='loc_maplebridge').exits.push({text:'my custom path',targetLocationId:'loc_reception',travelTime:99});
const beforeEdited=copy(edited.locations.find(l=>l.id==='loc_maplebridge').exits);const r=api.update(edited);assert.equal(edited.intro,'MY OPENING');assert.equal(edited.startingLives[0].intro,'MY ROLE');assert.deepEqual(edited.locations.find(l=>l.id==='loc_maplebridge').exits,beforeEdited);assert(r.skipped.length>=3);
const deleted=copy(old[1]),newHome=bell.locations.find(l=>l.id.startsWith('bw_residence_')),anchor=newHome.parentLocationId;assert(deleted.locations.some(l=>l.id===anchor));deleted.locations=deleted.locations.filter(l=>l.id!==anchor);api.update(deleted);assert(!deleted.locations.some(l=>l.id===anchor));assert(!deleted.locations.some(l=>l.id===newHome.id));
const ctx={console};buildContext(vm,['isVisibleToSession'],ctx);const queen=worlds[0].entities.find(n=>n.id==='vs_queen');assert.equal(ctx.isVisibleToSession(queen,{id:'q',originId:'origin_queen'}),false);assert.equal(ctx.isVisibleToSession(queen,{id:'g',originId:'origin_guard'}),true);
const mayor=bell.entities.find(n=>n.id==='bw_core_mayor');assert.equal(ctx.isVisibleToSession(mayor,{id:'m',originId:'bw_origin_mayor'}),false);assert.equal(ctx.isVisibleToSession(mayor,{id:'r',originId:'bw_origin_reporter'}),true);
console.log('PASS 4 maps and all origins connected; schedule references/commutes; off-duty homes; safe/idempotent legacy patch; edited/deleted data; sovereign actor visibility');
