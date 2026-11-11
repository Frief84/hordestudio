# World Engine: gezielte Stabilisierung am lokalen Stand (2026-11-04)

## Ausgangslage

- Repository: `N:/Horde Studio/app`, Ausgangs-Commit `2be5ee94089a919d8a68998e2ecf414c439a5b3a`.
- Auf ausdrücklichen Wunsch des Nutzers erfolgte die Arbeit auf dem vorhandenen lokalen `main`. Ein kurz angelegter, unbenutzter Branch wurde wieder entfernt.
- Vor Beginn lagen zahlreiche nicht committete Änderungen vor, auch in `app.js`, `worlds/turn-binding.js` und `worlds/linked-world-actions.js`. Diese wurden nicht zurückgesetzt.
- Vor Änderungen bestanden: `world_linked_contract_audit.js`, `world_scene_draft_audit.js`, `world_linked_execution_audit.js`, `world_linked_hardening_audit.js`, `world_receipt_repair_budget_audit.js`.

## Nachgewiesene Ursachen und Änderungen

1. Das servergebundene Transport-Schema erwartet Speech-Einträge im Antwortabsatz. Ein Modell-Eintrag unter `actions[i].speech` wurde daher mit `unsupported_bound_field` abgelehnt. Der Binder verschiebt diese Einträge nur bei genau einem Antwortabsatz dorthin; danach gelten unverändert Schema- und Referenzprüfung. Bei mehrdeutiger Zuordnung bleibt die Antwort ungültig.
2. Der Compiler verlangte mindestens einen Speech-Listener. Eine Äußerung ohne anwesenden Zuhörer ist nun mit `listeners: []` zulässig und erzeugt keine erfundene NPC-Beobachtung. Unbekannte Listener werden weiter abgelehnt.
3. Die Request-Coverage-Heuristik behandelte mehrere Sätze einer einzigen Speech-Action als mehrere unbelegte Weltaktionen. Eine Sprach- oder Frageaktion wird nur dann von genau dieser Heuristik ausgenommen, wenn ein zugehöriger Speech-Eintrag mit Spieler-Sprecher und wörtlichem Zitat aus der Eingabe vorliegt. Ein Sprachlabel ohne solchen Beleg kann spätere körperliche Handlungen weiterhin nicht verschlucken.
4. Ein Modell konnte einen gewöhnlichen, mit `movement_mode: voluntary` belegten Spielerraumwechsel im Effect fälschlich `mode: teleport` nennen. Der Binder entfernt dieses widersprüchliche Effect-Label nur bei einem passenden abgeschlossenen freiwilligen Bewegungsereignis. Der bestehende Reducer prüft danach Route, Zugang und Reisezeit. Ein ausdrücklich belegter Teleport bleibt Teleport; unverbundene Routen werden blockiert.
5. Die lokale Linked-Action-Ausgabe unterdrückte bereits bestätigte Blockierungen und Klärungsfragen. Deren Passagen werden jetzt angezeigt, sofern die zugehörige Action auch als `blocked` beziehungsweise `needs_clarification` deklariert ist. Ein bloß fehlgeschlagener Erfolg wird dadurch nicht als Erfolg erzählt.

## Tests

Die neuen, zuvor fehlgeschlagenen Tests `world_speech_contract_regression.js` und `world_direct_move_contract_regression.js` bestehen. Sie prüfen unter anderem Quelltext-Erhalt, leere und unbekannte Listener, Spieler-Persona-Referenzen, vier Anführungszeichenvarianten, längere Rede, freiwillige Bewegung, echte Teleport-Belege und blockierte Routen.

Nach den Änderungen bestanden zusätzlich: `world_server_binding_audit.js`, `world_scene_draft_audit.js`, `world_linked_contract_audit.js`, `world_linked_execution_audit.js`, `world_linked_hardening_audit.js`, `world_linked_generalization_audit.js`, `world_receipt_repair_budget_audit.js`, `world_linked_chain_browser_audit.js` und `world_scene_draft_browser_audit.js`. Der Server-Binding-Audit und Browser-Audits benötigten Prozessstart außerhalb der eingeschränkten Sandbox. `node --check` bestand für alle drei geänderten World-Module.

`world_linked_turn_browser_audit.js` stoppt bei einer Erwartung, dass `resource_cost` im Provider-Schema steht. Die lokale Registry führt diesen Effect als Engine-Effekt, das Provider-Schema nicht. Der Audit erreicht deshalb die späteren Assertions nicht. Dieser Befund wurde weder als bestanden noch als Regression der obigen Änderungen gewertet.

## Grenzen

- Live-Modelle und weitere Provider wurden nicht ausgeführt. Für Modelllaufzeiten und Tokenverbrauch liegt kein belastbarer Vorher-Nachher-Vergleich vor.
- Reale World-Saves wurden nicht verändert und in diesem Lauf nicht separat auf Kopien fortgesetzt. Die bestandenen Browser-Audits prüfen Commit und Wiederladen mit Test-Welten; bestehende V2-/V3-Belege werden durch die bestandenen Contract- und Scene-Draft-Audits geprüft.
- Die genannten Korrekturen decken konkrete gemeinsame Vertragsbrüche ab. Eine vollständige Freigabe aller geforderten Multi-Action-, Narrations-, Reparatur-, Diagnose- und Provider-Szenarien ist damit noch nicht nachgewiesen.
