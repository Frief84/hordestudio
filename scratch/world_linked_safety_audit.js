'use strict';
const assert=require('node:assert/strict');
const {executeLinkedActions}=require('../worlds/linked-world-actions');
const world={id:'safety',entities:[{id:'key',name:'Bronze key',type:'item'},{id:'guide',name:'Guide',type:'npc'}],locations:[{id:'a',name:'Foyer',exits:[{targetLocationId:'b',travelTime:60}]},{id:'b',name:'Vault',exits:[{targetLocationId:'a',travelTime:60}]}]};
const initial={id:'safety_session',playerLocation:'a',inventory:[],entityStates:{player:{location:'a'},key:{location:'b'},guide:{location:'b',inventory:['Coin']}},unlockedExits:{},locationStates:{},npcRelationships:{},engineEvents:[],turnCount:1,bonusTimeMinutes:0,worldStateVersion:1};
const action=(id,kind,effects)=>({action_id:id,kind,status:'resolved',action_effects:effects});
const run=(actions,session=initial)=>executeLinkedActions({actions,events:[],narrative:actions.map(a=>({action_id:a.action_id,text:'The requested step completes.'}))},world,structuredClone(session));
for(const transfer of [{item_id:'key',from_id:'b',to_id:'player'},{item_id:'Coin',from_id:'guide',to_id:'player'}]){const r=run([action('take','physical',{item_transfer:[transfer]})]);assert(!r.ok);assert.equal(r.errors[0].blockageReason,'transfer_out_of_reach');}
const local=structuredClone(initial);local.entityStates.key.location='a';const pickup=run([action('take','physical',{item_transfer:[{item_id:'key',from_id:'a',to_id:'player'}]})],local);assert(pickup.ok);assert.deepEqual(pickup.working.getSession('inventory'),['Bronze key']);
const movement={actor_move:[{actor_id:'player',to_location_id:'b'}]};
const look=run([action('look','observation',movement)]);assert(!look.ok);assert.equal(look.errors[0].blockageReason,'unrequested_player_movement');
const travel=run([action('go','travel',movement)]);assert(travel.ok);assert.equal(travel.elapsedMinutes,60);
const stated=run([action('go','travel',{...movement,time_advance:[{minutes:60}]})]);assert(stated.ok);assert.equal(stated.elapsedMinutes,60,'a stated journey duration and engine minimum must not add twice');
const waitThenTravel=run([action('wait','wait',{time_advance:[{minutes:30}]}),action('go','travel',movement)]);assert(waitThenTravel.ok);assert.equal(waitThenTravel.elapsedMinutes,90,'a separate wait remains additional to journey time');
assert.equal(initial.playerLocation,'a');assert.deepEqual(initial.inventory,[]);assert.equal(initial.bonusTimeMinutes,0);
console.log('PASS linked safety: spatial pickup/transfer, observation scope, route duration, explicit-time deduplication, separate waits and immutable canonical input.');
