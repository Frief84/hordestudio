# World-Turn-Stabilisierung: Prüfbericht

Stand: 17. Oktober 2026. Getestet im lokalen Checkout des Forks `Frief84/hordestudio`; kein Merge oder Push.

## Befunde zu den gemeldeten Fehlern

| Fehler | Nachweis und Ursache | Korrektur | Test |
| --- | --- | --- | --- |
| F1 `new_commitment_in_past` | Reproduziert: Ein Modell-Draft schlägt für ein Gespräch über Aslan einen bereits vergangenen Termin vor. Der Compiler lehnt ihn ab; ein früherer lokaler Eingriff entfernte ihn anhand einer englisch/deutschen Wortliste still. Diese Wortliste konnte Termine in anderen Sprachen verlieren. | Die sprachabhängige Löschung wurde entfernt. Der Compiler lehnt vergangene Termine weiterhin ab. Eine begrenzte Modellreparatur kann den Dialog ohne Termin erneut vorschlagen; vor erfolgreichem Commit erscheint kein Modelltext als gespeicherter Turn. | `world_scene_draft_audit.js`, `world_linked_turn_browser_audit.js`, `world_latency_audit.js` |
| F2 `events.0.action_id` | Reproduziert: Bei mehreren Aktionen hatte ein Ereignis einen gültigen, eindeutig einer Aktion zugeordneten `passage_id`, aber keine `action_id`. Der bisherige Compiler ergänzte die ID nur für Dialogereignisse oder einfache Einzelaktionen. | Eine fehlende ID wird aus der eindeutigen Passage-Beziehung ergänzt, auch bei verketteten physischen Aktionen. Explizit falsche IDs, doppelte Passage-IDs und Mehrdeutigkeit bleiben Fehler. Eine komplexe physische Einzelaktion ohne explizite Referenz bleibt prüfpflichtig. | `world_linked_contract_audit.js` (einschließlich 128 Varianten mit Seed `0x5eed1234`), `world_linked_hardening_audit.js` |
| F3 `response_missing_from_scene` | Reproduziert: Die Mindestlänge von acht Zeichen wies kurze gültige Antworten wie `Ja.` ab, obwohl sie im referenzierten Passage-Text standen. | Eine Antwort muss nichtleer, lesbar und in der Szene enthalten sein; die willkürliche Mindestlänge entfällt. Ein einzelner langer Gesprächsbeitrag kann seine Anfrage aus dem gesamten Player-Input erhalten, sofern er als effektfreier Sprech- oder Frage-Turn strukturiert ist. | `world_scene_draft_audit.js`, `world_linked_contract_audit.js` |
| F4 Ausgabe nur `"` | Reproduziert als rohe Providerantwort und als strukturierter Draft mit einer Passage `"`. Der bisherige Lesbarkeitstest akzeptierte ein isoliertes Anführungszeichen. | Der zentrale Draft-Compiler und die Anzeigeprüfung behandeln reine Anführungszeichen nicht als lesbare Szene. Der rohe Fall durchläuft höchstens die begrenzte Reparatur und wird ohne gültige Antwort nicht gespeichert. | `world_scene_draft_audit.js`, `world_linked_turn_browser_audit.js` |
| F5 abgeschnittene NPC-Antwort | Reproduziert für `finish_reason: length`, einen Stream ohne abschließenden Finish-Reason und ein fehlerhaftes Stream-Event, auch wenn die übrigen JSON-Bytes parsebar sind. | Solche Linked-Drafts gelangen nicht zum Commit. Das gilt ebenso für `content_filter` und für eine Reparaturantwort mit `finish_reason: length`. | `world_scene_draft_audit.js`, `world_linked_turn_browser_audit.js` |

Die ursprünglichen fünf Provider-Nutzlasten und die exakten Player-Eingaben lagen dem Auftrag nicht bei und wurden im Repository nicht gefunden. Die Tests verwenden den angegebenen Aslan/Lorne-Kontext und strukturell gleiche Fehlformen. Eine vollständige, vom Provider mit `stop` markierte, aber literarisch abgebrochene Äußerung lässt sich ohne pauschale Ablehnung offener Rede nicht sicher als Transportabbruch erkennen.

## Pipeline und Zustandsintegrität

Der Linked-V3-Weg validiert das Draft-Protokoll und seine Referenzen vor `executeLinkedActions`. Die Ausführung schreibt in einen Working State; der Kandidat wird mit `assertReceiptMatchesCandidate` und den Narrationskonflikten geprüft. Erst danach folgen Nachricht und Zustandsversion in derselben vorbereiteten Transaktion zu `persistPreparedWorldTurn`. Bei einem Speicherfehler wird der Working State zurückgesetzt. Der Browser-Audit bestätigt, dass die alte Kleidung, die alten Receipts und die Historie erhalten bleiben; die Eingabe bleibt erneut absendbar.

Verkettete Aktionen mit bestätigten Abhängigkeiten, blockierten Folgeschritten und gültigen Teilerfolgen bestanden die Ausführungs- und Browser-Audits. Der vorhandene V2-Draft-Weg und der ID-lose V3-Replay-Weg bleiben in den Kompatibilitätstests funktionsfähig. Die Weltzeit und Hintergrundsimulation wurden nicht geändert.

## Ausgeführte Audits

Bestanden: `world_scene_draft_audit.js`, `world_linked_contract_audit.js`, `world_linked_hardening_audit.js`, `world_linked_execution_audit.js`, `world_linked_generalization_audit.js`, `world_latency_audit.js`, `world_scene_draft_browser_audit.js`, `world_linked_turn_browser_audit.js`, `world_linked_chain_browser_audit.js`, `worlds2_provider_response_browser_audit.js`, `worlds2_atomic_turn_persistence_browser_audit.js`, `worlds2_narrated_check_browser_audit.js`, `world_presentation_reliability_audit.js`; außerdem `node --check app.js` und `git diff --check`.

Browser-Audits nutzten gemockte Provider, gebündeltes Playwright und lokales Chrome. Es gab keinen verfügbaren exportierten `.horde_campaign`-Spielstand für `world_real_save_continuation_audit.js`; vorhandene `.horde_world`-Dateien sind keine Kampagnen-Saves. Reale OpenRouter- und lokale Modellläufe wurden nicht ausgeführt.

## Verbleibende Risiken

- Die semantische Behauptung, eine formal zukünftige Frist sei wirklich vereinbart, kann aus JSON und einem Modelltext allein nicht sicher bewiesen werden. Der Prompt verlangt konkrete Evidenz; die Engine prüft Ort, Uhrzeit, Passage-Bezug und bestehende Fristen. Ein Modell kann dennoch einen zukünftigen Termin im eigenen Text erfinden. Eine zusätzliche, autoritative Bestätigung der Verpflichtung ist für eine harte Garantie erforderlich.
- Ein Provider kann `finish_reason: stop` für eine syntaktisch vollständige, aber erzählerisch mitten im Satz endende Antwort melden. Die Engine kann dies ohne riskante Heuristik nicht sicher von absichtlich offener Prosa unterscheiden.
- Die exakten Originaleingaben, echte Kampagnen-Saves und reale Modellantworten fehlen für einen vollständigen Reproduktionstest.
