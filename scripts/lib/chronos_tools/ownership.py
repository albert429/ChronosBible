"""Inventory-owned generated output.

A generator that writes many files into a tracked folder records what it wrote
in an inventory (`{"v": 1, "files": {path: sha256}}`) inside that folder. The
next run may delete a file only if the inventory names it, it is no longer
generated and it is byte-for-byte what was recorded. Everything is validated
before anything is written, and unsafe paths, symlinks, unreadable inventories
and hand-modified owned files stop the run. Unknown files are never touched and
folders are never removed. This mirrors publishStudyPayloads in
scripts/build-study-canonical.js.
"""

import hashlib
import json
import os
import re
from pathlib import Path

INVENTORY_NAME = "inventory.json"
SHA256 = re.compile(r"^[a-f0-9]{64}$")


class OwnershipError(Exception):
    """The folder cannot be updated safely; nothing has been changed."""


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _checked(base: Path, path: str, pattern: re.Pattern) -> Path:
    if not pattern.fullmatch(path):
        raise OwnershipError(f"unsafe generated path: {path!r}")
    current = base
    for part in path.split("/"):
        current = current / part
        if current.is_symlink():
            raise OwnershipError(f"generated output cannot contain symlinks: {path}")
    return current


def read_inventory(base: Path, pattern: re.Pattern, name: str = INVENTORY_NAME) -> dict:
    """{path: sha256} recorded by the last run, or {} when there is none."""
    inventory = base / name
    if inventory.is_symlink():
        raise OwnershipError("inventory cannot be a symlink")
    if not inventory.exists():
        return {}
    try:
        value = json.loads(inventory.read_text(encoding="utf-8"))
    except ValueError as error:
        raise OwnershipError(f"invalid inventory: {error}") from error
    files = value.get("files") if isinstance(value, dict) else None
    if not isinstance(value, dict) or value.get("v") != 1 or not isinstance(files, dict):
        raise OwnershipError("invalid inventory")
    for path, checksum in files.items():
        if not pattern.fullmatch(path) or not isinstance(checksum, str) or not SHA256.match(checksum):
            raise OwnershipError(f"invalid inventory entry: {path!r}")
    return files


def _write_atomic(target: Path, body: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(target.name + ".tmp")
    temp.write_bytes(body)
    os.replace(temp, target)


def _write_inventory(base: Path, files: dict, name: str = INVENTORY_NAME) -> None:
    body = json.dumps({"v": 1, "files": dict(sorted(files.items()))}, indent=2) + "\n"
    _write_atomic(base / name, body.encode())


def publish_owned(base: Path, outputs: dict, pattern: re.Pattern, *, prune: bool = True) -> dict:
    """Write `outputs` ({relative path: bytes}) under `base`; return a summary.

    With `prune`, previously recorded files that are no longer generated are
    deleted if unmodified. Without it (a partial or pilot run) they are kept and
    stay recorded. Raises OwnershipError, before changing anything, otherwise.
    """
    base = Path(base)
    if base.is_symlink():
        raise OwnershipError("generated output folder cannot be a symlink")
    for path in outputs:
        target = _checked(base, path, pattern)
        if target.exists() and not target.is_file():
            raise OwnershipError(f"generated path is not a file: {path}")
    old = read_inventory(base, pattern)
    obsolete = []
    kept = {}
    for path, checksum in old.items():
        if path in outputs:
            continue
        if not prune:
            kept[path] = checksum
            continue
        target = _checked(base, path, pattern)
        if not target.exists():
            continue
        if not target.is_file() or _digest(target.read_bytes()) != checksum:
            raise OwnershipError(f"obsolete output was modified; refusing removal: {path}")
        obsolete.append(target)
    for target in obsolete:
        target.unlink()
    for path, body in outputs.items():
        _write_atomic(base / path, body)
    _write_inventory(base, {**kept, **{p: _digest(b) for p, b in outputs.items()}})
    return {"written": len(outputs), "removed": len(obsolete), "kept": len(kept)}


def adopt_existing(base: Path, pattern: re.Pattern) -> int:
    """Record every matching file now in `base` as owned (one-time adoption).

    Use only when the folder's current files are known to be generator output,
    such as a clean checkout of the committed tree.
    """
    base = Path(base)
    if base.is_symlink():
        raise OwnershipError("generated output folder cannot be a symlink")
    files = {}
    for target in sorted(base.rglob("*")):
        path = target.relative_to(base).as_posix()
        if not pattern.fullmatch(path):
            continue
        _checked(base, path, pattern)
        if not target.is_file():
            raise OwnershipError(f"generated path is not a file: {path}")
        files[path] = _digest(target.read_bytes())
    _write_inventory(base, files)
    return len(files)
