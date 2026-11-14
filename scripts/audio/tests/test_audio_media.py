"""The audio tools' ffmpeg/ffprobe calls, end to end on synthetic audio."""
import math
import shutil
import struct
import tempfile
import unittest
import wave
from array import array
from pathlib import Path

from _support import load_script
from chronos_tools.audio_sources import detect_silences

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
build_audio = load_script("audio/build-audio.py", "build_audio_media")
build_clips = load_script("audio/build-reading-audio.py", "build_reading_media")
verify = load_script("audio/verify-canonical-audio.py", "verify_canonical_media")
RATE = 24000


def write_wav(path, seconds_of_tone, seconds_of_silence, rate=RATE):
    samples = [round(8000 * math.sin(2 * math.pi * 220 * i / rate)) for i in range(round(seconds_of_tone * rate))]
    samples += [0] * round(seconds_of_silence * rate)
    with wave.open(str(path), "wb") as audio:
        audio.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        audio.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    return path


@unittest.skipUnless(HAS_FFMPEG, "ffmpeg and ffprobe are not installed")
class FfmpegCalls(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)

    def test_daily_tools_decode_and_encode(self):
        source = write_wav(self.folder / "tone.wav", 1.0, 0.0, rate=8000)
        pcm = build_audio.ffmpeg_pcm(source.read_bytes())
        self.assertEqual(len(pcm), 2 * RATE)
        span = build_audio.decode_span(source, 0.25, 12000)
        self.assertEqual(len(span), 12000)
        target = self.folder / "day.m4a"
        build_audio.encode_pcm(array("h", span) * 4, target, 3, "voice")
        self.assertAlmostEqual(build_audio.probe_duration(target), 2.0, delta=0.2)

    def test_clip_encoding_and_chapter_probe(self):
        source = write_wav(self.folder / "tone.wav", 1.0, 0.0)
        clip = self.folder / "clips/a.m4a"
        build_clips.encode_clip(source, 0.2, 0.8, clip)
        self.assertAlmostEqual(build_clips.probe_duration(clip), 0.6, delta=0.15)
        self.assertEqual(verify.probe(clip)["codec"], "aac")
        self.assertEqual((verify.probe(clip)["channels"], verify.probe(clip)["rate"]), (1, RATE))

    def test_silence_detection(self):
        source = write_wav(self.folder / "gap.wav", 1.0, 1.0)
        silences = detect_silences(source, 0, 2)
        self.assertEqual(len(silences), 1)
        self.assertAlmostEqual(silences[0][0], 1.0, delta=0.15)
        self.assertAlmostEqual(silences[0][1], 2.0, delta=0.15)


if __name__ == "__main__":
    unittest.main()
