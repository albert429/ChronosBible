"""Arabic word normalization and STEPBible row helpers shared by the study importers.

Pure functions and patterns only: no filesystem access and no process exits.
Used by scripts/data/import-study.py (New Testament) and
scripts/data/import-study-full.py (canonical full Bible).
"""

import re

# STEPBible verse reference line, e.g. "Mat.1.1" or "1Sa.2.3".
REF_LINE = re.compile(r"^[1-3]?[A-Z][a-z]{1,2}\.\d+\.\d+$")
DIACRITICS = re.compile("[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]")
LETTERS = str.maketrans("ٱأإآةىؤئ", "ااااهيوي")
NOT_LETTER = re.compile("[^ء-ي]")
POSITION = re.compile(r"#(\d+)")


def norm(word: str) -> str:
    """Letters only, without diacritics, with hamza/alef/ya forms folded."""
    return NOT_LETTER.sub("", DIACRITICS.sub("", word).translate(LETTERS))


def word_positions(label: str) -> list:
    """Arabic word numbers named by a TTAraSVD "Ara W#" cell ("#3", "#3 - #5")."""
    positions = [int(n) for n in POSITION.findall(label)]
    if len(positions) == 2 and "-" in label:
        positions = list(range(positions[0], positions[1] + 1))
    return positions
