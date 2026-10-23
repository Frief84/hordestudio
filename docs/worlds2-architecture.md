# Worlds runtime boundaries

Worlds has one canonical world and one active timeline session. Model output is a proposal, not a direct state mutation. The browser UI is a projection of committed state.

## Ownership

- `app.js` owns the World domain rules and the authoritative turn transaction. It validates receipts, captures checkpoints, commits accepted changes, and restores the previous state when a save fails. World Agent and direct player actions use the same rollback contract.
- `worlds/model-client.js` owns chat-completion HTTP setup, JSON decoding, abort/network/error classification, and one diagnostic outcome per attempt. It does not select models or mutate a world. A telemetry callback failure cannot discard a model reply.
- `worlds/scene-draft.js` is the pure model-proposal compiler. It validates request coverage, response excerpts, witnessed speech, connected locations, absolute commitments, and observed deadline resolutions. It emits an engine receipt; it has no I/O or write access. The new path does not recover authoritative changes from prose. The existing domain reducer remains the authority for mechanical acceptance.
- `worlds/turn-context.js` selects bounded history and source-linked scene memory, excluding abandoned failed actions. Memory stays attached to its originating turn so reroll and rewind can remove it.
- `horde_mcp_bridge.py` serves the model client, scene compiler and context module in local and portable installs. Portable HTTP smoke checks all three routes.
- World Play rendering reads a bounded projection. Normalization for display is allowed only on that copy. Rendering cannot grant quest rewards, alter an inventory, advance a clock, or initiate a save.

## Commit contract

1. Check the active world/timeline and serialize foreground or direct actions against another in-flight mutation.
2. Capture the pre-action World checkpoint and transcript tail.
3. Apply and validate a proposed mutation.
4. Persist the changed World shard. Only then mark the action committed.
5. On rejection or storage failure, restore canonical state and the transcript tail. Invalidate background work drafted against the abandoned epoch.

Player travel, equipment, dropping items, weather changes and manual state corrections follow this contract. Scene drafts and their changes remain provisional through validation and persistence. Rejected drafts are not saved as successful story. A valid complete draft does not require a separate narrator request; checks and gated secrets may require follow-up. `kernel.sceneDrafts:false` explicitly selects the older receipt transport; legacy output is rejected in the new protocol.

Malformed function arguments can use one plain-JSON correction through the same compiler and reducer. A successful correction remembers that transport for the timeline/model's subsequent no-secret turns. Exact outer JSON fences or receipt tags are framing only: decoding does not scan arbitrary prose or repair malformed JSON. Neither transport has independent write authority.

The foreground stream owns only its idle timer. Later JSON requests have independent body deadlines; user Stop and the overall hosted deadline remain shared. HTTP 200 is insufficient for success: completion choices and provider error envelopes are checked.

## Check outcome authority

The scene compiler marks checks with the engine-owned `state_delta_v1` contract.
It removes legacy `success_text`/`failure_text` presentation hints and rejects
free-form branch `ledger_update`/`memory_write` as substitutes for consequences.
Inventory loss, route changes, conditions and other lasting effects must use
their typed operations in the chosen branch. An unresolved attempt's root ledger
note is redundant with its source-linked scene and is not committed as an outcome.

After the authoritative roll and chosen branch execute, the engine records the
actual state delta, including applied failure costs. It derives the result sentence
from the roll, not model-written consequence prose. The narrator receives an
exhaustive delta and instructions not to invent collateral damage or permanence.
Only changed state paths are stored, avoiding a complete world copy per check.
Pending manual checks preserve this contract; manual and automatic results use
the same settling helper. Persistence failure restores both state and check history.

This removes an unverified source of canonical consequences; it is not a claim
that arbitrary model-written prose can be mathematically proven correct. Existing
contradiction checks remain defensive, and hosted narrative QA remains necessary.

## Long campaigns

The transcript DOM is windowed; history and insight lists are paginated. Exact per-turn snapshots remain in the saved history because rewind, reroll, and export must restore the same canon. World persistence compresses its shards. In the offline 1,110-turn acceptance fixture, the logical session was 3.75 MB, render p95 was 6 ms, and save p95 was 23 ms. Sparse checkpoints are deliberately not introduced without a versioned migration and exact-replay proof.

## Acceptance gates

- `scripts/check-engine.js` covers World rules, commands, rollback, model transport, and other engine contracts.
- `.github/workflows/engine-checks.yml` runs browser persistence, model routing, campaign, render-purity, startup recovery, and long-campaign tests.
- `scripts/verify-portable-package.py` must pass on the built ZIP. A source-tree browser pass is insufficient: the packaged bridge must serve every new script.

These are offline deterministic checks. Live hosted/local model quality and provider-specific behavior require separate acceptance before a release claim.
