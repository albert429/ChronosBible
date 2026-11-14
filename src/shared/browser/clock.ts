const cairoDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Current calendar date in Cairo; keep clock access out of pure helpers. */
export const today = () => cairoDate.format(new Date());
