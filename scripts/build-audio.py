#!/usr/bin/env python3
"""Assemble exact daily passages from reviewed chapter alignment JSON.

Requires ffmpeg/ffprobe, but no Python ML dependencies. Sources stay in the
user's folder; generated audio stays out of Git. Re-run after timing corrections.

With --announcements CATALOG, a reviewed spoken reference (a WAV clip per
passage, see docs/audio.md) is placed before every passage of a day. Scripture
PCM comes from the original chapter recordings and is never level-adjusted;
only the reference clips are matched to the day's Scripture loudness. Every
part is laid out in whole samples at 24 kHz, so verse cues and reference
intervals are exact sample offsets, and the day is encoded once to AAC.
Announced builds write version-2 manifests outside data/ by default and never
touch the published catalog.
"""
import argparse
from array import array
import io
import json
from operator import mul
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

from audio_references import reference_id
from audio_text import chapter_text_hash, chapter_verses, compact, digest, reading_hash

ROOT = Path(__file__).resolve().parents[1]
RATE = 24000
SETTINGS = {"codec": "aac", "bitrate": "48k", "rate": RATE, "channels": 1}
SEPARATION = (0.2, 0.35)
# Active-speech RMS: 50 ms frames above -45 dBFS; the clip gain keeps peaks
# at or below 0.89 of full scale. Scripture samples are never scaled.
LOUDNESS = {"method": "active-rms-match", "frame": 0.05, "floorDbfs": -45, "peak": 0.89}


def chapter_alignment(aligned, code, passage, chapter_hashes, day_number):
    path = aligned / f"{code}-{passage['chapter']}.json"
    if not path.exists():
        raise ValueError(f"Day {day_number}: missing alignment {path.name}")
    chapter = json.loads(path.read_text())
    if chapter["textHash"] != chapter_hashes[(passage["book"], passage["chapter"])]:
        raise ValueError(f"Transcript changed: realign {path.name} before rebuilding")
    return path, chapter


def passage_span(chapter, passage, label):
    """Seconds of one passage in its chapter recording, on the output sample grid."""
    verses = chapter["verses"]
    selected = [v for v in verses if passage["start"] <= v["verse"] <= passage["end"]]
    if [v["verse"] for v in selected] != [v["number"] for v in passage["verses"]]:
        raise ValueError(f"Incomplete verse coverage: {label}")
    # Keep short breaths at the edges, without including adjacent speech.
    previous = next((v for v in verses if v["verse"] == passage["start"] - 1), None)
    following = next((v for v in verses if v["verse"] == passage["end"] + 1), None)
    begin = max(selected[0]["start"] - .12, previous["end"] if previous else 0)
    end = min(selected[-1]["end"] + .20, following["start"] if following else chapter["duration"])
    if end <= begin or any(v["end"] <= v["start"] for v in selected):
        raise ValueError(f"Invalid timestamps: {label}")
    # Quantize to the output sample grid so concatenation never drifts.
    return round(begin * RATE) / RATE, round(end * RATE) / RATE, selected


def assemble(day, books, chapter_hashes, source, aligned, output):
    day_hash = reading_hash(day)
    clips, cues, offset = [], [], 0
    for index, passage in enumerate(day["passages"]):
        path, chapter = chapter_alignment(aligned, books[passage["book"]], passage, chapter_hashes, day["day"])
        file = source / chapter["file"]
        if digest(file.read_bytes()) != chapter["audioHash"]:
            raise ValueError(f"Source changed: {file.name}")
        begin, end, selected = passage_span(chapter, passage, f"day {day['day']}, passage {index}")
        clips.append({"file": str(file), "start": begin, "end": end, "audioHash": chapter["audioHash"]})
        for verse in selected:
            cues.append({"passage": index, "verse": verse["verse"],
                         "start": round(offset + verse["start"] - begin, 3),
                         "end": round(offset + verse["end"] - begin, 3)})
        offset += end - begin
    portable_clips = [{**clip, "file": Path(clip["file"]).name} for clip in clips]
    identity = digest(compact([day_hash, portable_clips, cues, SETTINGS]).encode())[:20]
    name = f"{day['day']:03d}-{identity}.m4a"
    target = output / "days" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        with tempfile.TemporaryDirectory(prefix="bible-audio-") as tmp:
            pcm = Path(tmp) / "day.pcm"
            with pcm.open("wb") as dest:
                for clip in clips:
                    subprocess.run(["ffmpeg", "-v", "error", "-i", clip["file"],
                                    "-ss", str(clip["start"]), "-t", str(clip["end"]-clip["start"]),
                                    "-f", "s16le", "-ar", "24000", "-ac", "1", "pipe:1"], stdout=dest, check=True)
            temp = Path(tmp) / "day.m4a"
            subprocess.run(["ffmpeg", "-v", "error", "-f", "s16le", "-ar", "24000", "-ac", "1",
                            "-i", str(pcm), "-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart",
                            "-metadata", f"title=قراءة اليوم {day['day']}",
                            "-metadata", "artist=Faith Comes By Hearing / Hosanna",
                            "-metadata", "copyright=Audio ℗ 2008 Hosanna; text © 1996 Bible Society of Egypt",
                            str(temp)], check=True)
            target.write_bytes(temp.read_bytes())
    duration = probe_duration(target)
    for cue in cues:
        if cue["start"] < 0 or cue["end"] > duration + .1:
            raise ValueError(f"Cue exceeds encoded duration: day {day['day']}")
    return {"version": 1, "day": day["day"], "readingHash": day_hash,
            "src": f"/audio/days/{name}", "duration": duration, "cues": cues}


def probe_duration(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                          "-of", "default=noprint_wrappers=1:nokey=1", str(path)]))


# --- Spoken references -------------------------------------------------------

def read_wav(data, convert=None):
    """16-bit mono PCM at RATE. Other WAV formats need `convert` (ffmpeg)."""
    try:
        with wave.open(io.BytesIO(data)) as clip:
            params = clip.getparams()
            frames = clip.readframes(params.nframes)
    except (wave.Error, EOFError) as error:
        raise ValueError(f"Not a PCM WAV file: {error}") from error
    if (params.nchannels, params.sampwidth, params.framerate) != (1, 2, RATE):
        if convert is None:
            raise ValueError(f"Expected 16-bit mono {RATE} Hz WAV, got {params.nchannels} ch, "
                             f"{params.sampwidth * 8}-bit, {params.framerate} Hz")
        frames = convert(data)
    pcm = array("h")
    pcm.frombytes(frames)
    if sys.byteorder == "big":
        pcm.byteswap()
    return pcm


def ffmpeg_pcm(data):
    """Convert any audio file's bytes to 16-bit mono RATE PCM (for non-native WAVs)."""
    return subprocess.run(["ffmpeg", "-v", "error", "-i", "pipe:0", "-f", "s16le", "-ar", str(RATE),
                           "-ac", "1", "pipe:1"], input=data, stdout=subprocess.PIPE, check=True).stdout


def load_clips(catalog_path, references, draft=False, convert=None):
    """Validate a reviewed reference catalog against data/audio/reference-texts.json.

    Each clip must match its reference's exact text and hash, the catalog's
    generation settings, and its own WAV bytes. Unreviewed wording or clips
    are refused unless `draft` is set.
    """
    catalog = json.loads(Path(catalog_path).read_text(encoding="utf-8"))
    if catalog.get("version") != 1 or not isinstance(catalog.get("clips"), dict):
        raise ValueError("Unsupported reference catalog; expected version 1 with clips")
    settings = catalog.get("settings")
    if not isinstance(settings, dict) or not settings:
        raise ValueError("The reference catalog must record its generation settings")
    settings_hash = digest(compact(settings).encode())
    folder = Path(catalog_path).parent
    clips = {}
    for clip_id, clip in catalog["clips"].items():
        reference = references.get(clip_id)
        if reference is None:
            raise ValueError(f"{clip_id}: not a plan passage reference")
        text = clip.get("text")
        if text != reference["text"] or clip.get("textHash") != digest(text.encode()) \
                or clip.get("textHash") != reference["textHash"]:
            raise ValueError(f"{clip_id}: text differs from the reference wording")
        if clip.get("settingsHash") != settings_hash:
            raise ValueError(f"{clip_id}: settings hash differs from the catalog settings")
        if not draft and not reference.get("reviewed"):
            raise ValueError(f"{clip_id}: reference wording is not reviewed (use --draft for a private pilot)")
        if not draft and clip.get("reviewed") is not True:
            raise ValueError(f"{clip_id}: clip is not reviewed (use --draft for a private pilot)")
        name = clip.get("file")
        if not isinstance(name, str) or Path(name).name != name or not name.endswith(".wav"):
            raise ValueError(f"{clip_id}: clip file must be a .wav name beside the catalog")
        data = (folder / name).read_bytes()
        if digest(data) != clip.get("audioHash"):
            raise ValueError(f"{clip_id}: audio hash differs from {name}")
        pcm = read_wav(data, convert)
        clips[clip_id] = {"id": clip_id, "pcm": pcm, "samples": len(pcm), "text": text,
                          "textHash": clip["textHash"], "audioHash": clip["audioHash"],
                          "settingsHash": settings_hash, "reviewed": clip.get("reviewed") is True}
    return clips


def active_rms(pcm):
    """RMS over 50 ms frames above the floor; None when nothing is active."""
    size = round(LOUDNESS["frame"] * RATE)
    floor = 32768 * 10 ** (LOUDNESS["floorDbfs"] / 20)
    energy, count = 0, 0
    for start in range(0, len(pcm) - size + 1, size):
        frame = pcm[start:start + size]
        power = sum(map(mul, frame, frame))
        if power / size >= floor * floor:
            energy += power
            count += size
    return (energy / count) ** .5 if count else None


def match_loudness(pcm, target):
    """Scale a reference clip to the target active RMS within the peak limit."""
    level = active_rms(pcm)
    if not level:
        raise ValueError("Reference clip has no audible speech")
    peak = max(map(abs, pcm))
    gain = min(target / level, LOUDNESS["peak"] * 32767 / peak)
    scaled = array("h", (max(-32768, min(32767, round(sample * gain))) for sample in pcm))
    return scaled, gain


def layout_day(day, books, alignments, clips, separation=.25):
    """Pure integer-sample layout of one announced day.

    `alignments` maps (code, chapter) to chapter alignment JSON and `clips` maps
    reference IDs to {"samples": n}. Each passage contributes, in order: a
    separation (except at the very start), its reference, a separation, then
    its Scripture span. A reference interval runs from the end of the previous
    Scripture to the first verse, so no verse is highlighted between passages.
    """
    if not SEPARATION[0] <= separation <= SEPARATION[1]:
        raise ValueError(f"Separation must be {SEPARATION[0]}–{SEPARATION[1]} s around each reference")
    gap = round(separation * RATE)
    segments, cues, announcements, position = [], [], [], 0
    seconds = lambda samples: round(samples / RATE, 3)
    for index, passage in enumerate(day["passages"]):
        code = books[passage["book"]]
        clip_id = reference_id(code, passage)
        if clip_id not in clips:
            raise ValueError(f"Day {day['day']}: no spoken reference {clip_id}")
        chapter = alignments[(code, passage["chapter"])]
        begin, end, selected = passage_span(chapter, passage, f"day {day['day']}, passage {index}")
        start = position
        if position:
            segments.append({"kind": "silence", "samples": gap})
            position += gap
        segments.append({"kind": "reference", "id": clip_id, "offset": position,
                         "samples": clips[clip_id]["samples"]})
        position += clips[clip_id]["samples"]
        segments.append({"kind": "silence", "samples": gap})
        position += gap
        first, last = round(begin * RATE), round(end * RATE)
        segments.append({"kind": "scripture", "passage": index, "file": chapter["file"],
                         "audioHash": chapter["audioHash"], "offset": position,
                         "begin": first, "end": last, "samples": last - first})
        for verse in selected:
            cues.append({"passage": index, "verse": verse["verse"],
                         "start": seconds(position + round(verse["start"] * RATE) - first),
                         "end": seconds(position + round(verse["end"] * RATE) - first)})
        first_cue = next(cue for cue in cues if cue["passage"] == index)
        announcements.append({"passage": index, "start": seconds(start), "end": first_cue["start"],
                              "reference": clips[clip_id].get("text", clip_id).rstrip(".").strip(),
                              "kind": "reference"})
        position += last - first
    return {"segments": segments, "cues": cues, "announcements": announcements, "samples": position}


def fit(pcm, samples):
    """Trim or zero-pad a decoded span to its exact sample count (the edges are breaths)."""
    if len(pcm) >= samples:
        return pcm[:samples]
    return pcm + array("h", bytes(2 * (samples - len(pcm))))


def decode_span(path, begin, samples):
    """Original chapter recording -> exact span of 16-bit mono RATE PCM."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ss", f"{begin / RATE:.6f}",
                          "-t", f"{samples / RATE:.6f}", "-f", "s16le", "-ar", str(RATE), "-ac", "1",
                          "pipe:1"], stdout=subprocess.PIPE, check=True).stdout
    pcm = array("h")
    pcm.frombytes(raw[:len(raw) // 2 * 2])
    if sys.byteorder == "big":
        pcm.byteswap()
    return fit(pcm, samples)


def render_day(layout, scripture, references):
    """Concatenate exact PCM: `scripture` by passage index, `references` by clip ID."""
    pcm = array("h")
    for segment in layout["segments"]:
        if segment["kind"] == "silence":
            part = array("h", bytes(2 * segment["samples"]))
        elif segment["kind"] == "reference":
            part = references[segment["id"]]
        else:
            part = scripture[segment["passage"]]
        if len(part) != segment["samples"]:
            raise ValueError(f"{segment['kind']} PCM has {len(part)} samples, layout expects {segment['samples']}")
        if segment["kind"] != "silence" and len(pcm) != segment["offset"]:
            raise ValueError("PCM offset differs from the layout")
        pcm.extend(part)
    if len(pcm) != layout["samples"]:
        raise ValueError("Day PCM length differs from the layout")
    return pcm


def announced_identity(day_hash, layout, clips, gains, separation):
    """Immutable media name: Scripture spans and hashes, every clip's text, voice
    settings and audio hashes, applied gains, separation, cues and encoding."""
    scripture = [{k: s[k] for k in ("file", "audioHash", "begin", "end")}
                 for s in layout["segments"] if s["kind"] == "scripture"]
    references = [{"id": s["id"], "textHash": clips[s["id"]]["textHash"], "audioHash": clips[s["id"]]["audioHash"],
                   "settingsHash": clips[s["id"]]["settingsHash"], "gain": round(gains[s["id"]], 6)}
                  for s in layout["segments"] if s["kind"] == "reference"]
    return digest(compact([day_hash, scripture, references, layout["cues"], layout["announcements"],
                           round(separation * RATE), LOUDNESS, SETTINGS, "plan-announced-v2"]).encode())[:20]


def encode_pcm(pcm, target, day_number, voice):
    with tempfile.TemporaryDirectory(prefix="bible-audio-") as tmp:
        raw = Path(tmp) / "day.pcm"
        data = array("h", pcm)
        if sys.byteorder == "big":
            data.byteswap()
        raw.write_bytes(data.tobytes())
        temp = Path(tmp) / "day.m4a"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "s16le", "-ar", str(RATE), "-ac", "1",
                        "-i", str(raw), "-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart",
                        "-metadata", f"title=قراءة اليوم {day_number}",
                        "-metadata", "artist=Faith Comes By Hearing / Hosanna",
                        "-metadata", "copyright=Audio ℗ 2008 Hosanna; text © 1996 Bible Society of Egypt",
                        "-metadata", f"comment=Spoken passage references: {voice}",
                        str(temp)], check=True)
        target.write_bytes(temp.read_bytes())


def assemble_announced(day, books, chapter_hashes, source, aligned, clips, output, separation=.25,
                       voice="", decode=decode_span, encode=encode_pcm, probe=probe_duration):
    """One day with a reviewed spoken reference before every passage (manifest v2)."""
    day_hash = reading_hash(day)
    alignments = {}
    for passage in day["passages"]:
        code = books[passage["book"]]
        _, chapter = chapter_alignment(aligned, code, passage, chapter_hashes, day["day"])
        alignments[(code, passage["chapter"])] = chapter
    layout = layout_day(day, books, alignments, clips, separation)
    scripture, checked = {}, {}
    for segment in layout["segments"]:
        if segment["kind"] != "scripture":
            continue
        file = Path(source) / segment["file"]
        if file not in checked:
            checked[file] = digest(file.read_bytes())
        if checked[file] != segment["audioHash"]:
            raise ValueError(f"Source changed: {file.name}")
        scripture[segment["passage"]] = decode(file, segment["begin"], segment["samples"])
    day_scripture = array("h")
    for index in sorted(scripture):
        day_scripture.extend(scripture[index])
    target_level = active_rms(day_scripture)
    if not target_level:
        raise ValueError(f"Day {day['day']}: Scripture audio is silent")
    references, gains = {}, {}
    for segment in layout["segments"]:
        if segment["kind"] == "reference" and segment["id"] not in references:
            references[segment["id"]], gains[segment["id"]] = match_loudness(clips[segment["id"]]["pcm"], target_level)
    pcm = render_day(layout, scripture, references)
    name = f"{day['day']:03d}-{announced_identity(day_hash, layout, clips, gains, separation)}.m4a"
    target = Path(output) / "days" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        encode(pcm, target, day["day"], voice)
    duration = probe(target)
    if layout["cues"][-1]["end"] > duration + .1:
        raise ValueError(f"Cue exceeds encoded duration: day {day['day']}")
    manifest = {"version": 2, "identity": f"plan:{day['day']}", "day": day["day"], "readingHash": day_hash,
                "src": f"/audio/days/{name}", "duration": duration, "alignment": "verse",
                "cues": layout["cues"], "announcements": layout["announcements"]}
    report = {"day": day["day"], "src": manifest["src"], "samples": layout["samples"], "rate": RATE,
              "targetRms": round(target_level, 3),
              "segments": [{k: v for k, v in s.items() if k != "audioHash"} for s in layout["segments"]],
              "gains": {k: round(v, 6) for k, v in gains.items()}}
    return manifest, report


def inside(path, folder):
    try:
        Path(path).resolve().relative_to(folder.resolve())
        return True
    except ValueError:
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path)
    parser.add_argument("--aligned", type=Path, default=ROOT / "data/audio/alignments")
    parser.add_argument("--output", type=Path, help="Media folder (default public/audio; announced: artifacts)")
    parser.add_argument("--days", help="Comma-separated days for a pilot; default all 150")
    parser.add_argument("--announcements", type=Path, help="Reviewed spoken-reference catalog (catalog.json)")
    parser.add_argument("--manifests", type=Path, help="Announced manifests folder (default under artifacts/)")
    parser.add_argument("--separation", type=float, default=.25, help="Seconds around each reference (0.2–0.35)")
    parser.add_argument("--draft", action="store_true",
                        help="Private pilot with unreviewed wording or clips; never written into public/ or data/")
    args = parser.parse_args()
    books = {row[3]: row[0] for row in json.loads((ROOT / "data/books.json").read_text())}
    plan = json.loads((ROOT / "data/plan.json").read_text())
    chapter_hashes = {key: chapter_text_hash(verses) for key, verses in chapter_verses(plan).items()}
    selected = [day for day in plan if not args.days or str(day["day"]) in args.days.split(",")]
    if args.announcements:
        work = ROOT / "artifacts/audio-work/announced"
        output = args.output or work
        manifests = args.manifests or work / "manifests"
        if args.draft and any(inside(path, ROOT / folder) for path in (output, manifests)
                              for folder in ("public", "data")):
            parser.error("--draft output must stay outside public/ and data/")
        references = {r["id"]: r for r in json.loads(
            (ROOT / "data/audio/reference-texts.json").read_text(encoding="utf-8"))["references"]}
        clips = load_clips(args.announcements, references, args.draft, ffmpeg_pcm)
        voice = json.loads(args.announcements.read_text(encoding="utf-8")).get("voice", "")
        manifests.mkdir(parents=True, exist_ok=True)
        reports = []
        for day in selected:
            manifest, report = assemble_announced(day, books, chapter_hashes, args.source, args.aligned,
                                                  clips, output, args.separation, voice)
            (manifests / f"{day['day']}.json").write_text(compact(manifest) + "\n")
            reports.append(report)
            print(f"Built announced day {day['day']}: {manifest['duration']:.1f}s, "
                  f"{len(manifest['announcements'])} references", flush=True)
        (manifests / "report.json").write_text(json.dumps(
            {"draft": args.draft, "voice": voice, "separation": args.separation, "loudness": LOUDNESS,
             "days": reports}, ensure_ascii=False, indent=2) + "\n")
        return
    output = args.output or ROOT / "public/audio"
    manifests = ROOT / "data/audio/manifests"
    manifests.mkdir(parents=True, exist_ok=True)
    for day in selected:
        manifest = assemble(day, books, chapter_hashes, args.source, args.aligned, output)
        content = compact(manifest) + "\n"
        (manifests / f"{day['day']}.json").write_text(content)
        print(f"Built day {day['day']}: {manifest['duration']:.1f}s", flush=True)
    days = sorted(int(p.stem) for p in manifests.glob("*.json"))
    (ROOT / "data/audio/catalog.json").write_text(json.dumps({"days": days}, indent=2) + "\n")


if __name__ == "__main__":
    main()
