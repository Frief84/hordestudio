# P2.3c/d – World-Turn-Zuverlässigkeit (24.10.2026)

Basis: `0ec48f5c75f18c82387f95b768c3a8884584e1fe`. Der vorgefundene Arbeitsbaum enthielt bereits Änderungen an `app.js`, mehreren World-Modulen und Audits. Keine davon wurde zurückgesetzt; kein Fetch, Commit, Merge oder Push.

## A. P2.3c – Umgebung und Ende-zu-Ende-Ergebnisse

- Browser: Das in Codex gebündelte Playwright-Modul funktioniert mit lokal installiertem Chrome über `HORDE_PLAYWRIGHT_MODULE` und `HORDE_BROWSER_EXECUTABLE`. Es war keine Projektinstallation nötig. `world_linked_turn_browser_audit.js` und `world_server_binding_browser_audit.js` bestehen.
- Presence: Der eine Fehler in `narrated_presence_audit.js` lag in der Test-Fixture: `kitchen` und `hall` waren nicht verbunden. Der Test verwendet jetzt beidseitige kanonische Exits; alle 44 Checks bestehen. Die vorhandene Negativprobe für Schritte innerhalb desselben Raums bleibt bestehen.
- Live: Ollama und `gemma4:31b-it-q4_K_M` waren erreichbar. Vier priorisierte Fälle liefen im produktiven gebundenen V3-Browserpfad mit isolierten Sessions. Die synthetische Welt enthielt zwei verbundene Räume, einen registrierten Schlüssel, eine Tür und Linda als unabhängigen NPC. Weitere Gegenstands-, Container-, Discovery- und Erzeugungsregeln wurden in den vorhandenen Engine-Audits geprüft; eine gemeinsame T01–T12-Browser-Fixture ist noch offen.
- Die zusätzlich mit der originalen F14-Eingabe durchgeführte Live-Gegenprobe wurde nach zwei Reparaturen gespeichert: Linda verweigerte die Aufforderung und blieb im Foyer, während der Spieler im Round Room blieb. Der erste Korrekturgrund war `uncommitted_npc_presence_claim`; die ursprüngliche Kette `unknown_state_fact` → `missing_condition` trat hier nicht auf. F12 lieferte wegen eines Ollama-Timeouts keine auswertbare Modellantwort.

| Fall | Live-Ergebnis mit Gemma | Technische Prüfung |
|---|---|---|
| T03 Schlüssel aufnehmen | Nach einer Reparatur erfolgreich | `item_transfer` für `key` von `foyer` zu `player`, passendes abgeschlossenes Inventar-Event, übereinstimmende Narration, Live- und IndexedDB-Inventar identisch. |
| T06 Hände festhalten | Gültiger Misserfolg ohne Reparatur | Linda weicht aus; kein Festhalte-Effekt, kein Ortswechsel; Turn persistiert. |
| T08 Linda mitnehmen | Gültige Verweigerung ohne Reparatur | Linda lehnt ab; beide bleiben im Ausgangsraum; Turn persistiert. Ein live erfolgreicher gemeinsamer Ortswechsel wurde damit nicht belegt. |
| T09 Linda zur Tür schieben | Gültiger Versuch ohne Reparatur | Kein unbelegter Ortswechsel; Turn persistiert. Die Erzählung nennt nur den Versuch und bleibt als NPC-Reaktion zu knapp. |

T03 scheiterte anfangs mit `unverified_action_success`: Der Modelltext behauptete die Aufnahme, aber `effects:[]` enthielt keinen Transfer. Zwei weitere Diagnosevarianten blieben verworfen (`unverified_action_success`, dann `request_coverage_mismatch` durch eine zusätzliche Action für Lindas Beobachtung). Alle verworfenen Varianten ließen History, Inventar und Receipt-Zahl bei null. Der finale Gegenlauf führte zum bestätigten Effekt und gespeicherten Turn.

Ein zweites bereits installiertes Ollama-Modell, `qwen2.5:14b`, wurde mit identischer T03-Fixture geprüft. Anfangs setzte es `has_item` als Vorbedingung für die erst beabsichtigte Aufnahme und lieferte `effects:[]`; diese Läufe wurden sicher verworfen. Ein allgemeines, vollständiges V3-Beispiel für eine bestätigte Aufnahme im ersten Modellauftrag führte in der nächsten isolierten Gegenprobe nach zwei Reparaturen zu einem gespeicherten `item_transfer` samt Inventar-Event; Live- und Save-Inventar enthielten denselben Schlüssel. Das ist ein bestandener T03-Lauf mit dem zweiten Modell, aber noch kein Nachweis für andere Handlungsklassen. Der erste Qwen-T08-Lauf hatte zudem eine unvollständige Test-Fixture: Lindas Zielraum war ihr nicht bekannt. Nach Korrektur dieser Fixture schlug Qwen eine gemeinsame Ankunft vor, lieferte aber trotz zwei Reparaturen keinen `actor_move`; der Turn wurde mit `unverified_action_success` verworfen. Ein allgemeines V3-Beispiel für gemeinsame Bewegung änderte diesen Befund nicht. History und Positionen blieben unverändert.

Weitere Testmatrix: T01/T02 (wirkungsfreie Beobachtung/Dialog) sind im Bound-V3-Browser-Audit mit sinngleichen Formulierungen abgedeckt. T07 prüft dort ausdrücklich eine NPC-Aufforderung ohne Bewegung. T04/T05 (Schlüssel, verschlossener Behälter, Entnahme) deckt `world_physical_reachability_audit.js` ab; T10 und Teilwirkung `world_linked_execution_audit.js`; T11 der Bound-V3-Browser-Audit mit zehn Minuten und der Zeit-/Save-Audit; T12 sowie negative Prosa- und positive authored Discovery `world_scene_items_audit.js`. Für diese Fälle fehlt noch ein gemeinsamer vollständiger Browserlauf mit der angeforderten Fixture. Sie gelten deshalb nicht als live bestätigt.

## B. P2.3d – Ursachen, Korrekturen und Sicherheit

- `app.js`: Der Modellkontext listet registrierte Raum-Items auch vor dem ersten Scene-Item-Seed. Vorher konnte die Liste nutzbarer Gegenstände leer sein, obwohl ein registriertes Item im Raum lag.
- `app.js`: Der gebundene Reparaturprompt erhält die registrierten Gegenstände des aktuellen Raums. Er unterscheidet fehlende Effekte, zusätzliche Actions durch beiläufige NPC-Reaktionen und Vorbedingungen, die in Wahrheit gewünschte Ergebnisse sind. Diese Hinweise stehen nach dem generischen Server-Binding-Prompt und werden nicht mehr überschrieben. Es wurden keine neuen Modellaufrufe eingeführt; der normale Reparaturrahmen bleibt bei 8192 Ausgabetokens.
- `app.js`: Der erste Modellauftrag enthält jetzt für alle V3-Modelle ein vollständiges, schemakonformes Aufnahmebeispiel mit `status: resolved`, `item_transfer` und abgeschlossenem Inventar-Event. Eine Aufnahme darf weder `has_item` für den erst aufzunehmenden Gegenstand voraussetzen noch bei `attempted` einen abgeschlossenen Aufnahme-Event behaupten. Der Qwen-T03-Gegenlauf belegt die Wirkung nach Reparaturen.
- `app.js`: Ein zweiter Reparaturversuch wird ausgelassen, wenn Feedback und abgelehnter Vorschlag identisch geblieben sind. Abgeschnittene Antworten bleiben davon ausgenommen.
- `scratch/narrated_presence_audit.js`: Nur die fehlende Erreichbarkeit in der positiven Fixture ergänzt; die Presence-Validierung blieb unverändert.
- `scratch/world_server_binding_browser_audit.js`: Erwartete Binding-Zahl an den nachgewiesenen identischen Retry-Verzicht angepasst; die übrigen Receipt-, Rollback- und Reload-Assertions bleiben erhalten.
- `scratch/world_linked_ollama_live_audit.js`: Isolierter Browser-Live-Test mit konfigurierbarem `HORDE_LIVE_MODEL` und lokalem Ollama. Synthetische Prompts und Antworten sind in `scratch/world_linked_*live*.json` für Diagnose verfügbar.
- `scratch/world_linked_ollama_live_audit.js`: T08 gibt dem NPC jetzt den Zielraum als bekannt, sodass der Test einen erlaubten gemeinsamen Weg enthält. Die Ausgabe unterscheidet einen vorhandenen Anfangs-Save von einem tatsächlich gespeicherten Turn.

Bestanden: `world_linked_execution_audit`, `world_linked_contract_audit`, `world_linked_hardening_audit`, `world_linked_generalization_audit`, `world_scene_items_audit`, `world_physical_reachability_audit`, `world_registered_effect_proxy_audit`, `world_receipt_repair_budget_audit`, `narrated_presence_audit`, `world_linked_turn_browser_audit`, `world_server_binding_browser_audit`, `world_scene_draft_audit`, `world_scene_draft_browser_audit`, `world_npc_knowledge_recall_audit`, `world_turn_transaction_audit` und `world_phase4_time_browser_audit`. `world_real_save_continuation_audit` benötigt ausdrücklich kopierte `.horde_campaign`-Archive und wurde daher nicht ausgeführt. Der ältere `world_linked_chain_browser_audit` scheitert weiterhin: Seine Mock-Hauptantworten werden abgelehnt, während sein Reparatur-Mock SSE statt des erwarteten JSON liefert; daher liefert er `invalid JSON` und fünf statt drei Aufrufe. Der Test wurde nicht als bestanden umgedeutet.

## C. F10–F16

Die IDs stammen aus der vom Auftraggeber nachgereichten internen Fehlerreferenz. Die Bewertung bezieht sich jeweils auf den ursprünglichen Fehler, nicht nur auf einen ähnlichen Testfall.

| ID | Ursprünglicher Fehler | Status und Beleg |
|---|---|---|
| F10 | Drei Paar Handschellen standen nur in einer Raumbeschreibung; Aufnehmen scheiterte mit `unverified_action_success` oder wurde ohne belegte Inventaränderung erzählt. | **Teilweise behoben.** Strukturierte Raumgegenstände und Mengen sind Engine-seitig geprüft; der Live-Fall T03 belegt eine registrierte Schlüsselaufnahme samt gespeichertem Transfer. Freie Prosa ohne unabhängige Item-Grundlage erzeugt weiterhin keinen Gegenstand. Der ursprüngliche Handschellenfall ist nicht live bestätigt. |
| F11 | Lindas Schritt von einer Holzkiste weg löste fälschlich `uncommitted_npc_departure_claim` aus. | **Engine-seitig bestätigt.** Die Presence-Gegenprobe mit erreichbaren Räumen besteht; eine Bewegung innerhalb eines Raums gilt nicht als Abreise. Ein echter Live-Gegenlauf mit der ursprünglichen Formulierung fehlt. |
| F12 | Frei formulierter `state_conditions.fact` zur Fesselung, anschließend `unverified_action_success`, drei Aufrufe ohne gespeicherten Turn. | **Teilweise behoben.** Der generische Reparaturhinweis unterscheidet registrierte Vorbedingungen von gewünschten Effekten. Der neue Live-Gegenlauf mit registrierten, im Inventar befindlichen Handschellen lieferte wegen eines Ollama-Timeouts nach 300 s keine Modellantwort; History blieb leer. Der ursprüngliche Fehler ist damit weder widerlegt noch neu reproduziert. |
| F13 | Gleiche Klasse frei formulierter Zustandsfakten, danach `oversized_bound_turn` nach einer sehr großen Reparaturantwort. | **Teilweise behoben.** Der reguläre Reparaturrahmen ist Engine-seitig auf 8192 Ausgabetokens begrenzt; die vollständige ursprüngliche Modellsequenz wurde nicht neu live geprüft. Es ist nicht belegt, dass dadurch ein gültiger Fesselungseffekt gelingt. |
| F14 | „Come here Linda NOW!“ führte zu `unknown_state_fact:Linda enters the Round Room`, dann `missing_condition`, ohne gespeicherten Turn. | **Live bestätigt behoben für den getesteten Ausgang.** Der genaue Eingang wurde mit Gemma im produktiven Browserpfad nach zwei Reparaturen als Verweigerung gespeichert; Linda blieb im Foyer, der Spieler im Round Room. Die kontrollierte Browser-Negativprobe besteht ebenfalls. Ein neuer erster Korrekturgrund `uncommitted_npc_presence_claim` und 365 s Laufzeit zeigen verbleibende Zuverlässigkeits- und Kostenprobleme. |
| F15 | „you take linda to the round room“ endete in `request_coverage_mismatch`, dann `unverified_journey_start`, ohne gespeicherten Turn. | **Weiterhin reproduzierbar als technischer Fehlschlag.** Engine-Tests belegen gemeinsame Bewegung und Reisebeginn; Gemma T08 führte zu einer gültigen gespeicherten Verweigerung. Mit bekanntem Zielraum behauptete Qwen T08 nach zwei Reparaturen eine gemeinsame Ankunft ohne `actor_move`; `unverified_action_success` verhinderte den Commit. Die ursprüngliche genaue Fehlerkette wurde mit dieser Fixture nicht erneut beobachtet. Ein live erfolgreicher gemeinsamer Ortswechsel ist nicht belegt. |
| F16 | Begleiten, Schieben, Stoßen, Ziehen oder Führen von NPCs funktioniert im Gameplay nicht zuverlässig. | **Teilweise behoben.** Engine-Gegenproben belegen positive und negative Effektpfade. T06/T08/T09 liefern mit echtem Modell gespeicherte Misserfolge beziehungsweise Versuche ohne erfundene Positionsänderung. Live erfolgreiche physische NPC-Bewegung über eine Raumgrenze fehlt. |

Ein erzählter und gespeicherter Misserfolg ist ein gültiger Spielzug. Ein technischer Validierungsfehler ohne gespeicherten Turn bleibt ein Defekt. Für Linda, Handschellen und Round Room wurden keine Sonderregeln eingeführt.

## D. Modellkosten

| Lauf | Aufrufe (Haupt + Reparatur) | Modellzeit | Vom Anbieter gemeldete Tokens | Ergebnis |
|---|---:|---:|---|---|
| Gemma T03 vor Korrektur, kalt | 1 + 2 | 362 s | Reparaturen 901/1819 und 1284/1943 Ein-/Ausgabe; Hauptaufruf unbekannt | Verworfen |
| Gemma T03 nach finaler Korrektur | 1 + 1 | 62 s | Reparatur 1258/1840; Hauptaufruf unbekannt | Committed |
| Gemma T06 | 1 + 0 | 47 s | Unbekannt | Committed, Versuch scheitert |
| Gemma T08 | 1 + 0 | 76 s | Unbekannt | Committed, Linda verweigert |
| Gemma T09 | 1 + 0 | 87 s | Unbekannt | Committed, kein Ortswechsel |
| Qwen T03, erster und zweiter Lauf | je 1 + 1 | 112 s / 7 s | Hauptaufrufe unbekannt; Reparaturangaben siehe Rohdaten | Beide verworfen |
| Qwen T03, erster Prompt-Nachlauf | 1 + 2 | 104 s | Hauptaufruf unbekannt; Reparaturangaben siehe Rohdaten | `failed_action_has_completed_event`, verworfen |
| Qwen T03, vollständiges Aufnahmebeispiel | 1 + 2 | 8 s | Reparaturen 1131/140 und 1433/92 Ein-/Ausgabe; Hauptaufruf unbekannt | Committed, Inventar gespeichert |
| Qwen T08, unvollständige Fixture | 1 + 2 | 8 s | Hauptaufruf unbekannt; Reparaturangaben siehe Rohdaten | `request_coverage_mismatch`, verworfen |
| Qwen T08, bekannter Weg | 1 + 2 | 13 s | Hauptaufruf unbekannt; Reparaturangaben siehe Rohdaten | `unverified_action_success`, verworfen |
| Qwen T08, bekannter Weg und Bewegungsbeispiel | 1 + 2 | 13 s | Hauptaufruf unbekannt; Reparaturangaben siehe Rohdaten | `unverified_action_success`, verworfen |
| Historischer F13 aus der Fehlerreferenz | 1 + 2 | 376,4 s | Reparaturen: 17.697 und 5.353 gemeldete Tokens | Kein gespeicherter Turn |
| Gemma F12, neuer Gegenlauf | 1 + 0 | 300 s bis Timeout | Keine Antwort; Tokenzahl unbekannt | Kein gespeicherter Turn, nicht auswertbar |
| Gemma F14, neuer Gegenlauf | 1 + 2 | 365 s | Reparaturen 854/3348 und 1023/7459 Ein-/Ausgabe; Hauptaufruf unbekannt | Committed, Linda verweigert |

Die Gemma-T03-Diagnose umfasste insgesamt vier isolierte Läufe: 11 Aufrufe, davon sieben Reparaturen. Zusammen mit T06/T08/T09 sowie den neuen F12/F14-Gegenläufen waren es 18 Gemma-Aufrufe. Der kalte erste T03-Aufruf dauerte 293 s; daraus lässt sich kein belastbarer Vorher-/Nachher-Geschwindigkeitsgewinn ableiten. Fehlende Streaming-Tokens werden als unbekannt geführt.

## E. Wichtigste offene Punkte

1. `qwen2.5:14b` besteht T03 erst nach zwei Reparaturen und behauptet bei T08 trotz bekannten Wegs eine gemeinsame Ankunft ohne `actor_move`. Nächster Schritt: Den begrenzten Transport-/Reparaturvertrag für fehlende Bewegungseffekte gegen diesen gespeicherten Rohfall prüfen; die kanonische Validierung beibehalten und identische Modellläufe nicht wiederholen.
2. Die vollständige T01–T12-Matrix auf einer gemeinsamen Browser-Fixture einschließlich Container, Discovery, Erzeugungsregel und Save/Reload pro Fall fehlt. Nächster Schritt: Den vorhandenen Bound-V3-Browser-Audit um diese Fixture und positive/negative Receipts erweitern.
3. F12 blieb wegen Ollama-Timeout unbeurteilt, und F14 brauchte für eine einfache Verweigerung 365 s und zwei Reparaturen. Nächster Schritt: Die Modellantworten und Korrekturgründe mit einem warmen Modelllauf und derselben isolierten Fixture vergleichen; dabei auch eine konkrete NPC-Reaktion auf `attempted` in T09 prüfen, ohne Widerstand zu erfinden.
