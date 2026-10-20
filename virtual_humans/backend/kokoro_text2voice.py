"""Deterministic, rule-based voice descriptions for the local Kokoro model.

The catalogue mirrors voices-v1.0.bin. Automatic English profiles use the
English voices; the other voices remain available for explicit formulas.
"""

from __future__ import annotations

import re

VOICE_CATALOG = (
    "af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica", "af_kore",
    "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky", "am_adam",
    "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx",
    "am_puck", "am_santa", "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
    "bm_daniel", "bm_fable", "bm_george", "bm_lewis", "ef_dora", "em_alex",
    "em_santa", "ff_siwis", "hf_alpha", "hf_beta", "hm_omega", "hm_psi",
    "if_sara", "im_nicola", "jf_alpha", "jf_gongitsune", "jf_nezumi",
    "jf_tebukuro", "jm_kumo", "pf_dora", "pm_alex", "pm_santa",
    "zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi", "zm_yunjian",
    "zm_yunxi", "zm_yunxia", "zm_yunyang",
)

ENGLISH_VOICES = tuple(voice for voice in VOICE_CATALOG if voice[0] in "ab")
TAG_MAP = {
    "female": [voice for voice in VOICE_CATALOG if voice[1] == "f"],
    "male": [voice for voice in VOICE_CATALOG if voice[1] == "m"],
    "american": [voice for voice in VOICE_CATALOG if voice[0] == "a"],
    "british": [voice for voice in VOICE_CATALOG if voice[0] == "b"],
    "spanish": [voice for voice in VOICE_CATALOG if voice[0] == "e"],
    "french": [voice for voice in VOICE_CATALOG if voice[0] == "f"],
    "hindi": [voice for voice in VOICE_CATALOG if voice[0] == "h"],
    "italian": [voice for voice in VOICE_CATALOG if voice[0] == "i"],
    "japanese": [voice for voice in VOICE_CATALOG if voice[0] == "j"],
    "portuguese": [voice for voice in VOICE_CATALOG if voice[0] == "p"],
    "chinese": [voice for voice in VOICE_CATALOG if voice[0] == "z"],
    "young": ["af_sky", "af_nova", "am_puck", "bf_lily", "bm_lewis"],
    "adult": ["af_heart", "af_sarah", "am_adam", "am_michael", "bm_george"],
    "mature": ["am_michael", "am_onyx", "bm_george", "bm_daniel", "bf_isabella"],
    "warm": ["af_heart", "af_sarah", "am_adam", "bm_lewis", "bf_emma"],
    "cold": ["af_nicole", "af_kore", "am_onyx", "bf_isabella"],
    "clear": ["af_nicole", "af_alloy", "am_eric", "bm_daniel"],
    "raspy": ["bm_george", "am_michael", "am_onyx", "bm_fable"],
    "scratchy": ["bm_george", "am_michael", "bm_fable"],
    "smoky": ["bm_george", "am_michael", "am_onyx", "bf_isabella"],
    "tired": ["bm_george", "am_michael", "bf_lily"],
    "whisper": ["am_onyx", "bf_isabella", "af_nicole"],
    "gentle": ["af_sarah", "af_heart", "am_liam", "bf_isabella"],
    "soft": ["af_sarah", "bf_isabella", "am_liam", "bm_lewis"],
    "breathy": ["bf_isabella", "af_sarah", "af_nova"],
    "flattering": ["af_heart", "bf_emma", "am_adam", "bm_lewis"],
    "powerful": ["af_kore", "am_fenrir", "am_michael", "bm_george"],
    "happy": ["af_sky", "af_nova", "am_puck", "bm_lewis"],
    "barkeeper": ["bm_george", "am_michael", "bm_lewis"],
    "elf": ["af_kore", "af_aoede", "am_liam", "bm_fable"],
    "orc": ["am_fenrir", "am_onyx", "bm_george", "bm_daniel"],
    "child": ["af_sky", "af_nova", "am_puck", "bf_lily"],
    "drunk": ["bm_george", "am_michael", "bf_emma"],
}
ALIASES = {
    "weiblich": "female", "frau": "female", "männlich": "male", "mann": "male",
    "masculine": "male", "feminine": "female", "rauchig": "smoky", "rauchige": "smoky",
    "rauchiger": "smoky", "smokey": "smoky", "kratzig": "scratchy",
    "kratzige": "scratchy", "müde": "tired", "muede": "tired", "gehaucht": "whisper",
    "geflüstert": "whisper", "whispered": "whisper", "ork": "orc", "orcs": "orc",
    "kind": "child", "kinderstimme": "child", "betrunken": "drunk", "betrunkene": "drunk",
    "britisch": "british", "amerikanisch": "american", "tief": "deep", "hoch": "high",
    "langsam": "slow", "schnell": "fast", "ruhig": "calm", "warm": "warm",
    "weich": "soft", "sanft": "gentle", "heiser": "raspy", "alt": "mature",
    "old": "mature", "jung": "young", "erwachsen": "adult", "barkeeperin": "barkeeper",
    "bartender": "barkeeper", "elfe": "elf", "elfin": "elf", "spanisch": "spanish",
    "französisch": "french", "japanisch": "japanese", "italienisch": "italian",
    "portugiesisch": "portuguese", "chinesisch": "chinese",
}
PROSODY_TAGS = {"deep", "high", "slow", "fast", "calm", "energetic"}
EFFECT_TAGS = {"smoky", "tired", "whisper", "scratchy", "drunk"}
KNOWN_TAGS = set(TAG_MAP) | PROSODY_TAGS | EFFECT_TAGS


def normalize_tag(value: str) -> str:
    raw = str(value).strip().lower()
    return ALIASES.get(raw, raw)


def _tags(values: list[str]) -> list[str]:
    words = [normalize_tag(word) for value in values
             for word in re.findall(r"[\w-]+", str(value).lower())]
    return list(dict.fromkeys(words))[:20]


def tags_to_formula(tags: list[str]) -> dict:
    if not isinstance(tags, list):
        raise ValueError("tags must be an array")
    cleaned = _tags(tags)
    gender = next((tag for tag in reversed(cleaned) if tag in {"male", "female"}), None)
    language_tags = {"spanish": "e", "french": "f", "hindi": "h", "italian": "i",
                     "japanese": "j", "portuguese": "p", "chinese": "z"}
    language = next((language_tags[tag] for tag in cleaned if tag in language_tags), None)
    allowed = [voice for voice in VOICE_CATALOG
               if (voice[0] == language if language else voice in ENGLISH_VOICES)
               and (not gender or voice[1] == ("m" if gender == "male" else "f"))]
    if not allowed:
        raise ValueError("No voices match the requested language and gender")
    scores = {voice: 0 for voice in allowed}
    for tag in cleaned:
        if tag in {"male", "female", "adult", "american", "british"}:
            # These are broad filters; style traits decide the ranking.
            continue
        for voice in TAG_MAP.get(tag, ()):
            if voice in scores:
                scores[voice] += 1
    if "british" in cleaned:
        for voice in scores:
            if voice.startswith("b"):
                scores[voice] += 1
    elif "american" in cleaned:
        for voice in scores:
            if voice.startswith("a"):
                scores[voice] += 1
    if not any(scores.values()):
        preferred = "bm_george" if gender == "male" and "british" in cleaned else (
            "am_adam" if gender == "male" else "af_heart")
        scores[preferred if preferred in scores else allowed[0]] = 1
    ranked = sorted(scores, key=lambda voice: (-scores[voice], VOICE_CATALOG.index(voice)))
    selected = [voice for voice in ranked if scores[voice] > 0][:3]
    if len(selected) == 1:
        alternate = next((voice for voice in ranked if voice != selected[0]), None)
        if alternate:
            selected.append(alternate)
            scores[alternate] = 0.5
    # A recognizable barkeeper blend is a documented rule, not an LLM guess.
    if {"barkeeper", "male", "british"}.issubset(cleaned) and {"smoky", "scratchy"} & set(cleaned):
        parts = [["bm_george", 50], ["am_michael", 30], ["bm_lewis", 20]]
    else:
        total = sum(scores[voice] for voice in selected)
        weights = [round(scores[voice] / total * 100) for voice in selected]
        weights[-1] = 100 - sum(weights[:-1])
        parts = [[voice, weight] for voice, weight in zip(selected, weights) if weight > 0]
    pitch = (-3 if "deep" in cleaned else 0) + (3 if "high" in cleaned else 0)
    speed = 0.88 if {"slow", "calm"} & set(cleaned) else (1.15 if "fast" in cleaned else 1.0)
    effects = {key: strength for key, strength in {
        "smoky": 0.8 if "smoky" in cleaned else 0,
        "tired": 0.6 if "tired" in cleaned else 0,
        "whisper": 0.65 if "whisper" in cleaned else 0,
        "scratchy": 0.55 if "scratchy" in cleaned else 0,
        "drunk": 0.45 if "drunk" in cleaned else 0,
    }.items() if strength}
    return {"formula": ",".join(f"{voice}:{weight}" for voice, weight in parts),
            "parts": parts, "tags": cleaned, "speed": speed, "pitch": pitch,
            "prosody": {"speed": speed, "pitch": pitch}, "effects": effects,
            "unmapped": [tag for tag in cleaned if tag not in KNOWN_TAGS]}


def parse_free_text_with_rules(text: str) -> dict:
    if not isinstance(text, str) or not text.strip() or len(text) > 2000:
        raise ValueError("text must be 1–2000 characters")
    words = re.findall(r"[\w-]+", text.lower())
    tags = []
    for word in words:
        tag = normalize_tag(word)
        if tag in KNOWN_TAGS and tag not in tags:
            tags.append(tag)
    if any(35 <= int(word) <= 59 for word in words if word.isdecimal()):
        if "adult" not in tags:
            tags.append("adult")
    return tags_to_formula(tags)
