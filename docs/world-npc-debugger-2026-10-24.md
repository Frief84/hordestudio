# World Monitor und NPC Inspector · 24.10.2026

## Öffnen

In einer laufenden World-Sitzung die Seitenleiste **Director** öffnen. Dort stehen **World Monitor** und **NPC Inspector** über den bisherigen Receipts. Suche nach Name/ID, Standortfilter und Zielstatusfilter schränken die Liste ein. Auch NPCs außerhalb des Spielerorts erscheinen. Ein Klick auf einen NPC öffnet seine Details. Die Ansicht wird beim Öffnen des Director-Tabs und bei den vorhandenen World-UI-Updates aktualisiert; sie startet keinen eigenen Timer.

## Daten und Darstellung

Der Monitor liest `session.entityStates`, `session.worldClock`, `turnCount`, `lastLivingWorldTick` und `turnEvents` sowie die NPC-Definitionen der aktuellen Session. Der Standort kommt ausschließlich aus `entityStates[npc.id].location`. Vorschläge erhalten ausdrücklich die Kennzeichnung „Proposed“; ein tatsächliches Event die Kennzeichnung „Confirmed“.

Der Inspector zeigt die vorhandene Persona, Bedürfnisse, Motivation, Beziehungen, Inventar und Ressourcen. Ziele kommen aus NPC-Definition, `goalPool`, `goalStates`, `goalSelection`, `goalActionProposal` und `goalActionProgress`. Die gespeicherten Scores und Faktoren erklären die Auswahl; die Ansicht berechnet keine neue Priorität. Sie zeigt Schrittindex, Status, Blockadegrund, Prüf-Turn, Abschlussbedingung, Abschlussbeleg und Event-ID, soweit vorhanden. Fehlende Felder erscheinen als „—“.

Persönliches Wissen kommt aus `entityStates[npc.id].observations`. `sourceType`, Sender, ursprünglicher NPC, Ursprungsbeobachtung, Event, Kanal, Turn und Weltminute bleiben unterscheidbar. `worldNews` erscheint nur, wenn `knownBy` die NPC-ID enthält; ein alter Eintrag ohne bekannte Empfängerliste wird nicht als persönliches Wissen ausgegeben. Die Timeline liest bestätigte und informative `turnEvents` sowie passende bestätigte Effekte aus `worldTurnReceipts`. Der aktuelle Vorschlag und Schrittstatus stehen separat als unbestätigter beziehungsweise aktueller Planstand.

## Bewegung und Validierung

Beim vorhandenen Fehler `unwitnessed_companion_or_actor_move` erfasst der Linked-Action-Prüfpfad zusätzlich die bereits berechneten vorgeschlagenen Bewegungen, vorgeschlagenen Movement-Events und fehlenden Event-Belege. Diese begrenzten Diagnosedaten gehen über die vorhandenen `worldCallDiagnostics` beziehungsweise Receipt-Fehler in die Director-Ansicht. Die Validierungsentscheidung und Movement-Provenienzregeln wurden nicht geändert. Receipt-Status wie `clean`, `repaired`, `recovered` und `failed` bleiben bestehen. Ein fehlgeschlagener Turn erscheint nicht als bestätigter Effekt.

## Prüfung

- `node --check app.js` und `node --check worlds/linked-world-actions.js`: bestanden.
- `node scratch/world_npc_debugger_browser_audit.js` mit gebündeltem Playwright und lokalem Chrome: bestanden. Geprüft wurden beide Ansichten, offscreen Standort, Zielpool und Faktoren, blockierter und unterbrochener Schritt, eigene Beobachtung gegenüber Bericht, Herkunft, bestätigtes Event gegenüber Vorschlag, Movement-Fehler, JSON-Save/Reload-Äquivalenz, alte Daten ohne neue Felder, Statusfilter und unveränderter Session-State nach dem Rendern.
- `node scratch/world_linked_execution_audit.js`: bestanden; bestehende Linked-Action-Kette, NPC-Bewegung, Rollback und Save/Reload.

## Grenzen und späterer Node-Editor

`goalSelection` speichert nur die fünf besten Kandidaten. Frühere Auswahlwechsel und jeder einzelne Prüf-Zwischenschritt sind nicht durchgehend als persistente Timeline vorhanden. Der Inspector kennzeichnet daher nur gespeicherte Daten und ergänzt keine rückwirkenden Schritte. Vollständige Rohantworten werden nicht neu gespeichert. Die Ansicht ist read-only und hat weder World-Actions noch Modellaufrufe oder einen zusätzlichen Tick. Für einen späteren Node-Editor wären persistente, begrenzte Kanten zwischen Trigger, Bedingung, Bewertungsfaktor, Vorschlag, Prüfung, Effekt, Event, Wahrnehmung und Abschlussbeleg nützlich.
