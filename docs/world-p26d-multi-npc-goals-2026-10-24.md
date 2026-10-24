# P2.6d – konkurrierende NPC-Ziele und Offscreen-Handlungen (24.10.2026)

## Zielwahl

`goalPool` enthält nun gleichzeitig bewertete Ziele. Alte String-Einträge bleiben gültig; strukturierte Einträge können `priority`, `urgency`, `difficulty`, `steps`, `actionSteps`, `completion` und `priorityRules` tragen. Das Hauptziel verwendet `goalPriority`, `goalUrgency` und `goalPriorityRules`. Die deterministische Bewertung addiert Priorität, Dringlichkeit, nahende Deadline, kleinen Planfortschritt und passende datengetriebene Regeln. Regeln können strukturierte Bedürfnisse, Persönlichkeit, Motivation, Beziehung, Verpflichtung, bekannte Nachricht, lokale Gefahr und Weltzeit prüfen. Ein Bonus für das aktuelle Ziel und eine Wechselhürde stabilisieren Gleichstände. Ein unverändert blockierter Schritt erhält einen starken Malus; fehlende Ausführbarkeit einen kleineren. `goalSelection` speichert die Faktoren der fünf besten Kandidaten für spätere Editor- und Diagnoseansichten. Regeln sind Daten, keine Charakter- oder Genre-Sonderfälle.

## Unterbrechen und fortsetzen

`goalStates` speichert je Ziel die bestehenden Goal-Felder einschließlich `goalActionProgress`, Schrittindex, Vorschlag, Abschlussbeleg, Status und Frist. Ein Wechsel markiert ein aktives Ziel als `interrupted` und hält seinen Fortschritt fest. Auch ein durch `npc_goal_updates` gesetztes Ziel wird in den Session-`goalPool` aufgenommen, damit frühere freie Ziele wieder erreichbar bleiben. Nach Abschluss des dringenden Ziels wird ein offenes Ziel wieder geladen. Bereits bestätigte Schritte bleiben gezählt; der nächste Schritt wird gegen den aktuellen Weltzustand geprüft. `completed`, `failed`, `abandoned`, `blocked`, `interrupted` und `active` bleiben unterscheidbar. Bei einem freien Ziel ohne gültigen Schritt kennzeichnet `goalWaitStatus: awaiting_decision` die Wartephase, während `goalStatus: active` für ältere Saves und Agentenvorschläge kompatibel bleibt. Ein alter Blockadegrund wird bei veränderter lokaler Welt erneut geprüft.

## Ausführung mehrerer NPCs

Der bestehende World-Tick bearbeitet NPCs nacheinander. Jede Aktion läuft durch `executeNpcGoalStep` und `executeLinkedActions` auf dem dann aktuellen Working State. Ein bestätigter Effekt wird vor dem nächsten NPC übernommen. Der zweite Zugriff auf einen bereits genommenen Gegenstand scheitert; Offscreen-Bewegung und Verbrauch verändern den gespeicherten Zustand. `turnEvents` behalten Action-, Event-, Actor- und Zeitbezug. `worldNews` für Offscreen-Aktionen bleiben ohne direkte Spielerwahrnehmung privat. Eine vollständige Verbreitung von Geräuschen, Sicht und Nachrichten gehört zu P2.7.

Bewegung, Aufnahme und Türübergang bleiben die Standardoptionen. Die Effect Registry kann zusätzlich `npcAction.options`, `npcAction.event` und optional `npcAction.satisfied` bereitstellen. Kandidaten entstehen aus dem lokalen NPC-Kontext; Linked Actions prüfen Berechtigungen, Voraussetzungen, Zeugen und Ressourcen erneut. `item_consume` nutzt diese Schnittstelle nur für eigene Inventargegenstände mit `properties.npcConsumable: true`. Weitere Effekte benötigen eine explizite solche Metadatenfreigabe. Es gibt keine pauschale Freigabe aller Registry-Effekte.

## Audits und Grenzen

- Deterministische Node-Audits: Goal-Priorität, stabiles Gleichstandsverhalten, blockierte Alternative, Save/Reload, Schrittbelege, Linked-Action-Rollback und Event-Verträge bestanden.
- Browser mit deterministischem Tick und simuliertem World-Agent-Vorschlag: bestehende Goal-Tick- und Free-Goal-Audits sowie neuer Multi-NPC-Audit bestanden. Geprüft wurden konkurrierende Ziele, Unterbrechen/Fortsetzen, zwei NPCs am selben Gegenstand, Aktionen in verschiedenen Räumen, Offscreen-Persistenz, private News, Verbrauch, Reload und wiederholter Tick.
- Bestehender Browser-Audit der Speicher-Migration bestanden: atomare V1-Migration und Wiederherstellung nach Reload. Das neue Goal-State-Format benötigt keine Änderung der Save-Version; V2/V3 wurden in diesem Auftrag nicht mit eigenen Fixtures erneut durchlaufen.
- Begrenzter Kosten-Audit: 40 NPCs mit je 10 Zielen über 50 Ticks, also 20.000 Kandidatenbewertungen, in 35–52 ms bei mehreren Node-Läufen auf diesem Rechner. Der Wert misst nur die Zielwahl, nicht Rendering oder ganze Welt-Ticks.
- Echte LLM-Tests wurden nicht ausgeführt. Es wurden keine zusätzlichen Modellaufrufe eingeführt; offene Entscheidungen nutzen weiterhin den periodischen World Agent.

Der Katalog freier Aktionen bleibt bewusst klein. Offene Ziele ohne eindeutige lokale Option brauchen weiterhin einen Agentenvorschlag. Formale Regeln können nur bereits strukturierte Fakten bewerten; die semantische Interpretation beliebiger Motivations- oder Verpflichtungstexte ist nicht deterministisch. Die bisherige Textarea für `goalPool` zeigt Zielnamen, aber keine Regel- oder Prioritätsfelder. Der spätere Node-Editor kann die dokumentierten strukturierten Felder bearbeiten. Die bestehenden Zeit- und NPC-Grenzen bleiben maßgeblich.

Die Trennung zwischen Agentenentscheidung und autoritativem Welt-Effekt entspricht dem nützlichen Teil der [AI-Town-Architektur](https://github.com/a16z-infra/ai-town/blob/main/ARCHITECTURE.md). Die dortige Echtzeit-Tick-Engine wurde nicht übernommen. [AI Dungeon](https://aidungeon.com/) und [Voyage](https://voyage.io/) dienten als Erzählreferenzen, nicht als Quelle für eine zusätzliche Simulationsschicht.
