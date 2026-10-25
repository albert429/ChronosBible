#!/usr/bin/env python3
"""Machine review of verse alignments before any of them is used.

For each `<USFM>-<n>.json` in the given alignment folders: the original
recording's SHA-256 must equal the canonical provenance (canonical-sources.json),
the transcript hash must equal the current Bible text, verses must be complete,
ordered and inside the recording. Each verse is then flagged when its model
score is below --min-score, or its speech rate (Arabic letters per second) is
far outside the whole set's own distribution (median +/- --rate-mads MADs),
which catches verses squeezed into or stretched over the wrong audio. Long
openings/trailers are reported per chapter; a reviewed source trim
(data/audio/source-trims.json) ends the recording for both checks.

This is not listening review: an unflagged verse is not proof of accuracy.
Flags only decide what an automated build may not rely on (clip boundaries).

With --import DIR, alignments whose hashes match are copied there unchanged
(resume-safe: identical files are left alone), and --summary writes the
compact flag list that scripts/build-reading-audio.py consults, with the
SHA-256 of every alignment file it reviewed so the builder can refuse an
alignment the summary does not describe. Standard library only.
"""
import argparse
import hashlib
import json
import re
import shutil
import statistics
import sys
import unicodedata
from pathlib import Path

from audio_sources import alignment_problems, bible_chapters, load_source_trims

ROOT = Path(__file__).resolve().parents[1]
OPENING_LIMIT = 60.0
TRAILER_LIMIT = 90.0


def letters(text):
    """Arabic base letters only: no diacritics, punctuation or digits."""
    return sum(1 for ch in text if unicodedata.category(ch) == "Lo")


def load_alignments(folders):
    found = {}
    for folder in folders:
        for path in sorted(Path(folder).glob("*.json")):
            if re.fullmatch(r"[A-Z0-9]{3}-[1-9]\d{0,2}", path.stem):
                found[path.stem] = path
    return found


def review(paths, readings, provenance, min_score, rate_mads, trims=None):
    """(per-chapter results, rate bounds). Pure apart from reading files."""
    trims = trims or {}
    chapters, rates = {}, []
    for key, path in sorted(paths.items()):
        raw = path.read_bytes()
        data = json.loads(raw)
        code, chapter = data.get("book"), data.get("chapter")
        identity = f"bible:{code}:{chapter}"
        reading = readings.get(identity)
        if key != f"{code}-{chapter}" or reading is None:
            chapters[key] = {"status": "rejected", "problems": ["unknown or misnamed chapter"]}
            continue
        verses = reading["passages"][0]["verses"]
        end = trims[identity]["end"] if identity in trims else None
        problems = alignment_problems(data, reading, provenance.get(identity), end)
        aligned = data.get("verses", [])
        duration = min(data.get("duration", 0), end if end is not None else float("inf"))
        if problems:
            chapters[key] = {"status": "rejected", "problems": problems}
            continue
        text = {v["number"]: v["text"] for v in verses}
        rows = []
        for verse in aligned:
            rate = letters(text[verse["verse"]]) / (verse["end"] - verse["start"])
            rows.append({**verse, "rate": rate})
            rates.append(rate)
        chapters[key] = {"status": "ok", "rows": rows, "duration": duration, "path": str(path),
                         "sha256": hashlib.sha256(raw).hexdigest()}
    if not rates:
        return chapters, (0, 0)
    median = statistics.median(rates)
    mad = statistics.median(abs(r - median) for r in rates) or 1e-9
    low, high = median - rate_mads * mad, median + rate_mads * mad
    for key, result in chapters.items():
        if result["status"] != "ok":
            continue
        rows, flags = result.pop("rows"), {}
        for row in rows:
            reasons = []
            if row["score"] < min_score:
                reasons.append("low-score")
            if not low <= row["rate"] <= high:
                reasons.append("implausible-rate")
            if reasons:
                flags[row["verse"]] = reasons
        notes = []
        if rows[0]["start"] > OPENING_LIMIT:
            notes.append(f"opening {rows[0]['start']:.1f}s")
        if result["duration"] - rows[-1]["end"] > TRAILER_LIMIT:
            notes.append(f"trailer {result['duration'] - rows[-1]['end']:.1f}s")
        result.update({
            "status": "flagged" if flags or notes else "pass",
            "verses": len(rows),
            "minScore": min(r["score"] for r in rows),
            "flags": {str(k): v for k, v in flags.items()},
            "notes": notes,
        })
    return chapters, (low, high)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("alignments", type=Path, nargs="+", help="Folders of <USFM>-<n>.json alignments")
    parser.add_argument("--bible", type=Path, default=ROOT / "data/bible/source.json.gz")
    parser.add_argument("--provenance", type=Path, default=ROOT / "data/audio/canonical-sources.json")
    parser.add_argument("--trims", type=Path, default=ROOT / "data/audio/source-trims.json")
    parser.add_argument("--min-score", type=float, default=0.30)
    parser.add_argument("--rate-mads", type=float, default=6.0)
    parser.add_argument("--report", type=Path, default=ROOT / "artifacts/audio-work/alignment-review.json")
    parser.add_argument("--summary", type=Path, help="Write the compact flag list (e.g. data/audio/review/ot.json)")
    parser.add_argument("--import", dest="import_to", type=Path, help="Copy hash-matching alignments here")
    parser.add_argument("--expect", type=int, help="Fail unless exactly this many alignments are present")
    args = parser.parse_args(argv)
    readings = {f"bible:{r['usfm']}:{r['chapter']}": r for _, r in bible_chapters(args.bible)}
    provenance = {r["identity"]: r for r in json.loads(args.provenance.read_text())["chapters"]}
    paths = load_alignments(args.alignments)
    if args.expect is not None and len(paths) != args.expect:
        parser.error(f"expected {args.expect} alignments, found {len(paths)}")
    chapters, (low, high) = review(paths, readings, provenance, args.min_score, args.rate_mads,
                                   load_source_trims(args.trims))
    counts = {status: sum(r["status"] == status for r in chapters.values()) for status in ("pass", "flagged", "rejected")}
    flagged_verses = sum(len(r.get("flags", {})) for r in chapters.values())
    total_verses = sum(r.get("verses", 0) for r in chapters.values())
    summary = {
        "version": 1,
        "method": "machine review only (hashes, bounds, score, speech rate); not listening review",
        "thresholds": {"minScore": args.min_score, "rateLettersPerSecond": [round(low, 2), round(high, 2)],
                       "openingSeconds": OPENING_LIMIT, "trailerSeconds": TRAILER_LIMIT},
        "chapters": counts, "verses": total_verses, "flaggedVerses": flagged_verses,
        "flags": {k: {"flags": r.get("flags", {}), "notes": r.get("notes", []), "minScore": r.get("minScore")}
                  for k, r in sorted(chapters.items()) if r["status"] == "flagged"},
        "rejected": {k: r["problems"] for k, r in sorted(chapters.items()) if r["status"] == "rejected"},
        "reviewed": {k: r["sha256"] for k, r in sorted(chapters.items()) if r["status"] != "rejected"},
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps({**summary, "detail": chapters}, ensure_ascii=False, indent=1) + "\n")
    if args.summary:
        args.summary.parent.mkdir(parents=True, exist_ok=True)
        args.summary.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    if args.import_to:
        args.import_to.mkdir(parents=True, exist_ok=True)
        for key, result in chapters.items():
            if result["status"] == "rejected":
                continue
            target = args.import_to / f"{key}.json"
            source = paths[key]
            if not target.exists() or target.read_bytes() != source.read_bytes():
                shutil.copyfile(source, target)
    print(json.dumps({k: summary[k] for k in ("chapters", "verses", "flaggedVerses", "thresholds")}, ensure_ascii=False))
    return 1 if counts["rejected"] else 0


if __name__ == "__main__":
    sys.exit(main())
