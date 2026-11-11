const assert=require('node:assert/strict');const c=require('../worlds/model-client');
(async()=>{
for(const where of ['headers','body']){const ac=new AbortController();const calls=[];const p=c.json({url:'x',body:{},init:{signal:ac.signal},fetcher:()=>where==='headers'?new Promise(()=>{}):Promise.resolve({ok:true,status:200,text:()=>new Promise(()=>{})}),onSettled:x=>calls.push(x)});ac.abort(new DOMException('deadline','TimeoutError'));await assert.rejects(p,{name:'TimeoutError'});assert.equal(calls.length,1);assert.equal(calls[0].outcome,'timeout')}
assert.equal(c.responseError({status:404},{error:{message:'model gemma not found'}}).code,'WORLD_MODEL_UNAVAILABLE');
let pause=0,resume=0,requests=[];const ac=new AbortController();
const loaded=await c.prepareLocalModel({url:'http://localhost:11434/v1',model:'gemma',signal:ac.signal,onLoading:()=>pause++,onLoaded:()=>resume++,fetcher:async(url,init)=>{requests.push(url);if(url.endsWith('/api/ps'))return Response.json({models:[]});assert.deepEqual(JSON.parse(init.body),{model:'gemma',messages:[],stream:false});return Response.json({done:true})}});assert(loaded);assert.equal(pause,1);assert.equal(resume,1);assert.equal(requests.length,2);
requests=[];await c.prepareLocalModel({url:'http://localhost:11434/v1',model:'gemma',signal:ac.signal,fetcher:async url=>{requests.push(url);return Response.json({models:[{name:'gemma'}]})},onLoading:()=>{throw Error('warm model paused')}});assert.equal(requests.length,1);
assert.equal(await c.prepareLocalModel({url:'http://localhost:1234/v1',model:'gemma',fetcher:()=>{throw Error('other provider probed')}}),false);
const stop=new AbortController();let finish;const pending=c.prepareLocalModel({url:'http://localhost:11434/v1',model:'gemma',signal:stop.signal,onLoading:()=>{},onLoaded:()=>finish=true,fetcher:async url=>url.endsWith('/api/ps')?Response.json({models:[]}):new Promise(()=>{})});await new Promise(r=>setTimeout(r,5));stop.abort();await assert.rejects(pending,{name:'AbortError'});assert(finish);
console.log('PASS communication: external timeout headers/body, missing model, cold/warm/other provider, cancellable loading');
})().catch(e=>{console.error(e);process.exitCode=1});
