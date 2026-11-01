"""Test helpers: repository root, the shared package path and script loading.

Scripts have hyphenated names, so tests load them by path; the shared helpers
(`chronos_tools`) are ordinary imports once scripts/lib is on sys.path.
"""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "lib"))


def load_script(relative, name):
    """Import scripts/<relative> (for example "audio/build-audio.py") as a module."""
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
