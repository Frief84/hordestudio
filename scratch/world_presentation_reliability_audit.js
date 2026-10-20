const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { buildContext } = require('./app_source.js');

const app = fs.readFileSync('app.js', 'utf8');
const css = fs.readFileSync('style.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
let passed = 0;
function test(name, fn) {
    fn();
    passed++;
    console.log(`✓ ${name}`);
}

test('presentation normalization preserves live editor references', () => {
    const context = {
        isPlainObject: value => !!value && typeof value === 'object' && !Array.isArray(value),
        cssColor: (value, fallback) => value || fallback,
        livingClamp: (value, min, max) => Math.max(min, Math.min(max, Number(value))),
        WORLD_MEDIA_ASSET_LIMIT: 10000
    };
    buildContext(vm, ['normalizeWorldPresentation'], context);
    const world = { presentation: { enabled: false }, mediaAssets: [] };
    const live = context.normalizeWorldPresentation(world);
    context.normalizeWorldPresentation(world);
    live.enabled = true;
    assert.equal(world.presentation.enabled, true);
    assert.strictEqual(context.normalizeWorldPresentation(world), live);
});

test('image response decoder accepts dedicated and nested provider shapes', () => {
    const context = {
        isPlainObject: value => !!value && typeof value === 'object' && !Array.isArray(value)
    };
    buildContext(vm, ['gptProtoImageFromResponse'], context);
    const dedicated = context.gptProtoImageFromResponse({ data: [{ b64_json: 'iVBORw0KGgoAAAABBBB' }] });
    assert.match(dedicated, /^data:image\/png;base64,/);
    const nested = context.gptProtoImageFromResponse({
        choices: [{ message: { images: [{ image_url: { url: 'https://example.com/generated.png' } }] } }]
    });
    assert.equal(nested, 'https://example.com/generated.png');
});

test('pronoun-tagged lines keep discourse focus instead of stealing a name from dialogue', () => {
    const context = {
        parseHordeMarkdown: value => String(value),
        worldMediaSource: () => '',
        cssColor: value => value || '#e63946',
        escapeHTML: value => String(value),
        cssUrl: value => value
    };
    buildContext(vm, ['renderWorldNarrativeHtml'], context);
    const world = {
        entities: [
            { id: 'gloria', type: 'npc', name: 'Gloria Bell', visuals: { dialogueColor: '#bb2255' } },
            { id: 'wade', type: 'npc', name: 'Wade Greeley', visuals: { dialogueColor: '#884422' } }
        ]
    };
    const prose = 'Gloria Bell checks the switchboard.\n\nShe glances over her shoulder. “Don’t mind me,” she says, warm and easy. “Just borrowing the closet for a minute. Wade and I have an understanding.”\n\nWade Greeley grunts.\n\n“Understanding is she brings me the office mail,” he says.';
    const rendered = context.renderWorldNarrativeHtml(world, prose);
    const gloriaCards = (rendered.match(/data-speaker-id="gloria"/g) || []).length;
    const wadeCards = (rendered.match(/data-speaker-id="wade"/g) || []).length;
    assert.equal(gloriaCards, 2);
    assert.equal(wadeCards, 1);
});

test('ambiguous dialogue stays prose instead of receiving a false portrait', () => {
    const context = {
        parseHordeMarkdown: value => String(value),
        worldMediaSource: () => '',
        cssColor: value => value || '#e63946',
        escapeHTML: value => String(value),
        cssUrl: value => value
    };
    buildContext(vm, ['renderWorldNarrativeHtml'], context);
    const world = { entities: [
        { id: 'a', type: 'npc', name: 'Alex North', visuals: {} },
        { id: 'b', type: 'npc', name: 'Blair West', visuals: {} }
    ] };
    const rendered = context.renderWorldNarrativeHtml(world, 'Alex North and Blair West stare at each other.\n\n“Fine.”');
    assert(!rendered.includes('data-speaker-id='));
    assert(rendered.includes('“Fine.”'));
});

test('world speech alternates narration and the actual NPC lines', () => {
    const context = {};
    buildContext(vm, ['worldNarrativeSegments','worldSpeechChunks'], context);
    const world = { entities: [
        { id:'aslan', type:'npc', name:'Aslan' },
        { id:'lorne', type:'npc', name:'Lorne' }
    ] };
    const text = 'Aslan narrows his eyes. “You may pass,” Aslan says.\n\nLorne: Thank you.\n\nThe gate opens.';
    const parts = context.worldNarrativeSegments(world,text);
    assert.deepEqual(Array.from(parts, part => part.kind),
        ['narration','dialogue','narration','dialogue','narration']);
    assert.deepEqual(Array.from(parts.filter(part => part.kind === 'dialogue'), part => part.speaker.id),
        ['aslan','lorne']);
    assert.equal(parts[1].text,'You may pass,');
    const long = context.worldSpeechChunks('A long passage. '.repeat(160));
    assert(long.length > 1 && long.every(chunk => chunk.length <= 950));
    assert.equal(long.join(' ').replace(/\s+/g,' ').trim(), 'A long passage. '.repeat(160).trim());
});

test('the complete Aslan and Lorne turn keeps every passage in speaker order', () => {
    const profiles = {
        narrator:{engine:'kokoro',formula:'af_nicole:100'},
        aslan:{engine:'kokoro',formula:'bm_george:100'},
        lorne:{engine:'kokoro',formula:'am_michael:100'}
    };
    const context = {window:{HordeKokoro:{
        getNarratorProfile:()=>profiles.narrator,
        getWorldTurnProfileFor:npc=>profiles[npc.id]
    }}};
    buildContext(vm, ['worldSpeechParts'], context);
    const world = {entities:[
        {id:'aslan',type:'npc',name:'Aslan'},
        {id:'lorne',type:'npc',name:'Lorne'}
    ]};
    const turn = `Aslan's golden eyes flare with a sudden, sharp luminosity, the pupils narrowing as he considers the man. "A collector of forgotten stories? How fortunate," he remarks, his voice carrying a hint of ancient satisfaction. "I happen to know a few myself. Though 'forgotten' might be overstating it. There are still a handful of old souls who remember. Remarkable people, really. Excellent memories. A quality sadly lacking in the younger generations." He pauses, looking remarkably pleased with himself. "Tell me, my good man, do you merely collect stories, or do you tell them as well? I suspect we might have a rather interesting arrangement to discuss."

Lorne's posture changes instantly. The lazy lean on his staff vanishes, replaced by a focused, professional intensity. He looks at Aslan not as a curiosity, but as a primary source. For a storycatcher, the prospect of a living entity possessing forgotten lore is a rarity that outweighs the sheer absurdity of the entity being a toad. "I am both," Lorne replies, his voice dropping an octave in earnestness. "I curate the silenced and the erased, and I recount them to those who still have the patience to listen. As for an arrangement... you have my undivided attention. I find myself very curious as to what a creature of your... stature... considers a fair trade for a forgotten tale."`;
    const segments = context.worldNarrativeSegments(world,turn).filter(part => part.text.trim());
    const parts = context.worldSpeechParts(world,turn);
    assert.equal(parts.length,segments.length,'no narrator or dialogue passage may be skipped');
    assert.deepEqual(Array.from(parts,part=>part.kind),Array.from(segments,part=>part.kind));
    assert.deepEqual(Array.from(parts.filter(part=>part.kind==='dialogue'),part=>part.speakerId),
        ['aslan','aslan','aslan','lorne','lorne']);
    assert(parts.some(part=>part.text.startsWith("Aslan's golden eyes") && part.profile === profiles.narrator));
    assert(parts.some(part=>part.text.startsWith("Lorne's posture changes") && part.profile === profiles.narrator));
    assert(parts.filter(part=>part.speakerId==='aslan').every(part=>part.profile === profiles.aslan));
    assert(parts.filter(part=>part.speakerId==='lorne').every(part=>part.profile === profiles.lorne));
});

test('validated speech IDs keep one NPC voice through ambiguous narration', () => {
    const profiles = { narrator:{engine:'kokoro',formula:'af_nicole:100'},
        lorne:{engine:'kokoro',formula:'am_michael:100'} };
    const context = {window:{HordeKokoro:{getNarratorProfile:()=>profiles.narrator,
        getWorldTurnProfileFor:npc=>profiles[npc.id]}}};
    buildContext(vm, ['worldSpeechParts'], context);
    const world = {entities:[{id:'aslan',type:'npc',name:'Aslan'},
        {id:'lorne',type:'npc',name:'Lorne'}]};
    const text = 'Lorne studies Aslan. "I remember you." He looks toward Aslan again. "Of course I do."';
    const speech = [{speaker:'lorne',statement:'I remember you.'},
        {speaker:'lorne',statement:'Of course I do.'}];
    const parts = context.worldSpeechParts(world,text,speech);
    assert.deepEqual(Array.from(parts.filter(part=>part.kind==='dialogue'),part=>part.speakerId),
        ['lorne','lorne']);
    assert(parts.filter(part=>part.speakerId==='lorne').every(part=>part.profile === profiles.lorne));
});

test('full-turn playback begins with the matching player action and spoken words', () => {
    const narrator = {engine:'kokoro',formula:'af_nicole:100'};
    const player = {engine:'kokoro',formula:'bm_lewis:100'};
    const aslan = {engine:'kokoro',formula:'am_adam:100'};
    const context = {state:{personas:[{id:'lorne',name:'Lorne',pronouns:'he/him'}],activePersonaId:'lorne'},
        window:{HordeKokoro:{getNarratorProfile:()=>narrator,
            getWorldTurnProfileFor:entity=>entity.id.startsWith('player:') ? player : aslan}}};
    buildContext(vm, ['worldTurnSpeechParts'], context);
    const world = {entities:[{id:'aslan',type:'npc',name:'Aslan'}]};
    const action = {role:'user',text:'Lorne raises his staff. “I will listen,” he says.'};
    const reply = {role:'dm',text:'Aslan smiles. “Then listen,” Aslan replies.'};
    const session = {personaId:'lorne',history:[{role:'dm',text:'Earlier scene'},action,
        {role:'system',text:'A check was resolved'},reply]};
    assert.equal(context.worldPlayerMessageForReply(session,3),action);
    const parts = context.worldTurnSpeechParts(world,session,reply,3);
    assert.deepEqual(Array.from(parts,part=>part.kind),
        ['narration','player','narration','narration','dialogue','narration']);
    assert(parts[0].text.startsWith('Lorne raises his staff'));
    assert.equal(parts[1].text,'I will listen,');
    assert.equal(parts[1].profile,player);
    assert.equal(parts[4].text,'Then listen,');
    assert.equal(parts[4].profile,aslan);
    assert.equal(context.worldPlayerMessageForReply({history:[action,{role:'dm'},reply]},2),null,
        'an earlier action must not leak across an intervening DM reply');
    assert.equal(context.worldPlayerMessageForReply({history:[reply]},0),null,
        'an opening scene has no player action to prepend');
});

test('World speech has one full-turn control and never starts on commit', () => {
    assert(app.includes("fullTurnButton.textContent = '🔊 Read full turn'"));
    assert(!app.includes('queueWorldSpokenTurn('));
    assert(!app.includes('button.textContent = `🔊 ${label}`'));
});

test('the narrator profile is separate from the NPC fallback and legacy worlds still narrate', () => {
    const previous = global.window;
    global.window = {KokoroTagDesigner:{normalizeTag:tag=>tag,profileGenderMismatch:()=>false}};
    require('../virtual_humans/frontend/kokoro-world-bridge.js');
    const npcFallback = {engine:'kokoro',formula:'am_adam:100'};
    const narrator = {engine:'kokoro',formula:'bf_emma:100'};
    assert.equal(window.HordeKokoro.getNarratorProfile({voice_settings:{default_profile:npcFallback,narrator_profile:narrator}}).formula,
        'bf_emma:100');
    assert.equal(window.HordeKokoro.getNarratorProfile({voice_settings:{default_profile:npcFallback}}).formula,
        'am_adam:100');
    assert.equal(window.HordeKokoro.getNarratorProfile({voice_settings:{default_profile:npcFallback,narrator_profile:null}}),
        null);
    assert.equal(window.HordeKokoro.getNarratorProfile({}).formula,'af_nicole:100');
    assert.equal(window.HordeKokoro.getProfileFor({voice_source:'world'},
        {voice_settings:{default_profile:npcFallback,narrator_profile:narrator}}).formula,'am_adam:100');
    const aslanFallback = window.HordeKokoro.getWorldTurnProfileFor({id:'aslan',name:'Aslan'},{});
    const lorneFallback = window.HordeKokoro.getWorldTurnProfileFor({id:'lorne',name:'Lorne'},{});
    assert.notEqual(aslanFallback.formula,lorneFallback.formula);
    assert.notEqual(aslanFallback.formula,'af_nicole:100');
    global.window = previous;
});

test('world identity layout has explicit non-collapsing columns', () => {
    assert(html.includes('class="world-identity-grid"'));
    assert(css.includes('grid-template-columns: 180px minmax(0, 1fr)'));
    assert(css.includes('.world-identity-fields .form-input'));
});

test('all world visual generators restore their button in finally blocks', () => {
    assert.equal((app.match(/button\.textContent = 'Generating…';/g) || []).length, 3);
    assert((app.match(/finally \{\s*button\.disabled = false;\s*button\.textContent = '✨ Generate';/g) || []).length >= 3);
});

console.log(`\n${passed} world-presentation reliability checks passed.`);
