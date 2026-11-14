"""Chapter encoding through the shared ffmpeg helpers, and stale-manifest reporting."""
import json
import shutil
import tempfile
import unittest
import wave
from pathlib import Path

from _support import ROOT, load_script
from chronos_tools.audio_sources import bible_chapters
from chronos_tools.audio_text import reading_hash
from chronos_tools.fingerprints import file_hash, fingerprint

build = load_script("audio/build-canonical-audio.py", "build_canonical_audio")
HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None

READING = {"usfm": "OBA", "book": "عوبديا", "chapter": 1,
           "passages": [{"book": "عوبديا", "chapter": 1, "start": 1, "end": 2,
                         "verses": [{"number": 1, "text": "أ"}, {"number": 2, "text": "ب"}]}]}


class StrayManifests(unittest.TestCase):
    def test_reports_manifests_without_a_chapter(self):
        chapters = [(0, READING)]
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "OBA").mkdir()
            (folder / "OBA/1.json").write_text("{}")
            (folder / "OBA/2.json").write_text("{}")
            (folder / "XYZ").mkdir()
            (folder / "XYZ/1.json").write_text("{}")
            self.assertEqual(build.stray_manifests(folder, chapters), ["OBA/2.json", "XYZ/1.json"])
            self.assertTrue((folder / "OBA/2.json").exists())

    def test_committed_manifests_are_exactly_the_bible_chapters(self):
        chapters = list(bible_chapters(ROOT / "data/bible/source.json.gz"))
        self.assertEqual(build.stray_manifests(ROOT / "data/audio/chapters", chapters), [])


@unittest.skipUnless(HAS_FFMPEG, "ffmpeg and ffprobe are not installed")
class Encode(unittest.TestCase):
    def test_encodes_once_with_an_immutable_fingerprinted_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            source = tmp / "A31___01_Obadiah.wav"
            with wave.open(str(source), "wb") as audio:
                audio.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
                audio.writeframes(bytes(2 * 24000))
            output, manifests, aligned = tmp / "media", tmp / "manifests", tmp / "aligned"
            aligned.mkdir()
            record = build.encode(READING, source, aligned, output, manifests)
            media = list((output / "chapters/assets").glob("*.m4a"))
            self.assertEqual(len(media), 1)
            self.assertRegex(media[0].name, r"^OBA-1-[0-9a-f]{20}\.m4a$")
            expected = fingerprint([file_hash(source), reading_hash(READING), build.SETTINGS, [], [],
                                    "canonical-native-opening-v1"])
            self.assertEqual(media[0].name, f"OBA-1-{expected}.m4a")
            manifest = json.loads((manifests / "OBA/1.json").read_text())
            self.assertEqual(manifest["src"], f"/audio/chapters/assets/{media[0].name}")
            self.assertEqual(manifest["alignment"], "chapter")
            self.assertAlmostEqual(manifest["duration"], 1.0, delta=0.2)
            self.assertEqual(record["identity"], "bible:OBA:1")
            self.assertEqual(record["bytes"], media[0].stat().st_size)
            before = media[0].stat().st_mtime_ns
            build.encode(READING, source, aligned, output, manifests)
            self.assertEqual(media[0].stat().st_mtime_ns, before)


if __name__ == "__main__":
    unittest.main()
