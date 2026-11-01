import { expect, test, type Page, type Route } from "@playwright/test";
import type { SuggestRequest, SuggestResponse } from "@/lib/types";
import { cards, DOC, FOX, getDoc, open, place, response, select } from "./helpers";

/**
 * Regression tests for the independent review's findings (request
 * lifecycle). Each failed before its fix.
 */

type Reply = { status?: number; json: SuggestResponse | { error: string }; delayMs?: number };

/** Answer /api/suggest calls in order with the given replies; returns the bodies seen. */
async function scriptApi(page: Page, replies: ((body: SuggestRequest) => Reply)[]) {
  const bodies: SuggestRequest[] = [];
  const failed: number[] = [];
  page.on("requestfailed", (r) => r.url().includes("/api/suggest") && failed.push(Date.now()));
  await page.route("**/api/suggest", async (route: Route) => {
    const body = route.request().postDataJSON() as SuggestRequest;
    const reply = replies[Math.min(bodies.length, replies.length - 1)](body);
    bodies.push(body);
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    await route.fulfill({ status: reply.status ?? 200, json: reply.json }).catch(() => {});
  });
  return { bodies, failed };
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "Ask AI" });

async function askOn(page: Page, doc: string, text: string) {
  await select(page, doc.indexOf(text) + 2);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(dialog(page)).toBeVisible();
}

test("R1. ⌘K on another paragraph while one is thinking: the old answer can't take over the new popover", async ({ page }) => {
  const doc = "First paragraph here.\n\nSecond paragraph here.";
  await open(page, doc);
  const api = await scriptApi(page, [() => ({ json: response([], "Old answer: reads well."), delayMs: 1500 })]);

  await askOn(page, doc, "First");
  await page.getByRole("button", { name: "Tighten" }).click();
  await expect(page.getByText("Thinking…")).toBeVisible();

  await askOn(page, doc, "Second"); // the user moves on before the first answer arrives
  await page.getByPlaceholder("Ask AI to edit this paragraph…").fill("make it punchier");
  await page.waitForTimeout(2000); // past the old answer's arrival

  await expect(dialog(page)).toBeVisible();
  await expect(page.getByPlaceholder("Ask AI to edit this paragraph…")).toHaveValue("make it punchier");
  await expect(dialog(page)).not.toContainText("Old answer");
  expect(api.failed.length).toBe(1); // the first request was cancelled, not left running
});

test("R2. 'Try again' sends the target where it is now, after typing during the failed request", async ({ page }) => {
  await open(page, FOX);
  const api = await scriptApi(page, [
    () => ({ status: 502, json: { error: "Model provider error: overloaded" }, delayMs: 1000 }),
    () => ({ json: response([], "Reads well.") }),
  ]);

  await askOn(page, FOX, "quick");
  await page.getByRole("button", { name: "Tighten" }).click();
  await expect(page.getByText("Thinking…")).toBeVisible();
  await select(page, 0);
  await page.keyboard.type("Hello world. ");

  await expect(dialog(page)).toContainText("overloaded");
  await dialog(page).getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => api.bodies.length).toBe(2);

  const now = await getDoc(page);
  const para = { from: now.indexOf("The quick"), to: now.length };
  expect(api.bodies[1]).toMatchObject({ mode: "suggest", instruction: "Tighten", scope: para });
  expect(now.slice(para.from, para.to)).toBe("The quick brown fox.");
});

test("R-nit. a target paragraph deleted during the request is never sent as an empty range", async ({ page }) => {
  await open(page, FOX);
  const api = await scriptApi(page, [
    () => ({ status: 502, json: { error: "Model provider error: overloaded" }, delayMs: 1000 }),
    () => ({ json: response([], "Reads well.") }),
  ]);

  await askOn(page, FOX, "quick");
  await page.getByRole("button", { name: "Tighten" }).click();
  await expect(page.getByText("Thinking…")).toBeVisible();
  await select(page, FOX.indexOf("The quick"), FOX.length); // select the whole paragraph…
  await page.keyboard.press("Backspace"); // …and delete it

  await expect(dialog(page)).toContainText("overloaded");
  await dialog(page).getByRole("button", { name: "Try again" }).click();
  await expect(dialog(page)).toContainText(/paragraph is gone/i);
  expect(api.bodies.length).toBe(1);
});

test("R5. a refinement that collides with another suggestion says so, instead of 'the text changed'", async ({ page }) => {
  await open(page, DOC);
  await scriptApi(page, [
    (b) => ({ json: response([place(b.doc, "pleased", "glad"), place(b.doc, "launch", "release")]) }),
    (b) => {
      // the rewrite reaches into the second suggestion's words
      const from = b.doc.indexOf("pleased");
      const to = b.doc.indexOf("launch") + "launch".length;
      return { json: response([{ id: "r", from, to, quote: b.doc.slice(from, to), replacement: "glad the release", reason: "r" }]) };
    },
  ]);

  await page.getByRole("button", { name: "Review doc" }).click();
  await expect(cards(page)).toHaveCount(2);
  await cards(page).nth(0).getByRole("button", { name: "Refine" }).click();
  await page.getByPlaceholder("How should it change?").fill("shorter");
  await page.keyboard.press("Enter");

  await expect(cards(page).nth(0)).toContainText(/overlaps another suggestion/i);
  await expect(cards(page).nth(0)).not.toContainText(/text changed/i);
  expect(await getDoc(page)).toBe(DOC);
});
