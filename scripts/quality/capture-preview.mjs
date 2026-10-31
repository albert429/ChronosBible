import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const directory = "artifacts/screenshots";
await mkdir(directory, { recursive: true });
const report = [];
try {
  const targets = [
    ["after", process.env.PREVIEW_URL || "http://127.0.0.1:4173"],
  ];
  if (process.env.BASELINE_URL)
    targets.unshift(["before", process.env.BASELINE_URL]);
  for (const [label, url] of targets) {
    for (const width of [360, 390, 768, 1440]) {
      for (const dark of [false, true]) {
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
        });
        await page.addInitScript(
          (dark) => localStorage.setItem("word-dark", String(dark)),
          dark,
        );
        const requests = [];
        page.on("response", (response) => {
          if (response.url().startsWith(url)) requests.push(response.url());
        });
        await page.goto(url);
        await page.locator(".scripture").waitFor();
        await page.evaluate(() => document.fonts.ready);
        const theme = dark ? "dark" : "light";
        await page.screenshot({
          path: `${directory}/${label}-${width}-${theme}.png`,
        });
        const metrics = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          resources: performance.getEntriesByType("resource").map((r) => ({
            url: r.name,
            bytes: /** @type {PerformanceResourceTiming} */ (r).encodedBodySize,
          })),
        }));
        report.push({ label, width, theme, requests, ...metrics });
        if (label === "after" && width === 390) {
          await page
            .getByRole("button", { name: "فتح القائمة", exact: true })
            .click();
          await page.screenshot({
            path: `${directory}/after-menu-${theme}.png`,
          });
          await page
            .getByRole("button", { name: "About the app", exact: true })
            .click();
          await page.locator(".about-content").waitFor();
          await page.screenshot({
            path: `${directory}/after-about-${theme}.png`,
          });
          await page
            .getByRole("button", { name: "إغلاق النافذة", exact: true })
            .click();
          await page
            .getByRole("button", { name: "فتح القائمة", exact: true })
            .click();
          await page
            .getByRole("dialog", { name: "القائمة", exact: true })
            .getByRole("button", { name: "رحلتي في ١٥٠ يومًا", exact: true })
            .click();
          await page.locator(".calendar-day").first().waitFor();
          await page.screenshot({
            path: `${directory}/after-calendar-${theme}.png`,
          });
          await page
            .getByRole("button", { name: "ابدأ رحلتك", exact: true })
            .click();
          await page.getByRole("heading", { name: "لنبدأ الرحلة" }).waitFor();
          await page.screenshot({
            path: `${directory}/after-dialog-${theme}.png`,
          });
        }
        await page.close();
      }
    }
  }
  await writeFile(
    "artifacts/preview-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    `Saved ${report.length} reading previews and supporting screens to ${directory}`,
  );
} finally {
  await browser.close();
}
