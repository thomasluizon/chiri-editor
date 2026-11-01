// One real run through the app, against the real API (costs money, ~1¢):
// Review doc → accept one → reject one → refine one twice → type while ⌘K runs.
// Screenshots each step into design/screenshots/live/. Stops after 6 model calls.
// Usage: node scripts/live-walkthrough.mjs http://localhost:3000
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";
// --mock: rehearse the walkthrough with fake answers, no model calls
const mock = process.argv.includes("--mock");
const out = "design/screenshots/live";
const MAX_CALLS = 6;
mkdirSync(out, { recursive: true });

function fakeAnswer(body) {
  const d = body.doc;
  const at = (quote, replacement) => ({ id: `${quote}-${replacement}`, from: d.indexOf(quote), to: d.indexOf(quote) + quote.length, quote, replacement, reason: "Mock." });
  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 1 };
  if (body.mode === "refine")
    return { note: "Mock refine.", suggestions: [{ ...at(body.target.quote, `${body.instruction}!`), from: body.target.from, to: body.target.to }], dropped: [], usage };
  if (body.scope) {
    const text = d.slice(body.scope.from, body.scope.to);
    const word = text.split(" ")[2];
    return { note: "Mock tighten.", suggestions: [{ ...at(word, word.toUpperCase()), from: body.scope.from + text.indexOf(word), to: body.scope.from + text.indexOf(word) + word.length }], dropped: [], usage };
  }
  return { note: "Mock review.", suggestions: [at("We are pleased", "We're glad"), at("in many ways, ", "")], dropped: [], usage };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, colorScheme: "light" });
const log = [];
let calls = 0;

await page.route("**/api/suggest", async (route) => {
  if (++calls > MAX_CALLS) return route.abort(); // budget guard
  const body = route.request().postDataJSON();
  const started = Date.now();
  const res = mock ? null : await route.fetch();
  const json = mock ? fakeAnswer(body) : await res.json();
  if (mock) await new Promise((r) => setTimeout(r, 1200));
  const status = res ? res.status() : 200;
  log.push({ call: calls, mode: body.mode, scope: !!body.scope, instruction: body.instruction, status, ms: Date.now() - started, json });
  const brief = json.error ?? `${json.suggestions.length} placed, ${json.dropped.length} dropped, $${json.usage.costUsd?.toFixed(4)}`;
  console.log(`  api #${calls} ${body.mode}${body.scope ? " (scoped)" : ""}: HTTP ${status} in ${Date.now() - started} ms · ${brief}`);
  await route.fulfill(res ? { response: res, json } : { json }).catch(() => {});
});
page.on("pageerror", (e) => console.log("  pageerror:", e.message));
page.on("console", (m) => m.type() === "error" && console.log("  console error:", m.text()));

const shot = async (name) => {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`shot ${name} (scrollY ${await page.evaluate(() => Math.round(window.scrollY))})`);
};
// Pause like a person before each action. Clicking mid-animation (cards slide for
// 200 ms, the popover fades in) makes Playwright scroll to chase the moving target.
const human = () => page.waitForTimeout(450);
const doc = () => page.evaluate(() => window.__view.state.doc.toString());
const cards = page.locator(".sg-card");
const select = (pos) =>
  page.evaluate((p) => {
    window.__view.focus();
    window.__view.dispatch({ selection: { anchor: p }, userEvent: "select" });
  }, pos);

await page.goto(base, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const original = await doc();
await shot("01-start");

// 1. Review doc (Sonnet)
await page.getByRole("button", { name: "Review doc" }).click();
await page.waitForTimeout(900);
await shot("02-reviewing");
await page.locator(".topbar__status:not(:has(.shimmer-text))").waitFor({ timeout: 45_000 });
await page.waitForFunction(() => !document.querySelector(".cm-thinking"));
const n = await cards.count();
console.log(`review placed ${n} suggestions`);
await shot("03-suggestions");
if (n < 1) throw new Error("the review placed no suggestions");

// 2. accept the first card
await human();
await cards.nth(0).getByRole("button", { name: /Accept/ }).click();
await shot("04-accepted");

// 3. reject the (new) first card
if ((await cards.count()) > 0) {
  await human();
  await cards.nth(0).getByRole("button", { name: /Reject/ }).click();
  await shot("05-rejected");
}

/** ⌘K "Tighten" on the first candidate paragraph that has no suggestion in it. */
const askOn = async (candidates) => {
  for (const c of candidates) {
    const line = page.locator(".cm-line", { hasText: c.slice(0, 18) }).first();
    if ((await line.count()) && (await line.locator(".cm-sg-del, .cm-sg-ins").count()) === 0) {
      console.log(`⌘K target: "${c}…"`);
      await select((await doc()).indexOf(c) + 5);
      await human();
      await page.keyboard.press("ControlOrMeta+k");
      await human();
      await page.getByRole("button", { name: "Tighten" }).click();
      await page.getByText("Thinking…").waitFor();
      return c;
    }
  }
  throw new Error("no paragraph without suggestions for ⌘K");
};
const PARAS = ["New accounts now land", "We also simplified", "Thanks to everyone", "If anything in the new flow"];

// the review may leave nothing to refine (it's told fewer is better): get one from ⌘K
if ((await cards.count()) === 0) {
  await askOn(PARAS);
  await page.waitForFunction(() => !document.querySelector(".cm-thinking"), null, { timeout: 30_000 });
  await shot("05b-ask-for-something-to-refine");
  if ((await cards.count()) === 0) throw new Error("⌘K placed nothing to refine");
}

// 4. refine the remaining first card twice (Haiku)
const refineOnce = async (instruction, name) => {
  const card = cards.nth(0);
  await human();
  await card.getByRole("button", { name: "Refine" }).click();
  await human();
  await page.getByPlaceholder("How should it change?").fill(instruction);
  await shot(`${name}-asking`);
  const before = calls;
  await page.keyboard.press("Enter");
  await page.waitForFunction((b) => b < 0, -1); // yield once
  await page.locator(".sg-card.is-thinking").waitFor({ state: "attached", timeout: 5_000 }).catch(() => {});
  await page.locator(".sg-card.is-thinking").waitFor({ state: "detached", timeout: 30_000 });
  if (calls === before) throw new Error("refine sent no request");
  await shot(name);
};
await refineOnce("shorter", "06-refined-1");
await refineOnce("more formal", "07-refined-2");

// 5. ⌘K Tighten on a paragraph without suggestions, typing above it while it runs (Haiku)
await askOn(PARAS);
const h1End = (await doc()).indexOf("\n");
await select(h1End);
await page.keyboard.type(" (draft)", { delay: 25 });
await shot("08-typing-while-thinking");
await page.waitForFunction(() => !document.querySelector(".cm-thinking"), null, { timeout: 30_000 });
await shot("09-after-typing");

const final = await doc();
writeFileSync(`${out}/run.json`, JSON.stringify({ original, final, log }, null, 2));
console.log(`typed text kept: ${final.split("\n")[0].endsWith(" (draft)")}`);
console.log(`model calls: ${calls}`);
await browser.close();
