# World P4: Reliability First – lokaler Abnahmebericht

Stand: 26. Oktober 2026. Maßgeblich ist ausschließlich der lokale Dateistand in `N:\Horde Studio\app`. Während der Implementierung wurden keine Git-Abfragen oder Git-Aktionen und keine Cloud-Aufrufe oder Downloads durchgeführt.

## 1. Referenz und Bestandsmatrix

Der autoritative World-Turn-Pfad bleibt: Spielereingabe → Kontext → Modellantwort → Server Binding → Linked Action → Effect Validation → Working State → atomarer Commit → Darstellung. P4.2 verwendet diesen Pfad und die vorhandene Effect Registry. Die bisherigen Schutzregeln für Action Binding, Bewegung, Inventar, NPC-Wissen, Events, Receipts, Rollback und Persistenz wurden nicht abgeschwächt.

| Kategorie vor P4.2 | Lokaler Befund | Konsequenz |
| --- | --- | --- |
| Vorhanden und ausreichend | HUD-Stats und `playerStats`; Session-Zero-Auswahl samt Starting Lives und Stat-Overrides; Inventar und Mengen; World-Time und `time_advance`; Conditions; Effect Registry; Working State mit Savepoints; World-Turn-Receipts; NPC-Action-Metadaten und Persistenz. | Wiederverwenden. |
| Vorhanden, aber nicht allgemein nutzbar | `itemCreationRules.resource` prüfte und belastete Spieler-`playerStats` beziehungsweise NPC-`entityStates.resources` nur bei Gegenstandserzeugung. | P4.2 ergänzt eine gemeinsame Kostenoperation für universelle Checks, ohne diese bestehende Erzeugungsregel zu ersetzen. |
| Vorhanden, aber nicht an den autoritativen Linked-Executor angebunden | Legacy-`stat_changes` und andere World-RPG-Updates besitzen eigene Verträge; sie waren kein ergebnisabhängiger, lokal abgeleiteter Check-Kostenpfad für Spieler und NPCs. | Keine zweite Pipeline. Kosten werden im vorhandenen Linked-Executor ausgeführt. |
| Tatsächlich fehlender Grundbaustein | Optionale Kosten pro bestätigtem Check-Ergebnis, Vorprüfung möglicher Ergebniskosten, atomare Abbuchung mit Check-/Actor-Provenienz und Replay-Schutz. | Als kleinster P4.2-Schritt ergänzt. |
| Spätere Node-Editor-Konfiguration | Ressourcenarten, Fähigkeiten, Kosten- und Regenerationsregeln, Konsequenzen, Verknüpfungen sowie Kampf-, Magie- und Crafting-Systeme. | In dieser Änderung nicht implementiert. |

Die alten Referenzwerte aus `docs/world-engine-stabilisierung-2026-10-25.md` bleiben historische Messungen: 190 kontrollierte World-Züge in zehn Genres und 19 Kategorien, fünf lokale Gemma-Fälle mit etwa 8–14 Sekunden Modellzeit und ein vollständiger T03-Turn um 15 Sekunden. Die 190 Entwürfe sind keine 190 echten LLM-Aufrufe und die alten Laufzeiten sind keine Zusage für neue Fälle.

## 2. P4.1 – getrennte Bewertung

Die universellen Checks unter `world.gameRules.universalChecks` bleiben optional. Der World-Settings-Schalter, Session Zero, Starting Lives, Spieler- und NPC-Werte, Ergebnisstufen, bestätigte Check-Karten, Receipts, Save/Reload sowie Reroll-Metadaten wurden gegen die vorhandenen Audits geprüft. Ohne aktivierte universelle Checks entstehen keine neuen Check-Anforderungen oder P4.2-Kosten.

Ein echter Produktfehler wurde geschlossen: `fallbackTimelineLifePlan` verwendete `resolveLocation` außerhalb seines Geltungsbereichs. Ein authored `homeLocationId` wird jetzt anhand der exakten World-Orts-ID gesucht. Der zuvor auffällige Browser-Texttest bestand danach mit seiner ursprünglichen Assertion; die Fixture wurde nicht dauerhaft verändert. `worlds2_life_seed_model_skip_audit.js` und `worlds2_life_seed_fallback_browser_audit.js` bestehen nun beide. Die P4.1-Deterministik- und Integrationsprüfungen sind grün. Eine vollständige manuelle Session-Zero-Kampagne und ein eigener P4.1-Live-LLM-Nachweis bleiben von der deterministischen Abnahme getrennt.

## 3. P4.2 – Datenvertrag und Ausführung

Eine Check-Ergebnisstufe kann optional `costs: [{ resourceId, amount }]` enthalten. `amount` ist eine positive, endliche Zahl; IDs sind exakt und innerhalb einer Stufe eindeutig. Kosten sind für `success`, `partial` und `failure` möglich. Alte Regeln ohne `costs` und Welten ohne `universalChecks` liefern weiterhin keine Kosten-Events und kein Kosten-Ledger.

Die **aktuelle P4.2-Regelsemantik** prüft vor dem Check je Ressource die Summe der höchsten möglichen Kosten aller passenden Regeln. Das ist eine dokumentierte Strategie dieses Schritts, keine festgeschriebene universelle Engine-Eigenschaft. Eine spätere Node-definierte Strategie bleibt architektonisch möglich; jetzt existiert nur diese eine. Unterdeckung blockiert vor der Auswertung. Nach dem Check wird allein die Kostenliste des bestätigten Ergebnisses belastet.

Der Actor wird als exakte Spieler-ID oder eindeutige NPC-Event-ID aufgelöst. Spielerressourcen verwenden vorhandene `playerStats`, NPC-Ressourcen vorhandene `entityStates[actorId].resources`. Fehlende, negative oder nicht endliche Werte sowie unbekannte oder mehrdeutige Actor-/Target-Referenzen werden nicht ergänzt oder geraten. Mehrere Actions verwenden denselben isolierten Working State; spätere Actions sehen vorgemerkte Kosten. Ein technischer Fehler verwirft den gesamten Turn samt vorgemerkten Abbuchungen.

`resource_cost` ist eine interne Operation der bestehenden Effect Registry. Sie erscheint nicht im Modell-Capability-Schema und kann nicht als Modell-Effect eingereicht werden. Der Executor erzeugt einen bestätigten `resource_cost`-Event und einen Effect mit Rule-, Result-, Actor- und Event-Bezug; `check_results.cost_changes` verweist auf den Event. Eine Unterdeckung erscheint als `insufficient_resource` im Action-Result des Receipts. Interne Kosten-Events werden nicht als öffentliche Weltwahrnehmung oder NPC-Wissen verbreitet. Ein persistiertes Transaktions-Ledger verweigert eine zweite Abbuchung derselben Regel/Ressource/Action innerhalb derselben Turn-Identität, auch nach Save/Reload und erhöhtem Turn-Zähler. Der Ledger ist optional und wird nur bei tatsächlichen Kosten angelegt; sein Wachstum in langen Kampagnen bleibt ein beobachtbarer Speicher- und Performancepunkt.

Gegenstands- und Zeitkosten bleiben in ihren bestehenden Mechanismen. Es gibt keine festen Ressourcenarten, keine neuen Modellpflichtfelder und keinen zusätzlichen Modellaufruf pro Kostenprüfung oder NPC-Tick.

## 4. Tests, Laufzeit und Qualitäts-Gates

**Deterministische Prüfungen nach der Änderung:** `world_general_turn_matrix_audit.js` (190/190), `world_server_binding_audit.js`, `world_scene_draft_audit.js`, `world_linked_execution_audit.js`, `world_linked_generalization_audit.js`, `world_linked_hardening_audit.js`, `world_turn_transaction_audit.js`, `world_working_state_audit.js`, `world_turn_context_audit.js`, `world_scene_items_audit.js`, `world_physical_reachability_audit.js`, `world_npc_goal_progress_audit.js`, `world_npc_reactions_audit.js`, `world_perception_audit.js`, `world_knowledge_share_audit.js`, `world_p41_universal_checks_audit.js`, `timeline_life_seed_audit.js`, `worlds2_life_seed_timeout_audit.js`, `worlds2_life_seed_model_skip_audit.js` und `worlds_rpg_release_contract_audit.js` (24/24) bestanden. Ein nach dem ersten P4.2-Patch auffälliger `world_linked_hardening_audit.js` deckte die Sichtbarkeit der internen Effect-Art in einer öffentlichen Registry-Aufzählung auf; die Filterung wurde korrigiert und der Audit erneut bestanden.

**Browserprüfungen mit installiertem Chrome:** `world_server_binding_browser_audit.js`, `world_presentation_reliability_audit.js` (13/13), `world_scene_draft_browser_audit.js`, `world_linked_chain_browser_audit.js`, `world_action_path_parity_audit.js`, `world_p41_browser_audit.js`, `world_p41_linked_turn_browser_audit.js`, `worlds2_life_seed_fallback_browser_audit.js` und `worlds2_hosted_turn_deadline_browser_audit.js` bestanden. Die harte Fünf-Minuten-Grenze wurde dabei erneut geprüft.

**Neue P4.2-Prüfungen:** `world_p42_resource_cost_audit.js` deckt Erfolg, Teilerfolg, Fehlschlag, deaktivierte/alte Welten, Voraussetzungen, Unterdeckung, ungültige Ressourcen und Targets, mehrdeutige Actors, mehrere Regeln und Actions, NPCs, technische Fehler, Rollback, Retry, Replay und Rewind-Snapshot ab. `world_p42_resource_cost_browser_audit.js` bestätigt Erfolgs- und Fehlschlagkosten, je einen deterministischen Modell-Testaufruf, Receipt-Provenienz, Kostenregeln nach World-Roundtrip sowie Save/Reload. Beide bestanden. Diese Browserantworten sind kontrollierte Entwürfe, keine echten LLM-Generierungen.

**Echte lokale Modellläufe:** T03 mit `gemma4:31b-it-q4_K_M` wurde gespeichert: ein Aufruf, keine Reparatur, keine Validierungsfehler, ein bestätigter Effect. Die gesamte Turn-Dauer betrug 242,6 Sekunden, davon 242,2 Sekunden Modellzeit. Das Drei-Minuten-Ziel wurde verfehlt, die harte Fünf-Minuten-Grenze eingehalten. T03 verwendet keine P4.2-Kosten; dieser Einzelfall belegt keine Kosten-Patch-Regression. Promptgröße: 30.675 Zeichen, Antwortstream: 52.740 Zeichen einschließlich SSE-Rahmen.

Die zusätzliche P4.2-Live-Probe mit einer weltdefinierten Inschriftenprüfung dauerte 180,1 Sekunden (179,6 Sekunden Modellzeit über drei Aufrufe: 11,7 / 62,4 / 105,5 Sekunden). Der erste Entwurf enthielt noch keinen ausreichenden Handlungsbeleg; die beiden Reparaturantworten schlugen `knowledge_share` vor, obwohl das Check-Ergebnis diesen Effect nicht erlaubt. Die Engine lehnte den Kandidaten mit `check_effect_not_allowed` ab. Es gab keinen Commit, keinen Receipt und keine Ressourcenabbuchung; der Wert blieb live und gespeichert bei 5, die Eingabe blieb für Retry erhalten. Dies ist ein offener Modellintegrationsfall. Die Effect-Freigabe wurde nicht gelockert.

Die Differenz zwischen Gesamt- und Modellzeit betrug in diesen Läufen ungefähr 0,4 beziehungsweise 0,5 Sekunden. Der Harness trennt darin Binding, lokale Validierung, Browserarbeit und Persistenz nicht vollständig; für den fehlgeschlagenen P4.2-Lauf gab es keinen Persistenz-Commit. Eine systematische Änderung der lokalen Turn-Latenz ist daraus nicht ableitbar.

P4.1 ist deterministisch abgenommen. P4.2 besteht die deterministischen Funktions-, Weltkonsistenz-, Persistenz- und Kompatibilitäts-Gates. Live-Modellzuverlässigkeit und Performance werden eigenständig bewertet; Einzelabweichungen führen weder zu gelockerter Engine-Validierung noch zu einer Behauptung allgemeiner Modellzuverlässigkeit. Laufzeitziel bleibt unter drei Minuten pro Turn; die harte Grenze bleibt fünf Minuten einschließlich Streaming und Reparaturen.

## 5. Offene Einschränkungen und Kompatibilitätsrisiken

- Der erste lokale T03-Live-Lauf ist deutlich langsamer als die historischen Referenzfälle. Modell-/Hardware-Schwankung, Warmzustand und Promptinhalt sind noch nicht isoliert; aus einem Einzelfall folgt keine reproduzierbare Produktregression.
- Das optionale Kosten-Ledger wächst mit bestätigten Kosten. Sein Speicher- und Save-Aufwand sollte in langen Kampagnen beobachtet werden. Es wird bei Welten ohne P4.2-Kosten nicht angelegt.
- Die P4.2-Live-Probe ist fehlgeschlagen, weil das Modell einen nicht zugelassenen Effect vorschlug. Sie bleibt getrennt vom grünen deterministischen P4.2-Ergebnis. Ein Modellvorschlag darf nicht durch Abschwächung der Effect-, Actor- oder Event-Provenienz passend gemacht werden.
- Eine vollständige manuelle Session-Zero-Matrix über jede UI-Kombination wurde nicht als eigener Lauf durchgeführt; die vorhandenen gezielten Browser-, Life-Seed- und Vertragsaudits sind bestanden.

Bestehende lokale Änderungen wurden erhalten. Es gab keinen Commit, Push, Fetch, Merge, Cherry-Pick, Node-Editor-Eingriff oder Änderungen an Virtual Humans, Multiplayer und Kokoro.
