"""Import the chronological plan and public-domain eBible Van Dyck USFM archive."""

import argparse
import json
from pathlib import Path
import re
import sys
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from chronos_tools.books import load_books, new_testament  # noqa: E402
from chronos_tools.paths import ROOT  # noqa: E402
from chronos_tools.usfm import SUBSCRIPTION, clean  # noqa: E402

# The plan's New Testament book names, as in data/books.json.
BOOKS = [(book.name, book.usfm) for book in new_testament(load_books())]
ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def parse_book(text: str) -> dict:
    chapters = {}
    chapter = None
    heading = ""
    pending_heading = False
    verse = None
    for line in text.splitlines():
        if line.startswith("\\c "):
            chapter = int(line.split()[1])
            chapters[chapter] = {}
            verse = None
        elif line.startswith("\\s1 "):
            heading = line[4:].strip()
            pending_heading = True
        elif line.startswith("\\v "):
            match = re.match(r"\\v (\d+)\s+(.*)", line)
            if not match or chapter is None:
                raise ValueError(f"Invalid USFM verse: {line}")
            number = int(match[1])
            value = clean(match[2])
            verse = {"number": number, "text": value}
            if pending_heading:
                verse["heading"] = heading
            chapters[chapter][number] = verse
            pending_heading = False
        elif verse is not None and not SUBSCRIPTION.match(line):
            # A verse can continue on later paragraph or poetry lines (\p, \q1, …).
            value = clean(line)
            if value:
                verse["text"] = f"{verse['text']} {value}".strip()
    return chapters


def read_books(source: Path) -> dict:
    books = {}
    with zipfile.ZipFile(source) as archive:
        for name, code in BOOKS:
            matches = [
                path for path in archive.namelist()
                if re.search("-" + code + r"arb-vd.usfm$", path)
            ]
            if len(matches) != 1:
                raise ValueError(f"Expected one USFM source for {code}")
            text = archive.read(matches[0]).decode("utf-8-sig")
            books[name] = {"code": code, "chapters": parse_book(text)}
    return books


def make_passage(raw: str, books: dict) -> dict:
    reference = raw.replace("\u200e", "").translate(ARABIC_DIGITS)
    match = re.match(r"(.+?)\s+(\d+)(?:-(\d+))?(?::(\d+))?$", reference)
    if not match:
        raise ValueError(f"Invalid reading reference: {reference}")
    name, first, second, explicit_chapter = match.groups()
    chapter = int(explicit_chapter or first)
    verses = books[name]["chapters"][chapter]
    if explicit_chapter:
        # The source document displays verse-range endpoints in reversed RTL order.
        start, end = int(second or first), int(first)
    else:
        if second:
            raise ValueError(f"Unexpected chapter range: {reference}")
        start, end = 1, max(verses)
    if not 1 <= start <= end <= max(verses):
        raise ValueError(f"Out-of-range reading reference: {reference}")
    return {
        "book": name,
        "chapter": chapter,
        "start": start,
        "end": end,
        "verses": [verses[number] for number in range(start, end + 1)],
    }


def build_plan(rows: list, books: dict) -> list:
    plan = []
    for row in rows:
        if not row[0][0].isdigit():
            continue
        passages = [make_passage(raw, books) for raw in row[1]]
        plan.append({
            "day": int(row[0][0]),
            "passages": passages,
            "verseCount": sum(len(passage["verses"]) for passage in passages),
        })
    return plan


def validate_plan(plan: list, books: dict) -> None:
    if [day["day"] for day in plan] != list(range(1, 151)):
        raise ValueError("The plan must contain days 1–150 in order")
    expected = {
        (name, chapter, verse)
        for name, book in books.items()
        for chapter, verses in book["chapters"].items()
        for verse in verses
    }
    actual = [
        (passage["book"], passage["chapter"], verse["number"])
        for day in plan
        for passage in day["passages"]
        for verse in passage["verses"]
    ]
    missing = expected - set(actual)
    if missing:
        raise ValueError(f"The plan omits Scripture verses: {sorted(missing)}")
    passages = sum(len(day["passages"]) for day in plan)
    print(
        f"Validated {len(plan)} days, {passages} passages, "
        f"{len(actual)} verse occurrences, {len(expected)} unique verses. "
        f"Repeated verses: {len(actual) - len(set(actual))}."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, nargs="?", default=Path("/tmp/arb-vd.zip"))
    args = parser.parse_args()
    books = read_books(args.source)
    rows = json.loads((ROOT / "data/source-plan.json").read_text(encoding="utf-8"))
    plan = build_plan(rows, books)
    validate_plan(plan, books)
    (ROOT / "data/plan.json").write_text(
        json.dumps(plan, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
