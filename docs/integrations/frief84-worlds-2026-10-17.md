# Worlds integration — October 17, 2026

Adapted selected work from Frief84/hordestudio at `ed89df8de8ba74ae6b6a5ea7e92c8cc77cad6f0e` (36 commits after upstream v18.3.6). Original upstream contribution author: Frief84. This is a local source integration, not a published release.

## Included

- Place structure, knowledge/access rules, place guide and author/debug UI.
- Floor-plan editing, room geometry, connection waypoints and shared-door lock controls.
- Bounded recent conversation plus source-linked older recall, provider diagnostics and structured-output fallback support.
- Working-state/effect registry and transactional linked execution, with persistence before publishing the candidate.
- Region/location background music controls and local asset endpoints.
- Runtime bridge routes, cache refreshes, portable-verifier coverage, guide/Pip documentation and selected regression suites.

Kokoro-specific frontend, backend and adapter changes were excluded; they require a separate dependency/platform evaluation. Personal played-save recovery data, marketing screenshots and the fork's bundled music file were not imported.

## Default and compatibility

Structured events (existing), using the V2 response contract, remains the default. Linked actions (preview) is an explicit choice at World Studio → AI → World Kernel → Scene tracking. The experimental Scene record + ledger option remains separate and retains provisional-story recovery, its 10-second repair bound and manual scene correction.

Existing worlds are not silently switched to linked V3. Legacy containment-only travel stays available in the existing mode where there is no authored connection in either direction. An authored door or one-way link is not bypassed. Linked preview requires explicit mapped routes. NPC access restrictions remain enforced; a compact declared arrival can explicitly explore an adjacent unknown place rather than being denied solely for never having visited it.

## Corrections to the reviewed fork

1. **Player intent:** voluntary linked player movement is checked against the actual submitted request/clause and authorized route. Observation/speech/question/wait actions cannot carry player movement; labelling a look request as travel does not bypass the production guard. This is a read-only authorization use of the existing intent parser, never the old state-mutating movement precommit.
2. **Spatial transfers:** source and destination must have known matching physical locations. A remote loose item or absent NPC's inventory cannot be transferred to the player.
3. **Travel clock:** the engine derives the mapped edge duration. Explicit journey time satisfies the same duration instead of adding it twice; a separate wait remains additional. The linked turn's generic clock step is credited once when explicit elapsed time was applied.
4. **Local integration:** preserve scene-record state, per-take metadata, provisional conversation labels, diagnostics and initial foreground holds. The newer bounded context selector now retains provisional conversation with its label while excluding it from verified older recall.
5. **Deployment:** all new runtime scripts are explicitly served by the Python bridge. The optional voice UI is not called when its implementation is excluded.

## Validation

Passed targeted checks for linked contracts/execution/hardening/generalization, effect proxies, working-state rollback, source-linked recall, scene drafts, ledger adapter, player intent/escort routes, map geometry and 2,000-room normalization.

Passed browser checks for:

- Reproduced remote pickup and unrequested movement, including a forged travel classification: rejected without canonical changes.
- A 60-minute route with omitted or explicit elapsed time: exactly 60 minutes in both cases.
- Full take-key/unlock/enter chain, companion movement, durable partial failure, pending check continuation and reload.
- Existing structured scenes, remembered speech, deadlines, bounded correction and persistence.
- Scene-record 100-turn fixture, omissions, groups, explicit departure, correction, rerolls and saving mode choices.
- Provisional timeout recovery, conversational continuation, knowledge/inventory isolation and reload.
- Local JSON-schema transport, new World Lore UI and pending/error controls.
- BGM upload/picker/fallback, deletion, preview/stop, persistence and direct/linked travel.
- Atomic persistence while a model turn remains pending.

Also passed: 50 bridge unit tests; real HTTP delivery of ten new supporting modules; 74 calibration checks; 27 engine regressions; 12 integrity checks; five portable-staging checks; guide/Pip retrieval checks; JavaScript/Python syntax and whitespace verification.

The historical `world_latency_browser_audit.js` was not an acceptance result for this integration: it assumes V3 is the default and its response fixtures predate linked action IDs. Its attempted run was stopped. The current linked turn, chain, local-schema, model-client, context and safety suites cover the integration paths above. The pure latency/context fixture audit passes; no live speedup is claimed.

All browser model responses were scripted and storage was isolated. No paid inference or user save library was used. Live Aion/model adherence, long-play narrative quality, multiplayer soak, actual TTS, and a fresh published portable ZIP remain outside this validation. BGM source paths referencing local uploaded files still need those files on the destination installation; this integration does not embed them in exported worlds.

## Using the result

Restart Horde Studio so its Python bridge loads the new route table, then refresh the browser. Existing worlds and timelines remain available. To try the new executor, explicitly select Linked actions (preview) and save the world. Keep Structured events selected to retain the existing contract. No commit, push or release was performed.
