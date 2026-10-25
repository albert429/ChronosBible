"""Full-Bible source inventory and honest verse alignment validation (no ML import)."""
import gzip
import json
import re
from pathlib import Path

from audio_text import chapter_text_hash, digest


def file_hash(path):
    import hashlib
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def bible_chapters(path):
    """Normalized source from build-bible; yields the exact client transcript shape."""
    source = json.loads(gzip.decompress(Path(path).read_bytes()))
    if source.get('version') != 1 or len(source.get('books', [])) != 66:
        raise ValueError('Expected normalized 66-book Bible source version 1')
    for index, book in enumerate(source['books']):
        for chapter in book['chapters']:
            verses = chapter['verses']
            if [v['number'] for v in verses] != list(range(1, len(verses) + 1)):
                raise ValueError(f"Incomplete transcript: {book['usfm']} {chapter['chapter']}")
            reading = {'mode': 'bible', 'usfm': book['usfm'], 'book': book['name'],
                       'chapter': chapter['chapter'], 'verseCount': len(verses),
                       'passages': [{'book': book['name'], 'chapter': chapter['chapter'],
                                     'start': 1, 'end': len(verses), 'verses': verses}],
                       'structure': chapter['structure']}
            yield index, reading


def source_files(ot, nt, chapters):
    expected = {}
    for index, reading in chapters:
        key = ('A', index + 1, reading['chapter']) if index < 39 else ('B', index - 38, reading['chapter'])
        if key in expected:
            raise ValueError(f'Duplicate canonical source key {key}')
        expected[key] = (reading['usfm'], reading['chapter'])
    actual = {}
    for folder, prefix in ((ot, 'A'), (nt, 'B')):
        for path in Path(folder).rglob('*.mp3'):
            match = re.match(r'([AB])(\d{2})_{2,3}(\d{2,3})_.+\.mp3$', path.name)
            if not match or match[1] != prefix:
                raise ValueError(f'Unexpected source filename: {path.name}')
            key = (match[1], int(match[2]), int(match[3]))
            if key in actual:
                raise ValueError(f'Duplicate source: {path.name}')
            actual[key] = path
    if set(actual) != set(expected):
        raise ValueError(f'Source coverage mismatch: missing {set(expected)-set(actual)}, extra {set(actual)-set(expected)}')
    return {expected[key]: path for key, path in actual.items()}


def alignment_problems(value, reading, record, end=None):
    """Why an alignment cannot be used for this chapter as published ([] if none).

    Checks the original recording (name and SHA-256 from canonical provenance),
    the transcript hash of the current text, complete ordered verses, valid
    scores and intervals inside the recording (or before a reviewed trim `end`).
    """
    problems = []
    verses = reading['passages'][0]['verses']
    if value.get('book') != reading['usfm'] or value.get('chapter') != reading['chapter']:
        problems.append('wrong chapter')
    if record is None or value.get('audioHash') != record['sourceHash'] or value.get('file') != record['source']:
        problems.append('original recording hash or name differs from canonical provenance')
    if value.get('textHash') != chapter_text_hash({v['number']: v['text'] for v in verses}):
        problems.append('transcript hash differs from the current Bible text')
    aligned = value.get('verses', [])
    if [v.get('verse') for v in aligned] != [v['number'] for v in verses]:
        problems.append('verses incomplete or out of order')
    limit = min(value.get('duration', 0), end if end is not None else float('inf')) + .1
    previous = 0
    for verse in aligned:
        if not (previous <= verse['start'] < verse['end'] <= limit) or not (0 <= verse['score'] <= 1):
            problems.append(f"invalid interval or score at verse {verse.get('verse')}")
            break
        previous = verse['end']
    return problems


TRIM_GAP_TOLERANCE = 0.1
TRIM_MIN_SCORE = 0.30
TRIM_TRAILER_LIMIT = 10.0


def load_source_trims(path):
    """{identity: trim} from data/audio/source-trims.json (reviewed exceptions)."""
    if not Path(path).exists():
        return {}
    data = json.loads(Path(path).read_text())
    if data.get('version') != 1:
        raise ValueError(f'Unsupported source trims: {path}')
    trims = {}
    for trim in data['trims']:
        if trim['identity'] in trims:
            raise ValueError(f"Duplicate source trim {trim['identity']}")
        trims[trim['identity']] = trim
    return trims


def check_source_trim(trim, record, reading, appended, evidence):
    """Re-derive a reviewed trim from its evidence; raise unless it still holds.

    `evidence` is a forced alignment of the WHOLE original recording against this
    chapter's text followed by the `appended` chapter's text (renumbered after
    it). The trim is valid only if that alignment matches the original's SHA-256
    and the current text of both chapters, every appended verse aligns with a
    score >= TRIM_MIN_SCORE, the appended chapter runs to the end of the
    recording, and `end` is the midpoint between the last kept verse and the
    first appended one. Returns the re-derived facts.
    """
    own = reading['passages'][0]['verses']
    extra = appended['passages'][0]['verses']
    text = {v['number']: v['text'] for v in own}
    text.update({len(own) + v['number']: v['text'] for v in extra})
    if record is None or (trim['source'], trim['sourceHash']) != (record['source'], record['sourceHash']):
        raise ValueError(f"{trim['identity']}: trim source differs from canonical provenance")
    if (evidence.get('file'), evidence.get('audioHash')) != (trim['source'], trim['sourceHash']):
        raise ValueError(f"{trim['identity']}: trim evidence is for another recording")
    if evidence.get('textHash') != chapter_text_hash(text):
        raise ValueError(f"{trim['identity']}: trim evidence text differs from the current chapters")
    aligned = evidence['verses']
    if [v['verse'] for v in aligned] != list(range(1, len(text) + 1)):
        raise ValueError(f"{trim['identity']}: trim evidence verses incomplete")
    previous = 0
    for verse in aligned:
        if not (previous <= verse['start'] < verse['end'] <= evidence['duration'] + .1):
            raise ValueError(f"{trim['identity']}: trim evidence intervals invalid")
        previous = verse['end']
    kept, first, last = aligned[len(own) - 1], aligned[len(own)], aligned[-1]
    tail = aligned[len(own):]
    end = round((kept['end'] + first['start']) / 2, 3)
    if trim['keepVerses'] != len(own) or trim['end'] != end or not kept['end'] < end < first['start']:
        raise ValueError(f"{trim['identity']}: trim end {trim['end']} is not the re-derived {end}")
    if min(v['score'] for v in tail) < TRIM_MIN_SCORE:
        raise ValueError(f"{trim['identity']}: appended chapter alignment below {TRIM_MIN_SCORE}")
    if evidence['duration'] - last['end'] > TRIM_TRAILER_LIMIT:
        raise ValueError(f"{trim['identity']}: recording continues after the appended chapter")
    return {'end': end, 'lastKeptEnd': kept['end'], 'appendedStart': first['start'],
            'appendedEnd': last['end'], 'appendedMinScore': min(v['score'] for v in tail)}


def detect_silences(source, start, end, noise='-35dB', minimum=0.3):
    """[(start, end)] silences of `source` between start and end seconds (ffmpeg)."""
    import subprocess
    start = max(0.0, start)
    log = subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-ss', f'{start:.3f}', '-to', f'{end:.3f}',
                          '-i', str(source), '-af', f'silencedetect=n={noise}:d={minimum}', '-f', 'null', '-'],
                         check=True, capture_output=True, text=True).stderr
    found, opened = [], None
    for kind, value in re.findall(r'silence_(start|end): (-?[\d.]+)', log):
        if kind == 'start':
            opened = start + float(value)
        else:
            found.append((round(start if opened is None else opened, 3), round(start + float(value), 3)))
            opened = None
    if opened is not None:
        found.append((round(opened, 3), round(end, 3)))
    return found


def verified_alignment(path, reading, source_hash):
    """Return existing exact cues or None; missing timing never implies verse timing."""
    if not Path(path).exists():
        return None
    value = json.loads(Path(path).read_text())
    verses = reading['passages'][0]['verses']
    expected_hash = chapter_text_hash({v['number']: v['text'] for v in verses})
    if value.get('audioHash') != source_hash or value.get('textHash') != expected_hash:
        raise ValueError(f'Stale audio/transcript alignment: {path}')
    if value.get('book') != reading['usfm'] or value.get('chapter') != reading['chapter']:
        raise ValueError(f'Wrong chapter alignment: {path}')
    aligned = value['verses']
    if [v['verse'] for v in aligned] != [v['number'] for v in verses]:
        raise ValueError(f'Incomplete verse alignment: {path}')
    previous = 0
    for verse in aligned:
        if not (previous <= verse['start'] < verse['end'] <= value['duration'] + .1):
            raise ValueError(f'Invalid alignment timestamps: {path}')
        if not (0 <= verse['score'] <= 1):
            raise ValueError(f'Invalid alignment confidence: {path}')
        previous = verse['end']
    return value
