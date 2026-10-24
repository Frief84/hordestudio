# P2.6c – NPC-Planfortschritt, Erinnerungsauswahl und Zielbelege (24.10.2026)

## A. P2.6c.1 – Planung

Der vorhandene `goalActionSteps`/`goalActionIndex`-Pfad und der freie `goalActionProposal`-Pfad bleiben bestehen. `goalActionProgress` im NPC-Session-State speichert den aktuellen Effekt, Actor und Target, Schrittindex, Status, Ergebnis, Blockadegrund, Prüf-Turn, einen lokalen Gültigkeitsschlüssel und die ID des bestätigten Events. Save/Reload nimmt diesen Zustand mit; es gibt keine zweite Planungstabelle und keinen weiteren Scheduler.

Vor dem Ausführen wird der Schritt gegen den aktuellen lokalen Zustand geprüft. Der Schlüssel berücksichtigt Ort, Inventar, Zielobjekt und betroffenen Ausgang samt Türzustand. Derselbe blockierte Effekt wird bei unverändertem Schlüssel nicht jede Runde erneut ausgeführt. Eine Änderung macht ihn wieder prüfbar. Freie Vorschläge werden gegen die aktuellen lokalen Optionen validiert. Bei einer vorgegebenen Folge werden bereits erfüllte Vorbereitungsschritte, etwa eine inzwischen geöffnete Tür, übersprungen; der nächste echte Schritt läuft weiterhin durch `executeLinkedActions`. Es gibt höchstens eine ausgeführte Goal-Action je NPC und Tick.

`goalAutonomy: paused` setzt einen aktiven Plan auf `interrupted`; nach Wiederaufnahme bleibt sein Schrittindex erhalten. `abandoned` ist ein eigener terminaler Goal-Status. Die vorhandenen `goalPool`-Einträge bleiben aufeinanderfolgende Ziele; mehrere gleichzeitig priorisierte Ziele und eine allgemeine Prioritätsregel sind noch nicht implementiert.

## B. P2.6c.2 – Erinnerungen und Ziele

Der bestehende World-Agent-Aufruf wählt je NPC höchstens drei eigene Beobachtungen und drei ihm bekannte Nachrichten aus den letzten 80 Einträgen je Quelle. Zieltext und aktuelle Handlungsoptionen liefern strukturierte Suchwörter. Wortüberschneidung erhält Vorrang vor Aktualität; bei fehlender Übereinstimmung gewinnt die neuere Information. `knownBy` wird vor der Wertung geprüft. Nachrichten tragen im Digest `source: reported_news`; eigene Beobachtungen behalten ihre Herkunft. Der feste Vergleichstest zeigt: Ein alter Schlüsselhinweis, der bei `slice(-3)` entfiele, ist nun enthalten; eine fremde Nachricht bleibt ausgeschlossen. Die Kontextgrenze und Zahl der Modellaufrufe bleiben gleich.

Ein Welt-Autor kann `goalCompletion` als Datenbedingung an einem NPC hinterlegen. Unterstützt sind `actor_location`, `inventory_contains`, `exit_open`, `confirmed_event` sowie `all` und `any`. Die Bedingung wird im Goal-State gespeichert. Nach einer bestätigten Linked Action prüft die Engine den neuen Zustand und speichert bei Erfüllung `goalCompletionProof` mit Event-ID und Bedingung. Ohne passende Bedingung bleiben freie semantische Ziele offen. Für ältere vorgegebene Schrittfolgen gilt der bestätigte letzte Schritt weiterhin als Abschlussbeleg; bei einem exakt benannten Ortsziel gilt die bestätigte Ankunft. Ein Agentenvorschlag allein kann keinen freien Goal-Abschluss auslösen.

## C. Regressionen

Geändert: `worlds/npc-goal-actions.js`, `app.js`, `scratch/world_npc_goal_tick_browser_audit.js`; neu: `scratch/world_npc_goal_progress_audit.js` und dieser Bericht. Vorbestehende lokale Änderungen blieben erhalten. Bestanden: beide Node-Audits für Goal-Actions und Goal-Entscheidung, der neue Progress/Memory-Audit, beide Browser-Audits für vorgegebene und freie Goals, `node --check app.js`. Die Browser-Audits prüfen drei bestätigte Schritte, Rollback bei Blockade, Save/Reload, Unterbrechen, wiederholten Tick und eine fremd geöffnete Tür. Kein echter LLM-Aufruf wurde ausgeführt; der World-Agent-Aufrufpfad wurde nicht vervielfacht.

## D. Offene Punkte für P2.6d

Offscreen-Aktionen funktionieren bereits über den regulären World-Tick, World-Time, lokale Wissensprüfung und Linked Actions. Der freie Optionskatalog umfasst derzeit nur Bewegung, Gegenstandsaufnahme und Türübergang. Mehrere gleichzeitig aktive Ziele je NPC, eine Prioritätsbewertung und allgemeine Alternativwege für vorgegebene Schrittfolgen fehlen. Die Erinnerungsauswahl prüft bis zu 80 Einträge pro Quelle für höchstens zwölf Goal-Kandidaten im vorhandenen World-Agent-Intervall; bei deutlich mehr NPCs sollte das Profiling erneuert werden. Ein echter Modelltest für die Qualität der strategischen Wahl steht noch aus.
