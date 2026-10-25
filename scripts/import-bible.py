"""Normalize the pinned public-domain Van Dyck USFM into an offline build source.

Standard library only. Does not modify the chronological plan. Run with Python -I.
"""

import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from usfm import clean  # noqa: E402
ARCHIVE_SHA256 = "21097759376591c9d1c4b07440e36cd870e44ec5f44e4a84b215b35f17c7b150"
IDENTIFICATION = re.compile(r"^(?:id|ide|h|toc\d|mt\d?|cl|rem|sts)$")
PARAGRAPH = re.compile(r"^(?:p|m|pi\d?|pc|nb|b|li\d?)$")
POETRY = re.compile(r"^(?:q\d?|qc|qm\d?)$")
HEADING = re.compile(r"^(?:s\d?|ms\d?|mr|sr|r)$")
LINE = re.compile(r"^\\([a-z0-9]+)(?:\s+(.*))?$")


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def parse_book(text):
    """Keep block order and within-verse paragraph boundaries without rewriting words."""
    chapters = []
    chapter = None
    current = None
    pending = []

    def anchor(verse, offset=0):
        if pending:
            if chapter is None:
                raise ValueError("Structure before the first chapter")
            for block in pending:
                chapter["structure"].append({**block, "verse": verse, "offset": offset})
            pending.clear()

    def finish():
        if chapter is None:
            return
        if not chapter["verses"]:
            raise ValueError("Empty chapter")
        anchor(current["number"], len(current["text"]))
        if [v["number"] for v in chapter["verses"]] != list(range(1, len(chapter["verses"]) + 1)):
            raise ValueError("Non-contiguous verse numbering")

    for line in text.lstrip("\ufeff").splitlines():
        if not line.strip():
            continue
        match = LINE.fullmatch(line.rstrip())
        if not match:
            # Plain continuation lines belong to the current numbered verse.
            if line.startswith("\\") or current is None:
                raise ValueError(f"Unsupported USFM line: {line[:100]}")
            value = clean(line)
            if value:
                current["text"] += " " + value
            continue
        marker, payload = match[1], (match[2] or "").strip()
        if IDENTIFICATION.fullmatch(marker):
            continue
        if marker == "c":
            finish()
            number = int(payload)
            if number != len(chapters) + 1:
                raise ValueError("Non-contiguous chapter numbering")
            chapter = {"chapter": number, "verses": [], "structure": []}
            chapters.append(chapter)
            current = None
        elif marker == "v":
            verse = re.fullmatch(r"(\d+)\s+(.*)", payload)
            if verse is None or chapter is None:
                raise ValueError(f"Invalid verse: {payload[:100]}")
            number = int(verse[1])
            anchor(number)
            current = {"number": number, "text": clean(verse[2])}
            if not current["text"]:
                raise ValueError("Empty verse")
            chapter["verses"].append(current)
        elif HEADING.fullmatch(marker) or marker in ("d", "qa"):
            kind = "superscription" if marker == "d" else "acrostic" if marker == "qa" else "heading"
            if not payload:
                raise ValueError(f"Empty {marker}")
            pending.append({"kind": kind, "marker": marker, "text": clean(payload)})
        elif PARAGRAPH.fullmatch(marker) or POETRY.fullmatch(marker):
            block = {"kind": "poetry" if POETRY.fullmatch(marker) else "paragraph", "marker": marker}
            value = clean(payload)
            if value and current is not None and not (value.startswith("-") and value.endswith("-")):
                # A paragraph can start halfway through a numbered verse. Its text
                # stays in that verse and its boundary retains the exact offset.
                offset = len(current["text"]) + 1
                pending.append(block)
                anchor(current["number"], offset)
                current["text"] += " " + value
            else:
                if value:
                    # Unnumbered chapter introductions and epistle subscriptions
                    # remain visible source metadata, outside numbered Scripture.
                    block["text"] = value
                pending.append(block)
        else:
            raise ValueError(f"Unsupported USFM marker: {marker}")
    finish()
    return chapters


def validate_plan(source, plan):
    names = {book["name"]: book for book in source["books"]}
    unique = set()
    for day in plan:
        for passage in day["passages"]:
            book = names[passage["book"]]
            chapter = book["chapters"][passage["chapter"] - 1]
            for verse in passage["verses"]:
                expected = chapter["verses"][verse["number"] - 1]["text"]
                if expected != verse["text"]:
                    raise ValueError(f"Plan text differs: {book['usfm']}.{chapter['chapter']}.{verse['number']}")
                unique.add((book["usfm"], chapter["chapter"], verse["number"]))
    if len(unique) != 7959:
        raise ValueError(f"Expected 7959 unique plan verses, found {len(unique)}")


def import_bible(archive_path, root=ROOT, out=None):
    raw = Path(archive_path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != ARCHIVE_SHA256:
        raise ValueError("Archive SHA-256 differs from the reviewed source")
    books = json.loads((root / "data/books.json").read_text(encoding="utf-8"))
    source = {"version": 1, "books": []}
    with zipfile.ZipFile(archive_path) as archive:
        for index, (usfm, _, _, name) in enumerate(books):
            matches = [path for path in archive.namelist() if path.endswith(f"-{usfm}arb-vd.usfm")]
            if len(matches) != 1:
                raise ValueError(f"Missing or duplicate USFM book {usfm}")
            chapters = parse_book(archive.read(matches[0]).decode("utf-8-sig"))
            source["books"].append({"usfm": usfm, "name": name, "testament": "OT" if index < 39 else "NT", "chapters": chapters})
    chapter_count = sum(len(book["chapters"]) for book in source["books"])
    verse_count = sum(len(chapter["verses"]) for book in source["books"] for chapter in book["chapters"])
    nt_count = sum(len(chapter["verses"]) for book in source["books"][39:] for chapter in book["chapters"])
    if (len(source["books"]), chapter_count, verse_count, nt_count) != (66, 1189, 31104, 7959):
        raise ValueError("Full Bible coverage differs from the reviewed source")
    validate_plan(source, json.loads((root / "data/plan.json").read_text(encoding="utf-8")))
    catalog = [{"usfm": book["usfm"], "name": book["name"], "testament": book["testament"], "chapters": len(book["chapters"]), "verseCounts": [len(c["verses"]) for c in book["chapters"]]} for book in source["books"]]
    normalized = encoded(source)
    compressed = gzip.compress(normalized, compresslevel=9, mtime=0)
    # Pin the gzip OS byte too: Python versions differ in their mtime=0 implementation.
    compressed = compressed[:9] + bytes([255]) + compressed[10:]
    catalog_bytes = encoded(catalog)
    kinds = Counter(block["kind"] for book in source["books"] for chapter in book["chapters"] for block in chapter["structure"])
    provenance = {
        "version": 1, "sourceUrl": "https://ebible.org/Scriptures/arb-vd_usfm.zip",
        "detailsUrl": "https://ebible.org/bible/details.php?id=arb-vd", "license": "Public domain",
        "archiveSha256": ARCHIVE_SHA256,
        "sourceSha256": hashlib.sha256(normalized).hexdigest(),
        "gzipSha256": hashlib.sha256(compressed).hexdigest(),
        "catalogSha256": hashlib.sha256(catalog_bytes).hexdigest(),
        "books": 66, "chapters": chapter_count, "verses": verse_count, "ntVerses": nt_count,
        "structure": dict(sorted(kinds.items())),
    }
    destination = Path(out) if out else root / "data/bible"
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "source.json.gz").write_bytes(compressed)
    (destination / "catalog.json").write_bytes(catalog_bytes)
    (destination / "provenance.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return provenance


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    print(json.dumps(import_bible(args.archive, out=args.out), indent=2))
