# P2.6b – NPC-Zielentscheidungen (24.10.2026)

Der vorhandene Zielpfad (`goal`, `goalActionSteps`, `goalActionIndex`) und die Linked World Actions bleiben die Ausführungsschicht. `npcGoalOptions` bildet aus dem aktuellen NPC-Ort, bekannten angrenzenden Orten und lokal sichtbaren, erreichbaren Gegenständen mögliche nächste Effekte. Ein exakt benanntes, eindeutiges Ziel kann ohne Modellaufruf gewählt werden. Bei offenen Zielen erhält der ohnehin periodisch laufende World Agent diese begrenzten Optionen mit Persona, Bedürfnissen, Beziehungen, Inventar, Beobachtungen, bekanntem `worldNews`, Zeit und bisherigem Ergebnis. Er darf einen Effekt nur wortgetreu aus der NPC-Liste als `npc_goal_actions` vorschlagen.

Der Vorschlag wird gegen den aktuellen NPC-Kontext erneut geprüft und im Session-State als `goalActionProposal` gespeichert. Erst ein späterer regulärer World-Tick führt ihn mit `executeNpcGoalStep` und `executeLinkedActions` aus. Der Reducer prüft Besitz, Reichweite, Tür, Ortswissen, Zugangsrechte, Zeit und Ereigniszeugnis. Nach bestätigtem Effekt werden `goalLastAction`, `turnEvents` und der vorbereitete Weltzustand persistiert. Der Vorschlag und ein gescheiterter Effekt allein erzeugen keinen Zielabschluss. Bei einem exakt benannten Ort kann die bestätigte Ankunft das Ziel abschließen. Andere freie Ziele bleiben offen, damit ein Folgeschritt entschieden werden kann; die bloße Aufnahme eines Gegenstands beweist etwa noch nicht, dass ein Essensziel erfüllt wurde.

Die Schnittstelle für einen späteren Node-Editor sind die vorhandenen `goalActionSteps` sowie der Vorschlag aus `goal`, lokaler Optionsliste und Effekt-Payload. Ein Editor kann die Wahl konfigurieren, ohne die World Engine zu ändern. Mehrstufige Strategie, semantische Abschlusskriterien für unbenannte Ziele und die Erweiterung der lokalen Optionsliste auf weitere registrierte Effekte bleiben P2.6c. Geräusch- und Sensorausbreitung bleibt P2.7. Es wurde keine neue Modellaufrufschleife eingeführt.

## Prüfungen

- Deterministisch: `world_npc_goal_actions_audit.js`, `world_linked_execution_audit.js`, `world_linked_contract_audit.js` bestanden.
- Browser mit simuliertem World-Agent-Vorschlag: `world_npc_free_goal_browser_audit.js` bestanden. Start mit freier Zielbeschreibung; gesperrter Weg, Schlüsselaufnahme, Türöffnung, bestätigte Bewegung, Save/Reload, erneuter Tick, unbekannter Ort, versteckter Gegenstand und unterschiedliche NPC-Personas geprüft.
- Bestehender Browser-Test: `world_npc_goal_tick_browser_audit.js` bestanden.
- Echter LLM-Test: nicht durchgeführt. Das periodische Modellverhalten, insbesondere die qualitative Wahl bei verschiedenen Persönlichkeiten, ist damit noch nicht empirisch belegt.
