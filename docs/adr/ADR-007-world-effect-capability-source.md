# ADR-007: Autoritative Quelle für World-Effektfähigkeiten

Status: angenommen (16. Oktober 2026)

## Befund im lokalen Projektstand

Der lokale Commit `f7bd773` änderte in `app.js` die Ermittlung von
`legacyEffectKeys`: Für verknüpfte Turns las der Executor danach die Schlüssel
aus `worldStateTool.function.parameters.properties.actions.items.properties.action_effects.properties`
statt aus den bisherigen Top-Level-`effects.properties`. Sein Regressionstest
belegte, dass `npc_relationship_updates` an den Legacy-Reducer weitergereicht
wird. Der Diff belegt die Kopplung an die verschachtelte Struktur eines
generierten Provider-Schemas; er belegt **nicht**, dass ein bestimmter Provider
oder eine bestimmte Migration tatsächlich eine leere Schlüsselmenge erzeugt hat.

Die Fehlerklasse entsteht, weil das Provider-Schema ein Transportartefakt ist:
Es wird aus dem World-Vertrag aufgebaut und anschließend für Protokoll,
verknüpfte Aktionen und Provideranforderungen umgeformt. Ein anderer
Schema-Pfad oder eine zulässige Transformation kann deshalb die vom Executor
abgelesenen Schlüssel verändern, ohne die ausführbaren Operationen zu ändern.
Eine leere Ableitung könnte so unbemerkt alle Effekte abschalten.

## Entscheidung

`worlds/effect-registry.js` hält die technischen Definitionen, Schemas,
Protokoll-/Modusfreigaben und Operationsbindungen. `capabilities()` erzeugt
für einen Turn einen expliziten Fähigkeitsvertrag mit Namen, Schemas, Quelle
und Operationszuordnung. Native Definitionen werden dort registriert;
`worlds/linked-world-actions.js` bindet ihre vorhandenen Validierer und
Reducer an diese Definitionen. Legacy-Felder werden als Adapter aus
`worldStateProperties` des bestehenden World-Vertrags übernommen und über
`processStructuredActions` ausgeführt. `checks` bleibt die gesonderte
`requestPendingCheck`-Operation. Narrative und rein abgeleitete Felder wie
`npc_observations` und `world_events` sind keine frei ausführbaren Effekte.

`worlds/scene-draft.js` erzeugt `action_effects` aus demselben Vertrag,
vergleicht bei übergebenem Vertrag dessen Schlüssel gegen die eigene
Schemaableitung und validiert Vorschläge vor der Ausführung. `app.js` übergibt
den Vertrag an Schema, Compiler und Executor. Das Provider-Schema kann für
Transportzwecke verändert werden, dient aber nicht mehr als Quelle der
Executor-Fähigkeiten. Der Executor prüft jede Operation nochmals gegen den
Vertrag; unbekannte oder nicht freigegebene Effekte liefern strukturierte
Diagnosen einschließlich Effekt, Protokoll, Modus, verfügbaren Fähigkeiten,
Quelle und Phase.

Eine absichtlich effektfreie Welt deklariert `kernel.effectMode: "effect_free"`;
der Vertrag erhält dann den Status `intentionally_effect_free` und eine leere
Liste. Liefert die normale Ableitung ohne diese Deklaration keine Fähigkeiten,
bricht sie mit `derived_from_empty_schema` ab. Dadurch ist ein unerwartet
leerer Vertrag keine stillschweigende Spielregeländerung.

## Ausführung und Kompatibilität

Die bestehenden Legacy-Reducer und V2-Drafts bleiben als Adapter erhalten.
Ein V3-Turn verlangt verknüpfte Aktionen; die vorhandenen Speicherstands- und
Schema-Upgrades bleiben zuständig für ältere World-Daten. Weder eine neue
handlungsspezifische Textanalyse noch ein zweiter Satz technischer
Effektdefinitionen wird für die verknüpfte Ausführung benötigt.

`worlds/working-state.js` sammelt direkte und indirekte Änderungen in einem
Kandidaten. Ein unerwarteter Validierungs-, Compiler- oder Reducerfehler sowie
ein Persistenzfehler verwirft den gesamten Kandidaten. Ein regelkonform
blockierter späterer Schritt wird auf seinen Savepoint zurückgesetzt; zuvor
bestätigte Teilschritte können innerhalb desselben gültigen Receipts bleiben.
Ein `succeeded` für eine dauerhafte technische Handlung verlangt einen
ausgeführten, validierten passenden Effekt. Eine nicht dauerhafte körperliche
Interaktion verlangt stattdessen ein abgeschlossenes Spielerereignis mit
genauem Aktions- und Antwortbezug. Sprachliche Handlungen können ohne
technischen Effekt beantwortet werden, wenn Spieleranfrage und Antwortpassage
strukturell verbunden sind. Text und behaupteter Status allein ändern keinen
Weltzustand.
Für vollständig zitierte Spielerrede verwirft der Compiler ein fälschlich
abgeschlossenes mechanisches Ereignis nur, wenn es keinerlei zustandsrelevante
Payload und keinen ausführbaren Effekt hat. Diese begrenzte Korrektur wird im
Receipt-Audit gezählt. Ein Ereignis mit Zustandsinhalt bleibt gesperrt und
erhält im Executor eine Diagnose mit Ereignisindex, Typ und benötigten
Effekten; die Reparaturanweisung kann es gezielt korrigieren.

## Absicherung

- `scratch/world_linked_hardening_audit.js` prüft Vertragsgleichheit, dynamische
  Registrierung, leere Modi, strukturierte Fehler, unbewiesene Erfolge,
  Transaktionsgrenzen, Folgeeffekte, Teilhandlungen und einen gespeicherten
  synthetischen Snapshot.
- `scratch/world_linked_contract_audit.js`,
  `scratch/world_linked_execution_audit.js` und
  `scratch/world_scene_draft_audit.js` prüfen verknüpfte und Legacy-Verträge,
  Compiler und Ausführung.
- `scratch/world_linked_turn_browser_audit.js` und
  `scratch/world_linked_chain_browser_audit.js` prüfen Browserturns,
  native und Legacy-Schlüssel im tatsächlich versendeten Provider-Schema,
  dauerhafte Speicherung, Neuladen, Weiterspielen und Fortsetzung einer
  gültigen Teilhandlung.
- `scratch/world_schema_migration_audit.js` und
  `scratch/worlds2_storage_migration_browser_audit.js` schützen ältere
  World-Strukturen und gespeicherte Sitzungen.

Die Tests beweisen die genannten lokalen Pfade. Sie sind kein Beleg für das
Verhalten aller Provider oder jeder extern erzeugten Spielstanddatei.
