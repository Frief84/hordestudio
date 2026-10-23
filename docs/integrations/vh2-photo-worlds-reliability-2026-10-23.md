# VH2 photo handoff integration and Worlds recovery

Integrated locally on 23 October 2026. No version bump, commit, push or GitHub release was performed.

## Source and merge

The supplied `vh2-photo-reliability Patch Source` handoff was based on v18.3.6 (`d957222`). All 156 entries in its SHA256 manifest matched. Production changes were merged against that base while preserving the newer local Worlds integration, Pip, manual and other workspace changes. Helper copies, bytecode and old full application files were not installed over the checkout.

The handoff's known snapshot-test failure was an obsolete assertion: it changed `personality`, which this patch intentionally removes from image prompts. The storage guard still compares compiled provider requests. Its regression now changes the requested scene and verifies rollback and restoration of the immutable-snapshot trigger.

## Photo behavior

- Explicit chat photo requests use the player's bounded scene text instead of a model's lossy summary. A missing optional model photo action does not silently lose a clear request.
- Requested photos and spontaneous photos reserve separate daily allowances, scoped to the Horde profile and reset at midnight UTC. New allowances default to 100; existing stored values are retained. An older settings client omitting a cap does not reset it. Manual Image Activity generation remains separate.
- Natural, Request Only and Photo Friendly modes are available through the photo settings. Explicit requests work independently of the automatic-photo switch when a provider, approved identity and allowance are available.
- Explicit clothing changes omit conflicting previous-photo and garment references. Explicit setting changes omit incompatible saved place/zone references and previous images. Compatible continuity and identity references remain available.
- Long personality/photo-direction paragraphs no longer enter personal-photo image prompts. They remain saved character data and dialogue context. Existing appearance controls, requested wardrobe-ID expansion, visual styles and reference review remain supported.
- Wide/candid and ordinary personal-photo requests can use `personal_photograph` throughout capture, queue, compilation and browser review. They do not automatically become arm-length selfies. Explicit selfie and mirror requests remain supported.
- Discussion, capability questions, requests for an address, picture frames and non-photo follow-ups do not automatically spend image credits. An ambiguous “another angle” requires recent photo context.
- If photo queueing fails after a reply was prepared, the capture and reply are rolled back together. A promise to send a photo is not delivered without a durable image job. Existing quota-exhaustion responses can still explain unavailable photos conversationally.
- Settings show both allowances and preserve provider/key configuration. Slow reads cannot overwrite edits or populate another human's studio.

Additional handoff repairs: removed a duplicate profile enum definition, fixed the undefined room-zone prompt variable, expanded framing support through the backend, and retained the current manual dialogs and newer script imports.

### Optional ComfyUI diagnostic

The workflow logger is integrated but **disabled by default**. Set `HORDE_COMFY_PROMPT_LOG_DIR` to an intentional output directory to enable it. The hard-coded Windows drive path was removed. Reports contain submitted prompts and workflow traces, so the configured directory contains private scene content; retention is controlled by the operator. Image data and common credential fields, including nested fields, are redacted. Logging failure does not prevent generation.

## Worlds findings and changes

The reported successful HTTP calls took 22.5 seconds in total. That example is a validation failure, not evidence that the 150-second turn limit was reached. No raw provider response was supplied, so the exact `loc_bullpen` proposal cannot be reconstructed from the report alone.

The audit reproduced these independent failures against the saved pre-fix application:

1. **Protocol switch during repair.** A V2 model returning prose without a draft was repaired using the legacy receipt instructions. Repairs now retain the requested scene protocol, including prose-only V2 responses.
2. **Redundant movement rejection.** A model reporting a completed move from the current mapped place to the same place could reject an observation for lack of travel authorization. An actual no-op is now informational. A different origin/destination still goes through ordinary validation.
3. **Legacy map-awareness incompatibility.** Older imported maps had never authored the new NPC place-awareness rules. Their normal routes could become unavailable. V2 retains legacy map knowledge until actual awareness rules are authored; empty editor placeholders do not opt into restrictions. Explicit awareness rules, access, doors, connectivity and travel-time checks remain authoritative. The V3 preview retains its strict place-awareness behavior.
4. **Transient timeout reporting.** The hosted-turn abort path used a toast. It now uses the persistent World error panel, with the actual timeout reason.

### Unchanged-scene compatibility

For a narrow non-mechanical request—ordinary look/listen, greeting or informational question—a prose-only response may be wrapped in an engine-owned, empty-effects V2 draft. It then passes the normal compiler, action, narrative/state and deadline validation. This avoids a second paid model call solely to confirm that nothing changed.

The adapter is not used for rejected tool proposals, linked execution, experimental ledger mode, pending dice, player-command mutations or physical actions. It declines obvious uncommitted item gains/consumption and explicit conflicting location claims. It never extracts location, cast, inventory or dice writes from prose. Successful recovery is recorded as `conversation_scene`, rather than pretending the model supplied a tagged receipt.

Structured events remain the default. A reply that asserts an invalid mechanical change can still require repair and be rejected if repair fails. The fix does not promise universal prose understanding or silently grant model-authored state.

## Verification

All provider responses and image outputs were mocked; temporary services/browser contexts were used. No live provider calls or user-save migration was performed.

Passed:

- 56 focused Python checks: photo prompt, dialogue, allowances, queue failure, snapshot equivalence and ComfyUI diagnostics.
- 19 existing worker/provider/image-storage checks.
- 220 companion checks, including the supplied photo regressions.
- Browser photo settings save/load, provider/key preservation, dirty-edit protection, room-zone prompting and reference selection.
- Browser Worlds recovery replay using the authored Bramble & Pike world: prose look/question, same-place movement, V2 repair, rejected arrivals/item changes, persistent 150-second timeout and legacy/explicit map-awareness rules. The saved pre-fix app fails the same ordinary-look fixture.
- Existing V2 scene browser suite: speech, deadlines, checks, movement, repair and persistence.
- Existing scene-ledger browser suite, including 100 turns, groups, departures, correction, rollback and reload.
- Existing pending-turn UI suite: delayed response, rerender, repair, abort, error, reroll and timeline switch.
- Pure lore, scene compiler, model-client timeout and linked-safety suites; photo continuity/pipeline and provider-setting race checks.
- JavaScript/Python syntax and Git whitespace checks.

Live Aion/V4 Flash behavior and actual generated image quality remain unverified. Restart the application/bridge and refresh its UI to load both backend and cache-busted frontend changes. Existing discarded replies are retained as history; they are not rewritten automatically.
