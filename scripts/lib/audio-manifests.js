// Names of the generated audio manifests under public/audio (and so under the
// build's audio/ folder): `<day>.json`, `chapters/<BOOK>/<n>.json` and
// `chrono/<OT|NT>/<id>.json`, as manifestOutputPath (src/features/audio/domain/publication.ts)
// writes them. Recordings and anything else in the folder never match.
export const AUDIO_MANIFEST_PATH =
  /^(?:[1-9]\d{0,2}\.json|chapters\/[A-Z0-9]{3}\/[1-9]\d{0,2}\.json|chrono\/(?:OT|NT)\/[a-z0-9]+(?:-[a-z0-9]+)*\.json)$/;
