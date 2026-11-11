# World Action Reliability: Untersuchungsstand vom 1. November 2026

**Status: unvollständig.** Die hier beschriebenen Änderungen beheben einzelne
Bindungs- und Reparaturfehler. Die geforderte zuverlässige Verarbeitung aller
natürlichen körperlichen Aktionen mit Rede wurde nicht nachgewiesen.

## Fortsetzung: Prozessumgebung

Beim Fortsetzungsversuch scheiterte bereits `whoami` vor dem Start des
Kommandos mit `CreateProcessWithLogonW failed: 1909`. Der Prozesskontext
konnte daher nicht ermittelt werden. Auch die vorhandene Computeroberfläche
war nicht erreichbar: Ihr lokaler Kernel beendete sich mit demselben
Windows-Logon-Fehler. Es wurde kein anderer Windows-Benutzer, keine neue
Logon-Session und kein `runas` verwendet. Weitere Wiederholungen dieses
Startmechanismus wurden eingestellt.

Damit konnten weder der konkrete Fehler des Browser-Binding-Audits noch
`EPERM` am Ergebnisfile untersucht werden. Der gemeldete Browser-FAIL ist
weiterhin **nicht** als Produkt- oder Umgebungsfehler klassifiziert. Neue
Suite-, Gemma-, Qwen-, Save/Reload-, Rollback- und Reroll-Ergebnisse liegen
nicht vor. Die Abnahmekriterien bleiben offen. Für die Fortsetzung ist ein
Prozesswerkzeug erforderlich, das den Token der bereits angemeldeten
Windows-Sitzung erbt; ein Wechsel des Kontos oder der Sicherheitsrichtlinien
ist dafür nicht vorgesehen.

### Erneuter Lauf nach wiederhergestelltem Prozessstart

Ein späterer `whoami`-Aufruf gelang mit `morpheus\codexsandboxoffline`.
`world_server_binding_browser_audit.js` scheiterte zunächst ohne
`HORDE_BROWSER_EXECUTABLE` am fehlenden Playwright-Headless-Binary. Mit dem
vorhandenen Chrome-Executable zeigte er einen tatsächlichen Produktfehler:
Die neue Source-Speech-Projektion ordnete Aslans ausdrücklich erzählte Rede
dem Spieler zu. Die Projektion wurde auf Eingaben mit eindeutigem
Spielerbezug begrenzt; der Browser-Audit bestand danach.

Anschließend bestand `node scratch/run_world_model_regressions.js` alle
28 gelisteten Audits. Die Ergebnisse wurden neu unter
`scratch/world-model-regressions-2026-11-01-resume-001.json` gespeichert;
die alte Ergebnisdatei wurde nicht überschrieben. Danach schlugen neue
Prozessstarts beim Lesen des Engine-Codes erneut mit
`CreateProcessWithLogonW failed: 1909` fehl. Engine-Implementierung und
neue Gemma-Läufe wurden seitdem nicht ausgeführt. Der bestandene
Regressionslauf belegt ausdrücklich noch keine Abnahme der natürlichen
körperlichen Aktionen.

## Reproduzierte Befunde

Die isolierten Browser-Läufe nutzten `gemma4:31b-it-q4_K_M` und einen
separaten Test-World-Speicher. Produktive Spielstände wurden nicht geändert.

| Fall | Modellaufrufe | Dauer | Ergebnis |
| --- | ---: | ---: | --- |
| A, vor Änderung, Kaltstart | 1 | 300,1 s | Zeitlimit; Antwort ohne Activity-Event, `effects:[]` |
| B, vor Änderung, warm | 2 | 77,0 s | Turn gespeichert, aber Spielerrede fehlte vollständig |
| C, vor Änderung, warm | 3 | 225,5 s | `repair_dropped_verified_event`, nicht gespeichert |
| B, nach erster Bindungsänderung, warm | 3 | 97,2 s | Spielerrede erhalten, aber `unverified_action_success`, nicht gespeichert |

Diagnosedateien: `scratch/world-chair-a-baseline.json`,
`scratch/world-chair-b-baseline.json`, `scratch/world-chair-c-baseline.json`,
`scratch/world-chair-b-after.json`. Die letzte Produktänderung wurde noch
nicht erneut mit dem Live-Modell ausgeführt.

## Bestätigte Ursachen und Grenzen

- Gemma lieferte für eine als `resolved` markierte körperliche Aktion wiederholt
  `effects:[]` und keinen abgeschlossenen, verknüpften Activity- oder
  Interaction-Beleg. Der Executor weist das zu Recht als
  `unverified_action_success` zurück. Ein Erfolg darf nicht allein aus der
  Erzählung abgeleitet werden.
- Bei B enthielt ein erfolgreich gespeicherter Turn zunächst nicht den
  wörtlichen Satz des Spielers. Das bisherige Receipt prüfte die Rede nicht
  zuverlässig gegen den Originalinput.
- Bei C wechselte ein abgeschlossenes, nichtpersistentes Player-Event in der
  Reparatur von `interaction` zu `activity`. Die bisherige Schutzprüfung
  behandelte diese alternative Darstellung desselben Action-/Passage-Bezugs
  als verlorenes Event. Mechanische Events dürfen weiterhin nicht ersetzt
  werden.
- `missing_condition_action` bezieht sich auf das Feld `action` eines
  Condition-Events (`add`, `remove`, `clear`, `recover`), nicht auf eine
  fehlende Action-ID. Der Reparaturhinweis verwendete bisher ein
  Restraint-Beispiel selbst für gewöhnliche Posen und konnte dadurch in die
  falsche Richtung lenken.
- `unknown_action_reference` entsteht bei ungültigen Action-Referenzen in
  Dependencies oder Events. Der Binder vergibt die Engine-IDs selbst; eine
  vollständige Ursachenbestätigung für den beobachteten Reroll fehlt.

## Änderungen in dieser Arbeitskopie

- `worlds/turn-binding.js`: Fehlende Statuswerte werden nur aus typisierten
  Belegen oder bei effektfreier Rede/Beobachtung ergänzt. Spielerzitate aus
  dem exakt zugeordneten Eingabeabschnitt werden auch dann wortgetreu als
  Speech-Evidence übernommen, wenn das Modell sie einer physischen Action
  zuordnet. Das belegt keine körperliche Ausführung.
- `worlds/turn-binding.js`: Die Reparaturschutzprüfung lässt einen Wechsel
  zwischen rein lokalem `interaction`- und `activity`-Event für denselben
  Player-Action-/Passage-Bezug zu. Events mit mechanischem Ziel oder Zustand
  sind davon ausgenommen.
- `app.js`: Der Binding-Kontext enthält die aktuell anwesenden NPC-IDs für
  Speech-Listeners. Der Condition-Reparaturhinweis unterscheidet jetzt
  dauerhafte Zustandsänderungen von Posen und Interaktionen.
- `scratch/world_server_binding_audit.js`: Tests für fehlenden physischen
  Status, source-backed Speech und den unveränderten
  `unverified_action_success`-Schutz wurden ergänzt.
- `scratch/world_linked_ollama_live_audit.js`: Isolierte Fälle A, B und C für
  die lokalen Modellläufe wurden ergänzt.

Eine probeweise lexikalische Posture-Erkennung wurde wieder entfernt. Sie
war nicht allgemein genug, um die World-Plausibilität und Objektzustände
sicher zu beurteilen.

## Prüfung

`node scratch/world_server_binding_audit.js` bestand nach den Änderungen.
Die anschließend gestartete World-Regressionsrunde meldete für die
Server-Audits und zahlreiche weitere Module PASS, jedoch
`world_server_binding_browser_audit.js: FAIL`. Die Runner-Datei
`scratch/world-model-regressions-2026-10-26.json` konnte wegen `EPERM` nicht
geschrieben werden. Danach schlugen alle neuen lokalen Prozessstarts mit
`CreateProcessWithLogonW failed: 1909` fehl; deshalb liegen weder die
Browser-Fehlerdetails noch ein abschließender Syntax- oder Regressionslauf
nach der letzten `app.js`-Änderung vor.

Gemma-Beschleunigung ist nicht belegt: Der erste Modellaufruf war im
Kaltstart sehr langsam, und die warmen Versuche benötigten weiterhin zwei
bis drei Aufrufe. Qwen, wiederholte Live-Läufe, Save/Reload, Rollback und
Reroll nach der letzten Änderung sind ausstehend. Die dokumentierten
Baseline-Dauern von 103,5 und 145,8 Sekunden wurden nicht zuverlässig
unterboten.

## Offene Arbeit

## Fortsetzung: autoritative lokale Tätigkeiten und Objekt-Transitionen

Der Binder kann jetzt eine ausdrücklich angeforderte Körperhaltung als
Activity belegen, wenn ein genanntes Trägerobjekt eindeutig im aktuellen Ort
und erreichbar ist. Fehlt es, wird kein Erfolgsbeleg erzeugt. Für authored
Objekte mit `interactable.transitions[].triggers` bereitet die Engine die
passende Transition und ein verknüpftes Environment-Event vor; der bestehende
Reducer prüft Ausgangszustand, Ort und erforderliche Gegenstände und speichert
den neuen Zustand. Eine unmittelbar folgende Tätigkeit mit „darauf“ kann auf
das gerade veränderte Objekt bezogen werden, wenn dieses die Tätigkeit in
`supportsActivities` deklariert. Der Folgeschritt hängt dann vom Erfolg der
Transition ab. Diese Metadaten sind allgemein und optional; sie decken keine
beliebigen, nicht beschriebenen Objektmanipulationen ab.

Zusätzlich wird der eindeutig konfigurierte Spielername in Speech-Listeners
zur stabilen ID `player` aufgelöst. Der Reparaturschutz akzeptiert eine
Engine-Transition nur dann erneut ohne Modell-Effekt, wenn derselbe
Request-Abschnitt, das erreichbare Objekt, der Ausgangszustand und der
authored Trigger weiterhin übereinstimmen. Der Binder bereitet den Effekt
danach erneut vor.

### Isolierte Gemma-4-Läufe

| Fall | Aufrufe | Dauer | Befund |
| --- | ---: | ---: | --- |
| A | 1 | 236,3 s (Kaltstart) | gespeichert; Activity `sitting`, keine Objektmutation |
| B | 1 | 13,7 s (warm) | gespeichert; Activity `sitting`, Spielerrede wortgetreu, Linda-Beobachtung gespeichert |
| C, erster Lauf | 3 | 149,0 s | `invalid_witnessed_speech`, nicht gespeichert |
| C, zweiter Lauf | 3 | 149,9 s | gespeichert, aber Stuhl nicht aufgerichtet: falscher Erfolg aufgedeckt |
| C, nach authored Transition | 3 | 140,9 s | `repair_dropped_verified_effect`, nicht gespeichert |
| C, nach Reparaturschutz | 1 | 13,7 s | gespeichert; Stuhl `upright`, Transition bestätigt, beide Redepassagen erhalten |
| C, mit Folgetätigkeit | 2 | 67,5 s | gespeichert; Stuhl `upright`, Activity `sitting`, beide Redepassagen erhalten |

Die vollständigen Modellantworten und Bindungsdaten liegen in neuen Dateien
`scratch/world-chair-a-engine-2026-11-01.json`,
`scratch/world-chair-b-engine-2026-11-01.json` sowie
`scratch/world-chair-c-engine-2026-11-01-r2.json` bis `-r5.json`.
Gemma meldete in diesen Läufen keine Token-Nutzung. Die Hauptprompts hatten
etwa 35–37 Tausend Zeichen; der kalte A-Aufruf benötigte 235,9 Sekunden,
warme Hauptaufrufe etwa 13–20 Sekunden. Die C-Reparaturen dauerten bis zu
78,5 Sekunden. Wiederholte erfolgreiche A/B/C-Läufe nach der letzten
Produktänderung stehen aus.

### Regression nach der letzten Produktänderung

Die Server-Binding-Prüfung bestand. Die vollständige Suite wurde mit neuer
Ausgabedatei `scratch/world-model-regressions-2026-11-01-engine-final.json`
ausgeführt: 27 Audits meldeten PASS; `world_server_binding_browser_audit.js`
lief in der Suite nach 120 Sekunden ins TIMEOUT. Das Runner-Programm beendete
sich dennoch mit Exit-Code 0, daher gilt die Suite **nicht** als bestanden.
Der geplante Einzel-Nachtest scheiterte vor dem Prozessstart mit
`CreateProcessWithLogonW failed: 1909`. Danach wurden keine weiteren
Prozessstarts versucht. Ob der Browser-Timeout aus Produktcode oder
Testumgebung stammt, ist noch offen.

Die verbindliche Abnahme ist weiterhin nicht erreicht: Es fehlen eine
vollständig bestandene Regression nach der letzten Änderung, wiederholte
Gemma-Erfolge, Tests anderer gewöhnlicher Handlungen und eine Prüfung von
Save/Reload, Rollback und Reroll für diese neuen Live-Szenarien. Kein Commit,
Push oder produktiver Spielstand wurde verändert.

### Fortsetzung der Multi-Action-Abnahme

Beim ersten erneuten Leseprozess trat wieder
`CreateProcessWithLogonW failed: 1909` auf. Weitere Prozessstarts wurden
gemäß Auftrag eingestellt. Der konkrete Browser-Timeout und die
Windows-Anmeldeereignisse konnten deshalb nicht untersucht werden. Der
Browser-Audit hatte vor der letzten Engine-Änderung einzeln bestanden;
aus diesem früheren Ergebnis lässt sich der neue Timeout nicht sicher
klassifizieren.

Eine aus dem bekannten Runner-Code eindeutig begründete Korrektur wurde
vorgenommen: `scratch/run_world_model_regressions.js` setzt nun einen
fehlerhaften Gesamtexitcode, sobald ein Teil-Audit ins Timeout läuft oder
mit einem Fehler endet. Diese Änderung konnte wegen 1909 noch nicht
ausgeführt werden. Wiederholte Gemma-Läufe, neue teilweise erfolgreiche
Multi-Action-Fälle sowie Save/Reload-, Rollback- und Reroll-Prüfungen sind
weiterhin ausstehend. Die Aufgabe bleibt unvollständig.

1. Den Browser-Binding-Audit nach Behebung des lokalen Prozessfehlers
   diagnostizieren und die gesamte World-Suite erneut ausführen.
2. Eine allgemeine, weltgestützte Darstellung und Verifikation von
   nichtpersistenten Aktivitäten und objektbezogenen Zustandsänderungen
   entwickeln. Das Aufrichten eines Stuhls benötigt einen tatsächlichen
   persistenten Objektzustand; ein bloßes Interaction-Event genügt nicht.
3. Compound Requests so binden, dass körperliche Schritte, Gesten und Rede
   vollständig und in Reihenfolge erhalten bleiben, auch bei Fehlschlägen
   einzelner Schritte.
4. Gezielte Receipt-Reparatur statt vollständiger Neugenerierung einführen
   und alle vier Fehlerklassen mit echten Modellantworten erneut prüfen.
5. Gemma A/B/C mehrfach sowie nach Möglichkeit Qwen ausführen und
   Modellzeit, Kontextgröße, Tokens, Validierung, Repair-Anzahl und
   Persistenz getrennt protokollieren.

Es wurden weder Commit noch Push oder Deployment ausgeführt.

## Fortsetzung: Node-Prüfung in eingeschränkter Windows-Sandbox

Der lokale Ollama-Dienst antwortete auf `/api/tags` und listete
`gemma4:31b-it-q4_K_M`. Ein Node-Prozess konnte jedoch keinen weiteren
Node-Prozess starten: `spawnSync K:\\nodejs\\node.exe EPERM`. Daher endete
`world_server_binding_audit.js` erst an seinem abschließenden Worker-Test
mit `status: null`; die davor liegenden Assertions meldeten keinen Fehler.
Der `world_action_path_parity_audit.js` konnte ohne Playwright-Headless-Binary
nicht starten. Chrome wurde wegen der dokumentierten Kontosperren nicht
ersatzweise gestartet. In dieser Fortsetzung trat kein Fehler 1909 auf.

Nach der Produktänderung bestanden 17 einzeln gestartete browserfreie
World-Audits in zusammen etwa 16 Sekunden. Diese umfassen die allgemeine
190-Turn-Matrix, Linked Effects, Speaker/Receipt, Transaction/Working State,
Universal Checks, NPC-Ziele, Perception und Knowledge Sharing. Die
vollständige 28-Audit-Suite wurde **nicht** bestanden oder als bestanden
gewertet: ihre Browser-Audits und der interne Worker-Spawn sind in dieser
Sandbox nicht ausführbar. Der Runner fängt jetzt auch ein `spawn`-Fehlerereignis
ab, wartet auf `close` und zeichnet den Fehler im Teilergebnis auf; die
vorhandene Exit-Code-Korrektur für Timeout und Teilaudit-Fehler bleibt erhalten.

Ein neuer direkter Binder-Audit prüft getrennte Spieler- und NPC-Zitate
innerhalb eines Turns, eine gewöhnliche kniende Tätigkeit ohne
Objektmetadaten und das Ausbleiben eines abgeschlossenen Tätigkeitsbelegs
bei fehlender Sitzgelegenheit. Dafür wurde die Source-Speech-Projektion
konservativ begrenzt: Ein explizit mit NPC-Namen und Sprechverb versehenes
Zitat wird nicht als Spielerrede ergänzt. Der Audit bestand. Ein weiterer
Node-Audit band die gespeicherten **echten** Gemma-Proposals A, B und C erneut
und erhielt für jede Worker-Anfrage dasselbe Binder-Ergebnis. Er bestätigte
bei C den gespeicherten Stuhlzustand `upright`, das Environment-Event, die
Activity `sitting`, mindestens zwei Redebelege und gleiche History-Längen
im Live- und gespeicherten Snapshot. Das ist ein Replay vorhandener Antworten,
kein neuer Modelllauf. Die ursprünglichen Captures enthalten A: 1 Aufruf,
B: 1 Aufruf und C: 2 Aufrufe; diese Fortsetzung erzeugte **0** Modellaufrufe.

Die neuen Prüfungen belegen keine allgemeine Multi-Action-Abnahme. Es fehlen
mehrfache neue A/B/C-Live-Läufe, Modellfälle für unabhängige Teilfehler,
mehrere Sprecher und ungeeignete Objekte, die vollständige Browser-Regression
sowie Save/Reload, Rollback und Reroll der neuen zusammengesetzten Turns.
Die bereits vorhandenen generischen Node-Audits für Save/Reload, Rollback und
Reroll bestanden, ersetzen diese szenariospezifischen Prüfungen aber nicht.
Die sechs genannten Receipt-Fehlerklassen wurden nicht mit neuen echten
Modellantworten erneut durchlaufen; deterministische Reparaturen dafür sind
weiter offen. Die Aufgabe bleibt unvollständig.

### Neuer direkter Gemma-Multi-Action-Lauf

Ein isolierter Node-Harness rief Gemma zweimal ohne Chrome auf. Beim ersten
Aufruf (243,4 Sekunden, 860 Tokens laut Ollama) entstanden drei getrennte
Aktionen, jedoch alle mit `pending_check` ohne Check-Effekt. Der Compiler
lehnte alle drei mit `pending_action_requires_check` ab; es gab keinen Commit.
Beim zweiten Aufruf (35,0 Sekunden, 1.838 Tokens) verwendete der Harness eine
präzisierte Vorgabe für gewöhnliche, unmittelbar abschließbare Schritte. Die
Antwort enthielt Knien, Winken und die wörtliche Rede „Hello.“ als drei
Abschnitte. Der damalige Binder fasste sie trotz abgeschlossener körperlicher
Events zu einer `speech`-Action zusammen und führte die Rede zweimal. Der
Executor akzeptierte das, aber die Timeline wäre für die Teilhandlungen
unzureichend nachvollziehbar gewesen. Die Dateien
`scratch/world-multi-action-node-live-2026-11-01.json` und
`scratch/world-multi-action-node-live-2026-11-01-r2.json` enthalten beide
Modellantworten und Diagnosen.

Der Binder fasst nun keine mehrteiligen Antworten zusammen, wenn ein Teil
einen abgeschlossenen körperlichen Player-Event enthält. Er klassifiziert
eine ohne Zitat formulierte körperliche Activity bzw. einfache Geste anhand
des typisierten Events; eine kombinierte Rede-/Sitzhandlung wie C behält
ihre bisherige Darstellung. Das Replay der zweiten echten Antwort hat jetzt
drei getrennte Actions (`physical`, `physical` mit Gesture-ID, `speech`),
einen Redebeleg und verifizierte Activity-/Interaction-Events. Compiler und
Executor bestehen, ein In-Memory-State-Commit lässt sich neu laden. Die
appseitige World Timeline und das Receipt wurden bei diesem Node-Replay
**nicht** persistiert oder geprüft. Die gespeicherten alten Gemma-Antworten
A/B/C binden weiterhin bitgleich. Nach dieser Änderung bestanden 20
browserfreie Node-Audits in etwa 19 Sekunden.

Der Regression-Runner wurde zusätzlich mit genau einem ausgewählten Audit
gegen den Sandbox-Fehler geprüft. `spawn EPERM` wird jetzt als FAIL mit
`spawnError` in einer Ergebnisdatei festgehalten; der Runner liefert
Exit-Code 1. Damit wird ein synchroner Spawn-Fehler nicht verschluckt.
Die vollständige Suite bleibt wegen des internen Prozessstarts und der
Browser-Audits offen. Bis zu diesem Zwischenstand wurden **2** neue
Modellaufrufe durchgeführt; der Live-Lauf nach dem Binder-Fix folgt unten.

### Live-Nachlauf nach dem Binder-Fix

Der anschließende dritte direkte Gemma-Aufruf benötigte 15,0 Sekunden
(908 Tokens laut Ollama, davon 146 gecachte Prompt-Tokens). Der Binder
speicherte im Node-Diagnoseergebnis drei getrennte Actions für Knien,
Winken und Sprechen, drei zugeordnete abgeschlossene Events und genau
einen Redebeleg mit `Hello.`. Compiler und Executor bestanden ohne Repair.
Die Antwort steht in `scratch/world-multi-action-node-live-2026-11-01-r3.json`.
Ein Replay derselben neuen Antwort bestand Binder, Compiler, Executor und
In-Memory-State-Commit/Reload. Der Test prüft die verifizierten Events;
deren appseitige Aufnahme in Receipt und World Timeline bleibt offen.

Damit beträgt die Zahl neuer Gemma-Aufrufe in dieser Fortsetzung **3**
(243,4 + 35,0 + 15,0 Sekunden Modell-/Harness-Laufzeit). Dieser eine
frische erfolgreiche Node-Fall ersetzt weder die wiederholten A/B/C-Läufe
noch die vollständige Browser- und Persistenzabnahme. Kein produktiver
Spielstand, Commit oder Push wurde verändert.

## Fortsetzung: modellübergreifende Node-Probes und Binder-Korrekturen

Die folgenden neuen Ollama-Aufrufe nutzten dieselbe isolierte Kitchen-Welt
und denselben Input `I kneel, then wave to Linda and say "Hello."`. Sie liefen
über Binder, Scene-Draft-Compiler und Linked Executor, aber **nicht** durch
den browserseitigen App-Commit. Die Zeiten umfassen den jeweiligen
Harness-Aufruf; getrennte Validierungszeiten waren in diesen ersten Captures
noch nicht instrumentiert.

| Modell | Aufrufe | Zeit | Rohbefund | Stand nach deterministischem Replay |
| --- | ---: | ---: | --- | --- |
| Qwen 2.5 14B | 2 | 99,8 s / 4,7 s | `label` statt `activity`; einmal zwei statt drei Actions; einmal `travel` und leere Speech | Erster Output ausführbar mit zwei Actions und einem Redebeleg; zweiter bleibt wegen falscher Semantik nicht ausführbar |
| GPT-OSS 20B | 1 | 167,6 s | Drei Actions, aber unmögliche `has_item`-/`interactable_state`-Preconditions | Drei Actions und drei erfolgreiche Executor-Ergebnisse; keine dauerhaften Effects |
| Mistral Small 3.2 24B | 1 | 159,2 s | Drei körperliche/gesprochene Abschnitte alle als Speech, keine körperlichen Events | `unverified_echoed_action`, kein falscher Commit |

`worlds/turn-binding.js` normalisiert ein eindeutig typisiertes
Activity-`label` zu `activity`, entfernt einen leeren Redebeleg ohne
gesprochenen Text und bindet `self` nur bei einem exakt aus dem
Spielerabschnitt belegten Zitat an `player`. Bei effektfreien Actions
entfernt er nur strukturell unmögliche Fact-Referenzen, etwa `player` als
Item oder Interactable. Separat verankerte Actions werden nicht mehr zu
einer Konversations-Action verschmolzen. Ein bloßes Echo einer solchen
Action ohne abgeschlossenes Event, Speech-Evidence oder Effect wird
zurückgewiesen. `unverified_action_success` bleibt aktiv.

Der neue `scratch/world_activity_label_replay_audit.js` prüft die drei
gespeicherten echten Modellantworten gegen diese Regeln. 21 browserfreie
Node-Audits bestanden nach der Änderung. `world_server_binding_audit.js`
lief bis zum internen Worker-Spawn; dieser scheiterte mit `spawn EPERM`, also
ist dieser Audit nicht bestanden. Der Archiv-Continuation-Audit benötigt
kopierte `.horde_campaign`-Dateien als Argumente und wurde nicht als bestanden
gewertet. Die vollständige Browser-Regression, appseitige Timeline-Persistenz
und modellübergreifende End-to-End-Abnahme stehen aus.

### Live-Nachprüfung mit aktuellem Binder

| Modell | frische Aufrufe | Generation | Validierung | Binder-Reparaturen | Ergebnis |
| --- | ---: | ---: | ---: | ---: | --- |
| Gemma 4 31B | 2 | 248,4 s / 20,3 s | 112 ms / 28 ms | 6 / 4 | zweimal drei Player-Actions, drei Events, genau ein Redebeleg, Executor erfolgreich |
| Qwen 2.5 14B | 1 | 113,9 s | 27 ms | 5 | Executor erfolgreich, aber nur zwei Player-Actions: Winken und Sprechen blieben gruppiert; zusätzlich eine NPC-Reaction |

Die Qwen-Antwort belegt weiter eine Graph-Lücke: Das `complete`-Kriterium
des isolierten Harness ist **false**, obwohl der Executor den Turn akzeptiert.
Die Rede und Geste besitzen eigene Events und einen Redebeleg, jedoch keine
separaten unabhängig ausführbaren Player-Actions. Diese Abweichung ist nicht
als bestandene Multi-Action-Abnahme gewertet.

Ein einmaliger isolierter Start von
`world_server_binding_browser_audit.js` mit installiertem Edge statt Chrome
scheiterte schon beim Playwright-Start mit `spawn EPERM`. Es gab keinen
App-Commit, keine Browser-Timeline-Prüfung und keinen weiteren Browser-Start.
Für eine Prüfung in der vorhandenen Windows-Benutzersitzung:

```powershell
cd 'N:\Horde Studio\app'
$env:HORDE_BROWSER_EXECUTABLE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node scratch/world_server_binding_browser_audit.js
```

Auch nach dieser Runde ist die verbindliche Abnahme **nicht** erreicht.
