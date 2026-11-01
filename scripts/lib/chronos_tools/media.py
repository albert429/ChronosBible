"""ffmpeg and ffprobe invocation shared by the audio tools.

Callers pass only what differs; every call fails loudly (check=True) and, unless
`stdin=True`, never reads the terminal.
"""

import json
import subprocess


def run_ffmpeg(args, *, loglevel="error", stdin=False, **options):
    """Run ffmpeg with `args` (everything after the binary and log level)."""
    command = ["ffmpeg", "-v", loglevel] + ([] if stdin else ["-nostdin"]) + [str(a) for a in args]
    return subprocess.run(command, check=True, **options)


def run_ffprobe(args):
    """ffprobe's stdout for `args`, quiet apart from errors."""
    command = ["ffprobe", "-v", "error"] + [str(a) for a in args]
    return subprocess.run(command, check=True, stdout=subprocess.PIPE).stdout


def probe_duration(path):
    """Container duration in seconds."""
    return float(run_ffprobe(["-show_entries", "format=duration",
                              "-of", "default=noprint_wrappers=1:nokey=1", path]))


def probe_json(path, entries):
    """ffprobe `-show_entries entries` as a parsed JSON document."""
    return json.loads(run_ffprobe(["-show_entries", entries, "-of", "json", path]))
