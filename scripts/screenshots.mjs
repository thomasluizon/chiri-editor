// Design review screenshots at 1440 and 390, light and dark, driving the real UI
// with /api/suggest mocked in the browser (no model calls).
// Usage: npm run screenshots -- http://localhost:3000
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";
const out = "design/screenshots";
mkdirSync(out, { recursive: true });

const widths = [
  { name: "1440", width: 1440, height: 960, scale: 1 },
  { name: "390", width: 390, height: 844, scale: 2 },
];

/** Three suggestions on the sample doc, placed the way the server places them. */
function fakeReview(doc) {
  const at = (quote, replacement, reason, anchor) => {
    const from = anchor ? doc.indexOf(anchor) + anchor.length : doc.indexOf(quote);
    return { id: quote || anchor, from, to: from + quote.length, quote, replacement, reason };
  };
  return {
    note: "Opened with the news and cut a repeated clause.",
    suggestions: [
      at("We are pleased to share that, after a great deal of work across several teams over the past quarter, the", "The", "Lead with the news. The effort behind it can come later, if at all."),
      at(", and it was something that a lot of people found confusing", "", "Says the first half of the sentence again."),
      at("", " in October", "Give the rollout a date so other teams can plan around it.", "existing workspaces"),
    ],
    dropped: [],
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 1 },
  };
}

const settle = (page) =>
  page.waitForFunction(() =>
    document.getAnimations().every((a) => a.effect.getTiming().iterations === Infinity || a.playState === "finished"),
  );

const browser = await chromium.launch();
for (const w of widths) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: w.scale, colorScheme: theme });
    const page = await ctx.newPage();
    let hang = false;
    await page.route("**/api/suggest", async (route) => {
      if (hang) return; // leave the ⌘K request pending to show the thinking state
      await route.fulfill({ json: fakeReview(route.request().postDataJSON().doc) });
    });

    // default: after Review doc
    await page.goto(base, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole("button", { name: "Review doc" }).click();
    await page.locator(".cm-sg-del").first().waitFor();
    await page.evaluate(() => {
      const v = window.__view;
      const at = v.state.doc.toString().indexOf("pleased");
      v.dispatch({ selection: { anchor: at }, userEvent: "select" }); // first suggestion active
    });
    await page.evaluate(() => document.activeElement.blur());
    await settle(page);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/default-${w.name}-${theme}.png` });

    // ask: ⌘K on the "New accounts" paragraph
    await page.evaluate(() => {
      const v = window.__view;
      v.focus();
      v.dispatch({ selection: { anchor: v.state.doc.toString().indexOf("three-step") }, userEvent: "select" });
    });
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("dialog", { name: "Ask AI" }).waitFor();
    await settle(page);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/ask-${w.name}-${theme}.png` });

    // thinking: submit and leave the request hanging
    hang = true;
    await page.getByRole("button", { name: "Tighten" }).click();
    await page.getByText("Thinking…").waitFor();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/thinking-${w.name}-${theme}.png` });

    console.log(`${w.name} ${theme}: default, ask, thinking`);
    await ctx.close();
  }
}
await browser.close();
