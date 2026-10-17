"""Local Kokoro ONNX speech for Horde Studio.

Adapted from the user's Kokoro integration template. Model files are kept out
of the repository and CPU/CUDA sessions are deliberately separate.
"""

from __future__ import annotations

import io
from pathlib import Path
import re
import sys
import threading

import numpy as np


SEARCH_DIRS = [
    Path(r"N:\krokoro"),
    Path(r"N:\Horde Studio\.cache\kokoro_82m"),
    Path.home() / ".cache" / "kokoro_82m",
]
VOICE_CATALOG = [
    "af_heart", "af_sarah", "af_nicole", "af_sky", "bf_emma",
    "bf_isabella", "am_adam", "am_michael", "bm_george", "bm_lewis",
]
TAG_MAP = {
    "female": ["af_heart", "af_sarah", "af_sky", "bf_emma"],
    "male": ["am_adam", "am_michael", "bm_george", "bm_lewis"],
    "young": ["af_sky", "bf_emma", "bm_lewis"],
    "adult": ["af_sarah", "am_adam", "af_heart"],
    "mature": ["bm_george", "am_michael", "af_heart"],
    "warm": ["af_heart", "af_sarah", "bf_emma", "am_adam", "bm_lewis"],
    "cold": ["af_nicole", "bf_isabella"],
    "clear": ["af_nicole", "bf_isabella"],
    "raspy": ["bm_george", "am_michael"],
    "gentle": ["af_sarah", "bf_isabella", "af_heart"],
    "soft": ["af_sarah", "bf_isabella", "am_adam", "bm_lewis"],
    "breathy": ["bf_isabella", "af_sarah"],
    "flattering": ["af_heart", "bf_emma", "am_adam", "bm_lewis"],
    "powerful": ["af_nicole", "am_michael", "bm_george"],
    "happy": ["af_sky", "bf_emma", "am_adam", "bm_lewis"],
    "british": ["bf_emma", "bf_isabella", "bm_george", "bm_lewis"],
    "american": ["af_heart", "af_sarah", "am_adam"],
}
TAG_ALIASES = {
    "weiblich": "female", "männlich": "male", "jung": "young", "erwachsen": "adult", "reif": "mature",
    "kalt": "cold", "klar": "clear", "rau": "raspy", "sanft": "gentle", "weich": "soft",
    "hauchig": "breathy", "britisch": "british", "amerikanisch": "american",
    "tief": "deep", "dunkel": "dark", "hoch": "high", "hell": "bright",
    "schnell": "fast", "langsam": "slow", "energisch": "energetic", "ruhig": "calm", "geflüstert": "whispered",
    "powerfull": "powerful", "softly": "soft", "masculine": "male", "feminine": "female",
    "old": "mature", "elderly": "mature",
}

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


def tags_to_formula(tags: list[str]) -> dict:
    if not isinstance(tags, list):
        raise ValueError("tags must be an array")
    cleaned = list(dict.fromkeys(TAG_ALIASES.get(value, value)
        for tag in tags for value in re.findall(r"[\w-]+", str(tag).lower())))[:20]
    known = set(TAG_MAP) | {"deep", "dark", "high", "bright", "fast", "slow", "energetic", "calm", "whispered"}
    unmapped = [tag for tag in cleaned if tag not in known]
    gender = next((tag for tag in reversed(cleaned) if tag in ("male", "female")), None)
    allowed_voices = [voice for voice in VOICE_CATALOG
                      if not gender or voice[1] == ("m" if gender == "male" else "f")]
    scores = {voice: 0 for voice in VOICE_CATALOG}
    for tag in cleaned:
        for voice in TAG_MAP.get(tag, []):
            if voice in allowed_voices:
                scores[voice] += 1
    if not any(scores.values()):
        scores["af_heart"], scores["bf_emma"] = 2, 1
    ranked = sorted(((voice, scores[voice]) for voice in allowed_voices),
                    key=lambda item: (-item[1], VOICE_CATALOG.index(item[0])))
    top = [(voice, score) for voice, score in ranked if score > 0][:3]
    if len(top) == 1:
        fallbacks = (["am_adam", "bm_george"] if gender == "male" else
                     ["af_heart", "bf_emma"] if gender == "female" else ["bf_emma", "af_heart"])
        fallback = next(voice for voice in fallbacks if voice != top[0][0])
        top.append((fallback, 0.5))
    total = sum(score for _, score in top)
    reserve = 10 * len(top)
    weights = [10 + int(np.floor(score / total * (100 - reserve) + 0.5)) for _, score in top]
    weights[-1] = 100 - sum(weights[:-1])
    parts = [[voice, weight] for (voice, _), weight in zip(top, weights)]
    pitch = (-3 if any(tag in cleaned for tag in ("deep", "dark")) else 0) + (3 if any(tag in cleaned for tag in ("high", "bright")) else 0)
    speed = 1.15 if any(tag in cleaned for tag in ("fast", "energetic")) else 1.0
    if any(tag in cleaned for tag in ("slow", "calm", "whispered")):
        speed = 0.88
    return {"formula": ",".join(f"{voice}:{weight}" for voice, weight in parts),
            "parts": parts, "tags": cleaned, "speed": speed, "pitch": pitch,
            "unmapped": unmapped}


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


def synthesize_wav_bytes(text: str, formula: str = "af_heart:100", speed: float = 1.0,
                         lang: str = "a", use_blending: bool = True, gpu: bool = False,
                         pitch: float = 0) -> bytes:
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
    import soundfile as sf
    output = io.BytesIO()
    sf.write(output, samples, sample_rate, format="WAV")
    return output.getvalue()


def synthesize_from_tags(text: str, tags: list[str], speed: float | None = None,
                         lang: str = "a", gpu: bool = False, pitch: float | None = None):
    profile = tags_to_formula(tags)
    wav = synthesize_wav_bytes(text, profile["formula"], profile["speed"] if speed is None else speed,
                               lang, gpu=gpu, pitch=profile["pitch"] if pitch is None else pitch)
    return wav, profile


def list_voices() -> dict:
    model, voices = find_model()
    info = {"available": False, "voices": VOICE_CATALOG,
            "model_dir": str(Path(model).parent) if model else None,
            "searched": [str(path) for path in SEARCH_DIRS]}
    try:
        import onnxruntime as ort
        info["providers"] = ort.get_available_providers()
        if model and voices:
            get_kokoro(False)
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
