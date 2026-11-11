# TTS-Anbieterverwaltung: Kokoro und Ming 3.0

Stand: 30. Oktober 2026. Änderungen ausschließlich in `N:\Horde Studio\app`; keine Git-Operationen.

## Architektur

Die bestehende Kokoro-Integration (`kokoro_service.py`, `kokoro_tts_adapter.py`,
`kokoro-voice-designer.js`, `kokoro-world-bridge.js`) bleibt Grundlage. Die
Einstellungen haben nun eine zentrale Auswahl `none / kokoro / ming / local`.
Der lokale Bridgeprozess speichert die Auswahl atomar unter `.tts/selection.json`
einschließlich der aktiven Ming-Modellvariante und prüft sie vor jeder Synthese. Ein
Wechsel von 0.5B zu Tiny stoppt laufende Inferenz; Anfragen an die nicht
ausgewählte Variante erhalten HTTP 409. Das Deinstallieren einer gerade nicht
ausgewählten Ming-Variante deaktiviert die aktive Variante nicht. Ohne neue Auswahl wird für bestehende
Installationen Kokoro angenommen. Bei einem Wechsel wird ein von Horde Studio
gestarteter Kokoro-Adapter beendet; laufende Ming-Inferenz wird abgebrochen.

Nach dem UI-Nachtrag vom 30. Oktober gibt es zusätzlich `local` für einen
bereits vorhandenen OpenAI-kompatiblen Sprachserver. Die frühere separate Karte
„OpenAI-compatible speech / Local Neural TTS“ wurde in die zentrale
„Local speech / Text-to-Speech“-Karte verschoben. Server-URL und optionaler
API-Key bleiben unter denselben gespeicherten Feldern erhalten. Diese externe
Serverinstallation wird von Horde Studio weder heruntergeladen noch gelöscht.
Bei Auswahl von `local` stoppt Horde Studio den eigenen Kokoro-Adapter und
Ming-Worker; bei `none` wird auch lokale Sprachsynthese nicht angefragt.

Kokoro und Ming können parallel installiert sein. Die verwalteten Dateien liegen
getrennt unter `.tts/kokoro` und `.tts/ming/<modell>`, jeweils mit eigener
Python-Umgebung. Die vorhandene externe Installation `N:\krokoro` wird erkannt,
aber nie von der Deinstallation gelöscht. Referenzaufnahmen liegen separat in
`.tts/references` und bleiben bei einer Modell-Deinstallation erhalten.

Die Installation ist ein Hintergrundauftrag mit Schritt, Zustand, Fortschritt,
Fehler und Downloadbytes, soweit vom Download geliefert. Ein `installed.json`
Marker wird erst nach Abhängigkeitsinstallation, Modellprüfung und tatsächlicher
WAV-Erzeugung angelegt. Nach Neustart prüft der Status zusätzlich Interpreter,
Modell-Dateien, Inferenzquelle und Test-WAV. Tiny hat einen eigenen Status und
eine eigene, nie mit 0.5B vermischte Umgebung.

## Abhängigkeiten und Modelle

Kokoro verwendet in der verwalteten Umgebung `kokoro-onnx`, `onnxruntime`,
`numpy` und `soundfile`. Vorhandene ONNX-Gewichte und Stimmendaten können aus
`N:\krokoro` kopiert werden; andernfalls werden die beiden Modell-Dateien von
Hugging Face geladen. Die bestehende externe Installation wird weiter benutzt,
solange keine verwaltete Kopie vorliegt.

Ming 0.5B lädt das offizielle Inferenzquellarchiv ohne Git-Checkout und die
Checkpoint-Dateien `inclusionAI/Ming-3.0-tts-0.5b`. Die offizielle
`requirements.txt` wird in der isolierten Umgebung installiert. Auf Windows
installiert der Manager zuvor PyTorch und Torchaudio 2.6.0 mit CUDA 12.4.
`pynini` wird nicht vorausgesetzt; Inferenz benutzt
`--no_text_normalization`. `flash-attn` ist optional und wird auf Windows
nicht installiert. Paketcache und temporäre Dateien liegen in `.tts` auf N:.
Auch die Laufzeit-Inferenz verwendet den isolierten Hugging-Face-/Transformers-
Cache unter `.tts/hf-cache`; beim Nachtest fiel auf, dass der Prozess sonst den
nicht beschreibbaren Standardcache auf C: benutzen wollte.

Tiny verwendet eine zweite, vollständig getrennte Python-Umgebung. Die
offizielle Referenz nennt Python 3.10.15, CUDA-11.8-Pakete,
`triton==3.3.1` und `fla-core==0.4.2`. Auf diesem Windows-Rechner wurden
PyTorch/Torchaudio 2.7.1+cu118, `triton-windows==3.3.1.post21` und die
übrigen offiziellen Tiny-Abhängigkeiten einschließlich `fla-core==0.4.2`
installiert. Dafür erzeugt Horde Studio eine angepasste
`requirements-tiny-windows.txt` innerhalb der verwalteten Tiny-Installation;
die offizielle Quelldatei bleibt erhalten. Der Triton-Cache liegt unter
`.tts/triton-cache/ming-tiny`. Tiny lud 30 Checkpoint-Shards (etwa 16,73 GiB),
bestand den Triton-CUDA-Test auf der RTX 3090 und erzeugte eine echte
Voice-Design-WAV. Erst danach wurde der Installationsmarker geschrieben.
Der erste Test schlug wegen des nicht beschreibbaren Triton-Standardcaches
fehl; ein weiterer Lauf endete mit Windows-Code `0xC0000005`. Nach der
Cache-Korrektur gelang der direkte Test und anschließend die verwaltete
Installation. Während der Fehlschläge blieb Tiny korrekt im Fehlerzustand.

## NPC-Stimmen und Wiedergabe

Die Kokoro-NPC-Stimme verbleibt im bisherigen `voice_profile` und
`voice_source`. Die vorhandene Tag-Auswahl, Vorschau und Sprachformel bleiben.
Ergänzt wurden eine benannte, wiederverwendbare Stimmenbibliothek je Welt sowie
eine manuelle Mischung zweier vorhandener Stimmen mit Prozentanteilen,
Geschwindigkeit und Vorschau. Das ist ein Mix vorhandener Kokoro-Stimmen,
kein Referenzstimmen-Cloning.

Ming-Profile liegen separat unter `entity.tts_profiles.ming`. Der Editor kann
Voice Design, einwilligungsbasierte WAV-Referenzstimmen und eingebaute Stimmen
konfigurieren. Eine Vorschau ist vor dem Speichern erforderlich. Profilname,
Modell, Modus und Parameter werden dem jeweiligen NPC zugeordnet; die
Kokoro-Zuordnung bleibt unverändert. Nur die Ansicht des gewählten Anbieters
ist sichtbar. Bei `none` sind alle Stimmeneditoren verborgen.

Für `local` gibt es im NPC-Editor ein eigenes Profil unter
`entity.tts_profiles.local` mit Modell- und Stimmen-ID. Vorschau und
Save/Reload wurden mit einem isoliert simulierten OpenAI-kompatiblen Server
getestet. World-Dialoge werden nur für bestätigte Sprecherbelege mit ihrem
jeweiligen lokalen Profil an `/v1/audio/speech` gesendet. Ein NPC ohne lokales
Profil bleibt textbasiert. Der tatsächliche externe Sprachserver des Benutzers
wurde dabei nicht verändert oder gestartet.

World-Sprachausgabe läuft erst nach dem Text-/World-Commit über die
Sprecherbelege. Ming vertont nur Sprechertexte mit bestätigter Zuordnung;
Beobachtungsprosa wird nicht als NPC-Rede behandelt. Ein fehlendes Ming-Profil
verwendet den separaten `EMOTION`-Modus mit vorsichtiger Stimmungserkennung aus
Sprechertext und registrierten Bedingungen. Bei einem gespeicherten Design-,
Referenz- oder IP-Profil bleibt die Stimme stabil und es wird kein inkompatibler
Emotionsmodus kombiniert. TTS-Fehler verändern weder World State noch
NPC-Entscheidungen.

Ming wird für jede nicht gecachte Zeile in einem eigenen Prozess geladen und
danach entladen. Generiertes Audio wird nach Text, Profil und Modell
adressiert zwischengespeichert (maximal 256 WAV-Dateien je Cache-Verzeichnis). Dadurch
gibt es keine dauerhafte zweite GPU-Modelllast. Deaktivieren beendet laufende
Wiedergabe und weist neue Syntheseanfragen serverseitig ab.

## WAV-Bereinigung beim Löschen einer Welt

Neue Ming-WAVs aus Welt-Dialogen und NPC-Vorschauen werden zusätzlich zur
Text-/Profilkennung unter einem Hash der Welt-ID abgelegt. Nach dem
erfolgreichen Speichern einer Weltlöschung ruft die Oberfläche die lokale
Bereinigung auf. Sie beendet eine noch laufende Ming-Synthese dieser Welt und
löscht deren WAV-Dateien für 0.5B und Tiny. Dateien anderer Welten, Modelle,
Referenzaufnahmen und Installations-Test-WAVs bleiben erhalten. Der
verwaltete Kokoro-Worker entfernt seine temporäre `preview.wav` nach jeder
Anfrage; die bestehende externe Kokoro-Integration liefert WAV-Bytes ohne
eine solche Datei im Horde-Studio-Cache. Ein Fehler bei der Bereinigung wird
in der Oberfläche angezeigt, obwohl die Welt bereits gelöscht wurde.
Vor dieser Änderung angelegte Ming-Cache-Dateien ohne Welt-ID können nicht
zuverlässig einer Welt zugeordnet werden und werden deshalb nicht
automatisch einer bestimmten Welt zugeschrieben.

## Hardware und gemessene Laufzeit

Getestet auf Windows mit NVIDIA GeForce RTX 3090 (24 GiB VRAM), Python 3.12.14,
PyTorch 2.6.0+cu124, Torchaudio 2.6.0+cu124 und Transformers 4.46.3.
Zusätzlich gemessen: `huggingface_hub` 0.36.2, `onnxruntime` 1.31.1 und
`diffusers` 0.33.0 in der Ming-Umgebung.
Ming 0.5B erzeugte über `/api/tts/ming/synthesize` eine 299.960-Byte-WAV;
die Referenzstimmen-Anfrage erzeugte eine 282.320-Byte-WAV. Die erste
HTTP-Synthese dauerte 26,66 s, ein identischer Cache-Treffer 0,09 s mit
identischem Datei-Hash. Kokoro erzeugte über die verwaltete Umgebung eine
70.220-Byte-WAV aus einer 50/50-Stimmenmischung.
Tiny erzeugte nach einem Bridge-Neustart über denselben HTTP-Endpunkt im
Voice-Design-Modus eine gültige 409.328-Byte-WAV. Die erste API-Synthese
dauerte 142,83 s. Anschließend wurde wieder Kokoro ausgewählt; beide
Ming-Modelle blieben installiert. Für Tiny gilt wegen der deutlich längeren
Ladezeit ein 900-s-Laufzeitlimit. Bei einem Timeout wird der Worker beendet
und eine klare Fehlermeldung zurückgegeben.

## Tests

| Nr. | Prüfung | Ergebnis |
|---:|---|---|
| 1–2 | Kein TTS und Kokoro wählen | Bestanden: API und Browseransicht; `none` weist Kokoro-Synthese mit 409 ab. |
| 3–4 | Kokoro installieren und testen | Bestanden: isolierte Installation, 54 Stimmen, Mischungs-WAV. |
| 5–7 | Ming wählen, installieren und testen | Bestanden für 0.5B: isolierte Umgebung, Preflight, Test-WAV und HTTP-WAV. |
| 8–10 | Zurück zu Kokoro, Ming/Kokoro deinstallieren | Bestanden: beide Deinstallationspfade ausgeführt; Kokoro aktiv → `none`; Ming 0.5B danach erfolgreich wieder installiert. |
| 11–12 | Ohne TTS, Status nach Neustart | `none`-Synthese gesperrt; persistenter Installationsstatus bei erneutem Bridge-Start geprüft. |
| 13–14 | NPC mit Kokoro-Stimme und Mischung | Browser-Editor: Mischung 60/40 angehört, NPC zugewiesen, benannt, gespeichert und nach Reload geprüft. |
| 15–17 | Ming-Stimme, Design, Referenz | Browser-Editor: Design- und Referenz-WAV erzeugt, Profile zugewiesen und nach Reload geprüft. Zusätzlich API-Test für eingebaute Stimme und Emotionsmodus. |
| 18 | Vorschau abspielen | Browser-Player erhielt WAV; physische Lautsprecherausgabe wurde nicht automatisiert beurteilt. |
| 19–21 | Anbieterwechsel, passende Ansicht, Save/Reload | Browseransichten bestanden; beide NPC-Profile nach `saveState()` und Reload erhalten. |
| 22 | Fehlendes Modell | Vor der Tiny-Installation wurde die fehlende Installation korrekt angezeigt; erst nach erfolgreicher Audio-Probe `installed`. |
| 23–24 | Download unterbrochen, Installation fehlgeschlagen | Download-Verbindungsabbruch und voller C:-Temp-Speicher reproduziert; Temp/Cache nach N: verlegt, Wiederholungsversuche ergänzt, Ming und Kokoro anschließend erfolgreich installiert und getestet. |
| 25 | Modellstartfehler | Tiny meldete den Triton-Cache-Fehler und einen Windows-Prozessabsturz als Installationsfehler; danach gelang der Start mit derselben Installation. Ein absichtlich beschädigtes Modell wurde nicht gestartet. |
| 26 | Deaktivierung während laufender Ausgabe | Live-Test: Ming-Inferenz gestartet, währenddessen `none` gewählt, Worker beendet und API meldete `Ming generation was interrupted or cancelled`; erneut nach Bridge-Neustart bestanden. |
| 27 | Aktiven Anbieter deinstallieren | Bestanden mit Kokoro; Auswahl sprang auf `none`. |
| 28 | Stimme fehlt | Ungültige Kokoro-Stimme gab HTTP 400 `Unknown Kokoro voice: missing_voice`; fehlendes Ming-Modell gab HTTP 503. |
| 29 | Zu wenig GPU-Speicher | Laufzeitfehler wird zurückgegeben; ein OOM wurde nicht absichtlich ausgelöst. |
| 30 | NPC ohne Profil | Ming verwendet nur für belegte Sprechertexte einen separaten Emotionsmodus. |
| Zusatz | Ming-Modellwechsel und exklusiver Betrieb | Server speichert die aktive Variante; Anfrage an 0.5B bei ausgewähltem Tiny ergab HTTP 409. Nach Wechsel zurück erzeugte 0.5B erneut eine gültige 458.720-Byte-WAV. Deinstallation der nicht aktiven Tiny-Variante ließ Ming 0.5B ausgewählt und installiert. |
| Zusatz | Neustart und Syntax vor Tiny-Installation | Bridge neu gestartet; Status: Kokoro extern installiert und aktiv, Ming 0.5B installiert. JavaScript- und Python-Syntaxprüfungen sowie Browseransicht und beide NPC-Profile nach Reload bestanden. |
| Zusatz | Tiny auf Windows | Offizielle Tiny-Quellen in separater Umgebung installiert; 30 Shards geladen, Triton-Kernel auf RTX 3090 bestanden, direkte Voice-Design-WAV mit 338.768 Byte erzeugt. Verwalteter Installationsstatus danach `installed` mit Audio-Test. |
| Zusatz | Tiny nach Neustart über API | Bestanden: persistenter Installationsstatus, Auswahl Tiny, Voice-Design-Synthese über `/api/tts/ming/synthesize` mit 409.328-Byte-WAV und HTTP 200; anschließend Kokoro wieder ausgewählt. |
| Zusatz | Weltgebundene WAV-Bereinigung | Bestanden: zwei künstliche Welt-IDs mit je einer WAV in beiden Ming-Modell-Caches angelegt; die lokale Lösch-API entfernte genau die zwei WAVs der ersten Welt. Die zweite Welt blieb erhalten und wurde danach separat bereinigt. Keine echte Spielwelt wurde gelöscht. |
| Zusatz | Local Neural TTS in zentraler Auswahl | Browser-Test: nur die lokalen Servereinstellungen sichtbar, `/v1/models`-Verbindung, NPC-Vorschau über `/v1/audio/speech`, Profil nach Save/Reload erhalten; der externe Server wurde für diesen UI-Test simuliert. |

## Einschränkungen

Tiny ist auf dieser Windows-Konfiguration lauffähig, benötigt aber etwa
16,73 GiB Modellgewichte und beim direkten Test ungefähr 23,2 GiB GPU-Speicher.
Gleichzeitige GPU-Last durch Ollama kann zu einem Startfehler führen.
Der verwaltete Kokoro-Prozess lädt pro Anfrage neu; die externe Kokoro-Integration bleibt der
schnellere vorhandene Pfad. Das World-State-System und die alten
Kokoro-Profile wurden nicht migriert oder überschrieben. Persönliche
Referenzaufnahmen werden bei Modell-Deinstallation absichtlich nicht gelöscht.
Die externe Kokoro-Installation unter `N:\krokoro` wird erkannt und benutzt;
die Deinstallationsschaltfläche erscheint nur für eine von Horde Studio selbst
verwaltete Kokoro-Kopie. Eine fremde Python-Umgebung wird nicht gelöscht.
Ein absichtlicher GPU-OOM-Test wurde nicht durchgeführt, um eine laufende
Ollama-Nutzung nicht zu stören. Die Browser-Tests liefen mit isoliertem
Speicher; keine bestehenden Spielwelten wurden für die Tests verändert.
Die ausschließlich für Tests erzeugten WAV-Dateien und zwei synthetische
Referenzaufnahmen wurden nach den Tests gezielt entfernt. Ming 0.5B und Tiny
blieben in getrennten Umgebungen installiert, die vorhandene externe
Kokoro-Installation blieb erhalten; Kokoro ist wieder als aktiver Anbieter
ausgewählt.

Offizielle Ming-Quellen: [Projekt und Modus-Verträge](https://github.com/inclusionAI/Ming-3.0-tts),
[0.5B-Modell](https://huggingface.co/inclusionAI/Ming-3.0-tts-0.5b),
[Tiny-Modell](https://huggingface.co/inclusionAI/Ming-3.0-tts-tiny).
