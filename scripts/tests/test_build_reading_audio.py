"""Playlist and clip planning for chronological readings (no ffmpeg, no audio)."""
import hashlib
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock

from _support import ROOT, load_script
from chronos_tools.audio_text import chapter_text_hash, reading_hash
from chronos_tools.ownership import OwnershipError, publish_owned

build = load_script("audio/build-reading-audio.py", "build_reading_audio")

VERSES = [{"number": n, "text": f"v{n}"} for n in range(1, 6)]
READING = {"usfm": "GEN", "book": "التكوين", "chapter": 2,
           "passages": [{"book": "التكوين", "chapter": 2, "start": 1, "end": 5, "verses": VERSES}]}
FULL = {"src": "/audio/chapters/assets/GEN-2-aa.m4a", "duration": 60.0, "alignment": "chapter",
        "cues": [], "announcements": [], "readingHash": reading_hash(READING)}
RECORD = {"source": "src.mp3", "sourceHash": "h"}


def alignment(scores=(0.9,) * 5):
    return {"book": "GEN", "chapter": 2, "file": "src.mp3", "audioHash": "h",
            "textHash": chapter_text_hash({v["number"]: v["text"] for v in VERSES}), "duration": 60.0,
            "verses": [{"verse": n, "start": 10.0 * n, "end": 10.0 * n + 8, "score": scores[n - 1]}
                       for n in range(1, 6)]}


def no_silence(source, low, high):
    return []


def silence_between(source, low, high):
    return [(low + 0.9, high - 0.9)]  # spans the 2 s gap between aligned verses


class Planning(unittest.TestCase):
    def test_bounds_stay_between_neighbours(self):
        start, end = build.clip_bounds(alignment()["verses"], 2, 3, 60.0)
        self.assertEqual((start, end), (19.75, 38.25))  # PAD inside the 2 s gaps' midpoints
        start, end = build.clip_bounds(alignment()["verses"], 1, 5, 60.0)
        self.assertEqual((start, end), (9.75, 58.25))
        tight = [{"verse": 1, "start": 1.0, "end": 2.0, "score": 1}, {"verse": 2, "start": 2.1, "end": 3, "score": 1}]
        self.assertEqual(build.clip_bounds(tight, 1, 1, 9.0), (0.75, 2.05))

    def plan(self, scores, first, last, flagged=None, silences=no_silence):
        data = alignment(scores)
        doubtful = build.questionable_verses(data, flagged or {}, "GEN-2", 0.3)
        return build.plan_clip(data, doubtful, "GEN-2", first, last, lambda low, high: silences(None, low, high))

    def test_only_cut_points_need_trusted_verses(self):
        plan, reason = self.plan((0.9,) * 5, 2, 3)
        self.assertEqual((plan["alignment"], plan["silences"], reason), ("verse", [], None))
        # A questionable verse inside the clip keeps the cut but drops verse tracking.
        plan, reason = self.plan((0.9, 0.9, 0.1, 0.9, 0.9), 2, 4)
        self.assertIsNone(reason)
        self.assertEqual((plan["alignment"], plan["questionable"]), ("chapter", [3]))
        plan, _ = self.plan((0.9,) * 5, 2, 4, flagged={"GEN-2": {3}})
        self.assertEqual(plan["alignment"], "chapter")
        # A questionable verse far outside the clip is irrelevant.
        plan, _ = self.plan((0.1, 0.9, 0.9, 0.9, 0.9), 3, 4)
        self.assertEqual(plan["alignment"], "verse")

    def test_questionable_cut_needs_silence_across_both_aligned_edges(self):
        low_neighbour = (0.9, 0.1, 0.9, 0.9, 0.9)
        self.assertIn("cut 2|3", self.plan(low_neighbour, 3, 4)[1])
        self.assertIn("not in detected silence", self.plan(low_neighbour, 3, 4)[1])
        plan, reason = self.plan(low_neighbour, 3, 4, silences=silence_between)
        self.assertIsNone(reason)
        self.assertEqual(plan["alignment"], "verse")  # the doubtful verse is outside the clip
        self.assertEqual(plan["silences"], [{"cut": 29.75, "between": [2, 3], "silence": [27.9, 30.1]}])
        # The doubtful verse is the clip's last verse: cut kept, tracking chapter-only.
        plan, reason = self.plan(low_neighbour, 1, 2, silences=silence_between)
        self.assertEqual((reason, plan["alignment"]), (None, "chapter"))
        # Silence that misses an aligned edge, or is too short, is not evidence.
        self.assertIsNotNone(self.plan(low_neighbour, 3, 4, silences=lambda s, a, b: [(a + 0.9, a + 1.05)])[1])
        self.assertIsNotNone(self.plan(low_neighbour, 3, 4, silences=lambda s, a, b: [(a + 1.2, b - 0.9)])[1])
        # Both sides doubtful, or a doubtful verse at the chapter edge: no evidence suffices.
        self.assertIsNotNone(self.plan((0.9, 0.1, 0.1, 0.9, 0.9), 3, 4, silences=silence_between)[1])
        self.assertIsNotNone(self.plan((0.1, 0.9, 0.9, 0.9, 0.9), 1, 2, silences=silence_between)[1])

    def test_flags_from_summaries(self):
        flags = build.flagged_verses([{"flags": {"GEN-2": {"flags": {"3": ["low-score"]}}}}, {}])
        self.assertEqual(flags, {"GEN-2": {3}})

    def test_names_are_deterministic_and_input_sensitive(self):
        a = build.clip_name("GEN", 2, 2, 3, "s", "t", 1.0, 2.0)
        self.assertEqual(a, build.clip_name("GEN", 2, 2, 3, "s", "t", 1.0, 2.0))
        self.assertRegex(a, r"^GEN-2-2-3-[0-9a-f]{20}\.m4a$")
        for other in [("s2", "t", 1.0, 2.0), ("s", "t2", 1.0, 2.0), ("s", "t", 1.5, 2.0), ("s", "t", 1.0, 2.5)]:
            self.assertNotEqual(a, build.clip_name("GEN", 2, 2, 3, *other))

    def make(self, passages, **over):
        encoded = []
        args = dict(
            readings={"bible:GEN:2": READING}, chapter_manifests={"bible:GEN:2": FULL},
            alignments={"GEN-2": alignment()}, flagged={}, originals={("GEN", 2): Path("src.mp3")},
            records={"bible:GEN:2": RECORD}, output=Path(tempfile.gettempdir()) / "clips-test",
            min_score=0.3, encode=lambda source, start, end, target: encoded.append((target.name, start, end)),
            measure=lambda target: 20.0, silences=no_silence, unusable={}, notes=[])
        args.update(over)
        definition = {"id": "x", "passages": passages}
        return build.build_reading("OT", definition, args.pop("readings"), args.pop("chapter_manifests"),
                                   args.pop("alignments"), args.pop("flagged"), args.pop("originals"),
                                   args.pop("records"), args.pop("output"), args.pop("min_score"),
                                   args.pop("encode"), args.pop("measure"), **args), encoded

    def test_whole_chapter_reuses_the_published_recording(self):
        (manifest, reason), encoded = self.make([{"usfm": "GEN", "chapter": 2, "from": 1, "to": 5}])
        self.assertIsNone(reason)
        self.assertEqual(encoded, [])
        self.assertEqual(manifest["entries"][0]["src"], FULL["src"])
        self.assertEqual(manifest["duration"], 60.0)
        self.assertEqual(manifest["identity"], "chrono:OT:x")

    def test_partial_chapter_is_a_verse_timed_clip_from_the_original(self):
        (manifest, reason), encoded = self.make([{"usfm": "GEN", "chapter": 2, "from": 2, "to": 3}])
        self.assertIsNone(reason)
        self.assertEqual(len(encoded), 1)
        self.assertEqual(encoded[0][1:], (19.75, 38.25))
        entry = manifest["entries"][0]
        self.assertRegex(entry["src"], r"^/audio/clips/GEN-2-2-3-[0-9a-f]{20}\.m4a$")
        self.assertEqual(entry["alignment"], "verse")
        self.assertEqual([c["verse"] for c in entry["cues"]], [2, 3])
        self.assertEqual(entry["cues"][0]["start"], 0.25)

    def test_repeated_ranges_share_one_file(self):
        passage = {"usfm": "GEN", "chapter": 2, "from": 2, "to": 3}
        (manifest, _), encoded = self.make([passage, passage])
        self.assertEqual({e["src"] for e in manifest["entries"]}, {manifest["entries"][0]["src"]})
        self.assertEqual({name for name, *_ in encoded}, {Path(manifest["entries"][0]["src"]).name})

    def test_unreviewed_boundary_blocks_the_reading_and_encodes_nothing_for_it(self):
        flagged = {"GEN-2": {3}}
        (manifest, reason), _ = self.make([{"usfm": "GEN", "chapter": 2, "from": 2, "to": 3}], flagged=flagged)
        self.assertIsNone(manifest)
        self.assertIn("flagged", reason)
        (manifest, reason), _ = self.make([{"usfm": "GEN", "chapter": 2, "from": 2, "to": 3}], alignments={})
        self.assertIn("no verse alignment", reason)
        (manifest, reason), _ = self.make([{"usfm": "GEN", "chapter": 2, "from": 2, "to": 3}], alignments={},
                                          unusable={"GEN-2": "transcript hash differs"})
        self.assertIn("transcript hash differs", reason)
        stale = {"bible:GEN:2": {**FULL, "readingHash": "0" * 64}}
        (manifest, reason), _ = self.make([{"usfm": "GEN", "chapter": 2, "from": 1, "to": 5}],
                                          chapter_manifests=stale)
        self.assertIn("stale", reason)
        (manifest, reason), _ = self.make([{"usfm": "GEN", "chapter": 2, "from": 2, "to": 9}])
        self.assertIn("outside", reason)
        (manifest, reason), _ = self.make([{"usfm": "EXO", "chapter": 1, "from": 1, "to": 2}])
        self.assertIn("not a published", reason)

    def test_questionable_interior_clip_is_published_without_cues(self):
        notes = []
        (manifest, reason), encoded = self.make([{"usfm": "GEN", "chapter": 2, "from": 2, "to": 4}],
                                                flagged={"GEN-2": {3}}, notes=notes)
        self.assertIsNone(reason)
        entry = manifest["entries"][0]
        self.assertEqual((entry["alignment"], entry["cues"]), ("chapter", []))
        self.assertEqual(encoded[0][1:], (19.75, 48.25))  # same cut as a fully trusted clip
        self.assertEqual(notes, [{"clip": encoded[0][0], "chapterOnly": [3], "silenceCuts": []}])

    def test_preview_exposes_flagged_cues_without_changing_clip_name(self):
        passages = [{"usfm": "GEN", "chapter": 2, "from": 2, "to": 4}]
        (preview, reason), encoded = self.make(passages, flagged={"GEN-2": {3}}, preview=True)
        (fallback, _), old = self.make(passages, flagged={"GEN-2": {3}})
        self.assertIsNone(reason)
        self.assertEqual(preview["entries"][0]["alignment"], "verse")
        self.assertEqual([v["verse"] for v in preview["entries"][0]["cues"]], [2, 3, 4])
        self.assertEqual(encoded, old)
        (resolved, _), _ = self.make(passages, flagged={"GEN-2": {3}}, resolved={"GEN-2": {3}})
        self.assertEqual(resolved["entries"][0]["cues"], preview["entries"][0]["cues"])


class Loading(unittest.TestCase):
    def load(self, data, reviewed=True, trims=None, record=RECORD):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "GEN-2.json"
            path.write_text(json.dumps(data))
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            return build.load_alignments([Path(tmp)], {"bible:GEN:2": READING}, {"bible:GEN:2": record},
                                         trims or {}, {"GEN-2": digest} if reviewed else {"GEN-2": "0" * 64})

    def test_current_reviewed_alignment_loads(self):
        alignments, unusable = self.load(alignment())
        self.assertEqual((list(alignments), unusable), (["GEN-2"], {}))

    def test_hashes_structure_and_review_are_checked_at_entry(self):
        cases = {
            "transcript hash": {**alignment(), "textHash": "0" * 64},
            "original recording": {**alignment(), "audioHash": "other"},
            "incomplete": {**alignment(), "verses": alignment()["verses"][:4]},
            "invalid interval": {**alignment(), "duration": 30.0},
        }
        for expected, data in cases.items():
            alignments, unusable = self.load(data)
            self.assertEqual(alignments, {})
            self.assertIn(expected, unusable["GEN-2"])
        alignments, unusable = self.load(alignment(), reviewed=False)
        self.assertIn("review summaries", unusable["GEN-2"])

    def test_reviewed_trim_ends_the_usable_recording(self):
        trims = {"bible:GEN:2": {"end": 59.0}}
        alignments, _ = self.load(alignment(), trims=trims, record={**RECORD, "trimEnd": 59.0})
        self.assertEqual(alignments["GEN-2"]["duration"], 59.0)
        _, unusable = self.load(alignment(), trims=trims)
        self.assertIn("trim", unusable["GEN-2"])
        _, unusable = self.load(alignment(), trims={"bible:GEN:2": {"end": 45.0}},
                                record={**RECORD, "trimEnd": 45.0})
        self.assertIn("invalid interval", unusable["GEN-2"])


class PublishedManifests(unittest.TestCase):
    """main() publishes playlists through the inventory: no unowned deletion, nothing half-written."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for folder in ("data/audio/review", "data/audio/readings", "chronology/OT", "chronology/NT", "alignments"):
            (self.root / folder).mkdir(parents=True)
        for name, value in (("data/audio/canonical-sources.json", {"chapters": []}),
                            ("data/audio/chapter-catalog.json", {"chapters": []}),
                            ("chronology/OT.json", {"readings": [{"id": "1"}]}),
                            ("chronology/NT.json", {"readings": []})):
            (self.root / name).write_text(json.dumps(value))
        (self.root / "chronology/OT/1.json").write_text("{}")
        self.readings = self.root / "data/audio/readings"
        publish_owned(self.readings, {"OT/old.json": b"{}\n", "NT/old.json": b"{}\n"}, build.READING_MANIFEST)
        (self.readings / "OT/unknown.json").write_text("not ours")

    def run_main(self, *extra):
        manifest = {"version": 3, "identity": "chrono:OT:1", "readingHash": "x", "duration": 1, "entries": []}
        argv = ["--chronology", str(self.root / "chronology"), "--ot", str(self.root), "--nt", str(self.root),
                "--output", str(self.root / "media"), "--bible", str(ROOT / "data/bible/source.json.gz"),
                "--alignments", str(self.root / "alignments"), "--review",
                "--trims", str(self.root / "none.json"), *extra]
        with mock.patch.object(build, "ROOT", self.root), mock.patch.object(build, "source_files", return_value={}), \
                mock.patch.object(build, "build_reading", return_value=(manifest, None)), redirect_stdout(StringIO()):
            build.main(argv)

    def test_full_run_replaces_owned_manifests_and_keeps_unknown_files(self):
        self.run_main()
        self.assertTrue((self.readings / "OT/1.json").is_file())
        self.assertFalse((self.readings / "OT/old.json").exists())
        self.assertFalse((self.readings / "NT/old.json").exists())
        self.assertEqual((self.readings / "OT/unknown.json").read_text(), "not ours")
        self.assertEqual(list(json.loads((self.readings / "inventory.json").read_text())["files"]), ["OT/1.json"])
        self.assertEqual(json.loads((self.root / "data/audio/reading-catalog.json").read_text())["readings"],
                         ["chrono:OT:1"])

    def test_pilot_removes_nothing(self):
        self.run_main("--limit", "1")
        self.assertTrue((self.readings / "OT/old.json").exists())
        self.assertTrue((self.readings / "OT/1.json").exists())

    def test_modified_owned_manifest_stops_the_run_before_any_write(self):
        (self.readings / "OT/old.json").write_text("edited")
        with self.assertRaises(OwnershipError):
            self.run_main()
        self.assertFalse((self.readings / "OT/1.json").exists())
        self.assertEqual((self.readings / "OT/old.json").read_text(), "edited")


if __name__ == "__main__":
    unittest.main()
