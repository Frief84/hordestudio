# P2.7a – Dynamische Wahrnehmung (24.10.2026)

## Wiederverwendete Architektur

Bestätigte Linked Actions und ihre Events bleiben die einzige Quelle neuer Reize. Die vorhandene Working-State-Transaktion speichert Linked-Events in `turnEvents`, das Receipt in `worldTurnReceipts` und NPC-Beobachtungen in `entityStates[npcId].observations`. Der World-Tick verwendet für bestätigte Offscreen-Goal-Actions denselben Wahrnehmungsaufruf. Die bestehende Auswahl `relevantNpcMemories` nimmt die neuen Einträge ohne zusätzlichen Scheduler oder Modellaufruf auf. Alte Saves benötigen keine Migration: Ohne `perceptionRules` entstehen keine zusätzlichen Einträge.

## Datenvertrag

Eine Welt kann `perception.channels` und `perceptionRules` hinterlegen. Eine Regel besitzt `on` als exakten Match gegen Felder eines bestätigten Events und `stimuli` mit `channel`, `strength`, `text` sowie optional `remoteText`, `hiddenText`, `identifiesActor` und `allowedToShare`. Beispiel:

```json
{
  "perception": { "channels": {
    "hearing": { "enabled": true, "edgeAttenuation": 1,
      "closedDoorAttenuation": 3, "threshold": 0.5, "maxHops": 4 },
    "sight": { "enabled": true, "maxHops": 1 }
  } },
  "perceptionRules": [{
    "on": { "type": "environment", "action": "crash" },
    "stimuli": [
      { "channel": "hearing", "strength": 4, "text": "Ein lautes Krachen.",
        "remoteText": "Ein Krachen aus der Werkstatt." },
      { "channel": "sight", "strength": 2, "text": "Ein Tisch fällt um." }
    ]
  }]
}
```

Die Reize stehen als Regelmetadaten am autoritativen Event-Pfad. Sie sind keine zweite Event-Tabelle. Ein nicht konfigurierter Kanal breitet sich nicht aus. Zusätzliche Sensoren benötigen nur einen Eintrag unter `perception.channels`; die Ausbreitung benutzt denselben Graphalgorithmus.

## Ausbreitung und Informationsgrenze

Die Suche folgt vorhandenen `locations[].exits`. Pro Kante sinkt die Stärke um `edgeAttenuation`; eine als geschlossen erkannte Tür benutzt `closedDoorAttenuation`. Eine positive Reststärke und der Schwellwert des NPCs sind Voraussetzung. `maxHops` und eine Arbeitsgrenze von 512 Knoten verhindern unbegrenzte Suche. Der beste Restwert je Raum verhindert doppelte Beobachtungen in Zyklen. Sicht reicht standardmäßig nur im selben Raum; eine fremde Raumkante muss `sight: true` tragen. Geschlossene Türen sperren Sicht, sofern `sightWhenClosed` nicht ausdrücklich gesetzt ist. Geruch und weitere Sensoren verwenden eigene Kanalwerte.

Die Regel liefert nur ausdrücklich beobachtbaren Text. Entfernte NPCs erhalten ausschließlich `remoteText`; fehlt dieser, entsteht dort keine Beobachtung. Ein Reiz, der einen Akteur identifiziert, verwendet bei unsichtbarem Akteur `hiddenText` oder wird unterdrückt. Interne `cause`-, `evidence`- und andere Event-Felder werden nie als Reiztext kopiert. Ein NPC kann mehrere getrennte Beobachtungen mit demselben `eventId` und unterschiedlichen Kanälen besitzen. Die IDs sind stabil aus Event-ID, NPC-ID und Reizindex abgeleitet. `sourceType: witnessed`, `evidenceMode: direct`, Turn, Weltminute, Quellort und Kanal bleiben im vorhandenen NPC-State erhalten. Vermutungen und Berichte werden nicht erzeugt.

Bei einem Event mit Wahrnehmungsregel wird die bisherige vollständige Verteilung über `witnessed_by` und `worldNews` übersprungen. Damit erhält ein entfernter Hörer nicht zusätzlich die volle Ereignisbeschreibung. Der Spieler wird durch den Wahrnehmungsaufruf nicht in `playerKnownEvents` aufgenommen. Andere, ältere Event-Pfade ohne Wahrnehmungsregel behalten ihr bisheriges Verhalten.

## Transaktion und Tests

Im Linked-Turn entstehen Beobachtungen auf dem vorbereiteten Candidate innerhalb `working.applyDetached`; erst `persistPreparedWorldTurn` veröffentlicht Event, Receipt und NPC-State gemeinsam. Verworfenes Receipt und fehlgeschlagene Persistenz veröffentlichen nichts. Beim Offscreen-Goal-Step wird die Beobachtung nach bestätigter Linked Action in denselben World-Tick-State aufgenommen. Wiederholung derselben Event-ID erzeugt wegen stabiler Beobachtungs-ID keinen neuen Eintrag. JSON Save/Reload erhält Event-Referenz und Quellenfelder.

Deterministische Node-Audits bestanden: gleichzeitiges Sehen/Hören, nur Hören im Nachbarraum, abgeschwächte und nicht mehr hörbare Reize an einer geschlossenen Tür, unerreichbarer Keller, Zyklen, getrennte Texte, verborgener Akteur, Sichtkante, Geruch, Erweiterungskanal, abgelehntes Event, idempotente Verarbeitung, Rollback-Kopie und JSON-Roundtrip. `world_linked_execution_audit.js` und `world_npc_goal_decision_audit.js` bestanden. Browser-Audits bestanden für die neue persönliche Offscreen-Beobachtung im bestehenden Memory-Selector, den Linked-V3-Turn samt Rollback/Reload und Multi-NPC-Goals. Browser-Ausgaben waren deterministisch beziehungsweise simulierte Agentenvorschläge; ein echter LLM-Test wurde nicht durchgeführt.

Performance der reinen Wahrnehmungsberechnung: 100 Events in einer Welt mit 48 Räumen und 48 NPCs dauerten bei zwei Node-Läufen 6–44 ms auf diesem Rechner. Das ist kein vollständiger World-Tick-Benchmark. Die Arbeit ist pro Event auf höchstens acht Reize, 32 Hops und 512 Graphknoten begrenzt. Der Algorithmus scannt gegenwärtig die kleinen `locations`- und `entities`-Listen; für deutlich größere Welten wäre ein pro Tick wiederverwendeter Ortsindex sinnvoll.

## Grenzen und Anschluss für P2.7b

Wahrnehmungsregeln sind opt-in und müssen von Welt-Autoren mit sicheren lokalen und entfernten Texten versehen werden. Sicht berücksichtigt explizite Kanten und einfache Sichtbarkeitsfelder; Verdeckung innerhalb eines Raums und Luftströmung werden nicht simuliert. Bestehende Narrative und ältere Events ohne Regel behalten ihre bisherige Sichtbarkeitslogik. Die neue persönliche Beobachtung ist im bestehenden NPC-Kontext und World-Agent-Digest verfügbar. P2.7b kann daraus Ziele ableiten, ohne Event-Provenienz oder Memory-Struktur zu ändern.
