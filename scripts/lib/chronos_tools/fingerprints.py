"""Hash and fingerprint formats shared by the audio tools.

`compact` is the exact JSON the client also hashes (tests/fixtures/transcript.json
pins both languages). A media fingerprint is the first 20 hex digits of the
SHA-256 of the compact JSON of the inputs that make a recording immutable.
"""

import hashlib
import json
from pathlib import Path

FINGERPRINT_LENGTH = 20


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fingerprint(parts):
    """Immutable-name fingerprint of `parts` (anything `compact` accepts)."""
    return digest(compact(parts).encode())[:FINGERPRINT_LENGTH]


def file_hash(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()
