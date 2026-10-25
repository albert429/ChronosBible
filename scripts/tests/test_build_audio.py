"""Spoken-reference assembly in scripts/build-audio.py, with synthetic audio.

Standard library only and no ffmpeg: decoding and encoding are injected. Real
plan text, reference wording and tracked chapter alignments are used, with
synthetic WAV clips and synthetic "source recordings" whose hashes are
substituted into copies of the alignments.
"""
import importlib.util
from array import array
import io
import json
import math
import sys
import tempfile
import unittest
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from audio_references import ONE_CHAPTER, reference_id  # noqa: E402
from audio_text import chapter_text_hash, chapter_verses, compact, digest  # noqa: E402

spec = importlib.util.spec_from_file_location("build_audio", ROOT / "scripts/build-audio.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
RATE = build.RATE


def load(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


PLAN = load("data/plan.json")
BOOKS = {row[3]: row[0] for row in load("data/books.json")}
REFERENCES = {r["id"]: r for r in load("data/audio/reference-texts.json")["references"]}
CHAPTER_HASHES = {key: chapter_text_hash(verses) for key, verses in chapter_verses(PLAN).items()}


def tone(seconds, amplitude, frequency=220, rate=RATE):
    count = round(seconds * rate)
    return array("h", (round(amplitude * math.sin(2 * math.pi * frequency * i / rate)) for i in range(count)))


def wav_bytes(pcm, rate=RATE, channels=1):
    data = io.BytesIO()
    with wave.open(data, "wb") as clip:
        clip.setparams((channels, 2, rate, 0, "NONE", "not compressed"))
        clip.writeframes(pcm.tobytes())
    return data.getvalue()


def alignments_for(day):
    result = {}
    for passage in day["passages"]:
        code = BOOKS[passage["book"]]
        result[(code, passage["chapter"])] = load(f"data/audio/alignments/{code}-{passage['chapter']}.json")
    return result


def manifest_problems(manifest):
    """The interval rules that src/audio/manifest.ts validManifest enforces."""
    problems, cues = [], manifest["cues"]
    for i, cue in enumerate(cues):
        if not 0 <= cue["start"] < cue["end"] <= manifest["duration"] + .1:
            problems.append(f"cue {i} bounds")
        if i and cue["start"] < cues[i - 1]["end"]:
            problems.append(f"cue {i} overlaps")
    for i, a in enumerate(manifest["announcements"]):
        if not 0 <= a["start"] < a["end"] <= manifest["duration"] + .1:
            problems.append(f"announcement {i} bounds")
        if i and a["start"] < manifest["announcements"][i - 1]["end"]:
            problems.append(f"announcement {i} order")
        if any(not (a["end"] <= c["start"] or a["start"] >= c["end"]) for c in cues):
            problems.append(f"announcement {i} overlaps a verse")
    return problems


class ReferenceCoverage(unittest.TestCase):
    def test_every_plan_passage_has_exactly_one_reference(self):
        ids = [reference_id(BOOKS[p["book"]], p) for day in PLAN for p in day["passages"]]
        self.assertEqual(len(ids), 537)
        self.assertEqual(set(ids), set(REFERENCES))
        singles = [r for r in REFERENCES.values() if r["start"] == r["end"]]
        self.assertEqual(len(singles), 6)
        for reference in REFERENCES.values():
            self.assertEqual(reference["textHash"], digest(reference["text"].encode()))
            # One-chapter books name no chapter; a single verse names one verse.
            self.assertEqual(reference["book"] in ONE_CHAPTER, "الْإِصْحَاح" not in reference["text"])
            self.assertEqual(reference["start"] == reference["end"], "مِنَ الْآيَة" not in reference["text"])

    def test_pilot_and_all_days_lay_out(self):
        clips = {clip_id: {"samples": RATE * 5, "text": r["text"]} for clip_id, r in REFERENCES.items()}
        for day in PLAN:
            layout = build.layout_day(day, BOOKS, alignments_for(day), clips)
            self.assertEqual(len(layout["announcements"]), len(day["passages"]))
            self.assertEqual(len(layout["cues"]), sum(len(p["verses"]) for p in day["passages"]))
        self.assertEqual(len(PLAN[31]["passages"]), 12)


class Layout(unittest.TestCase):
    day = PLAN[0]
    clips = {reference_id(BOOKS[p["book"]], p): {"samples": 100_003 + i, "text": REFERENCES[reference_id(BOOKS[p["book"]], p)]["text"]}
             for i, p in enumerate(PLAN[0]["passages"])}

    def layout(self, separation=.25):
        return build.layout_day(self.day, BOOKS, alignments_for(self.day), self.clips, separation)

    def test_segments_are_exact_consecutive_samples(self):
        layout = self.layout()
        kinds = [s["kind"] for s in layout["segments"]]
        self.assertEqual(kinds[:3], ["reference", "silence", "scripture"])
        self.assertEqual(kinds[3:7], ["silence", "reference", "silence", "scripture"])
        position = 0
        for segment in layout["segments"]:
            if "offset" in segment:
                self.assertEqual(segment["offset"], position)
            self.assertIsInstance(segment["samples"], int)
            position += segment["samples"]
        self.assertEqual(position, layout["samples"])
        gaps = {s["samples"] for s in layout["segments"] if s["kind"] == "silence"}
        self.assertEqual(gaps, {round(.25 * RATE)})

    def test_scripture_timing_is_the_published_timing_shifted_by_whole_samples(self):
        layout = self.layout()
        legacy = load("data/audio/manifests/1.json")["cues"]
        self.assertEqual([(c["passage"], c["verse"]) for c in layout["cues"]],
                         [(c["passage"], c["verse"]) for c in legacy])
        starts = {s["passage"]: s["offset"] for s in layout["segments"] if s["kind"] == "scripture"}
        legacy_starts, offset = {}, 0
        for s in (s for s in layout["segments"] if s["kind"] == "scripture"):
            legacy_starts[s["passage"]] = offset
            offset += s["samples"]
        for new, old in zip(layout["cues"], legacy):
            shift = (starts[new["passage"]] - legacy_starts[new["passage"]]) / RATE
            self.assertAlmostEqual(new["start"], old["start"] + shift, delta=.0011)
            self.assertAlmostEqual(new["end"], old["end"] + shift, delta=.0011)

    def test_reference_intervals_cover_each_gap_without_touching_verses(self):
        layout = self.layout()
        manifest = {"duration": layout["samples"] / RATE, **layout}
        self.assertEqual(manifest_problems(manifest), [])
        scripture = [s for s in layout["segments"] if s["kind"] == "scripture"]
        for index, announcement in enumerate(layout["announcements"]):
            first = next(c for c in layout["cues"] if c["passage"] == index)
            self.assertEqual(announcement["end"], first["start"])
            previous_end = 0 if index == 0 else (scripture[index - 1]["offset"] + scripture[index - 1]["samples"]) / RATE
            self.assertAlmostEqual(announcement["start"], previous_end, delta=.0006)
            self.assertEqual(announcement["kind"], "reference")
            self.assertFalse(announcement["reference"].endswith("."))
        self.assertEqual(layout["announcements"][0]["start"], 0)

    def test_separation_bounds_and_missing_references_fail(self):
        for separation in (.19, .36):
            with self.assertRaises(ValueError):
                self.layout(separation)
        missing = dict(self.clips)
        missing.pop(next(iter(missing)))
        with self.assertRaises(ValueError):
            build.layout_day(self.day, BOOKS, alignments_for(self.day), missing)


class Loudness(unittest.TestCase):
    def test_quiet_reference_is_raised_to_scripture_level_only(self):
        scripture = tone(2, 8000)
        target = build.active_rms(scripture)
        clip = tone(1.5, 900, 330)
        scaled, gain = build.match_loudness(clip, target)
        self.assertGreater(gain, 1)
        self.assertAlmostEqual(build.active_rms(scaled) / target, 1, delta=.01)
        self.assertEqual(scripture, tone(2, 8000))

    def test_peaks_are_limited_and_silence_is_refused(self):
        clip = tone(1, 300) + array("h", [30000]) + tone(1, 300)
        scaled, _ = build.match_loudness(clip, 20000)
        self.assertLessEqual(max(map(abs, scaled)), round(.89 * 32767) + 1)
        with self.assertRaises(ValueError):
            build.match_loudness(array("h", bytes(2 * RATE)), 5000)


class Catalog(unittest.TestCase):
    ids = ["MRK-1-1-1", "LUK-1-1-4", "JUD-1-1-25"]

    def write(self, folder, mutate=None, reviewed=True, wav=None):
        settings = {"voice": "synthetic-test-tone", "rate": RATE}
        clips = {}
        for i, clip_id in enumerate(self.ids):
            data = wav or wav_bytes(tone(1 + i / 10, 4000))
            (folder / f"{clip_id}.wav").write_bytes(data)
            text = REFERENCES[clip_id]["text"]
            clips[clip_id] = {"file": f"{clip_id}.wav", "text": text, "textHash": digest(text.encode()),
                              "audioHash": digest(data), "settingsHash": digest(compact(settings).encode()),
                              "reviewed": reviewed}
        catalog = {"version": 1, "voice": "synthetic test tone", "settings": settings, "clips": clips}
        if mutate:
            mutate(catalog)
        path = folder / "catalog.json"
        path.write_text(json.dumps(catalog, ensure_ascii=False))
        return path

    def reviewed_references(self):
        return {k: {**v, "reviewed": True} for k, v in REFERENCES.items()}

    def test_a_reviewed_catalog_loads_exact_pcm(self):
        with tempfile.TemporaryDirectory() as tmp:
            clips = build.load_clips(self.write(Path(tmp)), self.reviewed_references())
            self.assertEqual(set(clips), set(self.ids))
            self.assertEqual(clips["MRK-1-1-1"]["pcm"], tone(1, 4000))
            self.assertEqual(clips["LUK-1-1-4"]["samples"], round(1.1 * RATE))

    def test_mismatches_and_unreviewed_inputs_are_refused(self):
        def first(catalog):
            return catalog["clips"][self.ids[0]]

        cases = {
            "unknown reference": lambda c: c["clips"].update({"XYZ-1-1-1": first(c)}),
            "changed wording": lambda c: first(c).update({"text": first(c)["text"] + " "}),
            "wrong text hash": lambda c: first(c).update({"textHash": "0" * 64}),
            "wrong audio hash": lambda c: first(c).update({"audioHash": "0" * 64}),
            "other settings": lambda c: c["settings"].update({"rate": 16000}),
            "path outside": lambda c: first(c).update({"file": "../outside.wav"}),
            "no settings": lambda c: c.pop("settings"),
        }
        for name, mutate in cases.items():
            with self.subTest(name), tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(ValueError):
                    build.load_clips(self.write(Path(tmp), mutate), self.reviewed_references())
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write(Path(tmp), reviewed=False)
            with self.assertRaises(ValueError):
                build.load_clips(path, self.reviewed_references())
            # Draft wording (as committed) is refused too, unless a private draft.
            path = self.write(Path(tmp))
            with self.assertRaises(ValueError):
                build.load_clips(path, REFERENCES)
            self.assertEqual(len(build.load_clips(path, REFERENCES, draft=True)), 3)

    def test_other_wav_formats_need_conversion(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write(Path(tmp), wav=wav_bytes(tone(1, 4000, rate=16000), rate=16000))
            with self.assertRaises(ValueError):
                build.load_clips(path, self.reviewed_references())
            converted = build.load_clips(path, self.reviewed_references(),
                                         convert=lambda data: tone(1, 4000).tobytes())
            self.assertEqual(converted["MRK-1-1-1"]["samples"], RATE)


class Assembly(unittest.TestCase):
    """End to end for day 1, with decode/encode/probe replaced by fakes."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        folder = Path(self.tmp.name)
        self.source, self.aligned, self.output = folder / "source", folder / "aligned", folder / "out"
        for path in (self.source, self.aligned):
            path.mkdir()
        self.day = PLAN[0]
        for (code, chapter), alignment in alignments_for(self.day).items():
            fake = f"fake-{code}-{chapter}".encode()
            (self.source / alignment["file"]).write_bytes(fake)
            alignment["audioHash"] = digest(fake)
            (self.aligned / f"{code}-{chapter}.json").write_text(json.dumps(alignment))
        self.clips = {}
        for i, passage in enumerate(self.day["passages"]):
            clip_id = reference_id(BOOKS[passage["book"]], passage)
            pcm = tone(1.2 + i / 7, 1500, 300 + i)
            self.clips[clip_id] = {"id": clip_id, "pcm": pcm, "samples": len(pcm),
                                   "text": REFERENCES[clip_id]["text"], "textHash": REFERENCES[clip_id]["textHash"],
                                   "audioHash": digest(pcm.tobytes()), "settingsHash": "s" * 64, "reviewed": True}
        self.decoded, self.encoded = {}, []

    def tearDown(self):
        self.tmp.cleanup()

    def decode(self, path, begin, samples):
        # A whole number of 180 Hz cycles, repeated: distinct per span, quick to make.
        cycle = tone(.1, 6000 + begin % 1000, 180)
        pcm = (cycle * (samples // len(cycle) + 1))[:samples]
        self.decoded[(path.name, begin)] = pcm
        return pcm

    def encode(self, pcm, target, day, voice):
        self.encoded.append(pcm)
        target.write_bytes(pcm.tobytes())

    def run_day(self, separation=.25, clips=None):
        return build.assemble_announced(self.day, BOOKS, CHAPTER_HASHES, self.source, self.aligned,
                                        clips or self.clips, self.output, separation, "synthetic",
                                        decode=self.decode, encode=self.encode,
                                        probe=lambda path: path.stat().st_size / 2 / RATE + .02)

    def test_manifest_and_pcm_placement_are_exact(self):
        manifest, report = self.run_day()
        self.assertEqual((manifest["version"], manifest["identity"], manifest["day"]), (2, "plan:1", 1))
        self.assertRegex(manifest["src"], r"^/audio/days/001-[a-f0-9]{20}\.m4a$")
        self.assertEqual(manifest["readingHash"], load("data/audio/manifests/1.json")["readingHash"])
        self.assertEqual(len(manifest["announcements"]), 5)
        self.assertEqual(manifest_problems(manifest), [])
        pcm = self.encoded[0]
        self.assertEqual(len(pcm), report["samples"])
        for segment in report["segments"]:
            if segment["kind"] == "scripture":
                expected = self.decoded[(segment["file"], segment["begin"])]
                self.assertEqual(pcm[segment["offset"]:segment["offset"] + segment["samples"]], expected)
            elif segment["kind"] == "reference":
                gain = report["gains"][segment["id"]]
                original = self.clips[segment["id"]]["pcm"]
                placed = pcm[segment["offset"]:segment["offset"] + segment["samples"]]
                self.assertEqual(len(placed), len(original))
                self.assertTrue(all(abs(p - o * gain) <= 1 for p, o in zip(placed, original)))
        # Scripture is never scaled: every decoded span appears verbatim.
        self.assertEqual(len(self.decoded), 5)

    def test_fingerprints_follow_every_input(self):
        first = self.run_day()[0]["src"]
        self.assertEqual(self.run_day()[0]["src"], first)
        self.assertNotEqual(self.run_day(.3)[0]["src"], first)
        changed = dict(self.clips)
        clip_id = next(iter(changed))
        changed[clip_id] = {**changed[clip_id], "audioHash": "f" * 64}
        self.assertNotEqual(self.run_day(clips=changed)[0]["src"], first)
        changed[clip_id] = {**self.clips[clip_id], "settingsHash": "e" * 64}
        self.assertNotEqual(self.run_day(clips=changed)[0]["src"], first)

    def test_a_changed_source_recording_is_refused(self):
        name = next(self.source.iterdir())
        name.write_bytes(b"different")
        with self.assertRaises(ValueError):
            self.run_day()


if __name__ == "__main__":
    unittest.main()
