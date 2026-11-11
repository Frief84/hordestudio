# Referenzabgleich für die Linked World Engine (1. November 2026)

Dieser Abgleich bezieht sich auf den aktuellen Code in `app.js`,
`worlds/turn-binding.js`, `worlds/scene-draft.js`,
`worlds/linked-world-actions.js` und `worlds/working-state.js`.

| Referenz | Bereits vorhanden | Sinnvolle Übernahme / Grenze |
| --- | --- | --- |
| [Ollama Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs) | Lokale World-Turns nutzen Ollamas OpenAI-kompatibles `/v1/chat/completions` mit `response_format: {type:"json_schema"}`. Ein natives `/api/chat`-`format` wird nicht verwendet. Das Schema stammt aus dem Scene-Draft-Vertrag und wird für serverseitige Bindung projiziert. | `request` wird bei als einfach erkannten Inputs optional; der Binder kann dann den vollständigen Input binden. `kind` und `status` sind Pflichtfelder, `effects` kann `[]` sein. Das Schema reduziert ungültige Typen/Felder, kann aber fehlende semantische Teilaktionen nicht erkennen. Dieselbe Bindungsstruktur wird für Modellfamilien genutzt; der Executor bleibt autoritativ. |
| [Unified Planning: Action-Modell](https://upf.readthedocs.io/en/stable/problem_representation.html), [PartialOrderPlan](https://upf.readthedocs.io/en/stable/api/plans/PartialOrderPlan.html) | Actions haben `state_conditions`, typisierte Effects und `depends_on`; der Executor prüft Voraussetzungen am laufenden Working State. Unabhängige Actions können nach einem ausdrücklich fehlgeschlagenen Schritt weiterlaufen. | Der aktuelle Graph ist eine geordnete Liste mit zusätzlichen Outcome-Guards, kein voller Partial-Order-Plan. Bei der neuen Action-Zerlegung werden `succeeded`-Dependencies auf beide Teilaktionen übertragen. Echte Gleichzeitigkeit, Überlappung und mehrdeutige `failed`-/`blocked`-Abhängigkeiten benötigen eine explizite Graph-Semantik; solche Fälle dürfen nicht durch bloße Umnummerierung geraten werden. |
| [LLM+AL](https://ojs.aaai.org/index.php/AAAI/article/view/34597) | Modellvorschlag, Binder und World Executor sind getrennt. Der Reducer und Effect Registry entscheiden über World-Änderungen; ein Modellstatus allein beweist keine körperliche Ausführung. | Die neue Zerlegung verwendet typisierte Belege plus eindeutige Inputanker. Unbelegte Narration bleibt ein Reparaturfehler. Authored Transitionen und Weltregeln bleiben im formalen Teil der Engine. |
| [Ajv](https://ajv.js.org/api.html) | Der Binder besitzt einen eigenen schemaabhängigen Validator mit Feldpfaden und Fehlergründen. Ajv ist im Projekt nicht installiert. | Ajv könnte `required`, `type`, `enum` und unbekannte Felder mit `instancePath` genauer melden. Es ersetzt weder Referenzauflösung noch Preconditions-, Effect- oder Erfolgskontrolle. Eine neue Laufzeitabhängigkeit ist für die hier behobene Graph-Ursache nicht erforderlich. |
| [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html) | Working State bereitet Änderungen vor und persistiert den vorbereiteten Snapshot vor Veröffentlichung im Speicher. App-Receipts, bestätigte Events und Effects speichern Referenzen und Audits; Rollback/Reroll nutzen Snapshots. | Horde Studio ist derzeit Snapshot plus Ereignisprotokoll, kein reines Event Sourcing: Nicht jeder Zustand ist ausschließlich aus `turnEvents` rekonstruierbar. Daher müssen Receipt, Eventliste und Snapshot atomar zusammen gespeichert und per Replay/Reload geprüft werden. Keine parallele Persistenzarchitektur einführen. |
| [fast-check Model Based Testing](https://fast-check.dev/docs/advanced/model-based-testing/) | Viele deterministische Node-Audits bestehen; `fast-check` ist nicht installiert. | Ein kleines unabhängiges Zustandsmodell mit generierten Befehlen für Transfer, Bewegung, Transition, Save/Reload und Rollback kann Interleavings und partielle Fehlschläge prüfen. Das Oracle muss einfacher als der produktive Reducer sein. Die derzeitigen festen Captures bleiben Regressionen, ersetzen solche Folgen aber nicht. |
| [Promptfoo Ollama](https://www.promptfoo.dev/docs/providers/ollama/) | Der vorhandene Node-Harness ruft lokale Ollama-Modelle mit derselben Schema- und Weltkonfiguration auf und führt anschließend Binder, Compiler und Executor aus. `promptfoo` ist nicht installiert. | Promptfoo kann Modell-/Prompt-Matrizen und Wiederholungen koordinieren. Der eigentliche Pass/Fail muss weiterhin aus Horde-World-Graph, Effects, Receipt und persistiertem Zustand kommen. Vor einer neuen Abhängigkeit lohnt sich die Erweiterung des vorhandenen Harness um Szenariodaten und Laufzeitmetriken. |

## Umgesetzte Konsequenzen in dieser Runde

- Eine Modell-Action mit einem unabhängigen, typisierten Player-Event und
  eindeutig belegter Rede wird bei einem einzigen Dialogue-Anker in zwei
  Engine-Actions zerlegt. Events und Speech-Evidence werden verschoben statt
  kopiert; Effects bleiben bei ihrer körperlichen Action. Abhängigkeiten und
  Reaction-Positionen werden umnummeriert. Mehrdeutige Fälle bleiben
  ungeteilt und bedürfen einer Modellreparatur.
- Eine rein erzählerische Wiederholung des Spielerinputs ohne typisierten
  Beleg wird abgelehnt. Die App-Reparaturanweisung adressiert nur die
  betroffenen Actions und verbietet einen aus Prosa abgeleiteten Erfolg.
- Die eigentliche World-State-Prüfung bleibt in Compiler/Executor/Reducer.

## Nicht bestätigt

Der browserseitige App-Commit, die persistierte Timeline und die
Save/Reload-/Rollback-/Reroll-Kette für die neuen Mehrfachturns konnten wegen
`spawn EPERM` beim Browserstart bisher nicht Ende zu Ende geprüft werden.

## Frische Modellaufrufe mit aktuellem Node-Pfad

Alle Aufrufe verwendeten dieselbe isolierte Kitchen-Welt und das gleiche
verbindliche Schema pro Szenario. Die Zeiten sind Millisekunden; Reparaturen
sind deterministische Binder-Normalisierungen, keine vollständigen neuen
Modellgenerierungen.

| Szenario | Modell | Generierung | Validierung | Gesamt | Reparaturen | Ergebnis |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Knien, Winken, Sprechen | Gemma 4 31B | 243167 | 111 | 243278 | 4 | 3 Player-Actions, 3 Events, 1 Speech; Executor erfolgreich |
| Knien, Winken, Sprechen | Qwen 2.5 14B | 7141 | 40 | 7181 | 7 | 3 Player-Actions, 5 Events mit Reaction, 1 Speech; Executor erfolgreich |
| Pirouette, Signal, Murmeln | Gemma 4 31B | 23754 | 34 | 23788 | 4 | 3 Player-Actions, 3 Events, 1 Speech; Executor erfolgreich |
| Pirouette, Signal, Murmeln | Qwen 2.5 14B | 4677 | 31 | 4708 | 3 | 3 Player-Actions, 2 Events, 1 Speech; Executor erfolgreich |
| Fehlender Gegenstand, unabhängiges Signal, Murmeln | Gemma 4 31B | 258237 | 30 | 258267 | 2 | `unverified_action_success` für ersten Schritt; kein Commit |
| Fehlender Gegenstand, unabhängiges Signal, Murmeln | Qwen 2.5 14B | 6486 | 33 | 6519 | 3 | `event_field_type_conflict`; kein Commit |

Die beiden Teilfehlschlag-Aufrufe belegen eine offene Lücke: Ein fehlerhafter
Teil eines Modellvorschlags kann noch die Annahme des ganzen Turns verhindern.
Die unabhängigen Schritte sind in diesen beiden frischen Aufrufen daher **nicht**
persistiert worden. Die App fordert jetzt für den Event-Feldkonflikt und für
fehlenden Ausführungsbeleg gezielt Korrekturen an; deren erfolgreicher
Live-Nachlauf ist noch nicht bestätigt. GPT-OSS wurde mit einer früheren echten
Antwort mit unmöglichen Preconditions deterministisch neu gebunden; Mistrals
unbelegte körperliche Handlung wurde abgelehnt. Beide wurden nach der letzten
Zerlegungsänderung nicht frisch aufgerufen.

18 ausgewählte direkte Node-Audits bestanden nach der Änderung. Von vier
weiteren scheiterten zwei am fehlenden Playwright-Binary, einer nach acht
bestandenen Checks an fehlendem DOM im direkten Node-Prozess und ein älterer
Contract-Audit an einer inzwischen erweiterten Fact-Typ-Liste. Der
`world_server_binding_audit.js` erreicht seinen internen Worker-Start, der in
dieser Sandbox mit `spawn EPERM` fehlschlägt. Keiner dieser Fehlschläge zählt
als bestanden. Syntaxprüfung und `git diff --check` der geänderten Engine-Dateien
bestanden.

Der isolierte App-Live-Harness enthält jetzt die Szenarien `MULTI_NOVEL`,
`PARTIAL_MISSING` und `MOVE_SPEECH` und speichert Live-/DB-Timeline-Einträge
und Receipts im Diagnoseergebnis. Wegen `spawn EPERM` ist diese Prüfung noch
nicht ausgeführt. Für die vorhandene Windows-Benutzersitzung:

```powershell
cd 'N:\Horde Studio\app'
$env:HORDE_BROWSER_EXECUTABLE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$env:HORDE_LIVE_MODEL = 'gemma4:31b-it-q4_K_M'
$env:HORDE_LIVE_CASE = 'MULTI_NOVEL'
$env:HORDE_LIVE_OUTPUT = 'N:\Horde Studio\app\scratch\world-app-multi-gemma.json'
node scratch/world_linked_ollama_live_audit.js
```

Für Qwen denselben Befehl mit `HORDE_LIVE_MODEL` und `HORDE_LIVE_OUTPUT`
anpassen. Für den Teilfehlschlag `HORDE_LIVE_CASE='PARTIAL_MISSING'` setzen.
Save/Reload, Rollback und Reroll sind auch mit diesem Befehl noch nicht
vollständig abgedeckt.

## Fortsetzung: isolierte Teilfehlschläge

Der Linked Executor besitzt im App-Pfad jetzt eine explizite partielle
Recovery-Option. Ein `unverified_action_success` oder
`uncommitted_completed_event` setzt nur den Savepoint dieser Action zurück,
meldet für sie `unresolved` samt Fehlergrund und führt unabhängige Actions
weiter aus. Eine autoritativ nicht erfüllte State-Condition ergibt `blocked`;
abhängige Actions werden `skipped`. Das ist keine Bestätigung eines
fehlgeschlagenen Versuchs: Wenn weder Erfolg noch konkreter Fehlschlag belegt
sind, bleibt der Status bewusst ungeklärt. Die übrigen Aufrufpfade behalten
ihre bisherige strikte Fehlerbehandlung.

Im App-Receipt werden abgeschlossene Events nur für tatsächlich erfolgreiche
Actions übernommen. Unbelegte Passagen und Speech-Attributions gelangen nicht
in den Commit; Action-Ergebnisse und Fehlergründe bleiben im Receipt/Audit.
Der vorbereitete Working State wird weiterhin erst nach erfolgreicher
Receipt-/Invariantenprüfung atomar persistiert. Ein Modell-`interaction` ohne
konkretes `action`-Feld reicht im partiellen App-Pfad nicht mehr als
Ausführungsbeleg. Verifizierte körperliche Actions dürfen mehrere Passagen
oder unterschiedlich viele Events haben; entscheidend sind Actor, Typ,
Action- und Passage-Referenz sowie ein konkreter Tätigkeitsbeleg.

Das Replay der echten Gemma-Teilfehlantwort endet jetzt mit
`unresolved, unresolved, succeeded`: Die ersten beiden körperlichen
Actions hatten nur unbenannte Interaction-Events, die Rede ist belegt. Die
unabhängige Geste wird folgerichtig noch nicht als erfolgreich erfunden.
Ein neuer deterministischer Graph-Test bestätigt dagegen
`unresolved, succeeded, skipped, succeeded`, wenn eine unabhängige Geste
einen gültigen Activity-Beleg besitzt. Ein weiterer Test bestätigt
`blocked, succeeded, skipped` bei einer unerfüllten World-Precondition.

19 ausgewählte direkte Node-Audits bestanden nach diesen Änderungen. Der
alte Contract-Audit erwartete fälschlich eine Fact-Liste ohne den tatsächlich
registrierten Typ `following_player`; beide Erwartungen wurden angepasst und
der Audit besteht. Die beiden Playwright-Audits scheitern weiterhin am
fehlenden Headless-Binary. Der Graph-Consistency-Audit besteht seine acht
Fachchecks, wirft danach ohne Browser-DOM `document is not defined`.
Der isolierte App-Live-Start von `MULTI_NOVEL` mit Edge wurde vor dem
Weltaufbau durch `spawn EPERM` blockiert. Die drei Szenarien und die
Persistenzkette wurden daher nicht als bestanden gewertet.

Der App-Live-Harness kann mit `HORDE_LIVE_LIFECYCLE=1` nach einem akzeptierten
Turn den gespeicherten Receipt und die Timeline erneut aus IndexedDB lesen,
einen Reroll ausführen und anschließend den Pre-Turn-Snapshot zurückrollen
und speichern. Diese Erweiterung wurde syntaktisch geprüft, aber wegen
`spawn EPERM` noch nicht praktisch ausgeführt. Vollständige Befehle für
die normale Windows-PowerShell:

```powershell
cd 'N:\Horde Studio\app'
$env:HORDE_BROWSER_EXECUTABLE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$env:HORDE_LIVE_LIFECYCLE = '1'
$env:HORDE_LIVE_MAX_REQUESTS = '6'
$models = @('gemma4:31b-it-q4_K_M', 'qwen2.5:14b-instruct-q4_K_M')
$cases = @('MULTI_NOVEL', 'PARTIAL_MISSING', 'MOVE_SPEECH')
foreach ($model in $models) {
    foreach ($case in $cases) {
        $env:HORDE_LIVE_MODEL = $model
        $env:HORDE_LIVE_CASE = $case
        $slug = ($model -replace '[^a-zA-Z0-9]+', '_')
        $env:HORDE_LIVE_OUTPUT = "N:\Horde Studio\app\scratch\app-live-$slug-$case.json"
        node scratch/world_linked_ollama_live_audit.js
        if ($LASTEXITCODE -ne 0) { throw "App-Live-Audit fehlgeschlagen: $model $case" }
    }
}
```

Der Harness erzeugt ausschließlich isolierte Welten. Ein erfolgreicher
Prozess-Exit allein bestätigt die Abnahme noch nicht. Für die drei neuen
Szenarien setzt der Harness inzwischen Exit-Code 1, wenn Receipt/DB-Abgleich,
Action-Zahl, der Beleg jeder erfolgreichen körperlichen Action,
unabhängige Teilerfolge, bestätigte Effects, Event-Zuordnung oder die
Laufzeitprüfung scheitern. In jeder Ergebnisdatei müssen zusätzlich
`accepted`, `saved`, die Action-/Event-/Effect-Referenzen und
`lifecycle.reloadedFirst`, `lifecycle.rollbackPersisted` sowie die Reroll-IDs
geprüft werden. Insbesondere für `PARTIAL_MISSING` ist noch eine gezielte
Modellreparatur des Qwen-Event-Konflikts nötig; der aktuelle Reparaturprompt
fordert nur die betroffenen Felder neu an, sein Live-Erfolg ist unbestätigt.
