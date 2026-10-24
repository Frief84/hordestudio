# P2.8 – Story Continuity und sichere Turn-Recovery (24.10.2026)

## Implementierung

Der produktive gebundene V3-Pfad unterscheidet nun im vorhandenen Receipt-Audit `clean`, `repaired` und `recovered`. Fehlgeschlagene Turns erhalten im vorhandenen `worldCallDiagnostics`-Ring einen `failed`-Eintrag. Die Datensätze enthalten Turn- und Diagnose-ID, Modell, ursprüngliche und spätere Fehler, Reparaturergebnisse, verworfene Teile, bestätigte Effekte, Aufrufzeiten und gemeldete Tokens. Rohvorschläge sind auf 4.000 Zeichen pro Fehler und vier gespeicherte Fehler begrenzt; die letzten 25 fehlgeschlagenen Turns bleiben erhalten.

Die bestehende Reparatur erhält für fehlende Bewegungswirkung jetzt die betroffene Action, die behaupteten Actor-/Raumwechsel, das nötige `actor_move` mit `companion_ids` sowie die dazugehörigen abgeschlossenen Events. Für Request-Coverage, ungültige Vorbedingungen, Conditions, Journey-Beginn und unbelegte NPC-Ankunft/Abreise gibt es gezielte Korrekturhinweise. Die zwei vorhandenen Modell-Reparaturversuche und der Abbruch identischer Fehlversuche bleiben bestehen.

Nach erschöpfter Reparatur kann die Engine ausschließlich unverifizierte Reactions verwerfen oder bei einer bereits vom Modell als `attempted` bezeichneten Action deren unzulässige Effekte entfernen. Bestätigte Effekte und Events sind durch die vorhandene Repair-Loss-Prüfung geschützt. Der so gebildete **vollständige** Kandidat durchläuft erneut Server-Binding, Draft-Compiler, Linked-Action-Executor, Working-State-Abgleich, Narrationsprüfung und atomare Persistenz. Eine behauptete Ankunft ohne Bewegungseffekt bleibt ungültig; die Engine erfindet weder einen Ortswechsel noch eine NPC-Verweigerung.

Der ursprüngliche Modellvertrag fordert für physische NPC-Interaktionen nun eine konkrete, situationsgerechte Reaktion, sofern die Szene sie stützt. Er verlangt keine standardisierte Verweigerung.

## Deterministische Gegenproben

`world_server_binding_browser_audit.js` wurde erweitert. Alle folgenden Fälle bestehen; Zeiten sind lokale Mock-Browserzeiten und **keine** Modelllaufzeiten.

| Fall | Status | Modellaufrufe | Dauer | Ergebnis |
|---|---|---:|---:|---|
| Direkte Antwort | clean | 1 | 195 ms | Receipt und Save stimmen überein |
| Korrigierter Outfit-Turn | repaired | 3 | 337 ms | Ursprünglicher Fehler im Audit erhalten |
| Ungültige optionale NPC-Reaction | recovered | 2 | 475 ms | Reaction verworfen; Antwort und Save erhalten |
| Versuch mit unzulässigem Effekt | recovered | 2 | 496 ms | Versuch erhalten; kein Effekt oder NPC-Ortswechsel |
| Behauptete gemeinsame Ankunft ohne Effekt | failed | 2 | 293 ms | Keine Weltänderung; gespeicherte Fehlerdiagnose |
| Gemeinsamer NPC-Ortswechsel | clean | 1 | 315 ms | `actor_move`, zwei Bewegungs-Events und beide Positionen im Save |
| Korrigierter gemeinsamer NPC-Ortswechsel | repaired | 2 | 469 ms | Fehlendes `actor_move` gezielt repariert; beide Positionen im Save |
| Gegenstand aufgenommen | clean | 1 | 321 ms | `item_transfer`, Inventar-Event und Save |
| NPC befolgt Aufforderung | clean | 1 | 293 ms | Eigenständige Antwort ohne erfundene Zustandsänderung |
| NPC verweigert Aufforderung | clean | 1 | 283 ms | Belegte Verweigerung ohne automatische Engine-Entscheidung |
| NPC-Zustand geändert | clean | 1 | 342 ms | Bestätigter Outfit-Effekt mit NPC-Event |
| Teilerfolg | clean | 1 | 364 ms | Outfit-Erfolg erhalten; körperlicher Versuch scheitert ohne Ortswechsel |

Für diese zwölf gezielten Läufe: `clean` 7, `repaired` 2, `recovered` 2, `failed` 1; durchschnittlich 1,50 Modellaufrufe, maximal 3. Die Mock-Antworten melden keine Anbieter-Tokens. Die bestehenden Linked-Execution-, Contract-, Hardening-, Generalization-, Scene-Draft- und Repair-Budget-Audits bestehen ebenfalls. Der Browser-Audit prüft Save/Reload und Rollback.

## Live-Gegenprobe

| Modell und Lauf | Status | Aufrufe | Modellzeit | Gemeldete Reparaturtokens | Befund |
|---|---|---:|---:|---:|---|
| Qwen T08, erster Lauf | failed | 3 | 15,158 s | 2.304 Ein / 406 Aus | Drei alternative `pending_check`-Actions für denselben Input; `request_coverage_mismatch` |
| Qwen T08, verschärfter Coverage-Hinweis | failed | 3 | 115,457 s | 2.320 Ein / 649 Aus | Erneut drei kopierte Speech-Actions; `request_coverage_mismatch` |
| Gemma T08 | failed (Timeout) | 1 | 300,046 s | unbekannt | Kein Modell-Draft vor Timeout; History und Save blieben leer |

Die Streaming-Hauptaufrufe meldeten keine auswertbaren Tokens. Rohdaten liegen in `scratch/world_p28_qwen_t08.json`, `scratch/world_p28_qwen_t08_after_coverage.json` und `scratch/world_p28_gemma_t08.json`. Der verschärfte Coverage-Hinweis wurde im zweiten Qwen-Reparaturprompt nachweislich gesendet, aber das Modell befolgte ihn nicht.

Über diese drei Live-Läufe: `clean` 0, `repaired` 0, `recovered` 0, `failed` 3; durchschnittlich 2,33 Modellaufrufe, maximal 3. Die drei Modellzeiten sind oben getrennt ausgewiesen. Ein erfolgreicher gemeinsamer NPC-Ortswechsel ist **deterministisch im produktiven Browserpfad**, einschließlich Events und Save, belegt. Ein solcher Erfolg mit einem echten Modell ist bislang nicht belegt. Die verbleibende Ursache ist bei Qwen die wiederholte Request-Coverage-Verletzung, bei Gemma ein Provider-Timeout; die Validierung wurde dafür nicht abgeschwächt.
