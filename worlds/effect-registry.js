/* Typed operation dispatcher. Reducers receive only workingState, never the
 * canonical World or session. Emitted effects share the receipt transaction. */
(function (root) {
'use strict';
const MAX_FOLLOW_UP_EFFECTS = 16;
function createEffectRegistry() {
    const reducers = new Map();
    const register = (type, validate, reduce) => {
        if (!/^[a-z][a-z0-9_]*$/.test(type) || reducers.has(type)
            || typeof validate !== 'function' || typeof reduce !== 'function')
            throw new TypeError('invalid_effect_registration');
        reducers.set(type, { validate, reduce });
    };
    const run = (initial, workingState, context = {}) => {
        if (!Array.isArray(initial) || initial.length > 32) throw new Error('invalid_effect_queue');
        const queue = initial.map(effect => ({ effect, ancestry: [] }));
        const applied = [];
        let followUps = 0;
        while (queue.length) {
            const { effect, ancestry } = queue.shift();
            const entry = reducers.get(effect?.type);
            if (!entry) throw new Error(`unknown_technical_effect:${String(effect?.type || '')}`);
            const signature = JSON.stringify(effect);
            if (ancestry.includes(signature)) throw new Error('cyclic_follow_up_effect');
            if (!entry.validate(effect.payload, workingState, context))
                throw new Error(`invalid_technical_effect:${effect.type}`);
            const emitted = entry.reduce(effect.payload, workingState, context) || [];
            if (!Array.isArray(emitted)) throw new Error(`invalid_follow_up_effects:${effect.type}`);
            applied.push(effect);
            for (const next of emitted) {
                followUps++;
                if (followUps > MAX_FOLLOW_UP_EFFECTS) throw new Error('follow_up_effect_budget_exceeded');
                queue.push({ effect: next, ancestry: [...ancestry, signature] });
            }
        }
        return { applied, followUps };
    };
    return { register, run, has: type => reducers.has(type), types: () => [...reducers.keys()] };
}
const api = { createEffectRegistry, MAX_FOLLOW_UP_EFFECTS };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.HordeEffectRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
