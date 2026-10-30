# P4.3f – lokale Multi-Aktions- und Modellprüfung

Stand: 28.10.2026. Alle Änderungen, Tests und Rohdaten liegen in `N:\Horde Studio\app`. Es wurden keine Repository-Aktionen und keine Veröffentlichung ausgeführt.

## Produktkorrekturen

- `worlds/turn-binding.js` und `app.js`: Bei zusammengesetzten Eingaben ist `actions[].request` im Modell-Schema verpflichtend. Der Reparaturhinweis verlangt wörtliche, geordnete Ausschnitte ohne ausgelassene Handlung. Eine einzelne Redeaktion darf eine spätere eigene körperliche Handlung nicht mehr als erledigt verdecken; umgekehrt darf eine körperliche Aktion eine nachfolgende gesprochene Frage nicht verschlucken.
- Direkte Tänze, Halte-, Fessel- und Freigabehandlungen müssen als körperliche Spieleraktionen klassifiziert werden. Die Modellanweisung nennt die passenden Bedingungs- und Aktivitätsbelege.
- Erkennbare zitierte NPC-Rede benötigt einen Sprecherbeleg, auch bei zwei benannten NPCs. Ist ein einzelner Beleg vorhanden und weicht sein Zitat ausschließlich in der Endzeichensetzung von der einzigen sichtbaren Rede ab, wird er an den sichtbaren Wortlaut angepasst; das gilt auch für einfache Anführungszeichen mit Kontraktionen. Andere Abweichungen bleiben Ablehnungen.
- Ein `actor_at`-Fakt, der einen eindeutig registrierten Gegenstand bei einem bekannten Besitzer behauptet, wird in den passenden `has_item`-Fakt übersetzt. Bei gleichnamigen Gegenständen findet diese Umdeutung nicht statt.
- `scratch/world_linked_ollama_live_audit.js` speichert lokale Modellantworten und Bindungsergebnisse für die Diagnose. Zusätzliche lokale Fälle decken Multi-Aktion, Tanz sowie Kontakt mit anschließender Frage ab.

## Kontrollierte Node- und Browser-Nachweise

`scratch/world_server_binding_audit.js` prüft nun insbesondere den verschluckten Tanz, die verschluckte Anschlussfrage, das verpflichtende Request-Feld, fehlende NPC-Sprecherbelege und die begrenzte Zitatkorrektur. `scratch/world_linked_execution_audit.js` führt Festhalten, Fesseln, Loslassen und Tanzen als Zustandskette aus. Der vorhandene Vault-Audit behält die Prüfung einer ungestützten NPC-Auftragsannahme bei, wobei das nicht belegte Zitat bereits vor der Engine-Ausführung entfernt wird.

Die vollständige World-Suite enthält 28 Audits. Der finale Lauf steht in `scratch/world-p43f-regressions-final.json`.

## Echte lokale Ollama-Züge

| Fall | Ergebnis | Lokale Rohdaten |
| --- | --- | --- |
| Linda warten lassen, dann Hände zu halten versuchen, Qwen 2.5 | Ein Lauf wurde mit zwei getrennten Ergebnissen gespeichert: Rede erfolgreich, körperlicher Versuch fehlgeschlagen. Ein früherer Lauf ohne Request-Belege wurde korrekt abgewiesen. | `scratch/world-p43f-live-a2-after.json`, `scratch/world-p43f-live-a2-diagnostic.json` |
| Linda einladen, Schlüssel nehmen und gemeinsam gehen, Qwen 2.5 | Request-Belege wurden nach der Schemaänderung geliefert. Das Modell behauptete aber Schlüsselaufnahme und Ankunft ohne `item_transfer` und `actor_move`; die Engine wies den Zug mit `action_outcome_mismatch` ab und speicherte nichts. | `scratch/world-p43f-live-multi-after.json` |
| Rede plus eigener Tanz, Qwen 2.5 | Ein früherer, fälschlich als reine Rede gespeicherter Zug reproduzierte eine Abdeckungslücke. Nach der Korrektur wurden unvollständige Entwürfe abgewiesen; kein falscher Tanz wurde gespeichert. | `scratch/world-p43f-live-dance.json`, `scratch/world-p43f-live-dance-punctuation.json` |
| Hände halten, loslassen und Tanzfrage, Qwen 2.5 | Das Modell fasste körperliche Aktion und Anschlussfrage zusammen und behauptete Erfolg ohne Beleg. Die Engine wies den Zug mit `unverified_action_success` ab; Live- und gespeicherter Zustand blieben unverändert. | `scratch/world-p43f-live-contact-final.json` |
| Einladung, Schlüssel und gemeinsame Bewegung, Gemma 4 | Die lokale Anfrage überschritt das Fünf-Minuten-Limit. Es wurden keine World-Änderungen gespeichert. | `scratch/world-p43f-live-multi-gemma4.json` |
| Einladung, Schlüssel und gemeinsame Bewegung, Qwen 3.5 27B | Die lokale Ollama-Anfrage überschritt das gesetzte Vier-Minuten-Limit, bevor ein Vorschlag vorlag. Es wurden keine World-Änderungen gespeichert. | `scratch/world-p43f-live-multi-qwen35.json` |
| Linda mit vorhandenen Stahlhandfesseln fesseln, Qwen 2.5 | Mehrere Live-Versuche produzierten fehlende Bedingungsfelder, einen falsch verwendeten Item-Ortsfakt oder nicht im sichtbaren Text enthaltene Sprecherzitate. Der konkrete Bedingungs-Reparaturhinweis und die eindeutige Besitzfakt-Normalisierung wurden ergänzt. Der letzte Vorschlag blieb wegen unbelegter Rede abgewiesen; kein Zustand wurde gespeichert. | `scratch/world-p43f-live-handcuffs.json`, `scratch/world-p43f-live-handcuffs-after.json`, `scratch/world-p43f-live-handcuffs-final.json` |

## Offene Grenze

Ein neuer vollständiger natürlicher Live-Zug, in dem das Modell selbst NPC-Zustimmung, Sprecherbeleg, Gegenstandstransfer und gemeinsame Bewegung mit allen Effects korrekt liefert, ist weiterhin **nicht nachgewiesen**. Die kontrollierte Engine-Ausführung aus P4.3e besteht; P4.3f verbessert die Abdeckung und verhindert die reproduzierten falschen Commits, löst die fehlenden Modell-Effects aber noch nicht. Die lokalen Gemma- und Qwen-3.5-Timeouts erlauben keine Aussage über die fachliche Qualität dieser Modelle in diesem Fall.
