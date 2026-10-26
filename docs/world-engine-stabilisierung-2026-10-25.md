# World Engine: Stabilisierung und Nachtests (25.10.2026)

## Ergebnis

Die Korrekturen wurden direkt in den lokalen Projektdateien umgesetzt. Die Linked-World-Pipeline behält isolierten Working State, Effektvalidierung und atomaren Commit. Fehlgeschlagene Spielzüge lassen den maßgeblichen Zustand unverändert.

## Nachgewiesene Ursachen und Korrekturen

| Ursache | Korrektur | Nachweis |
| --- | --- | --- |
| Gemma liefert teils einen Text oder ein Einzelobjekt statt `actions[].response[]`, Modell-IDs und ausgeschriebene Namen statt IDs. | `worlds/turn-binding.js` normalisiert eindeutige Struktur, verwirft Engine-eigene Links und löst nur eindeutig registrierte Namen auf. Pflichtfelder und unbekannte Felder bleiben streng validiert. | `world_server_binding_audit.js` |
| Ein einzelner Wunsch wurde als Hauptaktion plus effektfreie Folgeaktion oder als bis zu 32 reine Punkt-Aktionen ausgegeben. | Das Binding entfernt nur eindeutig leere Platzhalter und hängt bei einem konservativ erkannten Einzelwunsch effektfreie Fortsetzungen an die erste Antwort. Bei mehrteiligen Eingaben bleibt die vollständige Teilaktionsabdeckung Pflicht. | Originale T03-Diagnosen und Binding-Audit |
| Ein Reparaturentwurf verwendete einen eindeutigen Anzeigenamen statt der ID eines bereits bestätigten Effekts. | `repairLosses` vergleicht solche Referenzen nach eindeutiger Auflösung; mehrdeutige Namen können keinen bestätigten Effekt ersetzen. | Binding-Audit |
| Ein Transfer wurde mit `has_item` für den erst zu erwerbenden Gegenstand als Vorbedingung versehen. | Das Binding entfernt nur diese exakt durch denselben Transfer erzeugte Nachbedingung. Eine wirkliche Besitzvorbedingung beim Weggeben bleibt erhalten. | Binding-Audit und Live-Test T03 |
| Das Modell schlug einen typisierten `item_transfer` ohne Inventarereignis vor, wodurch ein zweiter Modellaufruf nötig wurde. | Für einen registrierten, eindeutig im Antwortabsatz genannten Gegenstand erzeugt das Binding das passende Spieler-Inventarereignis aus dem ausdrücklichen Transfer. Der Reducer prüft Quelle, Besitz und Erreichbarkeit weiterhin vor dem Commit. | 190er-Matrix und Live-Test T03; fehlender Effekt bleibt abgelehnt |
| Ältere NPC-Inventare speichern Anzeigenamen, Effekte verwenden Objekt-IDs. | `worlds/linked-world-actions.js` löst die Quelle auch über den registrierten Anzeigenamen auf und erhält Mengen-/Besitzkonsistenz. | 3-Züge-Folge und Bestands-/Erreichbarkeits-Audits |
| Reparaturprompts enthielten Raumgegenstände, aber nicht das Spieler- oder NPC-Inventar. | Der Reparaturkontext enthält nun beide Inventare als maßgebliche Daten. Die erste Handfessel-Diagnose zeigte den konkreten Fehlschluss „nicht getragen“, obwohl Handfesseln im Inventar waren. | Browser-Reparaturprompt-Audit; F12 nach Korrektur ohne Reparatur gespeichert |
| Gemma 4 erzeugte über Ollama lange versteckte Reasoning-Ausgaben, obwohl World-Reasoning ausgeschaltet war. | Für lokale Gemma-4-World-Turns ohne aktiviertes Reasoning wird `reasoning_effort: none` gesetzt. Aktiviertes World-Reasoning bleibt möglich. | Lokaler API-Vergleich und fünf abschließende Live-Fälle |
| `pending_check` ohne `effects.checks` wurde von Reparaturen wiederholt; körperliche Versuche wurden als Sprache bezeichnet. | Die Korrekturanweisung nennt den richtigen Bound-Feldpfad und die sichere Alternative `physical/attempted`; der Hauptprompt trennt körperliches Führen/Ziehen von gesprochenen Bitten. | T06 und T08 ohne Reparatur gespeichert |
| Ein Aufruf an einen abwesenden NPC wurde als unbestätigte Antwort aus dem Nebenraum erzählt. | Haupt- und Reparaturprompt erklären die bestehende Anwesenheitsregel unmittelbar. Ohne bestätigte Ankunft erscheint keine NPC-Antwort. | F14 nach Änderung ohne Reparatur gespeichert; Linda blieb im Foyer |
| NPC-Sprechernamen wurden im Classic-Modus nicht gerendert; beim Wechsel zu Cinematic wurden DOM-Knoten wiederverwendet. | Strukturierte Sprecherzuordnungen gehen auch im Classic-Modus an den Narrativ-Renderer. Moduswechsel rendert Nachrichten neu; Sprecherzuordnungen gehören zur Render-Signatur. | Browser-DOM-Test: Lorne/Aslan, gemischte Absätze, beide Modi; gleiche Segmentierung für Kokoro |
| Ein festes Hosted-Turn-Zeitlimit beendete auch fortschreitende Antworten. | Der Leerlauf-Timer beginnt nach jeder inhaltlichen Stream-Nachricht neu; Keepalive-Daten setzen ihn nicht zurück. Zusätzlich gilt auf ausdrücklichen Wunsch eine harte Obergrenze von fünf Minuten pro World-Zug, auch bei aktivem Stream und Reparaturaufrufen. | `worlds2_hosted_turn_deadline_browser_audit.js` |

## Regression und echte Modellläufe

`scratch/world_general_turn_matrix_audit.js` führt **190 verschiedene automatisierte Spielzüge** in zehn Genres und 19 Kategorien durch, darunter DE/EN, Dialog, zwei NPCs, Tippfehler, lokale und kartierte Bewegung, unbekannte Gegenstände, Aufnehmen/Übergeben, Zeichnen, ein dauerhaft beschriebenes Skizzenbuch, Tisch/Tasse als zusammengesetzte Aktion und eine dreistufige Besitzfolge. Jeder Zug durchläuft Binding, Compiler, Linked-Reducer, Working State und Commit. Die Varianten verwenden kontrollierte Modellentwürfe, nicht 190 Gemma-Aufrufe.

Weitere grüne Prüfungen: `world_server_binding_audit.js`, `world_server_binding_browser_audit.js`, `world_presentation_reliability_audit.js` (13 Prüfungen), `world_linked_execution_audit.js`, `world_scene_items_audit.js`, `world_turn_context_audit.js`, `world_linked_generalization_audit.js`, `world_physical_reachability_audit.js`, `world_linked_hardening_audit.js`, `world_p41_universal_checks_audit.js` und `worlds2_hosted_turn_deadline_browser_audit.js`. Der Browser-Test prüft sichtbare `.msg-text`, Rollback und erneutes Laden.

Abschließende lokale Läufe mit `gemma4:31b-it-q4_K_M` (je ein Modellaufruf, keine Modellreparatur, gespeichert):

| Fall | Modellzeit | Ergebnis |
| --- | ---: | --- |
| T03: Schlüssel aufnehmen | 13,6 s | Schlüssel im gespeicherten Inventar; Transfer und Ereignis bestätigt |
| T06: Lindas Hände festhalten | 10,8 s | `physical/attempted`; kein erfundener Fesselzustand |
| T08: Linda in anderen Raum bringen | 10,9 s | `physical/attempted`; beide bleiben am Ausgangsort |
| F12: Handfesseln verwenden | 7,9 s | Handfesseln bleiben im Inventar; Linda weicht aus |
| F14: abwesende Linda rufen | 11,0 s | gesprochener Ruf ohne erfundene Antwort oder Ankunft |

Mittelwert der **Modellzeit** dieser fünf Fälle: **10,8 s**, Median **10,9 s**. Ein separat gemessener vollständiger T03-Spielzug benötigte **15,0 s**: 14,5 s Modellzeit, 5 ms lokale Validierung und etwa 0,6 s übriger Client-/Speicherpfad. Aufbau und Persistenz werden derzeit nicht vollständig getrennt instrumentiert. Der Befund gilt für diese kleine lokale Testwelt und Hardware; andere Welten oder aktiviertes Reasoning können deutlich länger dauern. Vor der Optimierung benötigte ein gültiger T06-Aufruf 250 s; ein T03-Basislauf brauchte zwei Modellaufrufe und rund 82 s Generierungszeit.

**Laufzeitvorgabe:** Ein gewöhnlicher vollständiger Spielzug soll unter drei Minuten bleiben. Die fünf Minuten sind ein Abbruchlimit, kein Leistungsziel. Nach Ablauf wird der Modellaufruf abgebrochen; bei einem Linked-World-Zug vor dem Commit bleiben der maßgebliche Weltzustand und die Eingabe für einen erneuten Versuch erhalten. Der Browser-Audit verkürzt ausschließlich für die Prüfung den Timer und bestätigt die Grenze mit laufendem Hosted- und Local-Stream.

Gemma ist nicht deterministisch: Weitere T03-Wiederholungen erzeugten einen abgelehnten Entwurf ohne Effekt oder mit überzähligen Aktionen; nach einer Modellreparatur wurden sie in **29,1–36,7 s** vollständig gespeichert. Die Platzhalter- und Fortsetzungsfälle sind nun lokal normalisiert und als Regression nachgestellt. Ein A/B-Versuch mit `reasoning_effort: low` ergab zwei saubere T03-Läufe um 21 s, aber T06 benötigte 103 s und eine Reparatur; daher bleibt für diese Konfiguration `none` eingestellt. Reparaturen dürfen weiter Reasoning nutzen, wenn die erste Antwort semantisch unzureichend ist.

## Grenzen

- Der DOM-Renderer kann nur eindeutig zugeordnete direkte Rede benennen. Ohne strukturierte Sprecherangabe und ohne eindeutigen Kontext bleibt mehrdeutige Rede absichtlich Erzähltext.
- Die 190er-Matrix prüft kontrollierte Entwürfe. Fünf erfolgreiche Live-Fälle und eine kurze Besitzfolge belegen keine fehlerfreie lange Kampagne oder einen garantierten 30-Sekunden-Wert. Auch einfache Wiederholungen können noch einen Modellreparaturaufruf benötigen.
- Der Timer kann einen laufenden Netzwerkaufruf abbrechen und verhindert, dass nach Ablauf noch ein Linked-World-Commit begonnen wird. Ein bereits begonnener Speichervorgang kann wenige Millisekunden über die Frist hinaus abschließen; die Browser-UI wird danach freigegeben.
- Ein früherer F14-Lauf scheiterte nach zwei Modellreparaturen an `uncommitted_npc_presence_claim`; der erneute Test nach der Präsenzkorrektur war erfolgreich. Modellschwankungen und weitere seltene Reparaturfehler sind möglich.
- Ein früherer F12-Lauf hatte zusätzlich einen ungültigen Ortswert im Testaufbau (`location: "player"` bei einem Inventargegenstand). Der Aufbau wurde korrigiert; der erneute Live-Lauf speicherte den Zug.
