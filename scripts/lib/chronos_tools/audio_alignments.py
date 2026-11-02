"""Shared alignment discovery and hash-bound machine/listening evidence.

Listening evidence never changes model scores or machine thresholds. A preview
may expose unresolved timings for review; release validation must reject them.
"""
from datetime import date
import json
import math
from pathlib import Path
import re

from .audio_sources import alignment_problems
from .fingerprints import digest
from .paths import ROOT

DEFAULT_FOLDERS = [ROOT / 'data/audio/alignments', ROOT / 'data/audio/alignments/ot']
DEFAULT_REVIEWS = [ROOT / 'data/audio/review/ot.json', ROOT / 'data/audio/review/nt.json']


def alignment_paths(folders):
    """Resolve both testaments; refuse ambiguous duplicate chapter files."""
    found = {}
    for folder in [folders] if isinstance(folders, (str, Path)) else folders:
        for path in sorted(Path(folder).glob('*.json')):
            if not re.fullmatch(r'[A-Z0-9]{3}-[1-9]\d{0,2}', path.stem):
                continue
            old = found.get(path.stem)
            if old is not None and old.read_bytes() != path.read_bytes():
                raise ValueError(f'Conflicting alignments for {path.stem}: {old}, {path}')
            found[path.stem] = path
    return found


def reviewed_digests(summaries):
    found = {}
    for summary in summaries:
        if summary.get('thresholds', {}).get('minScore', .30) < .30:
            raise ValueError('Machine review confidence threshold must remain at least 0.30')
        for key, sha in summary.get('reviewed', {}).items():
            if key in found and found[key] != sha:
                raise ValueError(f'Conflicting machine reviews: {key}')
            found[key] = sha
    return found


def flagged_verses(summaries):
    found = {}
    for summary in summaries:
        for key, item in summary.get('flags', {}).items():
            found.setdefault(key, set()).update(int(v) for v in item.get('flags', {}))
    return found


def load_alignments(folders, readings, records, trims, reviewed):
    alignments, unusable = {}, {}
    for key, path in alignment_paths(folders).items():
        raw = path.read_bytes()
        data = json.loads(raw)
        identity = f"bible:{data.get('book')}:{data.get('chapter')}"
        if identity not in readings or key != f"{data['book']}-{data['chapter']}":
            unusable[key] = 'unknown or misnamed alignment'
            continue
        end = trims[identity]['end'] if identity in trims else None
        if end is not None and records.get(identity, {}).get('trimEnd') != end:
            unusable[key] = 'canonical provenance does not carry the reviewed source trim'
            continue
        problems = alignment_problems(data, readings[identity], records.get(identity), end)
        if reviewed.get(key) != digest(raw):
            problems.append('alignment file is not the one the review summaries checked')
        if problems:
            unusable[key] = '; '.join(problems)
        else:
            alignments[key] = data if end is None else {**data, 'duration': min(data['duration'], end)}
    return alignments, unusable


def listening_results(path, paths, alignments):
    """Return accepted verse sets and errors; stale or failed evidence never resolves a flag."""
    if not Path(path).exists():
        return {}, []
    value = json.loads(Path(path).read_text())
    if value.get('version') != 1 or value.get('acceptanceSeconds') != 0.5:
        raise ValueError('Listening ledger must use version 1 and the 0.5 second acceptance target')
    accepted, errors, failed = {}, [], {}
    for row in value['reviews']:
        key = row.get('chapter')
        try:
            if key not in paths or key not in alignments:
                raise ValueError('unknown or unusable chapter')
            if row.get('alignmentHash') != digest(paths[key].read_bytes()):
                raise ValueError('stale alignment hash')
            first, last = row['from'], row['to']
            if type(first) is not int or type(last) is not int or not 1 <= first <= last <= len(alignments[key]['verses']):
                raise ValueError('invalid reviewed verse range')
            if not all(isinstance(row.get(k), str) and row[k].strip() for k in ('reviewer', 'date', 'notes')):
                raise ValueError('reviewer, date and notes are required')
            if date.fromisoformat(row['date']) > date.today():
                raise ValueError('review date is in the future')
            if row.get('result') not in ('accepted', 'rejected'):
                raise ValueError('result must be accepted or rejected')
            numbers = set(range(first, last + 1))
            if row['result'] == 'rejected':
                failed.setdefault(key, set()).update(numbers)
                raise ValueError('listening failed; correct and review the surrounding passage')
            error = row.get('maxStartErrorSeconds')
            if type(error) not in (int, float) or not math.isfinite(error) or not 0 <= error <= 0.5:
                raise ValueError('verse starts exceed the 0.5 second target')
            if row.get('drift') is not False or row.get('clippedScripture') is not False:
                raise ValueError('drift and clipped Scripture must both be checked and absent')
            accepted.setdefault(key, set()).update(numbers)
        except (KeyError, TypeError, ValueError) as error:
            errors.append(f'{key}: {error}')
    for key, numbers in failed.items():
        accepted.setdefault(key, set()).difference_update(numbers)
    return accepted, errors


def unresolved_verses(alignments, flags, accepted, min_score=0.30):
    result = {}
    for key, alignment in alignments.items():
        count = len(alignment['verses'])
        doubtful = set(flags.get(key, ())) | {v['verse'] for v in alignment['verses'] if v['score'] < min_score}
        result[key] = {n for n in doubtful if not set(range(max(1, n - 1), min(count, n + 1) + 1))
                       <= accepted.get(key, set())}
    return {key: numbers for key, numbers in result.items() if numbers}


def review_requirements(alignments, flags, clips=()):
    """Exact ranges: flag neighbours, each book's first chapter, named samples."""
    requirements = {}
    def add(key, first, last, reason):
        requirements.setdefault((key, first, last), []).append(reason)
    for key, alignment in alignments.items():
        count = len(alignment['verses'])
        for number in flags.get(key, ()):
            add(key, max(1, number - 1), min(count, number + 1), f'flagged verse {number} and neighbours')
        if alignment['chapter'] == 1:
            add(key, 1, min(3, count), 'book opening')
            midpoint = (count + 1) // 2
            add(key, max(1, midpoint - 1), min(count, midpoint + 1), 'book midpoint')
            add(key, max(1, count - 2), count, 'book ending')
        if key in ('GEN-1', 'LEV-11', 'PSA-23', 'PSA-119', 'ISA-53'):
            add(key, 1, count, 'representative chapter')
        if key == 'JOB-36':
            add(key, count - 2, count, 'reviewed trim ending')
    for clip in clips:
        key = f"{clip['book']}-{clip['chapter']}"
        if key not in alignments:
            continue
        if any(clip['from'] - 1 <= n <= clip['to'] + 1 for n in flags.get(key, ())):
            count = len(alignments[key]['verses'])
            for number, reason in ((clip['from'], 'affected clip start'), (clip['to'], 'affected clip end')):
                add(key, max(1, number - 1), min(count, number + 1), reason)
    return [{'chapter': k, 'from': a, 'to': b, 'reasons': reasons}
            for (k, a, b), reasons in sorted(requirements.items())]
