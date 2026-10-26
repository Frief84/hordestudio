# Lokaler World-Turn-Modellbenchmark – 26.10.2026

## Ergebnis

Unter dem aktuellen World-Turn-Vertrag ist **kein neues Modell als allgemein zuverlässiges Hauptmodell nachgewiesen**. `qwen2.5:14b-instruct-q4_K_M` lieferte als einziger neuer Kandidat einen vollständig korrekten T03-Inventarturn, benötigte dafür aber zwei Reparaturrequests und beim Kaltstart 107,1 s. Seine P4.1- und Bewegungsversuche scheiterten. Sein gespeicherter P4.2-Turn ist ein **Fehlerfall**, weil das Modell die physische Inschriftenhandlung als `speech` einordnete, keinen Universalcheck auslöste und keine Energie abbuchte. `ministral-3:14b` speicherte T03 ebenfalls, behauptete dabei aber nur erzählerisch die Schlüsselaufnahme; Inventar und Item-Location blieben unverändert. P4.1/P4.2 scheiterten nach Reparaturen.

Die bisherige produktive Single-Model-Route wurde nicht geändert. Die bestehenden Validierungen wurden nicht gelockert. Die früheren Gemma-Live-Proben bleiben Vergleichsfälle, aber der neue Gemma-Screening-Kaltstart überschritt zweimal das verkürzte 150-s-Limit. Diese Stichprobe erlaubt weder eine allgemeine Erfolgsquote noch eine Rangfolge für warme Läufe großer Modelle.

## Methode und Budget

- Ausschließlich lokale Projektdateien, lokale Chrome-Installation und Ollama unter `127.0.0.1:11434`; keine Downloads, Cloud- oder Git-Aktionen. Testwelt und Sessions wurden pro Lauf im vorhandenen `scratch/world_linked_ollama_live_audit.js` isoliert neu aufgebaut. Produktive Spielstände wurden nicht verwendet.
- Screening: T03 (Schlüssel aufnehmen) und P42 (Inschrift mit P4.1-Check und P4.2-Energiekosten). Ein echter Request pro Versuch, 150 s Request-Limit und 2.048 Output-Tokens. Ausnahmen: der erste Ministral-T03-Pilot nutzte noch das normale 8.192-Token-Limit; GPT-OSS-P42 und Ministral-P42 wurden bei einer Zwischenkonfiguration nach 90 s abgebrochen. Die gekürzten Limits gelten nur für den Benchmark. Eine zweite lange Probe wurde bei Modellen mit T03-Timeout anschließend ausgelassen; einige P42-Proben waren zu diesem Zeitpunkt bereits gestartet.
- Vertiefung: normaler Turnvertrag mit bis zu zwei bestehenden Reparaturaufrufen und 8.192 Output-Tokens; vorhandene harte Produktgrenze von fünf Minuten bleibt bestehen. Getestet wurden Qwen 2.5 und Ministral. A3 ist eine Spielerbewegung in den verbundenen Raum; A2 kombiniert Ansprache und körperlichen Versuch. A5 und fehlende Voraussetzungen blieben wegen des Budgets offen.
- **Budget vollständig verbraucht:** 12 abgeschlossene Screening-Requests + 17 abgeschlossene Vertiefungs-Requests + 1 beim Pausieren gestarteter und abgebrochener Ministral-T03-Request = konservativ 30/30. Es wurden keine weiteren Modellrequests ausgeführt.
- `Commit` bezeichnet nur einen gespeicherten Turn. Die Spalte `Qualität` bewertet zusätzlich, ob der Spielerwunsch und die geforderten Belege tatsächlich erfüllt wurden. Ein gespeicherter Turn kann fachlich falsch sein.

## Modellinventur

Die lokalen `/api/tags`-Metadaten meldeten folgende sieben unterschiedliche Digests. Alle sieben besitzen die Ollama-Capabilities `completion` und `tools`; `thinking` ist für Gemma 4, GPT-OSS, Qwen 3.5 und Qwen 3 gemeldet. Vision ist für Gemma 4 und beide Mistral-Varianten gemeldet. `tools` belegt die Schnittstellenfähigkeit, nicht die korrekte Nutzung des World-Schemas. Strukturierte Ausgabe wurde praktisch mit dem bestehenden JSON-/Tool-Vertrag versucht; ein gesonderter JSON-Modus-Vorteil wurde nicht nachgewiesen.

| Modell | Digest-Anfang | Kontext laut `/api/tags` | Quantisierung | Größe auf Datenträger |
|---|---|---:|---|---:|
| `gemma4:31b-it-q4_K_M` | `17ba34c06c80` | 262.144 | Q4_K_M | 20,39 GB |
| `gpt-oss:20b` | `17052f91a42e` | 131.072 | MXFP4 | 13,79 GB |
| `ministral-3:14b` | `4760c35aeb9d` | 262.144 | Q4_K_M | 9,08 GB |
| `jaahas/qwen3.5-uncensored:27b` | `b4fd55c663a6` | 262.144 | Q4_K_M | 16,54 GB |
| `mistral-small3.2:24b` | `5a408ab55df5` | 131.072 | Q4_K_M | 15,18 GB |
| `qwen2.5:14b-instruct-q4_K_M` | `7cdf5a0187d5` | 32.768 | Q4_K_M | 8,99 GB |
| `qwen3:30b` | `ad815644918f` | 262.144 | Q4_K_M | 18,56 GB |

`gemma4:31b` ist derselbe Digest wie die explizite Gemma-Q4-Variante; `qwen2.5:14b` ist derselbe Digest wie die Instruct-Q4-Variante. Sie wurden nicht doppelt gezählt. `/api/show` meldete lokale Parameter unter anderem Gemma `temperature 1`, `top_k 64`, `top_p 0.95`, `draft_num_predict 3`; Ministral und Mistral Small `temperature 0.15`; Qwen 3.5 `presence_penalty 1.5`, `temperature 1`, `top_k 20`, `top_p 0.95`; Qwen 3 `temperature 0.6`, `top_k 20`, `top_p 0.95`. Für Qwen 2.5 waren keine lokalen Zusatzparameter hinterlegt. Der Hauptpfad setzte bei Gemma historisch `reasoning_effort: none`; andere Hauptrequests zeigten in diesem Harness kein explizites `reasoning_effort`. Ob intern dennoch Reasoning stattfand, war nicht messbar.

## Screening – vollständige World-Turn-Pipeline

Modellzeit ist die Summe der gemessenen lokalen HTTP-Requests, Turn-Dauer die Zeit in `executeWorldTurn`. Bei Timeout enthalten beide den künstlichen Screening-Abbruch. `–` bedeutet keinen abgeschlossenen Versuch.

| Modell | Fall | Modellzeit | Turn-Dauer | Reparaturen | Commit | Qualität / Fehler |
|---|---|---:|---:|---:|---|---|
| Gemma 4 | T03 | 150,0 s | 150,1 s | 0 | nein | Screening-Timeout |
| Gemma 4 | P42 | 150,0 s | 150,1 s | 0 | nein | Screening-Timeout; Energie 5 |
| GPT-OSS | T03 | 150,0 s | 150,1 s | 0 | nein | Screening-Timeout |
| GPT-OSS | P42 | 90,0 s | 90,1 s | 0 | nein | Zwischenlimit-Timeout; Energie 5 |
| Ministral | T03 | 121,2 s | 121,5 s | 0 | nein | `request_coverage_mismatch` |
| Ministral | P42 | 90,0 s | 90,1 s | 0 | nein | Zwischenlimit-Timeout; Energie 5 |
| Qwen 3.5 | T03 | 150,0 s | 150,1 s | 0 | nein | Screening-Timeout |
| Qwen 3.5 | P42 | 150,1 s | 150,2 s | 0 | nein | Screening-Timeout; Energie 5 |
| Mistral Small 3.2 | T03 | 150,1 s | 150,2 s | 0 | nein | Screening-Timeout |
| Qwen 2.5 | T03 | 98,1 s | 98,5 s | 0 | nein | `unverified_action_success` |
| Qwen 2.5 | P42 | 4,6 s | 4,8 s | 0 | nein | unbelegter Erfolg; Energie 5 |
| Qwen 3 | T03 | 150,1 s | 150,2 s | 0 | nein | Screening-Timeout |

## Vertiefung – Qwen 2.5 und Ministral

| Modell | Fall | Modellzeit | Turn-Dauer | Reparaturen | Commit | Qualität / Fehler |
|---|---|---:|---:|---:|---|---|
| Qwen 2.5 | T03 | 106,6 s | 107,1 s | 2 | ja | **korrekt**: Item-ID `key`, bestätigter `item_transfer`, Inventarereignis und gespeicherter Schlüssel im Inventar; erster Vorschlag ungültig |
| Qwen 2.5 | P41 | 5,7 s | 6,0 s | 1 | nein | `unverified_action_success`; kein Check-Ergebnis |
| Qwen 2.5 | P42 | 3,5 s | 3,7 s | 0 | ja | **falsch**: als `speech` klassifiziert, kein Check, keine Kosten; gespeicherte Energie 5; Inschrifteninhalt erfunden |
| Qwen 2.5 | A3 | 18,7 s | 19,1 s | 2 | nein | `unverified_action_success`; keine Bewegung, Ort blieb Foyer |
| Qwen 2.5 | A2 | 103,8 s | 104,6 s | 0 | ja | zwei Teilaktionsresultate, aber keine Events oder Sprecherbelege; NPC-Reaktion/Dialog unbelegt, körperlicher Versuch fehlgeschlagen |
| Ministral | T03 | 111,9 s | 112,7 s | 0 | ja | **falsch**: `speech`, keine Effects/Events; Erzählung behauptet Aufnahme, Schlüssel bleibt im Foyer und Inventar leer |
| Ministral | P42 | 19,4 s | 21,1 s | 2 | nein | `unverified_action_success`; Energie 5 |
| Ministral | P41 | 13,2 s | 13,9 s | 2 | nein | `unverified_action_success`; kein Check-Ergebnis |

Bei Qwen-T03 führte erst der dritte Request zum gültigen Transfer. Das Receipt hat `action_results: succeeded`, den bestätigten `item_transfer` von `foyer` nach `player` und passende `inventory`-Events; der gespeicherte Reload-Zustand enthält `Bronze key`. Die Reparaturhäufigkeit ist daher ein realer Kostenfaktor. Die `accepted`-Zahl des Auditobjekts zählt interne akzeptierte Einträge und ist keine Zahl erfüllter Spielerabsichten.

Qwen-P42 und Ministral-T03 zeigen eine wesentliche Fehlermöglichkeit: Ein Modell kann den Turn durch falsche Action-Klassifikation formal speichern und gleichzeitig den physischen Spielerwunsch nur erzählen. Qwen-P42 hatte `check_results: []`, `confirmed_effects: []`, `events: []` und gespeicherte Energie 5. Ministral-T03 hatte ebenfalls keine bestätigten Effects oder Events und ließ den Schlüssel am Ausgangsort. Diese gespeicherten Turns dürfen nicht als Qualitäts- oder P4.2-Erfolg gezählt werden. Bei technisch abgelehnten P4.1-/P4.2-Turns blieben Live- und Save-Ressourcenwerte unverändert.

## P4.1-/P4.2-Live-Vergleich mit dem bisherigen Modell

Die vor diesem Benchmark dokumentierten Gemma-Live-Fälle bleiben eigene Stichproben mit anderer Lauf- und Promptgeschichte: P4.1-Inschrift 55,2 s / 2 Requests / `unverified_action_success`; P4.2-Inschrift 107,2 s / 3 Requests / `pending_action_requires_check`; ein früherer P4.2-Lauf 180,1 s / 3 Requests / `check_effect_not_allowed` nach unerlaubtem `knowledge_share`. Keiner dieser P4.2-Fälle commitete oder buchte Energie ab. Die neuen Qwen-/Ministral-Fälle liefern ebenfalls **keinen echten Live-Nachweis eines bestätigten P4.1-Checks oder einer P4.2-Abbuchung**. Die deterministischen P4.1-/P4.2-Audits bestätigen weiterhin den autoritativen Executor, ersetzen aber keinen Modellbeleg.

## Hardware, Laufzeit und Messgrenzen

- GPU: NVIDIA GeForce RTX 3090 mit 24.576 MiB laut `nvidia-smi`. Ein Leerlauf-Snapshot zeigte 1.730 MiB belegt. Während Modellwechseln wurden unter anderem rund 10.276 MiB (Qwen 2.5), 17.118 MiB (Qwen 3.5) und 19.573 MiB (Qwen 3) Gesamtbelegung beobachtet; das sind **gesamte GPU-Snapshots**, keine isolierten Modellwerte. In einem späteren Ministral-Lauf zeigte `/api/ps` 11.123.315.179 Byte `size_vram` bei gleicher Modellgröße und effektivem Kontext 32.768, also für diesen Snapshot vollständige Modellresidenz auf GPU. Ein anderer GPU-Snapshot zeigte fast volle 23.952 MiB trotz nur 11,1 GB von Ollama gemeldeter Modellbelegung; andere Verbraucher oder Reservierungen wurden nicht zuverlässig aufgeschlüsselt.
- Effektive lokale Kontexte konnten nur bei residentem Modell über `/api/ps` gemessen werden; Ministral meldete 32.768. Die Testwelt setzte `contextSize: 32768`. Die Modellmetadaten-Kontextfenster in der Inventartabelle sind Fähigkeiten, nicht der effektiv genutzte Kontext aller Läufe.
- Hauptrequests enthielten etwa 30.778–32.124 Nachrichtenzeichen und 32.630–32.796 separate Schemazeichen. Die Promptgröße und das Schema verursachen für kleine Modelle eine erhebliche Kontextarbeit. Reparaturrequests waren kürzer. Der Unterschied zwischen kaltem Qwen-T03-Hauptrequest (~98 s) und direkt folgendem warmen P42-Hauptrequest (4,6 s im Screening; 3,5 s in der Vertiefung) zeigt einen starken Warm-/Cold-Effekt, isoliert aber Ladezeit und Prompt-Evaluation nicht. Vollständiger Modellwechsel, Keep-Alive-Dauer, parallele Residenz zweier kleiner Modelle und CPU-Offload wurden nicht kontrolliert genug gemessen, um eine Zwei-Modell-Geschwindigkeitsbehauptung zu stützen.
- Ollamas OpenAI-kompatible Streams lieferten im Harness keine nativen `usage`, `load_duration`, `prompt_eval_duration` oder `eval_duration`. Prompt-/Output-Tokenzahlen, echte Ladezeit, Prompt-Evaluationszeit, Generierungsrate und CPU-Offload sind daher **nicht verfügbar**. Zeichen- und Engine-Token-Schätzwerte werden nicht als Messungen ausgegeben. `firstTokenMs`/`firstContentMs` in einzelnen Client-Audits gelten nur für deren jeweilige Erfassung; ein systematischer Time-to-First-Token-Vergleich wurde nicht erzeugt. Lokale Validierung und Persistenz wurden im Harness nicht durchgehend separat gemessen; die Differenz zwischen Turn- und Requestzeit enthält diese sowie Browserarbeit.

## Multi-Model-Varianten und weitere Rollen

Das Budget wurde zugunsten echter Einzelmodell- und P4.1-/P4.2-Turns ausgeschöpft. **Keine** Action-Interpreter-plus-Narrator- oder Main-plus-Repair-Modellkombination wurde per zusätzlichem Modellrequest ausgeführt; es gibt deshalb keine gemessene vollständige Zwei-Modell-Turn-Dauer und keinen belegten Vorteil. Der bestehende Single-Model-Reparaturpfad von Qwen-T03 brauchte bereits drei Requests. Vor einer Aufteilung muss ein isolierter Harness eine bestätigte Action-Liste als einzige Weltänderungsquelle und Narration ausschließlich aus Receipts prüfen; Qwen-P42 und Ministral-T03 zeigen konkret, warum freie Nachnarration ohne diese Bindung riskant wäre. Auch für einen speziellen Repair- oder Summarization- sowie einen World-Agent-/NPC-Task-Runner wurde kein zusätzlicher Request ausgeführt. Für NPC-Autonomie folgt aus diesen Daten keine neue Modellautorität oder Schleife.

## Regressionen

Nach den Änderungen ausschließlich an den Benchmark-Skripten wurden 25 lokale Audits erneut ausgeführt und bestanden: `world_general_turn_matrix_audit.js` (190 Fälle), `world_server_binding_audit.js`, `world_linked_execution_audit.js`, `world_linked_hardening_audit.js`, `world_action_path_parity_audit.js`, `world_turn_transaction_audit.js`, `world_working_state_audit.js`, `world_p41_universal_checks_audit.js`, `world_p42_resource_cost_audit.js`, `world_model_client_audit.js`, vier NPC-Goal-Audits, `world_perception_audit.js`, `world_knowledge_share_audit.js` sowie Browseraudits für Server Binding, P4.2-Kosten, P4.1-Linked-Turn, NPC-Goal-Tick, Perception, Knowledge-Sharing-Persistenz, atomare Turn-Persistenz, Startup-Recovery und Hosted-Turn-Deadline. Die detaillierten Exitcodes stehen in `scratch/world-model-regressions-2026-10-26.json`. Diese kontrollierten Audits belegen die Engine-Regeln, nicht die Zuverlässigkeit der hier getesteten Modellantworten.

## Empfehlung und nächster echter Spieltest

1. **Hauptmodell:** Keine produktive Umstellung auf Basis dieser Stichprobe. Gemma bleibt die vorhandene Referenzkonfiguration, ohne dass die neuen 150-s-Kaltstart-Timeouts als warmer Qualitätsvergleich missverstanden werden. `qwen2.5:14b-instruct-q4_K_M` ist der gezielt weiter zu prüfende lokale Kandidat, weil sein T03-Transfer nach Reparaturen korrekt und seine warmen Requests schnell waren. Seine P4.1-/P4.2- und Bewegungsfehler schließen eine Freigabe als allgemeines Hauptmodell derzeit aus.
2. **Kurze strukturierte Aufgaben:** Qwen 2.5 ist wegen kurzer warmer Reparaturrequests ein Prüf-Kandidat, aber seine Erstvorschläge und die falsche P4.2-Klassifikation verhindern eine Zuverlässigkeitsbehauptung. Ministral zeigte auch bei kurzen Aufgaben keinen validierten Vorteil.
3. **Spezialisiertes Repair-Modell:** derzeit nicht empfohlen. Es wurde keine modellübergreifende Reparatur getestet; Qwen reparierte T03 mit zwei Aufrufen, P4.1 und Bewegung aber nicht. Deterministische Reparatur und dieselbe abschließende Validierung bleiben Voraussetzung.
4. **Getrennte Narration:** derzeit nicht empfohlen. Zwei gespeicherte Turns enthielten narrative Erfolge ohne entsprechende World-State-Änderung beziehungsweise Check-Auswertung.
5. **Zwei Modelle schneller als eines:** nicht belegt. Der Modellwechsel kann bei diesen 9–20-GB-Dateien und 24-GB-GPU erheblich sein; die konkrete Wechselzeit und parallele Residenz wurden nicht isoliert gemessen.
6. **Nächster echte Spieltest:** mit unveränderter Produkt-Route eine kleine Folge von T03, Bewegung, P4.1 und P4.2 auf derselben warmen Session durchführen, zuerst mit der bisherigen Gemma-Konfiguration als Referenz, dann isoliert mit Qwen 2.5. Erfolg nur bei vollständiger Absichtsabdeckung, bestätigten Action-/Event-/Effect-Belegen, korrektem Check samt Kosten und identischem Zustand nach Reload zählen. Die dokumentierten Fehlklassifikationen sollten dabei als explizite Negativfälle beobachtet werden. Für neue Modellrequests ist ein neues Testbudget erforderlich.

Rohdaten ohne gespeicherte Rohprompts/Antwortstreams: `scratch/world-model-screening-2026-10-26/*.json`, `scratch/world-model-deep-2026-10-26/*.json`. Die Diagnoseobjekte enthalten teils Modellvorschläge innerhalb bestehender Engine-Audits; sie sind keine produktiven Spielstände.
