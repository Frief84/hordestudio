const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = process.cwd();
const assetDir = path.join(root, 'assets/worlds/policy-panic');
const outputFile = path.join(root, 'Policy Panic at Bramble and Pike.horde_world');
const bundledFile = path.join(root, 'policy-panic-world.js');

const sourceAssets = {
    cover: ['cover.png', 'map_skin', 'Bramble & Pike ensemble cover', 1600, 900],
    denton: ['denton-pike.png', 'npc_portrait', 'Denton Pike portrait', 768, 768],
    gloria: ['gloria-bell.png', 'npc_portrait', 'Gloria Bell portrait', 768, 768],
    mara: ['mara-voss.png', 'npc_portrait', 'Mara Voss portrait', 768, 768],
    eli: ['eli-finch.png', 'npc_portrait', 'Eli Finch portrait', 768, 768],
    prudence: ['prudence-kettle.png', 'npc_portrait', 'Prudence Kettle portrait', 768, 768],
    wade: ['wade-greeley.png', 'npc_portrait', 'Wade Greeley portrait', 768, 768],
    connor: ['connor-vale.png', 'npc_portrait', 'Connor Vale portrait', 768, 768],
    nisha: ['nisha-patel.png', 'npc_portrait', 'Nisha Patel portrait', 768, 768],
    reception: ['reception.png', 'location_background', 'Reception lobby', 1600, 900],
    bullpen: ['bullpen.png', 'location_background', 'Main office bullpen', 1600, 900],
    breakroom: ['break-room.png', 'location_background', 'Break room', 1600, 900],
    records: ['records-basement.png', 'location_background', 'Records basement', 1600, 900]
};

function hashData(text) {
    let hash = 2166136261;
    const stride = Math.max(1, Math.floor(text.length / 4096));
    for (let i = 0; i < text.length; i += stride) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return `${text.length.toString(36)}_${(hash >>> 0).toString(36)}`;
}

async function prepareAssets() {
    const media = [];
    const ids = {};
    for (const [key, [filename, kind, label, width, height]] of Object.entries(sourceAssets)) {
        const target = path.join(assetDir, filename.replace(/\.png$/i, '.jpg'));
        await sharp(path.join(assetDir, filename))
            .resize(width, height, { fit: kind === 'npc_portrait' ? 'cover' : 'inside', withoutEnlargement: true })
            .jpeg({ quality: kind === 'npc_portrait' ? 82 : 78, mozjpeg: true })
            .toFile(target);
        const data = `data:image/jpeg;base64,${fs.readFileSync(target).toString('base64')}`;
        const id = `media_policy_${key}`;
        ids[key] = id;
        media.push({
            id, kind, label, data, hash: hashData(data), createdAt: Date.now(), generated: true,
            model: 'OpenAI built-in image generator',
            prompt: 'Original quirky painterly caricature art for Policy Panic at Bramble & Pike.'
        });
    }
    return { media, ids };
}

const exit = (text, travelTime = 1) => ({ text, travelTime, isOneWay: false });
const visual = backgroundAssetId => ({ backgroundAssetId, backgroundPosition: 'center' });
const schedule = (...blocks) => blocks;
const relations = (...items) => items.map(([entityId, label, score]) => ({ entityId, label, score }));

async function build() {
    const { media, ids } = await prepareAssets();
    const world = {
        _format: 'horde-world',
        _version: 2,
        _exportedAt: new Date().toISOString(),
        _mediaManifest: { schema: 1, count: media.length, embedded: true },
        bundledId: 'policy-panic-v4',
        id: 'world_policy_panic_bramble_pike',
        name: 'Policy Panic at Bramble & Pike',
        description: 'A living small-town workplace comedy inside a dysfunctional regional insurance office. Join at any rung, survive absurd claims, romance coworkers, expose secrets, chase promotion, ruin the copier and reshape the whole branch.',
        banner: media.find(asset => asset.id === ids.cover).data,
        model: '',
        presentation: {
            version: 1,
            enabled: true,
            mode: 'cinematic',
            playerCanOverride: true,
            artStyle: 'custom',
            artDirection: 'Original quirky caricature illustration with painterly editorial-animation texture. Expressive adult faces, gently exaggerated silhouettes and warped office perspective. Warm fluorescent light against cool rainy small-town windows. Mustard, teal, burgundy, copier-paper white and beige. Comedy is affectionate, specific and cinematic; never use celebrity likenesses, readable brand marks or direct imitation of an existing show.',
            accent: '#C43F66',
            panelOpacity: 84,
            backgroundDim: 58,
            mapSkinAssetId: ids.cover,
            imageProvider: 'inherit',
            imageModel: 'google/gemini-3.1-flash-lite-image'
        },
        mediaAssets: media,
        dmPrompt: `You are the showrunner, referee and living-world engine for POLICY PANIC AT BRAMBLE & PIKE, an original adult workplace comedy set in the small town of Maplebridge.

CORE PROMISE
- The player may be any adult and pursue any life: intern, receptionist, adjuster, salesperson, accountant, cleaner, executive, regulator, client, rival, romantic partner, saboteur or accidental local celebrity.
- There is no mandatory plot and no reset-to-status-quo. Promotions, firings, romances, grudges, lawsuits, office elections, branch closure, buyouts and public scandals persist.
- Treat work as a real system. Claims have evidence, policy language, reserves, liability and human stakes. Sales have targets, commissions and ethical compromises. HR has procedures, gossip and leverage. The town remembers what happens.

COMEDY ENGINE
- Characters are extreme, immediately readable archetypes, but they are never empty props. Each has competence, vanity, vulnerability, boundaries, private needs and something they are right about.
- Escalate from a concrete mundane problem: a cake, printer, parking space, suspicious claim, dress-code memo, client, storm, audit, rumor, charity drive or town event. Let incentives collide until the office creates its own farce.
- Keep jokes inside the fiction. No meta commentary, canned sitcom applause, meme dumping or references to existing television characters.
- Use running gags sparingly and let them evolve. Consequences remain after the punchline.

ADULT SOCIAL LIFE
- Flirting, attraction, dating, jealousy and consensual adult relationships may emerge naturally. Never assume consent, never narrate the player's attraction, and never reduce Gloria or any woman to a reward. Gloria deliberately performs a glamorous bimbo persona because people underestimate her; she has firm boundaries, sharp social intelligence and independent ambitions.
- Coworkers can refuse advances, misread signals, date each other, break up, reconcile, gossip or choose professionalism. Power imbalances matter.

SIMULATION DISCIPLINE
- Honor the world clock, direct exits, work schedules, homes and who is actually present. Nobody teleports with the player.
- NPCs pursue goals off-screen. Denton chases branch glory; Gloria builds influence and a private event business; Mara investigates anomalies; Prudence protects the books; Connor protects his ranking; Nisha limits legal exposure; Eli seeks belonging; Wade quietly protects the building and its secrets.
- Information travels through overheard calls, email, meetings, gossip, client visits, town news and paperwork. Do not give characters knowledge they could not have.
- Use world tools for durable movement, cast, time, relationships, stats, inventory, quests, schedules, conditions and events. Commit one complete world-turn receipt every response.

PLAYER AGENCY
- Never write the player's dialogue, thoughts, consent or completed voluntary action. Resolve only what they attempt and what the world does in response.
- Use checks only when failure is interesting: persuasion, investigation, deception, office politics, technical work or physical mishap. Failure creates complication, not a dead end.
- End most turns with a changed situation, pressure, opportunity or a clear person waiting for an answer.

VOICE
Second person, present tense. Fast, concrete, character-driven. Dialogue should be short and distinctive. Sensory detail comes from stale coffee, toner, rain, cheap perfume, wet wool, filing dust, humming lights and small-town weather—not purple prose.`,
        intro: `Monday, 8:57 a.m. Rain needles the glass doors of Bramble & Pike Mutual while the lobby switchboard blinks like a tiny distress signal.

Gloria Bell sits behind the curved reception desk in magenta, perfectly composed, one manicured finger holding down three phone lines at once. She looks up at you with a smile that says she already knows why you are here—and probably knows a better reason you should leave.

Behind her, something heavy crashes in the bullpen. Eli Finch yelps. The copier begins emitting a continuous alarm. Denton Pike's voice rolls out of his office: “Nobody panic. This is what controlled momentum sounds like.”

Then a soaked woman from the state insurance commission walks through the door, shows Gloria a badge, and asks to see the branch manager.

It is not yet nine o'clock.`,
        authorNote: 'Keep the office funny because people want incompatible things, not because reality stops mattering. Keep every NPC voice distinct. Maintain clock, presence, reporting lines and town memory. Let quiet workdays, romance, friendship and competence matter as much as scandals.',
        startLocationId: 'loc_reception',
        kernel: { enabled: true, sceneLocationLimit: 28, memoryMode: 'ledger', repairMode: 'adaptive', compactTools: true },
        worldAgent: { enabled: true, intervalTurns: 18, model: '', lastRunTurn: 0 },
        hudConfig: {
            showClock: true, showQuests: true, showLedger: true, showInventory: true, enableSchedules: true,
            startTimeHours: 8, startTimeMinutes: 57, timeStep: 5, startWeekday: 'Monday', showDays: true,
            stats: [
                { id: 'performance', name: 'Performance', value: 50, min: 0, max: 100, color: '#30D158', roll: { enabled: true, mode: 'normalized', direction: 'higher', scale: 10, fixedModifier: 0 } },
                { id: 'reputation', name: 'Office Reputation', value: 0, min: -100, max: 100, color: '#B892FF', roll: { enabled: true, mode: 'normalized', direction: 'higher', scale: 20, fixedModifier: 0 } },
                { id: 'stress', name: 'Stress', value: 15, min: 0, max: 100, color: '#FFB020', roll: { enabled: false } },
                { id: 'cash', name: 'Cash', value: 120, min: 0, max: 0, color: '#30D158', roll: { enabled: false } },
                { id: 'nerve', name: 'Nerve', value: 5, min: 0, max: 10, color: '#E63946', roll: { enabled: true, mode: 'direct', direction: 'higher', scale: 1, fixedModifier: 0 } },
                { id: 'insight', name: 'Insight', value: 5, min: 0, max: 10, color: '#00C7D9', roll: { enabled: true, mode: 'direct', direction: 'higher', scale: 1, fixedModifier: 0 } },
                { id: 'charm', name: 'Charm', value: 5, min: 0, max: 10, color: '#C43F66', roll: { enabled: true, mode: 'direct', direction: 'higher', scale: 1, fixedModifier: 0 } }
            ]
        },
        gameRules: {
            profileId: 'custom', vitalStatId: '', currencyStatId: 'cash', currencyName: 'dollars', zeroHpMode: 'fail_forward',
            modules: { stats: true, health: false, conditions: true, checks: true, inventory: true, commerce: true, quests: true, relationships: true, schedules: true, livingWorld: true },
            dice: { resolution: 'automatic', sides: 20, modifierMode: 'per_stat', defaultDifficulty: 11, criticals: true }
        },
        sandboxConfig: { enabled: true, politics: true, conflict: false, law: true, seasons: true, growth: true, scale: 'local', calendar: 'Maplebridge civic year', seasonDays: 91, principles: 'Reputation, money, employment, policy obligations, town relationships and information move the world. The branch can prosper, close, merge, unionize or become locally indispensable.' },
        locations: [
            { id: 'loc_maplebridge', name: 'Maplebridge', mapType: 'region', region: 'Maplebridge', description: 'A rain-prone town of nineteen thousand where everyone has one insurance agent, two grudges and an opinion about parking.', hiddenDescription: 'The town economy depends on the paper mill, county payroll and a suspicious number of roof claims.', exits: [exit('to Rainier Main Street', 8)], visuals: visual(ids.cover), prosperity: 58, danger: 8 },
            { id: 'loc_main_street', name: 'Rainier Main Street', mapType: 'route', parentLocationId: 'loc_maplebridge', region: 'Downtown Maplebridge', description: 'Brick storefronts, wet awnings and familiar faces compressed into six blocks of municipal pride.', exits: [exit('to Maplebridge', 8), exit('to Bramble & Pike Parking Lot', 4), exit("to Millie's Diner", 5), exit('to Maplebridge Town Hall', 6), exit('to The Bent Stapler', 7)], visuals: visual(ids.cover), prosperity: 62, danger: 10 },
            { id: 'loc_parking', name: 'Bramble & Pike Parking Lot', mapType: 'outdoor', parentLocationId: 'loc_office', region: 'Bramble & Pike Mutual', description: 'Twenty-three painted spaces, one executive space, three chronic oil stains and a daily cold war over who parked crooked.', exits: [exit('to Rainier Main Street', 4), exit('to Reception Lobby', 1), exit('to Records Basement', 2)], visuals: visual(ids.cover), prosperity: 44, danger: 12 },
            { id: 'loc_office', name: 'Bramble & Pike Mutual — Maplebridge Regional', mapType: 'building', parentLocationId: 'loc_main_street', region: 'Bramble & Pike Mutual', description: 'A converted storefront housing the regional branch of a respectable insurer with an increasingly theoretical respectability.', exits: [exit('to Bramble & Pike Parking Lot', 1), exit('to Reception Lobby', 1)], visuals: visual(ids.reception), prosperity: 55, danger: 5 },
            { id: 'loc_reception', name: 'Reception Lobby', mapType: 'room', parentLocationId: 'loc_office', region: 'Bramble & Pike Mutual', description: 'A polished curved desk commands teal chairs, rain-streaked glass and a switchboard that knows every secret first.', hiddenDescription: "Gloria keeps a private appointment book beneath the flower drawer and can identify most callers by the rhythm of their first breath.", exits: [exit('to Bramble & Pike Parking Lot', 1), exit('to Main Bullpen', 1), exit("to Denton Pike's Office", 1)], visuals: visual(ids.reception) },
            { id: 'loc_bullpen', name: 'Main Bullpen', mapType: 'room', parentLocationId: 'loc_office', region: 'Bramble & Pike Mutual', description: 'A beige maze of ringing phones, personalized cubicles, claim folders and a copier whose red light is treated as weather.', exits: [exit('to Reception Lobby', 1), exit("to Denton Pike's Office", 1), exit('to Claims Cave', 1), exit('to HR & Operations', 1), exit('to Break Room', 1), exit('to Supply Closet', 1)], visuals: visual(ids.bullpen) },
            { id: 'loc_denton', name: "Denton Pike's Office", mapType: 'room', parentLocationId: 'loc_office', region: 'Bramble & Pike Mutual', description: 'A glass-walled kingdom of sales trophies, motivational diagrams and one leather chair positioned three inches higher than its visitor chairs.', hiddenDescription: 'A locked drawer contains branch-closure projections and rejection letters from corporate leadership programs.', exits: [exit('to Reception Lobby', 1), exit('to Main Bullpen', 1)], visuals: visual(ids.bullpen), secrets: [{ label: 'Closure Forecast', hint: 'Denton has started taking calls with the blinds shut.', truth: 'Corporate has placed Maplebridge on a ninety-day performance watch. Denton has told nobody.' }] },
            { id: 'loc_claims', name: 'Claims Cave', mapType: 'room', parentLocationId: 'loc_office', region: 'Bramble & Pike Mutual', description: 'Mara has turned two cubicles into a dim investigative bunker of maps, photographs and policy binders.', hiddenDescription: 'Three recent storm claims share a contractor, a notary and the same impossible weather timestamp.', exits: [exit('to Main Bullpen', 1), exit('to Records Basement', 2)], visuals: visual(ids.bullpen), secrets: [{ label: 'Rainmaker Pattern', hint: 'Red string connects three ordinary roof claims.', truth: 'Someone is staging storm damage through Lark & Sons Roofing, and one policy was approved from inside this branch.' }] },
            { id: 'loc_hr', name: 'HR & Operations', mapType: 'room', parentLocationId: 'loc_office', region: 'Bramble & Pike Mutual', description: 'Nisha runs a small bright office where every binder is labeled, every chair is equal height and every conversation somehow has minutes.', hiddenDescription: 'Nisha maintains a private risk matrix ranking which employee disaster is most likely to trigger litigation.', exits: [exit('to Main Bullpen', 1), exit('to Break Room', 1)], visuals: visual(ids.bullpen) },
            { id: 'loc_break', name: 'Break Room', mapType: 'room', parentLocationId: 'loc_office', region: 'Bramble & Pike Mutual', description: 'An avocado refrigerator, round table, vending machine and overworked microwave form the unofficial legislature of the branch.', hiddenDescription: 'The ceiling tile above the vending machine lifts into an old service crawlspace. Wade knows. Gloria suspects.', exits: [exit('to Main Bullpen', 1), exit('to HR & Operations', 1), exit('to Supply Closet', 1)], visuals: visual(ids.breakroom) },
            { id: 'loc_supply', name: 'Supply Closet', mapType: 'room', parentLocationId: 'loc_office', region: 'Bramble & Pike Mutual', description: 'Toner, legal pads, umbrellas, mop heads and forty years of objects nobody admits owning are packed around Wade’s folding stool.', hiddenDescription: 'Behind obsolete binders is a service hatch into the records basement and a biscuit tin of spare keys.', exits: [exit('to Main Bullpen', 1), exit('to Break Room', 1), exit('to Records Basement', 1)], visuals: visual(ids.breakroom) },
            { id: 'loc_records', name: 'Records Basement', mapType: 'room', parentLocationId: 'loc_office', mapFloor: 'Basement', region: 'Bramble & Pike Mutual', description: 'Claim boxes climb toward exposed pipes around a furnace, archive ladder and locked evidence cage.', hiddenDescription: 'A shelf labeled for routine disposal contains files from a chemical spill settlement corporate claimed never reached Maplebridge groundwater.', exits: [exit('to Bramble & Pike Parking Lot', 2), exit('to Claims Cave', 2), exit('to Supply Closet', 1)], visuals: visual(ids.records), danger: 18, secrets: [{ label: 'Groundwater Files', hint: 'One row of boxes has fresh dust marks despite ancient dates.', truth: 'Corporate buried evidence connecting Pike Chemical’s 1998 spill to ongoing illness claims.' }] },
            { id: 'loc_diner', name: "Millie's Diner", mapType: 'building', parentLocationId: 'loc_main_street', region: 'Downtown Maplebridge', description: 'A chrome-edged diner where coffee arrives before the menu and town news arrives before either.', hiddenDescription: 'Millie hears every municipal secret and never repeats one without improving it.', exits: [exit('to Rainier Main Street', 5)], visuals: visual(ids.breakroom), shop: [{ item: 'coffee', price: 2, quantity: 50, maxQuantity: 50, regenPerTurn: 2 }, { item: 'blue plate lunch', price: 9, quantity: 20, maxQuantity: 20, regenPerTurn: 1 }] },
            { id: 'loc_townhall', name: 'Maplebridge Town Hall', mapType: 'building', parentLocationId: 'loc_main_street', region: 'Downtown Maplebridge', description: 'A brick civic building where permits, grudges and bake-sale budgets move through the same narrow corridors.', hiddenDescription: 'The mayor’s reelection committee is insured through Connor and audited by Prudence’s estranged sister.', exits: [exit('to Rainier Main Street', 6)], visuals: visual(ids.reception) },
            { id: 'loc_bar', name: 'The Bent Stapler', mapType: 'building', parentLocationId: 'loc_main_street', region: 'Downtown Maplebridge', description: 'A former stationery shop turned bar with karaoke Thursdays, cheap wings and booths that have heard every office confession.', hiddenDescription: 'The back room hosts a monthly poker game attended by the mayor, a roofing contractor and one Bramble & Pike employee.', exits: [exit('to Rainier Main Street', 7)], visuals: visual(ids.breakroom), shop: [{ item: 'draft beer', price: 5, quantity: 80, maxQuantity: 80, regenPerTurn: 2 }, { item: 'basket of wings', price: 11, quantity: 30, maxQuantity: 30, regenPerTurn: 1 }] },
            { id: 'loc_gloria_home', name: "Gloria's Apartment", mapType: 'room', parentLocationId: 'loc_maplebridge', region: 'Juniper Court', description: 'A glamorous one-bedroom above a florist, full of mirrors, sample invitations and evidence of a second life as an event planner.', exits: [exit('to Maplebridge', 10)], visuals: visual(ids.reception) },
            { id: 'loc_denton_home', name: "Denton's Split-Level", mapType: 'building', parentLocationId: 'loc_maplebridge', region: 'Fox Run', description: 'A loudly aspirational suburban house with an immaculate lawn, silent dining room and garage full of abandoned self-improvement equipment.', exits: [exit('to Maplebridge', 14)], visuals: visual(ids.cover) },
            { id: 'loc_mara_home', name: "Mara's Duplex", mapType: 'room', parentLocationId: 'loc_maplebridge', region: 'Old Mill Ward', description: 'Half a brick duplex where blackout curtains, case notes and a well-fed elderly cat share the living room.', exits: [exit('to Maplebridge', 12)], visuals: visual(ids.records) },
            { id: 'loc_prudence_home', name: "Prudence's House", mapType: 'building', parentLocationId: 'loc_maplebridge', region: 'Saint Agnes Row', description: 'A narrow spotless house where clocks agree, receipts are archived and one upstairs room remains permanently closed.', exits: [exit('to Maplebridge', 11)], visuals: visual(ids.reception) },
            { id: 'loc_connor_home', name: "Connor's Condo", mapType: 'room', parentLocationId: 'loc_maplebridge', region: 'River Lofts', description: 'An immaculate bachelor condo with gift baskets, sales books and framed photographs that always place Connor in the center.', exits: [exit('to Maplebridge', 13)], visuals: visual(ids.bullpen) },
            { id: 'loc_nisha_home', name: "Nisha's Townhouse", mapType: 'building', parentLocationId: 'loc_maplebridge', region: 'Cedar Commons', description: 'A calm townhouse shared with a sleepy rescue greyhound and no visible work paperwork, by deliberate rule.', exits: [exit('to Maplebridge', 15)], visuals: visual(ids.reception) },
            { id: 'loc_eli_home', name: "Eli's Rental Room", mapType: 'room', parentLocationId: 'loc_maplebridge', region: 'College Hill', description: 'A tiny rented room with interview books, instant noodles, sticky notes and a mattress pretending to be a sofa.', exits: [exit('to Maplebridge', 16)], visuals: visual(ids.bullpen) },
            { id: 'loc_wade_home', name: "Wade's Workshop", mapType: 'building', parentLocationId: 'loc_maplebridge', region: 'County Line', description: 'A corrugated workshop behind a small house, crowded with repaired appliances and labeled boxes of parts nobody manufactures anymore.', exits: [exit('to Maplebridge', 20)], visuals: visual(ids.records) }
        ],
        entities: [
            {
                id: 'npc_denton', name: 'Denton Pike', type: 'npc', isMajor: true, startLocation: 'loc_denton', homeLocation: 'loc_denton_home', factionId: 'fac_management',
                description: 'Forty-nine, broad and theatrical, in a navy suit, patterned tie and gold watch. His office voice arrives several seconds before he does.',
                persona: 'A pompous motivational tyrant who genuinely believes morale is a renewable resource he personally generates. Denton is vain, insecure, occasionally brave and desperate to prove the Pike name still matters. He mangles management language, rewards loyalty extravagantly and takes criticism as a weather event.',
                goal: 'Push the branch above corporate’s closure threshold without admitting it is under review.', goalAutonomy: 'high', goalDifficulty: 65, goalDeadlineTurns: 45,
                goalSteps: ['Conceal the ninety-day performance warning', 'Launch an aggressive local sales initiative', 'Win the county employee benefits account', 'Blame any irregularity on outdated systems'],
                secrets: [{ label: 'Performance Watch', hint: 'He closes the blinds for calls from corporate.', truth: 'Corporate will close or absorb the branch if its loss ratio and new business do not improve within ninety days.' }],
                schedule: schedule(
                    { time: '07:45', locationId: 'loc_denton', activity: 'Practices the morning address and checks sales numbers', days: ['weekday'] },
                    { time: '09:05', locationId: 'loc_bullpen', activity: 'Performs a motivational lap through the branch', days: ['weekday'] },
                    { time: '12:20', locationId: 'loc_diner', activity: 'Turns lunch into informal business development', days: ['weekday'] },
                    { time: '15:00', locationId: 'loc_denton', activity: 'Takes private corporate calls', days: ['weekday'] },
                    { time: '18:15', locationId: 'loc_denton_home', activity: 'Rewrites tomorrow’s plan instead of discussing dinner', days: ['weekday'] },
                    { time: '11:00', locationId: 'loc_main_street', activity: 'Appears conspicuously at civic events', days: ['saturday'] }
                ),
                relations: relations(['npc_gloria', 'depends on her competence; pretends otherwise', 32], ['npc_connor', 'favorite rainmaker and possible successor', 48], ['npc_prudence', 'mutual respect buried under combat', -5], ['npc_nisha', 'fears her documentation', 8]),
                visuals: { portraitAssetId: ids.denton, portraitPosition: 'center', dialogueColor: '#D39B32' }
            },
            {
                id: 'npc_gloria', name: 'Gloria Bell', type: 'npc', isMajor: true, startLocation: 'loc_reception', homeLocation: 'loc_gloria_home', factionId: 'fac_frontdesk',
                description: 'Twenty-nine, voluptuous and impeccably glamorous, with an enormous auburn blowout, dramatic lashes, gold hoops and fitted jewel-tone office clothes. She looks expensive in a building that is not.',
                persona: 'Gloria performs cheerful bimbo sweetness because being underestimated gives her room to listen. She is warm, shamelessly flirtatious when she chooses, socially brilliant, excellent with frightened clients and ruthless about her boundaries. She enjoys beauty and attention without being naive. She wants a life bigger than the reception desk and refuses to apologize for wanting money, romance, fun and power at the same time.',
                goal: 'Turn her covert event-planning side business into a real company without Denton discovering she uses the office switchboard after hours.', goalAutonomy: 'high', goalDifficulty: 55, goalDeadlineTurns: 60,
                goalSteps: ['Land the Founders Day gala contract', 'Recruit reliable vendors', 'Keep branch gossip from reaching Denton', 'Decide whether to leave Bramble & Pike or leverage a promotion'],
                secrets: [
                    { label: 'Second Book', hint: 'A separate appointment book disappears whenever management approaches.', truth: 'Gloria coordinates weddings and civic events through a profitable unregistered side business called Bell & Bow.' },
                    { label: 'Unsent Application', hint: 'She knows the executive-assistant pay band oddly well.', truth: 'Gloria qualified for a corporate operations role but never submitted the application after Denton casually said she was “the face of the branch.”' }
                ],
                schedule: schedule(
                    { time: '08:15', locationId: 'loc_reception', activity: 'Opens the switchboard, flowers and information economy', days: ['weekday'] },
                    { time: '10:45', locationId: 'loc_bullpen', activity: 'Delivers messages and quietly maps the office mood', days: ['weekday'] },
                    { time: '12:05', locationId: 'loc_diner', activity: 'Lunches with a rotating town contact or vendor', days: ['weekday'] },
                    { time: '13:00', locationId: 'loc_reception', activity: 'Runs the desk and protects clients from office chaos', days: ['weekday'] },
                    { time: '17:45', locationId: 'loc_gloria_home', activity: 'Builds event proposals and changes out of office mode', days: ['weekday'] },
                    { time: '19:30', locationId: 'loc_bar', activity: 'Karaoke, dates or event networking', days: ['thursday', 'friday'] },
                    { time: '11:00', locationId: 'loc_townhall', activity: 'Coordinates civic event details', days: ['saturday'] }
                ),
                relations: relations(['npc_denton', 'manages him while letting him think he manages her', 24], ['npc_nisha', 'trusted ally with opposite methods', 58], ['npc_connor', 'old flirtation turned competitive friendship', 18], ['npc_eli', 'protective older-sister energy', 66]),
                visuals: { portraitAssetId: ids.gloria, portraitPosition: 'center', dialogueColor: '#D94F8A' }
            },
            {
                id: 'npc_mara', name: 'Mara Voss', type: 'npc', isMajor: true, startLocation: 'loc_claims', homeLocation: 'loc_mara_home', factionId: 'fac_claims',
                description: 'Thirty-eight, angular and severe, with a short black bob, trench coat, clipped tie and the posture of someone cross-examining the weather.',
                persona: 'Treats every claim like a conspiracy until evidence proves it merely tragic. Humorless in presentation, deeply funny by accident. Mara is skeptical, observant, loyal to ordinary policyholders and terrible at casual conversation. She collects exact facts because uncertainty once cost her family their home.',
                goal: 'Prove the Rainmaker fraud pattern without alerting the insider approving the claims.', goalAutonomy: 'high', goalDifficulty: 72, goalDeadlineTurns: 50,
                goalSteps: ['Compare storm timestamps', 'Trace contractor payments', 'Identify the internal approval account', 'Protect legitimate claimants from blanket denial'],
                secrets: [{ label: 'Personal Claim', hint: 'She keeps one fire-damaged policy file in her locked desk.', truth: 'Her family lost their home after a previous insurer used a technicality to deny the claim; her crusade is personal.' }],
                schedule: schedule(
                    { time: '07:30', locationId: 'loc_claims', activity: 'Reviews new losses before anyone can contaminate the facts', days: ['weekday'] },
                    { time: '10:00', locationId: 'loc_records', activity: 'Pulls historical files and chain-of-custody notes', days: ['monday', 'wednesday', 'friday'] },
                    { time: '12:40', locationId: 'loc_break', activity: 'Eats the same lunch while listening more than speaking', days: ['weekday'] },
                    { time: '14:00', locationId: 'loc_maplebridge', activity: 'Inspects losses and interviews claimants', days: ['weekday'] },
                    { time: '19:00', locationId: 'loc_mara_home', activity: 'Files notes while her cat occupies the evidence', days: ['weekday'] }
                ),
                relations: relations(['npc_prudence', 'the one colleague whose numbers she trusts', 62], ['npc_connor', 'suspects charm is a form of evidence destruction', -42], ['npc_wade', 'quiet exchange of building facts', 37]),
                visuals: { portraitAssetId: ids.mara, portraitPosition: 'center', dialogueColor: '#3D8EA6' }
            },
            {
                id: 'npc_eli', name: 'Eli Finch', type: 'npc', isMajor: true, startLocation: 'loc_bullpen', homeLocation: 'loc_eli_home', factionId: 'fac_frontdesk',
                description: 'Twenty-four, skinny and curly-haired, wearing an oversized shirt, loose teal tie, multiple lanyards and the permanent expression of a man arriving three seconds late to his own life.',
                persona: 'Enthusiastic, catastrophically helpful and constitutionally unable to admit he does not understand an instruction. Eli learns quickly after the explosion. He wants everyone to like him, idolizes whichever coworker spoke last and has a startling talent for calming furious clients when he stops performing competence.',
                goal: 'Earn a permanent position before his twelve-week internship ends.', goalAutonomy: 'medium', goalDifficulty: 45, goalDeadlineTurns: 35,
                goalSteps: ['Complete claims intake without a correction', 'Find a mentor', 'Contribute one useful idea at the branch meeting', 'Stop volunteering for mutually exclusive tasks'],
                secrets: [{ label: 'Connection', hint: 'He changes the subject whenever the board chair is mentioned.', truth: 'Eli is the nephew of a Bramble & Pike board member and is terrified the office will learn he was placed here as a favor.' }],
                schedule: schedule(
                    { time: '08:00', locationId: 'loc_bullpen', activity: 'Arrives early and accidentally creates three priorities', days: ['weekday'] },
                    { time: '10:00', locationId: 'loc_reception', activity: 'Covers phones while Gloria handles difficult clients', days: ['tuesday', 'thursday'] },
                    { time: '12:00', locationId: 'loc_break', activity: 'Asks for career advice and receives five incompatible answers', days: ['weekday'] },
                    { time: '15:30', locationId: 'loc_records', activity: 'Files documents with dangerous confidence', days: ['weekday'] },
                    { time: '18:30', locationId: 'loc_eli_home', activity: 'Studies insurance terminology and reheats noodles', days: ['weekday'] }
                ),
                relations: relations(['npc_gloria', 'trusts her more than he admits', 68], ['npc_denton', 'desperate for approval', 51], ['npc_wade', 'unofficial practical mentor', 43]),
                visuals: { portraitAssetId: ids.eli, portraitPosition: 'center', dialogueColor: '#63A46C' }
            },
            {
                id: 'npc_prudence', name: 'Prudence Kettle', type: 'npc', isMajor: true, startLocation: 'loc_bullpen', homeLocation: 'loc_prudence_home', factionId: 'fac_claims',
                description: 'Fifty-two, tall and severe, with an architectural black bun, rectangular glasses, grey skirt suit, pearl brooch and a calculator large enough to require both hands.',
                persona: 'A dry, terrifying accountant who experiences a balanced ledger as moral beauty. Prudence remembers every cent and most apologies. She appears rigid because she has spent years preventing louder people from converting optimism into fraud. Secretly enjoys karaoke and elaborate baking, both under strict conditions.',
                goal: 'Reconcile an unexplained reserve discrepancy before quarterly close and determine who is moving money between claim files.', goalAutonomy: 'high', goalDifficulty: 68, goalDeadlineTurns: 30,
                goalSteps: ['Freeze unofficial reserve adjustments', 'Audit Connor’s recent accounts', 'Compare Rainmaker payments', 'Decide whether to report upward or protect the branch'],
                secrets: [{ label: 'Closed Room', hint: 'She never discusses the second bedroom in her house.', truth: 'Prudence’s adult son left after a brutal argument about his failed business; she still pays one small debt anonymously each month.' }],
                schedule: schedule(
                    { time: '07:15', locationId: 'loc_bullpen', activity: 'Balances yesterday before today can lie', days: ['weekday'] },
                    { time: '09:30', locationId: 'loc_denton', activity: 'Delivers numbers Denton attempts to negotiate with', days: ['monday', 'thursday'] },
                    { time: '12:00', locationId: 'loc_break', activity: 'Takes exactly twenty-two minutes for lunch', days: ['weekday'] },
                    { time: '14:30', locationId: 'loc_claims', activity: 'Reconciles reserves with Mara', days: ['tuesday', 'friday'] },
                    { time: '17:30', locationId: 'loc_prudence_home', activity: 'Bakes, reconciles household receipts or practices secret karaoke', days: ['weekday'] },
                    { time: '20:00', locationId: 'loc_bar', activity: 'Sings one devastating song under a false name', days: ['thursday'] }
                ),
                relations: relations(['npc_mara', 'trusted investigative counterpart', 64], ['npc_denton', 'professional collision with buried affection', -6], ['npc_connor', 'believes his expenses are a confession', -50]),
                visuals: { portraitAssetId: ids.prudence, portraitPosition: 'center', dialogueColor: '#8D6CAB' }
            },
            {
                id: 'npc_wade', name: 'Wade Greeley', type: 'npc', isMajor: true, startLocation: 'loc_supply', homeLocation: 'loc_wade_home', factionId: 'fac_facilities',
                description: 'Fifty-seven, lanky and weathered, in a navy work shirt and cap with a grey mustache, mop handle and a ring of keys that sounds like distant sleigh bells.',
                persona: 'A laconic maintenance philosopher who fixes objects by listening to them and people by pretending not to. Wade knows every pipe, hiding place, affair and structural lie in the building. He gives advice through stories about appliances. Nobody knows which stories are autobiographical.',
                goal: 'Keep the failing basement boiler alive until he can prove the landlord, not the branch, owes replacement.', goalAutonomy: 'medium', goalDifficulty: 52, goalDeadlineTurns: 28,
                goalSteps: ['Document pressure failures', 'Stop Denton authorizing a cosmetic repair', 'Find the original lease', 'Keep the records dry during the next storm'],
                secrets: [{ label: 'Old Lease', hint: 'Wade asks oddly precise questions about the landlord.', truth: 'He found a 1989 lease amendment making the landlord responsible for environmental remediation and major mechanical systems.' }],
                schedule: schedule(
                    { time: '06:45', locationId: 'loc_records', activity: 'Checks boiler, pipes and water intrusion', days: ['weekday'] },
                    { time: '08:30', locationId: 'loc_supply', activity: 'Sorts repairs by danger rather than management volume', days: ['weekday'] },
                    { time: '11:00', locationId: 'loc_bullpen', activity: 'Fixes whatever the office has misunderstood today', days: ['weekday'] },
                    { time: '13:15', locationId: 'loc_break', activity: 'Drinks coffee and offers one appliance parable', days: ['weekday'] },
                    { time: '17:00', locationId: 'loc_wade_home', activity: 'Repairs old machines for neighbors', days: ['weekday'] }
                ),
                relations: relations(['npc_eli', 'patient practical mentorship', 46], ['npc_mara', 'respects her questions', 34], ['npc_nisha', 'shares documentation she can weaponize', 39]),
                visuals: { portraitAssetId: ids.wade, portraitPosition: 'center', dialogueColor: '#B46A3C' }
            },
            {
                id: 'npc_connor', name: 'Connor Vale', type: 'npc', isMajor: true, startLocation: 'loc_bullpen', homeLocation: 'loc_connor_home', factionId: 'fac_sales',
                description: 'Thirty-five, handsome and polished, with a perfect blond side-part, rolled sleeves, burgundy suspenders and the bright smile of a man who has never encountered an objection he did not rename.',
                persona: 'A spectacular salesman who makes people feel chosen. Connor is generous, vain, competitive and addicted to winning. He remembers children’s names, birthdays and vulnerabilities with equal precision. Beneath the charm is panic that without performance there may be nothing to love.',
                goal: 'Win the county benefits account and secure the vacant assistant regional manager title.', goalAutonomy: 'high', goalDifficulty: 62, goalDeadlineTurns: 40,
                goalSteps: ['Charm the mayor’s procurement aide', 'Neutralize a rival bid', 'Keep his expense irregularities away from Prudence', 'Make Denton publicly promise the promotion'],
                secrets: [{ label: 'Lark Account', hint: 'Connor becomes unusually casual when Lark & Sons Roofing is mentioned.', truth: 'Connor wrote policies for the contractor implicated in staged claims and accepted lavish client entertainment, but he does not yet know the full fraud.' }],
                schedule: schedule(
                    { time: '08:30', locationId: 'loc_bullpen', activity: 'Makes follow-up calls and performs visible momentum', days: ['weekday'] },
                    { time: '10:30', locationId: 'loc_maplebridge', activity: 'Visits clients and prospects', days: ['weekday'] },
                    { time: '12:15', locationId: 'loc_diner', activity: 'Turns lunch into a soft close', days: ['weekday'] },
                    { time: '15:30', locationId: 'loc_bullpen', activity: 'Closes deals loudly enough for Denton to hear', days: ['weekday'] },
                    { time: '19:00', locationId: 'loc_bar', activity: 'Networks, flirts or buys a strategic round', days: ['wednesday', 'friday'] },
                    { time: '10:00', locationId: 'loc_connor_home', activity: 'Curates an effortless weekend', days: ['weekend'] }
                ),
                relations: relations(['npc_denton', 'patron, judge and future obstacle', 50], ['npc_gloria', 'competitive old chemistry', 20], ['npc_prudence', 'mutual suspicion', -48], ['npc_mara', 'fears her attention', -30]),
                visuals: { portraitAssetId: ids.connor, portraitPosition: 'center', dialogueColor: '#D8B23E' }
            },
            {
                id: 'npc_nisha', name: 'Nisha Patel', type: 'npc', isMajor: true, startLocation: 'loc_hr', homeLocation: 'loc_nisha_home', factionId: 'fac_management',
                description: 'Thirty-three, composed and stylish, with a sleek ponytail, teal blazer, gold studs, tablet and a color-coded binder for every category of avoidable disaster.',
                persona: 'Hyper-competent HR and operations chief. Nisha believes processes are promises made visible. She is brisk, observant and funny only when she decides the room has earned it. She protects employees from management and management from employees, resents being treated as the office mother and keeps a stress ball specifically for Denton.',
                goal: 'Get the branch through the state audit without allowing Denton, Connor or the truth to create a preventable employment crisis.', goalAutonomy: 'high', goalDifficulty: 70, goalDeadlineTurns: 32,
                goalSteps: ['Audit personnel and licensing files', 'Separate claim fraud from employment exposure', 'Document Denton’s directives', 'Choose whether loyalty to the branch outweighs duty to report'],
                secrets: [{ label: 'Corporate Offer', hint: 'Her resignation letter template is already formatted.', truth: 'Corporate offered Nisha a compliance role if she produces a candid operational report on Maplebridge. She has not answered.' }],
                schedule: schedule(
                    { time: '07:50', locationId: 'loc_hr', activity: 'Reviews incidents before anyone can rename them', days: ['weekday'] },
                    { time: '09:30', locationId: 'loc_bullpen', activity: 'Checks operations and interrupts unsafe improvisation', days: ['weekday'] },
                    { time: '11:30', locationId: 'loc_denton', activity: 'Attempts to convert Denton’s ideas into lawful plans', days: ['tuesday', 'thursday'] },
                    { time: '13:00', locationId: 'loc_break', activity: 'Takes lunch with Gloria or alone by deliberate choice', days: ['weekday'] },
                    { time: '15:00', locationId: 'loc_hr', activity: 'Interviews, documents and solves', days: ['weekday'] },
                    { time: '18:00', locationId: 'loc_nisha_home', activity: 'Walks her greyhound and enforces the no-work rule', days: ['weekday'] }
                ),
                relations: relations(['npc_gloria', 'trusted intelligence-sharing friendship', 60], ['npc_denton', 'professional duty mixed with chronic exasperation', 5], ['npc_wade', 'values his evidence and discretion', 41]),
                visuals: { portraitAssetId: ids.nisha, portraitPosition: 'center', dialogueColor: '#4F6FBF' }
            }
        ],
        factions: [
            { id: 'fac_management', name: 'Branch Management', status: 'active', description: 'Denton and Nisha’s uneasy coalition: spectacle and procedure sharing one steering wheel.', influence: 76, reputation: 5, resources: 65, goal: 'Keep Maplebridge independent through the audit and performance watch.', goalPool: ['Secure the county benefits account', 'Negotiate leverage with corporate'], territory: ['loc_denton', 'loc_hr', 'loc_reception'], relations: [{ factionId: 'fac_sales', score: 35 }, { factionId: 'fac_claims', score: -5 }, { factionId: 'fac_town', score: 20 }] },
            { id: 'fac_sales', name: 'The Rainmakers', status: 'active', description: 'Connor’s informal sales court: charm, commissions, gifts and aggressive optimism.', influence: 64, reputation: 18, resources: 72, goal: 'Dominate new business and control the next promotion.', goalPool: ['Turn Founders Day into a prospecting machine', 'Undermine outside competitors'], territory: ['loc_bullpen', 'loc_diner', 'loc_bar'], relations: [{ factionId: 'fac_management', score: 35 }, { factionId: 'fac_claims', score: -44 }, { factionId: 'fac_town', score: 42 }] },
            { id: 'fac_claims', name: 'The Evidence Department', status: 'active', description: 'Mara and Prudence’s alliance of facts, reserves and exhausted moral seriousness.', influence: 55, reputation: 30, resources: 46, goal: 'Expose the Rainmaker fraud without punishing innocent policyholders.', goalPool: ['Repair reserve controls', 'Force ethical underwriting reforms'], territory: ['loc_claims', 'loc_records'], relations: [{ factionId: 'fac_management', score: -5 }, { factionId: 'fac_sales', score: -44 }, { factionId: 'fac_town', score: 10 }] },
            { id: 'fac_frontdesk', name: 'The Switchboard', status: 'active', description: 'Gloria and Eli’s accidental information network connecting clients, staff and town rumor.', influence: 48, reputation: 44, resources: 28, goal: 'Convert information and goodwill into real opportunity.', goalPool: ['Launch Bell & Bow openly', 'Protect Eli from becoming office collateral'], territory: ['loc_reception', 'loc_break'], relations: [{ factionId: 'fac_management', score: 14 }, { factionId: 'fac_sales', score: 5 }, { factionId: 'fac_town', score: 58 }] },
            { id: 'fac_facilities', name: 'Facilities, Singular', status: 'active', description: 'Wade, his keys and the physical truth of the building.', influence: 34, reputation: 52, resources: 20, goal: 'Make the landlord replace the boiler and honor the old lease.', goalPool: ['Keep the basement dry', 'Preserve anything the office will later pretend it never had'], territory: ['loc_supply', 'loc_records', 'loc_parking'], relations: [{ factionId: 'fac_management', score: -2 }, { factionId: 'fac_claims', score: 32 }] },
            { id: 'fac_town', name: 'Maplebridge Civic Web', status: 'active', description: 'Town hall, local businesses, clients, contractors and everyone who recognizes the Bramble & Pike staff at dinner.', influence: 70, reputation: 15, resources: 80, goal: 'Keep local money and decisions inside Maplebridge.', goalPool: ['Deliver a memorable Founders Day', 'Force corporate employers to answer locally'], territory: ['loc_main_street', 'loc_diner', 'loc_townhall', 'loc_bar'], relations: [{ factionId: 'fac_management', score: 20 }, { factionId: 'fac_sales', score: 42 }, { factionId: 'fac_frontdesk', score: 58 }] }
        ],
        startingLives: [
            { id: 'origin_new_hire', icon: '📎', name: 'The New Hire', role: 'claims service representative', socialRank: 'entry level', title: '', legalStatus: 'employee on probation', description: 'Start on your first morning with a desk, a training binder and no idea which warnings are jokes.', startLocationId: 'loc_reception', factionId: 'fac_frontdesk', factionReputation: 5, inventory: ['employee badge', 'training binder', 'cheap umbrella', 'lunch bag'], obligations: ['Complete onboarding', 'Protect client information', 'Survive ninety days of probation'], privileges: ['Access to ordinary office areas', 'May handle supervised client intake'], holdings: [], outfit: 'new office clothes, slightly too formal for the branch', statOverrides: { performance: 40, reputation: 0, stress: 20, cash: 160, nerve: 4, insight: 5, charm: 5 }, intro: '' },
            { id: 'origin_temp_reception', icon: '📞', name: 'Gloria’s Temporary Cover', role: 'temporary receptionist', socialRank: 'contract worker', title: '', legalStatus: 'agency temp', description: 'Gloria is away for one morning. You inherit the switchboard, the lobby and everyone’s assumption that the desk is easy.', startLocationId: 'loc_reception', factionId: 'fac_frontdesk', factionReputation: 10, inventory: ['temporary badge', 'switchboard cheat sheet', 'three message pads'], obligations: ['Keep calls moving', 'Do not disclose client information'], privileges: ['Hear nearly every incoming problem first'], holdings: [], outfit: 'business-casual clothes selected to look reliably invisible', statOverrides: { performance: 45, reputation: 0, stress: 25, cash: 90, nerve: 4, insight: 6, charm: 6 }, intro: '' },
            { id: 'origin_adjuster', icon: '🔎', name: 'Field Claims Adjuster', role: 'insurance claims adjuster', socialRank: 'experienced staff', title: 'Senior Adjuster', legalStatus: 'licensed employee', description: 'You know damaged homes, frightened clients and the difference between fraud and desperation. Mara wants your eyes on three roof claims.', startLocationId: 'loc_claims', factionId: 'fac_claims', factionReputation: 28, inventory: ['adjuster badge', 'camera', 'measuring tape', 'claim notebook', 'company car keys'], obligations: ['Investigate fairly', 'Document evidence', 'Meet reserve deadlines'], privileges: ['Inspect insured property', 'Access claim and evidence files'], holdings: ['company car'], outfit: 'weatherproof coat over practical office clothes', statOverrides: { performance: 62, reputation: 12, stress: 22, cash: 420, nerve: 6, insight: 8, charm: 4 }, intro: '' },
            { id: 'origin_sales', icon: '🤝', name: 'Hungry Sales Agent', role: 'insurance producer', socialRank: 'commissioned professional', title: 'Associate Producer', legalStatus: 'licensed employee', description: 'Connor’s numbers dominate the board and Denton just announced one promotion. You have a phone, a book of leads and reasons to need the money.', startLocationId: 'loc_bullpen', factionId: 'fac_sales', factionReputation: 18, inventory: ['producer license', 'prospect list', 'client gift basket', 'car keys'], obligations: ['Meet sales targets', 'Maintain licensing', 'Disclose policy terms honestly'], privileges: ['Earn commission', 'Represent the branch at civic events'], holdings: ['used sedan'], outfit: 'polished office clothes designed to look more successful than your bank account', statOverrides: { performance: 55, reputation: 5, stress: 20, cash: 280, nerve: 6, insight: 4, charm: 8 }, intro: '' },
            { id: 'origin_regulator', icon: '⚖️', name: 'State Examiner', role: 'insurance compliance examiner', socialRank: 'external authority', title: 'Market Conduct Examiner', legalStatus: 'state official', description: 'Arrive unannounced with authority to inspect the branch, interview staff and turn comedy into sworn testimony.', startLocationId: 'loc_reception', factionId: 'fac_town', factionReputation: -5, inventory: ['state credentials', 'sealed audit scope', 'laptop', 'evidence bags'], obligations: ['Remain impartial', 'Protect confidential examination material', 'Report material violations'], privileges: ['Request branch records', 'Interview licensed staff', 'Escalate obstruction'], holdings: ['state fleet sedan'], outfit: 'rain-darkened professional coat and practical shoes', statOverrides: { performance: 70, reputation: -10, stress: 10, cash: 500, nerve: 8, insight: 8, charm: 4 }, intro: '' },
            { id: 'origin_cleaner', icon: '🧹', name: 'After-Hours Cleaner', role: 'contract cleaner', socialRank: 'contract worker', title: '', legalStatus: 'night contractor', description: 'You work when the masks come off, know what people throw away and possess keys nobody remembers issuing.', startLocationId: 'loc_supply', factionId: 'fac_facilities', factionReputation: 25, inventory: ['master ring of cleaning keys', 'supply cart', 'work gloves', 'old radio'], obligations: ['Secure the building', 'Protect client papers encountered during work'], privileges: ['After-hours access to most rooms', 'Nobody notices you until they need something'], holdings: [], outfit: 'navy work clothes and comfortable shoes', statOverrides: { performance: 58, reputation: 2, stress: 12, cash: 110, nerve: 7, insight: 7, charm: 3 }, intro: '' },
            { id: 'origin_pike_heir', icon: '🏷️', name: 'The Owner’s Adult Child', role: 'special projects associate', socialRank: 'corporate family', title: 'Special Projects Associate', legalStatus: 'employee by executive appointment', description: 'Your surname opens doors and closes conversations. Corporate sent you to Maplebridge to “learn the business,” and nobody agrees what that means.', startLocationId: 'loc_denton', factionId: 'fac_management', factionReputation: 20, inventory: ['executive badge', 'corporate expense card', 'new laptop', 'family signet cufflinks'], obligations: ['Produce a branch assessment', 'Avoid embarrassing corporate', 'Decide whether loyalty is inherited'], privileges: ['Access to management meetings', 'Direct corporate phone numbers', 'Expense authority'], holdings: ['leased executive car'], outfit: 'expensive business clothes trying not to announce their price', statOverrides: { performance: 35, reputation: -5, stress: 18, cash: 1200, nerve: 6, insight: 5, charm: 7 }, intro: '' }
        ],
        lorebook: [
            { id: 'lore_company', keyword: 'Bramble & Pike,company,branch,corporate', text: 'Bramble & Pike Mutual is a century-old regional insurer headquartered in the state capital. Maplebridge is one of twelve branches and the only one still occupying a converted storefront.' },
            { id: 'lore_town', keyword: 'Maplebridge,town,small town', text: 'Maplebridge has nineteen thousand residents, a paper mill, county offices, a wet climate and a dense civic memory. People routinely know each other through school, church, sport, business and claims.' },
            { id: 'lore_audit', keyword: 'audit,examiner,state commission,market conduct', text: 'A state market-conduct examination can inspect sales practices, claims handling, licensing, complaint files and unfair treatment. Obstruction is worse than an ordinary mistake.' },
            { id: 'lore_watch', keyword: 'performance watch,closure,corporate review', text: 'Corporate has secretly placed the Maplebridge branch on a ninety-day performance watch. Only Denton and perhaps Nisha have enough evidence to infer the full threat.' },
            { id: 'lore_rainmaker', keyword: 'Rainmaker,Lark and Sons,roof claims,storm fraud', text: 'Three roof claims share Lark & Sons Roofing, the same notary and weather timestamps that do not match local records. The pattern suggests staged damage and an internal approval channel.' },
            { id: 'lore_spill', keyword: 'spill,groundwater,Pike Chemical,1998', text: 'A 1998 Pike Chemical spill was quietly settled. Old files suggest groundwater consequences continued after corporate declared the matter closed.' },
            { id: 'lore_founders', keyword: 'Founders Day,gala,parade', text: 'Maplebridge Founders Day is six weeks away: parade, charity gala, vendor fair and a civic obsession. It is Gloria’s biggest event opportunity and Connor’s largest pool of prospects.' },
            { id: 'lore_county', keyword: 'county account,benefits contract,procurement', text: 'The county employee benefits account would stabilize branch revenue. Procurement is formally competitive and informally shaped by years of town relationships.' },
            { id: 'lore_policy', keyword: 'policy,coverage,deductible,exclusion,claim', text: 'Insurance is a contract, not a magic promise. Coverage depends on cause of loss, policy period, limits, deductibles and exclusions. Honest uncertainty should be investigated rather than invented away.' },
            { id: 'lore_gloria', keyword: 'Bell and Bow,event planning,second book', text: 'Bell & Bow is Gloria’s unregistered event-planning business. She has talent, vendors and demand, but not yet formal capital, insurance or Denton’s knowledge.' },
            { id: 'lore_boiler', keyword: 'boiler,lease,landlord,basement pipes', text: 'The basement boiler is failing. An old lease amendment may make the landlord responsible for replacement and environmental remediation.' },
            { id: 'lore_bar', keyword: 'Bent Stapler,karaoke,poker', text: 'The Bent Stapler hosts Thursday karaoke and a private monthly poker game. The game links local officials, contractors and at least one branch employee.' },
            { id: 'lore_gossip', keyword: 'gossip,rumor,switchboard', text: 'Gossip is information with uncertain provenance. Track who heard what, from whom and whether it is true. Gloria is good at distinguishing rumor from a test balloon.' },
            { id: 'lore_romance', keyword: 'date,romance,flirt,relationship', text: 'All romance in this world concerns consenting adults. Workplace attraction is shaped by policy, power, reputation and personal boundaries; nobody owes affection because the player is charming.' },
            { id: 'lore_comedy', keyword: 'comedy,sitcom,funny', text: 'The comedy is grounded in specific motives, office systems and escalating misunderstandings. The world never announces a joke or forces a return to normal.' }
        ]
    };

    // The editor and simulation kernel seed NPC standing from one canonical
    // world-level graph. Authoring the convenient per-NPC lists above keeps
    // the cast readable; collapse them here into undirected, deduplicated
    // relationships for the actual portable format.
    const relationships = new Map();
    for (const entity of world.entities) {
        for (const relation of Array.isArray(entity.relations) ? entity.relations : []) {
            if (!relation.entityId || relation.entityId === entity.id) continue;
            const pair = [entity.id, relation.entityId].sort();
            const key = pair.join('|');
            if (!relationships.has(key)) {
                relationships.set(key, {
                    a: pair[0],
                    b: pair[1],
                    label: relation.label || '',
                    score: relation.score || 0,
                    reason: relation.label || ''
                });
            }
        }
        delete entity.relations;
    }
    world.relationships = [...relationships.values()];

    require('../assets/worlds/bundled-content').update(world);
    fs.writeFileSync(outputFile, JSON.stringify(world, null, 2));
    fs.writeFileSync(
        bundledFile,
        `// Generated by scratch/build_policy_panic_world.js. Keep this file before app.js.\n` +
        `globalThis.HORDE_INCLUDED_WORLDS = [...(globalThis.HORDE_INCLUDED_WORLDS || []), ${JSON.stringify(world)}];\n`
    );
    const bytes = fs.statSync(outputFile).size;
    console.log(`Created ${outputFile}`);
    console.log(`Created ${bundledFile}`);
    console.log(`${world.locations.length} locations, ${world.entities.length} NPCs, ${world.startingLives.length} starting lives, ${world.lorebook.length} lore entries, ${world.mediaAssets.length} embedded assets`);
    console.log(`${(bytes / 1024 / 1024).toFixed(1)} MB`);
}

build().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
