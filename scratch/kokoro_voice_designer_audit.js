const assert = require('node:assert/strict');

class Element {
    constructor() { this.children = []; this.style = {}; this.hidden = false; this.isConnected = true; this.textContent = ''; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; this.textContent = ''; }
    setAttribute() {}
}

global.document = {createElement:()=>new Element()};
global.window = {};
require('../virtual_humans/frontend/kokoro-voice-designer.js');
const designer = window.KokoroTagDesigner;

(async () => {
    assert.equal(designer.VOICE_CATALOG.length,54);
    const barkeeper = designer.tags_to_formula(['tired','smoky','barkeeper','male','british','slow','scratchy']);
    assert.equal(barkeeper.formula,'bm_george:50,am_michael:30,bm_lewis:20');
    assert.equal(barkeeper.effects.smoky,0.8);
    assert.equal(barkeeper.effects.tired,0.6);
    const male = designer.tags_to_formula(['male','soft','happy','old']);
    assert(male.parts.every(([voice]) => voice[1] === 'm'));
    const priest = designer.profileFromPersona('Speaks softly. His sympathy is performative. He preaches that the Holy Mother is testing the village.');
    assert.equal(priest?.tags[0],'male',
        'a religious title for someone else must not override the NPC’s exclusive pronouns');
    assert(priest.parts.every(([voice]) => voice[1] === 'm'));

    const host = new Element();
    const changes = [];
    global.fetch = async () => ({ok:true,json:async () => ({tags:['female','raspy','deep']})});
    designer.render(host,profile => changes.push(profile),
        {engine:'kokoro',...male,lang:'a'});
    const wrapper = host.children[0];
    assert.equal(wrapper.children[2].textContent,'Selected voice traits');
    assert.equal(wrapper.children[6].textContent,'Suggestions — click to add');
    assert.equal(wrapper.children[7].getAttribute?.('aria-label'),undefined);
    const input = wrapper.children[0];
    input.value = 'mysterious and gravelly';
    await input.onkeydown({key:'Enter',preventDefault(){}});
    assert(changes.at(-1).tags.includes('raspy'));
    assert(changes.at(-1).tags.includes('deep'));
    assert(changes.at(-1).parts.every(([voice]) => voice[1] === 'm'));
    assert(changes.at(-1).descriptions.includes('mysterious and gravelly'));

    const unchangedFormula = changes.at(-1).formula;
    global.fetch = async () => { throw new Error('Server unavailable'); };
    input.value = 'moonlit and velvety';
    await input.onkeydown({key:'Enter',preventDefault(){}});
    assert.equal(changes.at(-1).formula,unchangedFormula,
        'an uninterpreted phrase must not claim an audible voice change');
    assert(changes.at(-1).descriptions.includes('moonlit and velvety'));

    const oldRender = input;
    designer.render(host,()=>{},changes.at(-1));
    const previousChanges = changes.length;
    oldRender.value = 'ancient and stern';
    global.fetch = async () => ({ok:true,json:async () => ({tags:['mature']})});
    await oldRender.onkeydown({key:'Enter',preventDefault(){}});
    assert.equal(changes.length,previousChanges,
        'a detached editor must not overwrite a newer render');
    console.log('PASS Kokoro voice designer suggestions, open descriptions, gender, and stale editor guard');
})().catch(error => { console.error(error); process.exitCode = 1; });
