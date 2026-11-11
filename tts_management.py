"""Local, isolated TTS installs owned by Horde Studio.

Only paths below APP/.tts are ever removed. Legacy Kokoro installations are
detected elsewhere, but deliberately never deleted by this manager.
"""
from __future__ import annotations

import io
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
import uuid
import urllib.request
import zipfile

APP = Path(__file__).resolve().parent
ROOT = APP / ".tts"
SOURCE_URL = "https://codeload.github.com/inclusionAI/Ming-3.0-tts/zip/refs/heads/main"
MODELS = {"0.5b": "inclusionAI/Ming-3.0-tts-0.5b", "tiny": "inclusionAI/Ming-3.0-tts-tiny"}
KOKORO_FILES = {
    "kokoro-v1.0.onnx": "https://huggingface.co/fastrtc/kokoro-onnx/resolve/main/kokoro-v1.0.onnx",
    "voices-v1.0.bin": "https://huggingface.co/fastrtc/kokoro-onnx/resolve/main/voices-v1.0.bin",
}
_jobs: dict[str, dict] = {}
_lock = threading.RLock()
_speech: subprocess.Popen | None = None
_speech_world_key: str | None = None
_deleted_world_audio: set[str] = set()
_last_synthesis: dict[str, float] = {}


def speech_running() -> bool:
    with _lock:
        return bool(_speech and _speech.poll() is None)


def _target(provider: str, model: str = "0.5b") -> Path:
    if provider == "kokoro":
        return ROOT / "kokoro"
    if provider == "ming" and model in MODELS:
        return ROOT / "ming" / model
    raise ValueError("Unknown TTS installation target")


def _python(target: Path) -> Path:
    return target / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def _update(key: str, **changes) -> None:
    with _lock:
        _jobs.setdefault(key, {}).update(changes)


def _environment(key: str) -> dict[str, str]:
    temp = ROOT / "tmp" / key.replace(":", "-")
    temp.mkdir(parents=True, exist_ok=True)
    hf_cache = ROOT / "hf-cache"
    (hf_cache / "transformers").mkdir(parents=True, exist_ok=True)
    triton_cache = ROOT / "triton-cache" / key.replace(":", "-")
    triton_cache.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment.update({"TMP": str(temp), "TEMP": str(temp), "TMPDIR": str(temp),
                        "PIP_CACHE_DIR": str(ROOT / "pip-cache"),
                        "HF_HOME": str(hf_cache),
                        "TRANSFORMERS_CACHE": str(hf_cache / "transformers"),
                        "TRITON_CACHE_DIR": str(triton_cache)})
    return environment


def _run(args: list[str], cwd: Path, key: str, timeout: int = 3600) -> str:
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    environment = _environment(key)
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                            encoding="utf-8", errors="replace", timeout=timeout,
                            creationflags=creationflags, env=environment)
    output = (result.stdout + "\n" + result.stderr).strip()
    _update(key, detail=output[-1200:])
    if result.returncode:
        raise RuntimeError(f"{' '.join(args[:3])} failed ({result.returncode}): {output[-1200:]}")
    return output


def _download_source(target: Path, key: str) -> Path:
    _update(key, step="Downloading Ming inference source", progress=5)
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "Horde-Studio-TTS/1"})
    with urllib.request.urlopen(request, timeout=90) as response:
        expected = int(response.headers.get("Content-Length", "0"))
        data = io.BytesIO()
        while True:
            block = response.read(1024 * 1024)
            if not block:
                break
            data.write(block)
            _update(key, downloaded_bytes=data.tell(), download_bytes=expected)
    target.mkdir(parents=True, exist_ok=True)
    source = target / "source"
    source.mkdir(exist_ok=True)
    with zipfile.ZipFile(data) as archive:
        members = archive.infolist()
        root = members[0].filename.split("/")[0] + "/"
        for member in members:
            if member.is_dir():
                continue
            relative = Path(member.filename.removeprefix(root))
            if not relative.parts or ".." in relative.parts or relative.is_absolute():
                raise RuntimeError("Unsafe source archive path")
            destination = (source / relative).resolve()
            if not destination.is_relative_to(source.resolve()):
                raise RuntimeError("Source archive escapes installation directory")
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as original, destination.open("wb") as output:
                shutil.copyfileobj(original, output)
    if not (source / "infer.py").is_file() or not (source / "requirements.txt").is_file():
        raise RuntimeError("Ming source archive is incomplete")
    return source


def _install_ming(model: str, key: str) -> None:
    target = _target("ming", model)
    if (target / "installed.json").exists():
        raise RuntimeError("This Ming model is already installed; existing files were not overwritten")
    source = target / "source"
    if not (source / "infer.py").is_file() or not (source / "requirements.txt").is_file():
        source = _download_source(target, key)
    _update(key, step="Creating isolated Python environment", progress=15)
    if not _python(target).is_file():
        _run([sys.executable, "-m", "venv", str(target / "venv")], APP, key)
    python = str(_python(target))
    _update(key, step="Installing model dependencies", progress=25)
    imports = ("import torch, torchaudio, transformers, huggingface_hub, "
               "onnxruntime, fla, triton" if model == "tiny" else
               "import torch, torchaudio, transformers, huggingface_hub, onnxruntime, diffusers")
    dependencies_ready = subprocess.run([python, "-c", imports],
                                        cwd=source, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).returncode == 0
    if not dependencies_ready:
        if os.name == "nt":
            if model == "tiny":
                _update(key, step="Installing isolated Tiny CUDA runtime", progress=25)
                _run([python, "-m", "pip", "install", "torch==2.7.1+cu118",
                      "torchaudio==2.7.1+cu118", "--index-url",
                      "https://download.pytorch.org/whl/cu118"], source, key)
                _update(key, step="Installing Windows Triton 3.3.1", progress=32)
                _run([python, "-m", "pip", "install", "triton-windows==3.3.1.post21"],
                     source, key)
                requirements = target / "requirements-tiny-windows.txt"
                lines = (source / "requirements-tiny.txt").read_text(encoding="utf-8").splitlines()
                filtered = [line for line in lines if not line.strip().startswith((
                    "triton==", "torch==", "torchaudio=="))]
                requirements.write_text("\n".join(filtered) + "\n", encoding="utf-8")
                _run([python, "-m", "pip", "install", "-r", str(requirements)], source, key)
            else:
                _run([python, "-m", "pip", "install", "torch==2.6.0", "torchaudio==2.6.0",
                      "--index-url", "https://download.pytorch.org/whl/cu124"], source, key)
                _run([python, "-m", "pip", "install", "-r", "requirements.txt"], source, key)
        else:
            _run([python, "-m", "pip", "install", "-r",
                  "requirements-tiny.txt" if model == "tiny" else "requirements.txt"], source, key)
    _update(key, step="Downloading model weights", progress=55,
            downloaded_bytes=0, download_bytes=0)
    model_dir = target / "model"
    script = ("from huggingface_hub import snapshot_download; "
              f"snapshot_download({MODELS[model]!r}, local_dir={str(model_dir)!r})")
    for attempt in range(3):
        stop_monitor = threading.Event()
        def monitor_weights():
            expected = 30 if model == "tiny" else 1
            pattern = "model-*-of-*.safetensors" if model == "tiny" else "model.safetensors"
            while not stop_monitor.wait(3):
                files = list(model_dir.glob(pattern))
                downloaded = sum(path.stat().st_size for path in files if path.is_file())
                _update(key, step=f"Downloading model weights ({len(files)}/{expected} files)",
                        progress=55 + min(24, int(24 * len(files) / expected)),
                        downloaded_bytes=downloaded, download_bytes=0)
        monitor = threading.Thread(target=monitor_weights, daemon=True)
        monitor.start()
        try:
            _run([python, "-c", script], source, key, timeout=7200)
            break
        except (RuntimeError, subprocess.TimeoutExpired):
            if attempt == 2:
                raise
            _update(key, step=f"Retrying model download ({attempt + 2}/3)")
            time.sleep(2 * (attempt + 1))
        finally:
            stop_monitor.set()
            monitor.join(timeout=1)
    _update(key, step="Checking checkpoint and tokenizer", progress=80)
    preflight = "preflight_tiny.py" if model == "tiny" else "preflight.py"
    _run([python, str(source / "tools" / preflight), "--model_path", str(model_dir)], source, key)
    _update(key, step="Generating a short test recording", progress=90)
    output = target / "install-test.wav"
    if model == "tiny":
        command = [python, str(source / "infer_tiny.py"), "--model_path", str(model_dir),
                   "--task", "voice_design", "--text", "Hello from Horde Studio.",
                   "--style", "A clear, calm voice.", "--output_path", str(output)]
    else:
        command = [python, str(source / "infer.py"), "--model_path", str(model_dir),
                   "--task", "VOICE_DESIGN", "--text", "Hello from Horde Studio.",
                   "--style", "A clear, calm voice.", "--use_zero_spk_emb",
                   "--no_text_normalization", "--output", str(output)]
    _run(command, source, key, timeout=900)
    if not output.is_file() or output.stat().st_size < 1000:
        raise RuntimeError("Ming did not produce a valid test recording")
    (target / "installed.json").write_text(json.dumps({"model": model, "time": time.time()}), encoding="utf-8")
    _update(key, state="installed", step="Installed and audio tested", progress=100)


def _install_kokoro(key: str) -> None:
    target = _target("kokoro")
    if (target / "installed.json").exists():
        raise RuntimeError("Managed Kokoro is already installed; existing files were not overwritten")
    target.mkdir(parents=True, exist_ok=True)
    _update(key, step="Creating isolated Kokoro environment", progress=10)
    _run([sys.executable, "-m", "venv", str(target / "venv")], APP, key)
    python = str(_python(target))
    _update(key, step="Installing Kokoro ONNX dependencies", progress=25)
    _run([python, "-m", "pip", "install", "kokoro-onnx", "onnxruntime", "numpy", "soundfile"], APP, key)
    model_dir = target / "model"
    model_dir.mkdir(exist_ok=True)
    for index, (name, url) in enumerate(KOKORO_FILES.items()):
        destination = model_dir / name
        minimum = 100 * 1024 * 1024 if name.endswith(".onnx") else 10 * 1024 * 1024
        if destination.is_file() and destination.stat().st_size >= minimum:
            continue
        legacy = Path("N:/krokoro") / name if os.name == "nt" else APP.parent / "krokoro" / name
        if legacy.is_file() and legacy.stat().st_size >= minimum:
            _update(key, step=f"Reusing existing {name}", progress=45 + index * 20)
            shutil.copy2(legacy, destination)
            continue
        _update(key, step=f"Downloading {name}", progress=45 + index * 20)
        for attempt in range(3):
            try:
                request = urllib.request.Request(url, headers={"User-Agent": "Horde-Studio-TTS/1"})
                with urllib.request.urlopen(request, timeout=90) as response:
                    expected = int(response.headers.get("Content-Length", "0"))
                    temporary = model_dir / (name + ".part")
                    with temporary.open("wb") as output:
                        while True:
                            block = response.read(1024 * 1024)
                            if not block:
                                break
                            output.write(block)
                            _update(key, downloaded_bytes=output.tell(), download_bytes=expected)
                    if expected and temporary.stat().st_size != expected:
                        raise RuntimeError(f"Incomplete {name} download")
                    temporary.replace(destination)
                break
            except (OSError, RuntimeError):
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
    _update(key, step="Testing Kokoro audio", progress=90)
    output = target / "install-test.wav"
    _run([python, str(APP / "tts_kokoro_worker.py"), str(model_dir), "test", str(output)],
         APP, key, timeout=300)
    if not output.is_file() or output.stat().st_size < 1000:
        raise RuntimeError("Kokoro did not produce test audio")
    (target / "installed.json").write_text(json.dumps({"time": time.time()}), encoding="utf-8")
    _update(key, state="installed", step="Installed and audio tested", progress=100)


def install(provider: str, model: str = "0.5b") -> dict:
    target = _target(provider, model)
    key = provider if provider == "kokoro" else f"ming:{model}"
    with _lock:
        if _jobs.get(key, {}).get("state") == "installing":
            return dict(_jobs[key])
        _jobs[key] = {"state": "installing", "step": "Preparing", "progress": 0,
                      "downloaded_bytes": 0, "download_bytes": 0, "error": ""}
    def worker():
        try:
            if provider == "ming":
                _install_ming(model, key)
            else:
                _install_kokoro(key)
        except Exception as error:
            _update(key, state="error", step="Installation failed", error=str(error))
    threading.Thread(target=worker, daemon=True, name=f"tts-install-{key}").start()
    return status(provider, model)


def status(provider: str, model: str = "0.5b") -> dict:
    target = _target(provider, model)
    key = provider if provider == "kokoro" else f"ming:{model}"
    with _lock:
        job = dict(_jobs.get(key, {}))
    installed = ((target / "installed.json").is_file() and _python(target).is_file()
                 and (target / "install-test.wav").is_file()
                 and ((target / "model" / "kokoro-v1.0.onnx").is_file()
                      and (target / "model" / "voices-v1.0.bin").is_file()
                      if provider == "kokoro" else
                      (target / "model" / "config.json").is_file()
                      and (target / "source" / "infer.py").is_file()))
    state = job.get("state", "installed" if installed else "not_installed")
    if state == "installed" and not installed:
        state = "error"
        job["error"] = "Installation files are incomplete"
    return {"installed": installed, "state": state,
            "step": job.get("step", ""), "progress": job.get("progress", 0),
            "downloaded_bytes": job.get("downloaded_bytes", 0),
            "download_bytes": job.get("download_bytes", 0), "error": job.get("error", ""),
            "last_synthesis_seconds": _last_synthesis.get(key)}


def stop_speech() -> None:
    global _speech, _speech_world_key
    with _lock:
        process, _speech = _speech, None
        _speech_world_key = None
    if process and process.poll() is None:
        _terminate_worker(process)


def _terminate_worker(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def _world_audio_key(world_id: str) -> str:
    if not isinstance(world_id, str) or not world_id.strip() or len(world_id) > 256:
        raise ValueError("worldId must be a non-empty string of at most 256 characters")
    return hashlib.sha256(world_id.encode("utf-8")).hexdigest()


def purge_world_audio(world_id: str) -> int:
    """Remove only Ming WAVs generated for this world, across both models."""
    global _speech, _speech_world_key
    world_key = _world_audio_key(world_id)
    with _lock:
        _deleted_world_audio.add(world_key)
        process = _speech if _speech_world_key == world_key else None
        if process is not None:
            _speech = None
            _speech_world_key = None
    if process is not None:
        _terminate_worker(process)
    deleted = 0
    for model in MODELS:
        cache = _target("ming", model) / "audio-cache" / "worlds" / world_key
        if not cache.is_dir():
            continue
        resolved = cache.resolve()
        parent = (_target("ming", model) / "audio-cache" / "worlds").resolve()
        if resolved.parent != parent or not resolved.is_relative_to(ROOT.resolve()):
            raise RuntimeError("World audio cache path is outside the managed TTS directory")
        for path in cache.iterdir():
            if not path.is_file() or path.is_symlink() or path.suffix.lower() != ".wav":
                raise RuntimeError("World audio cache contains an unexpected file")
            path.unlink()
            deleted += 1
        cache.rmdir()
    return deleted


def uninstall(provider: str, model: str = "0.5b", stop_active: bool = True) -> dict:
    target = _target(provider, model)
    key = provider if provider == "kokoro" else f"ming:{model}"
    with _lock:
        if _jobs.get(key, {}).get("state") == "installing":
            raise RuntimeError("Wait until installation finishes before uninstalling")
    if stop_active:
        stop_speech()
    _update(key, state="uninstalling", step="Removing managed installation")
    if target.is_dir():
        resolved = target.resolve()
        if not resolved.is_relative_to(ROOT.resolve()) or resolved == ROOT.resolve():
            raise RuntimeError("Refusing to remove files outside Horde Studio's TTS directory")
        shutil.rmtree(resolved)
    temp = ROOT / "tmp" / key.replace(":", "-")
    if temp.is_dir() and temp.resolve().is_relative_to((ROOT / "tmp").resolve()):
        shutil.rmtree(temp)
    _update(key, state="not_installed", step="Uninstalled", progress=0)
    return status(provider, model)


def save_reference(encoded: str) -> str:
    if not isinstance(encoded, str) or len(encoded) > 12 * 1024 * 1024:
        raise ValueError("Reference WAV exceeds the 8 MB limit")
    raw = base64.b64decode(encoded, validate=True)
    if len(raw) > 8 * 1024 * 1024 or raw[:4] != b"RIFF" or raw[8:12] != b"WAVE":
        raise ValueError("A WAV recording of at most 8 MB is required")
    directory = ROOT / "references"
    directory.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.wav"
    (directory / name).write_bytes(raw)
    return name


def purge_references() -> int:
    directory = ROOT / "references"
    if not directory.is_dir():
        return 0
    count = 0
    for path in directory.glob("*.wav"):
        if path.is_file() and path.resolve().is_relative_to(directory.resolve()):
            path.unlink()
            count += 1
    return count


def kokoro_voices() -> dict:
    target = _target("kokoro")
    if not status("kokoro")["installed"]:
        raise RuntimeError("Managed Kokoro is not installed")
    output = _run([str(_python(target)), str(APP / "tts_kokoro_worker.py"),
                   str(target / "model"), "voices"], APP, "kokoro", timeout=60)
    return json.loads(output.splitlines()[-1])


def synthesize_kokoro(request: dict) -> bytes:
    global _speech
    target = _target("kokoro")
    if not status("kokoro")["installed"]:
        raise RuntimeError("Managed Kokoro is not installed")
    output = target / "preview.wav"
    command = [str(_python(target)), str(APP / "tts_kokoro_worker.py"),
               str(target / "model"), "synthesize", str(output)]
    with _lock:
        if _speech and _speech.poll() is None:
            raise RuntimeError("A TTS request is already running")
        _speech = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, encoding="utf-8",
                                   errors="replace", cwd=APP,
                                   env=_environment("kokoro"),
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        process = _speech
    try:
        stdout, stderr = process.communicate(json.dumps(request), timeout=180)
        if process.returncode or not output.is_file() or output.stat().st_size < 1000:
            raise RuntimeError((stderr or stdout)[-1200:] or "Kokoro returned no audio")
        return output.read_bytes()
    except subprocess.TimeoutExpired as error:
        _terminate_worker(process)
        raise RuntimeError("Kokoro synthesis timed out after 180 seconds") from error
    finally:
        output.unlink(missing_ok=True)
        with _lock:
            if _speech is process:
                _speech = None


def synthesize_ming(text: str, profile: dict, model: str = "0.5b",
                    world_id: str | None = None) -> bytes:
    global _speech, _speech_world_key
    target = _target("ming", model)
    if not status("ming", model)["installed"]:
        raise RuntimeError("The selected Ming model is not installed and audio tested")
    if not isinstance(text, str) or not text.strip() or len(text) > 1000:
        raise ValueError("Text must contain 1–1000 characters")
    if not isinstance(profile, dict):
        raise ValueError("Voice profile must be an object")
    mode = profile.get("mode", "design")
    source = target / "source"
    world_key = _world_audio_key(world_id) if world_id is not None else None
    cache = target / "audio-cache"
    if world_key is not None:
        cache = cache / "worlds" / world_key
    digest = hashlib.sha256(json.dumps({"text": text, "profile": profile, "model": model},
                                    sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    output = cache / f"{digest}.wav"
    with _lock:
        if world_key in _deleted_world_audio:
            raise RuntimeError("This world was deleted; its audio cannot be generated")
        cache.mkdir(parents=True, exist_ok=True)
        if output.is_file() and output.stat().st_size >= 1000:
            return output.read_bytes()
    command = [str(_python(target)), str(source / "infer.py" if model == "0.5b" else source / "infer_tiny.py"),
               "--model_path", str(target / "model"), "--text", text]
    if model == "0.5b":
        command += ["--no_text_normalization", "--output", str(output)]
        if mode == "design":
            command += ["--task", "VOICE_DESIGN", "--style", str(profile.get("description", "A clear voice"))[:500], "--use_zero_spk_emb"]
        elif mode == "reference":
            reference = ROOT / "references" / str(profile.get("referenceId", ""))
            if not reference.is_file() or not reference.resolve().is_relative_to((ROOT / "references").resolve()):
                raise ValueError("Reference recording is unavailable")
            command += ["--task", "TTS", "--prompt_wav_path", str(reference),
                        "--prompt_text", str(profile.get("referenceText", ""))[:500], "--use_spk_emb"]
        elif mode == "emotion":
            emotion = str(profile.get("emotion", "中性"))
            if emotion not in {"高兴", "悲伤", "愤怒", "恐惧", "厌恶", "惊讶", "中性"}:
                raise ValueError("Unsupported Ming emotion")
            command += ["--task", "EMOTION", "--emotion", emotion, "--use_zero_spk_emb"]
        elif mode == "builtin":
            command += ["--task", "IP", "--ip", str(profile.get("voice", "US_Emma"))[:80], "--use_zero_spk_emb"]
        else:
            raise ValueError("Unsupported Ming voice mode")
    else:
        command += ["--output_path", str(output)]
        if mode == "design":
            command += ["--task", "voice_design", "--style", str(profile.get("description", "A clear voice"))[:500]]
        elif mode == "emotion":
            emotion = str(profile.get("emotion", "中性"))
            if emotion not in {"高兴", "悲伤", "愤怒", "恐惧", "厌恶", "惊讶", "中性"}:
                raise ValueError("Unsupported Ming emotion")
            command += ["--task", "emotion", "--emotion", emotion]
        else:
            raise ValueError("This Tiny voice mode is not configured")
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    began = time.monotonic()
    with _lock:
        if world_key in _deleted_world_audio:
            raise RuntimeError("This world was deleted; its audio cannot be generated")
        if _speech and _speech.poll() is None:
            raise RuntimeError("Ming is already generating audio")
        _speech = subprocess.Popen(command, cwd=source, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, creationflags=creationflags,
                                   env=_environment(f"ming:{model}"))
        process = _speech
        _speech_world_key = world_key
    try:
        timeout = 900 if model == "tiny" else 180
        stdout, stderr = process.communicate(timeout=timeout)
        if process.returncode:
            raise RuntimeError((stderr or stdout).decode("utf-8", "replace")[-1200:]
                               or "Ming generation was interrupted or cancelled")
        if not output.is_file() or output.stat().st_size < 1000:
            raise RuntimeError("Ming returned no audio")
        _last_synthesis[f"ming:{model}"] = round(time.monotonic() - began, 2)
        stale = sorted(cache.glob("*.wav"), key=lambda path: path.stat().st_mtime, reverse=True)[256:]
        for old in stale:
            old.unlink(missing_ok=True)
        return output.read_bytes()
    except subprocess.TimeoutExpired as error:
        _terminate_worker(process)
        raise RuntimeError(f"Ming {model} synthesis timed out after {timeout} seconds") from error
    finally:
        with _lock:
            if _speech is process:
                _speech = None
                _speech_world_key = None
