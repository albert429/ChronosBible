"""Canonical USFM structure and deterministic source checks. Standard library only."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("import_bible", ROOT / "scripts/import-bible.py")
IMPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)


class Structure(unittest.TestCase):
    def parse(self, text):
        return IMPORTER.parse_book(text)[0]

    def test_metadata_is_not_numbered_text(self):
        chapter = self.parse("\\id PSA\n\\c 1\n\\cl Psalm one\n\\s1 Heading\n\\d Superscription\n\\qa A\n\\p\n\\v 1 Verse one\n\\qc\n\\v 2 Verse two")
        self.assertEqual([v["text"] for v in chapter["verses"]], ["Verse one", "Verse two"])
        self.assertEqual([b["kind"] for b in chapter["structure"]], ["heading", "superscription", "acrostic", "paragraph", "poetry"])
        self.assertEqual([b["verse"] for b in chapter["structure"]], [1, 1, 1, 1, 2])

    def test_heading_and_paragraph_can_start_within_a_verse(self):
        chapter = self.parse("\\c 1\n\\p\n\\v 1 First 😀\n\\s1 Section\n\\p Second\n\\v 2 Last")
        self.assertEqual(chapter["verses"][0]["text"], "First 😀 Second")
        self.assertEqual(chapter["structure"][1], {"kind": "heading", "marker": "s1", "text": "Section", "verse": 1, "offset": 8})
        self.assertEqual(chapter["structure"][2], {"kind": "paragraph", "marker": "p", "verse": 1, "offset": 8})

    def test_preverse_text_and_colophon_remain_unnumbered(self):
        chapter = self.parse("\\c 1\n\\p Introduction\n\\v 1 Scripture\n\\p -Subscription-")
        self.assertEqual(chapter["verses"], [{"number": 1, "text": "Scripture"}])
        self.assertEqual(chapter["structure"][0]["text"], "Introduction")
        self.assertEqual(chapter["structure"][1]["text"], "-Subscription-")
        self.assertEqual(chapter["structure"][1]["offset"], len("Scripture"))

    def test_rejects_unsupported_markers_or_gaps(self):
        for text in ("\\c 1\n\\v 1 Text\n\\bogus Lost", "\\c 1\n\\v 2 Text", "\\c 2\n\\v 1 Text", "\\v 1 Text", "\\c 1"):
            with self.subTest(text=text), self.assertRaises(ValueError):
                IMPORTER.parse_book(text)


class CommittedSource(unittest.TestCase):
    def test_normalized_source_and_catalog_are_deterministic(self):
        folder = ROOT / "data/bible"
        provenance = json.loads((folder / "provenance.json").read_text(encoding="utf-8"))
        compressed = (folder / "source.json.gz").read_bytes()
        normalized = gzip.decompress(compressed)
        self.assertEqual(hashlib.sha256(compressed).hexdigest(), provenance["gzipSha256"])
        self.assertEqual(hashlib.sha256(normalized).hexdigest(), provenance["sourceSha256"])
        self.assertEqual(IMPORTER.encoded(json.loads(normalized)), normalized)
        regenerated = gzip.compress(normalized, compresslevel=9, mtime=0)
        regenerated = regenerated[:9] + bytes([255]) + regenerated[10:]
        self.assertEqual(regenerated, compressed)
        self.assertEqual(hashlib.sha256((folder / "catalog.json").read_bytes()).hexdigest(), provenance["catalogSha256"])
        IMPORTER.validate_plan(json.loads(normalized), json.loads((ROOT / "data/plan.json").read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
