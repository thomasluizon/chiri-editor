// Design review screenshots: every state at 1440 and 390 wide, light and dark.
// Usage: npm run screenshots [-- http://localhost:3000]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";
const out = "design/screenshots";
mkdirSync(out, { recursive: true });

const widths = [
  { name: "1440", width: 1440, height: 960, scale: 1 },
  { name: "390", width: 390, height: 844, scale: 2 },
];
const themes = ["light", "dark"];
const states = ["default", "ask", "thinking"];

const browser = await chromium.launch();
for (const w of widths) {
  for (const theme of themes) {
    const ctx = await browser.newContext({
      viewport: { width: w.width, height: w.height },
      deviceScaleFactor: w.scale,
      colorScheme: theme,
      reducedMotion: "no-preference",
    });
    const page = await ctx.newPage();
    for (const state of states) {
      await page.goto(`${base}/?state=${state}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      // wait until every finite animation (card/popover enter) is done; shimmer loops forever
      await page.waitForFunction(() =>
        document.getAnimations().every((a) => a.effect.getTiming().iterations === Infinity || a.playState === "finished"),
      );
      await page.waitForTimeout(250);
      const file = `${out}/${state}-${w.name}-${theme}.png`;
      await page.screenshot({ path: file });
      console.log(file);
    }
    await ctx.close();
  }
}
await browser.close();
