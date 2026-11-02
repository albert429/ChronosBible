"""Source-relative cut calculations shared by generation and catalog verification."""
from .fingerprints import fingerprint

RATE = 24000
PAD = 0.25
TAG = 'chapter-clip-v1'
CANONICAL_TAG = 'canonical-native-opening-v1'
SETTINGS = {'codec': 'aac', 'bitrate': '48k', 'rate': RATE, 'channels': 1, 'faststart': True}
DAY_SETTINGS = {k: v for k, v in SETTINGS.items() if k != 'faststart'}


def passage_span(chapter, passage, label):
    """Seconds of one passage in its chapter recording, on the output sample grid."""
    verses = chapter["verses"]
    selected = [v for v in verses if passage["start"] <= v["verse"] <= passage["end"]]
    if [v["verse"] for v in selected] != [v["number"] for v in passage["verses"]]:
        raise ValueError(f"Incomplete verse coverage: {label}")
    # Keep short breaths at the edges, without including adjacent speech.
    previous = next((v for v in verses if v["verse"] == passage["start"] - 1), None)
    following = next((v for v in verses if v["verse"] == passage["end"] + 1), None)
    begin = max(selected[0]["start"] - .12, previous["end"] if previous else 0)
    end = min(selected[-1]["end"] + .20, following["start"] if following else chapter["duration"])
    if end <= begin or any(v["end"] <= v["start"] for v in selected):
        raise ValueError(f"Invalid timestamps: {label}")
    # Quantize to the output sample grid so concatenation never drifts.
    return round(begin * RATE) / RATE, round(end * RATE) / RATE, selected


def clip_bounds(verses, first, last, duration):
    """(start, end) for verses first..last of an aligned chapter, in source seconds.

    The cut sits PAD seconds outside the verses, but never past the midpoint of the
    silence shared with the neighbouring verse, so neither neighbour is audible.
    """
    by_number = {v['verse']: v for v in verses}
    a, b = by_number[first], by_number[last]
    start = max(0.0, a['start'] - PAD)
    if first - 1 in by_number:
        start = max(start, (by_number[first - 1]['end'] + a['start']) / 2)
    end = min(duration, b['end'] + PAD)
    if last + 1 in by_number:
        end = min(end, (b['end'] + by_number[last + 1]['start']) / 2)
    if not 0 <= start < a['start'] + 1e-9 or end <= b['end'] - 1e-9 or end <= start:
        raise ValueError('degenerate clip bounds')
    return round(start, 3), round(end, 3)


def clip_name(code, chapter, first, last, source_hash, text_hash, start, end):
    return f'{code}-{chapter}-{first}-{last}-' + fingerprint([source_hash, text_hash, SETTINGS, start, end, TAG]) + '.m4a'


def clip_entry(passage, alignment, bounds, name, duration):
    start, end = bounds
    cues = []
    for verse in alignment['verses']:
        if passage['from'] <= verse['verse'] <= passage['to']:
            cues.append({'verse': verse['verse'], 'start': round(max(0.0, verse['start'] - start), 3),
                         'end': round(min(duration, verse['end'] - start), 3)})
    return cues
