# World Engine: Kommunikationsprüfung

Stand: 11.11.2026, Workspace `N:\Horde Studio\app`.

## 1. Ursache des 61-Sekunden-Abbruchs

`interpretWorldAction` in `app.js` kombinierte den Turn-Abbruch mit einem zusätzlichen `AbortSignal.timeout(60000)`. Dieser übersteuerte die vorhandene Provider-Zeitsteuerung.

Ollamas lokaler `server.log` bestätigt zwei passende Vorgänge:

- 10.11., 23:54:48: llama-server startet Gemma; 23:55:47: `client connection closed before llama-server finished loading, aborting load`, anschließend HTTP 499 für `/v1/chat/completions`, Dauer 1m0s.
- 10./11.11., 23:59:27 bis 00:00:28: derselbe Ablauf.

Die Requests erreichten den Modellserver. Dieser lud noch die Gewichte und brach nach dem clientseitigen Abbruch ab. Es gab noch keine Completion und daher keine Usage-Daten. Die angezeigten 61 Sekunden entsprechen der 60-Sekunden-Frist plus Ablauf-/Messverzögerung; ein weiterer 61-Sekunden-Timer wurde nicht gefunden. Die Serverlogs enthalten keine World-Turn-IDs: Die Zuordnung zu den angegebenen IDs ist zeitlich und anhand des Fehlerbildes gestützt, nicht durch serverseitige ID-Korrelation.

Ein direkter Kontrollaufruf ohne Engine antwortete nach **120,523 Sekunden mit HTTP 200**. Die hierfür verwendete Diagnosefrist von 180 Sekunden ist keine Änderung der Produktions-Timeouts. Das absichtlich kleine Kontrollbudget von 32 Tokens führte allerdings zu reinem Reasoning und `finish_reason: length`: funktionierender Transport, keine nutzbare Textantwort.

## 2. Kommunikationskette

1. Enter/Eingabe → `executeWorldTurn`, Ausführungssperre, Snapshot, temporäre Anzeige.
2. Jetzt für lokales Ollama auf Port 11434: `/api/ps`; bei kaltem Modell `/api/chat` mit `messages: []`, `stream: false`. Das lädt das Modell ohne Spielzug.
3. `interpretWorldAction` → `fetchWorldTurnJSON` → `HordeWorldModelClient.json` → **direkt vom Browser** zu `${apiBase()}/chat/completions`. Die Python-Bridge ist hierfür kein Modellproxy.
4. OpenAI-kompatibles JSON mit `response_format: json_schema`, Schema `resolved_intent_v1`; anschließend Decoding, Normalisierung, Quellen-/Referenzprüfung und Kompilierung.
5. Scene Draft → Binding/Linked Executor/Reducer. Optional `/worlds/bind-turn` über Python → Node-Worker. Der Worker bindet/validiert, persistiert aber keinen Turn.
6. Separate Narration; freie Modellprosa entscheidet nicht über bestätigte Zustandsänderungen.
7. Detached Working State → Versionsprüfung → `persistPreparedWorldTurn` → lokale IndexedDB-Transaktion → Veröffentlichung des gespeicherten Kandidaten → Frontend.

Weitere World-Pfade benutzen HTTP-SSE mit `data:`-Zeilen, Tool-Deltas und Finish-Gründen; vollständige JSON-Completions werden ebenfalls unterstützt. Für diesen Foreground-Pfad wird kein WebSocket benötigt. Multiplayer hat einen separaten Host-/Gastpfad. AI Horde verwendet eine HTTP-Jobqueue mit Polling. `background-sim.js` arbeitet selbst lokal auf Zustandskopien.

## 3. Zeitgrenzen

| Schicht | Grenze nach Reparatur |
|---|---|
| Intent | Zusätzliche feste 60 s entfernt; vorhandener Model Client kontrolliert die Generierung |
| World Turn | **5 Minuten bleiben**, pausieren ausschließlich während eines erkannten Ollama-Kaltstarts |
| Kaltstart | Leerer nativer Chat, jederzeit Stop; Ollamas eigene Ladegrenzen bleiben unverändert |
| Ollama-Status | 5 s einschließlich Body |
| Lokale Generierung | `localGenerationTimeoutSeconds`, Standard 300 s; 0 deaktiviert diese einzelne Grenze, nicht die Turn-Frist |
| Hosted JSON/Streaming-Inaktivität | 45 s zusätzlich zur Turn-Frist |
| Deterministische Narration | Bis 180 s lokal, 45 s hosted |
| Resolved-Intent-Narration | Bis 45 s mit bestehendem sicheren Fallback |
| Binding | Frontend 20 s, Python-Node-Worker 15 s |
| Allgemeiner Bridge-Client | Standard 15 s, aufrufabhängige Überschreibungen |
| AI Horde | Submit 40 s, Status/Result 30 s, vorhandenes Queue-Budget 90 s und begrenzter 429-Backoff |

Die lokale Einstellung 0 wurde bei Narration zuvor zu `AbortSignal.timeout(0)`. Dieser unbeabsichtigte Sofortabbruch ist korrigiert. Es wurden keine generischen Retry-Schleifen ergänzt.

## 4. Probleme und Korrekturen

- Feste Intent-Frist unterbrach gültiges Modellladen: Kaltstart und Generierung getrennt; fünfminütige Verarbeitung bleibt gemäß Nutzerpräzisierung erhalten.
- Native `TimeoutError` wurde als `network_error` protokolliert: interne/externe Timeouts und Benutzerabbruch werden vor Headers und beim Body-Lesen getrennt klassifiziert.
- Intent-Catch verwandelte Transport-, HTTP- und JSON-Fehler in eine unverständliche Spielerhandlung: Ursachen werden jetzt weitergereicht. Nur semantische Validierungsfehler verwenden den bisherigen Intent-Fallback.
- Gemma verbrauchte bei der Originalaktion alle 1.000 Tokens für Reasoning, ohne Content: bestehende lokale Streaming-Policy `reasoning_effort: none` nun auch für JSON-Aufrufe. `finish_reason: length` wird ausdrücklich als abgeschnittene Intent-Antwort erkannt.
- Fehlendes Modell: `WORLD_MODEL_UNAVAILABLE`; Ladefehler: `WORLD_MODEL_LOAD_FAILED`; Intent-Syntaxfehler: `WORLD_INTENT_INVALID_JSON`; Speicherfehler: `WORLD_TURN_PERSISTENCE_FAILED`. Diagnoseeinträge enthalten zusätzlich den Fehlercode.
- Modulfehler nennen nun die fehlenden Globals. Der frühere Static-Route-Fix für `resolved-intent.js` wurde am echten HTTP-Handler überprüft.
- AI-Horde-Fristen endeten bereits nach Headers: sie umfassen jetzt den Body und lösen auch bei hängenden Lese-Promises aus. Polling-Abbruchlistener werden bereinigt.
- Bei fehlerhaftem/abgebrochenem SSE-Lesen werden Generation und Reader ebenfalls abgebrochen.
- Fehler nach erfolgreichem Speichern konnten einen Turn als ungespeichert behandeln: Finalisierungsflag unmittelbar nach Commit setzen; keine Eingabe zur Wiederholung herstellen, wenn bereits gespeichert wurde; entsprechende Meldung anzeigen.
- Frontend-Cache-Versionen aktualisiert.

Produktionsdateien: `app.js` (`executeWorldTurn`, JSON-/Streaming-Wrapper, Intent-Auflösung, Persistenz und Fehlerdarstellung), `worlds/model-client.js` (Transport/Kaltstart), `worlds/horde-client.js` (Queue-Transport), `index.html` (Cache-Versionen). Der Static-Route-Fix in `horde_mcp_bridge.py` stammt aus dem vorherigen Arbeitsabschnitt. Vorhandene fremde Änderungen wurden nicht zurückgesetzt.

## 5. Tests

### Live: gemma4:31b-it-q4_K_M

- Installiertes Modell, Ollama-Katalog und llama.cpp-Runner anhand des lokalen Servers geprüft.
- Direkter Kaltaufruf: HTTP 200 nach 120,523 s; `scratch/world-communication-direct.json`.
- Exakter Intent-Prompt und Schema über internen Model Client mit kleiner Referenzwelt: minimale Eingabe vor Korrektur 3,187 s, gültig. Originalaktion vor Korrektur 16,326 s, 1.000 Tokens Reasoning, leerer Content und `length`.
- Mit Gemma-Policy: minimale Eingabe **2,003 s**, Originalaktion **2,729 s**, jeweils HTTP 200, `stop`, gültiges Intent-JSON. Ergebnisse: `scratch/world-communication-intent-fixed.json` und `world-communication-intent-live.json`.
- Nativer leerer Ollama-Chat zum Laden erfolgreich geprüft; das Modell war dabei bereits warm. Kein zweites absichtliches Entladen des großen Modells.

### Automatisiert bestanden

| Testdatei unter scratch/ | Ergebnis/Abdeckung |
|---|---|
| world_communication_audit.js | Externe Timeouts vor Headers/im Body, fehlendes Modell, kalt/warm, andere Provider ohne Ollama-Probe, Stop beim Laden |
| world_horde_transport_audit.js | Hängender HTTP-200-Body, Timeout, Stop, Queue-Erfolg ohne doppelte Submission |
| world_model_client_audit.js | Bestehende Transport- und Body-Deadline-Verträge |
| world_resolved_intent_browser_audit.js | Lokal und servergebunden: sechs Kommunikationsfehlerfälle, Eingabeerhalt, kein History-/Versionszuwachs, ein Generierungsaufruf; zusätzlich acht Aktionsszenarien, Reroll, paralleles Absenden, Speicher-Rollback, Save/Reload |
| worlds2_hosted_turn_deadline_browser_audit.js | Idle/Keepalive, Fortschritt, Stop, Fünf-Minuten-Grenze lokal/hosted; Kaltstart länger als simulierte Turn-Frist, anschließend Generierung und Frist |
| worlds2_provider_response_browser_audit.js | SSE/JSON, Tool/Inline, nicht unterstützte Tools, fehlerhafte/leere/HTTP-Antworten, hängender Body und Abbruch |
| world_server_binding_audit.js | IDs, Dialog, Effekte, Deadlines, Truncation, Repair-Erhalt, Rollback |
| world_working_state_audit.js | Transaktions- und Versionsschutz |
| world_turn_transaction_audit.js | Receipt- und Timeline-Transaktionsschutz |
| world_static_route_audit.py | Sieben World-Skripte über echten Bridge-Handler: HTTP 200 und JavaScript-MIME |

JavaScript-Syntaxprüfung und `git diff --check` bestanden. Browser-/Node-Subprozessstarts waren zunächst in der Sandbox blockiert; die betreffenden Tests liefen nach automatisch geprüfter Eskalation mit isolierten Browserprofilen erfolgreich. Ein erster Deadline-Test scheiterte an einer relativen Laufzeitassertion; nach Ergänzung der lokalen Warm-/Kaltlade-Fixtures bestanden die finalen Durchläufe. Der Kaltstart-Deadline-Test skaliert Timer und ist kein zehnminütiger Echtzeittest.

## 6. Grenzen und verbleibende Risiken

- Der persönliche Weltzustand wurde nicht durch einen neuen Spielzug verändert. Live-Tests benutzen die originale Eingabe mit kleiner Referenzwelt; die vollständige Persistenzstrecke wurde mit kontrollierten Modellantworten im Browser geprüft. Persönliche NPC-/Weltreferenzen sind damit nicht abschließend bewiesen.
- Kaltstarttrennung ist gezielt auf Ollama-Port 11434 begrenzt. Andere lokale Provider sowie abweichende Ports/Proxys behalten ihren bisherigen Pfad.
- Während erkannten Kaltstarts gibt es absichtlich keine World-Turn-Frist. Bei dauerhaft hängendem Modellserver bleibt Stop nötig. Ollamas eigene Ladegrenzen wurden nicht verändert.
- Browser melden CORS, Netzunterbrechung und manche Nichterreichbarkeitsfälle identisch als TypeError. Ohne konkrete Evidenz wird keine genaue Netzursache behauptet. Ein verfügbares ECONNREFUSED wird gesondert erkannt.
- Andere kostenpflichtige Provider wurden mit Protokoll-Fixtures, nicht mit bezahlten Live-Aufrufen geprüft; AI-Horde-Tests sind offline.
- Schutz vor doppelten Turns wurde für parallele Eingaben und Wiederholungen innerhalb der bestehenden lokalen Architektur geprüft. Keine neue serverübergreifende Exactly-once-Garantie eingeführt.

Nach Neuladen müssen die geänderten Skripte die Version `20261111-communication` zeigen. Falls noch eine Bridge ohne früheren Static-Route-Fix läuft, ist zusätzlich deren Neustart notwendig.
