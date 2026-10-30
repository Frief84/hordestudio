# P4.3b · Extended World Simulation & Multi-NPC Benchmark

Stand: 27.10.2026. Dieser Bericht trennt bestätigte Sessionzustände, echte Modellturns und noch nicht ausgeführte Fälle. Ein gespeicherter Turn gilt nur dann als fachlicher Erfolg, wenn die erforderlichen Effects, Events und Zustandsänderungen belegt sind.

## Isolierte Testwelt und Import

- Quelle: `C:\Users\Frieder\Downloads\The_Submission_Vault (2).horde_world`, Änderungszeit 27.10.2026 09:37:44. SHA-256: `3EF03F34A9C8F75940D2CBD224C120F2A4F739EBACA2643E86974AFDFFCA5175`.
- Unveränderte Arbeitskopie: `scratch/world-model-p43b-2026-10-27/The_Submission_Vault_source.horde_world`. Die Datei wurde in einem neuen, leeren Playwright-Browserprofil über den produktiven Importdialog geladen. Der produktive Browser-Spielstand wurde nicht geöffnet oder verändert.
- Der Import enthielt 11 Räume, 32 Entitäten, 4 NPCs und die Starting Life `Master`. Alle 24 gerichteten Exits haben ein existierendes Raumziel und einen passenden Rückweg; es gibt 12 Tür-IDs. 16 Exits sind `locked`, 2 `unlocked`, bei 6 fehlt ein expliziter `lockState`.
- Der frisch initialisierte und gespeicherte Master-Timeline-Zustand beginnt in `loc_antechamber` mit `Cell key`, `a knive` und `a nice white thishue`. Der verglichene IndexedDB-Datensatz enthält denselben Ort, dasselbe Inventar und dieselben NPC-Zustände. Es gab keine Browser-Page-Errors.
- Tatsächliche NPC-Positionen: Linda `loc_antechamber`, Cassy `loc_cell_2`, Alexis `loc_cell_1`, Andew Cloudi `loc_round_room`. Für Linda und Cassy gewinnt `startLocation` gegenüber dem abweichenden `locationId`.
- Die Tür `door:loc_antechamber::loc_round_room` ist beidseitig `locked`, erfordert `Cell key` und hat je Richtung eine Reiseminute. Cell 3 hat `access.default=restricted` und verweigert Linda, Cassy und Alexis den Zutritt.
- `gameRules.universalChecks.enabled` ist im Original `false`. Es wurde keine Regel im Original geändert.

### Bestätigter Importbefund: Cell key

Die Master-Timeline besitzt `Cell key` im Inventar. Gleichzeitig ist die registrierte Item-Entität `ent_1791692661141` weiterhin mit `startLocation=loc_antechamber` definiert; für sie existiert nach dem Start keine `entityState`-Platzierungsüberschreibung. `scratch/world_p43b_key_duplication_audit.js` nimmt diesen registrierten Schlüssel durch einen gültigen `item_transfer` aus dem Antechamber auf. Danach enthält das Arbeitsinventar **zwei** `Cell key`; vor Commit enthält der ursprüngliche Zustand weiter einen. Beide Exemplare bleiben nach Commit und JSON-Reload erhalten. Damit ist doppelte Verfügbarkeit reproduziert. Eine automatische Bereinigung beim Import wäre ohne eindeutige Eigentumsreferenz mehrdeutig, falls ein Autor absichtlich zwei gleichnamige Gegenstände platziert. Die Originalwelt wurde nicht geändert.

## Live-Budget und Belege

Die ausdrückliche Freigabe für maximal 60 tatsächliche lokale Modellrequests einschließlich Reparaturen, Timeouts und Abbrüchen liegt vor. Die Zählung erfolgt vor jedem Request in `scratch/world-model-p43b-2026-10-27/request-ledger.json`; der Harness begrenzt zusätzlich jeden Turn auf maximal drei Requests (Initialantwort und höchstens zwei Reparaturen). Alle vollständigen lokalen Modellantworten werden im Ledger gesichert. Jeder Turn läuft in einem neuen isolierten Browserkontext. Requests gehen ausschließlich an das lokale Ollama unter `127.0.0.1:11434`; der Binding-Worker läuft lokal. Die Browser-Engine behält ihre fünfminütige Turn-Grenze.

Live-Lauf abgeschlossen bei **58/60 Requests**: 56 Qwen-Requests mit HTTP 200 und zwei Gemma-Timeouts. Die zwei ungenutzten Requests wurden nicht mit einem weiteren Turn verbraucht, da dieser einschließlich bis zu zwei Reparaturen drei Requests benötigen kann. Pro Request stehen der Original-Requestkörper, die vollständige Antwort beziehungsweise der Timeoutfehler, Status und Dauer im Ledger. Qwen-Requestdauer: Median 6,65 s, Spanne 1,72–109,64 s; Gemma: beide 150-s-Timeout. Diese Requestzeiten sind keine Turnzeiten und enthalten keine modellübergreifend gleiche Cold-Start-Bedingung.

Verfügbare primäre Modelle am 27.10.2026: `gemma4:31b-it-q4_K_M` (Digest `17ba34c0…8d97`) und `qwen2.5:14b-instruct-q4_K_M` (Digest `7cdf5a01…22f6`). Andere Modelle gehören nicht zu diesem Budgetlauf.

## Live-Ergebnisse

Die folgenden Angaben bezeichnen **tatsächlich ausgeführte** isolierte Turns. Jeder Einzelfall enthält in seiner JSON-Datei Eingabe, Modell, Dauer, Fehler, Audit, Receipt, Events, Live-Zustand und gespeicherten Zustand. Die Originalantworten samt Requests stehen vollständig in `request-ledger.json`. `technisch gespeichert` ist keine Aussage über fachlichen Erfolg.

| Fall | Requests | Technischer Befund | Fachlicher Befund |
|---|---:|---|---|
| A1, Qwen: originale Linda/Schlüssel/Round-Room-Eingabe | 3 | Abgewiesen: `request_coverage_mismatch` | Modell erzählte Öffnen und Begleitung ohne Effects. Keine Türöffnung, kein Move, kein Linda-Einverständnis belegt. |
| A2, Qwen: bedingte, eindeutigere Eingabe | 3 | Abgewiesen: `request_coverage_mismatch` | Modell erzählte Linda-Antwort und beide Bewegungen, setzte aber keine gültigen Effects. Keine Zustandsänderung. |
| A1 und A2, Gemma | je 1 | Beide ersten Requests nach 150 s Timeout | Kein Modellturn und keine fachliche Aussage. |
| B, Qwen: aufschließen und stehenbleiben, vor Korrektur | 1 | Turn gespeichert, `accepted=1` | **Fehler:** Erzählung und abgeschlossener Unlock-Event behaupteten Öffnung; `confirmed_effects=[]`, `unlockedExits={}`. |
| B, derselbe Fall nach erster Korrektur | 3 | Abgewiesen, Reparaturen ausgeschöpft | Falscher Unlock wurde nicht gespeichert; Tür blieb zu. |
| B, falscher Messingschlüssel, vor zweiter Korrektur | 1 | Turn gespeichert, `accepted=0` | **Fehler:** Erzählung behauptete geöffnete Tür ohne Event oder Effect; Tür blieb zu. |
| B, falscher Schlüssel nach zweiter Korrektur | 3 | Abgewiesen: `request_coverage_mismatch` | Kein erfundener Türerfolg gespeichert. |
| B, Schlüssel wirklich aus Inventar entfernt | 3 | Abgewiesen: `pending_action_requires_check` | Tür blieb zu; kein impliziter Zugriff auf den Schlüssel. |
| B, gesperrte Tür ohne vorheriges Öffnen betreten | 3 | Abgewiesen: `request_coverage_mismatch` | Keine Teleportation; Ort blieb Antechamber. |
| B, eindeutige Form „unlock the door to the Round Room“ | 3 | Abgewiesen: `request_coverage_mismatch` | Auch diese Formulierung belegte keine Türöffnung. |
| C, Linda allein in Round Room schicken | 3 | Abgewiesen: `uncommitted_player_location_claim` | Kein erzwungener NPC-Move, kein Spieler-Move. |
| C, Linda um Schlüsselverwahrung bitten | 3 | Abgewiesen: `request_coverage_mismatch` | Kein Item-Transfer. |
| D, Linda direkt fragen | 3 | Turn gespeichert | Direkte Linda-Rede in Prosa, aber `speech_attributions=[]` und `speaker_id=null`: A2-Qualitätsmangel. |
| D, Linda fragen und schweigend warten | 2 | Abgewiesen nach Reparatur | Kein Sprecherbeleg oder Antwortturn gespeichert. |
| E, Linda nach Alexis' Wissen fragen | 1 | Turn gespeichert | Linda sagt, Alexis kenne das räumlich getrennte Gespräch nicht. Semantisch plausibel; keine strukturierte Sprecherzuordnung, kein Wissensupdate. |
| F, Schlüssel im Inventar prüfen | 1 | Turn gespeichert und reloadgleich | Erzählung bestätigt vorhandenen Cell key. Kein Transfer; Inventar enthält weiter genau einen im Sessionzustand. Die separat registrierte lose Kopie bleibt vorhanden. |
| G, Universalcheck-Variante mit Focus 9/Energy 5 | 3 | Abgewiesen: `unverified_action_success` | Kein Checkresultat, keine Kosten. |
| G, Focus 3/Energy 5 | 3 | Abgewiesen: `action_outcome_mismatch` | Kein Fehlschlagsresultat, keine Kosten. |
| G, Focus 9/Energy 0 | 3 | Abgewiesen: `invalid_state_condition` | Kein Checkresultat, keine Abbuchung. |
| H, Vault-Folge mit Linda, Inventar, Tür | 5 | Erster Dialogturn gespeichert, zweiter Turn abgewiesen | Erster Turn nach Reload konsistent; Türfolge wegen fehlgeschlagenem Inventarturn nicht übersprungen. Erster Turn hat korrektes Linda-Sprecherattribut, aber zusätzlich ein falsches `player`-Sprecherattribut für reine Beobachtungsprosa. |
| H, dreiteilige Linda-Dialogfolge | 3 | Alle drei Turns gespeichert, 6 History-Einträge nach Reload | Inventar und Ort konsistent, aber direkte Rede in allen drei Receipts ohne `speech_attributions`. |

Die übrigen Fälle aus B–F, insbesondere tatsächliche Mehrraumreise, NPC-Unterbrechung/Fortsetzung, Item-Übergabe, Wissenstransfer zwischen getrennten NPCs und mehrere NPCs im Dialog, wurden nicht als Live-Erfolg nachgewiesen. Sie dürfen weder aus einer konstruierten Engine-Probe noch aus einer erzählten Modellhandlung abgeleitet werden. Der Fall „ohne Schlüssel“ mit der exakten Eingabe „without a key“ wurde zunächst bei weiterhin vorhandenem Startschlüssel versucht; er ist als uneindeutiger Kontrollfall in den Rohdaten vorhanden und wurde durch `B_no_key_actual` mit tatsächlich entferntem Schlüssel ersetzt.

### Reproduzierter Enginefehler und Änderung

Die Belegkette des falschen B-Unlock-Commits lautete: Spielerwunsch → Modellvorschlag mit Türöffnungsprosa → Binding als `speech` → akzeptierter Linked-Turn → abgeschlossener Interaktions-Event beziehungsweise im zweiten Fall gar kein Event → **kein** bestätigter Tür-Effect → `unlockedExits={}` → Commit mit widersprüchlicher Darstellung. `worldFinalNarrativeConflicts` in `app.js` prüft jetzt bei als abgeschlossen gemeldeten Öffnungen und bei klaren narrativen Öffnungsbehauptungen an einer angrenzenden authored `locked`-Tür den autoritativen `unlockedExits`-Zustand. Es erzeugt keinen Öffnungseffekt. `scratch/world_p43b_door_claim_audit.js` prüft Event mit fehlendem Effekt, reine Prosa ohne Event, gültig geöffneten Zustand und bloßen Versuch.

### Deterministische Prüfungen und Reichweite

Der P4.3a-Recovery-Audit bestand erneut: Intent, Pickup, Bewegung, Checks, Kosten, Rollback und Save/Reload. Der neue Door-Claim-Audit und der reale Key-Duplication-Audit bestanden. Beim ersten Lauf der 25 World-Regressionsaudits bestanden 24, während `world_server_binding_browser_audit.js` bei 120 s auslief; er bestand danach einzeln. Der **vollständige zweite Lauf nach der letzten Produktkorrektur bestand mit 25/25 Audits, 0 Fehlern und 0 Timeouts**, protokolliert in `regressions-25-final.json` (180-s-Einzellimit). Diese kontrollierten Prüfungen ersetzen **keine** fehlgeschlagenen Live-Modellturns. Für die Universalcheck-Variante verwendet der Live-Harness nur in der Testkopie einen Mechanismus im Antechamber, Focus/Energy-Stats und eine Regel mit Difficulty 7 sowie Engine-Kosten 2 bei Erfolg, 1 bei Fehlschlag. Das Original bleibt mit deaktivierten Universalchecks kompatibel.

### Vorläufige Antworten auf die zehn Abschlussfragen

1. Öffnen und Durchqueren der verschlossenen Round-Room-Tür sind live nicht belegt. Die ursprünglichen Modellturns scheiterten; die zunächst gespeicherten Öffnungsbehauptungen waren fachlich falsch.
2. Linda reagierte im Dialog eigenständig beziehungsweise ablehnend, aber eine regelkonforme Begleitung über die Tür wurde nicht belegt.
3. Bei abgewiesenen Turns blieben Ort, Tür und Inventar konsistent; die Weltdefinition erlaubt jedoch die doppelte Cell-key-Aufnahme.
4. NPC-Dialoge sind nicht zuverlässig zugeordnet: sowohl fehlende Linda-Belege als auch ein falscher Player-Beleg wurden beobachtet.
5. Eine einzelne Antwort respektierte Alexis' räumliche Trennung; verlässliche Weitergabe, Quellen und Gedächtnisgrenzen über mehrere Räume sind nicht live belegt.
6. Kontrollierte Engine-Audits für Checks, Kosten und Rollback bestehen. In den drei neuen Live-Varianten brachte das Modell keinen gültigen Check bis zum Commit.
7. Drei aufeinanderfolgende Dialogturns wurden korrekt gespeichert und neu geladen. Die beispielhafte Tür-/Reisefolge wurde nicht abgeschlossen.
8. Modellfehler: ungültige Action-/Effect-Strukturen, erfundene Öffnungen/Bewegungen, fehlende oder falsche Sprecherbelege. Enginefehler: eine unmögliche Türöffnung konnte vor der Korrektur als erfolgreicher Turn gespeichert werden; die World-Definition/Initialisierung lässt denselben Schlüssel lose und im Startinventar.
9. Die notwendige, reproduzierte Produktkorrektur ist der Door-Claim-Guard. Der doppelte Schlüssel braucht eine eindeutige Autoren-/Eigentumsentscheidung; die Speaker-Validierung und Mehrschritt-Modellzuverlässigkeit bleiben offen.
10. Qwen ist in dieser Stichprobe nur relativ nutzbarer als Gemma, weil Gemma beide priorisierten Requests im 150-s-Limit nicht beendete. Qwen lieferte mehrere gespeicherte Dialog-/Inventar-Turns, aber keinen fachlich korrekten Vault-Tür-/Reise-/Check-Turn; daher keine Empfehlung zur automatischen Modellumstellung.

## Reproduktion

`scratch/world_p43b_prepare.js` reproduziert den isolierten Import ohne Modellrequest. `scratch/world_p43b_live.js` führt jeweils genau einen benannten Testfall mit einem der beiden freigegebenen Modelle aus und speichert Antwort, Audit, Receipt, Events, Live- und Persistenzzustand. Browser executable: `C:\Program Files\Google\Chrome\Application\chrome.exe` über `HORDE_BROWSER_EXECUTABLE`.
