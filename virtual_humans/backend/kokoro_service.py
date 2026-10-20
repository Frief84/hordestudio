"""Local Kokoro ONNX speech for Horde Studio.

Adapted from the user's Kokoro integration template. Model files are kept out
of the repository and CPU/CUDA sessions are deliberately separate.
"""

from __future__ import annotations

import io
import hashlib
from pathlib import Path
import sys
import threading

import numpy as np

from .kokoro_text2voice import VOICE_CATALOG, TAG_MAP, ALIASES as TAG_ALIASES
from .kokoro_text2voice import tags_to_formula


SEARCH_DIRS = [
    Path(r"N:\krokoro"),
    Path(r"N:\Horde Studio\.cache\kokoro_82m"),
    Path.home() / ".cache" / "kokoro_82m",
]

_sessions: dict[str, object] = {}
_session_lock = threading.RLock()


def find_model() -> tuple[str | None, str | None]:
    for base in SEARCH_DIRS:
        model = base / "kokoro-v1.0.onnx"
        voices = base / "voices-v1.0.bin"
        if model.is_file() and voices.is_file():
            return str(model), str(voices)
        if base.is_dir():
            for model in base.glob("*/kokoro-v1.0.onnx"):
                voices = model.parent / "voices-v1.0.bin"
                if voices.is_file():
                    return str(model), str(voices)
    return None, None


def get_kokoro(gpu: bool = False):
    key = "gpu" if gpu else "cpu"
    with _session_lock:
        if key in _sessions:
            return _sessions[key]
        model, voices = find_model()
        if not model or not voices:
            raise RuntimeError("Kokoro model files not found in N:\\krokoro or the app cache.")
        import onnxruntime as ort
        from kokoro_onnx import Kokoro

        available = ort.get_available_providers()
        provider = "CUDAExecutionProvider" if gpu else "CPUExecutionProvider"
        if provider not in available:
            raise RuntimeError(f"{provider} is unavailable; installed providers: {available}")
        if gpu and hasattr(ort, "preload_dlls"):
            # The user's Kokoro Torch install already ships CUDA 12/cuDNN 9.
            # ONNX Runtime's CUDA wheel can reuse these DLLs without loading
            # Torch or its model into the bridge process.
            candidates = [Path(sys.prefix) / "Lib/site-packages/torch/lib",
                          Path(r"N:\krokoro\.venv\Lib\site-packages\torch\lib")]
            for directory in candidates:
                if (directory.is_dir() and (directory / "cudnn64_9.dll").is_file()):
                    ort.preload_dlls(directory=str(directory))
                    break
        try:
            session = ort.InferenceSession(model, providers=[provider])
        except Exception as error:
            raise RuntimeError(f"{provider} could not initialize: {error}") from error
        active = session.get_providers()
        if provider not in active or (gpu and active[0] != provider):
            raise RuntimeError(f"Requested {provider} did not initialize; active providers: {active}")
        if gpu:
            session.disable_fallback()
        kokoro = Kokoro.from_session(session, voices)
        _sessions[key] = kokoro
        return kokoro


def _parse_formula(formula: str) -> list[tuple[str, float]]:
    chunks = str(formula or "af_heart:100").split(",")
    if not 1 <= len(chunks) <= 3:
        raise ValueError("A voice formula must contain one to three voices.")
    parts = []
    for chunk in chunks:
        voice, _, raw_weight = chunk.strip().partition(":")
        if voice not in VOICE_CATALOG:
            raise ValueError(f"Unknown Kokoro voice: {voice}")
        weight = float(raw_weight) if raw_weight else 100.0
        if not np.isfinite(weight) or weight <= 0 or weight > 100:
            raise ValueError("Voice weights must be between 0 and 100.")
        parts.append((voice, weight))
    if len({voice for voice, _ in parts}) != len(parts):
        raise ValueError("A voice may appear only once in a formula.")
    return parts


def blend_voices(parts: list[tuple[str, float]], gpu: bool = False):
    kokoro = get_kokoro(gpu)
    total = sum(weight for _, weight in parts)
    blended = None
    for voice, weight in parts:
        style = kokoro.get_voice_style(voice)
        component = np.asarray(style, dtype=np.float32) * (weight / total)
        blended = component if blended is None else np.add(blended, component)
    return blended


def _pitch_shift(samples: np.ndarray, semitones: float) -> np.ndarray:
    """Simple audible pitch shift; resampling also alters duration slightly."""
    if not semitones:
        return samples
    ratio = 2 ** (semitones / 12.0)
    output_length = max(1, int(round(len(samples) / ratio)))
    source = np.arange(output_length, dtype=np.float64) * ratio
    return np.interp(source, np.arange(len(samples)), samples).astype(np.float32)


def apply_effects_deterministic(samples: np.ndarray, sr: int, effects: dict | None,
                                character_id: str) -> np.ndarray:
    """Small, repeatable timbre variation; SHA-256 avoids Python hash randomization."""
    if not isinstance(character_id, str) or not character_id.strip() or len(character_id) > 160:
        raise ValueError("character_id must be a non-empty string of at most 160 characters")
    if effects is None:
        effects = {}
    if not isinstance(effects, dict) or len(effects) > 8:
        raise ValueError("effects must be an object with at most eight entries")
    allowed = {"smoky", "tired", "whisper", "scratchy", "drunk"}
    if set(effects) - allowed:
        raise ValueError(f"Unsupported Kokoro effects: {sorted(set(effects) - allowed)}")
    strengths = {}
    for name, value in effects.items():
        strength = float(value)
        if not np.isfinite(strength) or not 0 <= strength <= 1:
            raise ValueError(f"{name} must be between 0 and 1")
        strengths[name] = strength
    digest = hashlib.sha256(character_id.encode("utf-8")).digest()
    seed = int.from_bytes(digest[:8], "big")
    rng = np.random.default_rng(seed)
    # Variation is deliberately subtle: one character remains recognizable
    # across lines without making voices sound like random takes.
    offset = ((int.from_bytes(digest[8:12], "big") / 2**32) - 0.5) * 0.8
    result = _pitch_shift(np.asarray(samples, dtype=np.float32), offset)
    result *= 0.985 + (digest[12] / 255) * 0.03
    if strength := strengths.get("smoky", 0):
        result = (1 - strength) * result + strength * np.tanh(result * 1.3) / 1.3
    if strength := strengths.get("tired", 0):
        phase = np.linspace(0, 4 * np.pi, len(result), dtype=np.float32)
        result *= 1 - strength * (0.1 - 0.1 * np.sin(phase))
    if strength := strengths.get("whisper", 0):
        noise = rng.standard_normal(len(result)).astype(np.float32)
        noise[1:] -= noise[:-1] * 0.85
        result = result * (1 - 0.2 * strength) + noise * np.minimum(np.abs(result), 0.2) * (0.16 * strength)
    if strength := strengths.get("scratchy", 0):
        result = (1 - strength * 0.2) * result + strength * 0.2 * np.tanh(result * 3) / 3
    if strength := strengths.get("drunk", 0):
        wobble = np.sin(np.arange(len(result), dtype=np.float32) * (2 * np.pi * 3 / sr))
        result *= 1 - strength * 0.08 + strength * 0.08 * wobble
    return np.clip(result, -1, 1).astype(np.float32)


def synthesize_wav_bytes(text: str, formula: str = "af_heart:100", speed: float = 1.0,
                         lang: str = "a", use_blending: bool = True, gpu: bool = False,
                         pitch: float = 0, effects: dict | None = None,
                         character_id: str = "") -> bytes:
    if not isinstance(text, str) or not text.strip() or len(text) > 1000:
        raise ValueError("text must be 1–1000 characters")
    speed = float(speed)
    pitch = float(pitch)
    if not np.isfinite(speed) or not 0.5 <= speed <= 2:
        raise ValueError("speed must be between 0.5 and 2")
    if not np.isfinite(pitch) or not -6 <= pitch <= 6:
        raise ValueError("pitch must be between -6 and 6 semitones")
    language = {"a": "en-us", "b": "en-gb"}.get(lang, lang)
    if language not in {"en-us", "en-gb"}:
        raise ValueError("Kokoro currently supports en-us or en-gb here")
    parts = _parse_formula(formula)
    kokoro = get_kokoro(gpu)
    voice = blend_voices(parts, gpu) if use_blending and len(parts) > 1 else parts[0][0]
    samples, sample_rate = kokoro.create(text.strip(), voice=voice, speed=speed, lang=language)
    samples = _pitch_shift(np.asarray(samples, dtype=np.float32), pitch)
    samples = apply_effects_deterministic(samples, sample_rate, effects, character_id)
    _, voices_path = find_model()
    print(f"[Kokoro] loaded {len(kokoro.get_voices())} voices from {voices_path}, character_id={character_id}", flush=True)
    import soundfile as sf
    output = io.BytesIO()
    sf.write(output, samples, sample_rate, format="WAV")
    return output.getvalue()


def synthesize_from_tags(text: str, tags: list[str], speed: float | None = None,
                         lang: str = "a", gpu: bool = False, pitch: float | None = None,
                         effects: dict | None = None, character_id: str = ""):
    profile = tags_to_formula(tags)
    wav = synthesize_wav_bytes(text, profile["formula"], profile["speed"] if speed is None else speed,
                               lang, gpu=gpu, pitch=profile["pitch"] if pitch is None else pitch,
                               effects=profile["effects"] if effects is None else effects,
                               character_id=character_id)
    return wav, profile


def list_voices() -> dict:
    model, voices = find_model()
    info = {"available": False, "voices": [],
            "model_dir": str(Path(model).parent) if model else None,
            "searched": [str(path) for path in SEARCH_DIRS]}
    try:
        import onnxruntime as ort
        info["providers"] = ort.get_available_providers()
        if model and voices:
            kokoro = get_kokoro(False)
            info["voices"] = kokoro.get_voices()
            info["voice_count"] = len(info["voices"])
            info["available"] = True
            if "CUDAExecutionProvider" in info["providers"]:
                try:
                    get_kokoro(True)
                    info["gpu_available"] = True
                except Exception as error:
                    info["gpu_available"] = False
                    info["gpu_error"] = str(error)
            else:
                info["gpu_available"] = False
    except Exception as error:
        info["error"] = str(error)
    return info
