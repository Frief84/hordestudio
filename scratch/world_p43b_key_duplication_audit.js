/** Deterministic proof that the Vault's starting key remains loose as well as owned. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const linked = require('../worlds/linked-world-actions');
const world = JSON.parse(fs.readFileSync(path.join(__dirname,
    'world-model-p43b-2026-10-27/The_Submission_Vault_source.horde_world'), 'utf8'));
const key = world.entities.find(item => item.type === 'item' && item.name === 'Cell key');
assert(key && key.startLocation === 'loc_antechamber');
const session = { id: 'isolated_key_probe', playerLocation: 'loc_antechamber',
    inventory: ['Cell key'], entityStates: {}, turnCount: 1 };
const plan = { actions: [{ action_id: 'take_key', kind: 'physical', status: 'resolved',
    request: 'I take the Cell key from the Antechamber.', response_id: 'p',
    action_effects: { item_transfer: [{ item_id: key.id, from_id: 'loc_antechamber',
        to_id: 'player' }] } }],
    narrative: [{ id: 'p', action_id: 'take_key', text: 'You take the Cell key.' }],
    events: [{ id: 'e', action_id: 'take_key', passage_id: 'p', type: 'inventory',
        actor_id: 'player', status: 'completed', action: 'take', item: 'Cell key' }] };
const result = linked.executeLinkedActions(plan, world, session,
    { requireEffectWitnesses: true });
assert(result.ok, JSON.stringify(result.errors));
const prepared = result.working.prepare().session;
assert.equal(prepared.inventory.filter(item => (item?.name || item) === 'Cell key').length, 2);
assert.equal(prepared.entityStates[key.id].location, '');
assert.equal(session.inventory.filter(item => (item?.name || item) === 'Cell key').length, 1);
(async () => {
    let saved;
    await result.working.commit(async candidate => { saved = JSON.stringify(candidate); });
    const reloaded = JSON.parse(saved).session;
    assert.equal(reloaded.inventory.filter(item => (item?.name || item) === 'Cell key').length, 2);
    assert.equal(reloaded.entityStates[key.id].location, '');
    console.log('PASS Vault registered key duplicates Master key through commit and reload');
})().catch(error => { console.error(error); process.exitCode = 1; });
