# Living Worlds P1b: Abschluss der Regressionstest-Basis

**Status: P1b abgeschlossen (21.10.2026).** Der produktive V3-Vertrag bleibt erhalten. Der kompakte Transport und die Receipt-Narration bleiben optionale Testpfade. Offene Modellqualitätsfälle sind unten benannt; dieser Status bedeutet keine allgemeine semantische Freigabe eines Modells.

`scratch/world_compact_transport_live_ab.js` verwendet die vorhandenen `small`-, `dense`- und `repair`-Zustände aus `world_context_budget_browser_audit.js`. Der Katalog enthält Eingabe, Quellzustand, explizite Invarianten, bekannte Fehlerursachen und einen SHA-256-Fingerabdruck des Zustands pro Lauf. Er umfasst `dialogue`, `two_questions`, `mixed_npc`, `mixed_effects`, `blocked_chain`, `invalid_reference`, `relation`, `long_input`, `repair`, `dense` und `small`. Modellvorschläge werden ausschließlich auf isolierten Kopien durch Schema, Binding, Compiler, Linked-Execution und Commit geprüft. Fachliche Fixture-Erfüllung ist getrennt von technischer Annahme; nicht deterministisch belegbare Narrationsqualität erhält `unclear`.

Deterministische Prüfung: `HORDE_AB_ENGINE_ONLY=1 node scratch/world_compact_transport_live_ab.js`. Dabei laufen die bestehenden Binding-, Gesture/Effect-, Action-Path-Parity- und Linked-Turn-Browser-Audits. Für den Browser-Audit müssen `HORDE_PLAYWRIGHT_MODULE` und `HORDE_BROWSER_EXECUTABLE` gesetzt sein.

Begrenzter Modelllauf: `HORDE_AB_MODELS=qwen2.5:14b,ministral-3:14b HORDE_AB_CASES=dialogue,two_questions,mixed_npc,blocked_chain HORDE_AB_VARIANTS=current HORDE_AB_ATTEMPTS=2 node scratch/world_compact_transport_live_ab.js`. Unter PowerShell die Variablen zuvor als `$env:...` setzen. `HORDE_AB_REPORT` schreibt den JSON-Bericht. Die Modell-ID wird bei Ollama über den Digest dedupliziert; `qwen2.5:14b-instruct-q4_K_M` war im Messlauf ein Alias von `qwen2.5:14b` und wurde ausgelassen. Temperatur 0, Top-p 1, Seed 42, angefordertes Kontextfenster 32.768, maximal 1.200 Ausgabetokens; Ollama-Structured-Output angefordert, tatsächliche Unterstützung nicht gesondert verifiziert. Reihenfolge der Modelle wechselt je Fixture. Das Modellfenster ist bei Qwen mit 32.768 und bei Ministral mit 262.144 deklariert. Der optionale `openai_compatible`-Pfad ist für spätere Providervergleiche vorbereitet, aber noch nicht mit Astra geprüft.

| Modell | Technisch erster Versuch | Technisch nach Reparatur | Fachlich bestanden / unklar | Reparaturen | Input / Output Tokens | Dauer |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| qwen2.5:14b | 3/4 | 3/4 | 1 / 2 | 1 | 48.146 / 1.536 | 241 s |
| ministral-3:14b | 2/4 | 2/4 | 1 / 1 | 2 | 64.380 / 3.078 | 296 s |

Quelle: `scratch/world_v3_model_regression_2026-10-21.json`. Beide Modelle scheiterten bei `blocked_chain` mit `request_coverage_mismatch`; Ministral zusätzlich bei `mixed_npc`. `two_questions` wurde technisch angenommen, die freie Antwort bleibt fachlich unklar: Sie enthält Behauptungen, die der strukturelle Test nicht vollständig aus dem Recall belegen kann. Die Dauer enthält mögliche Kaltstartkosten. Eine einzelne Ausführung je Fixture begründet keine statistische Modellrangfolge. Kein echter Spielstand wurde verändert.
