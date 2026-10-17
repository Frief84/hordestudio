#!/usr/bin/env python3
"""OpenAI-compatible local speech adapter for a Kokoro installation."""

from __future__ import annotations

import io
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import wave
from typing import Any


DEFAULT_PORT = 8000
SAMPLE_RATE = 24_000
MODEL_ID = "kokoro-82m"
VOICES = [
    "af_heart", "af_bella", "af_nicole", "af_aoede", "af_kore", "af_sarah",
    "af_nova", "af_sky", "af_alloy", "af_jessica", "af_river", "am_michael",
    "am_fenrir", "am_puck", "am_echo", "am_eric", "am_liam", "am_onyx",
    "am_santa", "am_adam", "bf_emma", "bf_isabella", "bf_alice", "bf_lily",
    "bm_george", "bm_fable", "bm_lewis", "bm_daniel",
]

_engine_lock = threading.RLock()
_inference_lock = threading.Lock()
_model = None
_pipelines: dict[str, Any] = {}
_device = "cpu"


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


def _error(message: str) -> dict[str, Any]:
    return {"error": {"message": message, "type": "invalid_request_error"}}


def _load_engine() -> tuple[Any, dict[str, Any], str]:
    global _model, _pipelines, _device
    with _engine_lock:
        if _model is not None:
            return _model, _pipelines, _device

        import torch
        from kokoro import KModel, KPipeline

        _device = "cuda" if torch.cuda.is_available() else "cpu"
        _model = KModel().to(_device).eval()
        _pipelines = {code: KPipeline(lang_code=code, model=False) for code in "ab"}
        return _model, _pipelines, _device


def _synthesize(text: str, voice: str, speed: float) -> bytes:
    if not text.strip():
        raise ValueError("input must not be empty")
    if voice not in VOICES:
        raise ValueError(f"unknown Kokoro voice '{voice}'")

    model, pipelines, _ = _load_engine()
    lang_code = voice[0]
    if lang_code not in pipelines:
        raise ValueError(f"language '{lang_code}' is not enabled by this adapter")
    pipeline = pipelines[lang_code]
    pack = pipeline.load_voice(voice)
    chunks = []

    with _inference_lock:
        for _, phonemes, _ in pipeline(text, voice, speed):
            if not phonemes:
                continue
            ref_index = min(max(len(phonemes) - 1, 0), len(pack) - 1)
            audio = model(phonemes, pack[ref_index], speed)
            chunks.append(audio.detach().float().cpu().numpy().reshape(-1))

    if not chunks:
        raise ValueError("Kokoro produced no audio for the supplied input")

    import numpy as np

    samples = np.clip(np.concatenate(chunks), -1.0, 1.0)
    pcm = (samples * 32767.0).astype("<i2").tobytes()
    output = io.BytesIO()
    with wave.open(output, "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(SAMPLE_RATE)
        stream.writeframes(pcm)
    return output.getvalue()


class KokoroHandler(BaseHTTPRequestHandler):
    server_version = "HordeKokoroTTS/1.0"

    def _cors(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin in {
            "http://127.0.0.1:43127", "http://localhost:43127",
            "http://127.0.0.1:4173", "http://localhost:4173",
        }:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _send_json(self, status: int, value: Any) -> None:
        body = _json_bytes(value)
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path in {"/health", "/v1/health"}:
            return self._send_json(200, {"ok": True, "engine": "kokoro", "model_loaded": _model is not None})
        if self.path == "/v1/models":
            return self._send_json(200, {
                "object": "list",
                "data": [{
                    "id": MODEL_ID,
                    "object": "model",
                    "name": "Kokoro 82M (local)",
                    "description": "Local Kokoro TTS through Horde Studio",
                    "architecture": {"input_modalities": ["text"], "output_modalities": ["speech"]},
                    "supported_voices": VOICES,
                    "supported_parameters": ["voice", "response_format", "speed"],
                }],
            })
        return self._send_json(404, _error("Not Found"))

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/v1/audio/speech":
            return self._send_json(404, _error("Not Found"))
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 2_000_000:
                raise ValueError("request body is missing or too large")
            payload = json.loads(self.rfile.read(size).decode("utf-8"))
            text = str(payload.get("input", ""))
            voice = str(payload.get("voice", "af_heart"))
            speed = max(0.5, min(2.0, float(payload.get("speed", 1.0))))
            audio = _synthesize(text, voice, speed)
        except Exception as exc:
            return self._send_json(400, _error(str(exc)))

        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(audio)))
        self.end_headers()
        self.wfile.write(audio)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[kokoro] {format % args}", flush=True)


def main() -> None:
    port = int(os.environ.get("HORDE_KOKORO_TTS_PORT", str(DEFAULT_PORT)))
    server = ThreadingHTTPServer(("127.0.0.1", port), KokoroHandler)
    print(f"Horde Kokoro TTS adapter listening on http://127.0.0.1:{port}/v1", flush=True)
    print("Kokoro model loading is lazy and happens on the first speech request.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
