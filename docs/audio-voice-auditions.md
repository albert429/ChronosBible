# Arabic passage-reference voice auditions

The user rejected `facebook/mms-tts-ara` ("spells Arabic weird"), so it is not a candidate here.
Every clip is prepared offline and nothing is approved until the user has listened to it. This work does
not use macOS system voices, browser speech, paid APIs, or voice cloning of the Scripture narrator.

## Candidates

| ID                 | Voice                                                                                        | Source (pinned)                                                          | License status                                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `piper-kareem-lex` | Piper `ar_JO-kareem-medium`, male, read from hand-reviewed phonemes                          | `rhasspy/piper-voices@c10ece1a`                                          | Repo MIT. The MODEL_CARD gives the dataset license as "See URL", and that URL (`github.com/AliMokhammad/arabicttstrain`) has no license file, so **production reuse is unverified**         |
| `piper-kareem`     | The same voice, phonemized straight from the text by espeak-ng                               | same                                                                     | same                                                                                                                                                                                        |
| `silma`            | `silma-ai/silma-tts` v1 (F5-TTS, 150M) conditioned on SILMA's bundled stock `ar.ref.24k.wav` | `silma-ai/silma-tts@226dd7a6`, `charactr/vocos-mel-24khz@0feb3fdd` (MIT) | Weights Apache-2.0, code MIT. The model is a voice cloner, and SILMA does not document the identity or consent of the speaker in its stock reference, so **production reuse is unverified** |

## Wording

`scripts/voice-audition-texts.json` contains draft corrections. Nothing has been adopted into
`data/audio/reference-texts.json` yet:

- Compound ordinals from 11 to 19 take a joining fatha: `السَّادِسَ عَشَرَ` and `الرَّابِعَةَ عَشْرَةَ`.
  The current drafts leave it out.
- Words followed by a hamzat-wasl article carry their case vowel, so the article elides: `الْإِصْحَاحُ السَّادِسَ`
  is read _al-iṣḥāḥu s-sādisa_. Phrase-final words stay pausal.
- The book names `لُوقَا`, `مَرْقُسْ` and `مَتَّى` match Van Dyck usage. `الإصحاح` matches the reader UI.

Piper/espeak-ng reads Arabic wrongly in ways that matter here. It turns `الأوّل` into _alʔauːl_, `الآية`
into _alʔaːiːat_, and pronounces every article as _ʔa-_. The `-lex` variant feeds the model hand-written
phonemes instead. The reference vocabulary is closed (book names, ordinals and a few fixed words), so a
reviewed lexicon could cover all 537 references.

## Reproduce

```sh
cd artifacts/voice-auditions
uv venv --python 3.11 venv-piper && uv pip install --python venv-piper/bin/python piper-tts==1.8.0
uv venv --python 3.11 venv-silma && uv pip install --python venv-silma/bin/python --no-deps silma-tts==1.0.5
uv pip install --python venv-silma/bin/python cached_path click ema_pytorch hydra-core librosa 'numpy<=1.26.4' \
  pydub safetensors soundfile tomli torch torchaudio torchcodec torchdiffeq tqdm transformers unidecode vocos x_transformers matplotlib
cd ../..
artifacts/voice-auditions/venv-piper/bin/python -I scripts/build-voice-auditions.py piper-kareem-lex
artifacts/voice-auditions/venv-piper/bin/python -I scripts/build-voice-auditions.py piper-kareem
HF_HUB_OFFLINE=1 artifacts/voice-auditions/venv-silma/bin/python -I scripts/build-voice-auditions.py silma  # after the first pinned download
```

The script writes WAV and MP3 files plus `catalog.json` to `artifacts/voice-auditions/<candidate>/`. That
directory is ignored by Git, along with the model weights.

Workarounds the script applies:

- espeak-ng silently ignores data paths longer than about 160 bytes, so the script symlinks the data
  directory to `/tmp`.
- SILMA imports NeMo/pynini and CATT eagerly. Those packages only normalize numbers and add diacritics,
  and this text is already fully diacritized, so the script replaces them with import stubs.
- `SilmaTTS.__init__` ignores `ckpt_file` and `vocab_file`, and instead resolves unpinned `hf://` URLs through
  `cached_path`. For those two exact URLs, the script rebinds `silma_tts.api.cached_path` in-process to the pinned
  snapshot files. It refuses any other URL and leaves the installed package unchanged.
