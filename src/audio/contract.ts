/** Immutable media namespaces, served from the R2 audio host. */
export const AUDIO_MEDIA_PREFIX = "/audio/days/";
export const AUDIO_CHAPTER_MEDIA_PREFIX = "/audio/chapters/assets/";
/** Partial-chapter clips cut from the original recordings at reviewed verse boundaries. */
export const AUDIO_CLIP_MEDIA_PREFIX = "/audio/clips/";
export const AUDIO_MEDIA_PREFIXES = [
  AUDIO_MEDIA_PREFIX,
  AUDIO_CHAPTER_MEDIA_PREFIX,
  AUDIO_CLIP_MEDIA_PREFIX,
];
export const AUDIO_MEDIA_PATTERN =
  /^\/audio\/(?:days\/\d{3}|chapters\/assets\/[A-Z0-9]{3}-[1-9]\d{0,2}|clips\/[A-Z0-9]{3}-[1-9]\d{0,2}-[1-9]\d{0,2}-[1-9]\d{0,2})-[a-f0-9]+\.m4a$/;
export const AUDIO_MAX_BYTES = 8 * 1024 * 1024;
export const AUDIO_CONTENT_TYPE = "audio/mp4";
export const AUDIO_CACHE_CONTROL = "public, max-age=31536000, immutable";
/** The R2 bucket holding every recording, public read-only at the origin. */
export const AUDIO_R2_BUCKET = "chronosbible-audio";
export const AUDIO_HOST_ORIGIN = "https://audio.chronosbible.com";
