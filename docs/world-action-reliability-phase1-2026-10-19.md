# World Action Reliability – Phase 1 (19. Oktober 2026)

## Bestehender Pfad

| Stufe | Schnittstelle und Aufgabe |
| --- | --- |
| Modellvertrag | `app.js:32584-32664` baut den V3-Vertrag aus `worlds/effect-registry.js:71` und `worlds/scene-draft.js:120`, dann den verschachtelten Transport aus `worlds/turn-binding.js:23`. Der Prompt verlangt für reine Gesten `effects:[]`, für dauerhafte Änderungen typisierte Effekte. |
| Bindung | `app.js:33118-33138` sendet Modellvorschlag, Originaleingabe, Zeit und kanonisches Schema an `/worlds/bind-turn` (`horde_mcp_bridge.py:4334`). `worlds/turn-binding-worker.js` erzeugt eine stabile Turn-ID. `worlds/turn-binding.js:103-299` prüft Form und Eingabeabdeckung, kann effektfreie Gesprächsteile zusammenführen, vergibt Action-/Passage-IDs und bindet Events an ihre Passagen. |
| Validierung und Ausführung | `worlds/scene-draft.js:596` kompiliert den gebundenen Draft und prüft Links, Ereignisse, Status, Zeit und Effekte. `worlds/linked-world-actions.js:379` prüft Guards und Effektzeugen und führt nur registrierte Operationen auf `worlds/working-state.js:29` aus. Der Kandidat wird erst nach erfolgreicher Persistierung veröffentlicht (`worlds/working-state.js:203`, `app.js:3229`). Fehler gehen in die begrenzte Modellreparatur; der Turn bleibt bis zum Commit ungespeichert. |

Actions ordnen Spieleranfrage und Antwort zu. Events bezeugen abgeschlossene Vorgänge mit Action- und Passage-Bezug. Effects sind typisierte, potenziell dauerhafte Operationen; ihre Fähigkeiten und Schemas kommen aus der Registry, nicht aus freier Prosa. `reactions` tragen eigenständige NPC-/Weltaktionen. Die Binding-Schicht ist daher die Grenze zwischen Modelltransport und kanonischem V3-Draft.

## Reproduktion und Ursache

`scratch/world_gesture_effect_repro_audit.js` verwendet die vollständige Aslan-Eingabe aus `scratch/world_server_binding_browser_audit.js:189-198`: Wahl der Schulter statt Tasche, ausführlicher Dialog, Blick/Geste und Bitte an Lorne um eine helfende Hand. Ein strukturell gültiger Modellvorschlag beantwortet sie mit „Lorne offers his hand to Aslan“, klassifiziert die einzige Action als `gesture` und setzt zugleich `relation_set(lorne, aslan, 50)`.

`binding.validate` akzeptiert die Form. `binding.bind` bindet die eine Action an die **ganze** Eingabe (`worlds/turn-binding.js:194-213`), normalisiert den nichtleeren Effekt und lehnt in `append` ab (`worlds/turn-binding.js:215-227`): `{reason:'gesture_has_world_effects', detail:'actions.0.effects'}`. Ein kanonischer Draft entsteht nicht; Compiler, Reducer und Persistenz werden für diesen Vorschlag nicht erreicht. Derselbe Vorschlag mit `effects:[]` bindet erfolgreich. Die Browser-Fixture bestätigt anschließend die vorhandene Modellreparatur mit einem effektfreien Vorschlag und einem gespeicherten Turn. Dies reproduziert die Fehlerklasse deterministisch; ein ursprüngliches historisches Provider-JSON liegt nicht vor, daher ist `relation_set` eine vorhandene, plausible Test-Fehlform und kein behauptetes Original.

Der Widerspruch entsteht zwischen Aktionsklassifikation und Effektzuordnung: `gesture` bezeichnet eine nicht dauerhafte Interaktion; `relation_set` verlangt eine dauerhafte Beziehungsmutation. Das Transportschema erlaubt technisch `effects` auch bei `gesture`; die semantische Schranke liegt später in `bind`. Die vorhandene Zusammenführung geteilter Gesprächsaktionen greift nur bei durchweg effektfreien Teilen (`worlds/turn-binding.js:175-192`).

## Ausgeführte Audits

Bestanden: neuer isolierter Audit; `world_server_binding_audit.js`, `world_server_binding_http_audit.py`, `world_server_binding_browser_audit.js`, `world_linked_contract_audit.js`, `world_linked_hardening_audit.js`, `world_linked_execution_audit.js`, `world_linked_generalization_audit.js`, `world_scene_draft_audit.js`, `world_action_resolution_audit.js`, `world_linked_turn_browser_audit.js` und `world_receipt_repair_budget_audit.js`. Node-Syntaxprüfung des neuen Audits bestand. Für Browser/HTTP wurden die bereits vorhandenen gebündelten Playwright-/Python-Laufzeiten und lokales Chrome verwendet; kein realer Modellanbieter wurde aufgerufen.

Ausführung des neuen Tests: `node scratch/world_gesture_effect_repro_audit.js`. Er erwartet die Ablehnung und beendet sich erfolgreich; die CI erhält keinen absichtlich roten Test. Produktive Action-, Effect- und Reparaturlogik blieb unverändert.

## Hypothesen und nächste Phase

Gemeinsam mögliche Ursachen, noch nicht als Provider-Ursache bewiesen: (1) das Modell zerlegt einen zusammenhängenden Gesprächszug in Geste und mechanische Handlung; (2) ein sozialer Ausdruck wie das Handangebot wird ohne belegte Zustandsänderung als Beziehungswert interpretiert; (3) eine NPC-Reaktion wird der Spieler-Action statt `reactions` zugeordnet; (4) Schema-Freiheit und Prompt-Regel erzeugen unterschiedliche Erwartungen über gültige `kind`-/`effects`-Paare. Diese Hypothesen mit mehreren Welt- und Effektarten prüfen und daraus eine allgemeine Zuordnungsregel zwischen Anfrage, Akteur, Wirkung, Event und Action ableiten. Erst danach Korrekturentwurf und Regressionen festlegen; keine Sonderbehandlung für Aslan oder bestimmte Wörter.
