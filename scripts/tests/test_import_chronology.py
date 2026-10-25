"""Chronology PDF text parsing and the committed normalized source. Standard library only."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("import_chronology", ROOT / "scripts/import-chronology.py")
IMPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)
CATALOG = json.loads((ROOT / "data/bible/catalog.json").read_text("utf-8"))
GENESIS = next(book for book in CATALOG if book["usfm"] == "GEN")["verseCounts"]


class References(unittest.TestCase):
    def test_right_to_left_extraction_order(self):
        self.assertEqual(IMPORTER.parse_reference("1:10-5", GENESIS), (10, 1, 5, False))
        self.assertEqual(IMPORTER.parse_reference("32:11", GENESIS), (11, 32, 32, False))
        self.assertEqual(IMPORTER.parse_reference("21:3 -29", GENESIS), (3, 21, 29, False))
        self.assertEqual(IMPORTER.parse_reference("2", GENESIS), (2, 1, 25, True))

    def test_whole_chapter_must_exist(self):
        with self.assertRaises(ValueError):
            IMPORTER.parse_reference("51", GENESIS)

    def test_book_names_fold_spacing_and_marks(self):
        self.assertEqual(IMPORTER.BOOKS[IMPORTER.fold("ا  خ ب ار           ٱل   و ل")], "1CH")
        self.assertEqual(IMPORTER.BOOKS[IMPORTER.fold("ك و ر نَّ ث و س ٱل و ل ى")], "1CO")
        self.assertEqual(IMPORTER.BOOKS[IMPORTER.fold("ا لت َّث ن ي ة")], "DEU")


class Parsing(unittest.TestCase):
    def parse(self, text, groups=None):
        count = groups or sum(line[:1].isdigit() for line in text.splitlines())
        return IMPORTER.parse_source(text, CATALOG, count)

    def test_groups_continue_across_pages_and_keep_source_order(self):
        groups, issues = self.parse(
            "=== PAGE 1\n1  ا لت ك و ين              1\nا  خ ب ار           ٱل   و ل            1:1-4\n"
            "=== PAGE 2\nا لت ك و ين               32:11\n2  ا لت ك و ين              2\n"
        )
        self.assertEqual(issues, [])
        self.assertEqual([g["group"] for g in groups], [1, 2])
        self.assertEqual(groups[0]["page"], 1)
        self.assertEqual(groups[0]["pageEnd"], 2)
        self.assertEqual(
            [(o["id"], o["usfm"], o["chapter"], o["from"], o["to"]) for o in groups[0]["occurrences"]],
            [("g001-1", "GEN", 1, 1, 31), ("g001-2", "1CH", 1, 1, 4), ("g001-3", "GEN", 11, 32, 32)],
        )
        self.assertEqual(groups[0]["occurrences"][2]["original"], "التكوين 11:32")

    def test_out_of_range_verses_are_reported_not_fixed(self):
        groups, issues = self.parse("=== PAGE 1\n1  ا لت ك و ين              1:1-40\n")
        self.assertEqual(groups[0]["occurrences"][0]["to"], 40)
        self.assertEqual(issues, [{"occurrence": "g001-1", "problem": "verse range outside the canonical chapter"}])

    def test_group_numbers_must_be_sequential(self):
        with self.assertRaises(ValueError):
            self.parse("=== PAGE 1\n2  ا لت ك و ين              1\n", 1)


class CommittedSource(unittest.TestCase):
    def test_source_is_complete_and_pinned(self):
        data = json.loads((ROOT / "data/chronology/source.json").read_text("utf-8"))
        self.assertEqual(data["source"]["sha256"], IMPORTER.SOURCE_SHA256)
        self.assertEqual(data["issues"], [])
        self.assertEqual([g["group"] for g in data["groups"]], list(range(1, 366)))
        self.assertTrue(all(g["testament"] == ("OT" if g["group"] <= 266 else "NT") for g in data["groups"]))
        ids = [o["id"] for g in data["groups"] for o in g["occurrences"]]
        self.assertEqual(len(ids), 1758)
        self.assertEqual(len(set(ids)), len(ids))


if __name__ == "__main__":
    unittest.main()
