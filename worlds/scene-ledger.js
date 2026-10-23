/* Opt-in roleplay adapter. A compact ending scene becomes ordinary validated
 * engine operations; it never writes state or guesses facts from prose. */
(function(root) {
'use strict';
const clone = x => JSON.parse(JSON.stringify(x));
const object = x => x && typeof x === 'object' && !Array.isArray(x);
function schema(base) {
    const result = clone(base);
    result.properties.ending_scene = {
        type:'object', additionalProperties:false,
        required:['location_id','present_character_ids','groups'],
        properties:{
            location_id:{type:'string',maxLength:120,description:'Exact ending location ID. A mention, plan or flashback does not move the player.'},
            present_character_ids:{type:'array',maxItems:32,items:{type:'string',maxLength:120},description:'Established foreground NPCs physically present at the ending location. Use existing IDs; register new speakers in effects.npc_introduced.'},
            groups:{type:'array',maxItems:12,items:{type:'object',additionalProperties:false,required:['id','label','count'],properties:{id:{type:'string',maxLength:80},label:{type:'string',maxLength:120},count:{type:'integer',minimum:1,maximum:1000}}},description:'Anonymous background groups only; exclude individually tracked NPCs.'},
            departed_group_ids:{type:'array',maxItems:12,items:{type:'string',maxLength:80},description:'IDs of anonymous groups that explicitly left. Omitted groups otherwise remain in the same scene.'},
            departures:{type:'array',maxItems:32,items:{type:'object',additionalProperties:false,required:['actor_id','to_location_id'],properties:{actor_id:{type:'string',maxLength:120},to_location_id:{type:'string',maxLength:120}}},description:'Explicit completed departures. Omission from cast never teleports or deletes an actor.'}
        }
    };
    result.required=['protocol','narrative','ending_scene'];
    for (const key of ['actions','events','speech','commitments','resolutions','effects']) result.properties[key].description =
        'Optional. Supply only when needed for enabled mechanics or durable knowledge. '+(result.properties[key].description || '');
    return result;
}
function prepare(raw, context) {
    const errors=[];
    const fail=(reason,detail)=>errors.push({type:'scene_record',reason,detail});
    const draft=clone(raw);
    const scene=draft.ending_scene;
    if (!object(scene)) return {ok:false,errors:[{type:'scene_record',reason:'missing_ending_scene'}]};
    if (Object.keys(scene).some(k=>!['location_id','present_character_ids','groups','departures','departed_group_ids'].includes(k))) fail('unsupported_scene_field','Ending scene contains unsupported fields.');
    const effects=draft.effects || {};
    if (!object(effects)) return {ok:false,errors:[{type:'scene_record',reason:'invalid_scene_effects'}]};
    for (const key of ['actions','events','speech','commitments','resolutions']) if (draft[key]!==undefined && !Array.isArray(draft[key])) fail('invalid_scene_list',key);
    for (const key of ['location_introduced','npc_introduced','checks']) if (effects[key]!==undefined && !Array.isArray(effects[key])) fail('invalid_scene_list','effects.'+key);
    if (errors.length) return {ok:false,errors};
    const locations=new Set(context.locations);
    for (const l of effects.location_introduced || []) if (l?.id) locations.add(l.id);
    if (typeof scene.location_id!=='string' || !locations.has(scene.location_id)) fail('unknown_scene_location',String(scene.location_id));
    const introductions=effects.npc_introduced || [];
    const actors=new Map(context.actors.map(a=>[a.id,a]));
    for (const a of introductions) if (a?.id) {
        if (actors.has(a.id)) fail('duplicate_introduced_actor',a.id);
        else actors.set(a.id,{id:a.id,location:scene.location_id,introduced:true,active:true});
    }
    if (!Array.isArray(scene.present_character_ids) || scene.present_character_ids.length>32 || new Set(scene.present_character_ids).size!==scene.present_character_ids.length) fail('invalid_scene_cast','Use unique NPC IDs.');
    if (errors.length) return {ok:false,errors};
    for (const id of scene.present_character_ids || []) if (!actors.has(id) || !actors.get(id).active) fail('unknown_or_inactive_scene_actor',String(id));
    if (!Array.isArray(scene.groups) || scene.groups.length>12) fail('invalid_scene_groups','Use a bounded list of anonymous groups.');
    if (errors.length) return {ok:false,errors};
    const groupIds=new Set();
    for (const g of scene.groups || []) {
        if (!object(g) || Object.keys(g).some(k=>!['id','label','count'].includes(k)) || typeof g.id!=='string' || !g.id.trim() || g.id.length>80 || typeof g.label!=='string' || !g.label.trim() || g.label.length>120 || !Number.isInteger(g.count) || g.count<1 || g.count>1000 || groupIds.has(g.id) || actors.has(g.id)) fail('invalid_scene_group','Groups need unique IDs, labels and bounded integer counts.');
        else groupIds.add(g.id);
    }
    if (scene.departures!==undefined && (!Array.isArray(scene.departures) || scene.departures.length>32)) fail('invalid_scene_departures','Use a bounded departure list.');
    const priorGroups=context.location===scene.location_id ? context.groups || [] : [];
    const departedGroups=scene.departed_group_ids || [];
    if (!Array.isArray(departedGroups) || departedGroups.length>12 || new Set(departedGroups).size!==departedGroups.length || departedGroups.some(id=>typeof id!=='string' || !priorGroups.some(g=>g.id===id) || groupIds.has(id))) fail('invalid_group_departure','Only established groups may explicitly leave.');
    if (errors.length) return {ok:false,errors};
    for (const g of priorGroups) if (!groupIds.has(g.id) && !departedGroups.includes(g.id)) scene.groups.push(clone(g));
    if (scene.groups.length>12) return {ok:false,errors:[{type:'scene_record',reason:'too_many_scene_groups'}]};
    const passages=Array.isArray(draft.narrative)?draft.narrative:[];
    const first=passages[0]?.id;
    if (!first) return {ok:false,errors:[{type:'scene_record',reason:'missing_scene_passage'}]};
    draft.effects=effects;draft.events=draft.events || [];draft.speech=draft.speech || [];
    draft.commitments=draft.commitments || [];draft.resolutions=draft.resolutions || [];
    draft.actions=draft.actions || (context.input ? [{request:context.input,kind:'other',status:effects.checks?.length?'pending_check':'answered',response_id:first}] : []);
    const proposedMoves=new Map();
    for (const event of draft.events) if (event?.type==='movement' && event.status==='completed') {
        if (proposedMoves.has(event.actor_id)) fail('ambiguous_scene_movement',event.actor_id);
        proposedMoves.set(event.actor_id,event.to_location_id);
    }
    const addMove=(id,from,to)=> {
        if (from===to) return;
        if (proposedMoves.has(id)) { if (proposedMoves.get(id)!==to) fail('conflicting_scene_movement',id);return; }
        draft.events.push({type:'movement',status:'completed',actor_id:id,from_location_id:from || '',to_location_id:to,movement_mode:'voluntary',...(id!=='player'?{explore:true}:{}),passage_id:first});
        proposedMoves.set(id,to);
    };
    addMove('player',context.location,scene.location_id);
    for (const id of scene.present_character_ids) {
        const actor=actors.get(id);
        if (!actor.introduced) addMove(id,actor.location,scene.location_id);
    }
    const departing=new Set();
    for (const entry of scene.departures || []) {
        if (!object(entry) || Object.keys(entry).some(k=>!['actor_id','to_location_id'].includes(k)) || !actors.has(entry.actor_id) || !actors.get(entry.actor_id).active || !locations.has(entry.to_location_id) || scene.present_character_ids.includes(entry.actor_id) || entry.to_location_id===scene.location_id || departing.has(entry.actor_id)) { fail('invalid_scene_departure',String(entry?.actor_id));continue; }
        departing.add(entry.actor_id);addMove(entry.actor_id,actors.get(entry.actor_id).location,entry.to_location_id);
    }
    // Cast omissions preserve existing occupants, rather than inventing a departure.
    for (const actor of context.actors) if (actor.active && actor.location===scene.location_id && !departing.has(actor.id) && !proposedMoves.has(actor.id) && !scene.present_character_ids.includes(actor.id)) scene.present_character_ids.push(actor.id);
    if (effects.checks?.length && proposedMoves.size) fail('pending_check_scene_transition','Resolve the check before changing the scene.');
    delete draft.ending_scene;
    return errors.length ? {ok:false,errors} : {ok:true,draft,scene:clone(scene)};
}
function groups(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(g=>object(g) && typeof g.id==='string' && g.id.trim() && g.id.length<=80 && typeof g.label==='string' && g.label.trim() && g.label.length<=120 && Number.isInteger(g.count) && g.count>=1 && g.count<=1000).slice(0,12).map(g=>({id:g.id,label:g.label,count:g.count}));
}
function record(frame,groups,revision,turnId) {
    return {location_id:frame.player_location_id,present_character_ids:[...frame.present_character_ids],groups:clone(groups || []),revision,source_turn:turnId,status:'established'};
}
root.HordeWorldSceneLedger={schema,prepare,record,groups};
if (typeof module!=='undefined') module.exports=root.HordeWorldSceneLedger;
})(globalThis);
