# Worlds: critical scene/state audit and simplification proposal

Date: 2026-10-10. Scope: current local v18.3.6 source. Read-only runtime audit; no product behavior changed. No user library or paid provider requests used.

## Assessment

The user's report is plausible and matches a reproducible contract gap. The current system validates supplied operations, but cannot prove that all physical claims in unrestricted narration have matching operations. More mandatory fields or regex repairs cannot close this gap universally.

The existing machinery already has candidate transactions, structured scene drafts, action resolution, state receipts, reroll snapshots, version guards and validation. A proposed engine/narrator separation is a refinement, not an invention missing from Worlds. Do not start with a wholesale replacement.

For the user's open-ended roleplay use case, recommend prototyping a forgiving **scene record plus append-only turn ledger**, retaining deterministic checks for mechanical modes. A prose-only ledger is insufficient; an LLM extract-after-narration ledger retains inference errors and an extra round trip.

## Findings and evidence

1. **Structured validity does not establish scene agreement.** `worlds/scene-draft.js` compile returns narrative and a receipt using context location/presence. Movement events then establish the actual ending frame in `app.js:11553`. A missing event can leave prose and state inconsistent. Reproduction: a valid look-style draft with pool narration, no events, empty effects and context location room is accepted by the compiler with location room and empty cast. This is a component finding, not proof that the full live pipeline accepts every version of this example.
2. **Narrative validation is necessarily partial.** `app.js:12440` scans an opening span of 700 characters for selected player movement verbs, then resolves a registered location. `app.js:31844` is another opening scanner; its callers have command/travel exclusions. Implicit settings, late transitions, anonymous participants and unusual wording are not comprehensively covered by these checks. Regex is useful diagnostic evidence, not a complete semantic contract.
3. **Presence equates to exact occupancy.** `app.js:9944` constructs the frame from active NPCs whose location equals playerLocation. This cannot express pool-water/pool-deck visibility, someone visible through a doorway, or scene-local anonymous people without additional modeling. This is a representation limitation; no particular user's world geometry was inspected.
4. **Default protocol asks for too much on ordinary turns.** `app.js:24071` defaults resolveFirst and sceneDrafts on. `worlds/scene-draft.js:118` requires narrative passages, actions, events, effects, speech and commitments, with passage references and additional semantic checks. Useful mechanics obligations are coupled to normal conversation. A harmless omission can prevent a readable turn from becoming accepted canon.
5. **Failure behavior deliberately stops false fiction but damages flow.** `app.js:30760` freezes unverified state and `app.js:31178` replaces unverified prose with an app notice. This is safer than quietly keeping contradictory prose; loosening validation without replacing the contract would undo that protection. The default scene-draft repair path makes one repair attempt; legacy paths retain more fallback/repair behavior.
6. **Different protocols have different recovery rules.** `app.js:11496` legacy presence recovery needs narrative plus asserted cast and is disabled for engineScene. Default scene drafts derive their ending cast instead. A fix or fixture for one transport does not prove the other behaves identically. Two fields emitted by one model are agreement, not independent evidence.
7. **NPC background activity and scenes use different time horizons.** Following actors and recent placements block schedules, but pins expire by turn count (`app.js:34043`), while schedules operate on world time (`app.js:37042`). This creates a possible source of surprising scene changes after enough conversational turns. It is a design risk, not a reproduced schedule bug. Density population already avoids relocating placed actors; do not blame random teleportation without evidence.
8. **A ledger already exists.** Kernel memory defaults to ledger. `worlds/turn-context.js:49` adds extractive scene memory; history retains selected narrative and marks other-location messages as distant. Adding another summary would not change who owns current location and cast. Current-scene facts must be injected independently of historical retrieval.

## Proposed small record

A scene should store a scene ID/revision, current place (registered ID when available, stable session-local ID otherwise), participants, visible groups, pending departures/arrivals, and provenance. A scene record is a view of canonical actor/scene state, not a second disconnected NPC database.

Example:

```json
{
  "scene_id": "scene_12",
  "revision": 42,
  "place": {"id": "pool", "label": "Pool"},
  "participants": ["player", "maya"],
  "groups": [{"id": "pool_guests_1", "label": "three other guests", "count": 3}],
  "confidence": "established",
  "source_turn": "turn_42"
}
```

Groups represent background crowds. Individually addressed people get lightweight stable scene-local identities; promotion to a persistent NPC is optional. Do not claim groups have the full memories/relationships of authored NPCs.

Each accepted turn appends an immutable ledger entry: turn ID, scene before/after, concise factual changes, narrative, provenance and applicable mechanical results. The current record is derived from accepted entries/checkpoints. Rerolls/deletion branch the ledger; do not rewrite other takes. State and narrative publish atomically, retaining current version guards and storage protections.

The model should provide a compact ending scene with its narrative: place and foreground cast, rather than having to reconstruct those facts through a full itinerary of micro-events. Existing identities are reused; mere mentions, future plans, dialogue reports and flashbacks do not change current scene.

## Forgiving behavior with explicit boundaries

- Roleplay movement between ordinary places need not fail because every intermediate exit was omitted. Use an accepted transition to advance place/time. New session-local places are allowed, but do not invent verified map edges from a label alone.
- Do not automatically carry every present NPC along. Following relationships or explicit accepted participation determine companions.
- Lock the foreground cast during a continuous scene. A departure must be observed/recorded or the scene explicitly ends; schedule desires queue instead of silently overriding visible people. Time skips resolve departures and arrivals as one scene transition.
- Omitted optional mechanics/details retain old values. Ordinary dialogue need not declare a durable speech event unless it changes knowledge or a supported mechanic.
- Hard validation remains for structural integrity, IDs/revisions, persistence, mechanical outcomes, locked destinations and enabled world rules. Story tone, descriptive wording and minor non-mechanical detail should not require whole-turn repair.
- A well-formed ending record does not prove its prose matches. Keep narrow, targeted contradiction checks and measure residual error. A separate final writer can be tested as an alternative, not assumed necessary for every turn.
- If a material scene conflict remains after at most one targeted repair, hold the turn as provisional and expose a simple scene correction/acceptance. Do not simultaneously display a definite stale room/alone status. No provisional prose enters accepted history or embeddings. Clearly distinguish unknown from known empty cast: “companions not recorded” is not “alone.”
- Explicit user correction of current place/cast should append a correction entry and update every view together. Corrections do not silently award inventory, undo combat or erase prior events.

## Alternatives

1. Prose ledger only: simplest interface, approximate map and presence; unsuitable if exact synchronization is promised.
2. Compact ending scene + ledger: recommended prototype for open-ended roleplay. Fewer mandatory operations, still susceptible to model omission; correction/uncertainty is a necessary fallback.
3. Resolve actions then separate narrator: stronger mechanical boundary, more latency/cost, still susceptible to invented prose. Appropriate candidate for tactical/rules-focused worlds. Retain existing kernel transaction infrastructure.

Do not select merely by architectural appeal. Keep mechanics-heavy worlds on their existing behavior during the prototype; an explicit mode must not change old saves unexpectedly.

## Evaluation and implementation order

1. Collect failing exports/traces with secrets removed. Record input, pre/post scene, model draft, accepted/rejected events, repair result, schedule changes and displayed cast. Distinguish model omissions from rejected routes, ambiguous geometry, stale context and schedule overrides.
2. Add the small scene-view/projection and audit provenance behind an opt-in prototype. Initially reuse current state store and snapshots; avoid another persistence subsystem.
3. Compare compact-ending-scene and current scene drafts on the same fixtures/provider/model settings, plus a resolve-then-narrate subset. Record calls, token cost, p50/p95 latency, blocked turns, manual corrections and contradictory displayed scenes.
4. Exercise 100-turn conversation/movement runs: pool with four people; unnamed-to-named participant; companion group travel; pool/deck visibility; someone leaves; room mentioned in dialogue; negated travel; flashback; new place; locked route; schedules during long conversation/time skip; reload; failed storage; reroll/delete; multiplayer host authority and stale responses.
5. Hard gates: map/header/prompt/save share one revision and scene; no failed transaction partly persists; no stale reply overwrites state; replay/reload/branching reproduce accepted scene; mechanical checks remain correct. Report narrative contradiction frequency separately; mocked JSON tests cannot establish live narrative reliability.
6. Only retire legacy recovery paths once measured behavior and existing migration/mechanics checks justify it. Keep a rollback path.

## Research context

Generative Agents uses structured environmental locations and engine movement: https://arxiv.org/html/2304.03442v2#S5
Orchestrated Reality advocates canonical validated state but co-generates prose/deltas and reports preliminary observations rather than a completed controlled player study: https://arxiv.org/html/2606.16014v1
NCP-Bench documents long-horizon narrative contradictions; adversarial inputs and model auditing limit generalization to ordinary Horde play: https://arxiv.org/html/2608.08160v1
These sources support explicit state ownership. They do not establish that a ledger alone, additional agents, or two model calls universally solves narrative/state agreement.
