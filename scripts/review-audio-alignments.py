#!/usr/bin/env python3
"""Compatibility alias: the tool now lives at scripts/audio/review-audio-alignments.py (same arguments)."""
import runpy
import sys
from pathlib import Path

target = Path(__file__).resolve().parent / "audio" / "review-audio-alignments.py"
sys.argv[0] = str(target)
runpy.run_path(str(target), run_name="__main__")
