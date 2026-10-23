'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,launchOptions}=require('./browser_runtime').browserRuntime();
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch(launchOptions);
 try {
 const context=await browser.newContext();await context.route('**/*',route=>{
  const url=new URL(route.request().url());if(url.hostname!=='scene-ledger.test')return route.abort();
  const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
  return route.fulfill({contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://scene-ledger.test/');await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&companionAgencyTimer);
 const results=await page.evaluate(async()=>{
  clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);state.apiKey='offline';state.globalSettings.apiProvider='local';state.globalSettings.localBaseUrl='http://127.0.0.1:1234/v1';
  const world={id:'ledger_fixture',name:'Pool day',model:'fixture/model',contextSize:32768,maxTokens:2048,dmPrompt:'Social roleplay.',intro:'',startLocationId:'room',locations:[{id:'room',name:'Room',exits:['to Pool']},{id:'pool',name:'Pool',exits:['to Room']}],entities:['maya','alice','bea','clara'].map(id=>({id,name:id,type:'npc',startLocation:'room',persona:'A guest'})),kernel:{enabled:true,sceneLedger:true,memoryMode:'ledger'},hudConfig:{startTimeHours:8,timeStep:5}};
  state.worlds=[world];state.worldInstances={[world.id]:{sessions:[],activeSessionId:null}};state.activeWorldId=world.id;
  const sess=prepareCurrentWorldSession();sess.setupComplete=true;sess.history.push({id:'opening',role:'dm',text:'Four guests wait in the room.',location:'room'});switchView('worldPlay');renderWorldPlayState();
  const drafts=[],requests=[];const realFetch=window.fetch;
  window.fetch=async(url,options={})=>{
   if(!String(url).includes('/chat/completions'))return realFetch(url,options);
   const body=JSON.parse(options.body);requests.push(body);const proposal=drafts[0];if(!proposal)throw Error('Unexpected provider request');
   const message={tool_calls:[{id:'ledger_call_'+requests.length,index:0,type:'function',function:{name:'commit_world_turn',arguments:JSON.stringify(proposal)}}]};
   if(body.stream)return new Response(`data: ${JSON.stringify({choices:[{delta:message,finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}});
   return new Response(JSON.stringify({choices:[{message}]}),{headers:{'Content-Type':'application/json'}});
  };
  const proposal=(place,cast,groups=[],departures=[])=>({protocol:'scene_draft_v2',narrative:[{id:'p1',text:place==='pool'?'Warm pool water surrounds you. The guests chat nearby.':'The room is quiet, and the conversation continues.'}],ending_scene:{location_id:place,present_character_ids:cast,groups,departures}});
  async function turn(input,p){drafts[0]=p;document.getElementById('world-user-input').value=input;await executeWorldTurn();return {location:sess.playerLocation,cast:buildWorldSceneFrame(world,sess).present_character_ids,record:structuredClone(sess.sceneRecord),audit:structuredClone(sess.lastTurnAudit),text:sess.history.at(-1).text,source:sess.lastTurnStateSource};}
  const pool=await turn('I go to the pool.',proposal('pool',['maya','alice','bea','clara']));
  const dialogue=await turn('Hello everyone.',proposal('pool',['maya','alice','bea','clara'],[{id:'visitors',label:'other visitors',count:2}]));
  const omission=await turn('What do you think?',proposal('pool',['maya'],[{id:'visitors',label:'other visitors',count:2}]));
  const departure=await turn('Goodbye, Clara.',proposal('pool',['maya','alice','bea'],[{id:'visitors',label:'other visitors',count:2}],[{actor_id:'clara',to_location_id:'room'}]));
  drafts[0]=proposal('pool',['maya','alice','bea'],[{id:'visitors',label:'other visitors',count:5}],[{actor_id:'clara',to_location_id:'room'}]);
  await executeWorldTurn(true);
  const rerolled=sess.history.at(-1);const rerollRecord=rerolled.sceneRecord?.groups?.[0]?.count===5 && rerolled.versions?.length===2 && rerolled.versionTakeMetadata[0].sceneRecord.groups[0].count===2 && rerolled.versionTakeMetadata[1].sceneRecord.groups[0].count===5;
  world.gameRules={profileId:'full_rpg',modules:{schedules:true,livingWorld:true}};
  world.hudConfig.enableSchedules=true;
  sess.npcScheduleOverrides.maya=[{time:'00:00',locationId:'room',activity:'Go home'}];
  sess.entityStates.maya.pinnedUntilTurn=0;
  const longRun=[];
  for(let i=0;i<100;i++) {const r=await turn('Continue our conversation.',proposal('pool',['maya','alice','bea'],[{id:'visitors',label:'other visitors',count:2}]));longRun.push(r.location==='pool'&&r.cast.includes('maya')&&r.source==='tool_call');}
  const checkpoint=captureWorldTurnState(world,sess);
  const ledgerBefore=structuredClone(sess.sceneRecord);sess.sceneRecord.groups=[];restoreWorldTurnState(world,sess,checkpoint);
  const restored=JSON.stringify(sess.sceneRecord)===JSON.stringify(ledgerBefore);
  const save=saveWorldsState;saveWorldsState=async()=>{throw Error('Injected correction storage failure');};
  let correctionFailed=false;
  try{await correctWorldState(world,sess,{actor:'player',location:'room',minute:getWorldTimeData(world,sess).currentTotalMinutes,reason:'Storage fault'});}catch(e){correctionFailed=e.message.includes('storage failure');}finally{saveWorldsState=save;}
  const failedCorrectionPreserved=JSON.stringify(sess.sceneRecord)===JSON.stringify(ledgerBefore)&&sess.playerLocation==='pool';
  const before=captureWorldTurnState(world,sess);const version=sess.worldStateVersion;
  const bad=await turn('Tell me more.',proposal('missing',['maya']));
  const rollback={location:sess.playerLocation,cast:buildWorldSceneFrame(world,sess).present_character_ids,groups:sess.sceneRecord.groups,versionBefore:version,versionAfter:sess.worldStateVersion};
  restoreWorldTurnState(world,sess,before);renderWorldPlayState();
  await correctWorldState(world,sess,{actor:'player',location:'room',minute:getWorldTimeData(world,sess).currentTotalMinutes,reason:'Correct the scene location'});renderWorldPlayState();
  const correction=structuredClone(sess.sceneRecord);await saveWorldsState();
  openWorldStudio(world.id);
  const editorLoaded=document.querySelector('#w-kernel-scene-mode').value==='ledger';
  document.querySelector('#w-kernel-scene-mode').value='strict';await saveWorld();
  const editorDisabled=state.worlds.find(w=>w.id===world.id).kernel.sceneLedger===false;
  openWorldStudio(world.id);document.querySelector('#w-kernel-scene-mode').value='linked';await saveWorld();
  if(state.worlds.find(w=>w.id===world.id).kernel.sceneDraftProtocol!=='scene_draft_v3')throw Error('Linked preview selection was not saved');
  openWorldStudio(world.id);document.querySelector('#w-kernel-scene-mode').value='ledger';await saveWorld();
  const editorEnabled=state.worlds.find(w=>w.id===world.id).kernel.sceneLedger===true;
  state.activeWorldId=world.id;switchView('worldPlay');renderWorldPlayState();
  const saved=await HordeDB.get('worldInstance:'+world.id);
  const schema=(requests[0].tools?.find(t=>t.function.name==='commit_world_turn')?.function.parameters || requests[0].response_format.json_schema.schema);
  return {editorLoaded,editorDisabled,editorEnabled,rerollRecord,longRun,restored,correctionFailed,failedCorrectionPreserved,pool,dialogue,omission,departure,bad,rollback,correction,saved,requests:requests.length,schema,summary:document.querySelector('#world-scene-record-summary').textContent,historyRecords:sess.history.filter(m=>m.sceneRecord).length};
 });
 console.log(JSON.stringify({requests:results.requests,pool:results.pool,rollback:results.rollback,longRunPassed:results.longRun.filter(Boolean).length,correction:results.correction},null,2));
 assert(results.editorLoaded&&results.editorDisabled&&results.editorEnabled);assert(results.rerollRecord);assert(results.longRun.every(Boolean));assert(results.restored);assert(results.correctionFailed&&results.failedCorrectionPreserved);
 assert.equal(results.pool.location,'pool');assert.equal(results.pool.source,'tool_call');assert.equal(results.pool.cast.length,4);
 assert.equal(results.dialogue.record.groups[0].count,2);assert.equal(results.omission.cast.length,4);assert(!results.departure.cast.includes('clara'));
 assert.equal(results.bad.source,'frozen_no_receipt');assert.equal(results.rollback.location,'pool');assert.equal(results.rollback.groups[0].count,2);
 assert.equal(results.correction.location_id,'room');assert.deepEqual(results.correction.groups,[]);assert(results.summary.includes('Room'));
 assert(results.saved.sessions.some(s=>s.sceneRecord?.location_id==='room'));assert(results.historyRecords>=4);
 assert.deepEqual(results.schema.required,['protocol','narrative','ending_scene']);assert.deepEqual(errors,[]);
 await page.reload();await page.waitForFunction(()=>window.__hordeStartup?.readyMs);assert(await page.evaluate(()=>state.worlds.find(w=>w.id==='ledger_fixture').kernel.sceneLedger));
 console.log('PASS: compact schema, pool/group travel, conversation, cast omissions, explicit departure, invalid scene rollback, correction, ledger entries and persisted reload.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
