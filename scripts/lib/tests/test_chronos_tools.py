"""The shared helper package: book table, fingerprints, ffmpeg calls, USFM, study text."""
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

from _support import ROOT, load_script
from chronos_tools.audio_sources import bible_chapters
from chronos_tools.audio_text import reading_hash
from chronos_tools.books import (BOOK_COUNT, OLD_TESTAMENT_BOOKS, load_books, new_testament, old_testament,
                                 usfm_by_name, usfm_by_step)
from chronos_tools.fingerprints import FINGERPRINT_LENGTH, compact, digest, file_hash, fingerprint
from chronos_tools.media import probe_duration, probe_json, run_ffmpeg
from chronos_tools.paths import ROOT as PACKAGE_ROOT
from chronos_tools.study_text import norm, word_positions
from chronos_tools.usfm import MARKER_LINE, clean, parse

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def load(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


class Paths(unittest.TestCase):
    def test_root_is_the_repository(self):
        self.assertEqual(PACKAGE_ROOT, ROOT)
        self.assertTrue((ROOT / "data/books.json").is_file())


class BookTable(unittest.TestCase):
    """tests/fixtures/book-table.json is also asserted by scripts/lib/tests/script-books.test.ts."""

    golden = load("tests/fixtures/book-table.json")

    def test_golden_rows(self):
        books = load_books()
        self.assertEqual(len(books), self.golden["count"])
        self.assertEqual(BOOK_COUNT, self.golden["count"])
        self.assertEqual(OLD_TESTAMENT_BOOKS, self.golden["oldTestament"])
        for row in self.golden["books"]:
            self.assertEqual(list(books[row["index"]]), [row["usfm"], row["osis"], row["step"], row["name"]])

    def test_name_lookup(self):
        names = usfm_by_name()
        self.assertEqual(len(names), BOOK_COUNT)
        for row in self.golden["books"]:
            self.assertEqual(names[row["name"]], row["usfm"])

    def test_testaments_and_step_codes(self):
        books = load_books()
        self.assertEqual((len(old_testament(books)), len(new_testament(books))), (39, 27))
        self.assertEqual(old_testament(books)[-1].usfm, "MAL")
        self.assertEqual(new_testament(books)[0].usfm, "MAT")
        self.assertEqual(usfm_by_step(new_testament(books))["Mat"], "MAT")
        self.assertEqual(len(usfm_by_step(books)), BOOK_COUNT)

    def test_agrees_with_the_published_catalog(self):
        catalog = load("data/bible/catalog.json")
        self.assertEqual([(b["usfm"], b["name"]) for b in catalog], [(b.usfm, b.name) for b in load_books()])

    def test_plan_books_are_the_new_testament(self):
        importer = load_script("data/import.py", "import_plan")
        self.assertEqual(importer.BOOKS, [(b.name, b.usfm) for b in new_testament(load_books())])

    def test_chronology_codes_are_known_books(self):
        importer = load_script("data/import-chronology.py", "import_chronology_books")
        self.assertEqual(set(importer.BOOKS.values()), {b.usfm for b in load_books()})

    def test_rejects_an_incomplete_table(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "data").mkdir()
            (Path(tmp) / "data/books.json").write_text(json.dumps([["GEN", "Gen", "Gen", "التكوين"]]))
            with self.assertRaises(ValueError):
                load_books(Path(tmp))


class Fingerprints(unittest.TestCase):
    def test_format(self):
        parts = ["a" * 64, {"k": [1, 2]}, "ع", None]
        self.assertEqual(compact(parts), '["' + "a" * 64 + '",{"k":[1,2]},"ع",null]')
        self.assertEqual(fingerprint(parts), digest(compact(parts).encode())[:FINGERPRINT_LENGTH])
        self.assertEqual(len(fingerprint(parts)), 20)
        self.assertEqual(digest(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")

    def test_file_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "x.bin"
            path.write_bytes(b"chronos" * 300000)
            self.assertEqual(file_hash(path), digest(b"chronos" * 300000))

    def test_committed_chapter_name_is_this_fingerprint(self):
        """The committed GEN 1 media name re-derives from its recorded inputs."""
        reading = next(r for _, r in bible_chapters(ROOT / "data/bible/source.json.gz")
                       if (r["usfm"], r["chapter"]) == ("GEN", 1))
        manifest = load("data/audio/chapters/GEN/1.json")
        sources = load("data/audio/canonical-sources.json")
        record = next(r for r in sources["chapters"] if r["identity"] == "bible:GEN:1")
        expected = fingerprint([record["sourceHash"], reading_hash(reading), sources["settings"], manifest["cues"],
                                manifest["announcements"], "canonical-native-opening-v1"])
        self.assertEqual(Path(manifest["src"]).name, f"GEN-1-{expected}.m4a")


@unittest.skipUnless(HAS_FFMPEG, "ffmpeg and ffprobe are not installed")
class Media(unittest.TestCase):
    def tone(self, folder):
        path = Path(folder) / "tone.wav"
        with wave.open(str(path), "wb") as audio:
            audio.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
            audio.writeframes(bytes(2 * 8000))
        return path

    def test_probe(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.tone(tmp)
            self.assertAlmostEqual(probe_duration(path), 1.0, places=2)
            data = probe_json(path, "stream=codec_name,channels,sample_rate:format=duration")
            self.assertEqual((data["streams"][0]["channels"], data["streams"][0]["sample_rate"]), (1, "8000"))

    def test_run_ffmpeg_converts_and_fails_loudly(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.tone(tmp)
            target = Path(tmp) / "tone.m4a"
            run_ffmpeg(["-i", path, "-c:a", "aac", "-b:a", "48k", target])
            self.assertAlmostEqual(probe_duration(target), 1.0, delta=0.2)
            with self.assertRaises(subprocess.CalledProcessError):
                run_ffmpeg(["-i", Path(tmp) / "missing.wav", target])

    def test_pipes_use_stdin_only_when_asked(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = self.tone(tmp).read_bytes()
            raw = run_ffmpeg(["-i", "pipe:0", "-f", "s16le", "-ar", 8000, "-ac", "1", "pipe:1"],
                             stdin=True, input=data, stdout=subprocess.PIPE).stdout
            self.assertEqual(len(raw), 2 * 8000)


class Usfm(unittest.TestCase):
    def test_clean(self):
        self.assertEqual(clean(r"\w In\w* the \f + \ft note\f* beginning"), "In the beginning")
        self.assertEqual(clean(r"\q1 first   line"), "first line")
        with self.assertRaises(ValueError):
            clean("stray \\")

    def test_clean_matches_the_retired_plan_importer(self):
        """scripts/data/import.py used its own narrower clean.

        The shared one also collapses runs of whitespace left where a note was
        removed. Van Dyck's committed text has none (test_import_bible checks the
        plan against the USFM-derived source verse by verse), so plan.json is unchanged.
        """

        def retired(value):
            value = re.sub(r"\\f .*?\\f\*|\\x .*?\\x\*", "", value.strip())
            return " ".join(re.sub(r"\\[a-z0-9]+\*?\s?", "", value).split())

        for sample in (r"وَقَالَ اللهُ", r"\q1 فِي الْبَدْءِ", r"\p خَلَقَ \f + \fr 1:1 \ft note \f* السَّمَاءَ",
                       r"\q2 \x - \xo 1:1 \xt Gn 2:1\x* وَالْأَرْضَ", r"\b", r"\m  بَرِيَّة "):
            self.assertEqual(clean(sample), retired(sample), sample)

    def test_marker_line(self):
        self.assertEqual(MARKER_LINE.fullmatch(r"\v 1 نص").groups(), ("v", "1 نص"))
        self.assertEqual(MARKER_LINE.fullmatch(r"\p").groups(), ("p", None))
        self.assertIsNone(MARKER_LINE.fullmatch("plain"))

    def test_parse_bridges(self):
        chapters, bridges = parse("\\id X\n\\c 1\n\\v 1 one\n\\v 2-3 two three\n")
        self.assertEqual(chapters, {1: {1: "one", 2: "two three", 3: "two three"}})
        self.assertEqual(bridges, {(1, 2): "2-3", (1, 3): "2-3"})


class StudyText(unittest.TestCase):
    def test_norm_folds_forms_and_drops_marks(self):
        self.assertEqual(norm("ٱلْأَرْضَ"), "الارض")
        self.assertEqual(norm("مُوسَى،"), "موسي")

    def test_word_positions(self):
        self.assertEqual(word_positions("#3"), [3])
        self.assertEqual(word_positions("#3 - #5"), [3, 4, 5])
        self.assertEqual(word_positions("#3 #7"), [3, 7])
        self.assertEqual(word_positions(""), [])

    def test_importers_share_the_helpers(self):
        full = load_script("data/import-study-full.py", "full_study_shared")
        legacy = load_script("data/import-study.py", "legacy_study_shared")
        self.assertIs(full.norm, legacy.norm)
        self.assertIs(full.usfm, legacy.usfm)


class Layout(unittest.TestCase):
    """Every operational script is documented and runs at its documented path."""

    def test_aliases_run_their_grouped_script(self):
        aliases = sorted((ROOT / "scripts").glob("*.py"))
        self.assertEqual(len(aliases), 17)
        for alias in aliases:
            match = re.search(r"scripts/(\w+)/([\w-]+)\.py", alias.read_text())
            self.assertIsNotNone(match, alias.name)
            self.assertEqual(match[2], alias.stem)
            self.assertTrue((ROOT / "scripts" / match[1] / f"{alias.stem}.py").is_file(), alias.name)

    def test_alias_forwards_arguments(self):
        result = subprocess.run([sys.executable, "-I", str(ROOT / "scripts/verify-audio-host.py"), "--help"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("usage: verify-audio-host.py", result.stdout)

    def test_documented_script_paths_exist(self):
        documents = [ROOT / "AGENTS.md", ROOT / "README.md", ROOT / "CONTRIBUTING.md",
                     *sorted((ROOT / "docs").glob("*.md")), *sorted((ROOT / "data").rglob("*.md"))]
        mentioned = set()
        for document in documents:
            if document.exists():
                mentioned |= set(re.findall(r"scripts/[\w/.-]+\.py", document.read_text(encoding="utf-8")))
        self.assertGreater(len(mentioned), 10)
        for path in sorted(mentioned):
            self.assertTrue((ROOT / path).is_file(), f"documented but missing: {path}")

    def test_no_script_loads_a_sibling_by_file_path(self):
        for path in (ROOT / "scripts").rglob("*.py"):
            if "tests" in path.parts:
                continue
            self.assertNotIn("spec_from_file_location", path.read_text(encoding="utf-8"), str(path))


if __name__ == "__main__":
    unittest.main()
