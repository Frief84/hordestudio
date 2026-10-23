/** Exact-count Architect batches must remain small, typed and resumable. */
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildContext } = require('./app_source.js');
const HordeWorldLore = require('../assets/worlds/world-lore.js');

const snapshots = [];
let calls = 0;
let issued = 0;
let failAfterFirstChunk = false;
const context = {
    console: { log() {}, warn() {}, error() {} }, HordeWorldLore,
    state: { editingWorld: null },
    worldArchitectSyncBasics() {}, renderWorldArchitectAgent() {},
    async persistWorldArchitectCheckpoint(world) {
        snapshots.push({ status: world.architectJob.status,
            operations: world.architectJob.operations.length });
    },
    async worldArchitectJSON(_world, _model, messages) {
        calls++;
        assert(messages[0].content.includes('exactly 4 operations'));
        assert(messages[1].content.includes('CURRENT WORLD INDEX (valid JSON)'));
        if (failAfterFirstChunk && issued === 4) return {
            operations: [{ type: 'update_location', targetId: 'loc_inn', fields: { name: 'Inn' } }]
        };
        if (calls === 1) return { operations: [{ type: 'update_location', targetId: 'loc_inn' }] };
        const operations = Array.from({ length: 4 }, (_, index) => ({
            type: 'add_item', record: { id: `item_${issued + index + 1}`,
                name: `Object ${issued + index + 1}`, description: 'A distinct authored object.' }
        }));
        issued += operations.length;
        return { operations };
    }
};
buildContext(vm, ['runWorldArchitectJob', 'worldArchitectFingerprint',
    'defaultWorldArchitectPlan'], context);

const world = {
    id: 'w', name: 'Test World', description: 'A small existing world.', authoringRevision: 0,
    startLocationId: 'loc_inn', regions: [],
    locations: [{ id: 'loc_inn', name: 'Inn', mapType: 'building', exits: [] }],
    entities: [], groups: [], factions: [], lorebook: []
};
const options = { policy: 'add_only', batchSize: 12, detail: 'standard' };
const plan = context.defaultWorldArchitectPlan(world, 'Add 12 items.', options);
world.architectJob = { id: 'job', request: 'Add 12 items.', options,
    model: 'local-test', status: 'planned', plan, operations: [],
    completedBatchIds: [], dismissed: [], baseRevision: 0,
    baseFingerprint: context.worldArchitectFingerprint(world) };
context.state.editingWorld = world;

(async () => {
    failAfterFirstChunk = true;
    await context.runWorldArchitectJob();
    assert.equal(world.architectJob.status, 'failed');
    assert.equal(world.architectJob.operations.length, 4,
        'a completed four-item part is checkpointed even if the next part fails');
    assert.equal(world.architectJob.completedBatchIds.length, 0);
    assert(snapshots.some(snapshot => snapshot.operations === 4));
    failAfterFirstChunk = false;
    await context.runWorldArchitectJob();
    assert.equal(world.architectJob.status, 'review');
    assert.equal(world.architectJob.operations.length, 12,
        'resume generates only the eight missing items');
    assert.deepEqual(Array.from(new Set(world.architectJob.operations.map(item => item.record.id))).length, 12);
    assert.deepEqual(Array.from(world.architectJob.completedBatchIds), ['batch_1']);
    assert.equal(issued, 12);
    console.log('PASS: typed four-record chunks repair, checkpoint and resume to twelve items');
})().catch(error => { console.error(error); process.exitCode = 1; });
