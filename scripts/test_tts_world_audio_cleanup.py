"""Check world-scoped Ming WAV deletion without touching real world data."""
import json
import sys
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tts_management


def main():
    first_id = f"tts-cleanup-test-{uuid.uuid4().hex}"
    other_id = f"tts-cleanup-test-{uuid.uuid4().hex}"
    created = []
    try:
        for model in tts_management.MODELS:
            for world_id in (first_id, other_id):
                folder = (tts_management._target("ming", model) / "audio-cache" / "worlds"
                          / tts_management._world_audio_key(world_id))
                assert not folder.exists(), "Test path must be unused"
                folder.mkdir(parents=True)
                created.append(folder)
                (folder / "test.wav").write_bytes(b"RIFF" + bytes(1024))

        request = urllib.request.Request(
            "http://127.0.0.1:43129/api/tts/world-audio/delete",
            data=json.dumps({"worldId": first_id}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.load(response)
        assert result == {"deleted": 2}, result
        assert all(not folder.exists() for folder in created[::2])
        assert all((folder / "test.wav").is_file() for folder in created[1::2])
        assert tts_management.purge_world_audio(other_id) == 2
        assert all(not folder.exists() for folder in created)
        print("World audio cleanup API: passed; other world preserved")
    finally:
        for folder in created:
            (folder / "test.wav").unlink(missing_ok=True)
            if folder.is_dir():
                folder.rmdir()


if __name__ == "__main__":
    main()
