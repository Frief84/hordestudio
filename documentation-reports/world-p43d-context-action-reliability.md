# P4.3d · Kontext und mehrteilige World-Aktionen

Stand: 28.10.2026. **Deterministische Teilabnahme, keine vollständige P4.3d-Abnahme.** Es gab keine neuen Ollama-Requests. Aussagen über verbesserte Live-Modellzuverlässigkeit sind daher offen.

## Ausgangslage

- Hauptprojekt `N:\Horde Studio\app`, Branch `main`, HEAD zu Beginn `d75c3f24ad10a88da92501870f0dd6598f5a2da1`, Origin `https://github.com/Frief84/hordestudio.git`.
- Bereits lokal verändert: `app.js`, `worlds/turn-context.js`, `docs/worlds/TESTING.md`, `scratch/run_world_model_regressions.js`, `kokoro_tts_adapter.log`; außerdem ungetrackter P4.3b-Bericht, Rohdaten und Audits. Diese Änderungen wurden erhalten.
- Der P4.3b-Rohdatensatz `scratch/world-model-p43b-2026-10-27/request-ledger.json` enthält 58 Requests. A1 zeigte `request_coverage_mismatch`, behauptete Tür-/Begleitungserfolge ohne Effects. Der gespeicherte B-Fehler wurde bereits durch den lokal vorhandenen Door-Claim-Guard in `app.js` abgesichert; dieser Guard blieb erhalten.
- Die drei früheren Debug-Klon-Befunde wurden geprüft. Der NPC-Bewegungspfad las für spätere Bewegungsereignisse noch den ursprünglichen statt des projizierten Ortes. Bei unbekanntem Outfit konnte eine mehrdeutige Entfernung `Undressed.` erzeugen. Der Door-Claim-Guard verwendete `stripSpokenDialogue` nur für Erzählprüfung und änderte keine autoritative Präsenzprüfung.

## Ursachen und Änderungen

1. `worlds/linked-world-actions.js`: Der native `interactable_transition`-Validator verwarf authored Tür-IDs wie `door:loc_antechamber::loc_round_room` vor dem Reducer als `invalid_technical_effect`. Die Validierung akzeptiert nun die vorhandene Tür-ID-Syntax; der Reducer prüft weiterhin Ort, tatsächlichen Schlüsselbesitz, Transition und Zugangsregeln. Ein richtig benannter Schlüssel öffnet die Tür; ein falscher oder fehlender bleibt blockiert.
2. `worlds/linked-world-actions.js`: Beim Transfer einer registrierten losen Schlüsselinstanz ging ihre ID in einem bloßen Inventarnamen verloren, wenn ein gleichnamiger Schlüssel bereits existierte. Bei gleichnamigen Exemplaren und weiteren Übergaben bleibt die registrierte ID im Zielinventar. Die normale Darstellung eines einzelnen, nicht mehrdeutigen Legacy-Items bleibt kompatibel. Ein Legacy-Namenseintrag beweist keine spezifische lose Instanz-ID; ein entsprechend falscher Transfer bleibt blockiert. Die Türanforderung ist weiterhin namensgebunden: **beide Cell Keys öffnen dieselbe Tür**.
3. `worlds/turn-context.js` und `app.js`: Der Server-Binding-Kontext enthält eine kompakte Projektion naher authored Tür-IDs, Türzustände, Schlüsselanforderungen, tatsächlicher Schlüsselhalter, registrierter loser Item-IDs und NPC-Inventare. Das sind Vorschlagshilfen; Effect Registry und Working State prüfen alles erneut. Verbatim Request-Slices unterstützen die Abdeckung mehrteiliger Absichten. Mehrere technische Effects dürfen zu einer Spielerabsicht gehören. Die Prompthinweise erklären die Reihenfolge Türöffnung → Bewegung und trennen Spielerbitte von NPC-Entscheidung.
   Die Schlüssel-Tür-Zuordnung in dieser Projektion ist DM-Mechanik und ausdrücklich kein persönliches NPC-Wissen. NPCs kennen die allgemeine Verwendung von Schlüsseln, lernen eine konkrete Zuordnung aber durch authored persönliches Wissen, Beobachtung, verifizierte Mitteilung oder eigenen Versuch. Eine eigene fehlgeschlagene Probe ist kein Beleg für erfolgreiches Öffnen. Eine deterministische Prüfung der Wissensfortschreibung nach solchen Versuchen steht noch aus.
4. `worlds/turn-context.js` und `app.js`: Die Turn-Diagnose liefert geschätzte Zeichen-/Tokenwerte je bereits erhobenem Kontextbereich (`Zeichen / 3,2`). Die Teilwerte können sich überlappen, da etwa Lore und Schema im gesamten Request enthalten sind; sie sind keine Provider-Messung.
5. `app.js`: NPC-Folgebewegungen in einem Legacy-Receipt prüfen den projizierten Ort aus bereits akzeptierten Bewegungen statt wiederholt den Turn-Anfangsort. Eine Kleidungsentfernung bei völlig unbekanntem Ausgangsoutfit schreibt keinen erfundenen `Undressed.`-Zustand.

Produktdateien dieser Phase: `app.js`, `worlds/turn-context.js`, `worlds/linked-world-actions.js`. Neu: `scratch/world_p43d_action_reliability_audit.js`. Die bereits vorhandenen P4.3b/P4.3c-Änderungen sind davon getrennt zu lesen.

## Kontextgrößen

Der gespeicherte erste A1-Qwen-Request aus P4.3b enthält 48.743 Zeichen Messages, 39.377 Zeichen Tool-Schema und 90.480 Zeichen gesamten JSON-Request (etwa 28.275 Token bei Zeichen/3,2). Die neue Vault-Projektion aus der deterministischen Ausgangssession hat 681 Zeichen (~213 Token); die Verbatim-Slices der Hauptanfrage 178 Zeichen (~56 Token), zuzüglich kurzer Anweisungen. Diese Zahlen messen verschiedene Zeitpunkte; ein exakt vergleichbarer vollständiger **Nachher-Request** wurde ohne neuen Modellrequest nicht erzeugt. Der Browser-Kontextbudget-Audit bestand; ein gemessener Prompt-Rückgang wird nicht behauptet. Die Diagnose ist eine Schätzung und ersetzt keine Provider-Tokenzahlen.

## Positive und negative Regressionen

- `scratch/world_p43d_action_reliability_audit.js`: Spielerrede plus Türöffnung plus bestätigte Folgebewegung im selben Working State; Tür öffnet mit Startschlüssel. Die getrennte Tischschlüsselinstanz öffnet dieselbe namensgebundene Tür. Für sämtliche im Vault mit `Cell key` und `locked` versehenen gerichteten Exits, einschließlich Zellentüren, öffnet und schließt sowohl der Legacy-Startschlüssel als auch die registrierte Tischinstanz. Linda nimmt die Tischinstanz auf, behält ihre ID, öffnet mit ihrem eigenen Schlüssel die Tür und kann die Instanz unter Erhalt der ID weitergeben. Commit/JSON-Reload erhält Tür, Linda-Inventar und Player-Key. Falscher Schlüssel und vorgetäuschter Besitz der Tischinstanz blockieren. Die Ausgangssession bleibt vor Commit unverändert.
- P4.3a-Recovery-Audit: bestanden. P4.3b-Key-Duplication-Audit und Door-Claim-Browser-Audit: bestanden.
- `scratch/world_context_budget_browser_audit.js`: bestanden (klein, dicht, veränderter Ort, Reparatur, Mischfall).
- Vollständiger Lauf `scratch/run_world_model_regressions.js` mit 180-s-Einzellimit: **25/25 bestanden, 0 Fehler, 0 Timeouts**. Ergebnis: `scratch/world-p43d-regressions-final.json`. Der Runner enthält den Recovery-Audit nicht; er wurde separat gestartet.
- `node --check` für die drei geänderten Produkt-JavaScript-Dateien: bestanden.

Die Audits verwenden kontrollierte Vorschläge. Sie beweisen die autoritative Ausführung, nicht die Fähigkeit eines lokalen Sprachmodells, diese Vorschläge zuverlässig zu erzeugen. Der neue Audit prüft keine automatische Ableitung einer NPC-Zustimmung aus einer Spielerbitte; er setzt Lindas eigenständige Entscheidung als kontrollierten Input. Bedingte Begleitung, NPC-Auftragsannahme über mehrere Ticks, vollständige Sprecherabdeckung und breite Wissens-/Check-Livefälle sind noch nicht als P4.3d-Ende-zu-Ende-Szenarien belegt.

Nach dem letzten erfolgreichen Auditlauf wurde nur die oben beschriebene NPC-Wissensanweisung im Prompt ergänzt. Eine erneute Syntax-/Regressionprüfung und die abschließende Git-Statusabfrage konnten wegen `CreateProcessWithLogonW failed: 1909` keine Prozesse starten. Der letzte vollständige 25/25-Lauf liegt unmittelbar vor dieser Prompt-Ergänzung; sie ist deshalb **nicht** als auf finalem Code nachgetestet ausgewiesen.

## Live-Abnahme nach gesonderter Freigabe

Keine Requests aus dem abgeschlossenen P4.3b-Budget wurden wiederverwendet. Für eine kleine spätere Matrix sollten pro Fall Request, vollständige Modellantwort, Reparaturzahl, Receipt, Effects, Events und Save/Reload-Zustand gesichert werden:

| Priorität | Eingabe/Fall | Erfolgskriterium |
|---|---|---|
| 1 | Sprechen + Item-Aufnahme | Beide Absichten abgedeckt, ein bestätigter Transfer, korrekter Sprecherbeleg |
| 2 | Cell key → Round-Room-Tür | `interactable_transition`, Environment-Event und `unlockedExits[door]` |
| 3 | Tür öffnen → eintreten | Tür-Effect vor `actor_move`, Bewegungs-Event, Spielerort nach Reload |
| 4 | Linda um Begleitung bitten | Zustimmung oder Verweigerung belegbar; nur bei Zustimmung gültiger Follow-/Move-Zustand |
| 5 | Linda nimmt Tischschlüssel | Instanz-ID in Linda-Inventar, eigene Türöffnung, Spieler-Schlüssel erhalten |
| 6 | Mehrere Sprecher | Direkte Rede vollständig und korrekt attribuiert; Beobachtungsprosa ohne Sprecher |
| 7 | Isolierte P4.1/P4.2-Testkopie | Autoritatives Check-Ergebnis, Kosten-Event, korrekte Ressourcen nach Reload |

Der bestehende fünfminütige World-Turn-Grenzwert und die Modellkonfiguration wurden nicht geändert.
