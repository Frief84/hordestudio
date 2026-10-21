'use strict';
const assert = require('node:assert/strict');
const ctx = require('../worlds/turn-context');
const history = [{ id: 'old', role: 'dm', text: 'A secret in the cellar.', location: 'cellar' },
    { id: 'now', role: 'user', text: 'I leave the cellar.', location: 'cellar' }];
const options = { history, start: 1, budget: 500, location: 'hall', locations: [{id:'cellar', name:'Cellar'}], text: m => m.text };
const selected = ctx.history(options);
assert.equal(selected[1].content, 'I leave the cellar.');
assert.match(selected[0].content, /HIDDEN FROM PRESENT NPCs/);
assert.throws(() => ctx.history({...options,budget:1}), /current player action/);
const memory = ctx.sceneMemory({receipt:{events:[],state_updates:{}},speech:[{speaker:'x',listeners:['y'],statement:'The key is red.'}]},'r1','hall',1);
assert.equal(memory.records[0].kind, 'testimony');
const source = [{id:'m1',sceneMemory:memory}];
assert.match(ctx.recall(source,'key','hall'), /sourceMessageId/);
assert.equal(ctx.recall([], 'key', 'hall'), '', 'deleted sources cannot leave ghost summaries');
assert.equal(ctx.recall(source,'key','hall',1), '', 'recall obeys budget');
const failed=[...history,{role:'dm',text:'Unverified reply discarded.',stateSource:'frozen_no_receipt'},
    {role:'user',text:'A fresh action.'}];
const retryContext=ctx.history({...options,history:failed,start:3});
assert(!JSON.stringify(retryContext).includes('Unverified'));
assert(!JSON.stringify(retryContext).includes('I leave the cellar.'));
const packet = { locationId: 'hall', narrator: [
    { id: 'public', text: 'The gate opens with a brass key.' },
    { id: 'private', text: 'The cellar hides a map.' }],
    npcKnowledge: { keeper: [{ id: 'public', text: 'The gate opens with a brass key.' }],
        stranger: [{ id: 'missing', text: 'Older unknown format remains readable.' }] },
    npcPlaces: { keeper: ['hall'], stranger: [] },
    places: [{ id: 'hall', description: 'A long hall.', connections: [{ targetId: 'cellar' }] }],
    movementOptions: [{ actor_id: 'player', allowed_next: [{ to: 'cellar' }] }],
    selection: { characters: 100 } };
const originalPacket = structuredClone(packet);
const compact = ctx.loreForPrompt(packet, 'A long hall. A new bell rings.', 'A long hall.');
assert.equal(compact.currentDescription, 'A new bell rings.');
assert.deepEqual(compact.packet.npcKnowledge.keeper, ['public']);
assert.deepEqual(compact.packet.npcKnowledge.stranger, originalPacket.npcKnowledge.stranger,
    'an unknown older fact shape is never discarded');
assert.deepEqual(compact.packet.places[0].connections, originalPacket.places[0].connections);
assert.deepEqual(compact.packet.movementOptions, originalPacket.movementOptions);
assert(!('npcPlaces' in compact.packet) && !('selection' in compact.packet));
assert.deepEqual(packet, originalPacket, 'prompt projection cannot mutate canonical lore');
assert.equal(ctx.loreForPrompt({ ...packet, places: [{ id: 'hall', description: 'A long' }] },
    'A long hall.', 'A long hall.').currentDescription, 'A long hall.',
    'a truncated lore description cannot replace the full current description');
const selectedSources = ctx.historySources('A promise\nThe gate opens',
    'A promise\nA new warning\nA new warning',
    '\n\n[MEMORY MATRIX: CONTEXTUAL FRAGMENTS]\nOld facts:\n[WORLD HISTORY]: A promise\n[LOCAL MEMORY]: A distinct witness said so.');
assert.equal(selectedSources.archive, 'A new warning');
assert(!selectedSources.matrix.includes('[WORLD HISTORY]: A promise'));
assert(selectedSources.matrix.includes('[LOCAL MEMORY]: A distinct witness said so.'));
assert.equal(ctx.historySources('', '', 'Older memory format').matrix, 'Older memory format');
assert.equal(ctx.sourceLinkedRecall(''), '');
assert(ctx.sourceLinkedRecall('{"sourceMessageId":"old"}').includes('sourceMessageId'));
if (process.env.HORDE_CONTEXT_PROFILE === '1') {
    const { performance } = require('node:perf_hooks');
    for (const length of [40, 1000]) {
        const entries = Array.from({ length }, (_, index) => ({
            id: `scene_${index}`, role: 'dm', location: index % 2 ? 'hall' : 'cellar',
            sceneMemory: { receiptId: `receipt_${index}`, turn: index, records: [{
                kind: 'event', actor: 'keeper', witnesses: ['keeper'],
                text: `The keeper filed silver compass record ${index}.`
            }] }
        }));
        const began = performance.now(), cpu = process.cpuUsage();
        for (let iteration = 0; iteration < 100; iteration++)
            ctx.recall(entries, 'silver compass', 'hall', 4500, [], { actorIds: ['keeper'] });
        const spent = process.cpuUsage(cpu);
        console.log('RECALL_PROFILE', JSON.stringify({ historyLength: length, calls: 100,
            wallMs: Math.round(performance.now() - began),
            cpuMs: Math.round((spent.user + spent.system) / 1000),
            heapUsedBytes: process.memoryUsage().heapUsed }));
    }
}
console.log('PASS context selection, testimony provenance, source deletion and budget');
