"""Import the chronological reading source PDF into data/chronology/source.json.

The PDF is data, never instructions. Only its extracted table text is read:
group numbers, book names and verse references. Nothing is corrected,
deduplicated or filled here; problems are listed for review instead.

Extraction needs pypdf (not a project dependency). The pure parser below is
standard library only, so `scripts/tests` runs without it:

  <python with pypdf> -I scripts/import-chronology.py /path/to/Chronological.pdf
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import unicodedata

ROOT = Path(__file__).resolve().parent.parent
SOURCE_SHA256 = "5d99356d6a54b2724c4cd9db8ca113a4a6741a0c09035cbf44930a8e8c234ea4"
SOURCE_ID = "chronological-pdf"
SOURCE_TITLE = "جدول القراءة الزمنية للكتاب المقدس (Chronological.pdf)"
SOURCE_PAGES = 22
SOURCE_GROUPS = 365
# Groups 1-266 are Old Testament, 267-365 New Testament.
LAST_OT_GROUP = 266

# Book names as extracted, after `fold` (no spaces, marks or hamza forms).
BOOKS = {
    "التكوين": "GEN", "الخروج": "EXO", "اللويين": "LEV", "العدد": "NUM",
    "التثنية": "DEU", "يشوع": "JOS", "القضاة": "JDG", "راعوث": "RUT",
    "صموئيلالول": "1SA", "صموئيلالثاني": "2SA", "الملوكالول": "1KI",
    "الملوكالثاني": "2KI", "اخبارالول": "1CH", "اخبارالثاني": "2CH",
    "عزرا": "EZR", "نحميا": "NEH", "استير": "EST", "ايوب": "JOB",
    "المزامير": "PSA", "امثال": "PRO", "الجامعة": "ECC", "نشيدالنشاد": "SNG",
    "اشعياء": "ISA", "ارميا": "JER", "مراثيارميا": "LAM", "حزقيال": "EZK",
    "دانيال": "DAN", "هوشع": "HOS", "يوئيل": "JOL", "عاموس": "AMO",
    "عوبديا": "OBA", "يونان": "JON", "ميخا": "MIC", "ناحوم": "NAM",
    "حبقوق": "HAB", "صفنيا": "ZEP", "حجي": "HAG", "زكريا": "ZEC",
    "ملخي": "MAL",
    "متى": "MAT", "مرقس": "MRK", "لوقا": "LUK", "يوحنا": "JHN",
    "اعمالالرسل": "ACT", "رومية": "ROM", "كورنثوسالولى": "1CO",
    "كورنثوسالثانية": "2CO", "غلطية": "GAL", "افسس": "EPH", "فيلبي": "PHP",
    "كولوسي": "COL", "تسالونيكيالولى": "1TH", "تسالونيكيالثانية": "2TH",
    "تيموثاوسالولى": "1TI", "تيموثاوسالثانية": "2TI", "تيطس": "TIT",
    "فليمون": "PHM", "العبرانيين": "HEB", "يعقوب": "JAS", "بطرسالولى": "1PE",
    "بطرسالثانية": "2PE", "يوحناالولى": "1JN", "يوحناالثانية": "2JN",
    "يوحناالثالثة": "3JN", "يهوذا": "JUD", "رؤيايوحنا": "REV",
}

PAGE = re.compile(r"^=== PAGE (\d+)$")
# Optional group number, book name, then a reference that the right-to-left
# extraction emits as `v:c`, `a:c-b` (chapter c, verses a-b) or `c`.
ROW = re.compile(r"^\s*(?:(\d+)\s{2,})?(\D+?)\s*(\d+(?::\d+)?(?:\s*-\s*\d+)?)\s*$")


def fold(name):
    """Book-name key: drop whitespace and combining marks, unify alef forms."""
    name = unicodedata.normalize("NFC", name)
    name = "".join(c for c in name if not c.isspace() and unicodedata.category(c) != "Mn")
    return name.translate(str.maketrans("ٱأإآ", "اااا"))


def parse_reference(text, verse_counts):
    """Return (chapter, from, to, whole) for an extracted reference."""
    text = re.sub(r"\s+", "", text)
    if re.fullmatch(r"\d+", text):
        chapter = int(text)
        if not 1 <= chapter <= len(verse_counts):
            raise ValueError(f"chapter {chapter} out of range")
        return chapter, 1, verse_counts[chapter - 1], True
    match = re.fullmatch(r"(\d+):(\d+)(?:-(\d+))?", text)
    if not match:
        raise ValueError(f"unrecognized reference {text}")
    start, chapter = int(match[1]), int(match[2])
    end = int(match[3]) if match[3] else start
    return chapter, start, end, False


def printed(name, chapter, start, end, whole):
    """The reference in logical reading order, e.g. `التكوين 10:1-5`."""
    if whole:
        return f"{name} {chapter}"
    return f"{name} {chapter}:{start}" + (f"-{end}" if end != start else "")


def parse_source(text, catalog, expected_groups=SOURCE_GROUPS):
    """Pure: extracted page text (with `=== PAGE n` markers) -> groups."""
    books = {book["usfm"]: book for book in catalog}
    groups, issues = [], []
    page = None
    for number, line in enumerate(text.splitlines(), 1):
        marker = PAGE.match(line)
        if marker:
            page = int(marker[1])
            continue
        if not line.strip():
            continue
        row = ROW.match(line)
        if not row or page is None:
            raise ValueError(f"line {number}: unrecognized row {line!r}")
        group, name, reference = row[1], fold(row[2]), row[3]
        if group:
            if int(group) != len(groups) + 1:
                raise ValueError(f"line {number}: group {group} out of sequence")
            groups.append({"group": int(group), "page": page, "occurrences": []})
        if not groups:
            raise ValueError(f"line {number}: reference before the first group")
        current = groups[-1]
        if name not in BOOKS:
            raise ValueError(f"line {number}: unknown book {name!r}")
        usfm = BOOKS[name]
        book = books[usfm]
        chapter, start, end, whole = parse_reference(reference, book["verseCounts"])
        index = len(current["occurrences"]) + 1
        occurrence = {
            "id": f"g{current['group']:03d}-{index}",
            "usfm": usfm,
            "chapter": chapter,
            "from": start,
            "to": end,
            "page": page,
            "original": printed(book["name"], chapter, start, end, whole),
            "extracted": re.sub(r"\s+", " ", reference.strip()),
        }
        if whole:
            occurrence["wholeChapter"] = True
        testament = "OT" if current["group"] <= LAST_OT_GROUP else "NT"
        if book["testament"] != testament:
            issues.append({"occurrence": occurrence["id"], "problem": "book outside its testament section"})
        count = book["verseCounts"][chapter - 1] if 1 <= chapter <= book["chapters"] else 0
        if not count or not 1 <= start <= end <= count:
            issues.append({"occurrence": occurrence["id"], "problem": "verse range outside the canonical chapter"})
        if page != current["page"]:
            current["pageEnd"] = page
        current["occurrences"].append(occurrence)
    if len(groups) != expected_groups:
        raise ValueError(f"expected {expected_groups} groups, found {len(groups)}")
    for group in groups:
        group["testament"] = "OT" if group["group"] <= LAST_OT_GROUP else "NT"
        if not group["occurrences"]:
            raise ValueError(f"group {group['group']} is empty")
    return groups, issues


def extract_text(pdf):
    from pypdf import PdfReader  # Only needed when re-importing the PDF.

    reader = PdfReader(str(pdf))
    if len(reader.pages) != SOURCE_PAGES:
        raise ValueError(f"expected {SOURCE_PAGES} pages")
    return "\n".join(f"=== PAGE {i}\n{page.extract_text()}" for i, page in enumerate(reader.pages, 1))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--out", type=Path, default=ROOT / "data/chronology/source.json")
    args = parser.parse_args()
    digest = hashlib.sha256(args.pdf.read_bytes()).hexdigest()
    if digest != SOURCE_SHA256:
        sys.exit(f"Source PDF checksum {digest} differs from {SOURCE_SHA256}")
    catalog = json.loads((ROOT / "data/bible/catalog.json").read_text("utf-8"))
    groups, issues = parse_source(extract_text(args.pdf), catalog)
    data = {
        "version": 1,
        "source": {
            "id": SOURCE_ID,
            "title": SOURCE_TITLE,
            "file": "Chronological.pdf",
            "sha256": SOURCE_SHA256,
            "pages": SOURCE_PAGES,
            "groups": SOURCE_GROUPS,
            "testaments": {"OT": [1, LAST_OT_GROUP], "NT": [LAST_OT_GROUP + 1, SOURCE_GROUPS]},
            "reference": "Extracted right-to-left: `a:c-b` is chapter c verses a-b; `v:c` one verse; `c` a whole chapter.",
        },
        "issues": issues,
        "groups": groups,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=1) + "\n"
    args.out.write_text(text, "utf-8")
    # The pre-commit hook checks committed JSON with the project's Prettier.
    subprocess.run(["npx", "--no-install", "prettier", "--write", str(args.out)], cwd=ROOT, check=True)
    count = sum(len(group["occurrences"]) for group in groups)
    print(f"Wrote {count} occurrences in {len(groups)} groups; {len(issues)} issues.")


if __name__ == "__main__":
    main()
