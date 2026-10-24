# P2.7b – Autonome NPC-Reaktionen (24.10.2026)

## Verbindung der bestehenden Systeme

Bestätigte Linked World Actions erzeugen wie in P2.7a persönliche Beobachtungen. Ein Reiz kann zusätzlich `kind` und `tags` als ausdrücklich beobachtbare, strukturierte Metadaten tragen. Die bestehende NPC-State-Normalisierung erhält jetzt `channel`, `kind`, `tags` und `sourceLocationId` beim Tick und nach Save/Reload. Ohne diese Korrektur gingen die Metadaten vor der Zielbewertung verloren.

Vor `selectNpcGoal` prüft der reguläre World-Tick neue Beobachtungen mit `evaluateObservationReactions`. Beobachtungen aus dem aktuellen Turn bleiben bis zu einer späteren Zielbewertung liegen. Die persistierte Liste `reactionProcessedObservationIds` verhindert, dass derselbe Reiz bei weiteren Ticks oder nach Reload neue Ziele erzeugt. Pro NPC und Tick werden höchstens 16 neue Beobachtungen gegen höchstens 32 Regeln geprüft; nicht bearbeitete Einträge folgen beim nächsten Tick. Ohne `reactionRules` bleibt das bisherige Verhalten erhalten.

## Datenvertrag und Zielwahl

`world.reactionRules` ist optional. Eine Regel verwendet `on` mit exaktem Match auf `channel`, `kind` und/oder ein `tag`; `when` verwendet dieselben strukturierten Quellen wie bestehende `priorityRules` (`need`, `personality`, `relationship`, `obligation`, `motivation`, `local_danger`, `known_news`, `time_window`). Alle `when`-Prädikate müssen zutreffen. Beispielsweise:

```json
{
  "id": "respond-to-disturbance",
  "on": { "channel": "hearing", "kind": "disturbance" },
  "when": [{ "source": "personality", "key": "duty", "atLeast": 60 }],
  "goal": {
    "goal": "Inspect Workshop",
    "priority": 95,
    "completion": { "type": "actor_location", "locationId": "workshop" }
  },
  "expiresAfterTurns": 6
}
```

Eine passende Regel legt eine Definition im vorhandenen `entityStates[npcId].goalPool` ab. `sourceObservationId`, `sourceEventId`, `reactionRuleId` und `createdTurn` erhalten die private Herkunft. Ein gleichnamiges offenes Ziel wird nicht dupliziert. `goalPool` bleibt auf 20 Einträge begrenzt. `priority`, `urgency`, optionale `priorityRules`, Frist und Abschlussbedingung laufen durch die P2.6d-Zielwahl. Bedürfnisse, Persönlichkeit, Beziehungen, Verpflichtungen, Motivation, Gefahr und Weltzeit wirken über deren vorhandene strukturierten Prädikate. Die bestehende Bewertung berücksichtigt außerdem Fortschritt, Blockade, Ausführbarkeit und den Bonus für das laufende Ziel. Eine passende Regel kann dadurch unterbrechen; ein wichtigeres Ziel kann Vorrang behalten. `goalStates` speichert den vorherigen Plan und stellt ihn nach bestätigtem Abschluss wieder her.

Auch ein NPC ohne bisheriges Ziel kann durch eine passende Beobachtung erstmals ein Ziel wählen.

Das Beispiel benennt einen Raum ausdrücklich im Ziel. Dadurch kann der vorhandene lokale Optionskatalog einen bekannten, erreichbaren Bewegungsschritt eindeutig auswählen. Allgemeine Ziele ohne eindeutige Option warten auf den periodischen World Agent. `npcAction`-Freigaben in der Effect Registry bleiben eng; es gibt keine pauschale Freigabe weiterer Effekte. Vor der Ausführung prüfen `inspectNpcGoalStep`, der Linked-Action-Executor und die vorhandenen Bewegungs- und Ressourcenregeln den aktuellen Zustand erneut. Ein Ziel allein verändert die Welt nicht. Abschluss verlangt weiterhin einen bestätigten Event-Beleg und eine passende `completion`-Bedingung.

## Offene Entscheidungen und Wissensgrenzen

Der vorhandene World-Agent-Digest enthält begrenzt neue **persönliche** Beobachtungen mit NPC- und Beobachtungs-ID. Der Agent kann im bestehenden `npc_goal_updates`-Format optional `observation_id` angeben. Der strukturierte Handler akzeptiert diese nur, wenn die Beobachtung im State genau dieses NPCs liegt, bezeugt ist und ein Event referenziert; ein zweites Ziel aus derselben Agent-Beobachtung wird abgewiesen. Kein zusätzlicher Modellaufruf wurde eingeführt. Ein NPC kann einen Reiz ignorieren.

Die deterministische Regel liest keine Freitext-Schlüsselwörter und keine verborgenen Event-Felder. Ein Hörer bekommt den autorisierten `remoteText` und Reizmetadaten, nicht automatisch Akteur, Ursache oder das vollständige Ereignis. Reaktionsziele und private Beobachtungen machen nichts zu globalem Wissen. Vermutungen werden durch diesen Schritt nicht als bezeugte Fakten gespeichert. Tatsächliche Weitergabe und Gerüchte bleiben P2.7c.

## Audits

- `scratch/world_npc_reactions_audit.js`: Zwei NPCs mit unterschiedlichem strukturiertem Persönlichkeitswert hören denselben Reiz; nur einer bekommt das Reaktionsziel. Ein entfernter NPC nimmt nichts wahr. Geprüft wurden Turn-Grenze, Beobachtungs- und Event-IDs, Unterbrechung, Linked-Bewegung auf einem vorbereiteten Candidate, bestätigter Abschluss, Rückkehr zum gespeicherten Schrittindex, JSON-Roundtrip, Wiederholung und verworfener Candidate.
- `scratch/world_npc_reactions_browser_audit.js`: Der echte Browser-World-Tick priorisiert das Ziel eines NPCs, führt eine Offscreen-Bewegung durch den regulären Executor aus, speichert den Bewegungs-Event, beendet das Ziel mit Beleg und setzt im folgenden Tick das alte Ziel fort. Der zweite NPC bleibt bei seinem bisherigen Ziel; der Spieler erhält kein Ereigniswissen. Der auslösende bestätigte Event wurde im Test gezielt an die P2.7a-Wahrnehmung übergeben; dies ist ein deterministischer Integrationstest, kein LLM-Nachweis.
- Bestehende Node-Audits für Wahrnehmung, Zielpriorität, Zielentscheidung und Linked-Goal-Actions bestanden. Bestehende Browser-Audits für Wahrnehmung, Multi-NPC-Goals sowie den Linked-V3-Turn mit Rollback und Reload bestanden.
- Begrenzte Node-Messung: 40 NPCs × 10 neue Beobachtungen benötigten bei mehreren Läufen rund 1–2 ms Reaktionsbewertung und 1,8–2,1 ms Zielwahl; eine Linked Action rund 9–10 ms. Das sind lokale Einzelmessungen, kein vollständiger Tick-Benchmark. Kein echter LLM-Test wurde ausgeführt.

## Grenzen

Welt-Autoren müssen beobachtbare Reizmetadaten und sinnvolle Zieltexte konfigurieren. Strukturierte Regeln interpretieren nicht beliebige Erzähltexte oder Freitext-Persönlichkeiten. Ohne passende Regel oder zulässigen World-Agent-Vorschlag entsteht kein neues Ziel. P2.7c muss tatsächliche Informationsweitergabe und Gerüchte ergänzen. Der Node- und Browser-Audit deckt die neuen Pfade sowie angrenzende Regressionen ab; er ersetzt keinen vollständigen Test aller V2/V3- und Legacy-Save-Fixtures.
