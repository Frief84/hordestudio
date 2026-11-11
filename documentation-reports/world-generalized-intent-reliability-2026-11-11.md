# Generalized World Engine reliability fix

Date: 2026-11-11. Workspace: `N:\Horde Studio\app`.

## Confirmed causes

1. **Provider schema and engine requirements diverged.** The provider schema required only `source_quote` and `kind`; the engine additionally required operation/item/destination/utterance fields. Actual Qwen and Ministral HTTP-200 responses with `finish_reason: stop` omitted transfer `operation`, sometimes putting an operation in unrelated fields. The engine correctly rejected them. The schema now describes action-specific variants and requires their execution fields. Transfer variants distinguish give (recipient required) from take/drop/consume (destination owned by the engine).
2. **Optional fields had no useful empty representation for constrained generation.** Models emitted self-dependencies and guessed a numeric duration when waiting for an answer. Empty dependency arrays and nullable wait duration are now explicit; the prompt explains these representations. Invalid dependencies remain errors and are remapped when redundant context steps are removed. They are never silently made unconditional.
3. **Completion extraction assumed a raw JSON string.** Text content blocks, a whole-response JSON fence, structured tool arguments, legacy function arguments, and parsed structured objects now use a shared decoder. Reasoning text is not execution data. Refusals, empty content, malformed JSON, multiple structured results and truncation have distinct English errors.
4. **Implicit waiting failed twice.** First, intent validation required minutes. After removing that requirement, the executor correctly rejected a timed-wait action without a time effect. An unspecified wait now compiles to the existing passive observation path: normal turn time advances, without invented additional minutes or an asserted future event. Explicit timed waits retain their existing typed effect.
5. **NPC narration lacked conversation context.** The narration prompt discouraged NPC actions without clearly permitting replies; compiled speech exposed `statement`, but narration read `quote`. In addition, this path wrote empty witness lists and attempted to read history from state snapshots that deliberately omit history. The corrected path supplies exact speech, listeners, persona, own observations and committed witnessed dialogue. Stationary conversation memory is limited to confirmed listeners present throughout; whole multi-location/private conversations are not exposed to other NPCs. Rerolls exclude the replaced message and update its existing observation records.
6. **Text limits disagreed across stages.** Intent source/utterance and downstream speech/passage limits are now compatible with the existing 5,000-character interpretation input. Exact names and dialogue are preserved; only Unicode composition, quote typography and whitespace can be matched back to original source spans. The old prefix-based utterance shortening was removed.
7. **Error propagation obscured the failure.** Semantic failures produced a generic localized rephrase message, and malformed step shapes could throw a TypeError shown as a local-network error. Parsing/schema/semantic stages now have explicit diagnostics. Provider-localized details remain in diagnostics while user-facing technical messages are English.
8. **Coverage could conceal omitted actions.** Meaningful source coverage is now checked before connective/punctuation gaps are attached to action spans. A partial interpretation cannot become a successful full-input interpretation by appending omitted words to its last action.

## Pipeline and authority

Player input enters `executeWorldTurn`, which owns the in-flight guard, input preservation and snapshot. `interpretWorldAction` builds the shared contract; `fetchWorldTurnJSON` selects the existing provider adapter. OpenRouter, GPTProto, NanoGPT, NVIDIA, Bedrock, custom and local routes retain their chat-completion interfaces; AI Horde retains its queue adapter.

HTTP success is followed by completion decoding, intent normalization, source/reference validation and compilation. Typed actions still pass through the existing scene compiler, optional `/worlds/bind-turn` worker, linked executor and reducers. Model prose has no state-write authority. The detached candidate is version-checked and committed through the existing IndexedDB transaction before publication to the frontend. The binding worker does not persist a turn.

Only an explicit HTTP 400/422 rejection of structured-output capability permits one prompt-schema fallback request. Authentication, rate-limit, timeout and ambiguous delivery failures do not trigger automatic turn replay. Both request forms use the same validator.

## Files changed by this task

Production:

- `app.js`: interpretation contract/prompt, staged diagnostics, implicit waits, narration evidence, scoped conversation memory, reroll observation maintenance and source coverage.
- `worlds/resolved-intent.js`: action/operation-specific schemas, optional-empty handling, source-span normalization, dependency preservation and validation.
- `worlds/model-client.js`: shared completion/text extraction, structured-format capability detection and parsing diagnostics.
- `worlds/scene-draft.js`: compatible speech/passage text limits.
- `worlds/turn-binding.js`: compatible bound passage text limit.
- `index.html`: cache versions for changed scripts.

Tests:

- `scratch/world_generalized_response_audit.js` (new).
- `scratch/world_generalized_browser_audit.js` (new).
- `scratch/world_generalized_live_audit.js` (new, opt-in local models).
- `scratch/world_resolved_intent_browser_audit.js` (expanded).
- `scratch/world_resolved_intent_contract_audit.js` (English error expectation).
- `scratch/run_world_model_regressions.js` (expanded regression gate).

The workspace already contained extensive unrelated changes. Those were retained; the full Git diff is not solely this task's patch.

## Verification

- Baseline: **29/29 existing audits passed** (`scratch/world-generalized-baseline.json`).
- Expanded regression gate: **38/38 audits passed** (`scratch/world-generalized-final.json`). Coverage includes transport/SSE/JSON/Horde, deadlines, NPC knowledge and goals, long memory, migration, linked actions, receipts, resource rules, atomic persistence, startup recovery and existing browser workflows.
- Final deterministic multilingual browser checks: **27 cases in each binding mode, 54 total passed**, plus six transport-failure cases in each run. These compare all four requested German/English action pairs, actual inventory/time/location effects, twelve mixed-language conversation turns, provider envelopes, capability fallback, long dialogue, malformed schemas, unknown targets and omitted actions.
- Final live Qwen browser verification: **22/22 passed** using the actual production prompt, local model requests, execution and persistence in an isolated fixture. German and English pickup/drop/wait/question sequences produced the same inventory, location and clock values (485, 490, 495, 500). Twelve dialogue continuation turns and a natural long mixed-language question passed. See `scratch/world-generalized-live-browser.json`.
- Actual provider-response fixtures from **Qwen 2.5 14B and Ministral 3 14B**, ten inputs each: the final normalizer/validator accepts **20/20** saved responses. Nineteen passed at capture; the remaining response had an irrelevant recipient on a valid take operation, which the operation-specific normalization now discards. The original failures and intermediate schema results remain in `scratch/world-generalized-live-before-schema.json` and `scratch/world-generalized-live-schema-intermediate.json`; the final captured responses are in `scratch/world-generalized-live-results.json`.
- JavaScript syntax checks and `git diff --check` passed. Git emitted existing line-ending notices, not whitespace errors.

The initial live browser rerun encountered a cold-model timeout in its test proxy. The harness now loads the local model explicitly before generation. This does not change production timeouts. A separate artificial long input repeating one sentence 35 times caused live model token exhaustion; the turn failed safely with input preserved. The same long payload passes the deterministic end-to-end schema/persistence tests, and the natural long dialogue passed live.

## Compatibility and limits

- No dependency changes, saved-world schema migration, public endpoint removal or provider replacement. Existing save/migration, reload, reroll, rollback and concurrent-submit tests pass. Personal saved worlds were not mutated by the tests.
- Narrative language still uses `worldOutputLanguageInstruction`; intentional dialogue language switching remains allowed. All newly handled technical failures use English messages.
- Authoritative movement, inventory, resource, check, access and receipt validation remain in the existing engine. Unknown references and invalid dependency edges remain rejected.
- Hosted providers were verified with protocol fixtures, not paid live requests. Live model coverage is two installed local models, with the complete browser workflow exercised on Qwen.
- An LLM can still refuse, truncate, invent irrelevant narrative details or produce invalid semantics. Invalid structured results fail without publishing state. Creative dialogue is not proof of a mechanical event or external fact; these changes do not claim universal model correctness.
- A multi-location narration is deliberately not stored as shared knowledge for everyone present at only one stop. Existing source-linked event memory remains authoritative there.
- The existing local transaction/re-entry protections remain; no new cross-device exactly-once guarantee is claimed.

Reload the application to load the updated script cache versions.
