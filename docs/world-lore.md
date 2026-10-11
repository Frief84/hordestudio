# World Lore and generated world structure

Create places of any kind, characters, factions, secrets and lore using the existing editors. Then click **Generate World Structure** in **Overview** or **World Lore**. Both buttons offer the same generation options: Without AI (default), Use world model (the current World Studio model, falling back to the default Settings model), or Choose another model from the active provider catalog. The local structure is always built first. With AI enabled, source records are read in bounded batches and suggestions are staged for review under AI proposals. No suggestion is applied automatically; Stop after current batch preserves completed proposals. Provider calls can incur costs. Use **Save World** to persist the draft.

Generation adds stable IDs where missing and builds a derived relationship index in `world.worldStructure`. Existing lore text, descriptions, secrets and explicit permissions remain authoritative. Rebuilding refreshes that index, not the authored records. Named exits are resolved only when unambiguous; generation never invents travel edges, durations, locations or NPC knowledge. Text mentions are navigational links, not evidence that a character knows a fact.

Place knowledge is separate from entry permission. Locations and regions can assign `placeAwareness: {includeChildren, npcs, factions}` with `know` or `unknown` decisions. A rule on a specific place takes precedence over an inherited area rule, and an individual NPC rule takes precedence over factions at the same place. Existing places are otherwise unknown to an NPC, except their start, home, fixed schedule locations and places visited or explicitly discovered during that game. Explicit authored ignorance overrides routine familiarity and is reported by World Health Check. Discoveries, opened doors and copied entry permissions stay in their own game session. AI generation may suggest a knowledge assignment only from exact authored text; every suggestion needs review and cannot overwrite an existing rule.

The simulation uses the same directed connections, current doors, travel times and entry checks for NPC schedules, World Agent moves and followers. Ordinary movement requires a known route; an explicit exploration move may discover one adjacent unknown place. A route closed during travel leaves an NPC at the last reached location. The DM receives a bounded local place packet; the World Agent receives a few valid next-hop IDs per active NPC. The engine validates movement and event evidence locally, and a repair request receives only the faulty receipt and nearby rules. Turn diagnostics separate prompt size, model time, local validation and repair time.

The World Lore browser is a compact place guide with search and place-type filters. Select a place to see its appearance, contents, routes, access and place knowledge. **Edit in Places** opens the source record in the Locations editor, where access and knowledge rules can be changed. AI suggestions remain pending until explicitly applied, and authored changes remain in the draft until **Save World**. The original lore text editor remains available below the place guide. **Director → World Lore · Author / Debug** is read-only; current session positions are shown separately from authored world data.

## Authored fields

- Places retain `mapType` and optionally add a custom `placeType`. Locations use `parentLocationId` / `regionId`; regions can use `parentRegionId`. Containment alone does not establish a traversable route.
- Records and secrets may have `knowledge: {visibility, npcIds, factionIds}`. Visibility is `public`, `assigned`, `narrator` or `unspecified`. Unspecified legacy prose is narrator context only. A location's `hiddenDescription` has its own `hiddenKnowledge` assignment.
- `about: [{kind, id}]` links existing records. Kinds are `location`, `region`, `npc`, `faction`, `lore`, and `secret`.
- Locations and regions may have `access: {default, includeChildren, npcs, factions}`. Default is `open` or `restricted`; individual and faction maps contain `allow` / `deny`. The closest explicit applicable place rule wins; individual rules outrank faction rules, and conflicting factions deny access. No configured restriction means legacy open access. A forbidden origin may still be exited.

NPC route finding, scheduled journeys, receipt-driven movement, recovered arrivals, population placement and player followers consult the shared permissions. Existing saved placements remain intact and are diagnosed instead of silently relocated.

## Doors and physical locks

World Lore → Access shows both incoming and outgoing connections. Existing `requiredItem` and `allowCheckUnlock` fields are shared with the travel engine and remain authoritative. Optional `lockState` is `unknown`, `unlocked` or `locked`; a key/check requirement implies a locked initial connection even for legacy records. Unknown does not invent a restriction. A locked connection without a key or check remains blocked and is flagged for review. Edit entry allows changing these fields on each directional connection. Opposite connections remain independently authored.

Opening a connection during play uses the existing session `unlockedExits` map. The author view and model context expose initial and current states separately. The generated place structure includes lock metadata on travel edges plus explicit entry and knowledge rules on place nodes. Health Check diagnoses invalid/conflicting locks, unassigned room entrance states, missing opening methods, unresolved required items and descriptions that suggest restrictions without structured rules. AI lock proposals may change lock fields only, never destinations, travel times or route count.

## Review and diagnostics

World Health Check includes generation status, stale structure, broken IDs, containment cycles, unassigned knowledge, access conflicts and incompatible authored placements/schedules. Deep Audit receives the new metadata too. After editing source records, regenerate the structure; the live model context is always assembled from current authored sources rather than an outdated cached index.

The optional per-record AI suggestion button uses the world's configured model. Suggestions require exact source excerpts, refer only to existing IDs, and remain separate until accepted. Stale or invalid suggestions cannot be applied. This operation does not create new world content.

Modules live under `assets/worlds/`, a path the local bridge already serves, including older running bridge processes. The editor also retries loading these modules when generation is invoked with missing scripts.

## Regression checks

- `node scratch/world_lore_audit.js`
