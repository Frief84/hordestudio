'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const L = require('../assets/worlds/world-lore.js');
const { buildContext } = require('./app_source');
const world = {
    id: 'lore-test', name: 'Many kinds of places', startLocationId: 'road',
    regions: [{ id: 'realm', name: 'Realm', description: 'A wide realm.', access: { default: 'restricted', includeChildren: true, factions: { wardens: 'allow' } },
        placeAwareness: { includeChildren: true, factions: { wardens: 'know' } } }],
    locations: [
        { id: 'road', name: 'Road', mapType: 'route', description: 'An old road.', exits: [{ targetLocationId: 'wood', travelTime: 15 }, { targetLocationId: 'field', travelTime: 20 }] },
        { id: 'wood', name: 'Wood', placeType: 'forest', regionId: 'realm', description: 'An ancient forest. Only wardens may enter.', exits: [{ targetLocationId: 'grove', travelTime: 10 }, { targetLocationId: 'road', travelTime: 15 }] },
        { id: 'grove', name: 'Sacred Grove', placeType: 'landmark', parentLocationId: 'wood', description: 'A ring of trees.', exits: [], secrets: [{ label: 'Tree secret', truth: 'The tree conceals a bell.', knowledge: { visibility: 'assigned', npcIds: ['warden'], factionIds: [] } }] },
        { id: 'field', name: 'Field', placeType: 'landscape', description: 'Open land.', exits: [{ targetLocationId: 'grove', travelTime: 20 }] },
        { id: 'cave', name: 'Cave', placeType: 'cave', parentLocationId: 'wood', description: 'Unconnected cave.', exits: [] }
    ],
    entities: [{ id: 'warden', type: 'npc', name: 'Warden', factionId: 'wardens', startLocation: 'road' }, { id: 'visitor', type: 'npc', name: 'Visitor', startLocation: 'road' }],
    factions: [{ id: 'wardens', name: 'Wardens', description: 'Guardians of the forest.', knowledge: { visibility: 'public' } }],
    lorebook: [{ keyword: 'Custom', text: 'Visitors leave gifts.', knowledge: { visibility: 'public' }, about: [{ kind: 'location', id: 'grove' }] }]
};
L.migrate(world);
assert.equal(L.exitLock({}).state, 'unlocked', 'an unspecified route uses the open default');
assert.equal(L.exitLock({ lockState: 'unknown' }).state, 'unknown', 'an explicit unknown remains reviewable');
assert(!L.validate(world).some(issue => issue.message.includes('Knowledge audience not yet assigned')),
    'narrator-only defaults should not flood place structure lint');
world.locations[2].placeType = 'room';
world.locations[1].exits = [{ targetLocationId: 'grove' }];
assert(!L.validate(world).some(issue => issue.message.includes('Initial lock state unspecified')),
    'an ordinary unspecified route should not be treated as a broken lock');
world.locations[1].exits[0].lockState = 'invalid';
assert(L.validate(world).some(issue => issue.message.includes('Invalid lock state')),
    'explicit invalid lock values should remain lint errors');
world.locations[1].exits[0].lockState = 'unknown';
assert(L.validate(world).some(issue => issue.message.includes('Initial lock state unspecified')),
    'an explicitly unknown lock state should remain reviewable');
delete world.locations[1].exits[0].lockState;
world.locations[2].placeType = 'landmark';
world.locations[1].exits = [{ targetLocationId: 'grove', travelTime: 10 }, { targetLocationId: 'road', travelTime: 15 }];
const once = JSON.stringify(world); L.migrate(world); assert.equal(JSON.stringify(world), once);
assert.equal(L.access(world, 'warden', 'grove').ok, true);
assert.equal(L.access(world, 'visitor', 'grove').ok, false);
assert.equal(L.access(world, 'visitor', 'road').ok, true);
const grove = world.locations[2];
grove.access = { default: 'open', includeChildren: false, npcs: { warden: 'deny' } };
assert.equal(L.access(world, 'warden', 'grove').ok, false);
assert.equal(L.access(world, 'visitor', 'grove').ok, true);
delete grove.access;
assert(L.knowledge(world, 'warden').some(f => f.text.includes('bell')));
assert(!L.knowledge(world, 'visitor').some(f => f.text.includes('bell')));
assert(L.knowledge(world, 'visitor').some(f => f.text.includes('gifts')));
const packet = L.context(world, { locationId: 'grove', npcIds: ['visitor', 'warden'] });
assert(packet.narrator.some(f => f.text.includes('bell')));
assert(!packet.npcKnowledge.visitor.some(f => f.text.includes('bell')));
assert(packet.npcKnowledge.warden.some(f => f.text.includes('bell')));
assert.equal(packet.places.find(p => p.id === 'grove').connections.length, 0);
assert.deepEqual(packet.placeIndex.find(p => p.id === 'wood'), { id: 'wood', name: 'Wood', kind: 'location' });
assert(!('connections' in packet.placeIndex.find(p => p.id === 'wood')),
    'keep every place resolvable without repeating the full route graph in every prompt');
const proposal = { kind: 'location', targetId: 'wood', field: 'knowledge', value: { visibility: 'public', npcIds: [], factionIds: [] },
    reason: 'An explicit description of the forest.', evidence: { kind: 'location', id: 'wood', field: 'description', quote: 'An ancient forest.' } };
assert.equal(L.stageProposals(world, [proposal]).added, 1);
assert.equal(world.locations[1].knowledge, undefined, 'unapproved proposal is not canon');
L.applyProposal(world, world.loreProposals[0].id);
assert.equal(world.locations[1].knowledge.visibility, 'public');
assert.equal(L.stageProposals(world, [{ ...proposal, evidence: { ...proposal.evidence, quote: 'invented' } }]).added, 0);
assert.equal(L.stageProposals(world, [{ ...proposal, value: { visibility: 'assigned', npcIds: ['missing'] } }]).added, 0);
assert.equal(L.stageProposals(world, [{ ...proposal, field: 'access', value: 'open' }]).added, 0);
assert.equal(L.stageProposals(world, [{ ...proposal, field: 'parentLocationId', value: 'grove' }]).added, 0, 'cycles rejected');
L.stageProposals(world, [{ ...proposal, value: { visibility: 'narrator' } }]);
world.locations[1].knowledge = { visibility: 'assigned', npcIds: ['warden'] };
assert.throws(() => L.applyProposal(world, world.loreProposals.at(-1).id), /changed/);
const renamed = structuredClone(world);
renamed.locations[2].id = 'holy-grove'; L.rewriteReferences(renamed, 'location', 'grove', 'holy-grove');
assert.equal(renamed.lorebook[0].about[0].id, 'holy-grove');
const roundtrip = JSON.parse(JSON.stringify(world)); L.migrate(roundtrip); assert.deepEqual(roundtrip, world);
const beforeGeneration = structuredClone(world);
assert.equal(L.structureStatus(world).state, 'missing');
L.generate(world);
assert.equal(L.structureStatus(world).state, 'current');
assert.deepEqual(world.lorebook, beforeGeneration.lorebook, 'generation must preserve existing lore exactly');
assert.deepEqual(world.locations, beforeGeneration.locations, 'generation must preserve descriptions, secrets, exits and explicit access rules');
assert.deepEqual(world.entities, beforeGeneration.entities, 'generation must not rewrite the cast');
const edges = structuredClone(world.worldStructure.edges);
L.generate(world);
assert.deepEqual(world.worldStructure.edges, edges, 'repeated generation does not duplicate links');
assert.deepEqual(world.lorebook, beforeGeneration.lorebook, 'repeated generation never replaces existing lore');
world.locations[0].description += ' A new sign stands here.';
assert.equal(L.structureStatus(world).state, 'stale');
assert(L.health(world).some(i => i.message.includes('changed after')));
L.generate(world);
assert.equal(L.structureStatus(world).state, 'current');

const ctx = buildContext(vm, ['findWorldTravelPath', 'startNpcJourney', 'advanceNpcJourney', 'movePlayerAlongWorldPath', 'normalizeWorldDirectoryData', 'normalizeWorldFaction'], {
    HordeWorldLore: L, globalThis: { HordeWorldLore: L },
    worldForSession: w => w, getWorldPathTravelTime: () => 25,
    isNpcActive: actor => !!actor && actor.status !== 'dead', queueEngineEvent() {}, showToast() {},
    sessionNpcs: w => w.entities, sessionLocations: w => w.locations,
    isPlainObject: v => !!v && typeof v === 'object' && !Array.isArray(v)
});
assert.equal(ctx.findWorldTravelPath(world, 'wood', 'cave'), null, 'containment is not traversal');
assert.equal(ctx.findWorldTravelPath(world, 'road', 'grove', { npcId: 'visitor' }), null);
assert.deepEqual(Array.from(ctx.findWorldTravelPath(world, 'road', 'grove', { npcId: 'warden' })), ['road', 'wood', 'grove']);
const sess = { id: 's', playerLocation: 'road', entityStates: { visitor: { location: 'road', followingPlayer: true }, warden: { location: 'road', followingPlayer: true } } };
assert.equal(ctx.startNpcJourney(world, sess, world.entities[1], grove, 'visit', 100), false);
assert.equal(sess.entityStates.visitor.location, 'road');
assert.equal(ctx.startNpcJourney(world, sess, world.entities[0], grove, 'guard', 100), true);
assert.equal(sess.entityStates.warden.location, null);
assert.equal(ctx.advanceNpcJourney(world, sess, world.entities[0], 124), false);
grove.access = { default: 'restricted' };
assert.equal(ctx.advanceNpcJourney(world, sess, world.entities[0], 125), false);
assert.equal(sess.entityStates.warden.location, 'wood', 'interrupted travel stops at the last reached place');
delete grove.access;
sess.entityStates.warden.location = 'road';
const moved = ctx.movePlayerAlongWorldPath(world, sess, grove, { showTravelToast: false });
assert.equal(moved.ok, true);
assert.equal(sess.entityStates.visitor.location, 'road', 'forbidden follower stays behind');
assert.equal(sess.entityStates.warden.location, 'grove');
assert.equal(ctx.findWorldTravelPath(world, 'wood', 'road', { npcId: 'visitor' }).at(-1), 'road', 'leaving remains possible');
const normalized = structuredClone(world); ctx.normalizeWorldDirectoryData(normalized);
assert.equal(normalized.regions[0].access.includeChildren, true, 'region rules survive normalization');
assert.equal(ctx.normalizeWorldFaction(world.factions[0], 0).knowledge.visibility, 'public');
console.log('PASS: World Lore migration, perspectives, geography, access, proposal review and NPC travel');

// Physical locks use the engine's existing exit requirements, independently of access.
const lockWorld = { id: 'locks', locations: [
    { id: 'hall', name: 'Hall', description: 'A locked door opens with the Brass Key.', knowledge: { visibility: 'public' }, exits: [{ targetLocationId: 'room', travelTime: 2, requiredItem: 'Brass Key', allowCheckUnlock: true }] },
    { id: 'room', name: 'Room', placeType: 'room', description: 'A room.', knowledge: { visibility: 'public' }, exits: [], access: { default: 'open' } }
], entities: [{ id: 'key', name: 'Brass Key', type: 'item' }], lorebook: [] };
const lockExit = lockWorld.locations[0].exits[0];
L.generate(lockWorld);
assert.deepEqual(L.graph(lockWorld).nodes.find(n => n.id === 'location:room').access, { default: 'open' });
assert.equal(L.graph(lockWorld).edges.find(e => e.type === 'connected_to').lock.state, 'locked');
assert.equal(L.exitLock(lockExit, { unlockedExits: { 'hall::room': true } }, 'hall', 'room').currentState, 'unlocked');
assert.equal(L.exitLock(lockExit).state, 'locked');
assert.equal(L.context(lockWorld, { locationId: 'hall', session: { unlockedExits: { 'hall::room': true } } }).places[0].connections[0].lock.currentState, 'unlocked');
const lockProposal = { kind: 'location', targetId: 'hall', field: 'exits', value: [{ ...lockExit, lockState: 'locked' }], reason: 'Explicit locked door', evidence: { kind: 'location', id: 'hall', field: 'description', quote: 'A locked door' } };
assert.equal(L.stageProposals(lockWorld, [lockProposal]).added, 1);
assert.equal(lockExit.lockState, undefined, 'staged locks never change authored state');
L.applyProposal(lockWorld, lockWorld.loreProposals[0].id);
assert.equal(lockWorld.locations[0].exits[0].lockState, 'locked');
assert.equal(L.stageProposals(lockWorld, [{ ...lockProposal, value: [{ ...lockExit, travelTime: 500 }] }]).added, 0, 'AI may not rewrite routes through lock proposals');
lockWorld.locations[0].exits[0].lockState = 'unlocked';
assert(L.health(lockWorld).some(i => i.message.includes('Unlocked access conflicts')));
assert.equal(L.structureStatus(lockWorld).state, 'current', 'explicit unlocked and the implicit open default have the same route semantics');
const runtime = buildContext(vm, ['worldExitRequirement'], { questTextKey: s => s.toLowerCase(), getExitTargetName: e => e.targetLocationId });
assert.equal(runtime.worldExitRequirement({}, { targetLocationId: 'room', lockState: 'locked' }, 'hall').ok, false);
assert.equal(runtime.worldExitRequirement({ unlockedExits: { 'hall::room': true } }, { targetLocationId: 'room', lockState: 'locked' }, 'hall').ok, true);
assert.equal(runtime.worldExitRequirement({ inventory: ['Brass Key'] }, lockExit, 'hall').ok, true);
console.log('PASS: Lock proposals, physical requirements, context, session separation and Health Check');

const knowledgeWorld = {
    id: 'awareness', name: 'Awareness', startLocationId: 'hall',
    regions: [{ id: 'campus', name: 'Campus', placeAwareness: { includeChildren: true, factions: { staff: 'know', students: 'unknown' } } }],
    locations: [
        { id: 'hall', name: 'Hall', regionId: 'campus', exits: [{ targetLocationId: 'lab', travelTime: 10 }] },
        { id: 'lab', name: 'Lab', regionId: 'campus', exits: [{ targetLocationId: 'vault', travelTime: 10, lockState: 'locked' }] },
        { id: 'vault', name: 'Vault', parentLocationId: 'lab', placeAwareness: { npcs: { student: 'know' } },
            access: { default: 'restricted', factions: { staff: 'allow' }, npcs: { student: 'deny' } }, exits: [] },
        { id: 'remote', name: 'Remote Secret', exits: [] }
    ],
    entities: [
        { id: 'staffer', name: 'Staffer', type: 'npc', factionId: 'staff', startLocation: 'hall' },
        { id: 'student', name: 'Student', type: 'npc', factionId: 'students', startLocation: 'hall' }
    ],
    factions: [{ id: 'staff', name: 'Staff' }, { id: 'students', name: 'Students' }], lorebook: []
};
assert.equal(L.placeAwareness(knowledgeWorld, 'staffer', 'lab').known, true, 'faction area rule reaches child');
assert.equal(L.placeAwareness(knowledgeWorld, 'student', 'lab').known, false, 'faction denial hides area');
assert.equal(L.placeAwareness(knowledgeWorld, 'student', 'vault').known, true, 'individual child rule overrides faction area rule');
assert.equal(L.placeAwareness(knowledgeWorld, 'staffer', 'remote').known, false, 'legacy places are initially unknown');
knowledgeWorld.locations[0].placeAwareness = { npcs: { staffer: 'unknown' } };
assert.equal(L.placeAwareness(knowledgeWorld, 'staffer', 'hall').known, false,
    'an explicit personal unknown rule takes precedence over a routine place');
assert(L.health(knowledgeWorld).some(issue => issue.message.includes('explicitly unknown')),
    'Health Check flags a routine that contradicts an explicit unknown rule');
delete knowledgeWorld.locations[0].placeAwareness;
knowledgeWorld.locations[0].placeAwareness = { factions: { missing_faction: 'know' } };
assert(L.health(knowledgeWorld).some(issue => issue.message.includes('missing_faction')), 'Health Check finds a dangling faction knowledge rule');
delete knowledgeWorld.locations[0].placeAwareness;
knowledgeWorld.locations[1].description = 'Staff know the Lab exists.';
const awarenessProposal = { kind: 'location', targetId: 'lab', field: 'placeAwareness',
    value: { factions: { staff: 'know' } }, reason: 'Explicit staff knowledge.',
    evidence: { kind: 'location', id: 'lab', field: 'description', quote: 'Staff know the Lab exists.' } };
assert.equal(L.stageProposals(knowledgeWorld, [awarenessProposal]).added, 1,
    'explicit, quoted place knowledge may be proposed for review');
assert.equal(knowledgeWorld.locations[1].placeAwareness, undefined, 'AI proposal must not auto-apply');
knowledgeWorld.locations[1].placeAwareness = { npcs: { student: 'unknown' } };
assert.equal(L.stageProposals(knowledgeWorld, [awarenessProposal]).added, 0,
    'AI proposal must preserve existing authored place knowledge');
delete knowledgeWorld.locations[1].placeAwareness;
const sessionA = { id: 'a', entityStates: { staffer: { location: 'hall' }, student: { location: 'hall' } }, unlockedExits: { 'lab::vault': true } };
const sessionB = structuredClone(sessionA); sessionB.id = 'b';
L.rememberPlace(sessionA, 'student', 'lab');
assert.equal(L.placeAwareness(knowledgeWorld, 'student', 'lab', sessionA).known, true);
assert.equal(L.placeAwareness(knowledgeWorld, 'student', 'lab', sessionB).known, false, 'discoveries stay in their timeline');
const compact = L.context(knowledgeWorld, { locationId: 'hall', npcIds: ['staffer', 'student'], session: sessionB });
assert(!compact.placeIndex.some(place => place.id === 'remote'), 'remote secret is absent from the local prompt index');
assert(!compact.npcPlaces.student.includes('lab'), 'NPC view excludes an unknown place');
const movement = buildContext(vm, ['findWorldTravelPath', 'startNpcJourney', 'advanceNpcJourney', 'worldNpcAccess'], {
    HordeWorldLore: L, globalThis: { HordeWorldLore: L }, worldForSession: w => w,
    getWorldPathTravelTime: (_world, path) => (path.length - 1) * 10,
    isNpcActive: actor => !!actor && actor.status !== 'dead', queueEngineEvent() {},
    isPlainObject: value => !!value && typeof value === 'object' && !Array.isArray(value)
});
assert.equal(movement.worldNpcAccess(knowledgeWorld, 'student', 'vault', sessionA).ok, false);
sessionA.placeAccessGrants = { vault: { student: { grantedBy: 'staffer' } } };
assert.equal(movement.worldNpcAccess(knowledgeWorld, 'student', 'vault', sessionA).ok, true, 'a copied permission overrides authored denial');
assert.equal(movement.worldNpcAccess(knowledgeWorld, 'student', 'vault', sessionB).ok, false, 'the copy stays in its own timeline');
assert.equal(movement.findWorldTravelPath(knowledgeWorld, 'hall', 'lab', { npcId: 'student', session: sessionB }), null);
assert.deepEqual(Array.from(movement.findWorldTravelPath(knowledgeWorld, 'hall', 'vault', { npcId: 'staffer', session: sessionA })), ['hall', 'lab', 'vault']);
assert.equal(movement.startNpcJourney(knowledgeWorld, sessionA, knowledgeWorld.entities[0], knowledgeWorld.locations[2], 'guard', 100), true);
assert.equal(movement.advanceNpcJourney(knowledgeWorld, sessionA, knowledgeWorld.entities[0], 110), false);
delete sessionA.unlockedExits['lab::vault'];
assert.equal(movement.advanceNpcJourney(knowledgeWorld, sessionA, knowledgeWorld.entities[0], 120), false);
assert.equal(sessionA.entityStates.staffer.location, 'lab', 'closing a later door stops the NPC at the last reached place');
assert.equal(L.placeAwareness(knowledgeWorld, 'staffer', 'lab', sessionB).known, true);
console.log('PASS: Place knowledge, faction exceptions, timeline isolation, compact context and mid-journey door changes');
