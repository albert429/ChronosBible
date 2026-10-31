/**
 * Export the SVG source as PNGs without changing its design: the 32px
 * favicon fallback, and the installed app's icons in public/icons/ (192 and
 * 512px as drawn; maskable and Apple touch icons full-bleed, the book inside
 * the safe zone that launchers may crop to).
 */
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = await readFile(
  new URL("../src/assets/favicon.svg", import.meta.url),
  "utf8",
);
const out = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
// The paper tone of the icon's own background (src/styles/tokens.css --bg).
const PAPER = "#f7f5ef";
const exports = [
  { path: "src/assets/favicon.png", size: 32, scale: 1, bleed: false },
  { path: "public/icons/icon-192.png", size: 192, scale: 1, bleed: false },
  { path: "public/icons/icon-512.png", size: 512, scale: 1, bleed: false },
  {
    path: "public/icons/maskable-512.png",
    size: 512,
    scale: 0.72,
    bleed: true,
  },
  {
    path: "public/icons/apple-touch-icon.png",
    size: 180,
    scale: 0.84,
    bleed: true,
  },
];

await mkdir(out("public/icons"), { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
try {
  for (const { path, size, scale, bleed } of exports) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    const icon = Math.round(size * scale);
    await page.setContent(
      `<style>html,body{margin:0;width:${size}px;height:${size}px}` +
        `body{display:grid;place-items:center;background:${bleed ? PAPER : "transparent"}}` +
        `svg{display:block;width:${icon}px;height:${icon}px}</style>${source}`,
    );
    await page.screenshot({ path: out(path), omitBackground: !bleed });
    await page.close();
  }
  console.log("Exported the Bible favicon and app icons.");
} finally {
  await browser.close();
}
