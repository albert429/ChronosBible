"""Parser and aligner of the New Testament study importer, on a tiny synthetic TTAraSVD."""
import contextlib
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from _support import load_script

study = load_script("data/import-study.py", "legacy_study")
plan = load_script("data/import.py", "plan_importer")

TTARASVD = "\n".join([
    "header",
    "Mat.1.1",
    "#1\tكِتَابُ\tG0976\tβίβλος\tl\tbook\tbiblos\tN-NSF\t#01=k",
    "#2 - #3\tمِيلَادِ يَسُوعَ\tG1078; G2424\tγενέσεως ; Ἰησοῦ\tl\tbirth; Jesus\tgenesis; Iesou\tN-GSF; N-GSM\t#02=k; #03=k",
    "#4\tالمسيح\tG5547\tΧριστοῦ\tl\tChrist\tChristou\tN-GSM\t#04=k",
    "#5\tx\t\t\t\t\t\t\t",
    "Mat.1.2",
    "#1\tإِبْرَاهِيمُ\tG0011\tἈβραὰμ\tl\tAbraham\tAbraam\tN-PRI\t#01=k",
])


class TtaraSvd(unittest.TestCase):
    def rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tt.txt"
            path.write_text(TTARASVD, encoding="utf-8")
            with contextlib.redirect_stderr(io.StringIO()):
                return study.parse_ttarasvd(path, {"Mat": "MAT"})

    def test_parses_positions_ranges_and_tokens(self):
        verses, stats = self.rows()
        self.assertEqual(sorted(verses), ["MAT.1.1", "MAT.1.2"])
        first = verses["MAT.1.1"]
        self.assertEqual([row[0] for row in first], [[1], [2, 3], [4], [5]])
        self.assertEqual(first[1][2][1], ["Ἰησοῦ", "Iesou", "G2424", "N-GSM", "Jesus"])
        self.assertIsNone(first[3][2])
        self.assertEqual(dict(stats), {})

    def test_alignment_maps_source_positions_to_verse_words(self):
        verses, _ = self.rows()
        self.assertEqual(study.align(verses["MAT.1.1"], "كتاب ميلاد يسوع المسيح"), ({1: 0, 2: 1, 3: 2, 4: 3}, 4))
        self.assertEqual(study.align(verses["MAT.1.1"], "شيء آخر تماما"), (None, 3))


class PlanBooks(unittest.TestCase):
    def test_reads_notes_headings_and_continuation_lines(self):
        usfm = ("\\id MAT\n\\c 1\n\\s1 Heading\n\\p\n\\v 1 قَالَ \\f + \\ft n \\f* اللهُ\n\\q1 لِيَكُنْ\n"
                "\\p -كُتِبَتْ إِلَى-\n\\v 2 ثَانِيَةٌ\n")
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "vd.zip"
            with zipfile.ZipFile(archive, "w") as handle:
                for _, code in plan.BOOKS:
                    handle.writestr(f"x/41-{code}arb-vd.usfm", usfm)
            books = plan.read_books(archive)
        self.assertEqual(len(books), 27)
        chapter = books["متى"]["chapters"][1]
        self.assertEqual(chapter[1], {"number": 1, "text": "قَالَ اللهُ لِيَكُنْ", "heading": "Heading"})
        self.assertEqual(chapter[2], {"number": 2, "text": "ثَانِيَةٌ"})


if __name__ == "__main__":
    unittest.main()
