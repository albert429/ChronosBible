"""Reviewed source trims and the alignment review that honours them (no audio)."""
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from audio_sources import bible_chapters, check_source_trim, load_source_trims  # noqa: E402
from audio_text import chapter_text_hash  # noqa: E402

spec = importlib.util.spec_from_file_location("review_audio_alignments", ROOT / "scripts/review-audio-alignments.py")
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


def chapter(code, number, count):
    verses = [{"number": n, "text": f"{code}{number} آية {n}"} for n in range(1, count + 1)]
    return {"usfm": code, "chapter": number, "passages": [{"verses": verses}]}


OWN, NEXT = chapter("JOB", 36, 3), chapter("JOB", 37, 2)
RECORD = {"source": "A18___36.mp3", "sourceHash": "h36"}
TRIM = {"identity": "bible:JOB:36", "source": "A18___36.mp3", "sourceHash": "h36", "keepVerses": 3,
        "appended": "bible:JOB:37", "end": 31.0}


def combined(**over):
    text = {v["number"]: v["text"] for v in OWN["passages"][0]["verses"]}
    text.update({3 + v["number"]: v["text"] for v in NEXT["passages"][0]["verses"]})
    times = [(1, 9), (10, 19), (20, 30), (32, 40), (41, 49)]
    value = {"file": "A18___36.mp3", "audioHash": "h36", "textHash": chapter_text_hash(text), "duration": 50.0,
             "verses": [{"verse": i + 1, "start": a, "end": b, "score": 0.6} for i, (a, b) in enumerate(times)]}
    value.update(over)
    return value


class Trim(unittest.TestCase):
    def test_trim_is_re_derived_from_its_evidence(self):
        facts = check_source_trim(TRIM, RECORD, OWN, NEXT, combined())
        self.assertEqual(facts, {"end": 31.0, "lastKeptEnd": 30, "appendedStart": 32, "appendedEnd": 49,
                                 "appendedMinScore": 0.6})

    def test_stale_or_weak_evidence_is_refused(self):
        low = combined()
        low["verses"][4]["score"] = 0.2
        cases = {
            "another recording": (TRIM, RECORD, combined(audioHash="other")),
            "provenance": (TRIM, {**RECORD, "sourceHash": "changed"}, combined()),
            "text differs": (TRIM, RECORD, combined(textHash="0" * 64)),
            "re-derived": ({**TRIM, "end": 31.5}, RECORD, combined()),
            "below": (TRIM, RECORD, low),
            "continues": (TRIM, RECORD, combined(duration=80.0)),
            "incomplete": (TRIM, RECORD, combined(verses=combined()["verses"][:4])),
        }
        for message, (trim, record, evidence) in cases.items():
            with self.assertRaisesRegex(ValueError, message):
                check_source_trim(trim, record, OWN, NEXT, evidence)

    def test_the_committed_job_36_trim_holds(self):
        readings = {f"bible:{r['usfm']}:{r['chapter']}": r for _, r in bible_chapters(ROOT / "data/bible/source.json.gz")}
        records = {r["identity"]: r for r in json.loads((ROOT / "data/audio/canonical-sources.json").read_text())["chapters"]}
        trims = load_source_trims(ROOT / "data/audio/source-trims.json")
        self.assertEqual(list(trims), ["bible:JOB:36"])
        trim = trims["bible:JOB:36"]
        facts = check_source_trim(trim, records["bible:JOB:36"], readings["bible:JOB:36"],
                                  readings[trim["appended"]], json.loads((ROOT / trim["evidence"]).read_text()))
        self.assertEqual((facts["end"], facts["lastKeptEnd"], facts["appendedStart"]), (267.75, 266.9, 268.6))
        self.assertEqual(records["bible:JOB:36"]["trimEnd"], 267.75)
        self.assertNotEqual(records["bible:JOB:36"]["src"], trim["supersedes"])


class Review(unittest.TestCase):
    def test_trim_ends_the_recording_and_digests_are_recorded(self):
        own = {**combined(), "book": "JOB", "chapter": 36, "verses": combined()["verses"][:3],
               "textHash": chapter_text_hash({v["number"]: v["text"] for v in OWN["passages"][0]["verses"]}),
               "duration": 300.0}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "JOB-36.json"
            path.write_text(json.dumps(own))
            args = ({"JOB-36": path}, {"bible:JOB:36": OWN}, {"bible:JOB:36": RECORD}, 0.3, 6.0)
            untrimmed, _ = review.review(*args)
            trimmed, _ = review.review(*args, {"bible:JOB:36": TRIM})
            self.assertEqual(untrimmed["JOB-36"]["notes"], ["trailer 270.0s"])
            self.assertEqual((trimmed["JOB-36"]["status"], trimmed["JOB-36"]["notes"]), ("pass", []))
            self.assertEqual(trimmed["JOB-36"]["sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
            rejected, _ = review.review(*args, {"bible:JOB:36": {**TRIM, "end": 25.0}})
            self.assertEqual(rejected["JOB-36"]["status"], "rejected")


if __name__ == "__main__":
    unittest.main()
