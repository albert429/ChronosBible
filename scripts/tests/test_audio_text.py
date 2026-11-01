"""Hash contract between the Python audio tools and src/domain/audio/manifest.ts.

Standard library only: run `python3 -I -m unittest discover -s scripts/tests`
from the repository root.
"""
import json
import unittest

from _support import ROOT
from chronos_tools.audio_text import chapter_text_hash, chapter_verses, reading_hash, reading_transcript


def load(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


class GoldenFixture(unittest.TestCase):
    """tests/fixtures/transcript.json is also asserted by tests/audio.test.ts."""

    fixture = load("tests/fixtures/transcript.json")

    def test_transcript(self):
        self.assertEqual(reading_transcript(self.fixture["day"]), self.fixture["transcript"])

    def test_reading_hash(self):
        self.assertEqual(reading_hash(self.fixture["day"]), self.fixture["readingHash"])

    def test_chapter_text_hashes(self):
        chapters = chapter_verses([self.fixture["day"]])
        expected = {(c["book"], c["chapter"]): c["sha256"] for c in self.fixture["chapterTextHashes"]}
        self.assertEqual({key: chapter_text_hash(verses) for key, verses in chapters.items()}, expected)


class CommittedData(unittest.TestCase):
    plan = load("data/plan.json")

    def test_manifest_reading_hashes(self):
        days = {day["day"]: day for day in self.plan}
        self.assertEqual(len(days), 150)
        for number, day in days.items():
            manifest = load(f"data/audio/manifests/{number}.json")
            self.assertEqual(manifest["readingHash"], reading_hash(day), f"day {number}")

    def test_alignment_text_hashes(self):
        codes = {row[3]: row[0] for row in load("data/books.json")}
        chapters = {(codes[book], chapter): verses
                    for (book, chapter), verses in chapter_verses(self.plan).items()}
        files = sorted((ROOT / "data/audio/alignments").glob("*.json"))
        self.assertEqual(len(files), 260)
        self.assertEqual({path.stem for path in files},
                         {f"{code}-{chapter}" for code, chapter in chapters})
        for path in files:
            alignment = json.loads(path.read_text(encoding="utf-8"))
            key = (alignment["book"], alignment["chapter"])
            self.assertEqual(alignment["textHash"], chapter_text_hash(chapters[key]), path.name)


if __name__ == "__main__":
    unittest.main()
