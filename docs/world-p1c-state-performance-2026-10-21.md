# Living Worlds P1c: Zustand, Wissen und Performance

## Datenfluss

Die Weltdefinition (`state.worlds`, Orte, NPC-Definitionen, Lore und Regeln) und die jeweilige Session (`state.worldInstances[worldId].sessions`, Positionen, Inventar, Beziehungen, NPC-Zustände und persönliche Beobachtungen, Ereignisse, Ledger, Historie und Weltuhr) sind kanonisch. V2/V3-Actions und WorldAgent prüfen Änderungen über Registry/Binding; Linked Actions bereiten sie im Working State vor und veröffentlichen sie erst nach erfolgreicher Persistenz. Scheduler und Hintergrund verwenden die gemeinsame Weltzeit- und Reiseprüfung. IndexedDB speichert World-Instanzen als versionierte, komprimierte Shards; Import/Export übernimmt die vorhandenen Campaign-/World-Formate.

`worldTurnReceipts` sind persistierte Belege der Session. `sceneMemory` liegt am bestätigten History-Take; Edit/Reroll invalidiert es. NPC-Beobachtungen bleiben bei ihrem jeweiligen `entityState`. Memory Matrix, Lore-Auswahl, Recall und Modellkontext sind abgeleitete, zugriffsbegrenzte Projektionen; sie werden beim Turn erzeugt und nicht als zweite kanonische Memory-Datenbank gespeichert. Ledger, Ereignisfeed, Receipt und Szenenerinnerung können denselben Vorgang in verschiedener Form enthalten. In den geprüften Save/Reload-Fixtures gab es weder Divergenz noch verlorene persönliche Erinnerungen; beliebige externe Spielstände sind damit noch nicht bewiesen.

## Messung und Änderung

`HORDE_STRESS_PROFILE=1 node scratch/living_world_stress_test.js` misst 120 identische Ticks. Der bisherige Ortsresolver durchlief bei jeder Normalisierung wiederholt die ganze Ortsliste: 84.821 Aufrufe im Grenzfall mit 2.000 Orten, 5.000 NPCs und 500 Ereignissen. `normalizeLivingWorldState` baut jetzt je Aufruf lokale ID-/Namensindizes und Mitgliedschaftsmengen auf. ID-Vorrang, Mehrdeutigkeitsablehnung und Änderungen der Weltdefinition zwischen Aufrufen bleiben erhalten. Es gibt keinen persistenten Cache.

| 3 Läufe | Vorher | Nachher |
| --- | ---: | ---: |
| Grenzfall, 120 Ticks (Wall) | 42,7 / 45,5 / 44,3 s | 14,7 / 15,2 / 14,8 s |
| Davon Normalisierung | 31,0 / 33,1 / 32,2 s | 3,6 / 3,7 / 3,6 s |
| Kleine Welt, 120 Ticks | je 12 ms | je 11–12 ms |
| Heap am Laufende | 114–135 MB | 100–131 MB |

Der Median der Grenzfall-Laufzeit fiel um rund 66 %, der Normalisierung um rund 89 %. Heap-Snapshots schwanken mit GC; ein Speichergewinn ist nicht nachgewiesen. Ein zusätzlicher Lauf nach Testwartung maß 15,1 s Wall und 15,4 s CPU bei 148 MB Heap. Der Grenzlasttest verwendet nun den echten Resolver statt seines früheren vereinfachten Stubs und begrenzt diesen realistischeren Pfad auf 20 s.

Die bestehenden Browser-Fixtures mit simuliertem Modell maßen über drei Läufe für kleine/dichte Welten IndexedDB-Lesen meist 3–9 ms, Schreiben 21–30 ms und JSON-Kopien 4–6 ms pro Turn. Beim Szenenwechsel: Schreiben 138–140 ms, Kopien 45–46 ms. Diese Werte enthalten keinen echten Modellaufruf. Deaktivierter Hintergrund-Catch-up: 20 Aufrufe benötigten 5 ms (klein) bzw. 162 ms (Grenzgröße); dafür erfolgte keine Änderung. Der Kontext-Audit ergab 59.215 Zeichen (klein) und 85.909 Zeichen (dicht), davon 35.466 bzw. 36.478 Schema-Zeichen. Diese Änderung betrifft den Kontextaufbau nicht; echte LLM-Tokens wurden hier nicht gemessen.

Die bestehende Recall-Auswahl benötigte für 100 Abfragen einer 40-Take-Historie 13–16 ms, bei 1.000 Takes 216–229 ms (je drei Läufe). Für den geprüften Umfang war dies kein vorrangiger Engpass; persönliche Wissensgrenzen und Quellenbindung wurden nicht verändert.

## Verifikation und Grenzen

Bestanden: Living-World-Stress samt Legacy-/Mehrdeutigkeitsfällen; NPC-Knowledge-Recall; Turn-Context; Working-State; Context-Budget einschließlich Wissen, Zugang und V2/V3; Linked-Receipt/Save/Rollback; Zeit- und Reise-Browser-Audits; Worlds-only Campaign-/Import-/Export-Audit mit V1-Fortsetzung. `world_real_save_continuation_audit.js` konnte ohne übergebene Kopien echter `.horde_campaign`-Dateien nicht ausgeführt werden. Die verbleibende Grenzlast entsteht überwiegend im unveränderten Tick (NPC-Ziele, Beziehungsdrift und Fraktionen). Szenenwechsel verursachen höhere Kopier-/Schreibkosten; eine weitere Änderung erfordert einen eigenen Nachweis von Nutzen und Zustandsparität.
