# The Holy Bible / الكتاب المقدس

قراءة واستماع، بالترتيب المعتاد أو الزمني.

This guide records the four-mode release **under integration and final testing**. See the [README](../README.md) for the current reader and local setup.

## Four reading choices

The reading menu presents four choices:

| Choice                       | Intent                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------- |
| الكتاب المقدس                | Read all 66 books in the usual order, from Genesis to Revelation.             |
| العهد القديم بالترتيب الزمني | 412 self-paced Old Testament readings.                                        |
| العهد الجديد بالترتيب الزمني | 141 self-paced New Testament readings.                                        |
| العهد الجديد في ١٥٠ يومًا    | خطة شباب كنيسة الإخوة بخلوصي — the existing 150-day New Testament youth plan. |

The chronology choices are self-paced sequences, without an imposed calendar. The youth plan retains its daily schedule and existing progress. Chronology is derived from the user-supplied `Chronological.pdf`. The reviewed New Testament verse sequence matches the youth plan after the documented 1 Timothy 6:22 source exception; their reading/day boundaries differ. The source order is preserved, with readings ending at the nearest natural chapter or section boundary to the target length. See the [chronology audit](chronology.md).

## Place and completion

A fresh reader opens Genesis 1. Guests and named readers each have independent completion and saved places in every mode; an explicit passage URL takes precedence over that saved position. Switching readers or modes must preserve their separate positions.

Completion is an explicit reader action, independent of opening a passage, moving to another passage, or listening. Version 2 backups include places and completion; existing profiles, youth-plan completion and start dates migrate, and version 1 backups remain importable.

## Listening and media preparation

Audio starts only after the reader chooses Listen. One native player uses 48 kbps mono AAC, with canonical chapter recordings, daily tracks, and chronology playlists. No media downloads before Listen; background audio prefetch is metadata-only. Partial clips are generated offline during media preparation. This release does not add offline listening or download features, or promise a full offline Bible audio library. Generated spoken labels are outside this release.

Use the [audio guide](audio.md) and [audio provenance](../data/audio/SOURCES.md) for preparation, hosting, credits, and recording terms. Public-domain Van Dyck Scripture text from eBible.org does not establish rights to any audio recording.

## Access and presentation

Keep the app a static frontend suitable for free hosting, with no registration required. Reading remains the main screen; the menu provides the four choices without obscuring Scripture with setup steps. Keep the existing Arabic typography, reader preferences, useful assets, and church/contact credits as the broader identity is integrated.
