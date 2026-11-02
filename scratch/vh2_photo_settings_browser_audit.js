'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,launchOptions}=require('./browser_runtime').browserRuntime();const root=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch(launchOptions);try{
 const context=await browser.newContext();await context.route('**/*',route=>{
  const url=new URL(route.request().url());if(url.hostname!=='photo-settings.test')return route.abort();
  const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
  return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'text/css'});
 });const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('https://photo-settings.test');await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);
 const result=await page.evaluate(async()=>{
  clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);
  const c=normalizeCompanion({id:'photo-settings-fixture',name:'Photo fixture',age:30,imageSource:'comfyui',basePhoto:'IDENTITY'});
  state.companions=[c];state.editingCompanionId=c.id;state.activeCompanionId=c.id;state.companionThreads={};state.companionTimelines={};ensureCompanionTimelineStore(c.id);
  const saved={configured:true,provider:'gemini',model:'fixture/image',hasKey:true,enabled:true,dailyLimit:3,explicitDailyLimit:7,maxReferences:3,imageParameters:{},imageProviderOptions:{}};
  let submitted=null;mcpBridgeRequest=async(path,options={})=>{if(path.startsWith('/vh2/image-provider')){if(options.method==='POST'){submitted=options.body;return {...saved,...options.body};}return saved;}return{};};
  renderCompanionStudioForm();await loadCompanionVh2PhotoSettings(c);
  const loaded=[document.getElementById('cs-vh2-photo-daily-limit').value,document.getElementById('cs-vh2-explicit-photo-daily-limit').value];
  document.getElementById('cs-vh2-explicit-photo-daily-limit').value='9';document.getElementById('cs-vh2-photo-behaviour').value='request_only';
  await document.getElementById('cs-vh2-photo-settings-save').onclick();
  const prompt=buildCompanionPhotoPrompt(c,'Reading quietly',{photoContext:{zoneId:'corner',zoneDescription:'Blue reading corner',outfit:'green sweater'}});
  const old=c.lifeProfile;c.lifeProfile={...old,places:[{id:'home',label:'Home',photo:'OLD_HOME'}]};
  const references=companionPhotoReferences(c,'A photograph in the garden wearing a red coat.',{photoContext:{roomId:'home',bibleRoles:[{role:'garment',label:'Old coat'},{role:'place',label:'Home'}]},bibleReferences:['OLD_COAT','OLD_HOME'],previousPhoto:{photo:'OLD_PHOTO'}});
  let release;const oldRequest=mcpBridgeRequest;mcpBridgeRequest=()=>new Promise(resolve=>{release=resolve;});
  const pending=loadCompanionVh2PhotoSettings(c);document.getElementById('cs-vh2-photo-daily-limit').value='11';release(saved);await pending;mcpBridgeRequest=oldRequest;
  const dirtyDaily=document.getElementById('cs-vh2-photo-daily-limit').value;
  return{dirtyDaily,loaded,submitted,status:document.getElementById('cs-vh2-photo-budget-status').textContent,mode:c.photoBehaviorMode,zonePrompt:prompt,references};
 });assert.deepEqual(result.loaded,['3','7']);assert.equal(result.submitted.dailyLimit,3);assert.equal(result.submitted.explicitDailyLimit,9);assert.equal(result.submitted.apiKey,'');assert.equal(result.submitted.provider,'gemini');assert.equal(result.submitted.model,'fixture/image');assert.equal(result.mode,'request_only');assert.match(result.status,/Saved/);assert.equal(result.dirtyDaily,'11');assert.match(result.zonePrompt,/Blue reading corner/);assert.deepEqual(result.references,['IDENTITY']);assert.deepEqual(errors,[]);console.log('PASS photo settings loaded/saved, provider/key preservation, room-zone prompt and explicit scene reference priority');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
