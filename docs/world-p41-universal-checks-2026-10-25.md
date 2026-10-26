# Horde Studio P4.1 – Universelle Regelprüfungen

Stand: 25. Oktober 2026

## Architektur und Datenvertrag

Die neue Datei `worlds/universal-checks.js` wertet Weltregeln gegen die bestehende `WorkingState` aus. Sie verändert selbst keinen Zustand. Die Ausführung findet im vorhandenen `executeLinkedActions` vor der Effect Registry statt. Dadurch bleiben die bisherigen Validierungen für Bewegung, Inventar, Besitz, Event-Belege, Provenienz und atomaren Commit aktiv.

Regeln liegen unter `world.gameRules.universalChecks`:

```json
{
  "enabled": true,
  "rules": [{
    "id": "read_inscription",
    "name": "Read the inscription",
    "match": { "kind": "physical", "requestIncludes": "inscription" },
    "actor": "player",
    "values": [{ "subject": "actor", "source": "stat", "key": "focus", "weight": 1 }],
    "when": { "all": [{ "subject": "actor", "source": "skill", "key": "lore", "operator": "exists" }] },
    "difficulty": 8,
    "modifiers": [{ "id": "good_light", "value": 2 }],
    "random": { "min": 1, "max": 6 },
    "results": [
      { "id": "clear", "kind": "success", "minMargin": 0, "effects": ["condition_change"] },
      { "id": "mixed", "kind": "partial", "minMargin": -2, "effects": [] },
      { "id": "fail", "kind": "failure", "minMargin": -100, "effects": [] }
    ]
  }]
}
```

`kind` verwendet die bestehenden Action-Arten (`physical`, `speech`, `question`, `observation`, `travel`, `wait`, `other`). `requestIncludes` ist optional und grenzt die Zuordnung ein. Für NPCs kann `actor: "event_actor"` den Akteur aus dem gebundenen Action-Event lesen. `target: "event_target"` oder eine feste Entity-ID ist möglich. Die Wertequellen sind `stat`, `skill` und `property`, jeweils ohne fest verdrahtete RPG-Namen. Bedingungen unterstützen `equals`, `not_equals`, `exists`, `gt`, `gte`, `lt`, `lte` sowie verschachtelte `all`/`any`-Gruppen. Modifikatoren können eine eigene `when`-Bedingung haben. Fehlende numerische Werte und nicht erfüllte Voraussetzungen ergeben `blocked`.

Regel-, Zahlen- und Effect-Typen werden begrenzt und validiert. Die Ergebnisstufen sind `success`, `partial`, `failure`, `blocked` oder ein weltdefiniertes `custom`-Ergebnis. Die höchste passende `minMargin` gewinnt. Nur Effects, die für diese Stufe angegeben und in der vorhandenen Registry verfügbar sind, dürfen durchlaufen. Ein regelkonformer Fehlschlag ist ein bestätigtes Ergebnis ohne Zustandsänderung, kein technischer Fehler. Eine abweichende vorgeschlagene Action, ein unzulässiger Effect oder ein unbelegtes Completed-Event verwirft den Kandidaten.

## Schalter und Kompatibilität

Unter **Systems, Stats & Quests** steht **Enable Rule Checks** mit der geforderten Beschreibung. Der Schalter speichert `world.gameRules.universalChecks.enabled`. Neue universelle Regeln sind standardmäßig aus. Bei `false` führt die Linked-Action-Pipeline keine universellen Checks und keine dafür nötigen Zufallswerte aus. Actions ohne passende Regel laufen unverändert. Ältere Welten ohne das Feld behalten ihre bestehende `modules.checks`-Semantik für die bisherige Würfelprüfung; die neue Funktion wird nicht stillschweigend aktiviert. Der Schalter ändert keine World-Schutzprüfung.

Die bestehende World-Normalisierung behält die Regeldefinition beim Speichern, Öffnen und Export/Import. Die Turn-Snapshots der bestehenden Timeline-Semantik enthalten die bestätigten Receipts und Nachrichtenmetadaten. Änderungen an späteren Welteinstellungen berechnen alte Ergebnisse nicht neu.

## Session Zero und Starting Lives

Die Session-Zero-Oberfläche, Persona-Auswahl, optionale Life-Seed-Anreicherung, Ausgangsleben, Attribut- und Punkteverteilung, Skills, Perks, Ausrüstung und Story-Einstellungen wurden nicht ersetzt. Spieler-Checks lesen `playerStats`, `playerIdentity.skills` und vorhandene `playerIdentity.capabilityRanks`, die bereits von der Session-Initialisierung geschrieben werden. NPC-Checks lesen strukturierte `entityStates`- beziehungsweise Entity-Definitionswerte. Es entstehen keine Standardattribute oder fehlenden Skills. Die neue Check-Auswertung startet keine Modellanfrage. Ohne passende Regel bleiben alle Starting-Life-Daten erhalten und Spielhandlungen frei.

## Receipts, Zufall und Anzeige

Die Linked-Action-Engine berechnet einen optionalen ganzzahligen Zufallswert deterministisch aus World-ID, Session-ID, Turn, Action-Slot und Regel-ID. Eine bloß geänderte Modell-Action-ID erzeugt beim Reroll keinen neuen Wert. Ein bestätigter Turn speichert Wert, Ausgangswerte, Modifikatoren, Schwierigkeit, Margin, Stufe, Effect-Typen, Event-IDs und Receipt-ID in `receipt.check_results`. Save/Reload zeigt den gespeicherten Wert; die UI würfelt nicht. Reroll und Rewind folgen den vorhandenen Turn-Snapshots und der pro Take gespeicherten Nachrichtenmetadaten.

Spielerbezogene Check-Ergebnisse erscheinen als kompakte, ausklappbare Karte unter der Erzählung des bestätigten Turns. Es gibt keine Karte für normale Handlungen oder abgelehnte Receipts. Die Spielerkarte enthält nur Werte des Spieler-Akteurs; zielbezogene Werte und reine NPC-Checks bleiben im Director-Receipt. Der bestehende Director-Debugger zeigt die vollständigen Check-Daten aus dem Receipt read-only. Die allgemeine Ergebnisstruktur enthält Action-, Actor-, Target-, Effect- und Event-Bezüge für spätere zielgerichtete Übersichten.

## Tests und Grenzen

- `node scratch/world_p41_universal_checks_audit.js`: Erfolg, Teilerfolg, Fehlschlag, Blockade, deaktiviert, Action ohne Regel, Statusabweichung, unzulässiger und erlaubter Effect, NPC-Werte, Zufall.
- `node scratch/world_linked_execution_audit.js`, `world_linked_contract_audit.js`, `world_linked_hardening_audit.js`: bestanden.
- `node scratch/worlds_rpg_release_contract_audit.js`: 24/24 bestehende Vertragsproben bestanden.
- Chrome/Playwright: `scratch/world_p41_browser_audit.js` prüft den Schalter samt Speichern/Neuladen und serialisiertem Export/Import-Vertrag, Session-Zero-Steuerungen, **Begin Adventure**, **Start without life setup**, Reroll-Take-Metadaten und die Karte samt Speichern/Neuladen in der echten World-UI. `scratch/world_p41_linked_turn_browser_audit.js` prüft einen vollständigen P4.1-Turn mit Receipt, Persistenz und Karte. `scratch/world_linked_chain_browser_audit.js` sichert die bestehende Linked-Chain ab. Das sind deterministische Testantworten, kein Nachweis eines echten LLM-Durchlaufs.
- Der bestehende `worlds2_life_seed_fallback_browser_audit.js` scheitert an einer veralteten Textassertion; nach probeweiser Anpassung wartet er auf eine Session-Initialisierung, die im Fixture nicht eintritt. Die Testdatei wurde unverändert belassen. Der reine `worlds2_life_seed_model_skip_audit.js` scheitert unabhängig an einem im VM-Fixture nicht definierten `resolveLocation`.

P4.2 kann einen Node-Editor für diesen JSON-Vertrag liefern. P4.3–P4.5 können mehrere zielgerichtete Effects in einer gemeinsamen Übersicht anzeigen. P4.1 enthält bewusst keine feste Kampf-, HP- oder XP-Logik. Eine vollständige manuelle Session-Zero-Matrix und ein Live-LLM-Test sind noch offen.
