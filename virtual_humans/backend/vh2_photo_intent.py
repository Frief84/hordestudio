"""Small, conservative grammar for explicit in-character photo requests."""
import re

# A modal verb alone is not a request for an image ("could you send the address").
_REQUEST = re.compile(r"\b(?:send|take|make|snap|show|share|give)\s+(?:me\s+|us\s+)?(?:a|another|one|your|some)?\s*(?:(?:[a-z-]+,?\s+){0,8})?(?:photo|picture|pic|selfie|image)s?\b(?!\s+(?:frame|album|book|settings|editor|tutorial|instructions)\b)|\bshow\s+me\s+what\s+you(?:'re| are)\s+wearing\b|\b(?:can|could)\s+i\s+see\s+your\s+(?:outfit|look)\b", re.I)
_NEGATED = re.compile(r"\b(?:don['’]?t|do\s+not|never)\s+(?:please\s+)?(?:send|take|make|snap|show|share|give)\b|\b(?:no|without|not)\s+(?:another\s+|a\s+|any\s+)?(?:photo|picture|pic|selfie|image)s?\b|\b(?:talk|talking|chat|discussion|question|wonder|curious)\s+about\b", re.I)
_DISCUSSION = re.compile(r"\b(?:do|does|did)\s+you\s+(?:ever\s+)?(?:take|send|make|like|enjoy)\s+(?:a\s+|any\s+|some\s+)?(?:photo|photos|picture|pictures|selfie|selfies|image|images)\b|\b(?:i|we|they)\s+(?:like|discussed|mentioned|talked about)\s+(?:photo|photos|picture|pictures|selfie|selfies|image|images)\b", re.I)
_ANGLE = re.compile(r"\b(?:another|different)\s+angle\b|^\s*(?:please\s+)?(?:show|send)\s+me\s+more[.!? ]*$", re.I)

def classify(text, has_photo_context=False):
    """Return explicit, none, or ambiguous; never triggers on a noun alone."""
    value=str(text or '').strip()
    if not value or _NEGATED.search(value):return 'none'
    if _DISCUSSION.search(value):return 'none'
    if re.search(r"\b(?:explain|tutorial|instructions|how to)\b.{0,80}\b(?:photo|picture|selfie|image)s?\b",value,re.I):return 'none'
    if re.fullmatch(r"(?:can|could)\s+you\s+(?:take|send|make|generate)\s+(?:photos|pictures|selfies|images)[?!. ]*",value,re.I):return 'none'
    if _REQUEST.search(value):return 'explicit'
    if has_photo_context and re.fullmatch(r"(?:can|could)\s+i\s+see\s+you[?!. ]*", value, re.I):return 'explicit'
    if has_photo_context and _ANGLE.search(value):return 'explicit'
    if _ANGLE.search(value) or re.search(r"\b(?:photo|picture|pic|selfie|image)s?\b",value,re.I):return 'ambiguous'
    return 'none'

def scene_hint(text):
    """Use the player's own short request as scene context, without chat history."""
    value=re.sub(r"\s+"," ",str(text or '')).strip()
    value=re.sub(r"^(?:please\s+)?(?:can|could|would)\s+(?:you\s+)?",'',value,flags=re.I)
    value=re.sub(r"^(?:please\s+)?",'',value,flags=re.I)
    value=value[:600].strip()
    return value or 'A casual front-camera selfie at the recorded location.'


def capture_type(scene, suggested=None):
    """Written framing outranks a model's generic selfie choice."""
    value=str(scene or '')
    if re.search(r"\bmirror\b", value, re.I):return 'mirror_selfie'
    if re.search(r"\b(?:wide|full[- ]body|candid|from a distance|head to toe)\b", value, re.I):return 'personal_photograph'
    if re.search(r"\bselfie\b", value, re.I):return 'front_camera_selfie'
    return suggested if suggested in ('front_camera_selfie','mirror_selfie','personal_photograph') else 'personal_photograph'
