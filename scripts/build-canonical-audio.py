#!/usr/bin/env python3
"""Encode all 1,189 original chapters offline; reuse exact verified verse cues.

Missing alignments are explicitly chapter-level, without inferred verse times.
Original native openings are retained once; no synthetic voice is added here.
A reviewed source trim (data/audio/source-trims.json) ends a recording that
also contains another chapter; it is re-derived from its evidence and must
fall in detected silence, and the trim end enters the immutable name. A
--chapters pilot updates only those chapters' provenance records.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import subprocess
import tempfile

from audio_text import compact, digest, reading_hash
from audio_sources import (bible_chapters, check_source_trim, detect_silences, file_hash, load_source_trims,
                           source_files, verified_alignment)

ROOT = Path(__file__).resolve().parents[1]
SETTINGS = {'codec': 'aac', 'bitrate': '48k', 'rate': 24000, 'channels': 1, 'faststart': True}
MAX_BYTES = 8 * 1024 * 1024


def trim_end(trim, reading, source, source_hash, readings):
    """Checked end (seconds) of a reviewed source trim, or None without one."""
    if trim is None:
        return None
    evidence = json.loads((ROOT / trim['evidence']).read_text())
    facts = check_source_trim(trim, {'source': source.name, 'sourceHash': source_hash}, reading,
                              readings[trim['appended']], evidence)
    gaps = detect_silences(source, facts['lastKeptEnd'] - 1, facts['appendedStart'] + 1)
    if not any(start <= facts['end'] <= end for start, end in gaps):
        raise ValueError(f"{trim['identity']}: trim end {facts['end']} is not in detected silence {gaps}")
    return facts['end']


def encode(reading, source, aligned, output, manifests, trim=None, readings=None):
    source_hash = file_hash(source)
    code, number = reading['usfm'], reading['chapter']
    end = trim_end(trim, reading, source, source_hash, readings)
    alignment = verified_alignment(aligned / f'{code}-{number}.json', reading, source_hash)
    cues = [] if alignment is None else [
        {'passage': 0, 'verse': v['verse'], 'start': v['start'], 'end': v['end']} for v in alignment['verses']]
    announcements = []
    if cues and cues[0]['start'] > 0:
        announcements.append({'passage': 0, 'start': 0, 'end': cues[0]['start'],
                              'reference': f"{reading['book']} {number}", 'kind': 'source'})
    text_hash = reading_hash(reading)
    fingerprint = digest(compact([source_hash, text_hash, SETTINGS, cues, announcements, 'canonical-native-opening-v1']
                                 + ([{'trimEnd': end}] if end is not None else [])).encode())[:20]
    name = f'{code}-{number}-{fingerprint}.m4a'
    target = output / 'chapters/assets' / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        with tempfile.TemporaryDirectory(prefix='bible-chapter-') as tmp:
            temp = Path(tmp) / name
            subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-i', str(source)]
                           + (['-to', f'{end:.3f}'] if end is not None else []) + ['-map', '0:a:0',
                            '-c:a', 'aac', '-b:a', SETTINGS['bitrate'], '-ac', '1', '-ar', '24000',
                            '-movflags', '+faststart', '-map_metadata', '0', str(temp)], check=True)
            temp.replace(target) if temp.stat().st_dev == target.parent.stat().st_dev else target.write_bytes(temp.read_bytes())
    if target.stat().st_size > MAX_BYTES:
        raise ValueError(f'{code} {number} is {target.stat().st_size} bytes; extend range hosting before publication (never truncate)')
    duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                              '-of', 'default=noprint_wrappers=1:nokey=1', str(target)]))
    if cues and cues[-1]['end'] > duration + .1:
        raise ValueError(f'Cues exceed encoded duration: {code} {number}')
    if end is not None and abs(duration - end) > .1:
        raise ValueError(f'Trimmed duration {duration} differs from the trim end {end}: {code} {number}')
    manifest = {'version': 2, 'identity': f'bible:{code}:{number}', 'book': code, 'chapter': number,
                'readingHash': text_hash, 'src': f'/audio/chapters/assets/{name}', 'duration': duration,
                'alignment': 'verse' if cues else 'chapter', 'cues': cues, 'announcements': announcements}
    dest = manifests / code / f'{number}.json'
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(compact(manifest) + '\n')
    return {'identity': manifest['identity'], 'src': manifest['src'], 'bytes': target.stat().st_size,
            'duration': duration, 'sourceHash': source_hash, 'source': source.name,
            'alignment': manifest['alignment'], 'minimumScore': min((v['score'] for v in alignment['verses']), default=None) if alignment else None,
            **({'trimEnd': end} if end is not None else {})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ot', type=Path, required=True)
    parser.add_argument('--nt', type=Path, required=True)
    parser.add_argument('--bible', type=Path, default=ROOT / 'data/bible/source.json.gz')
    parser.add_argument('--aligned', type=Path, default=ROOT / 'data/audio/alignments')
    parser.add_argument('--output', type=Path, default=ROOT / 'public/audio')
    parser.add_argument('--manifests', type=Path, default=ROOT / 'data/audio/chapters')
    parser.add_argument('--chapters', help='Optional comma-separated CODE:N pilot; coverage still checked against full sources')
    parser.add_argument('--trims', type=Path, default=ROOT / 'data/audio/source-trims.json')
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    chapters = list(bible_chapters(args.bible))
    if len(chapters) != 1189:
        raise ValueError(f'Expected 1189 chapters, got {len(chapters)}')
    files = source_files(args.ot, args.nt, chapters)
    readings = {f"bible:{r['usfm']}:{r['chapter']}": r for _, r in chapters}
    trims = load_source_trims(args.trims)
    if set(trims) - set(readings):
        raise ValueError(f'Source trims for unknown chapters: {sorted(set(trims) - set(readings))}')
    selected = [r for _, r in chapters if not args.chapters or f"{r['usfm']}:{r['chapter']}" in args.chapters.split(',')]
    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(encode, r, files[(r['usfm'], r['chapter'])], args.aligned, args.output, args.manifests,
                               trims.get(f"bible:{r['usfm']}:{r['chapter']}"), readings): r for r in selected}
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            if len(results) % 25 == 0 or len(results) == len(selected):
                print(f"Encoded {len(results)}/{len(selected)} chapters", flush=True)
    ordered = sorted(results, key=lambda x: next(i for i, (_, r) in enumerate(chapters) if x['identity'] == f"bible:{r['usfm']}:{r['chapter']}"))
    if not args.chapters:
        (ROOT / 'data/audio/chapter-catalog.json').write_text(json.dumps({'version': 1, 'chapters': [r['identity'] for r in ordered]}, indent=2) + '\n')
    report = ROOT / 'artifacts/audio-work/canonical-report.json'
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({'settings': SETTINGS, 'chapters': ordered, 'bytes': sum(r['bytes'] for r in results),
                                  'duration': sum(r['duration'] for r in results), 'largest': max(results, key=lambda r: r['bytes'])}, indent=2) + '\n')
    sources = ROOT / 'data/audio/canonical-sources.json'
    if args.chapters and sources.exists():
        built = {r['identity']: r for r in ordered}
        previous = json.loads(sources.read_text())['chapters']
        ordered = [built.pop(r['identity'], r) for r in previous] + list(built.values())
    if not args.chapters or sources.exists():
        sources.write_text(json.dumps({'version': 1, 'settings': SETTINGS, 'chapters': ordered}, ensure_ascii=False, indent=2) + '\n')
    print(f"Prepared {len(results)} chapters; {sum(r['bytes'] for r in results)} bytes", flush=True)


if __name__ == '__main__':
    main()
