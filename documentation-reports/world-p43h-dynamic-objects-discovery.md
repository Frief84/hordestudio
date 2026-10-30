# P4.3h – Dynamic World Objects & Discovery

Stand: 30.10.2026, lokale Entwicklung in `N:\Horde Studio\app`. Keine Remote-Abfragen, Commits, Pushes, Branches, Klone oder Änderungen an produktiven Spielständen.

## Produktänderungen

- `worlds/dynamic-object-discovery.js` definiert die versionierte Node-Capability `world.dynamic_object_discovery` mit typisierten Ports, Konfigurationsvalidierung und einer gemeinsamen Runtime. Es gibt keinen Node-Editor und keinen Graph-Executor.
- Die World-Author-Regeln in `app.js` und `index.html` bieten eine pro Welt gespeicherte Aktivierung. Beim Aktivieren wird eine editierbare Standardregel mit W20 im bestehenden `universalChecks`-System angelegt. Bestehende Welten bleiben standardmäßig deaktiviert. Ist das Check-Modul aus, findet kein Ersatzwurf statt.
- Der Item-Inspector kann Behälter als `fixed`, `empty` oder `unspecified` kennzeichnen und den Anfangscontainer eines Items wählen. Strukturierte Anfangsinhalte und eindeutige authored Inhaltsprosa schließen ungefragte dynamische Ergänzungen. Bestätigte spätere Transfers verändern den tatsächlichen Inhalt weiter.
- `worlds/turn-binding.js` bereitet klare Suchabsichten und Aufnahmen gewöhnlicher Objekte als Vorschläge vor. `worlds/linked-world-actions.js` prüft sie autoritativ, bevor `item_introduce` eine Instanz mit normaler World-Item-ID registriert. Erfolgreiche Entdeckungen und Ambient-Konkretisierungen benutzen die vorhandene Effect- und Working-State-Transaktion und ein bestätigtes Event. Ein vorhandenes Objekt erhält keinen neuen Existenzwurf.
- Der gemeinsame Resolver prüft Behälter, authored Ausschlüsse, allgemeine Gegenstandsfamilie, Technologie und Ortsbezug vor der W20-Probe. Er nutzt keine starre Positivliste zulässiger Gegenstände; unbekannte oder nicht ausreichend belegte Typen werden nicht dynamisch erzeugt. Modellvorschläge allein autorisieren nichts. Eine natürliche 20 kann ein historisch unplausibles Objekt nicht erschaffen. Suchhandlungen ohne Fund können weiterhin als erfolglose Versuche stattfinden.
- Wiederholte Existenzfragen werden unter stabiler Suchbereichs-ID und normalisierter Gegenstandsbedeutung in `session.discoveryDecisions` gespeichert. `flashlight`, `Taschenlampe` und eine kontextuell elektrische `torch` teilen sich einen Begriff. Der Zustand läuft durch Save/Reload und Working-State-Rollback.
- `worlds/effect-registry.js` und `worlds/npc-goal-actions.js` lassen NPCs dieselbe Runtime für ein konkretes Suchziel nutzen. Gefundene Items bleiben zunächst am Fundort; spätere Aufnahmen nutzen `item_transfer`. Offscreen-Ereignisse folgen den vorhandenen Wissens- und Sichtbarkeitsregeln.

## Nachweise

| Prüfung | Tatsächliches Ergebnis |
| --- | --- |
| `scratch/world_p43h_discovery_audit.js` | PASS nach der letzten Produktänderung: moderne und mittelalterliche Plausibilität, feste/leere Behälter, authored Ausnahme, erzwungener W20, Synonym und Wiederholung, NPC-Kandidat, Ambient-Objekt samt authored Ausschluss, Linked-Action-Ausführung, vorhandenes Item, Server-Binder. |
| Finale World-Regressionssuite | 28/28 PASS nach der letzten Produktänderung; Einzelresultate in `scratch/world-p43h-regressions-final.json`. P4.3g-Natural-Action und Offscreen bestanden zusätzlich separat. Syntaxprüfungen der geänderten JS-Dateien bestanden. |
| Reales lokales Ollama, moderner Haushalt | `qwen2.5:14b-instruct-q4_K_M`: ein Modellrequest, bestätigter W20-Erfolg mit Discovery-Event, gespeicherter Fund in einer Schublade; Live- und gespeicherter Discovery-Zustand gleich. `scratch/world-p43h-modern-live-final.json`. |
| Reales lokales Ollama, mittelalterlicher Kerker | Ein Modellrequest, kein W20 und kein Fund, Turn gespeichert. Eine vom Modell behauptete Nebenliste des Truheninhalts wurde im Binder entfernt; der finale Turn enthält nur den ergebnisoffenen Suchbeleg und keine neuen Items. `scratch/world-p43h-medieval-live-final.json`. |
| Reales lokales Ollama, beschriebener Stuhl | Ein Modellrequest, Aufnahme mit stabiler Item-ID, genau einem Discovery- und einem Inventarereignis; Live- und gespeichertes Inventar sowie Ambient-Entscheidung gleich. `scratch/world-p43h-chair-live-final.json`. |
| Dialogvergleich mit Capability aus/an | Beide je ein Modellrequest und gespeicherter Turn. Aus: 4.110 ms, an: 5.459 ms; die Modellantworten unterschieden sich erheblich, daher keine belastbare 5-%-Aussage. Rohdaten `scratch/world-p43h-dialog-off.json` und `scratch/world-p43h-dialog-on.json`. |
| Deterministischer Fast-Path-Vergleich | Nach der letzten Produktänderung, 500 lokale Objekte, Warm-Median aus 100 Läufen: deaktiviert 3,434 ms, aktiviert 3,408 ms (−0,8 %). Ein Suchresolver mit 500 Containern: 13,464 ms. Cold-Läufe: 10,678/4,037 ms in dieser Reihenfolge, nicht direkt vergleichbar. `scratch/world_p43h_performance_audit.js`. |

## Grenzen und offener Abschluss

Die allgemeine Plausibilitätsbewertung ist bewusst konservativ. Ein nicht klassifizierbarer Gegenstand erzeugt keine neue Instanz. Die Basislexik deckt einige alltägliche Objektfamilien in Deutsch und Englisch ab, aber keine offene natürliche Sprache vollständig; die World-Item-Metadaten können diese Einordnung ergänzen. Inhaltsfestlegungen in ungewöhnlicher Prosa und mehrdeutige Behälterbezüge brauchen weitere Abnahme. Eine zweite Existenzentscheidung nach tatsächlich neu erschlossenen Teilbereichen oder wesentlich anderer Suchmethode ist noch nicht allgemein modelliert. Eine eigenständige Wahrnehmungsprobe für versteckte, bereits existierende Items fehlt. Die vollständige 56-Fälle-Matrix einschließlich langer Multi-Aktions-Live-Züge, aller NPC-Wissensszenarien und belastbarer Cold-/Warm-Modell-Mediane ist noch nicht nachgewiesen.

Der normale lokale Prozessstart verweigerte zwischendurch mit `CreateProcessWithLogonW failed: 1909` weitere Läufe. Die abschließenden Audits wurden anschließend über die lokal freigegebene Ausführung gestartet und bestanden. Es wurden keine Browser- oder Modellinstallationen vorgenommen.
