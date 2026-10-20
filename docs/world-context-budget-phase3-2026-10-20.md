# Living Worlds: Kontextbudget und Recall (Phase 3)

Basis: lokaler Commit `3bbeb81`. Vergleich mit demselben geskripteten Browser-Audit gegen einen lokalen, unveränderten Checkout dieses Commits und gegen die optimierte Arbeitskopie. Keine Remote-Daten oder Live-LLM-Antworten.

## Änderung und Grenzen

- `worlds/turn-context.js` projiziert das bestehende Lore-Paket ausschließlich für den Prompt: Retrieval-Diagnostik entfällt; NPC-Orts-IDs stehen schon in der jeweiligen Perspektive; exakt identische NPC-Fakten verweisen auf die weiterhin ausgeschriebenen Erzähler-Fakten. Unbekannte ältere Faktenformate bleiben vollständig erhalten.
- Der aktuelle Ortstext wird nur dann durch einen Verweis ersetzt, wenn die vollständige authored Beschreibung im Lore-Paket steht; dynamische Zusätze bleiben im Prompt.
- Exakte Ledger-Zeilen werden nicht erneut aus dem Archiv oder als `[WORLD HISTORY]` in der Memory Matrix gesendet. Eigenständige lokale Erinnerungen, Ereignisse und Recall mit Quellen bleiben erhalten. Leere Recall-Blöcke entfallen.
- Der kanonische Zustand, das gespeicherte Lore-Paket, Action/Effect/Binding, Schemata und Reparaturprompt bleiben unverändert. Die neue `turnCallAudit.metrics.contextSources`-Aufschlüsselung betrifft nur Telemetrie.

## Reproduzierbare Größe

`node scratch/world_context_budget_browser_audit.js` verwendet fünf identische, geskriptete World-Fixtures vor/nach der Änderung. Werte sind Zeichen des tatsächlich gesendeten ersten Chat-Requests einschließlich Schema. Die zufällige Beziehungsdrift ist im Fixture abgeschaltet, damit wiederholte Läufe dieselben Werte liefern.

| Fixture | Vorher | Nachher | Ersparnis | Modellaufrufe / Reparaturen vorher → nachher |
| --- | ---: | ---: | ---: | --- |
| Kleine Welt | 58.742 | 58.249 | 493 (0,8 %) | 1 / 0 → 1 / 0 |
| 18 Orte, 8 NPCs, lange Historie | 88.030 | 84.943 | 3.087 (3,5 %) | 1 / 0 → 1 / 0 |
| Szenenwechsel | 76.637 | 75.086 | 1.551 (2,0 %) | 1 / 0 → 1 / 0 |
| Widersprüchlicher Effekt, Reparatur | 87.995 | 84.908 | 3.087 (3,5 %) | 2 / 1 → 2 / 1 |
| V2 → V3, Save/Reload | 78.117 | 75.030 | 3.087 (4,0 %) | 2 / 0 → 2 / 0 |

Der Reparatur-Request umfasst in beiden Versionen **41.943 Zeichen**. Im großen Fixture meldet `turnCallAudit.metrics.contextSources` nach der Änderung u. a. Lore 9.185, NPC-Perspektiven 8.133, Ledger/Archiv 1.095, quellengebundenen Recall 1.251 und Schema 35.859 Zeichen. Die Teilwerte sind Diagnosewerte und keine disjunkte Summe aller Promptteile. Tatsächliche Modell-Token, Latenz und Qualität eines Live-LLM wurden nicht gemessen.

## Funktionale und Speicher-Kompatibilität

Die identischen Vorher/Nachher-Fixtures prüfen: relevantes Lore, persönliche NPC-Erinnerung und alten quellengebundenen Recall im Prompt; `allowed_next` und den Zustand einer gesperrten Route; offene Verpflichtung; denselben akzeptierten Action-Ausgang; genau eine Reparatur bei unbegründetem Effekt; V2- und V3-Turns mit Spieler- und NPC-Outfit-Effekten; Erhalt der älteren Erinnerung, Beziehung, Ledger-Zeilen und Receipt-Historie nach Save/Reload. Alle fünf bestanden in beiden lokalen Versionen.

Weitere bestandene Audits: `world_turn_context_audit.js`, `world_lore_audit.js`, `world_long_memory_audit.js`, `world_npc_knowledge_recall_audit.js`, `world_latency_audit.js`, `world_server_binding_audit.js`, `world_server_binding_browser_audit.js`, `world_linked_turn_browser_audit.js`, `worlds2_persistence_browser_audit.js`, `worlds2_npc_knowledge_browser_audit.js`, `worlds2_prompt_and_npc_browser_audit.js` sowie `worlds2_campaign_browser_audit.js` im Worlds-Modus. Letzterer prüft V1-Import und V2/V3-Import/Export mit Zustandsvergleich für NPCs, Erinnerungen, Beziehungen, Inventar, Orte, Quests, Verpflichtungen, Weltzeit, Ledger und Historie. `world_real_save_continuation_audit.js` benötigt echte exportierte Kampagnen; im lokalen Repository liegen keine solchen Eingaben vor.

Zwei weitere Browser-Audits scheitern bereits auf dem unveränderten lokalen Commit `3bbeb81`: `world_scene_draft_browser_audit.js` an der erwarteten Retry-Zahl und `world_lore_browser_audit.js` an einer UI-Button-Zahl. Diese bestehenden Abweichungen wurden nicht durch die Kontextänderung eingeführt.

## Separate nächste Potenziale

Das große strukturierte Schema (hier rund 35.000 Zeichen) und der 41.943-Zeichen-Reparaturprompt bleiben die größten gemessenen Einzelblöcke. Ihre Optimierung erfordert eigene Funktions- und Kompatibilitätsvergleiche; sie ist nicht Teil dieser Änderung.
