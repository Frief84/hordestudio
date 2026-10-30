/* World-rule capability. All durable writes use the caller's Working State. */
(function (root) {
'use strict';
const TYPE = 'world.dynamic_object_discovery';
const RULE_ID = 'dynamic_object_discovery';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const node = Object.freeze({ type: TYPE, version: 1, name: 'Dynamic Object Discovery',
    description: 'Resolve grounded ambient objects and uncertain discoveries in the World Engine.',
    category: 'World Rules / Objects & Inventory', runtime: 'resolveDynamicObjectDiscovery',
    enabled: false, settings: Object.freeze({ allowAmbientObjects: true,
        allowUncertainDiscoveries: true, dice: 'd20', respectAuthoredContents: true,
        preventRepeatRolls: true, requireWorldPlausibility: true }),
    inputs: Object.freeze(['searchRequest', 'actorContext', 'locationContext',
        'containerContext', 'worldRules'].map(name => ({ name, type: 'object' }))),
    outputs: Object.freeze(['existing', 'success', 'failure', 'blocked', 'confirmedEvents']
        .map(name => ({ name, type: name === 'confirmedEvents' ? 'array' : 'object' }))) });
function validateNodeDefinition(definition = node) {
    if (!object(definition) || definition.type !== TYPE || definition.version !== 1
        || definition.runtime !== 'resolveDynamicObjectDiscovery'
        || definition.settings?.dice !== 'd20'
        || ['respectAuthoredContents', 'preventRepeatRolls', 'requireWorldPlausibility']
            .some(key => definition.settings?.[key] !== true)
        || !Array.isArray(definition.inputs) || !Array.isArray(definition.outputs)
        || new Set(definition.inputs.map(port => port.name)).size !== 5
        || new Set(definition.outputs.map(port => port.name)).size !== 5
        || [...definition.inputs, ...definition.outputs].some(port =>
            !['object', 'array'].includes(port.type) || !port.name))
        throw new Error('invalid_dynamic_discovery_node');
    return true;
}
function defaultRule(difficulty = 11) {
    return { id: RULE_ID, name: 'Dynamic object discovery',
        match: { kind: 'observation', requestIncludes: '__engine_discovery_only__' },
        actor: 'event_actor', values: [], difficulty,
        random: { min: 1, max: 20 }, results: [
            { id: 'success', kind: 'success', minMargin: 0, effects: ['item_introduce'] },
            { id: 'failure', kind: 'failure', minMargin: -1000000, effects: [] }
        ] };
}
function validateConfig(config) {
    if (config === undefined) return { enabled: false, allowAmbientObjects: true,
        allowUncertainDiscoveries: true };
    if (!object(config) || typeof config.enabled !== 'boolean'
        || ['allowAmbientObjects', 'allowUncertainDiscoveries'].some(key =>
            config[key] !== undefined && typeof config[key] !== 'boolean')
        || ['respectAuthoredContents', 'preventRepeatRolls', 'requireWorldPlausibility']
            .some(key => config[key] === false)
        || config.dice !== undefined && config.dice !== 'd20')
        throw new Error('invalid_dynamic_object_discovery');
    return { enabled: config.enabled, allowAmbientObjects: config.allowAmbientObjects !== false,
        allowUncertainDiscoveries: config.allowUncertainDiscoveries !== false };
}
function contentMode(container, working, locationId) {
    if (!container?.definition) return 'unspecified';
    const explicit = container.definition.contentsMode ?? container.definition.properties?.contentsMode;
    const id = container.definition.id;
    const stock = working.getEntitiesByFilter(item => item.definition?.type === 'item'
        && item.definition?.properties?.containerId === id
        && !item.definition?.sessionOrigin
        && (item.definition?.locationId || item.definition?.startLocation) === locationId);
    if (stock.length || (working.getLocation(locationId).definition?.items || []).some(item =>
        object(item) && (item.containerId || item.container_id) === id)) return 'fixed';
    const prose = normalize([container.definition.description,
        container.definition.interactable?.description].filter(Boolean).join(' '));
    // A named authored contents claim closes the container even if its items
    // have not yet been materialized from older World data.
    if (/\b(?:contains|holds|inside (?:is|are)|enthält|beinhaltet|darin (?:liegt|liegen|ist|sind))\b/u.test(prose))
        return 'fixed';
    if (['fixed', 'empty'].includes(explicit)) return explicit;
    if (/\b(?:empty|vacant|leer|ausgeraeumt|ausgeräumt|nothing inside|nichts darin)\b/u.test(prose)) return 'empty';
    return 'unspecified';
}
function concept(name, context = '') {
    let key = normalize(name);
    const environment = normalize(context);
    if (/^(?:taschenlampe|flashlight|electric torch)$/.test(key)
        || key === 'torch' && /\b(?:modern|electric|electrical|elektrisch)\b/.test(environment)) key = 'electric light';
    else if (key === 'torch' && /\b(?:medieval|mittelalter|flame|flamme)\b/.test(environment)) key = 'flame torch';
    if (/^(?:maschinengewehr|machine gun)$/.test(key)) key = 'automatic firearm';
    return key;
}
function traits(name, properties = {}) {
    const text = normalize(name);
    const tags = new Set((Array.isArray(properties.tags) ? properties.tags : [])
        .map(normalize));
    const era = normalize(properties.technology || properties.era || '');
    const electric = /\b(?:electric|electrical|electronic|battery|flashlight|taschenlampe|elektrisch|batterie|computer|radio|phone|telefon)\b/.test(text)
        || tags.has('electric') || tags.has('electronic') || era === 'modern';
    const weapon = /\b(?:gun|rifle|pistol|machine gun|firearm|maschinengewehr|gewehr|pistole|explosive|sprengstoff)\b/.test(text)
        || tags.has('weapon') || tags.has('firearm');
    const families = [
        ['lighting', /\b(?:light|lamp|lantern|torch|candle|kerze|lampe|leuchte|taschenlampe)\b/],
        ['tool', /\b(?:tool|hammer|wrench|screwdriver|pliers|werkzeug|hammer|schraubenzieher|zange)\b/],
        ['cordage', /\b(?:rope|string|twine|cord|thread|seil|schnur|faden)\b/],
        ['furniture', /\b(?:chair|table|stool|bench|stuhl|tisch|hocker|bank)\b/],
        ['food', /\b(?:food|bread|fruit|apple|bottle|water|essen|brot|obst|apfel|flasche|wasser)\b/],
        ['weapon', /\b(?:weapon|gun|rifle|pistol|sword|knife|waffe|gewehr|pistole|schwert|messer)\b/]
    ];
    const family = normalize(properties.family) || families.find(([, pattern]) => pattern.test(text))?.[0] || '';
    return { electric, weapon, ordinary: !weapon && properties.unique !== true
        && properties.questItem !== true && properties.access !== true, family };
}
function ambientMention(name, location) {
    const words = normalize([location?.description, location?.appearance].filter(Boolean).join(' '))
        .split(' ').filter(Boolean);
    const key = normalize(name).split(' ').filter(Boolean);
    if (!key.length || !words.length) return false;
    const near = (a, b) => !!a && (a === b || a === `${b}s` || a === `${b}es`
        || b.length >= 4 && a.length >= 4 && a.slice(0, 3) === b.slice(0, 3)
            && Math.abs(a.length - b.length) <= 2
            && [...a].filter((letter, i) => letter !== b[i]).length <= 2);
    if (words.some((word, at) => ['no', 'without', 'none', 'kein', 'keine', 'ohne']
        .includes(word) && words.slice(at + 1, at + 5).some(candidate => near(candidate, key[0]))))
        return false;
    return words.some((word, at) => key.every((part, offset) => near(words[at + offset], part)));
}
function plausibility({ name, properties, location, container, world }) {
    const lore = [world?.description, world?.dmPrompt, world?.authorNote,
        location?.description, location?.appearance, container?.description].filter(Boolean).join(' ');
    const text = normalize(lore);
    const item = concept(name, text);
    const attributes = traits(item, properties);
    const exclusions = [world?.discoveryExclusions, location?.discoveryExclusions,
        container?.discoveryExclusions].flat().filter(Boolean).map(normalize);
    if (exclusions.includes(normalize(name)) || exclusions.includes(item))
        return { status: 'excluded', reason: 'authored_exclusion' };
    const objectWords = normalize(name).split(' ').filter(Boolean);
    const explicitAbsence = objectWords.length && [world?.description, world?.dmPrompt,
        location?.description, location?.appearance, container?.description].filter(Boolean)
        .some(source => {
            const words = normalize(source).split(' ');
            return words.some((word, at) => ['no', 'without', 'none', 'kein', 'keine', 'ohne']
                .includes(word) && words.slice(at + 1, at + 7)
                    .some(candidate => candidate === objectWords[0]
                        || candidate === `${objectWords[0]}s`));
        });
    if (explicitAbsence) return { status: 'excluded', reason: 'authored_absence' };
    if (/\b(?:empty room|empty kitchen|empty house|leerer raum|leere küche|leerstehend)\b/u.test(text))
        return { status: 'excluded', reason: 'explicitly_empty_place' };
    const medieval = /\b(?:medieval|middle ages|mittelalter|mittelalterlich|preindustrial|vorindustriell)\b/.test(text);
    const modern = /\b(?:modern|contemporary|heutig|gegenwart|electric|elektrisch|21st century|20th century)\b/.test(text);
    if (attributes.electric && medieval && !modern)
        return { status: 'excluded', reason: 'technology_conflict' };
    if (attributes.weapon && !/\b(?:armory|arsenal|weapons|military|soldier|waffen|militär|soldat)\b/.test(text))
        return { status: 'excluded', reason: 'unsupported_weapon' };
    if (!attributes.ordinary) return { status: 'undetermined', reason: 'special_item_unproved' };
    if (!attributes.family || !['lighting', 'tool', 'cordage', 'furniture', 'food'].includes(attributes.family))
        return { status: 'undetermined', reason: 'object_properties_unverified' };
    const placeText = normalize([location?.description, location?.appearance,
        container?.description].filter(Boolean).join(' '));
    if (!placeText && !container) return { status: 'undetermined', reason: 'insufficient_place_context' };
    if (attributes.electric && !modern) return { status: 'undetermined', reason: 'technology_unproved' };
    const contexts = {
        lighting: /\b(?:house|home|household|haus|wohnung|kitchen|küche|pantry|vorrat|workshop|werkstatt|camp|lager|dungeon|kerker)\b/,
        tool: /\b(?:workshop|werkstatt|garage|shed|schuppen|tool|werkzeug|household|haushalt)\b/,
        cordage: /\b(?:house|home|household|haus|wohnung|workshop|werkstatt|storage|lager|crate|kiste)\b/,
        furniture: /\b(?:furnished|eingerichtet|house|home|haus|wohnung|room|zimmer)\b/,
        food: /\b(?:kitchen|küche|pantry|vorrat|food|essen|market|markt|household|haushalt)\b/
    };
    if (!contexts[attributes.family].test(text))
        return { status: 'undetermined', reason: 'object_place_relation_unproved' };
    if (container && !/\b(?:house|home|household|haus|wohnung|workshop|werkstatt|storage|lager|kitchen|küche|drawer|schublade|cupboard|schrank)\b/.test(text))
        return { status: 'undetermined', reason: 'container_context_unproved' };
    return { status: 'plausible', reason: 'grounded_ordinary_context' };
}
function resolveDynamicObjectDiscovery({ request, actor, location, container, worldRules,
    world, workingState, roll, evaluateCheck }) {
    const config = validateConfig(worldRules?.dynamicObjectDiscovery);
    if (!config.enabled) return { type: 'blocked', reason: 'discovery_disabled' };
    const name = String(request?.name || '').trim();
    const locationId = location?.id;
    if (!name || !locationId || !workingState) throw new Error('invalid_discovery_context');
    const containerId = container?.id || '';
    const objectKey = concept(name, [world?.description, location?.description].join(' '));
    const guarded = (world?.entities || []).some(item => item.type === 'item'
        && normalize(item.name) === normalize(name)
        && (item.unique || item.questItem || item.properties?.unique
            || item.properties?.access))
        || (world?.locations || []).some(place => (place.exits || []).some(exit =>
            [exit?.requiredItem, exit?.lockKeyItem].some(key => normalize(key) === normalize(name))));
    const candidates = workingState.getEntitiesByFilter(item => item.definition?.type === 'item'
        && concept(item.definition.name, world?.description) === objectKey
        && (item.state?.location || item.definition?.locationId || item.definition?.startLocation) === locationId
        && (item.state?.containerId || item.definition?.properties?.containerId || '') === containerId
        && Number(item.state?.quantity ?? item.definition?.quantity ?? 1) > 0);
    if (candidates.length === 1) {
        if (containerId) {
            const holder = workingState.getEntity(containerId);
            const state = holder.state?.interactableState
                || holder.definition?.interactable?.initialState;
            if (!['open', 'removed', 'cleared', 'broken'].includes(state))
                return { type: 'blocked', reason: 'container_closed' };
        }
        return { type: 'existing', objectId: candidates[0].definition.id };
    }
    if (candidates.length > 1) return { type: 'blocked', reason: 'ambiguous_existing_object' };
    if (guarded) return { type: 'blocked', reason: 'authored_special_item' };
    const containerEntity = containerId ? workingState.getEntity(containerId) : null;
    if (containerId && !containerEntity?.definition)
        return { type: 'blocked', reason: 'unknown_container' };
    const catalogItem = (worldRules?.itemCatalog || []).find(item =>
        normalize(item?.name) === normalize(name));
    const check = plausibility({ name, properties: catalogItem?.properties || {},
        location, container: containerEntity?.definition, world });
    const ambientQuestion = JSON.stringify([locationId, objectKey, 'ambient']);
    const previousAmbient = (workingState.getSession('discoveryDecisions') || {})[ambientQuestion];
    if (!containerId && config.allowAmbientObjects && ambientMention(name, location)
        && !previousAmbient && check.status !== 'excluded') {
        workingState.writeSession('discoveryDecisions', field => {
            field.value ||= {}; field.value[ambientQuestion] = { success: true,
                objectId: request.id, actorId: actor, locationId, objectKey, ambient: true };
        });
        return { type: 'success', objectId: request.id, ambient: true,
            question: ambientQuestion };
    }
    if (previousAmbient) return { type: 'blocked', reason: 'ambient_already_concretized' };
    const mode = contentMode(containerEntity, workingState, locationId);
    if (mode !== 'unspecified') return { type: 'blocked', reason: `container_${mode}` };
    if (check.status !== 'plausible') return { type: 'blocked', reason: check.reason,
        plausibility: check.status };
    if (!config.allowUncertainDiscoveries) return { type: 'blocked', reason: 'uncertain_discovery_disabled' };
    const configured = worldRules?.universalChecks;
    const rule = configured?.enabled === true && configured.rules?.find(item => item.id === RULE_ID);
    if (!rule || !evaluateCheck || !roll) return { type: 'blocked', reason: 'discovery_check_unavailable' };
    const question = JSON.stringify([containerId || locationId, objectKey]);
    const ledger = workingState.getSession('discoveryDecisions') || {};
    if (ledger[question]) return { type: ledger[question].success ? 'existing' : 'failure',
        objectId: ledger[question].objectId || null, check: ledger[question].check || null,
        repeated: true };
    const checkResult = evaluateCheck(rule, actor, roll);
    if (checkResult.kind === 'blocked') return { type: 'blocked', reason: checkResult.reason || 'check_blocked' };
    const success = checkResult.kind === 'success';
    workingState.writeSession('discoveryDecisions', field => {
        field.value ||= {}; field.value[question] = { success,
            objectId: success ? request.id : null, actorId: actor, locationId,
            containerId: containerId || null, objectKey, check: checkResult };
    });
    return { type: success ? 'success' : 'failure', objectId: success ? request.id : null,
        check: checkResult, question };
}
const api = { node, validateNodeDefinition, defaultRule, validateConfig,
    contentMode, concept, plausibility, ambientMention,
    resolveDynamicObjectDiscovery };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.HordeDynamicObjectDiscovery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
