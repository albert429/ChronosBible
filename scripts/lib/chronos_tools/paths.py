"""Repository-root resolution shared by every Python tool."""

from pathlib import Path

# scripts/lib/chronos_tools/paths.py -> repository root.
ROOT = Path(__file__).resolve().parents[3]
