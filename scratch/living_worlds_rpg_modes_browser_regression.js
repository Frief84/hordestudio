'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,launchOptions}=require('./browser_runtime').browserRuntime();
const root=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch(launchOptions);try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const url=new URL(route.request().url());
  if(url.hostname!=='rpg-audit.test')return route.abort();
  const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
  return route.fulfill({contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
 });
 await page.goto('https://rpg-audit.test/');await page.waitForFunction(()=>typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
 const ids=[];
 for(const profile of ['pure_narrative','slice_of_life','full_rpg']){
  await page.evaluate(()=>{clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);document.getElementById('modal-overlay').classList.add('hidden');createNewWorld();document.querySelector('.world-studio-tab[data-tab="w-hud"]').click();});
  await page.locator('#w-rules-profile').selectOption(profile);
  const result=await page.evaluate(async()=>{const chosen=document.getElementById('w-rules-profile').value;
   const modules=structuredClone(normalizeWorldGameRules(state.editingWorld).modules);
   await saveWorld();return{id:state.editingWorld.id,chosen,modules};});
  assert.equal(result.chosen,profile);ids.push({...result,profile});
 }
 assert.equal(ids[0].modules.checks,false);assert.equal(ids[0].modules.inventory,false);
 assert.equal(ids[2].modules.checks,true);assert.equal(ids[2].modules.inventory,true);
 await page.reload();await page.waitForFunction(ids=>ids.every(x=>state.worlds.some(w=>w.id===x.id)),ids);
 const stored=await page.evaluate(ids=>ids.map(x=>({id:x.id,profile:state.worlds.find(w=>w.id===x.id)?.gameRules?.profileId})),ids);
 assert.deepEqual(stored.map(x=>x.profile),ids.map(x=>x.profile));assert.deepEqual(errors,[]);
 console.log('PASS RPG Off, Light, Full: UI selection, module gating, save and reload');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
