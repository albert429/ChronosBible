export type Inline = { text: string; bold?: true };
export type Block =
  | { kind: "p"; inlines: Inline[] }
  | { kind: "ul"; items: Inline[][] }
  | { kind: "ol"; start: number; items: Inline[][] };

function inlines(text: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(/\*\*([^*\n]{1,500})\*\*/g)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (!line || /^([-*_])\1{2,}$/.test(line)) continue;
    line = line.replace(/^>\s?/, "");
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "p", inlines: [{ text: heading[1], bold: true }] });
      continue;
    }
    const bullet = /^[-•*]\s+(.+)$/.exec(line);
    const numbered = /^(\d{1,3}|[٠-٩]{1,3})[.)]\s+(.+)$/.exec(line);
    const previous = blocks[blocks.length - 1];
    if (bullet) {
      if (previous?.kind === "ul") previous.items.push(inlines(bullet[1]));
      else blocks.push({ kind: "ul", items: [inlines(bullet[1])] });
      continue;
    }
    if (numbered) {
      if (previous?.kind === "ol") previous.items.push(inlines(numbered[2]));
      else {
        // Keep the model's number, so a list split by a paragraph continues.
        const digits = numbered[1].replace(/[٠-٩]/g, (d) =>
          String(d.charCodeAt(0) - 0x660),
        );
        blocks.push({
          kind: "ol",
          start: Number(digits),
          items: [inlines(numbered[2])],
        });
      }
      continue;
    }
    blocks.push({ kind: "p", inlines: inlines(line) });
  }
  return blocks;
}

/** A safe, short model name for the answer footer. */
export function modelLabel(raw?: string) {
  const name = (raw ?? "").replace(/:free$/, "");
  return /^[A-Za-z0-9/:._-]{1,80}$/.test(name) ? name : "نموذج غير معروف";
}
