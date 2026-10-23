'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,launchOptions}=require('./browser_runtime').browserRuntime();
const root=path.resolve(__dirname,'..'),file=path.join(root,'output/worlds/Stillwater 2006 - The Summer We Almost Lost.horde_world');
const raw=JSON.parse(fs.readFileSync(file,'utf8'));
const locs=new Map(raw.locations.map(l=>[l.id,l])),npcs=new Map(raw.entities.map(e=>[e.id,e]));
assert.equal(locs.size,raw.locations.length);assert.equal(npcs.size,raw.entities.length);
for(const l of raw.locations) for(const ex of l.exits){assert(locs.has(ex.targetLocationId));assert(locs.get(ex.targetLocationId).exits.some(back=>back.targetLocationId===l.id));assert(ex.travelTime>0);}
const seen=new Set(),q=[raw.startLocationId];while(q.length){const id=q.pop();if(seen.has(id))continue;seen.add(id);q.push(...locs.get(id).exits.map(e=>e.targetLocationId));}assert.equal(seen.size,locs.size);
for(const e of raw.entities){assert(locs.has(e.startLocation));assert(locs.has(e.homeLocation));for(const b of e.schedule) assert(locs.has(b.locationId));}
for(const r of raw.relationships){assert(npcs.has(r.a));assert(npcs.has(r.b));assert(r.a!==r.b);}
for(const f of raw.factions) for(const id of f.territory) assert(locs.has(id));
for(const e of raw.entities) assert(raw.factions.some(f=>f.id===e.factionId));
assert.equal(raw.entities.filter(e=>/^(12|13|14)-year-old/.test(e.description)).length,24);
assert.equal(raw.entities.filter(e=>e.startLocation==='sw_offsite').length,3);
assert.equal(raw.lorebook.filter(l=>/^sw_lore_day_/.test(l.id)).length,21);
(async()=>{const browser=await chromium.launch(launchOptions);try{
 const context=await browser.newContext();await context.route('**/*',route=>{
 const u=new URL(route.request().url());if(u.hostname!=='stillwater.test')return route.abort();
 const f=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
 if(!f.startsWith(root+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile())return route.fulfill({status:404,body:''});
 return route.fulfill({contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(f)]||'application/octet-stream',body:fs.readFileSync(f)});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('https://stillwater.test/');await page.waitForFunction(()=>window.__hordeStartup?.readyMs);
 await page.evaluate(()=>{clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);switchView('worlds');setupWorldImport();});
 await page.evaluate(async rawText=>{const prior=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){window.__importInput=this;};try{document.querySelector('#import-world-btn').onclick();}finally{HTMLInputElement.prototype.click=prior;}const input=window.__importInput;const f=new File([rawText],'Stillwater.horde_world',{type:'application/json'});await input.onchange({target:{files:[f]}});},fs.readFileSync(file,'utf8'));
 await page.waitForFunction(()=>state.worlds.some(w=>w.name.startsWith('Stillwater, 2006')));
 const result=await page.evaluate(async()=>{
  const w=state.worlds.find(w=>w.name.startsWith('Stillwater, 2006'));validateWorldData(w);w.kernel.sceneLedger=true;w.kernel.sceneDraftProtocol='scene_draft_v2';
  openWorldStudio(w.id);
  const editor={name:document.querySelector('#w-studio-name').value,mode:document.querySelector('#w-kernel-scene-mode').value};
  state.activeWorldId=w.id;state.worldInstances[w.id]={sessions:[],activeSessionId:null};
  const s=prepareCurrentWorldSession();
  const offsite=['sw_npc_joan','sw_npc_victor','sw_npc_ada'].map(id=>s.entityStates[id]?.location);
  switchView('worldPlay');renderWorldPlayState();await saveWorldsState();
  const saved=await HordeDB.get('worlds');
  s.setupComplete=true;s.history.push({id:'opening',role:'dm',text:w.intro,location:s.playerLocation});
  state.globalSettings.apiProvider='local';state.globalSettings.localBaseUrl='http://127.0.0.1:1234/v1';state.globalSettings.defaultModel='fixture/model';state.apiKey='offline';
  const realFetch=window.fetch;const requests=[];const jsonClient=HordeWorldModelClient.json;let repairBudget=0,repairs=0;
  HordeWorldModelClient.json=async options=>{repairBudget=options.timeoutMs;if(++repairs===1){const error=new Error('Mock verification timeout');error.code='WORLD_MODEL_TIMEOUT';throw error;}return jsonClient(options);};
  window.fetch=async(url,options={})=>{if(!String(url).includes('/chat/completions'))return realFetch(url,options);
   const body=JSON.parse(options.body);requests.push(body);
   const output='The girl in the track shirt points at the paper. "Are you going to read that?" You take the camp paper.';
   if(body.stream)return new Response('data: '+JSON.stringify({choices:[{delta:{content:output},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
   return new Response(JSON.stringify({choices:[{message:{content:'No JSON receipt supplied.'}}]}),{headers:{'Content-Type':'application/json'}});
  };
  const before={inventory:JSON.stringify(s.inventory),ledger:JSON.stringify(s.worldLedger),place:s.playerLocation};
  document.querySelector('#world-user-input').value='I look around';await executeWorldTurn();
  const first=s.history.at(-1);
  document.querySelector('#world-user-input').value='What does the headline say?';await executeWorldTurn();
  const second=s.history.at(-1);
  renderWorldPlayState();
  const provisional={repairBudget,first:first.provisionalNarrative,second:second.provisionalNarrative,text:first.text,
    source:first.stateSource,inventoryUnchanged:before.inventory===JSON.stringify(s.inventory),
    ledgerUnchanged:before.ledger===JSON.stringify(s.worldLedger),placeUnchanged:before.place===s.playerLocation,
    continuation:requests.filter(r=>r.stream).at(-1).messages.some(m=>m.content.includes('[PROVISIONAL STORY')&&m.content.includes('Are you going to read that?')),
    witnesses:first.witnesses,sceneMemory:first.sceneMemory,
    warning:document.querySelector('.world-provisional-notice')?.textContent,
    correction:!!document.querySelector('.world-provisional-correct')};
  await saveWorldsState();

  return {provisional,editor,location:s.playerLocation,offsite,locations:w.locations.length,entities:w.entities.length,lore:w.lorebook.length,origins:w.startingLives.length,saved:saved.some(x=>x.id===w.id),questCount:s.quests?.length||0};
 });
 assert.equal(result.provisional.repairBudget,10000);assert(result.provisional.first&&result.provisional.second);assert(result.provisional.text.includes('Are you going to read that?'));
 assert.equal(result.provisional.source,'frozen_no_receipt');assert(result.provisional.inventoryUnchanged&&result.provisional.ledgerUnchanged&&result.provisional.placeUnchanged);
 assert(result.provisional.continuation);assert.deepEqual(result.provisional.witnesses,[]);assert(!result.provisional.sceneMemory);
 assert(result.provisional.warning.includes('Provisional story'));assert(result.provisional.correction);assert.deepEqual(errors,[]);
 await page.reload();await page.waitForFunction(()=>window.__hordeStartup?.readyMs);assert(await page.evaluate(()=>Object.values(state.worldInstances).some(i=>i.sessions.some(s=>s.history.some(m=>m.provisionalNarrative)))));
 console.log(JSON.stringify({structural:'PASS',browserImport:'PASS',editorAndSession:'PASS',result,pageErrors:errors},null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
