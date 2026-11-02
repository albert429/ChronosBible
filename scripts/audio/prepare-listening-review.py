#!/usr/bin/env python3
"""Generate focused source excerpts and a hash-bound checklist; never invent listening results."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import html
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
from chronos_tools.audio_alignments import (DEFAULT_FOLDERS, DEFAULT_REVIEWS, alignment_paths,
    flagged_verses, load_alignments, reviewed_digests, review_requirements, unresolved_verses)
from chronos_tools.audio_sources import bible_chapters, load_source_trims, source_files
from chronos_tools.fingerprints import digest, file_hash
from chronos_tools.media import run_ffmpeg
from chronos_tools.paths import ROOT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ot', type=Path, required=True)
    parser.add_argument('--nt', type=Path, required=True)
    parser.add_argument('--alignments', type=Path, nargs='+', default=DEFAULT_FOLDERS)
    parser.add_argument('--review', type=Path, nargs='+', default=DEFAULT_REVIEWS)
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/verse-audio/listening')
    parser.add_argument('--excerpts', action='store_true')
    args = parser.parse_args()
    args.output.resolve().relative_to((ROOT / 'artifacts').resolve())
    chapters = list(bible_chapters(ROOT / 'data/bible/source.json.gz'))
    readings = {f"bible:{r['usfm']}:{r['chapter']}": r for _, r in chapters}
    records = {r['identity']: r for r in json.loads((ROOT / 'data/audio/canonical-sources.json').read_text())['chapters']}
    summaries = [json.loads(p.read_text()) for p in args.review]
    paths = alignment_paths(args.alignments)
    alignments, unusable = load_alignments(args.alignments, readings, records,
        load_source_trims(ROOT / 'data/audio/source-trims.json'), reviewed_digests(summaries))
    if unusable or len(alignments) != 1189:
        raise ValueError(f'Incomplete usable alignments: {unusable}')
    flags = unresolved_verses(alignments, flagged_verses(summaries), {})
    clips = [{**entry, 'reading': json.loads(path.read_text())['identity']}
             for path in (ROOT / 'data/audio/readings').glob('*/*.json')
             for entry in json.loads(path.read_text())['entries'] if entry['src'].startswith('/audio/clips/')]
    requirements = review_requirements(alignments, flags, clips)
    originals = source_files(args.ot, args.nt, chapters)
    args.output.mkdir(parents=True, exist_ok=True)
    for key, alignment in alignments.items():
        source = originals[(alignment['book'], alignment['chapter'])]
        if file_hash(source) != alignment['audioHash']:
            raise ValueError(f'Original changed: {key}')
    def prepare(row):
        key = row['chapter']
        alignment = alignments[key]
        code, chapter = alignment['book'], alignment['chapter']
        start = 0 if row['from'] == 1 else max(0, alignment['verses'][row['from'] - 1]['start'] - 2)
        end = min(alignment['duration'], alignment['verses'][row['to'] - 1]['end'] + 2)
        sha = digest(paths[key].read_bytes())
        name = f"{key}-{row['from']}-{row['to']}-{sha[:12]}.m4a"
        target = args.output / name
        if args.excerpts and (not target.exists() or target.stat().st_size == 0):
            run_ffmpeg(['-y', '-ss', f'{start:.3f}', '-to', f'{end:.3f}', '-i', originals[(code, chapter)],
                        '-map', '0:a:0', '-c:a', 'aac', '-b:a', '48k', '-ac', '1', '-ar', '24000', target])
        verses = readings[f'bible:{code}:{chapter}']['passages'][0]['verses']
        links = sorted({f"https://dev.chronosbible.com/?mode=chronological&testament={clip['reading'].split(':')[1]}&reading={clip['reading'].split(':')[2]}"
                        for clip in clips if clip['book'] == code and clip['chapter'] == chapter
                        and clip['from'] <= row['to'] + 1 and clip['to'] >= row['from'] - 1})
        return {**row, 'devReadings': links, 'alignmentHash': sha, 'sourceStart': start, 'sourceEnd': end, 'excerpt': name,
                'dev': f'https://dev.chronosbible.com/?mode=bible&book={code}&chapter={chapter}',
                'verses': [{**v, 'start': alignment['verses'][v['number'] - 1]['start'],
                            'end': alignment['verses'][v['number'] - 1]['end']}
                           for v in verses[row['from'] - 1:row['to']]], 'result': 'pending'}
    with ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(prepare, requirements))
    (args.output / 'checklist.json').write_text(json.dumps({'version': 1, 'acceptanceSeconds': .5,
        'instructions': 'Review starts within 0.5s, no accumulating drift, no clipped Scripture. Record actual results in data/audio/review/listening.json.',
        'items': rows}, ensure_ascii=False, indent=2) + '\n')
    body = []
    for row in rows:
        body.append(f'<section><h2>{row["chapter"]}:{row["from"]}–{row["to"]}</h2>'
                    f'<p>{html.escape(", ".join(row["reasons"]))} — pending</p>'
                    f'<a href="{html.escape(row["dev"])}">Open on dev</a> · source {row["sourceStart"]:.2f}–{row["sourceEnd"]:.2f}s'
                    f'<p><audio controls preload="none" src="{row["excerpt"]}"></audio></p>' +
                    ''.join(f'<p><a href="{html.escape(link)}">Check generated chronological clip {i + 1}</a></p>' for i, link in enumerate(row['devReadings'])) +
                    f'<p><small>Alignment SHA-256: {row["alignmentHash"]}</small></p><ol dir="rtl">' +
                    ''.join(f'<li value="{v["number"]}">{html.escape(v["text"])} '
                            f'<small dir="ltr">{v["start"]:.2f}–{v["end"]:.2f}s</small></li>' for v in row['verses']) + '</ol></section>')
    (args.output / 'index.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8">'
        '<title>Verse timing listening review</title><style>body{max-width:900px;margin:2rem auto;padding:1rem;font:18px system-ui}section{border-top:1px solid #ccc;margin-top:2rem}li{line-height:2}small{font-size:12px}audio{width:100%}</style>'
        '<h1>Listening review — pending</h1><p>Verse starts within 0.5 seconds; no accumulating drift or clipped Scripture. '
        'Source excerpts use original chapter timestamps. Check the corresponding generated playback on dev as well. '
        'Record reviewer, date, notes and exact alignment hash; failed samples require surrounding-passage review.</p>' + ''.join(body) + '</html>')
    print(f'Prepared {len(rows)} review ranges; {sum(map(len, flags.values()))} flagged verses; no listening results recorded.')


if __name__ == '__main__':
    main()
