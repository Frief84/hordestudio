# Linked World Actions: implementation and acceptance record

## Runtime contract

Normal V3 World turns interpret the whole player input in the existing model call. The
Scene Draft carries exact `action_id` references from actions to dependencies,
events, effects and narrative passages. Executable outcome guards accept only
`succeeded`, `failed` and `blocked`; state guards read registered facts from the
current working state. Invalid, duplicate, missing, forward or cyclic references
are rejected locally. V2 and older ID-less V3 receipts retain their legacy replay
path.

`HordeWorkingState` returns frozen copies for reads. Typed reducers use its writers;
the retained legacy effect implementation runs only on a detached candidate that
`applyDetached` imports through those same writers. The dirty-key set contains
`entity:${id}`, `location:${id}`, `session:${field}`, `time`, `event`, `relation`
and `history`. Preparation rejects a state difference without its corresponding
key. Direct writes to canonical state are caught by a recursive test proxy.
Follow-up effects have a per-receipt budget of 16 and reject cycles.

The complete candidate is persisted under the World mutation lock and version
check in one IndexedDB transaction. Only then is it published in memory. A
compiler, validation, reducer or storage failure discards the candidate. A valid
chain may include confirmed successes followed by blocked or failed actions.
All model prose is buffered until durable commit. Technical progress text may be
shown while waiting. An inconsistent narrative is rejected and may use the
existing bounded repair path.

The new path does not call the old movement, companion, outfit, door or
`simpleRequest` language decisions before committing. Deterministic access and
legacy replay rules remain. Reachable locations and entities are provided as
read-only scene context without changing the player's position in advance.
Unregistered technical effects fail closed.

## Phase acceptance

| Phase | Evidence |
| --- | --- |
| 1. Contract and compiler | `world_linked_contract_audit.js`, `world_scene_draft_audit.js`: exact references, confirmed guards, local schema validation and legacy replay. |
| 2. Transaction and commit | `world_working_state_audit.js`, `world_turn_transaction_audit.js`, `worlds2_atomic_turn_persistence_browser_audit.js`: dirty coverage, recursive write proxy, indirect group changes, event chains, 17th follow-up rejection and rollback. |
| 3. Effects and parsers | `world_linked_execution_audit.js`, `world_registered_effect_proxy_audit.js`, `world_linked_chain_browser_audit.js`: registered effects use guarded state; the V3 turn succeeds with old language parsers disabled. |
| 4. Narrative and providers | `world_linked_turn_browser_audit.js`, `world_scene_draft_browser_audit.js`, `worlds2_provider_response_browser_audit.js`: prose gate, storage failure, partial failure, streaming and fallback transports. |
| 5. Generalization and saves | `world_linked_generalization_audit.js`, `worlds2_campaign_browser_audit.js`, `world_real_save_continuation_audit.js`: unseen verbs/worlds, portable campaign round trips and multi-turn continuation of isolated live-save exports. |

The real-save audit imported copies of two playable campaigns exported from the
local live database into separate disposable browser contexts. It never wrote
to the source database. **The Submission Vault** retained its 161 prior history
entries, 210 prior events, 89 prior World receipts containing both V2 and V3
protocols, 32 entities, 11 locations, inventory, relationships, state maps and
door/access state after three new V3 turns, save and reload. A pending check was
then introduced on that isolated copy, saved, reloaded, resolved, saved and
reloaded. **Aurelia** retained its initial session and 24 entities / 35 locations
after three new V3 turns, save and reload at its original 32,768-token context
setting. Original NPC observations are retained as new observations accrue;
message storage no longer silently drops the oldest 50.

## Calls, latency and remaining limits

The successful V3 path uses one regular model call per turn. The real-save tests
used mocked model responses and observed exactly three calls for three turns in
each campaign. The final run measured full local turn times of 3,678 / 3,379 /
3,382 ms for the larger Submission Vault copy and 184 / 97 / 102 ms for Aurelia. These are
local processing and IndexedDB times with a mock provider, **not** model latency.
The compact linked schema reduced one Aurelia tool/JSON contract from about
47,343 to 20,223 characters; its existing 32k context setting then passed the
outgoing-payload preflight. Streaming now waits for commit, so users see the
model generation plus validation and persistence delay before story prose.

A real local Ollama turn with `gemma4:31b-it-q4_K_M` did not finish within four
minutes; a one-token direct `qwen2.5:14b` request timed out after 45 seconds.
There is therefore no completed Ollama response-time figure. Model noncompliance
may still invoke the bounded repair path. Narrative consistency checks are
deterministic and cannot prove every possible semantic claim. Technical effects
remain limited to registered operations; new operation types require a reducer,
while new wording and combinations of existing operations do not. The detached
legacy adapter and large real saves still incur whole-candidate cloning during
preparation; correctness and save preservation take precedence over O(k)
copying in that compatibility path.

No separate V2-only played campaign or live save already containing a pending
check was present among the exportable local campaigns. Historical V2 receipts
were verified inside the played V3 campaign; the pending-check continuation was
verified on an isolated copy.
