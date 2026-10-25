#!/usr/bin/env python3
"""Offline verse alignment of user-supplied chapter MP3s. Never runs in Vite.

Pinned environment: torch==2.8.0 torchaudio==2.8.0 uroman==1.3.1 numpy.
Requires ffmpeg. Resume-safe: each result identifies its audio and transcript.
"""
import argparse
import json
import re
import subprocess
import time
from pathlib import Path

import numpy as np
import torch
import uroman
from torchaudio.pipelines import MMS_FA

from audio_text import chapter_text_hash, chapter_verses
from audio_sources import bible_chapters, file_hash

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "data/audio/alignments")
    parser.add_argument("--books", help="Comma-separated USFM codes; default selected testament")
    parser.add_argument("--testament", choices=["OT", "NT", "all"], default="NT")
    parser.add_argument("--bible", type=Path, default=ROOT / "data/bible/source.json.gz")
    parser.add_argument("--chapters", help="Comma-separated USFM:chapter keys for a pilot")
    parser.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    args = parser.parse_args()
    books = json.loads((ROOT / "data/books.json").read_text())
    if args.bible.exists():
        readings = [reading for _, reading in bible_chapters(args.bible)]
        chapters = chapter_verses(readings)
    elif args.testament == "NT":
        chapters = chapter_verses(json.loads((ROOT / "data/plan.json").read_text()))
    else:
        raise ValueError("Old Testament alignment requires the normalized full-Bible source (--bible)")
    args.output.mkdir(parents=True, exist_ok=True)
    romanizer = uroman.Uroman()
    print("Loading MMS alignment model…", flush=True)
    model = MMS_FA.get_model().to(args.device).eval()
    tokenizer, aligner = MMS_FA.get_tokenizer(), MMS_FA.get_aligner()
    torch.set_num_threads(4)
    for canonical_index, (code, _, _, name) in enumerate(books):
        testament = "OT" if canonical_index < 39 else "NT"
        if args.testament != "all" and args.testament != testament:
            continue
        prefix = "A" if testament == "OT" else "B"
        book_index = canonical_index + 1 if testament == "OT" else canonical_index - 38
        if args.books and code not in args.books.split(","):
            continue
        for (book, chapter), verse_map in sorted(chapters.items()):
            if book != name:
                continue
            if args.chapters and f"{code}:{chapter}" not in args.chapters.split(","):
                continue
            candidates = [path for path in args.source.rglob(f"{prefix}{book_index:02d}_*.mp3")
                          if (match := re.match(r"[AB]\d{2}_{2,3}(\d{2,3})_", path.name)) and int(match[1]) == chapter]
            if len(candidates) != 1:
                raise ValueError(f"Expected one source for {code} {chapter}, found {len(candidates)}")
            source = candidates[0]
            verses = sorted(verse_map.items())
            if [n for n, _ in verses] != list(range(1, len(verses) + 1)):
                raise ValueError(f"Incomplete transcript: {code} {chapter}")
            audio_hash = file_hash(source)
            text_hash = chapter_text_hash(verse_map)
            output = args.output / f"{code}-{chapter}.json"
            if output.exists():
                old = json.loads(output.read_text())
                if old.get("audioHash") == audio_hash and old.get("textHash") == text_hash and old.get("algorithm") == "mms-fa-v2":
                    print(f"Cached {code} {chapter}", flush=True)
                    continue
            started = time.monotonic()
            raw = subprocess.check_output([
                "ffmpeg", "-v", "error", "-i", str(source), "-f", "f32le",
                "-ac", "1", "-ar", "16000", "pipe:1",
            ])
            wave = torch.from_numpy(np.frombuffer(raw, dtype=np.float32).copy())
            duration = len(wave) / 16000
            emissions, times = [], []
            # Twenty-second windows with context bound GPU memory. Preserve
            # absolute frame times rather than accumulating window rounding.
            step, context = 320000, 32000
            with torch.inference_mode():
                for start in range(0, len(wave), step):
                    end = min(start + step, len(wave))
                    left, right = max(0, start - context), min(len(wave), end + context)
                    emission, _ = model(wave[left:right].unsqueeze(0).to(args.device))
                    emission = emission[0].cpu()
                    centres = left + np.arange(emission.shape[0]) * 320 + 200
                    keep = (centres >= start) & (centres < end)
                    emissions.append(emission[keep])
                    times.extend((centres[keep] / 16000).tolist())
            # Wildcards absorb spoken introductions/closing credits. They are
            # never assigned to a verse or included in the daily transcript.
            transcript = ["*"]
            for _, text in verses:
                roman = romanizer.romanize_string(text, lcode="ara").lower()
                roman = re.sub(r"[^a-z']", "", roman.replace("’", "'"))
                if not roman:
                    raise ValueError(f"Empty normalized verse: {code} {chapter}")
                transcript.append(roman)
            transcript.append("*")
            spans = aligner(torch.cat(emissions), tokenizer(transcript))
            result = []
            for (number, _), tokens in zip(verses, spans[1:-1]):
                begin = max(0, times[tokens[0].start] - 0.0125)
                end = min(duration, times[min(tokens[-1].end - 1, len(times) - 1)] + 0.0075)
                score = sum(t.score * (t.end - t.start) for t in tokens) / sum(t.end - t.start for t in tokens)
                result.append({"verse": number, "start": round(begin, 3), "end": round(end, 3), "score": round(score, 4)})
            data = {"version": 1, "algorithm": "mms-fa-v2", "book": code, "chapter": chapter,
                    "file": source.name, "audioHash": audio_hash, "textHash": text_hash,
                    "duration": duration, "method": "MMS_FA/uroman, machine aligned; review before publication",
                    "verses": result}
            temp = output.with_suffix(".tmp")
            temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
            temp.replace(output)
            print(f"Aligned {code} {chapter}: {duration:.0f}s in {time.monotonic()-started:.1f}s, min score {min(v['score'] for v in result):.3f}", flush=True)


if __name__ == "__main__":
    main()
