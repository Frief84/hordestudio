# Frief84 Horde Studio fork review — October 17, 2026

## Scope and verdict

Reviewed `Frief84/hordestudio` main at `ed89df8de8ba74ae6b6a5ea7e92c8cc77cad6f0e`, compared with upstream v18.3.6 (`d957222adcd44d663447c8f75a1abad5ed91e5ac`). GitHub reports 36 commits ahead, no commits behind this baseline, all 36 attributed to Frief84. This is a comparison with the published baseline, not an assertion that the fork includes this workspace's later uncommitted experimental fixes.

There is substantial useful engineering here. The linked V3 transaction boundary is a meaningful improvement to saving and execution ordering, and the map/lore/diagnostic changes are valuable. I would not merge the whole branch unchanged: three state/agency defects reproduced through the actual browser turn pipeline, and prose-only models can still block play.

No upstream or fork code was changed. Source and test material were copied into a disposable temporary review directory. All model responses in this review were scripted, and external browser requests were blocked. No provider credits or personal save data were used.

## Reproduced findings

### P1 — A look request can authorize unrequested voluntary travel

The linked executor accepts `actor_move` inside an action whose `request` is exactly `I look around.` and whose `kind` is `observation`. The production `canMove` callback verifies the edge and access but does not verify that voluntary player movement was requested. The linked branch does not run the legacy player-action authorization path before publishing the candidate.

Browser reproduction: player starts in Foyer; mocked draft answers `I look around.` with `You walk to the vault.`, links an observation action to `actor_move(player,vault)`. Result: accepted in one call, persisted turn source `inline_receipt`, player now in Vault, no validation rejection. This is not an invented forced movement event or a player travel request.

Relevant code: `worlds/linked-world-actions.js:97–128`, `app.js:32691–32723`, `app.js:32752–32831` at the reviewed SHA. Preserve an independent boundary on the scope of player-authorized actions; edge validity alone cannot establish intent.

### P1 — Item transfers do not enforce physical reach/co-location

`item_transfer` checks source ownership/location and quantity conservation but never checks that the recipient can reach the source, or that participating actors are co-located. Unlike movement and object transitions, it has no production spatial authorization callback.

Browser reproduction: player in Foyer; a registered Bronze key is canonically placed in Vault; submitted action `I pick up the bronze key.`; draft transfers from `vault` to `player`. Result: accepted in one call, inventory becomes `["Bronze key"]`, player stays in Foyer, no rejection. A separate direct-reducer probe also transfers a Gold coin from an absent NPC's inventory to the player.

Relevant code: `worlds/linked-world-actions.js:178–245`. Validate the source and destination against the participant locations and allowed interaction range in the current working state before writing either inventory. Item conservation does not establish physical access.

### P2 — Native movement does not enforce authored travel duration

`actor_move` changes actor locations and entry/exit metadata without applying or requiring the authored edge duration. The linked commit increments the generic turn counter; it does not derive the missing edge time.

Browser reproduction: Foyer → Vault edge has `travelTime:60`, ordinary turn step is five minutes. Submitted action requests travel; model supplies the corresponding move without `time_advance`. Result: accepted in one call, player arrives in Vault, only five minutes elapse. The engine should derive or validate route time instead of relying on the model to include the second operation. Otherwise schedules, urgent events and companion travel can drift again.

Relevant code: `worlds/linked-world-actions.js:97–135`; generic linked commit at `app.js:32790–32795`.

### Playability limitation — Prose-only responses still stop the turn

A mocked model returning readable room description on both the primary call and correction makes no progress. After two calls, the pipeline reports `Linked World turn was not committed: invalid_receipt_envelope`; the input remains pending and no new story message is saved. The new visible error treatment is clearer, but the underlying contract remains fail-closed for narration.

This does not establish a failure with any specific live model. It does demonstrate that the fork does not generally solve the user's repeated missing-receipt problem. The fork's acceptance document also explicitly reports no completed local Ollama timing benchmark.

## Changes worth keeping

- **Working-state transactions:** detached candidate, guarded writers, invariant checks, persistence before in-memory publication, and rollback for validation or storage failures. The browser save/reload regression passed.
- **Linked action execution:** explicit dependencies and per-action effects can represent ordered attempts and partial outcomes better than loosely associated effects. Correct ordering is valuable, although it needs the authorization/spatial/time fixes above.
- **Place knowledge and access:** structured geography, perspectives, door/key conditions and NPC travel checks address real sources of inconsistency.
- **Context selection and recall:** bounded recent turns plus source-linked older recall reduce avoidable context load. These are heuristic retrieval improvements, not a guarantee of long-term semantic continuity.
- **Map editor and BGM controls:** useful product features that can be reviewed/ported separately from the execution rewrite. Audio generation/playback quality was not verified here.
- **Provider diagnostics:** clearer errors, streaming validation, schema fallback and measured timing infrastructure make failures easier to inspect. Smaller fixture outputs are not proof of live-model speedups; some early latency documentation predates the larger linked schema.
- **Kokoro work:** useful optional local voice functionality, but requires its own dependencies/model files and platform verification. No Kokoro model was loaded for this review.

## Checks performed

Eleven non-browser suites passed: linked contract, linked execution, linked hardening, linked generalization, working state, latency, long memory, world lore, registered-effect proxy, receipt repair budget and scene draft.

The linked-turn browser suite passed: commit gating, storage rollback, reload, compound actions and quoted speech.

The fork's `world_local_scene_schema_audit.js` failed at line 81: the expected new response `Gloria smiles...` did not appear; the session's final message remained the original `Gloria waits at reception.` The fixture still sends a V2 draft while the new default requires linked V3. This is a test/compatibility validation gap; the observed failure alone does not prove that all properly configured local-model turns fail. The initial missing-Playwright environment issue was resolved before this browser result was obtained.

Additional real-pipeline probes reproduced the three findings above and the prose-only dead end. These used synthetic worlds and mocked responses; they did not test live model compliance, map usability across devices, all portable packaging, actual Kokoro synthesis or long-running multiplayer saves.

## Recommendation

Keep the useful work, but do not replace the local checkout wholesale. Land map/lore, context and diagnostics improvements in reviewable groups. Before making linked V3 the default for existing worlds, enforce requested-action scope, spatial item access and route-time accounting, repair the local-schema regression fixture, and run an actual-model playtest with the user's affected provider/model. Preserve the local experimental scene-ledger/provisional-story work deliberately if wanted; it is not present in this fork's v18.3.6 baseline.

## Source

- [Reviewed commit](https://github.com/Frief84/hordestudio/commit/ed89df8de8ba74ae6b6a5ea7e92c8cc77cad6f0e)
- [Native movement and item reducers](https://github.com/Frief84/hordestudio/blob/ed89df8de8ba74ae6b6a5ea7e92c8cc77cad6f0e/worlds/linked-world-actions.js)
- [Production turn integration](https://github.com/Frief84/hordestudio/blob/ed89df8de8ba74ae6b6a5ea7e92c8cc77cad6f0e/app.js)
- [Author's linked action acceptance and limitations](https://github.com/Frief84/hordestudio/blob/ed89df8de8ba74ae6b6a5ea7e92c8cc77cad6f0e/worlds/LINKED_WORLD_ACTIONS_IMPLEMENTATION.md)
