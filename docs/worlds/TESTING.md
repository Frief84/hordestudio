# World Engine: Testnachweise und Messgrenzen

P4.3d (28.10.2026): [Bericht](../../documentation-reports/world-p43d-context-action-reliability.md). `scratch/world_p43d_action_reliability_audit.js` prüft positive Vault-Tür-/Cell-Key-/NPC-Aktionsketten und negative Schlüssel-/Instanzfälle einschließlich Commit/Reload. P4.3a-Recovery-Audit separat bestanden; der finale Lauf der 25 World-Regressionsaudits steht in `scratch/world-p43d-regressions-final.json` (25/25 bestanden, 0 Timeouts). `scratch/world_context_budget_browser_audit.js` sowie die P4.3b-Tür- und Schlüssel-Audits bestanden. Keine neuen Ollama-Requests.

Stand: 26.10.2026. Die Zahlen bezeichnen verschiedene Prüfarten und dürfen nicht addiert oder als allgemeine Erfolgsquote ausgegeben werden. Der ursprüngliche [Modellbenchmark](../world-local-model-benchmark-2026-10-26.md), seine Diagnosen unter `../../scratch/world-model-*-2026-10-26` und reproduzierbare `../../scratch/world_*audit.js`-Skripte bleiben erhalten.

P4.3b vom 27.10.2026 verwendet die reale 11-Raum-Welt **The Submission Vault** in isolierten Browser-Timelines. Der [Live-Bericht](../../documentation-reports/world-p43b-live-20261027.md) und die Rohdaten unter `../../scratch/world-model-p43b-2026-10-27/` dokumentieren Modellrequests, Belege, Fehler und Persistenz. Die Befunde sind getrennt von den P4.3a-Zahlen unten zu lesen.

## Kontrollierte World-Turn-Prüfungen

`scratch/world_general_turn_matrix_audit.js` enthält **190 verschiedene gebundene Turns** in zehn Genres und 19 Kategorien. Modellantworten sind dort konstruiert/kontrolliert. Der Audit prüft Binding, Compiler, Linked Reducer, Working State und Commit; 190 ist die Zahl der Fälle, nicht der Assertions und nicht die Zahl echter LLM-Requests. P4.3a fügte `world_benchmark_failure_recovery_audit.js` für konkret beobachtete Fehl-Dispositionen hinzu. Der finale Lauf am 26.10. bestand aus **26 gestarteten Audits, 26 bestanden, 0 fehlgeschlagen, 0 nicht ausgeführt**: Recovery-Audit plus 25 Regressionen. Die Ergebnisdatei ist `../../scratch/world-model-regressions-2026-10-26.json`. Die kontrollierten Antworten sind kein Replay der vollständigen ursprünglichen Modellstreams; diese wurden nicht gespeichert. Browser-Audits nutzen lokale Testantworten und prüfen unter anderem UI, Save/Reload, Rollback und die harte fünfminütige Turn-Grenze.

## Echter lokaler Modellbenchmark vom 26.10.2026

Das festgelegte Budget wurde mit **30/30 lokalen Modellrequests** verbraucht: 12 abgeschlossene Screening-Requests, 17 abgeschlossene Vertiefungs-Requests und ein beim Pausieren gestarteter, abgebrochener Ministral-Request. Sieben unterschiedliche lokale Modell-Digests wurden inventarisiert; Screening und Vertiefung verwendeten isolierte Testwelten und Sessions, keine produktiven Spielstände. Die RTX 3090 hatte 24 GB VRAM. Screening begrenzte Requests meist auf 150 s und 2.048 Output-Tokens, mit dokumentierten 90-s-Zwischenlimits; Vertiefung verwendete bis zu zwei Reparaturen und 8.192 Output-Tokens. Deshalb sind Timeout-Zahlen und Laufzeiten nicht modellübergreifend als allgemeiner Leistungsvergleich geeignet.

| Kandidat | Tatsächlich belegter Benchmark-Befund |
|---|---|
| Gemma 4 31B | Beide neuen Screening-Fälle liefen ins 150-s-Limit; frühere gesonderte Live-Proben bleiben eigene Stichproben. |
| GPT-OSS 20B | T03 nach 150 s, P42 nach 90 s abgebrochen. |
| Ministral 3 14B | T03-Screening mit `request_coverage_mismatch`; Vertiefungs-T03 commitete, erzählte aber eine Aufnahme ohne Inventaränderung; P4.1/P4.2 ohne Erfolg. |
| Qwen 3.5 27B | T03 und P42 im Screening mit 150-s-Timeout. |
| Mistral Small 3.2 24B | T03 im Screening mit 150-s-Timeout; keine abgeschlossene P42-Probe. |
| Qwen 2.5 14B | Vertiefungs-T03 fachlich korrekt nach zwei Reparaturen (107,1 s Turn-Dauer); P42 commitete fachlich falsch als `speech`, ohne Check/Kosten; P4.1 und A3 wurden technisch abgewiesen; A2 ohne NPC-Sprecherbeleg. |
| Qwen 3 30B | T03 im Screening mit 150-s-Timeout; keine abgeschlossene P42-Probe. |

Ein **Commit** heißt nur, dass ein Turn gespeichert wurde. Bei Qwen-P42 blieb Energie 5, `check_results`, Effects und Events leer. Bei Ministral-T03 blieb der Schlüssel am Ausgangsort. Diese Commits erfüllen den Spielerwunsch nicht. Qwen-T03 war der einzige neue Kandidatenfall mit bestätigtem `item_transfer`, Inventarereignis und gespeichertem Inventar in diesem Benchmark. Die P4.1-/P4.2-Live-Fälle und A3 belegen keinen erfolgreichen Check, keine bestätigte Abbuchung und keine erfolgreiche kartierte Bewegung. Der frühere Gemma-P4.2-Inschriftenfall dauerte 180,1 s, wurde wegen nicht erlaubtem `knowledge_share` abgelehnt und belastete Energie nicht. Provider-Tokens, Tokenrate und Cold-Start-Anteil waren in den neuen Streams nicht verlässlich verfügbar. Historische fünf Gemma-Fälle um 8–14 s gehören zu einer anderen Testkonfiguration und sind keine aktuelle Leistungszusage.

## Reproduzierbarkeit und Reichweite

Die P4.3a-Prüfung verwendete nach dem Benchmark **keine neuen echten Modellantworten**. Ihr Intent-Guard ist gegen die gespeicherten Dispositionen und konstruierte Negativ-/Positivfälle getestet. Die ursprünglichen vollständigen Modellantworten und ein exakter Replay der früheren drei Gemma-Antworten liegen nicht vor. Für die nächste Live-Abnahme sind P4.1/P4.2, A3, A2 und fachliche Receipt-Qualität getrennt zu messen. Die Tests dieser Dokumentationsarbeit selbst waren nur lokale Lese-, Link- und Bestandsprüfungen; sie erzeugten keine Modellrequests.
