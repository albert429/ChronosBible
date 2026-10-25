#!/usr/bin/env python3
"""Offline stock MMS Arabic TTS auditions, never automatic text/voice approval.

Install torch==2.8.0 transformers==4.57.6 scipy safetensors uroman in an ignored
isolated environment. Model cache/WAVs stay in artifacts. No paid API/account.
"""
import argparse
import json
from pathlib import Path
import urllib.request
import wave

from audio_text import digest

ROOT = Path(__file__).resolve().parents[1]
MODEL = 'facebook/mms-tts-ara'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ids', help='Comma-separated full reference IDs; default 3 varied auditions')
    parser.add_argument('--days', help='Pilot days only; 1,32,150 recommended before any full batch')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/audio-work/reference-auditions')
    parser.add_argument('--cache', type=Path, default=ROOT / 'artifacts/audio-work/model-cache')
    parser.add_argument('--revision', help='Pinned Hugging Face commit; resolved once if omitted')
    parser.add_argument('--offline', action='store_true', help='Only load previously cached model files')
    args = parser.parse_args()
    import numpy as np
    import torch
    from transformers import AutoTokenizer, VitsModel, set_seed
    records = json.loads((ROOT / 'data/audio/reference-texts.json').read_text())['references']
    selected_ids = (args.ids or 'LUK-1-1-4,MAT-28-16-20,MRK-16-14-14').split(',')
    if args.days:
        from audio_references import reference_id
        books = {row[3]: row[0] for row in json.loads((ROOT / 'data/books.json').read_text())}
        plan = json.loads((ROOT / 'data/plan.json').read_text())
        selected_ids = [reference_id(books[p['book']], p) for day in plan if str(day['day']) in args.days.split(',') for p in day['passages']]
        if not set(map(int, args.days.split(','))) <= {1, 32, 150}:
            raise ValueError('Audition day batching is limited to pilot days 1,32,150 pending voice review')
    selected = [r for r in records if r['id'] in selected_ids]
    if set(r['id'] for r in selected) != set(selected_ids):
        raise ValueError(f'Unknown reference ID(s): {set(selected_ids)-set(r["id"] for r in selected)}')
    args.output.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)
    revision_file = args.cache / 'mms-tts-ara-revision.txt'
    revision = args.revision or (revision_file.read_text().strip() if revision_file.exists() else None)
    if not revision:
        if args.offline:
            raise ValueError('Resolve/cache a pinned model revision before offline generation')
        with urllib.request.urlopen(f'https://huggingface.co/api/models/{MODEL}') as response:
            revision = json.load(response)['sha']
        revision_file.write_text(revision + '\n')
    torch.set_num_threads(4)
    print(f'Loading stock {MODEL}@{revision}', flush=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=revision, cache_dir=args.cache, local_files_only=args.offline)
    model = VitsModel.from_pretrained(MODEL, revision=revision, cache_dir=args.cache, local_files_only=args.offline, use_safetensors=True).eval()
    clips = {}
    for record in selected:
        set_seed(150)
        inputs = tokenizer(record['text'], return_tensors='pt')
        with torch.inference_mode():
            samples = model(**inputs).waveform[0].cpu().numpy()
        pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2')
        target = args.output / f"{record['id']}.wav"
        with wave.open(str(target), 'wb') as audio:
            audio.setparams((1, 2, model.config.sampling_rate, 0, 'NONE', 'not compressed'))
            audio.writeframes(pcm.tobytes())
        clips[record['id']] = {'file': target.name, 'textHash': record['textHash'], 'audioHash': digest(target.read_bytes()),
                               'voice': MODEL, 'revision': revision, 'settings': {'seed': 150, 'rate': model.config.sampling_rate},
                               'license': 'CC-BY-NC-4.0 model; noncommercial candidate, distribution review pending',
                               'reviewed': False, 'duration': len(samples) / model.config.sampling_rate}
        print(f"Audition {record['id']}: {len(samples)/model.config.sampling_rate:.2f}s {target}", flush=True)
    existing = args.output / 'catalog.json'
    old = json.loads(existing.read_text()).get('clips', {}) if existing.exists() else {}
    old.update(clips)
    existing.write_text(json.dumps({'version': 1, 'status': 'UNREVIEWED-PRIVATE-PROTOTYPE', 'clips': old}, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
