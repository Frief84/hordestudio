# World scene items (P2.4a/b)

New sessions carry `sceneItemSeeds`. On the first linked turn in a room, the
linked action executor reads only structured `location.items`, groups identical
names, and adds missing session-owned item entities through Working State. A
successful player move seeds its destination in the same transaction. The seed
marker, definitions, quantities, and inventory changes commit together with
the turn. Existing saves without the marker keep their previous behavior.

An author may use strings (including `three pairs of handcuffs`) or objects
such as `{ "name": "Pair of handcuffs", "quantity": 3 }`. An object may set
`reachable: false` until an authored change makes it accessible. Existing
registered items at that location take precedence. Plain description text
never creates an item.

Generated scenes can introduce an item only through `item_introduce` with a
stable ID and a matching completed event. A discovery also needs independent
authored support: an exact `location.discoverableItems` entry, an ordinary
category in `location.discoveryPolicy`, or an exact `world.itemCreationRules`
entry. The model's own event cannot prove its own object. This is validated with
the linked action and saved in the existing World entity/session state. Item
transfers and consumption use typed effects; they require stock, locality and
successful action validation. The receipt is persisted atomically.

## P2.4c creation rules

`item_introduce` also handles crafting, conjuration, transmutation and
replication. Its `cause`, `actor_id`, `rule_id`, `source_item_id` and optional
`duration_minutes` connect the proposal to an authored rule. The completed
inventory event names the exact new ID, item and actor. Player and NPC actions
use the same reducer. Created definitions keep their ID, origin cause, event,
creator, location, quantity and optional expiration in existing entity state.

For ordinary open discovery, a location may specify
`discoveryPolicy: { ordinaryCategories: ['natural'], maxQuantity: 2 }`.
The proposal must name an allowed category. Existing catalog entries marked
unique, quest or access restricted cannot use this path. Exact
`discoverableItems` entries are for authored discoveries, including items the
author wants to reveal later. Established item IDs and previously discovered
items at the same location are reused instead of recreated.

An example creation rule is:

```json
{
  "id": "carve_staff",
  "cause": "crafting",
  "item": { "name": "Staff", "category": "weapon" },
  "ability_id": "woodcraft",
  "materials": [{ "item_id": "Wood", "quantity": 2 }],
  "tools": ["Knife"],
  "locations": ["workshop"],
  "time_minutes": 10
}
```

Rules may instead specify `resource: { id: 'mana', amount: 3 }`, a previously
successful `check_id`, `source_item_id` for transmutation, or
`duration_minutes` for temporary objects. These fields are optional. A rule
with `item.properties.unique` prevents another live instance; trusted item
properties such as access rights come from the rule, not the model. Expired
objects are removed from inventories and loose stock when a linked time effect
reaches their deadline, or on the next linked turn after the authoritative
World clock reaches it. An existing engine event records the removal. No additional
model request is used.

## Follow-up

- **P2.4d:** Structured room items may optionally carry `containerId` or
  `blockedBy`, both exact IDs of authored interactables. Taking an item requires
  its container to be `open` and its obstacle to be `open`, `removed`, `cleared`
  or `broken`. The authored `interactable.transitions` determine whether those
  states can be reached and which item, if any, is required. A successful
  `item_transfer` may set `container_id` to put an item back into an open
  container; the item keeps its room location and its container association in
  session state. Distinct stocks with the same name but different placements
  stay separate. The engine rejects mixed loose and boxed stock for one item ID.
  `actor_id` on transfers and transitions selects the acting NPC; omitted means
  player. An explicitly authored condition object with
  `blocksItemInteraction: true` blocks that actor's item transfers. Legacy
  worlds without these fields retain their previous behavior. A bare prose
  mention still requires authored discovery support through P2.4c.
- **P2.5:** Linked movement requires a completed movement event for every actor
  actually moved, including an established follower brought along implicitly.
  NPC refusal and resistance use an attempted action without a movement effect;
  an in-room shove may use a completed interaction event without a mapped move.
  A persistent hold can use the existing condition effect. Personality and
  consent remain decisions made in the scene draft; the effect executor verifies
  the resulting state and receipts, rather than deriving consent from a score.
- **P4:** Add richer recipes, resource types and actor specific check resolution.
  P2.4c uses existing capability labels, check history and simple numeric
  resources; it does not define a new skill or magic system.
