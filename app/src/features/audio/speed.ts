const SPEEDS = [0.75, 1, 1.25, 1.5];

/** The next playback speed in the cycle, wrapping around after the last. */
export const nextRate = (rate: number) =>
  SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length];

const RATE_KEY = "bible-reader-audio-rate-v1";

/** This device's listening speed, kept between recordings and visits. */
export function savedRate() {
  try {
    const rate = Number(localStorage.getItem(RATE_KEY));
    return SPEEDS.includes(rate) ? rate : 1;
  } catch {
    return 1;
  }
}
export function saveRate(rate: number) {
  try {
    if (rate === 1) localStorage.removeItem(RATE_KEY);
    else localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    /* This session only. */
  }
}
