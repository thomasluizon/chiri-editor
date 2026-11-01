import { expect, test, type Page, type Route } from "@playwright/test";
import type { SuggestRequest, SuggestResponse } from "@/lib/types";
import { cards, DOC, getDoc, open, place, response, select } from "./helpers";

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
