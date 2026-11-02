# Experimental scene record and ledger: implementation and validation

Enable in World Studio > AI > World Kernel > Scene tracking > Scene record + ledger (experimental), then save. Existing Worlds retain Structured events by default. World Kernel must be enabled. Switch back to Structured events to disable the prototype.

## Implemented

- Compact ending-scene contract: location, named cast and anonymous background groups. Ordinary conversation does not require explicit action, speech or event arrays.
- Ending locations and actor placements compile to existing validated movement operations. Known IDs, route restrictions, player intent, journeys and enabled mechanics remain authoritative. This does not permit arbitrary map teleportation.
- An omitted current occupant remains present; a completed departure must specify its destination. Omitted background groups remain in the same scene until explicitly removed. New named/role actors use the existing NPC introduction mechanism with stable identities.
- Foreground cast is held during continuous conversation so schedules do not silently remove it when turn-based pins expire. Explicit time skips release the hold, and leaving the scene releases the old scene's hold. Existing in-progress journeys retain their rules.
- Current scene is projected from canonical actor/location state. Anonymous groups, record revision and source receipt are stored in the timeline. Each accepted narrative stores its own scene record in the existing history ledger, avoiding a second growing ledger copied into every snapshot.
- World play shows a Scene record summary, messages show record metadata, and History displays each recorded cast. Existing Correct state updates the scene projection under version, host, transaction and persistence guards; moving to another location clears old anonymous groups.
- Reroll takes carry separate scene-record metadata. Scene records participate in existing snapshots, reloads and rollback. No new persistence engine or background LLM was added.
- New runtime is served by the Python bridge and staged through the existing worlds tree in portable packaging; portable HTTP verification includes its endpoint.
- Built-in manual and Pip knowledge describe setup and corrections.

## Validation

All provider responses were scripted in fresh browser profiles. No paid generation, embedding calls or user-library access.

- Pure adapter/compiler audit: optional dialogue fields, immutable proposals, malformed input, unknown/inactive actors, group IDs/counts, omitted cast retention, arrivals, departures, conflicting moves, pending-check transition rejection, introduced actors, serialized records and explicit group removal.
- World Studio controls: mode selection loaded correctly; disabling and re-enabling saved the expected configuration, which survived reload.
- Actual World turn handler: pool arrival with four named participants, anonymous groups, ordinary dialogue, omitted cast, explicit NPC departure, invalid location rejection without replacing the prior scene, correction and reload.
- 100 consecutive conversational turns with schedules enabled: foreground participants remained in the established scene, every turn accepted in one foreground provider response.
- Distinct reroll group counts retained per-take scene metadata; checkpoint restoration recovered scene groups; injected correction storage failure restored the scene and location.
- Existing scene-draft browser suite: one-call scenes, speech provenance, commitments, bounded repairs, dice/check behavior, persistence and corrections passed.
- Existing atomic-persistence browser suite passed: pending World turns do not become durable through embedding diagnostics.
- World Play render-purity browser suite passed.
- 27 engine regression checks, 12 integrity checks, 66 calibration checks, 5 portable staging/reproducibility/exclusion checks passed.
- Bridge smoke: /worlds/scene-ledger.js returned 200 and the expected module.
- Handbook regeneration, handbook resource audit and Pip retrieval/semantic-index tests passed.

## Practical limits and next evaluation

This is a prototype for local play, not a published release or proof of live-model reliability. It simplifies obligations while retaining existing mechanical validation. It does not automatically interpret every physical implication of prose. A model can still contradict its own ending scene; detected/invalid scenes follow the existing discard-and-retry/correction flow.

Cross-location visibility (for example pool deck versus pool water) is not yet inferred: participants currently need canonical co-location. Model-declared anonymous groups are background presence, not individual NPC minds. Corrections currently use the existing per-actor mapped-location form. Detailed scene/group editing, a provisional-story acceptance UI and controlled live-model A/B evaluation remain follow-up work; none is advertised as implemented.

Before changing defaults, compare recorded failures using the same models/scenarios against Structured events. Measure narrative contradictions separately from engine synchronization, as well as blocked turns, correction rate, provider calls, latency and token cost. Test multiplayer relay behavior and ambiguous neighboring-location geometry before expanding scope.
