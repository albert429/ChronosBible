// Model output is untrusted text. It becomes a tiny AST of plain strings that
// React renders as text nodes; nothing is ever interpreted as HTML.

export const MAX_TEXT = 6000;
// A Markdown link target: up to 500 characters, allowing one level of
// parentheses inside, e.g. (javascript:alert(1)). Bounded, so no backtracking blow-up.
const TARGET = String.raw`\((?:[^()\n]|\([^()\n]{0,100}\)){0,500}\)`;

/** Drop lone UTF-16 surrogates (a pair cut in two), which make encodeURIComponent throw. */
export const wellFormed = (text: string) =>
  text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (unit) =>
    unit.length === 2 ? unit : "",
  );
/** The first `max` UTF-16 units, never ending inside a surrogate pair. */
export const clip = (text: string, max: number) =>
  wellFormed(text.slice(0, max));

export function cleanAnswer(raw: string) {
  let text = raw.replace(/\r\n?/g, "\n");
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // Hidden reasoning that has not closed yet (still streaming): drop the rest.
  const open = text.search(/<think>/i);
  if (open >= 0) text = text.slice(0, open);
  text = text
    .replace(/\t/g, " ")
    .replace(/[‪-‮⁦-⁩]/g, "")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "")
    .replace(/^[ ]*```.*$/gm, "")
    .replace(new RegExp(`!\\[[^\\]\\n]{0,200}\\]${TARGET}`, "g"), "")
    .replace(new RegExp(`\\[([^\\]\\n]{0,200})\\]${TARGET}`, "g"), "$1")
    .trim();
  return wellFormed(text);
}
