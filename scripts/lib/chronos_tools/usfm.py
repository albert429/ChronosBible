"""Stream parser for one eBible USFM book: chapters, verses and verse bridges."""

import re

# Whole-line markers that carry no Scripture wording (identification, titles, headings).
SKIP_LINE = re.compile(r"^\\(?:id|ide|h|toc\d|mt\d?|ms\d?|mr|s\d?|sr|r|d|cl|rem|sts)\b.*$", re.M)
# Van Dyck epistle subscriptions ("\p -كُتِبَتْ إِلَى …-") are colophons, not verse text.
SUBSCRIPTION = re.compile(r"^\\p\s+-.*-\s*$", re.M)
TOKEN = re.compile(r"\\c\s+(\d+)|\\v\s+(\d+)(?:-(\d+))?\s")
# One source line: marker and the text after it (importers that keep structure).
MARKER_LINE = re.compile(r"^\\([a-z0-9]+)(?:\s+(.*))?$")


def clean(value: str) -> str:
    # Notes and markers (shared by every importer), plus word attributes
    # (\w word|strong="G3056"\w*), nested \+ markers and KJV pilcrows.
    value = re.sub(r"\\f .*?\\f\*|\\x .*?\\x\*", "", value, flags=re.S)
    value = re.sub(r"\|[^\\]*(?=\\\+?[a-z0-9]+\*)", "", value)
    # A closing marker keeps the following space ("\w In\w* the" -> "In the").
    value = re.sub(r"\\\+?[a-z0-9]+\*", "", value)
    value = re.sub(r"\\\+?[a-z0-9]+\s?", "", value).replace("¶", "")
    if "\\" in value:
        raise ValueError(f"Unprocessed USFM marker: {value}")
    return " ".join(value.split())


def parse(text: str) -> tuple[dict, dict]:
    """Return ({chapter: {verse: text}}, {(chapter, verse): "25-26"})."""
    text = SUBSCRIPTION.sub("", SKIP_LINE.sub("", text.lstrip("\ufeff")))
    chapters: dict = {}
    bridges: dict = {}
    chapter = None
    current: list = []
    position = 0

    def flush(end: int) -> None:
        if current:
            value = clean(text[position:end])
            for number in current:
                chapters[chapter][number] = value

    for match in TOKEN.finditer(text):
        flush(match.start())
        current = []
        if match[1]:
            chapter = int(match[1])
            chapters.setdefault(chapter, {})
        else:
            if chapter is None:
                raise ValueError("Verse before the first chapter")
            first = int(match[2])
            last = int(match[3] or first)
            current = list(range(first, last + 1))
            if last != first:
                for number in current:
                    bridges[(chapter, number)] = f"{first}-{last}"
        position = match.end()
    flush(len(text))
    return chapters, bridges
