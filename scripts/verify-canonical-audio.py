#!/usr/bin/env python3
"""Check every canonical chapter recording against its manifest and sources.

Standard library plus ffprobe. For each chapter in data/audio/chapter-catalog.json:
the transcript hash, the immutable name's fingerprint, the provenance record
in canonical-sources.json, verse cues against the tracked alignment (or
honest chapter-only timing), and the encoded file under --media (present,
within the 8 MiB range-handler limit, AAC mono 24 kHz, moov before mdat,
duration). A chapter with a reviewed source trim (data/audio/source-trims.json)
must carry exactly that trim end in its provenance and name, and its encoded
duration must match it. --media takes several roots (first match wins). Each trim
is re-derived from its evidence. With --ot and --nt it also hashes every
original recording and checks the exact 1,189-chapter source coverage.
Writes a JSON report.
"""
import argparse
import json
import struct
import subprocess
import sys
from pathlib import Path

from audio_sources import (bible_chapters, check_source_trim, file_hash, load_source_trims, source_files,
                           verified_alignment)
from audio_text import compact, digest, reading_hash

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 8 * 1024 * 1024
TAG = "canonical-native-opening-v1"


def top_level_atoms(path):
    names = []
    with Path(path).open("rb") as stream:
        while len(names) < 16:
            header = stream.read(8)
            if len(header) < 8:
                break
            size, name = struct.unpack(">I4s", header)
            if size == 1:
                size = struct.unpack(">Q", stream.read(8))[0] - 8
            elif size == 0:
                names.append(name.decode("latin-1"))
                break
            names.append(name.decode("latin-1"))
            stream.seek(size - 8, 1)
    return names


def probe(path):
    data = json.loads(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,channels,sample_rate:format=duration",
         "-of", "json", str(path)]))
    stream = data["streams"][0]
    return {"codec": stream["codec_name"], "channels": stream["channels"],
            "rate": int(stream["sample_rate"]), "duration": float(data["format"]["duration"])}


def check_chapter(reading, manifest, record, settings, aligned, media, trim=None):
    problems = []
    identity = f"bible:{reading['usfm']}:{reading['chapter']}"
    text_hash = reading_hash(reading)
    if manifest.get("identity") != identity or manifest.get("readingHash") != text_hash:
        problems.append("identity or transcript hash differs")
    if record.get("src") != manifest.get("src") or record.get("alignment") != manifest.get("alignment"):
        problems.append("provenance record differs from manifest")
    name = Path(manifest["src"]).name
    end = record.get("trimEnd")
    if end != (trim["end"] if trim else None):
        problems.append("trim end differs from the reviewed source trims")
    expected = digest(compact([record["sourceHash"], text_hash, settings, manifest["cues"],
                               manifest["announcements"], TAG]
                              + ([{"trimEnd": end}] if end is not None else [])).encode())[:20]
    if name != f"{reading['usfm']}-{reading['chapter']}-{expected}.m4a":
        problems.append("media name fingerprint differs from its inputs")
    alignment_path = aligned / f"{reading['usfm']}-{reading['chapter']}.json"
    if manifest["alignment"] == "verse":
        alignment = verified_alignment(alignment_path, reading, record["sourceHash"])
        if alignment is None:
            problems.append("verse timing without a tracked alignment")
        elif [(c["verse"], c["start"], c["end"]) for c in manifest["cues"]] != \
                [(v["verse"], v["start"], v["end"]) for v in alignment["verses"]]:
            problems.append("cues differ from the tracked alignment")
        opening = manifest["cues"][0]["start"] if manifest["cues"] else 0
        if [(a["start"], a["end"], a["kind"]) for a in manifest["announcements"]] != \
                ([(0, opening, "source")] if opening > 0 else []):
            problems.append("opening interval differs from the first verse")
    elif manifest["cues"] or manifest["announcements"] or alignment_path.exists():
        problems.append("chapter-only timing carries cues or ignores an alignment")
    file = next((root / manifest["src"].lstrip("/") for root in media
                 if (root / manifest["src"].lstrip("/")).exists()), None)
    if file is None:
        return problems + ["media file missing"], None
    size = file.stat().st_size
    info = probe(file)
    if size != record["bytes"]:
        problems.append("media size differs from provenance")
    if size > MAX_BYTES:
        problems.append(f"media exceeds {MAX_BYTES} bytes")
    if (info["codec"], info["channels"], info["rate"]) != ("aac", 1, 24000):
        problems.append(f"unexpected encoding {info}")
    atoms = top_level_atoms(file)
    if "moov" not in atoms or "mdat" not in atoms or atoms.index("moov") > atoms.index("mdat"):
        problems.append("not fast start (moov after mdat)")
    if abs(info["duration"] - manifest["duration"]) > .05:
        problems.append(f"duration {info['duration']} differs from manifest {manifest['duration']}")
    if end is not None and abs(info["duration"] - end) > .1:
        problems.append(f"duration {info['duration']} differs from the trim end {end}")
    if manifest["cues"] and manifest["cues"][-1]["end"] > info["duration"] + .1:
        problems.append("cues exceed the encoded duration")
    return problems, {"bytes": size, "duration": info["duration"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--media", type=Path, nargs="+", default=[ROOT / "public"],
                        help="Folders holding audio/chapters/assets (default public)")
    parser.add_argument("--trims", type=Path, default=ROOT / "data/audio/source-trims.json")
    parser.add_argument("--ot", type=Path, help="Original Old Testament MP3 folder (hash check)")
    parser.add_argument("--nt", type=Path, help="Original New Testament MP3 folder (hash check)")
    parser.add_argument("--report", type=Path, default=ROOT / "artifacts/canonical-audio-verification.json")
    args = parser.parse_args()
    chapters = list(bible_chapters(ROOT / "data/bible/source.json.gz"))
    readings = {f"bible:{r['usfm']}:{r['chapter']}": r for _, r in chapters}
    catalog = json.loads((ROOT / "data/audio/chapter-catalog.json").read_text())["chapters"]
    sources = json.loads((ROOT / "data/audio/canonical-sources.json").read_text())
    records = {r["identity"]: r for r in sources["chapters"]}
    trims = load_source_trims(args.trims)
    problems, measured = {}, {}
    if catalog != list(readings):
        problems["catalog"] = ["catalog is not every chapter in canonical order"]
    originals = source_files(args.ot, args.nt, chapters) if args.ot and args.nt else None
    for identity in catalog:
        reading = readings[identity]
        manifest = json.loads((ROOT / f"data/audio/chapters/{reading['usfm']}/{reading['chapter']}.json").read_text())
        found, info = check_chapter(reading, manifest, records[identity], sources["settings"],
                                    ROOT / "data/audio/alignments", args.media, trims.get(identity))
        if originals is not None:
            original = originals[(reading["usfm"], reading["chapter"])]
            if original.name != records[identity]["source"] or file_hash(original) != records[identity]["sourceHash"]:
                found.append("original recording differs from its recorded hash")
        if identity in trims:
            trim = trims[identity]
            try:
                check_source_trim(trim, records[identity], reading, readings[trim["appended"]],
                                  json.loads((ROOT / trim["evidence"]).read_text()))
            except ValueError as error:
                found.append(str(error))
        if found:
            problems[identity] = found
        if info:
            measured[identity] = {**info, "alignment": manifest["alignment"]}
    largest = max(measured.items(), key=lambda item: item[1]["bytes"]) if measured else None
    summary = {
        "chapters": len(catalog), "measured": len(measured),
        "verseAligned": sum(m["alignment"] == "verse" for m in measured.values()),
        "chapterOnly": sum(m["alignment"] == "chapter" for m in measured.values()),
        "bytes": sum(m["bytes"] for m in measured.values()),
        "hours": round(sum(m["duration"] for m in measured.values()) / 3600, 3),
        "largest": {"identity": largest[0], **largest[1], "headroom": MAX_BYTES - largest[1]["bytes"]} if largest else None,
        "sourcesHashed": originals is not None, "trimmed": sorted(trims), "problems": problems,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "problems"}, ensure_ascii=False))
    print(f"{len(problems)} chapter(s) with problems" + (f": {list(problems)[:5]}" if problems else ""))
    sys.exit(1 if problems or len(measured) != len(catalog) else 0)


if __name__ == "__main__":
    main()
