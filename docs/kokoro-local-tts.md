# Local Kokoro TTS (Windows)

Horde Studio's launcher prefers `app\.venv\Scripts\python.exe`. The local
Kokoro integration uses that environment and does not replace the existing
OpenAI-compatible Local Neural TTS mode.

The tested environment uses Python 3.12, `kokoro-onnx==0.6.1`,
`onnxruntime-gpu==1.23.2`, `numpy==2.5.4` and `soundfile==0.14.0`. Install
`kokoro-onnx`, `soundfile` and `numpy` in `app\.venv`, then remove the CPU
`onnxruntime` distribution it pulls in and install the pinned
`onnxruntime-gpu` distribution. Do not leave both runtime distributions
installed. The newer GPU runtime tested here expected CUDA 13 and did not
initialize against the local CUDA 12.6 installation.

Place `kokoro-v1.0.onnx` and `voices-v1.0.bin` together in `N:\krokoro`.
`N:\Horde Studio\.cache\kokoro_82m` and the user's `.cache\kokoro_82m`
are fallbacks. CUDA needs CUDA 12 and cuDNN 9 DLLs. The service first checks
the app venv's `torch\lib`, then `N:\krokoro\.venv\Lib\site-packages\torch\lib`.
If neither is available, CPU remains usable and an explicit error is shown
when GPU synthesis is requested.

After starting the app, `GET /api/tts/kokoro/voices` reports model and
provider availability. In **Core setup → AI & Models**, select CPU or GPU
and use **Kokoro-Status prüfen**. Voice tags and previews are available in
Virtual Humans' **Stimme** view and in World Studio. Kokoro ONNX here supports
English (`en-us` and `en-gb`).
