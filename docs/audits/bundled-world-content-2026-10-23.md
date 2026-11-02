# Bundled world content audit — 23 October 2026

Audited and updated the four worlds shipped in this checkout: Vaelora, Bellwether 2005, The Shattered Crown of Aldenmere, and Policy Panic at Bramble & Pike. The previously reported Greenfield and Bitterroot/Den worlds are not among this checkout’s four bundled definitions; their private/imported content was not available for this audit.

## Confirmed defects and changes

| World | Findings | Changes |
| --- | --- | --- |
| Vaelora: The Living Realm | Thorn King’s Ruins had two exits but no entrance. The manor road lacked its return link. Five initial NPC locations disagreed with their opening-time schedules. Several role openings described a different place from the selected start. The sovereign role could leave a second monarch active. | Added three explicit return routes with the authored travel times. Aligned the five NPC spawn points with their schedules. Rewrote five role openings around their actual places, messages and immediate decisions. The monarch NPC is represented by the player when the sovereign role is selected. |
| Bellwether, 2005 — A Suburban Life | 56 specialist NPCs lacked homes and overnight blocks, so a final park/council/work appointment could remain active into the next morning. Some openings skipped to lunch, contradicted the 07:00 clock, or placed unregistered role actors in the foreground. The mayor role duplicated the town’s mayor NPC. | Added 56 named, connected homes, bringing the map to 299 places. Added overnight and evening blocks, including distinct day/late-shift returns. Revised all 15 role openings to stay in the selected place and immediate morning, with messages/physical clues in place of unsupported arrivals. The mayor NPC is represented by the player in the mayor role. |
| The Shattered Crown of Aldenmere | The funeral opening depicts the priestess and merchant in the square, but their initial locations/routines put them elsewhere. The opening also gives the newcomer local facts without a source. | Started Rowena and Quill in the square with matching morning blocks. Provided the reeve’s identity, reported fall and mine-delivery history through visible notices instead of unexplained player knowledge. |
| Policy Panic at Bramble & Pike | Eight NPC homes and the main branch building lacked incoming links despite outward exits marked as two-way. All seven starting roles had empty intros and inherited the reception opening, including roles starting in the Claims Cave, Bullpen, Supply Closet and Denton’s Office. The receptionist-cover description says Gloria is away while her canonical state puts her at the desk. | Added ten explicit reverse links. Wrote seven place/role-specific openings. Changed the default opening’s unregistered arriving examiner into a commission fax; the examiner role now makes the player that official. The temporary cover begins with Gloria’s handover, and the cleaner’s morning opening explicitly follows an overnight shift. |

Original Bramble & Pike embedded artwork and banner bytes were preserved. Both its included JavaScript bundle and downloadable `.horde_world` were updated; the source builder also applies the same content revision.

## Existing installations

`assets/worlds/bundled-content.js` applies content revision 1 at startup. The revision is independent of the World schema and does not require reimporting built-in worlds.

- Records update only when their changed fields match the old shipped values or already match the repaired values. Customized records are skipped.
- Exit repairs append missing links after comparison; they preserve existing exit records, generated door IDs and custom metadata. Changed locks, costs, routes or other authored exit data prevent the default array patch from replacing that record.
- Added homes require their parent street to still exist. Deleted anchors are not recreated. NPC home/schedule changes require the new home to be available.
- The migration does not write campaign sessions, snapshots, history, clock, inventory or NPC positions. Opening text affects new sessions; an already-played opening is not rewritten.
- Content revisions are idempotent. Skipped records are reported in the development console. Unexpected older/custom text is retained rather than guessed at.
- `playerOriginIds` suppresses an NPC’s separate presence only in a session whose selected origin represents that character. Other roles and timelines retain that NPC. This resolves the sovereign/mayor duplicate-role problem without deleting the template actor or its saved state. The model also receives an explicit role-embodiment instruction, with the player’s chosen name and pronouns taking precedence.

Restart the application/bridge and refresh the UI to load the new static asset and updated templates. No release, commit or push was performed.

## Verification

- Pure content audit: all four maps and every starting origin reach every mapped location; exit/parent IDs, NPC schedule references and commute paths resolve. All 332 scheduled/cast NPC initial positions agree with their applicable opening-time block where one exists.
- Migration audit: all four pre-update fixtures upgrade without skipped stock records. Reapplying is a no-op. Customized openings/routes remain unchanged; removed streets are not restored. Sovereign and mayor actor visibility remains session-specific.
- Browser audit: 38 combinations (34 authored roles plus four defaults), each using the actual introduction path and a first look through the real turn pipeline. All stay at the intended location, accept the mocked one-call scene, and produce no rejected receipt. Aldenmere’s funeral cast and both unique-role exclusions are checked explicitly.
- Actual browser startup/reload test: a disposable existing Bramble campaign retains its clock, turn count, bonus time, inventory, last story entry, player position and pinned NPC position while the stock home route is repaired.
- Existing Bellwether life-simulation, World Lore, scene-draft and Worlds conversation-recovery suites pass.
- Migration data reproducibility: `node scratch/build_bundled_world_content.js --check` agrees with the current templates and compact pre-update fixture.
- The actual bridge serves the cache-busted content module with HTTP 200 and JavaScript content type. JavaScript/Python syntax, Git whitespace checks, and preservation of embedded artwork pass.

Model replies in these tests are mocked. These results cover template/state consistency and migration, not live-provider prose quality or every emergent campaign outcome.
