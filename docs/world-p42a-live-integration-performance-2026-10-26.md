# P4.2a – Live-Integration und Gemma-Laufzeit (26.10.2026)

## Befund und Freigabe

Die deterministische P4.1-/P4.2-Verarbeitung besteht weiterhin. Die P4.2-Live-Integration ist **noch nicht ausreichend zuverlässig für die nächste Freigabe**: Der kontrollierte echte Inschriften-Turn wurde auch nach zwei Reparaturen nicht gespeichert. Die neue Antwort endete mit `pending_action_requires_check`; die abschließende Promptpräzisierung zu automatischen Universalchecks konnte wegen des ausgeschöpften Budgets nicht erneut live geprüft werden. Der gespeicherte Energiewert blieb 5. Ein erfolgreicher Live-Check mit bestätigter Abbuchung ist damit nicht belegt.

## Aufrufkette und Ursachen

`executeWorldTurn` baut Welt-, Szenen-, Erinnerungs- und Schema-Kontext auf, sendet eine gestreamte Hauptgenerierung und bindet deren Scene Draft serverseitig. Ungültige Vorschläge durchlaufen den vorhandenen P2.8-Reparaturpfad mit vollständiger erneuter Validierung. Der Linked-Executor wertet P4.1-Universalchecks lokal aus und leitet P4.2-Kosten aus dem bestätigten Ergebnis ab. Er prüft Ressourcen vorab, bucht im Working State, erzeugt Receipt-Belege und schützt Wiederholung über das bestehende Ledger. Für diese Check-Verarbeitung gibt es keinen Modellrequest. Die Live-Proben benötigten einen Hauptrequest und bei Ablehnung bis zu zwei Reparaturrequests. Weitere vorhandene Modellpfade (etwa Narrativ-Follow-up und Klassifikator) wurden in diesen Proben nicht als zusätzliche Requests beobachtet.

Die dokumentierten langen Fälle sind überwiegend Modellzeit: der frühere T03-Turn 242,2 von 242,6 s, der frühere P4.2-Fall 179,6 von 180,1 s. Die aktuellen P4.1-/P4.2-Turns verbrachten 54,8 von 55,2 s beziehungsweise 106,7 von 107,2 s in den gemessenen HTTP-Modellrequests. Die Differenz enthält Binding, Validierung und Browserarbeit; deren Einzelzeiten sind noch nicht vollständig isoliert. Ein Hardware- oder Cold-Start-Grund ist aus diesen Daten nicht ableitbar.

Das Modell wurde über das lokale Ollama als `gemma4:31b-it-q4_K_M` erkannt und war beim Prüfen geladen. `/api/ps` meldete ein effektives Kontextfenster von 32.768; `/api/show` meldete 262.144 als Modellfähigkeit sowie `temperature 1`, `top_k 64`, `top_p 0.95` und `draft_num_predict 3` als Modellparameter. Die Live-World konfigurierte Kontextgröße 32.768; der tatsächlich gesendete Hauptrequest setzte `max_tokens: 8192` und `reasoning_effort: none`. Die beiden Reparaturrequests enthielten kein `reasoning_effort`. Ob der Provider intern trotzdem Reasoning berechnete, ist nicht messbar. Die historische Gemma-4-Optimierung `reasoning_effort: none` ist im Hauptpfad weiterhin aktiv.

Der aktuelle Hauptrequest enthielt rund 31.700 Zeichen Nachrichten plus rund 32.800 Zeichen separates JSON-Schema. Dieses Schema ist der größte einzeln messbare Promptblock. Die P4.1-/P4.2-Regeln wurden vor der Korrektur nicht als gezielte Ergebnis-Capabilities erklärt; das allgemeine Schema bot `knowledge_share` trotzdem an. Die neue Regelbeschreibung enthält nur Regeln mit passendem `requestIncludes` oder ohne solchen Filter und nennt je Ergebnis die erlaubten Effect-Arten. Interne Kosten werden nicht als Modell-Effect angeboten. Eine weitere Reduktion des allgemeinen Schemas oder anderer Weltinformationen wurde ohne Beleg ihrer sicheren Entbehrlichkeit nicht vorgenommen.

Die Ollama-v1-Streams lieferten in diesen Proben keine auswertbaren `usage`- oder nativen Load-/Prompt-/Output-Evaluationswerte. Echte Prompt- und Output-Tokens, Tokenrate und Cold-Start-Anteil bleiben unbekannt. Stream-Zeichen enthalten SSE-Rahmen und sind keine Tokenzahl. Der Diagnosepfad übernimmt künftig Provider-Timings und Tokenzähler, **falls** der Provider sie liefert, und trennt erste inhaltliche Ausgabe vom ersten beliebigen Token. Es werden keine Rohprompts oder Reasoning-Inhalte neu gespeichert.

## `knowledge_share` und Modellvertrag

Der bekannte frühere Inschriftenfall ist im lokalen Bericht `world-p4-reliability-first-plan-2026-10-25.md` mit drei Requestzeiten (11,7 / 62,4 / 105,5 s) beschrieben. Die zugehörigen drei vollständigen Modellantworten lagen in den lokalen `scratch`-JSON-Dateien nicht mehr vor; die bestehende Ergebnisdatei enthielt inzwischen T08. Ein exakter Replay dieser drei Antworten war deshalb nicht möglich. Die dokumentierte Ablehnung `check_effect_not_allowed` ist sachlich korrekt: Die Inschriftenregel erlaubt in Erfolg und Fehlschlag keine modellwählbaren Effects, während `knowledge_share` nur allgemein im Effect-Schema vorkommt. Die ursprüngliche Reparaturmeldung nannte den konkreten ungültigen Effect und das tatsächlich erlaubte Ergebnis nicht hinreichend deutlich. Dies war eine Vertragsunklarheit zusätzlich zum Modellfehler.

Der Executor liefert bei `check_effect_not_allowed` nun Action-ID, abgelehnten Effect und die bestätigten Regel-/Ergebnis-IDs samt erlaubten Effect-Arten. Der bestehende Reparaturprompt erklärt den Fehler und fordert eine semantisch ehrliche Korrektur bei unveränderter Spielerabsicht. Der Hauptprompt erklärt aktive Universalregeln, Voraussetzungen und Ergebnis-Capabilities. Ein weiterer Live-Fall zeigte die Verwechslung mit `pending_check`; der Prompt unterscheidet daher automatische Universalchecks ausdrücklich von optionalen Würfelchecks. Es gibt keine neuen Pflichtfelder, keine neue Modellpipeline und keine erweiterte Registry-Freigabe. Autorisierung und vollständige Validierung bleiben ausschließlich beim Executor.

## Kontrollierte Prüfungen

Der neue Negativfall in `world_p42_resource_cost_audit.js` schlägt `knowledge_share` bei einer Check-Action vor. Er bestätigt `check_effect_not_allowed`, die spezifische Reparaturinformation, keine bestätigten Effects und unveränderte Ressourcen. Der bestehende positive Fall bestätigt Erfolg, erlaubten leeren Effect-Satz, Kosten, Event, Receipt und Working-State-Wert; weitere Fälle prüfen Teil-/Fehlschlag, Rollback, Replay und Legacy-Welten. Dies sind kontrollierte Entwürfe, kein Replay der verlorenen Gemma-Antworten.

Bestanden: `world_general_turn_matrix_audit.js` (190/190), `world_server_binding_audit.js`, `world_linked_execution_audit.js`, `world_linked_hardening_audit.js`, `world_p41_universal_checks_audit.js`, `world_p42_resource_cost_audit.js`, `world_turn_transaction_audit.js`, `world_working_state_audit.js`, `world_turn_context_audit.js`, `world_model_client_audit.js`, `worlds2_model_attempt_audit.js`, `worlds2_life_seed_timeout_audit.js` und `worlds2_life_seed_model_skip_audit.js`. Im vorhandenen Chrome bestanden `world_server_binding_browser_audit.js`, `world_p42_resource_cost_browser_audit.js`, `world_p41_linked_turn_browser_audit.js` und `worlds2_hosted_turn_deadline_browser_audit.js`; letzterer bestätigt die harte Fünf-Minuten-Grenze. Diese Audits verwenden kontrollierte Antworten und belegen keinen Gemma-Erfolg.

## Begrenzte Live-Abnahme

Die Abnahme verwendete drei vollständige Turn-Versuche und insgesamt sechs lokale Modellrequests. T03 löste einen Request aus und erreichte das Binding; der Testprozess konnte seine Ergebnisdatei wegen `EPERM` unter `N:\Horde Studio\app\scratch` nicht schreiben. Der Abschlusszustand dieses Versuchs ist deshalb unbekannt und wird nicht als Erfolg gewertet. Der Harness gibt für spätere Läufe kompakte Diagnosen auch auf stdout aus. Für P4.1 und P4.2 wurden die verbleibenden Requests fest begrenzt. Es gab keine Cloud-Anfrage.

| Fall | Prompt-Tokens | Output-Tokens | Modellzeit | Gesamtdauer | Requests | Reparaturen | Commit |
|---|---:|---:|---:|---:|---:|---:|---|
| T03 aktuell | unbekannt | unbekannt | unbekannt | unbekannt | 1 | unbekannt | unbekannt |
| P4.1 Inschrift | unbekannt | unbekannt | 54,8 s | 55,2 s | 2 | 1 | nein (`unverified_action_success`) |
| P4.2 Inschrift | unbekannt | unbekannt | 106,7 s | 107,2 s | 3 | 2 | nein (`pending_action_requires_check`) |
| T03 früher | unbekannt | unbekannt | 242,2 s | 242,6 s | 1 | 0 | ja |
| P4.2 früher | unbekannt | unbekannt | 179,6 s | 180,1 s | 3 | 2 | nein (`check_effect_not_allowed`) |

P4.1-Hauptrequest: 31.735 Nachrichtenzeichen, 32.796 Schemazeichen, 104.388 Stream-Zeichen, 27,5 s. P4.2-Hauptrequest: 31.731 Nachrichtenzeichen, 32.796 Schemazeichen, 272.540 Stream-Zeichen, 33,4 s. Die P4.2-Reparaturen dauerten 22,3 und 51,1 s. Die Stream-Zahlen messen Transporttext mit SSE-Rahmen; sie erklären keine Output-Tokenzahl. Zeit bis zum ersten inhaltlichen Token, Validierung und Persistenz wurden in diesen Konsolenergebnissen nicht getrennt ausgegeben. Beide abgelehnten Live-Turns ließen `energy` live und gespeichert bei 5; es gab keinen bestätigten Receipt oder Ressourcen-Commit. Die erste P4.1-Antwort war nicht gültig, und die Reparatur blieb ungültig. Die erste P4.2-Antwort war ebenfalls nicht gültig; auch beide Reparaturen wurden abgelehnt. Ein ungültiges Action Binding oder fehlender Event ist für diese Läufe aus den kompakten Ausgaben nicht genauer zu unterscheiden. Ein regelkonformer Misserfolg mit atomarem Commit trat nicht ein.

Die historischen 7,9–13,6 s und etwa 10,8 s bleiben Vergleichswerte aus anderen Läufen. Die neuen Werte zeigen stark unterschiedliche Antwort-/Reparaturzeiten, aber keine gemessene Prompt-Evaluation, Tokenrate oder Load-Dauer. Das Ziel unter drei Minuten wurde für die beiden vollständig gemessenen aktuellen Turns zeitlich erreicht, jedoch ohne erfolgreichen Commit. Die harte Grenze von fünf Minuten blieb unverändert.

## Geänderte Dateien und offene Punkte

- `app.js`: gezielte Universalcheck-Capabilities, eindeutige Trennung von automatischem Check und optionalem `pending_check`, präziser Reparaturhinweis, optionale Provider-Timings und erste Inhaltsantwort im Diagnosepfad.
- `worlds/linked-world-actions.js`: konkrete Diagnosedaten für abgelehnte Check-Effects; unveränderte Autorisierung.
- `worlds/model-client.js`: optionale Provider-Metadaten an den bestehenden Diagnosepfad.
- `scratch/world_p42_resource_cost_audit.js`: positiver Bestandspfad und neuer negativer Effect-Gegenfall.
- `scratch/world_linked_ollama_live_audit.js`: P4.1-Probe, kompakte Metadaten statt Rohprompt/-stream, Request-Limit und stdout-Ausgabe bei nicht beschreibbarem Ziel.

Offen sind ein erfolgreicher echter P4.2-Check mit bestätigter Abbuchung, ein exakter Replay der früheren drei Antworten (nicht mehr lokal vorhanden), echte Provider-Token-/Evaluationsmetriken und eine Live-Prüfung der letzten Promptpräzisierung innerhalb eines neuen, ausdrücklich freigegebenen Testbudgets. Die technischen Schutzregeln, das Drei-Minuten-Ziel und die harte Fünf-Minuten-Grenze wurden nicht abgeschwächt.
