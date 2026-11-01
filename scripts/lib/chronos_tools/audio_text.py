"""Transcript and chapter-text hashing shared by the audio tools.

Standard library only. The reading transcript is also built by
src/domain/audio/manifest.ts (readingTranscript); tests/fixtures/transcript.json pins
both implementations to the same bytes.
"""
import json

from .fingerprints import compact, digest


def reading_transcript(day):
    return compact([[p["book"], p["chapter"], p["start"], p["end"],
                     [[v["number"], v["text"]] for v in p["verses"]]] for p in day["passages"]])


def reading_hash(day):
    return digest(reading_transcript(day).encode())


def chapter_verses(plan):
    """Verse text by number for every chapter, keyed by (book name, chapter)."""
    chapters = {}
    for day in plan:
        for passage in day["passages"]:
            verses = chapters.setdefault((passage["book"], passage["chapter"]), {})
            for verse in passage["verses"]:
                verses[verse["number"]] = verse["text"]
    return chapters


def chapter_text_hash(verses):
    return digest(json.dumps(sorted(verses.items()), ensure_ascii=False).encode())
