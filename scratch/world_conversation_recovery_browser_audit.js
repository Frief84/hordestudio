'use strict';
// Real turn pipeline, public fictional world, isolated saves and mocked models.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,launchOptions}=require('./browser_runtime').browserRuntime();
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch(launchOptions);
 try{
  const context=await browser.newContext();
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());if(u.hostname!=='conversation-recovery.test')return route.abort();
   const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   // Optional old app copy allows the same fixture to demonstrate the regression.
   const source=file===path.join(root,'app.js')&&process.env.HORDE_BASELINE_APP?process.env.HORDE_BASELINE_APP:file;
   return route.fulfill({body:fs.readFileSync(source),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'text/css'});
  });
  const page=await context.newPage();await page.goto('https://conversation-recovery.test');
  await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);
  const result=await page.evaluate(async authored=>{
   clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);
   state.apiKey='offline';state.globalSettings.apiProvider='openrouter';state.globalSettings.toolShyModels=[];
   const results=[];
   for(const scenario of ['prose_look','observation_take_in','prose_question','same_place','repair_protocol','unsafe_arrival','static_arrival','unsolicited_pickup','pickup','timeout']){
    const world=safeJsonClone(authored);world.id='recovery_'+scenario;world.model='fixture/model';world.contextSize=65536;
    world.kernel={enabled:true,sceneDrafts:true,sceneDraftProtocol:'scene_draft_v2',memoryMode:'ledger'};
    state.worlds=[world];state.worldInstances={[world.id]:{sessions:[],activeSessionId:null}};state.activeWorldId=world.id;
    const sess=prepareCurrentWorldSession();sess.setupComplete=true;
    sess.history.push({id:'opening',role:'dm',text:'You wait beside the reception desk.',location:sess.playerLocation});
    switchView('worldPlay');renderWorldPlayState();
    const initialLocation=sess.playerLocation;let calls=0,repairProtocol=false;
    const plain=scenario==='observation_take_in'?'You take in the reception desk and its cracked bell.':scenario==='static_arrival'?'You are now in the Main Bullpen.':scenario==='unsolicited_pickup'?'You pocket the brass key.':scenario==='unsafe_arrival'?'You walk into the Main Bullpen and settle at a desk.':scenario==='pickup'?'You take the brass key and pocket it.':'The reception desk has a cracked bell. Rain taps against the window.';
    window.fetch=async(url,options={})=>{
     if(!String(url).includes('/chat/completions'))return new Response('{}',{headers:{'Content-Type':'application/json'}});
     calls++;const body=JSON.parse(options.body);let message;
     if(scenario==='timeout')return await new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
     if(!body.stream){
      repairProtocol=body.messages[0].content.includes('[WORLD SCENE DRAFT CORRECTION]')&&body.messages[0].content.includes('scene_draft_v2');
      message={content:scenario==='repair_protocol'?JSON.stringify({protocol:'scene_draft_v2',narrative:[{id:'a',text:'The drawer stays shut; you cannot inspect its contents yet.'}],actions:[{request:'I inspect the drawer.',kind:'physical',status:'blocked',response_id:'a'}],events:[],effects:{},speech:[],commitments:[]}):'invalid JSON'};
     }else if(scenario==='same_place'){
      const draft={protocol:'scene_draft_v2',narrative:[{id:'a',text:plain}],actions:[{request:'I look around.',kind:'observation',status:'resolved',response_id:'a'}],events:[{type:'movement',actor_id:'player',status:'completed',from_location_id:initialLocation,to_location_id:initialLocation,passage_id:'a'}],effects:{},speech:[],commitments:[]};
      message={tool_calls:[{id:'noop',index:0,type:'function',function:{name:'commit_world_turn',arguments:JSON.stringify(draft)}}]};
     }else message={content:plain};
     return body.stream?new Response(`data: ${JSON.stringify({choices:[{delta:message,finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}}):new Response(JSON.stringify({choices:[{message}]}),{headers:{'Content-Type':'application/json'}});
    };
    const timer=window.setTimeout;
    if(scenario==='timeout')window.setTimeout=(fn,ms,...args)=>timer(fn,ms===150000?15:ms,...args);
    const input=scenario==='prose_question'?'What is this place?':scenario==='repair_protocol'?'I inspect the drawer.':scenario==='pickup'?'I take the brass key.':'I look around.';
    document.getElementById('world-user-input').value=input;await executeWorldTurn();window.setTimeout=timer;
    results.push({scenario,calls,repairProtocol,source:sess.lastTurnStateSource,text:sess.history.at(-1)?.text,location:sess.playerLocation,initialLocation,inventory:sess.inventory,errors:sess.lastTurnAudit?.rejected,timeoutVisible:!document.getElementById('world-turn-error').classList.contains('hidden'),timeoutText:document.getElementById('world-turn-error-text').textContent});
   }
   const map={id:'legacy',locations:[{id:'a',name:'A',exits:['to B']},{id:'b',name:'B',exits:['to A']}],entities:[{id:'n',name:'N',type:'npc',startLocation:'a'}],kernel:{sceneDraftProtocol:'scene_draft_v2'}};
   const session={entityStates:{n:{location:'a'}}};
   const legacyRoute=!!findWorldTravelPath(map,'a','b',{npcId:'n',session});
   map.locations[1].placeAwareness={includeChildren:true,npcs:{},factions:{}};
   const emptyRulesRoute=!!findWorldTravelPath(map,'a','b',{npcId:'n',session});
   map.locations[1].placeAwareness={npcs:{n:'unknown'}};
   const deniedRoute=!!findWorldTravelPath(map,'a','b',{npcId:'n',session});
   return{results,legacyRoute,emptyRulesRoute,deniedRoute};
  },JSON.parse(fs.readFileSync(path.join(root,'Policy Panic at Bramble and Pike.horde_world'),'utf8')));
  console.log(JSON.stringify(result,null,2));
  for(const r of result.results){
   assert.equal(r.location,r.initialLocation,r.scenario);
   if(['prose_look','observation_take_in','prose_question','same_place'].includes(r.scenario)){assert.notEqual(r.source,'frozen_no_receipt',r.scenario);assert.equal(r.calls,1,r.scenario);assert(r.text.includes('cracked bell'));}
   if(r.scenario==='repair_protocol'){assert(r.repairProtocol,'V2 prose must be repaired as V2');assert.equal(r.source,'receipt_repair');}
   if(['unsafe_arrival','static_arrival','unsolicited_pickup','pickup'].includes(r.scenario))assert.equal(r.source,'frozen_no_receipt',r.scenario);
   if(r.scenario==='timeout'){assert(r.timeoutVisible);assert(r.timeoutText.includes('150s'));}
  }
  assert(result.emptyRulesRoute,'empty awareness placeholders do not opt old maps into strict place knowledge');assert(result.legacyRoute,'legacy authored maps retain NPC map knowledge');assert(!result.deniedRoute,'explicit unknown-place rule remains authoritative');
  console.log('PASS conversation recovery, V2 repair, no-op movement, rejected mutations, persistent timeout and legacy map compatibility');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
