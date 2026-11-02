#!/usr/bin/env python3
"""Audit staged or published catalogs; preview coverage and listening acceptance are separate gates.

All displayed occurrences must have exact canonical/clip/day cues. --media also
checks every encoded duration, size and immutable publication hash. --release
additionally requires actual listening results for flags and representative
samples. No generated catalogs are promoted by this read-only command.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
from chronos_tools.audio_alignments import (DEFAULT_FOLDERS, DEFAULT_REVIEWS, alignment_paths,
    flagged_verses, load_alignments, reviewed_digests, listening_results, unresolved_verses, review_requirements)
from chronos_tools.audio_sources import bible_chapters, load_source_trims, check_source_trim
from chronos_tools.audio_timing import passage_span, clip_bounds, clip_name, clip_entry, DAY_SETTINGS, CANONICAL_TAG
from chronos_tools.audio_text import reading_hash
from chronos_tools.fingerprints import compact, digest, file_hash, fingerprint
from chronos_tools.media import probe_duration
from chronos_tools.paths import ROOT


def audit(data, chronology, folders, summaries, listening, media=(), publication=None):
    read = lambda path: json.loads(path.read_text())
    chapters = list(bible_chapters(ROOT / 'data/bible/source.json.gz'))
    readings = {f"bible:{r['usfm']}:{r['chapter']}": r for _, r in chapters}
    names = {r['book']: r['usfm'] for _, r in chapters}
    provenance = read(data / 'canonical-sources.json')
    records = {r['identity']: r for r in provenance['chapters']}
    trims = load_source_trims(ROOT / 'data/audio/source-trims.json')
    alignments, unusable = load_alignments(folders, readings, records, trims, reviewed_digests(summaries))
    problems = [f'{key}: {why}' for key, why in unusable.items()]
    for identity, reading in readings.items():
        key = f"{reading['usfm']}-{reading['chapter']}"
        if key not in alignments:
            problems.append(f'{key}: missing usable alignment')
    if problems:
        return {'coverageReady': False, 'releaseReady': False, 'problems': problems}
    flags = unresolved_verses(alignments, flagged_verses(summaries), {})
    accepted, listening_errors = listening_results(listening, alignment_paths(folders), alignments)
    unresolved = unresolved_verses(alignments, flags, accepted)
    manifests, media_durations, clip_entries = {}, {}, []
    counts = {'days': 0, 'chapters': 0, 'chapterVerses': 0, 'OT': 0, 'NT': 0, 'fallbacks': 0}
    def check(condition, message):
        if not condition:
            problems.append(message)
    def recording(src, duration):
        check(src not in media_durations or abs(media_durations[src] - duration) < .001, f'{src}: inconsistent duration')
        media_durations[src] = duration
    def cues_match(actual, expected, label):
        check(actual == expected, f'{label}: cues differ from final alignment or displayed verse order')
    catalog = read(data / 'chapter-catalog.json')['chapters']
    check(catalog == list(readings), 'chapter catalog must contain all 1189 chapters in canonical order')
    for identity, reading in readings.items():
        code, number = reading['usfm'], reading['chapter']
        manifest = read(data / f'chapters/{code}/{number}.json')
        manifests[identity] = manifest
        aligned = alignments[f'{code}-{number}']
        expected = [{'passage': 0, 'verse': v['verse'], 'start': v['start'], 'end': v['end']} for v in aligned['verses']]
        check(manifest['version'] == 2 and manifest['identity'] == identity and manifest['readingHash'] == reading_hash(reading), f'{identity}: contract or transcript')
        check(manifest['book'] == code and manifest['chapter'] == number, f'{identity}: chapter identity')
        cues_match(manifest['cues'], expected, identity)
        opening = expected[0]['start']
        announcements = [{'passage': 0, 'start': 0, 'end': opening, 'reference': f"{reading['book']} {number}", 'kind': 'source'}] if opening else []
        check(manifest['announcements'] == announcements, f'{identity}: opening interval')
        counts['fallbacks'] += manifest['alignment'] != 'verse'
        counts['chapterVerses'] += len(manifest['cues'])
        counts['chapters'] += 1
        record = records[identity]
        end = trims.get(identity, {}).get('end')
        expected_name = fingerprint([record['sourceHash'], reading_hash(reading), provenance['settings'], expected,
                                     announcements, CANONICAL_TAG] + ([{'trimEnd': end}] if end is not None else []))
        check(manifest['src'] == f'/audio/chapters/assets/{code}-{number}-{expected_name}.m4a', f'{identity}: immutable name')
        check(record['src'] == manifest['src'] and record['alignment'] == manifest['alignment'] and record.get('trimEnd') == end, f'{identity}: provenance')
        if identity in trims:
            trim = trims[identity]
            check_source_trim(trim, record, reading, readings[trim['appended']], read(ROOT / trim['evidence']))
            check(abs(manifest['duration'] - end) <= .1, f'{identity}: trim duration')
        recording(manifest['src'], manifest['duration'])
    plan = read(ROOT / 'data/plan.json')
    check(read(data / 'catalog.json')['days'] == [d['day'] for d in plan] and len(plan) == 150, 'daily catalog coverage')
    for day in plan:
        manifest = read(data / f"manifests/{day['day']}.json")
        expected, spans, offset = [], [], 0
        for index, passage in enumerate(day['passages']):
            aligned = alignments[f"{names[passage['book']]}-{passage['chapter']}"]
            begin, end, selected = passage_span(aligned, passage, f"day {day['day']}")
            spans.append({'file': aligned['file'], 'start': begin, 'end': end, 'audioHash': aligned['audioHash']})
            expected.extend({'passage': index, 'verse': v['verse'], 'start': round(offset + v['start'] - begin, 3),
                             'end': round(offset + v['end'] - begin, 3)} for v in selected)
            offset += end - begin
        label = f"plan:{day['day']}"
        check(manifest['version'] == 1 and manifest['day'] == day['day'] and manifest['readingHash'] == reading_hash(day), f'{label}: contract or transcript')
        cues_match(manifest['cues'], expected, label)
        name = fingerprint([reading_hash(day), spans, expected, DAY_SETTINGS])
        check(manifest['src'] == f"/audio/days/{day['day']:03d}-{name}.m4a", f'{label}: stale media after timing/cut correction')
        check(abs(manifest['duration'] - offset) <= .1, f'{label}: encoded duration differs from passage cuts')
        counts['days'] += 1
        recording(manifest['src'], manifest['duration'])
    expected_catalog = []
    for testament in ('OT', 'NT'):
        for summary in read(chronology / f'{testament}.json')['readings']:
            definition = read(chronology / testament / f"{summary['id']}.json")
            identity = f"chrono:{testament}:{definition['id']}"
            expected_catalog.append(identity)
            manifest = read(data / f"readings/{testament}/{definition['id']}.json")
            check(manifest['version'] == 3 and manifest['identity'] == identity, f'{identity}: contract')
            check(len(manifest['entries']) == len(definition['passages']), f'{identity}: missing/repeated passage')
            passages = []
            for index, (entry, passage) in enumerate(zip(manifest['entries'], definition['passages'])):
                code, number, first, last = (passage[k] for k in ('usfm', 'chapter', 'from', 'to'))
                reading = readings[f'bible:{code}:{number}']
                verses = reading['passages'][0]['verses']
                passages.append({'book': reading['book'], 'chapter': number, 'start': first, 'end': last, 'verses': verses[first-1:last]})
                check([entry[k] for k in ('passage', 'book', 'chapter', 'from', 'to')] == [index, code, number, first, last], f'{identity}: passage identity/order')
                if first == 1 and last == len(verses):
                    chapter = manifests[f'bible:{code}:{number}']
                    check((entry['src'], entry['duration']) == (chapter['src'], chapter['duration']), f'{identity}: whole chapter reuse')
                    expected = [{k: c[k] for k in ('verse', 'start', 'end')} for c in chapter['cues']]
                    check(entry['announcements'] == [{k: a[k] for k in ('start', 'end', 'reference', 'kind')} for a in chapter['announcements']], f'{identity}: chapter opening')
                else:
                    clip_entries.append(entry)
                    aligned = alignments[f'{code}-{number}']
                    start, end = clip_bounds(aligned['verses'], first, last, aligned['duration'])
                    name = clip_name(code, number, first, last, aligned['audioHash'], digest(compact(verses).encode()), start, end)
                    check(entry['src'] == f'/audio/clips/{name}', f'{identity}: stale clip cut/name')
                    check(abs(entry['duration'] - (end - start)) <= .1, f'{identity}: clip encoded duration')
                    expected = clip_entry(passage, aligned, (start, end), name, entry['duration'])
                    check(entry['announcements'] == [], f'{identity}: unexpected clip opening')
                cues_match(entry['cues'], expected, identity)
                check(entry['cues'] and entry['cues'][-1]['end'] <= entry['duration'] + .1, f'{identity}: cue exceeds media')
                counts['fallbacks'] += entry['alignment'] != 'verse'
                recording(entry['src'], entry['duration'])
            check(manifest['readingHash'] == reading_hash({'passages': passages}), f'{identity}: transcript')
            check(abs(manifest['duration'] - sum(e['duration'] for e in manifest['entries'])) <= .001, f'{identity}: playlist duration')
            counts[testament] += 1
    check(read(data / 'reading-catalog.json')['readings'] == expected_catalog, 'chronological catalog coverage/order')
    check(counts == {'days': 150, 'chapters': 1189, 'chapterVerses': 31104, 'OT': 412, 'NT': 141, 'fallbacks': 0}, f'Incomplete catalog: {counts}')
    pending = [row for row in review_requirements(alignments, flags, clip_entries)
               if not set(range(row['from'], row['to'] + 1)) <= accepted.get(row['chapter'], set())]
    unpublished = []
    def measure(item):
        src, duration = item
        path = next((root / src.lstrip('/') for root in media if (root / src.lstrip('/')).is_file()), None)
        if path is None:
            return [f'{src}: media missing']
        errors = []
        if not 0 < path.stat().st_size <= 8 * 1024 * 1024 or abs(probe_duration(path) - duration) > .05:
            errors.append(f'{src}: encoded size/duration')
        if publication is not None:
            record = publication.get('files', {}).get(src)
            if record is None or record['bytes'] != path.stat().st_size or record['sha256'] != file_hash(path):
                unpublished.append(src)
        return errors
    if media:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for errors in pool.map(measure, media_durations.items()):
                problems.extend(errors)
    return {'coverageReady': not problems, 'releaseReady': not (problems or pending or unresolved or listening_errors or unpublished) and bool(media) and publication is not None,
            'counts': counts, 'mediaChecked': len(media_durations) if media else 0,
            'unpublished': sorted(unpublished), 'problems': problems, 'listeningErrors': listening_errors,
            'unresolvedVerses': {k: sorted(v) for k, v in unresolved.items()}, 'pendingListening': pending}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', type=Path, default=ROOT / 'data/audio')
    parser.add_argument('--chronology', type=Path, default=ROOT / 'public/chronology')
    parser.add_argument('--alignments', type=Path, nargs='+', default=DEFAULT_FOLDERS)
    parser.add_argument('--review', type=Path, nargs='+', default=DEFAULT_REVIEWS)
    parser.add_argument('--listening', type=Path, default=ROOT / 'data/audio/review/listening.json')
    parser.add_argument('--media', type=Path, nargs='+', default=[])
    parser.add_argument('--publication', type=Path, default=ROOT / 'data/audio/publication.json')
    parser.add_argument('--release', action='store_true')
    parser.add_argument('--report', type=Path, default=ROOT / 'artifacts/verse-audio/coverage.json')
    args = parser.parse_args()
    result = audit(args.data_root, args.chronology, args.alignments, [json.loads(p.read_text()) for p in args.review],
                   args.listening, args.media, json.loads(args.publication.read_text()))
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k not in ('pendingListening', 'unpublished', 'unresolvedVerses')}))
    print(f"Pending listening ranges: {len(result.get('pendingListening', []))}; unpublished media: {len(result.get('unpublished', []))}")
    return 0 if result['releaseReady' if args.release else 'coverageReady'] else 1


if __name__ == '__main__':
    sys.exit(main())
