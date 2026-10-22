# Living Worlds: Übergabe für die nächste Codex-Sitzung

Stand: 21.10.2026, lokaler `main` auf `0ec48f5`. Nur Living Worlds. Acht Dateien sind geändert und nicht committet: `app.js`, `worlds/effect-registry.js`, `worlds/linked-world-actions.js`, `worlds/scene-draft.js`, `worlds/turn-context.js` und drei Audits unter `scratch/`. Diese Änderungen erhalten; kein Commit, Push oder Merge wurde für P2 ausgeführt.

## Bereits dokumentiert

- [Phase 4](world-architecture-phase4-2026-10-20.md): Architektur, Upstream-Abgleich und Entwicklungsplan. Die dortigen P0-Befunde sind historisch; P0a/P0b wurden danach umgesetzt.
- [P1b](world-p1b-completion-2026-10-21.md): V3 bleibt produktiv; kompakter Transport und Receipt-Narration sind experimentell. Modellqualität und technische Annahme werden getrennt bewertet.
- [P1c](world-p1c-state-performance-2026-10-21.md): kanonischer World-/Session-Zustand in IndexedDB, abgeleiteter Recall, gemessene Normalisierungsoptimierung und Grenzen der Save-Tests.

## Neuer lokaler Stand seit P1c

- **P2.1:** Bestätigte Linked-Events werden innerhalb des erfolgreichen World-Turn-Commits quellengebunden in persönliche NPC-Beobachtungen und, sofern teilbar und objektiv belegt, in vorhandene `worldNews` übertragen. `sceneMemory` übernimmt dieselbe begrenzte Zielgruppe. Subjektive Aussagen und bloße Dialoge werden nicht als objektive Weltfakten verbreitet. Betroffen: `app.js`, `worlds/turn-context.js`; Gegenprobe: `scratch/world_npc_knowledge_recall_audit.js`.
- **P2.2:** Die bestehende `onEvent`-/Registry-Folgeeffekt-Schnittstelle wurde geprüft. Ohne Ereignisreferenz im Effect-Trace war eine produktive Regelverdrahtung noch nicht sicher; P2.2 selbst aktivierte keine konfigurierbaren Regeln.
- **P2.2a:** `effect-registry.js` liefert Parent-Indizes der Folgeeffekte; `linked-world-actions.js` verlangt für jeden ausgeführten Folgeeffekt einen eindeutigen bestätigten Ursachen-Event und einen eigenen passenden Effektbeleg. Fehlende oder doppelte Belege sowie direkte Hook-Mutationen führen zum Rollback. Der bestätigte Trace enthält `cause_event_id`; negative Gegenproben bleiben in `scratch/world_linked_hardening_audit.js`.
- **P2.2b geprüft:** `executeLinkedActions` kann die optionale `world.eventRules`-Folge aus einem eindeutig durch einen geänderten technischen Effekt belegten Ereignis auslösen, auch ohne Modell-`event_emit`. Zwei verschiedene `outfit`-Ereignisse lösen dieselbe Regel für zwei NPCs unabhängig aus; jeder Folgeeffekt erhält einen eigenen Ereignisbeleg und `cause_event_id`. Der normale V3-Browserpfad bestätigt zwei aufeinanderfolgende Turns, atomare Persistierung und Reload. Blockierte Aktionen, fehlende oder falsche Belege, doppelte Verarbeitung und Speicherfehler rollen zurück. Die Schema-Kürzung bewahrt `event_emit.description` als Pflichtfeld und entfernt im Effektvertrag nur Schema-Beschreibungstexte.

## Nächster Schritt und Prüfgrenze

Bestanden am 21.10.2026: `world_linked_hardening_audit`, `world_linked_contract_audit`, `world_linked_execution_audit`, `world_linked_generalization_audit`, `world_scene_draft_audit`, `world_npc_knowledge_recall_audit`, `world_linked_turn_browser_audit`, `world_linked_chain_browser_audit`, `world_server_binding_browser_audit` und `worlds2_provider_response_browser_audit`. Der ältere V2-`world_scene_draft_browser_audit` scheitert weiterhin an der bereits dokumentierten Retry-Zahl (7 statt 6); dieser Fehler liegt außerhalb der P2.2b-Änderungen. Keine Virtual-Humans- oder Multiplayer-Dateien wurden geändert.

Diese Übergabe ist eine Bestandsaufnahme, kein erneuter Audit; die aktuellen uncommitteten Änderungen wurden hierfür nicht erneut vollständig getestet.
