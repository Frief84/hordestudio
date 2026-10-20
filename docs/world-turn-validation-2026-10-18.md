# World-Turn-Validierung – 18. Oktober 2026

## Ursachen

| Fehler | Ursache im bisherigen Pfad | Änderung |
| --- | --- | --- |
| `events.0.action_id` | Das Modell musste Ereignis, Aktion und Antwortpassage über mehrfach wiederholte IDs verbinden. Fehlende Verweise wurden nur in einzelnen Sonderfällen ergänzt. | Im Standardpfad stehen Antworten und Ereignisse innerhalb ihrer Aktion. `/worlds/bind-turn` vergibt Aktions- und Passage-IDs und erzeugt den kanonischen Draft. Modellseitige Verknüpfungs-IDs werden abgewiesen. |
| `ambiguous_action_passage` | Mehrere Aktionen konnten dieselbe vom Modell benannte Passage beanspruchen; gleichlautender Text löste die Mehrdeutigkeit nicht auf. | Strukturelle Elternschaft statt Textvergleich oder erratener IDs. Auch identische Antworten verschiedener Aktionen erhalten getrennte IDs. Mehrteilige Requests werden serverseitig gegen zusammenhängende Ausschnitte der vollständigen Eingabe geprüft. |
| `deadline_before_world_time` / `new_commitment_in_past` | Offene Gesprächspläne konnten als Verpflichtung erscheinen. Der Quest-Kontext forderte zudem zu weitgehend neue Quests bei Warnungen und Fristen. Der Linked-Pfad erhöhte die normale Spielzugzeit erst nach der Prüfung. | Keine Verpflichtung für gewöhnlichen Dialog. Neue Quests und Fristen benötigen einen belegten Ausschnitt der aktuellen Spieleräußerung; vorhandene IDs bleiben verwendbar. Der normale Zeitschritt wird vor der Generierung auf einer abgetrennten Kopie geplant. Fristen werden auch gegen die tatsächlich resultierende Uhr geprüft und niemals geraten oder automatisch verschoben. |
| `truncated_receipt` | Ein HTTP-Erfolg oder parsebares JSON garantiert keine abgeschlossene Ausgabe. Die ursprünglichen Ausgabelimits konnten außerdem zu wenig Platz für das gesamte Receipt lassen. | `finish_reason:length` bleibt grundsätzlich uncommittbar. Begrenzte Neugenerierung mit erweitertem Budget, höchstens zwei Reparaturanfragen; erneute Trunkierung kann bis 16.384 Ausgabetokens erhalten, begrenzt durch bekannten Provider- und Kontextplatz. Bei zu wenig Platz erfolgt ein klarer Abbruch statt Übernahme eines Teil-Receipts. |

Die ursprünglichen Provider-JSONs aus der Fehlermeldung lagen nicht vor. Die Ursachen sind durch Codepfade und strukturell entsprechende Regressionen belegt; keine Aussage darüber, welches zusätzliche Feld ein historischer Provider tatsächlich erzeugte.

## Umsetzung und Integrität

- `worlds/turn-binding.js` definiert den verschachtelten Transport und bindet ihn an den bisherigen V3-Compiler. Der Node-Worker bildet stabile IDs aus World, Session, Basisversion, Turn-Nonce und Originaleingabe. Reparaturen desselben Turns verwenden denselben Rahmen. Die Zuordnung wird im Receipt mit Passagen und Eingabespannen gespeichert.
- Reine Dialoge und Gesten akzeptieren `effects: []`. `kind: gesture` erhält nur ein informatives Interaktionsereignis; es erzeugt keine dauerhafte Mechanik. Eigenständige NPC-Reaktionen stehen in `reactions` und dürfen selbst keine freiwillige Spielerreise entscheiden. Echte NPC-Bewegungen bleiben an Effekte, Akteure, Wege und Zugangsprüfungen gebunden.
- Bekannte Effekte werden strukturiert geprüft. Nur unbekannte **leere** optionale Platzhalter werden lokal entfernt und im Audit vermerkt. Nichtleere fehlerhafte Vorschläge gehen mit genauer Fehlerposition in die Reparatur. Unabhängige gültige Operationen werden über alle Reparaturversuche geschützt, einschließlich einer zwischenzeitlich abgeschnittenen Reparatur. Ein verworfener Array-Eintrag erlaubt nicht das Löschen gültiger Geschwister; doppelte Operationen behalten ihre Anzahl.
- Normale Turn-Zeit und explizite Wartezeit werden nicht doppelt addiert. `time_skip_minutes` bleibt kompatibel; kurze positive Werte können verlustfrei über `time_advance` ausgeführt werden. Lange bestehende Zeitoperationen behalten ihren bisherigen Adapter.
- Ein weiterer Browser-Befund wurde korrigiert: Ein NPC durfte zunächst antworten und anschließend abreisen, wurde aber zuvor anhand der Endbesetzung fälschlich als unzulässig anwesend erkannt. Die Anwesenheitsprüfung folgt jetzt den serverseitig gebundenen Passagen und validierten Bewegungen. Ein erneutes Auftreten nach der Abreise ohne Rückkehr-Effekt bleibt ungültig.
- Erzählung, Passagen, Uhr, Effekte und Zustandsversion gehen gemeinsam über den vorhandenen Working-State-/IndexedDB-Commit. Die kanonische Welt bleibt bis erfolgreicher Persistierung unverändert. Der Receipt-Uhrwert wird gegen den Kandidaten geprüft. Tatsächliche Verpflichtungen und deren Auflösungen werden im selben Kandidaten angewendet.
- Fehlgeschlagene Linked-Turns behalten nun auch den ursprünglichen Validierungsgrund in den Diagnoseeinträgen. Der Director zeigt ihn an. Die Eingabe bleibt erneut absendbar.

V2 und der frühere flache V3-Replay-Pfad bleiben erhalten. Die historischen Browser-Fixtures wählen mit `serverBindings:false` ausdrücklich diesen Replay-Pfad; der normale Linked-Pfad verwendet standardmäßig die Serverbindung. Keine Zustands-, Routen-, Check- oder Persistenzprüfung wurde abgeschaltet.

## Verifikation

Bestanden:

- `scratch/world_server_binding_audit.js`: Server-IDs, Eingabespannen, kurze/lange Dialoge, Gesten, Aslan/Lorne, NPC-Reaktionen und Bewegung, echte Zustandsänderungen, Quest-/Fristbelege, optionale Effekte, Schutz gültiger Geschwister, Trunkierung und Rollback.
- `scratch/world_server_binding_http_audit.py`: tatsächlicher Python-HTTP-Endpunkt und Node-Worker; stabile IDs bei Wiederholung und Ablehnung modellseitiger IDs. Isolierte Konfiguration und eigener temporärer Port.
- `scratch/world_server_binding_browser_audit.js`: gesamter Standardpfad mit gemocktem Provider und serverseitig ausgeführtem Worker, Speicherung und Reload. Enthält zwei aufeinanderfolgende Trunkierungen, gültigen Effekt plus fehlerhafte Frist, Verlustschutz auch nach abgeschnittener Reparatur, tatsächlichen Termin, genaue Wartezeit, zulässige NPC-Abreise, verbotene Anwesenheit danach und simulierten Speicherfehler.
- Bestehende Audits: `world_linked_contract_audit.js`, `world_linked_hardening_audit.js`, `world_linked_execution_audit.js`, `world_linked_generalization_audit.js`, `world_scene_draft_audit.js`, `world_latency_audit.js`, `world_receipt_repair_budget_audit.js`, `worlds2_gate_receipt_regression.js`, `worlds2_route_escort_regression.js`.
- Bestehende Browser-Audits: `world_linked_turn_browser_audit.js`, `world_linked_chain_browser_audit.js`, `world_scene_draft_browser_audit.js`, `worlds2_atomic_turn_persistence_browser_audit.js`.
- JavaScript-Syntaxprüfung, Python-Syntaxprüfung und `git diff --check` für die betroffenen Dateien.

Browser-Tests verwenden das gebündelte Playwright und lokales Chrome. Reale Modellanbieter wurden nicht aufgerufen. Die Aslan/Lorne-Regression speichert den charaktergerechten Lorne-Dialog ohne zusätzliche Quest oder Verpflichtung.

## Betrieb und verbleibende Grenzen

Der lokale Horde-Studio-Server muss nach dem Update neu gestartet und die Seite neu geladen werden, damit der neue Endpunkt und die Skripte zusammen aktiv sind. Node.js 18+ ist für den Bindungs-Worker erforderlich. Bestehende Speicherstände bleiben in ihrer bisherigen Browser-Datenbank; die Serverbindung verschiebt die Speicherung nicht auf einen neuen Dienst.

Die Engine kann strukturelle Belege und Weltregeln prüfen, aber nicht jede Bedeutung freier Prosa beweisen. Ein Modell kann eine belegte Äußerung semantisch falsch als Zustimmung deuten oder unpassend reagieren. Der Ausschnittsnachweis ersetzt keine allgemeine Sprachverständnisgarantie. Unterbleibt auch nach begrenzter Reparatur eine gültige Ausgabe, bleibt der Turn ungespeichert und die Eingabe erhalten. Unbekannte Provider-Grenzen, sehr wenig Kontext und Netzwerkfehler können weiterhin einen solchen Abbruch verursachen. Es werden keine unvollständigen oder erfundenen Ersatzreaktionen als gelungene Turns gespeichert.

Alle Änderungen liegen lokal im bestehenden Working Tree; kein Commit, Push oder Release.
