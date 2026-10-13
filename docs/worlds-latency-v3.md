# Worlds latency and scene drafts v3

Implemented 2026-10-13. Applies to foreground Worlds turns, not Chat Library or Virtual Humans.

## Behavior

- Five recent completed turns plus the current input, bounded by the existing context budget. Questions and answers are retained together. The current input is never silently truncated.
- Older source-linked scene memories are selected after the verbatim window, excluding the selected message IDs. A reroll cannot recall the superseded response. Failed scenes are excluded; deletion removes the memory source.
- Long-memory follow-up: the current question outweighs room/background words, with English/German stop-word filtering and light inflection matching. Present/referenced actors and recent dialogue provide secondary relevance. Relevant individual records are selected rather than dropping an entire oversized scene. Older narration can supply a bounded, source-linked excerpt when structured memory missed a detail. Excerpts retain witnesses, exclude hidden state blocks, and are explicitly distinguished from verified state. Retrieval remains bounded to 4,500 characters and eight source scenes; it is not a guarantee of perfect semantic recall.
- Local lore already selects the current place, adjacent places, named people and relevant facts. Unrelated living NPCs are no longer listed in every absence manifest. Active commitments and knowledge boundaries remain available.
- Stable scene/protocol rules precede changing scene state. v3 replaces the redundant legacy final mandate with concise rules for the enabled modules.
- `scene_draft_v3` requires `protocol`, `narrative` and `actions`. Empty `events`, `effects`, `speech`, `commitments` and `resolutions` may be omitted. For one simple request, an omitted `actions[0].request` is supplied by the compiler. Compound requests retain explicit coverage. IDs still bind consequences to narrative passages.
- The compiler recognizes conservative English/German local-interaction patterns using authoritative inventory and present actors. Showing a held item, approaching a present person, waving or nodding needs no transfer or location event. Ambiguous requests, missing items and absent actors receive no exemption. All actual proposed changes and narrative conflicts still use the existing validators.
- A streaming reader checks closed enum values, duplicate keys and conclusive syntax failures. Incomplete values, missing fields and forward passage references wait for final validation. An invalid stream cancels only that generation and enters the same single-correction path. No partial draft is committed or displayed.
- Tool arguments, tagged JSON, ordinary JSON responses and schema-constrained transport share the compiler. A v3 local backend rejecting JSON schema gets one plain-JSON fallback; that capability is remembered per provider/model in the session.

## Compatibility and diagnostics

The internal receipt format and saved games are unchanged. v2 drafts remain readable. Set the internal world setting `kernel.sceneDraftProtocol` to `scene_draft_v2` to request the previous output contract; the default is `scene_draft_v3`. This switch changes the draft protocol, not the new history policy.

The World Director inspector shows estimated input size (explicitly labeled characters / 3.2), provider-reported token usage where supplied, first token, total model-request time, local validation time, time to accepted display, output characters, request counts and correction reasons. Session summaries group median/P95 and correction counts by provider, model and requested protocol. Missing timings are not zero samples; rejected scenes are not accepted-latency samples. Selected reroll takes contribute the timings stored on those takes.

## Validation

New checks:

```text
node scratch/world_latency_audit.js
node scratch/world_latency_browser_audit.js
node scratch/world_long_memory_audit.js
```

The browser audit uses isolated storage and scripted providers, exercises the actual turn pipeline, and spends no API credits. Set `HORDE_PLAYWRIGHT_MODULE` and `HORDE_BROWSER_EXECUTABLE` if Playwright or Chromium is not on the default path.

Regression coverage includes showing versus giving, absent actors, missing items, stale state, fragmented tool/content streams, early cancellation, at most one semantic correction, persistent schema fallback, v2 compatibility, whole-turn history selection and timing aggregation. Existing scene-draft, action-resolution, gate, route/escort, urgent-deadline, model-client, check-outcome and receipt-boundary audits are also used.

Long-memory tests cover an old promise behind 30 distracting scenes, German phrasing without repeating the speaker's name, a password only recorded in older prose, relevant records inside oversized memories, selected reroll takes, hidden/rejected/deleted source exclusion and the unchanged recall budget. The browser regression checks that old facts actually reach the outgoing provider prompt. Scripted responses test context delivery, not a live model's ability to interpret the recalled facts.

Deterministic fixture comparison (JSON characters, not tokenizer measurements):

| Scenario | v2 output | v3 output | Reduction |
|---|---:|---:|---:|
| Show held item | 282 | 174 | 38% |
| Recall question | 294 | 174 | 41% |
| Transfer | 393 | 297 | 24% |
| Travel | 403 | 314 | 22% |
| Check | 349 | 259 | 26% |

The fixture history falls from 7,270 to 3,063 characters (58%); its schema from 6,656 to 5,352 (20%). Each v2/v3 fixture compiles to the same internal receipt. These are controlled fixture sizes, not claims about all worlds or live speedups.

The local Ollama model catalog was reachable during validation, but `/api/ps` reported no loaded model. No live model benchmark was run and no median/P95 speedup is claimed. The inspector now collects those measurements during actual play; compare equivalent scenes with the same model, hardware and generation settings, and account for cold starts/cache effects.
