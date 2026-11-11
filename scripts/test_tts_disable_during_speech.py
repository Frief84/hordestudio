"""Live local API check: disabling TTS terminates an in-flight Ming worker."""
import json
import threading
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:43129"


def request(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    with urllib.request.urlopen(urllib.request.Request(BASE + path, data=data, headers=headers),
                                timeout=240) as response:
        return json.loads(response.read()) if path != "/api/tts/ming/synthesize" else response.read()


request("/api/tts/select", {"provider": "ming"})
result = {}


def speak():
    try:
        result["audio"] = request("/api/tts/ming/synthesize", {
            "text": "A unique interruption check for Horde Studio on October twenty ninth. "
                    "This sentence should stop before the speech model finishes.",
            "model": "0.5b", "profile": {"engine": "ming", "mode": "design",
                                         "description": "A calm, clear narrator for interruption testing."}})
    except urllib.error.HTTPError as error:
        result["status"] = error.code
        result["body"] = error.read().decode("utf-8", "replace")
    except Exception as error:
        result["error"] = str(error)


thread = threading.Thread(target=speak)
thread.start()
try:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if request("/api/tts/status")["ming"]["synthesis_running"]:
            break
        time.sleep(0.2)
    else:
        raise RuntimeError("Ming worker did not start within 30 seconds")
    request("/api/tts/select", {"provider": "none"})
    thread.join(timeout=30)
    status = request("/api/tts/status")
    print({"provider": status["provider"], "running": status["ming"]["synthesis_running"],
           "request": result})
    if thread.is_alive() or status["ming"]["synthesis_running"] or result.get("audio"):
        raise RuntimeError("Speech was not cancelled")
finally:
    request("/api/tts/select", {"provider": "kokoro"})
