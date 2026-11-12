# Living Worlds: Funktions-, Stabilitäts- und Usability-Audit

Stand: 12. November 2026. Geprüft wurde die aktive Anwendung unter `app`; Backup-Kopien und andere Produktbereiche waren nicht Gegenstand der Prüfung. Alle praktischen Browserprüfungen nutzten isolierte Profile und Testwelten. Vorhandene Benutzerwelten und Kampagnen wurden nicht verändert. Vollständige Laufprotokolle, Messergebnisse und zwei UI-Aufnahmen liegen unter `app/scratch/living-worlds-audit-20261112/`.

## Ergebnis

90 isolierte JavaScript-Suiten wurden nach den Korrekturen abschließend ausgeführt: 88 bestanden, 2 schlugen fehl. Darin sind 30 bestandene Browsertests. Hinzu kommen bestandene Python-Prüfungen der echten lokalen HTTP-Routen (`world_server_binding_http_audit.py`, `world_static_route_audit.py`) und des Weltpaket-Builders (`vh_world_pack_builder_audit.py`). `git diff --check` zeigte keine Whitespace-Fehler.

**Keine pauschale Freigabe:** Die beiden roten Suiten und die Grenzen beim Live-Modell sind unten dokumentiert. Einzelne externe Provider und jede Kombination sämtlicher Editoroptionen können in dieser Umgebung nicht vollständig getestet werden.

## Funktions- und UX-Matrix

| Bereich | Ausgeführte Prüfung | Ergebnis / Grenze |
|---|---|---|
| Welt erstellen, bearbeiten, speichern, laden | Neuer Browser-Regressionstest erstellt und speichert eine Testwelt, lädt sie neu, besucht alle Studio-Tabs, bearbeitet sie und injiziert einen Speicherfehler | Bestanden nach Korrektur; ungespeicherter Entwurf bleibt retrybar, Bibliothek bleibt kanonisch |
| Import/Export, bestehende Kampagnen | `worlds2_campaign_browser_audit`: Welt- und Kampagnenarchive, Legacy-JSON, ZIP, Medien, Verlauf, Fortsetzung, Reload, beschädigtes Archiv, Rollback | Bestanden; reale alte private Spielstände wurden bewusst nicht geöffnet |
| Overview, Lore, Structure | Alle Studio-Tabs gerendert; Lore-Logik und Lore-Browserprüfung mit Suche, Ortseinträgen, Vorschlag, Generierung, mobiler Dialogbreite | Bestanden; Generation mit realem externen Modell nicht vollständig verifiziert |
| Architect, Karten, Grundrisse | Kartenalgorithmus, 2.000-Orte-Stress, UI-Maustest: Zoom/Fit, Drag, Undo, Verbindung, Raum platzieren, Roundtrip, Spielkarte bei 390 px | Bestanden; Pan und Resize statisch/Geometrie geprüft, nicht jede Pointer-Kombination manuell |
| Orte, Räume, Türen, Zugänge | Graph-, Tür-, Schlüssel-, NPC-Zugangs-, manueller Schlosscheck- und Browserprüfungen | Bestanden außer offenem Verschachtelungs-Routenfall M1 |
| Reisen, Bewegung, Standort | Mobile Reiseausgänge, mehrteilige Routen, Fähre, gesperrte Route, fehlgeschlagene Folgeaktion, gespeicherte Position | Bestanden in aktuellen Suiten; alter Movement-Stresstest rot (M1) |
| NPC, Begleiter, Beziehungen | Ziele, Zeitpläne, Beobachtungen, Wissensaustausch, Reaktionen, Eskortierung, Beziehungen, Positionen, Reload und Rollback | Bestanden in isolierten Tests; nicht jede Begleiter-UI-Aktion manuell geprüft |
| Inventar, Gegenstände, Ausrüstung, Ressourcen | Szenengegenstände, Container, Hindernisse, NPC-Bestände, Stapel, Transfers, Erschaffung, Kosten, Ablauf, Ausrüstung und Outfit | Bestanden; Testvertrag zwischen verarbeitetem Zug und blockierter Einzelaktion geklärt |
| Quests, Ereignisse, Persistenz | Quest-Engine mit 11 Checks, Startquests, einmalige Belohnungen, Events, Zeit, atomare Speicherung, Recovery | Bestanden |
| RPG Off/Light/Full | Regelprofile und Modulgating, System-/Releaseverträge sowie drei isolierte Welten mit UI-Auswahl, Speicherung und Reload | Bestanden; vollständiger Langzeitkampagnenvergleich je Profil fehlt |
| Aktionen und KI-Erzählung | Intent, Bindung, Receipt, Erzählungsabgleich, ungültige Providerantwort, Abhängigkeiten und Rollback | Offline-Suiten bestanden; Live-Modell lieferte einen fehlerhaften bedingten Schritt, jetzt vor Zustandsänderung abgewiesen; L1 offen zur Modellqualität |
| Große Welten | 2.000 Orte, 5.000 NPCs, 500 Ereignisse, 200 Fraktionen, 120 Züge | Nach Optimierung 12,8 s statt 45–50 s; Browser-Responsivität unter dieser Maximalbelastung nicht gemessen |
| Python/HTTP | echte lokale Route `/worlds/bind-turn`, JS-Auslieferung, Weltpaket-Builder | Bestanden mit temporärer Konfiguration; externe Provider und Langzeitbetrieb nicht getestet |

## Reproduzierbare Befunde und Korrekturen

**F1 – ungespeicherte Editoränderung wurde in die laufende Bibliothek übernommen (hoch, P1), behoben.** Reproduktion: Welt im Studio speichern, Namen ändern, `saveState()` scheitern lassen, anschließend `state.worlds` prüfen. Vorher enthielt die Bibliothek bereits den neuen Namen, obwohl die Speicherung fehlgeschlagen war. `app/app.js` um Zeile 17400 stellt bei Fehlschlag den vorherigen Bibliothekseintrag wieder her; ein neu angelegter, fehlgeschlagen gespeicherter Eintrag wird entfernt. Der Entwurf bleibt zum erneuten Speichern offen. Regression: `app/scratch/living_worlds_editor_regression.js`, Erstellung, Reload, Tabs und beide Fehlerfälle bestanden.

**F2 – Maximalwelt-Simulation überschritt die 20-s-Grenze (mittel, P3), behoben.** Reproduktion: `node scratch/living_world_stress_test.js`. Vorher 45–50 s für 120 Züge. CPU-Profil: wiederholte vollständige NPC-Suche in Gesprächen. `app/app.js` um Zeile 43605 baut einen Sprecherindex pro Simulationsschritt auf und erneuert ihn, wenn eine bestätigte Aktion Definitionen ersetzt. Nachher 12,8 s. Simulation, NPC-Ziele, Reaktionen und Wissensaustausch erneut bestanden.

**F3 – Modell lässt ausdrückliche Bedingung ohne Abhängigkeit weg (hoch, P2), Zustand gesichert, Modellproblem offen.** Live-Reproduktion mit lokalem `qwen2.5:14b`: „Try to enter the sealed east gallery; if that succeeds, take the brass key.“ Das Modell lieferte `depends_on: []`; zuvor wurde der zweite Schritt separat als blockierte Aktion verarbeitet. `app/worlds/resolved-intent.js` um Zeile 410 weist diesen klaren Bedingungswortlaut ohne Abhängigkeit nun zurück. Dadurch bleibt die Eingabe zur Korrektur erhalten und es entsteht keine ungewollte Zustandsänderung. Regression in `app/scratch/world_resolved_intent_contract_audit.js` bestanden. Das Modell selbst liefert weiterhin gelegentlich unvollständige Struktur; für alle Sprachen und Formulierungen gibt es keine Garantie.

**T1 – veraltete Testannahmen (niedrig, P3), angepasst.** `scratch/app_source.js` stellte VM-Tests `structuredClone` und aktuelle Weltmodule bereit; `world_systems_audit.js` prüft Spielerannahme von Quests statt automatisches Erzeugen. Map-/Lore-/HTTP-Tests erwarteten frühere Texte oder UI-Elemente. Szenengegenstands- und Erreichbarkeitstests unterscheiden nun, ob der Zug verarbeitet und ob die konkrete Aktion ausgeführt wurde. Alle betreffenden Suiten bestanden anschließend.

## Verbleibende Probleme

**M1 – verschachtelter Ort ohne explizite Verbindung (mittel, P2).** `movement_ledger_stress_test.js:205` erwartet den Weg `bedroom > smith_house > Hub` allein aus `parentLocationId`; `findWorldTravelPathCore` in `app/app.js:17825` nutzt dagegen explizite Ausgänge und liefert keinen Pfad. Reproduktion: Orte wie im Test ohne Exits anlegen, Route vom Raum zum übergeordneten Ort anfragen. Hier besteht ein Widerspruch zwischen generischem „exit“ und Graphreise. Es wurde keine implizite Verbindung ergänzt, weil dies Zugangsregeln bestehender Welten verändern könnte. Empfehlung: im Editor fehlende parent-/child-Kanten sichtbar validieren und beim Autorisieren kontrolliert erzeugen oder die generische Exit-Aktion an dieselbe Graphregel binden.

**M2 – alte Browserkette verwendet nicht mehr das Intent-Protokoll (niedrig, P3).** `world_linked_chain_browser_audit.js:154` erwartet bei ungültiger KI-Antwort `lastTurnAudit === null`; die aktuelle Anwendung speichert einen Fehler-Diagnoseeintrag mit `WORLD_MODEL_INVALID_JSON`. Reproduktion: Suite ausführen. Die Eingabe bleibt erhalten und es wird keine falsche Weltaktion bestätigt; die ältere Assertion muss auf Diagnose und unveränderten Spielzustand umgestellt werden. Aktuelle Provider-/Intent-Browsersuiten bestehen.

**L1 – Live-Modellqualität (mittel, P2).** Sieben der acht lokalen Mehrschritt-Szenarien erfüllten im dokumentierten `qwen2.5:14b`-Lauf die jeweiligen Anforderungen; im bedingten Fall fehlte die Abhängigkeit. Der Lauf schlug deshalb an der Status-Assertion fehl. Die neue Validierung verwirft diesen Fall sicher, macht aus ihm aber keinen erfolgreichen Spielzug. Live-Ergebnisse stehen in `live_qwen.log` und der zugehörigen JSON-Datei.

**UX-Grenzen.** Karten-Pan, Resize-Handles, Drag-and-drop außerhalb des Grundrisses, Dialoge bei allen Fenstermaßen, Screenreader-Bedienung und sämtliche Kombinationspfade wurden nicht vollständig praktisch durchlaufen. Ein mobiler Screenshot zeigt die Karte bei 390 px mit nutzbaren Zoom-/Fit-Steuerelementen; die Raumlabels sind bei Fit auf 32 % sehr klein. Empfehlung: Mindestgröße/vereinfachte Labels bei kleiner Darstellung und ein klarer „Raum wählen“-Modus. Der Studio-Screenshot zeigt eine dichte Tab-Leiste; Such- oder Gruppierungsfunktion für große Welten wäre ein UX-Verbesserungsvorschlag, keine bestätigte Funktionsstörung.

## Testprotokoll

Die folgende Liste stammt aus `results.json` der Abschlussrunde, ergänzt um den anschließend bestandenen RPG-Profil-Browsertest. `PASS` bedeutet tatsächlich ausgeführt; keine statische Behauptung. Alle Browsertests liefen mit installiertem Chrome, isoliertem Profil und lokal gesperrtem externem Routing. Die statischen/VM-Suiten testeten echte Funktionsmodule bzw. Quellfunktionen; der jeweilige Skriptinhalt bestimmt die Einzelabdeckung.

| Suite (`app/scratch/… .js`) | Ergebnis | Dauer |
|---|---:|---:|
| `living_world_audit` | PASS | 1.5 s |
| `living_world_stress_test` | PASS | 12.7 s |
| `living_worlds_editor_regression` | PASS | 5.6 s |
| `living_worlds_map_browser_regression` | PASS | 2.3 s |
| `map_editor_audit` | PASS | 0.3 s |
| `movement_ledger_stress_test` | FAIL | 0.2 s |
| `quest_engine_stress_test` | PASS | 0.7 s |
| `rules_engine_stress_test` | PASS | 0.1 s |
| `world_action_resolution_audit` | PASS | 0.3 s |
| `world_agent_transaction_audit` | PASS | 0.3 s |
| `world_architect_agent_audit` | PASS | 0.4 s |
| `world_architect_batch_resume_audit` | PASS | 0.4 s |
| `world_command_boundary_audit` | PASS | 0.3 s |
| `world_command_browser_audit` | PASS | 3.2 s |
| `world_communication_audit` | PASS | 0.1 s |
| `world_direct_move_contract_regression` | PASS | 0.2 s |
| `world_general_turn_matrix_audit` | PASS | 0.6 s |
| `world_generalized_response_audit` | PASS | 0.3 s |
| `world_graph_consistency_audit` | PASS | 0.3 s |
| `world_intent_reliability_audit` | PASS | 0.5 s |
| `world_knowledge_share_audit` | PASS | 0.2 s |
| `world_linked_chain_browser_audit` | FAIL | 2.7 s |
| `world_linked_contract_audit` | PASS | 0.2 s |
| `world_linked_execution_audit` | PASS | 0.1 s |
| `world_linked_generalization_audit` | PASS | 0.1 s |
| `world_linked_hardening_audit` | PASS | 0.2 s |
| `world_local_scene_schema_audit` | PASS | 4.7 s |
| `world_long_memory_audit` | PASS | 0.1 s |
| `world_lore_audit` | PASS | 0.3 s |
| `world_lore_browser_audit` | PASS | 3.8 s |
| `world_map_stress_test` | PASS | 4.1 s |
| `world_mobile_play_browser_audit` | PASS | 3.9 s |
| `world_model_client_audit` | PASS | 0.3 s |
| `world_model_inheritance_audit` | PASS | 0.3 s |
| `world_npc_debugger_browser_audit` | PASS | 2.4 s |
| `world_npc_free_goal_browser_audit` | PASS | 2.8 s |
| `world_npc_goal_actions_audit` | PASS | 0.1 s |
| `world_npc_goal_progress_audit` | PASS | 0.1 s |
| `world_npc_goal_tick_browser_audit` | PASS | 2.4 s |
| `world_npc_knowledge_recall_audit` | PASS | 0.1 s |
| `world_npc_multi_goal_browser_audit` | PASS | 2.9 s |
| `world_npc_reactions_audit` | PASS | 0.1 s |
| `world_npc_reactions_browser_audit` | PASS | 2.3 s |
| `world_p42_resource_cost_audit` | PASS | 0.1 s |
| `world_p42_resource_cost_browser_audit` | PASS | 4.2 s |
| `world_p43h_discovery_audit` | PASS | 0.2 s |
| `world_p43h_performance_audit` | PASS | 1.1 s |
| `world_perception_audit` | PASS | 0.1 s |
| `world_perception_browser_audit` | PASS | 2.3 s |
| `world_phase4_routes_browser_audit` | PASS | 4.0 s |
| `world_phase4_time_browser_audit` | PASS | 7.9 s |
| `world_physical_reachability_audit` | PASS | 0.1 s |
| `world_presentation_reliability_audit` | PASS | 0.3 s |
| `world_render_purity_browser_audit` | PASS | 2.7 s |
| `world_resolved_intent_browser_audit` | PASS | 5.5 s |
| `world_resolved_intent_contract_audit` | PASS | 0.3 s |
| `world_route_fare_regression` | PASS | 0.1 s |
| `world_scene_draft_audit` | PASS | 0.1 s |
| `world_scene_items_audit` | PASS | 0.1 s |
| `world_schema_migration_audit` | PASS | 0.3 s |
| `world_session_boundary_audit` | PASS | 0.3 s |
| `world_speech_contract_regression` | PASS | 0.1 s |
| `world_systems_audit` | PASS | 0.3 s |
| `world_temporary_interaction_contract_regression` | PASS | 0.1 s |
| `world_transaction_feedback_audit` | PASS | 0.3 s |
| `world_turn_context_audit` | PASS | 0.1 s |
| `world_turn_transaction_audit` | PASS | 0.3 s |
| `world_urgent_deadline_regression` | PASS | 0.5 s |
| `world_wait_fallback_regression` | PASS | 0.3 s |
| `world_working_state_audit` | PASS | 0.1 s |
| `worlds2_atomic_turn_persistence_browser_audit` | PASS | 3.6 s |
| `worlds2_campaign_browser_audit` | PASS | 32.3 s |
| `worlds2_check_transaction_regression` | PASS | 0.3 s |
| `worlds2_escort_handoff_regression` | PASS | 0.3 s |
| `worlds2_exit_unlock_browser_audit` | PASS | 3.1 s |
| `worlds2_inventory_consequence_regression` | PASS | 0.3 s |
| `worlds2_manual_gate_browser_audit` | PASS | 2.9 s |
| `worlds2_negated_movement_receipt_browser_audit` | PASS | 2.9 s |
| `worlds2_persistence_browser_audit` | PASS | 7.8 s |
| `worlds2_pickup_receipt_replay_browser_audit` | PASS | 2.6 s |
| `worlds2_provider_response_browser_audit` | PASS | 3.8 s |
| `worlds2_receipt_boundary_browser_audit` | PASS | 2.9 s |
| `worlds2_route_escort_regression` | PASS | 0.4 s |
| `worlds2_stacked_inventory_regression` | PASS | 0.6 s |
| `worlds2_startup_recovery_browser_audit` | PASS | 5.2 s |
| `worlds2_storage_migration_browser_audit` | PASS | 3.7 s |
| `worlds_rpg_release_contract_audit` | PASS | 0.5 s |
| `worlds_starting_quests_audit` | PASS | 0.3 s |
| `worlds_starting_quests_browser_audit` | PASS | 7.0 s |

| `living_worlds_rpg_modes_browser_regression` | PASS | 4.5 s |

Zusätzliche Python-Resultate: `world_server_binding_http_audit.py` PASS, `world_static_route_audit.py` PASS, `vh_world_pack_builder_audit.py` PASS. Die Live-Modellprüfung ist separat aufgeführt und nicht in die 89 Offline-Suiten eingerechnet.
