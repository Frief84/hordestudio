'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,launchOptions}=require('./browser_runtime').browserRuntime();const root=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch(launchOptions);try{
 const context=await browser.newContext();await context.route('**/*',route=>{
  const u=new URL(route.request().url());if(u.hostname!=='bundled-content.test')return route.abort();
  const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
  return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'text/css'});
 });const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('https://bundled-content.test');await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);
 const result=await page.evaluate(async baseline=>{
  clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);
  state.apiKey='offline';state.globalSettings.apiProvider='openrouter';state.globalSettings.defaultModel='fixture/model';state.globalSettings.companionAlwaysOnEnabled=false;
  const migrations=[];
  for(const raw of baseline){
   const old=upgradeWorldSchemaData(raw,{source:'audit-baseline'}).world;
   const session={playerLocation:raw.startLocationId,history:[{role:'dm',text:'A saved scene.'}],entityStates:{custom:{location:'saved-place'}},bonusTimeMinutes:81,inventory:['saved key']};
   const before=JSON.stringify(session);const report=HordeBundledContent.update(old);normalizeAuthoredWorld(old);
   migrations.push({id:old.id,skipped:report.skipped,sessionUnchanged:JSON.stringify(session)===before});
  }
  const templates=[...STARTER_WORLDS,...HORDE_INCLUDED_WORLDS];const results=[];
  for(const authored of templates){
   for(const origin of [null,...(authored.startingLives||[])]){
    const world=safeJsonClone(authored);world.model='fixture/model';world.contextSize=65536;
    state.worlds=[world];state.worldInstances={[world.id]:{sessions:[],activeSessionId:null}};state.activeWorldId=world.id;
    const sess=prepareCurrentWorldSession();if(origin)applyStartingLifeToSession(world,sess,origin.id);sess.setupComplete=true;
    const start=sess.playerLocation,opening=sess.pendingOriginIntro||world.intro||'';let calls=0,roleHint=false;
    window.fetch=async(url,options={})=>{
     if(!String(url).includes('/chat/completions'))return new Response('{}',{headers:{'Content-Type':'application/json'}});
     calls++;const body=JSON.parse(options.body);roleHint=body.messages.some(m=>String(m.content).includes('Role embodiment:'));const name=getLocationRef(worldForSession(world,sess),sess.playerLocation).name;
     const draft={protocol:'scene_draft_v2',narrative:[{id:'scene',text:`You remain at ${name}. There is time to decide what to do next.`}],actions:[],events:[],effects:{},speech:[],commitments:[]};
     const message={tool_calls:[{id:'world-scene',index:0,type:'function',function:{name:'commit_world_turn',arguments:JSON.stringify(draft)}}]};
     return body.stream?new Response(`data: ${JSON.stringify({choices:[{delta:message,finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}}):new Response(JSON.stringify({choices:[{message}]}),{headers:{'Content-Type':'application/json'}});
    };
    switchView('worldPlay');renderWorldPlayState();
    if(opening)await executeWorldTurn('init');
    const introLocation=sess.playerLocation,frame=buildWorldSceneFrame(world,sess);
    await executeWorldTurn('look');
    results.push({world:world.id,origin:origin?.id||'default',start,introLocation,after:sess.playerLocation,source:sess.lastTurnStateSource,rejections:sess.lastTurnAudit?.rejected||[],calls,
      roleHint,cast:frame.present_character_ids,queenVisible:sessionNpcs(world,sess).some(n=>n.id==='vs_queen'),mayorVisible:sessionNpcs(world,sess).some(n=>n.id==='bw_core_mayor')});
   }
  }
  return{migrations,results};
 },JSON.parse(fs.readFileSync(path.join(root,'scratch/fixtures/bundled-worlds-before-content-v1.json'),'utf8')));
 if(process.env.HORDE_BUNDLED_CONTENT_REPORT){const report=path.resolve(process.env.HORDE_BUNDLED_CONTENT_REPORT);fs.mkdirSync(path.dirname(report),{recursive:true});fs.writeFileSync(report,JSON.stringify(result,null,2));}
 for(const m of result.migrations){assert.deepEqual(m.skipped,[],m.id+' normalized migration');assert(m.sessionUnchanged);}
 for(const r of result.results){assert.equal(r.introLocation,r.start,JSON.stringify(r));assert.equal(r.after,r.start,JSON.stringify(r));assert.equal(r.source,'tool_call',JSON.stringify(r));assert.deepEqual(r.rejections,[],JSON.stringify(r));assert.equal(r.calls,1,JSON.stringify(r));if(r.world==='world_aldenmere'){assert(r.cast.includes('ent_rowena'));assert(r.cast.includes('ent_quill'));}if(r.origin==='origin_queen'){assert(!r.queenVisible);assert(r.roleHint);}if(r.origin==='bw_origin_mayor'){assert(!r.mayorVisible);assert(r.roleHint);}}
 assert.equal(result.results.length,38);
 const preserved=await page.evaluate(async raw=>{
  const world=state.worlds[0],sess=getCurrentWorldSession();
  world.intro=raw.intro;world.description=raw.description;delete world.bundledContentRevision;
  for(const place of world.locations){const old=raw.locations.find(p=>p.id===place.id);if(old)place.exits=safeJsonClone(old.exits);}
  for(const life of world.startingLives){const old=raw.startingLives.find(p=>p.id===life.id);if(old){life.intro=old.intro;life.description=old.description;}}
  sess.turnCount=23;sess.bonusTimeMinutes=81;sess.playerLocation='loc_break';sess.inventory=[{name:'kept-key',quantity:1}];
  sess.entityStates.npc_eli.location='loc_break';sess.entityStates.npc_eli.pinnedUntilTurn=99;sess.entityStates.npc_eli.pinnedLocation='loc_break';
  sess.history.push({id:'preserved-history',role:'dm',text:'This saved story must survive the content update.',location:'loc_break'});
  const minute=getWorldTimeData(world,sess).currentTotalMinutes;
  await saveState({allWorldInstances:true});
  return{worldId:world.id,sessionId:sess.id,minute,turn:sess.turnCount,bonus:sess.bonusTimeMinutes,inventory:safeJsonClone(sess.inventory)};
 },JSON.parse(fs.readFileSync(path.join(root,'scratch/fixtures/bundled-worlds-before-content-v1.json'),'utf8')).find(w=>w.id==='world_policy_panic_bramble_pike'));
 await page.reload();await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);
 const reloaded=await page.evaluate(({worldId,sessionId})=>{
  clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);
  const world=state.worlds.find(w=>w.id===worldId),sess=state.worldInstances[worldId].sessions.find(s=>s.id===sessionId);
  return{revision:world.bundledContentRevision,location:sess.playerLocation,npcLocation:sess.entityStates.npc_eli.location,minute:getWorldTimeData(world,sess).currentTotalMinutes,turn:sess.turnCount,bonus:sess.bonusTimeMinutes,inventory:sess.inventory,history:sess.history.at(-1)?.text,homeReachable:!!findWorldTravelPath(world,'loc_maplebridge','loc_gloria_home')};
 },preserved);
 assert.equal(reloaded.revision,1);assert.equal(reloaded.location,'loc_break');assert.equal(reloaded.npcLocation,'loc_break');assert.equal(reloaded.minute,preserved.minute);assert.equal(reloaded.turn,preserved.turn);assert.equal(reloaded.bonus,preserved.bonus);assert.deepEqual(reloaded.inventory,preserved.inventory);assert.equal(reloaded.history,'This saved story must survive the content update.');assert(reloaded.homeReachable);
 assert.deepEqual(errors,[]);console.log('PASS 38 bundled default/origin openings and first look turns; canonical location/cast; normalized legacy migration; no saved-session writes');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
