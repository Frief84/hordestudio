# Worlds playability audit — October 11, 2026

## Verdict

The current experiment is not demonstrated release-ready for real roleplay models. Atomic state protection is useful, but making every visible reply depend on a structured contract makes provider/model compatibility part of basic playability. A model can write a reasonable room description and still produce a completely blocked turn. Scripted tests supplying perfect receipts overstated practical confidence by omitting this common failure.

The screenshot supplies `missing_mandatory_receipt` with Aion-2.0 selected. That identifies missing accepted structured output, not proof of a narrative/state contradiction, model refusal, or a particular provider. No raw Aion response or provider identifier was supplied. We should not claim the actual live failure is fully reproduced or resolved without those.

## Confirmed implementation problems and corrections

1. **Correction instruction without a supplied tool.** For non-OpenRouter providers, scene repair instructed the model to return the corrected scene through a tool, but the repair request carried no tool definitions. Now that request explicitly asks for JSON text and supplies the schema. OpenRouter also uses JSON correction after a prose-only response that supplied no candidate.
2. **Successful compatibility fallback ignored on later turns.** Remembered JSON delivery was consulted only when `receiptFirstToolCall` applied, which restricted reuse to selected OpenRouter turns. It now applies to the same provider/model on any scene-draft turn; previously marked tool-shy models also start with JSON delivery.
3. **Missing original candidate in prose-only correction.** Correction could say “Rejected draft: null” without including the uncommitted prose it needed to represent. The correction now includes that candidate explicitly, labels it uncommitted, and requires contradictions to be revised rather than inventing mutations to legitimize the text.
4. **Initial schedules destroyed the opening cast.** Confirmed separately with Stillwater: before the first accepted record, schedules started journeys for Leah, Eli and Mara. Their narrated arrival presence then failed. Initial scene capture before the timetable tick now preserves the opening. Stillwater's revised file disables automatic schedule movement; its routines remain narrative guidance.
5. **Generic error message hid different failure classes.** Already corrected to expose validator reason codes, without exposing rejected prose, private prompt data or credentials.

These changes preserve the reducer's movement, cast, checks, inventory and deadline validation. They do not parse free prose into canonical state or accept a failed candidate as truth.

## Remaining design concerns

- An outright prose-only model that cannot produce valid JSON even after explicit correction still blocks. The current fallback improves transport compatibility; it does not prove that Aion or all roleplay models honor the contract.
- Automatic soft story acceptance would need an explicit provisional-story boundary: no mechanical writes, clear distinction from established facts, deliberate reconciliation, and history/context rules. Silently saving prose as canon would recreate the mismatch users originally reported. A later iteration now implements this boundary for opt-in scene-record mode: marked provisional history, labelled model context, no witnessed-knowledge/scene-memory or mechanical writes from the prose, and a Correct scene action. This permits conversation but does not automatically reconcile a divergent map.
- The schema and accumulated instructions remain large relative to a simple observation request. The compact scene record reduces required output fields, but the optional mechanical schema and prior mandates still add burden.
- A reasoning model can exhaust its output budget before emitting a visible draft. Aion documents a shared reasoning/visible token cap. This is a plausible additional failure route, not established by the screenshot. A provider trace should distinguish empty/length-limited output from prose-only output and malformed JSON.
- A 27-person opening cast and world-wide lore matching increase prompt complexity. The UI's full cast line is noisy; “foreground speakers” and “physically present occupants” remain different concepts.
- Dated camp events are narrative plans, not automated calendar transitions. The model still needs to maintain these consistently.
- The prior 100-turn mock soak measured state transactions, not spontaneous character continuity or live-model playability.

## Validation

`world_tool_shy_scene_transport_audit.js` imports the actual Stillwater file in a clean browser, simulates a model giving only prose unless explicitly asked for JSON, verifies successful correction, and checks that the following turn uses JSON directly without tools. Invalid destinations still fail without moving the player. No user profile, paid calls or external requests are used.

Existing scene-draft and scene-ledger regressions cover the established state boundaries separately. Neither suite constitutes a live Aion evaluation.

Before claiming release readiness: run a small actual-model playtest with the affected provider/model and retain request mode, output presence/finish reason, correction count, acceptance and canonical scene across observation, dialogue, explicit movement, joining/leaving companions and a mechanical action. Measure successful playable turns and repeated blockers, not only validator correctness. Do not ask users to restart campaigns to compensate for repeated transport failures.

## Primary references

- [Aion API reference](https://api.aionlabs.ai/docs/api-reference/): per-model tool capabilities, reasoning and completion token budget. Capability must be checked for the actual model/route; general API tool support is not proof of successful adherence.
- [NanoGPT Aion-2.0 model page](https://nano-gpt.com/models/text/aion-labs/aion-2.0): describes the model as a roleplay/storytelling variant. This explains its intended application, not its response in the user's session.

## Provisional-story iteration

Scene-record mode now retains readable authored prose when receipt validation or repair times out. The story is explicitly provisional; authoritative state remains at the last committed scene, plus any independently committed player-directed actions or waits. Receipt repair in this mode is bounded at 10 seconds. Empty responses and raw tool payloads still produce an error rather than invented prose. Strict mode keeps its previous behavior.

The browser test simulates a repair timeout, a second invalid correction, continuation using labelled provisional context, a false narrated pickup without inventory change, no verified ledger or witnessed memory, visible correction affordance and persistence across reload. This improves availability, not proof of live-model state/narrative fidelity. Users can continue dialogue but should correct the scene when physical narration differs from the saved map/cast.
