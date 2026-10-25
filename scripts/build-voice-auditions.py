#!/usr/bin/env python3
"""Offline stock Arabic passage-reference voice auditions (never automatic approval).

Candidates (facebook/mms-tts-ara was rejected by the user and is not offered):
  piper-kareem   rhasspy/piper-voices ar_JO-kareem-medium, from Arabic text via espeak-ng
  piper-kareem-lex  same voice, from hand-reviewed phonemes (fixes espeak-ng article/ayah errors)
  silma          silma-ai/silma-tts (Apache-2.0) with SILMA's bundled stock reference ar.ref.24k.wav

Run each engine with its own ignored venv under artifacts/voice-auditions (see
docs/audio-voice-auditions.md). Weights and audio stay in artifacts; nothing is committed.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import types
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'artifacts/voice-auditions'
TEXTS = Path(__file__).with_name('voice-audition-texts.json')
PIPER_REVISION = 'c10ece1aade47bb51c153c893d14e5bf8e5b7117'
SILMA_REVISION = '226dd7a65cadf51f9a6dbe3953fc89003b3844d5'
VOCOS_REVISION = '0feb3fdd929bcd6649e0e7c5a688cf7dd012ef21'
SILMA_REF_TEXT = 'ويدقق النظر في القرآن الكريم وسائر الكتب السماوية ويتبع مسالك الرسل العظام عليهم الصلاة والسلام.'
SEED = 150


def write_wav(target, samples, rate):
    import numpy as np
    pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2')
    with wave.open(str(target), 'wb') as audio:
        audio.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        audio.writeframes(pcm.tobytes())
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(target), '-codec:a', 'libmp3lame', '-q:a', '2',
                    str(target.with_suffix('.mp3'))], check=True)
    return len(samples) / rate


def fetch(url, target):
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['curl', '-sfL', '-o', str(target), url], check=True)
    return target


def piper(records, variant):
    from piper import PiperVoice, SynthesisConfig
    import piper as piper_pkg
    base = f'https://huggingface.co/rhasspy/piper-voices/resolve/{PIPER_REVISION}/ar/ar_JO/kareem/medium/'
    model = fetch(base + 'ar_JO-kareem-medium.onnx', WORK / 'models/piper/ar_JO-kareem-medium.onnx')
    fetch(base + 'ar_JO-kareem-medium.onnx.json', WORK / 'models/piper/ar_JO-kareem-medium.onnx.json')
    # espeak-ng truncates data paths longer than ~160 bytes and silently falls back to a CI build path.
    espeak = Path('/tmp/b150-piper-espeak-ng-data')
    if not espeak.exists():
        espeak.symlink_to(Path(piper_pkg.__file__).parent / 'espeak-ng-data')
    voice = PiperVoice.load(str(model), espeak_data_dir=str(espeak))
    voice.use_tashkeel = False  # our text is already diacritized; do not let libtashkeel rewrite it
    config = SynthesisConfig(length_scale=1.1, noise_scale=0.5, noise_w_scale=0.6)
    for record in records:
        if variant == 'lex':
            text, phonemes = record['piperPhonemes'], list(record['piperPhonemes'])
        else:
            text = record['proposedText']
            phonemes = [p for sentence in voice.phonemize(text) for p in sentence]
        ids = voice.phonemes_to_ids(phonemes)
        yield record, text, ''.join(phonemes), voice.phoneme_ids_to_audio(ids, config), voice.config.sample_rate, {
            'length_scale': 1.1, 'noise_scale': 0.5, 'noise_w_scale': 0.6, 'tashkeel': False}


def silma(records):
    # SILMA imports NeMo (pynini) and CATT eagerly; we pass fully diacritized text with
    # normalize_numbers=False, so those code paths never run and import stubs suffice.
    for name, attr in (('nemo_text_processing.text_normalization.normalize', 'Normalizer'), ('catt_tashkeel', 'CATTEncoderOnly')):
        parts = name.split('.')
        for i in range(1, len(parts) + 1):
            sys.modules.setdefault('.'.join(parts[:i]), types.ModuleType('.'.join(parts[:i])))
        setattr(sys.modules[name], attr, None)
    from huggingface_hub import hf_hub_download
    from importlib.resources import files
    import silma_tts.api
    cache = WORK / 'models/hf'
    ckpt = hf_hub_download('silma-ai/silma-tts', 'model.pt', revision=SILMA_REVISION, cache_dir=cache)
    vocab = hf_hub_download('silma-ai/silma-tts', 'vocab.txt', revision=SILMA_REVISION, cache_dir=cache)
    vocos = Path(hf_hub_download('charactr/vocos-mel-24khz', 'config.yaml', revision=VOCOS_REVISION, cache_dir=cache)).parent
    hf_hub_download('charactr/vocos-mel-24khz', 'pytorch_model.bin', revision=VOCOS_REVISION, cache_dir=cache)
    # SilmaTTS.__init__ ignores ckpt_file/vocab_file and re-resolves unpinned hf:// URLs via cached_path,
    # which would download main a second time. Rebind that name in silma_tts.api only, for those exact URLs.
    pinned = {'hf://silma-ai/silma-tts/model.pt': ckpt, 'hf://silma-ai/silma-tts/vocab.txt': vocab}

    def pinned_path(url, **_):
        if url not in pinned:
            raise RuntimeError(f'Unpinned SILMA download refused: {url}')
        print(f'Pinned {url} -> {pinned[url]}', flush=True)
        return Path(pinned[url])
    silma_tts.api.cached_path = pinned_path
    tts = silma_tts.api.SilmaTTS(vocoder_local_path=str(vocos), device='cpu', enable_normalizer=False, force_tashkeel=False)
    ref = str(files('silma_tts').joinpath('infer/ref_audio_samples/ar.ref.24k.wav'))
    for record in records:
        # Fully diacritized input makes SILMA speed up by 1.3x internally; speed=0.85 restores a calm pace.
        wav, rate, _ = tts.infer(ref_file=ref, ref_text=SILMA_REF_TEXT, gen_text=record['proposedText'], seed=SEED,
                                 speed=0.85, nfe_step=32, normalize_numbers=False, force_tashkeel=False)
        yield record, record['proposedText'], None, wav, rate, {'seed': SEED, 'speed': 0.85, 'nfe_step': 32,
                                                                'reference': 'silma_tts/infer/ref_audio_samples/ar.ref.24k.wav'}


CANDIDATES = {
    'piper-kareem': (lambda r: piper(r, 'text'), 'rhasspy/piper-voices ar_JO-kareem-medium', PIPER_REVISION,
                     'Voice repo MIT; MODEL_CARD dataset license "See URL" -> github.com/AliMokhammad/arabicttstrain has no license: UNVERIFIED for production'),
    'piper-kareem-lex': (lambda r: piper(r, 'lex'), 'rhasspy/piper-voices ar_JO-kareem-medium (reviewed phonemes)', PIPER_REVISION,
                         'Same as piper-kareem: dataset license UNVERIFIED for production'),
    'silma': (silma, 'silma-ai/silma-tts v1 + SILMA stock reference ar.ref.24k.wav', SILMA_REVISION,
              'Weights Apache-2.0, code MIT; stock reference speaker identity/consent not documented: production reuse UNVERIFIED'),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('candidate', choices=CANDIDATES)
    parser.add_argument('--ids', default='LUK-1-1-4,MRK-16-14-14,MAT-28-16-20')
    args = parser.parse_args()
    data = json.loads(TEXTS.read_text())['references']
    records = [r for r in data if r['id'] in args.ids.split(',')]
    if len(records) != len(args.ids.split(',')):
        raise ValueError('Audition IDs are limited to the reviewed entries in voice-audition-texts.json')
    run, voice, revision, license_note = CANDIDATES[args.candidate]
    output = WORK / args.candidate
    output.mkdir(parents=True, exist_ok=True)
    clips = {}
    for record, text, phonemes, samples, rate, settings in run(records):
        target = output / f"{record['id']}.wav"
        duration = write_wav(target, samples, rate)
        clips[record['id']] = {'wav': str(target), 'mp3': str(target.with_suffix('.mp3')), 'text': text, 'phonemes': phonemes,
                               'audioHash': hashlib.sha256(target.read_bytes()).hexdigest(), 'duration': round(duration, 2),
                               'settings': settings}
        print(f"{args.candidate} {record['id']}: {duration:.2f}s {target}", flush=True)
    (output / 'catalog.json').write_text(json.dumps({
        'status': 'UNREVIEWED-AUDITION', 'voice': voice, 'revision': revision, 'license': license_note, 'clips': clips,
    }, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
