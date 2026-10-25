/** How day recordings are named, served and cached; shared by the app and the host configs. */
export const AUDIO_MEDIA_PREFIX = "/audio/days/";
export const AUDIO_MEDIA_PATTERN = /^\/audio\/days\/\d{3}-[a-f0-9]+\.m4a$/;
export const AUDIO_MAX_BYTES = 8 * 1024 * 1024;
export const AUDIO_CONTENT_TYPE = "audio/mp4";
export const AUDIO_CACHE_CONTROL = "public, max-age=31536000, immutable";
/** The R2 bucket holding every recording, public read-only at the origin. */
export const AUDIO_R2_BUCKET = "chronosbible-audio";
export const AUDIO_HOST_ORIGIN = "https://audio.chronosbible.com";
