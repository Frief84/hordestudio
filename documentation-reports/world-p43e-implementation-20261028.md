# P4.3e · Implementierung und Nachweise

Stand: 28.10.2026. Arbeit ausschließlich in `N:\Horde Studio\app` auf `main`; keine Commits, Pushes oder neuen Ollama-Requests.

## Implementierte Korrekturen

- `worlds/turn-binding.js`: Ein bereits besessener Gegenstand in einer Formulierung wie „I take my Cell key“ wird nicht mehr fälschlich als Aufnahme einer losen Instanz verlangt. Die Request-Abdeckung bleibt für unabhängige Schritte vollständig und geordnet. NPC-Reaktionen können mit `after_action_index` unmittelbar nach der auslösenden Spieleraktion und vor späteren Spieleraktionen ausgeführt werden.
- `worlds/effect-registry.js` und `worlds/linked-world-actions.js`: Der native Effect `npc_follow` setzt Begleitung nur bei einem passenden Escort-Event und einem eigenen, belegten NPC-Sprechertext. `following_player` ist ein lesbarer Zustandsfakt für bedingte Folgeaktionen. Automatisch mitbewegte Begleiter werden anhand der tatsächlich projizierten Bewegungen geprüft; ihre bestätigten Movement-Events werden nicht mehr als unverbunden verworfen.
- Dieselben Produktmodule: `npc_goal_set` speichert einen neu angenommenen NPC-Auftrag nur bei einem passenden Quest-Event und eigener zitierter Zusage des anwesenden NPCs. Der neue Auftrag wird im bestehenden Goal-Zustand und Goal-Pool geführt; spätere Aktionen verwenden weiter die vorhandene Goal-Engine. Ein deaktiviertes `livingWorld`-Modul blockiert diesen Effect.
- `worlds/scene-draft.js`, `worlds/turn-binding.js`, `worlds/receipt-narration.js` und `app.js`: Sprecherbelege enthalten die tatsächlichen gesprochenen Worte (`speech.quote`), nicht automatisch die gesamte Passage mit Beobachtungsprosa. Ein einzelnes eindeutiges Zitat kann strukturell extrahiert werden; unbelegte oder mehrdeutige Rede wird zur Reparatur zurückgewiesen. Gemischte Passagen erhalten keinen falschen einzelnen `speaker_id`. Receipt-Narration bewahrt die einzelnen Zitate und ihre Sprecher.
- `app.js`: Modellhinweise beschreiben die belegte NPC-Zustimmung, den persistenten Folgeeffect, die Bedingung für spätere Bewegungen und die Position einer NPC-Reaktion innerhalb eines Turns.

## Positive kontrollierte Ausführung

`scratch/world_p43e_vault_turn_audit.js` verwendet die vorhandene Vault-Welt und einen vollständigen servergebundenen Spielzug. Linda stimmt mit eigenem Zitat und Escort-Event zu. Der Spieler öffnet die Round-Room-Tür mit seinem vorhandenen Cell Key; anschließend bewegen sich Spieler und Linda in den Zielraum. Bestätigte `npc_follow`, `interactable_transition` und `actor_move` Effects, Escort-/Environment-/Movement-Events, offener Türzustand, beide Zielorte, unverändertes Spielerinventar und Save/Reload wurden geprüft. Im Verweigerungszweig bleibt die unabhängige Türöffnung erhalten; die bedingte Bewegung findet nicht statt.

Derselbe Audit prüft Lindas eigenständige Annahme eines Auftrags, die persistierte aktive Goal-Zuweisung, ihre anschließende Aufnahme des losen zweiten Cell Keys und die Türöffnung mit diesem Schlüssel in zwei getrennten Folgezuständen. Ohne eigenen Sprecherbeleg wird der behauptete Auftrag abgewiesen.

`scratch/world_p43d_action_reliability_audit.js` prüft beide absichtlich vorhandenen Cell Keys, Lindas eigene Schlüsselaufnahme und Türöffnung, Folgebewegung über einen weiteren Tick, Rollback und Save/Reload. `scratch/world_p43e_speaker_receipt_audit.js` prüft zwei Sprecher in einer Passage mit Beobachtungsprosa sowie die Receipt-Projektion. `scratch/world_server_binding_audit.js` prüft die Einfügung einer NPC-Reaktion vor einer zustimmungsabhängigen Folgeaktion und einen Verweigerungszweig. Die Browser-Binding-Regression prüft persistierte Sprecherbelege und NPC-Gedächtnis.

Nach der letzten Produktänderung bestand die vollständige World-Regressionssuite mit **28/28 Audits**, ohne Fehler oder Timeouts. Ergebnis: `scratch/world-p43e-regressions-final.json`. Darin enthalten sind die neuen Vault- und Sprecher-Audits, der Browser-Binding-Audit sowie die vorhandenen NPC-Goal-, World-Turn-, Check-, Kosten- und Persistenzaudits. Der P4.3b-Key-Duplication-Audit und der Door-Claim-Browser-Audit bestanden zusätzlich separat. `git diff --check` meldete keine Whitespace-Fehler.

## Offene Grenzen

- Die kontrollierten Vorschläge beweisen die autoritative Engine-Ausführung. Ob das lokale Sprachmodell die notwendigen Effects, Sprecherbelege und Reaction-Positionen zuverlässig selbst vorschlägt, ist ohne neue, gesondert freigegebene Ollama-Requests nicht nachgewiesen. Die gespeicherten P4.3b-Antworten A1/A2 ließen Effects aus und sind weiterhin kein positiver Modellnachweis.
- Die kontrollierte Annahme und zwei autoritative NPC-Goal-Folgeschritte sind belegt. Eine selbständige Wahl der nächsten Goal-Aktion durch ein lokales Sprachmodell und ein kompletter neuer Vault-Auftrag mit freier Modellplanung wurden nicht ausgeführt.
- `request_coverage_mismatch` bleibt eine korrekte Ablehnung, wenn ein Vorschlag echte Teile des Spielerwunsches auslässt. Die nachgewiesenen Ursachen bei besessenem Schlüssel und nicht einfügbarer NPC-Reaktion wurden korrigiert; eine zuverlässige Abdeckung durch das Modell ist offen.

P4.3e ist damit als Engine-Korrektur mit kontrollierten positiven Nachweisen fortgeschritten, aber nicht als vollständig live modellvalidierte Abnahme abgeschlossen.
