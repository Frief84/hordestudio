'use strict';
const { performance } = require('node:perf_hooks');
const { executeLinkedActions } = require('../worlds/linked-world-actions');
const discovery = require('../worlds/dynamic-object-discovery');
const workingApi = require('../worlds/working-state');
const entities = Array.from({ length: 500 }, (_, index) => ({ id: `box_${index}`,
    type: 'item', name: `Storage box ${index}`, locationId: 'kitchen',
    interactable: { initialState: 'open' }, description: 'Household storage box.' }));
const base = { id: 'performance', description: 'A modern household.',
    locations: [{ id: 'kitchen', name: 'Kitchen', description: 'A furnished kitchen.', items: [] }],
    entities };
const off = { ...base, gameRules: { dynamicObjectDiscovery: { enabled: false } } };
const on = { ...base, gameRules: { dynamicObjectDiscovery: { enabled: true },
    universalChecks: { enabled: true, rules: [discovery.defaultRule(11)] } } };
const plan = () => ({ actions: [{ action_id: 'a', kind: 'speech', request: 'Hello.',
    status: 'resolved', response_id: 'p', action_effects: {} }], events: [],
    narrative: [{ id: 'p', action_id: 'a', text: 'Hello.' }] });
const session = () => ({ id: 'benchmark', turnCount: 1, playerLocation: 'kitchen',
    inventory: [], entityStates: {} });
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function measure(world, iterations = 120) {
    const times = [], memory = [];
    for (let index = 0; index < iterations; index++) {
        const began = performance.now();
        const result = executeLinkedActions(plan(), world, session());
        if (!result.ok) throw Error(JSON.stringify(result.errors));
        result.working.prepare();
        times.push(performance.now() - began);
        memory.push(process.memoryUsage().heapUsed);
    }
    return { coldMs: +times[0].toFixed(3), warmMedianMs: +median(times.slice(20)).toFixed(3),
        warmP95Ms: +([...times.slice(20)].sort((a, b) => a - b)[95]).toFixed(3),
        heapRangeMiB: +((Math.max(...memory) - Math.min(...memory)) / 1048576).toFixed(2) };
}
const disabled = measure(off);
const enabled = measure(on);
const working = workingApi.createWorkingState(on, session());
const started = performance.now();
discovery.resolveDynamicObjectDiscovery({ request: { id: 'candidate', name: 'flashlight' },
    actor: 'player', location: on.locations[0], container: { id: 'box_499' },
    worldRules: on.gameRules, world: on, workingState: working,
    roll: () => 10, evaluateCheck: () => ({ kind: 'success', random: 10 }) });
const searchMs = +(performance.now() - started).toFixed(3);
console.log(JSON.stringify({ disabled, enabled, searchWith500ContainersMs: searchMs,
    relativeWarmPercent: +((enabled.warmMedianMs / disabled.warmMedianMs - 1) * 100).toFixed(1) }));
