# World Engine: aktueller Stand

Stand: 26.10.2026, lokaler Dateistand. „Getestet“ meint die ausdrücklich genannten Testarten. Die P4.3a-Abnahme war laut letztem lokalen Bericht **deterministisch abgeschlossen: 26/26 Audits bestanden**; ein anschließender Live-Modelltest ist nicht dokumentiert.

| Bereich | Implementiert und deterministisch geprüft | Echte lokale Modellprobe | Grenze |
|---|---|---|---|
| P2.1–P2.3: Scene Draft, Binding, Linked Actions, Transaktionen | Struktur, Request-Abdeckung, Effect-/Event-Belege, Rollback, Persistenz | Einzelne Gemma-/Qwen-Turns mit Erfolg, gültigem Fehlschlag und technischen Ablehnungen | Kein allgemeiner Erfolgsnachweis für freie Aktionen |
| P2.4–P2.5: Gegenstände, Reichweite, NPC-Bewegung | Strukturierte Raumgegenstände, Creation Rules, Behälter/Hindernisse, Besitz und Actor-Bewegungsbelege | Schlüsselaufnahme belegt; erfolgreiche gemeinsame NPC-Raumbewegung nicht belegt | Bloße Prosa ist keine Gegenstandsquelle |
| P2.6–P2.8: NPC-Ziele, Wahrnehmung, Wissen, Kontinuität/Recovery | Zielschritte, Agenda, Reize, persönliche Beobachtung, Wissensweitergabe, atomare Recovery | Begrenzte lokale Gegenproben, keine lange Live-Kampagne | Erzählqualität und Langzeitverhalten offen |
| P4.0: allgemeine Handlungsfreiheit | Lokale Aktivität, konservative Teilaktionsabdeckung, Sprecheranzeige, Kontextbudget | Frühere Modellfälle; P4.0 selbst nur kontrollierte Antworten | Synonyme, Pronomen und komplexe Mehrfachabsichten nicht umfassend geprüft |
| P4.1: universelle Checks | Optionale Regeln, Session Zero, Ergebnisbelege und Karten; Nachtests nach Fixture-/Scope-Korrekturen grün | Inschriftenfälle mit Gemma/Qwen/Ministral ohne erfolgreichen bestätigten Check | Manuelle vollständige Session-Zero-Matrix offen |
| P4.2/P4.2a: Ressourcen-Kosten und Modellvertrag | Kosten, Vorprüfung, Event/Receipt/Ledger, Rollback/Reload; kontrollierte Audits grün | Kein belegter erfolgreicher Live-Kosten-Commit; abgelehnte Fälle lassen Energie bei 5 | Provider-Tokens und Cold-Start-Anteil unbekannt |
| P4.3a: Benchmark-Fehlerbehebung | Intent-Guard, präzisere Reparaturbelege; finaler Recovery-Audit plus 25 Regressionen grün | **Keine neue Live-Inferenz nach dem Fix** | P4.1/P4.2, A3 und A2 müssen separat live geprüft werden |

P4.3a korrigierte die technisch akzeptierbare, fachlich falsche `speech`-Einordnung bei eindeutig benannter physischer Handlung. Es lockerte weder Bewegungs- noch Effect-Validierung. Der spätere Recovery-Audit ergänzt positive Inventar-, Bewegungs-, Kosten-, Verneinungs-, Persistenz- und Reload-Fälle. Frühe Fehler der neu angelegten Fixtures waren falsche Testerwartungen und wurden vor dem finalen Lauf berichtigt. Die 26 Prozesse wurden tatsächlich gestartet; es gab im finalen Lauf keine Timeouts. Spätere Prozessstartfehler `CreateProcessWithLogonW failed: 1909` betrafen zusätzliche, für diese Abnahme nicht erforderliche Prüfversuche und sind kein Engine-Testfehler.

Die auf ältere P4.1-Berichte zurückgehenden Fehler im Life-Seed-Fallback und in Browser-Fixtures wurden später behoben und erneut geprüft. Historische Fehlerlisten sind daher nicht als aktuelle Mängelliste zu lesen. Aktuelle offene Befunde stehen in [KNOWN-ISSUES.md](KNOWN-ISSUES.md); die Beleglage in [TESTING.md](TESTING.md).
