"""One-shot isolated Kokoro inference for Horde Studio managed installations."""
import json
import sys
from pathlib import Path

from virtual_humans.backend import kokoro_service


def main() -> int:
    model_dir = Path(sys.argv[1]).resolve()
    operation = sys.argv[2]
    kokoro_service.SEARCH_DIRS.insert(0, model_dir)
    if operation == "voices":
        print(json.dumps(kokoro_service.list_voices()))
        return 0
    request = json.load(sys.stdin) if operation == "synthesize" else {
        "text": "Hello from Horde Studio.", "formula": "af_heart:100", "character_id": "install-test"}
    output = Path(sys.argv[3]).resolve()
    wav = kokoro_service.synthesize_wav_bytes(
        request["text"], request.get("formula", "af_heart:100"),
        request.get("speed", 1.0), request.get("lang", "a"),
        gpu=request.get("gpu", False), pitch=request.get("pitch", 0),
        effects=request.get("effects"), character_id=request.get("character_id", "preview"))
    output.write_bytes(wav)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
