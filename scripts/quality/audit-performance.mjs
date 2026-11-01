import lighthouse from "lighthouse";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir("artifacts/lighthouse", { recursive: true });
const targets = [["after", process.env.PREVIEW_URL || "http://127.0.0.1:4173"]];
if (process.env.BASELINE_URL)
  targets.unshift(["before", process.env.BASELINE_URL]);
const summary = [];
for (const [label, url] of targets) {
  for (let run = 1; run <= 3; run++) {
    console.log(`Auditing ${label}, run ${run}/3`);
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--remote-debugging-port=9333",
      ],
    });
    try {
      const result = await lighthouse(url, {
        port: 9333,
        output: ["json", "html"],
        logLevel: "error",
        onlyCategories: ["performance", "accessibility"],
      });
      if (result.lhr.runtimeError)
        throw new Error(result.lhr.runtimeError.message);
      const { audits, categories } = result.lhr;
      const row = {
        label,
        run,
        performance: categories.performance.score * 100,
        accessibility: categories.accessibility.score * 100,
        lcpMs: audits["largest-contentful-paint"].numericValue,
        cls: audits["cumulative-layout-shift"].numericValue,
        totalBytes: audits["total-byte-weight"].numericValue,
      };
      summary.push(row);
      console.log(row);
      await writeFile(
        `artifacts/lighthouse/${label}-${run}.json`,
        result.report[0],
      );
      await writeFile(
        `artifacts/lighthouse/${label}-${run}.html`,
        result.report[1],
      );
    } finally {
      await browser.close();
    }
  }
}
await writeFile(
  "artifacts/lighthouse/summary.json",
  JSON.stringify(summary, null, 2),
);
