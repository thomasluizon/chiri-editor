import { type Page, type Route } from "@playwright/test";
import type { SuggestRequest, SuggestResponse } from "@/lib/types";

/** Shared e2e helpers. The raw Markdown is read through window.__view (dev builds only). */

export type Placed = SuggestResponse["suggestions"][number];

export const DOC = "# Plan\n\nWe are pleased to share that the launch is done.\n\nMore later.";
export const FOX = "Intro.\n\nThe quick brown fox.";

/* ---------- helpers ---------- */

export async function open(page: Page, doc: string) {
  await page.addInitScript((d) => localStorage.setItem("draft:doc", d), doc);
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { __view?: unknown }).__view);
}

export const getDoc = (page: Page) =>
  page.evaluate(() => (window as unknown as { __view: { state: { doc: { toString(): string } } } }).__view.state.doc.toString());

/** Put the cursor (or a selection) in the editor and focus it, like a click would. */
export async function select(page: Page, anchor: number, head = anchor) {
  await page.evaluate(
    ([a, h]) => {
      const v = (window as unknown as { __view: { dispatch(t: object): void; focus(): void } }).__view;
      v.focus();
      v.dispatch({ selection: { anchor: a, head: h }, userEvent: "select" });
    },
    [anchor, head],
  );
}

export function place(doc: string, quote: string, replacement: string, reason = "Because."): Placed {
  const from = doc.indexOf(quote);
  if (from < 0) throw new Error(`quote not in doc: ${quote}`);
  return { id: `id-${quote}-${replacement}`, from, to: from + quote.length, quote, replacement, reason };
}

export const response = (suggestions: Placed[], note = "Two small fixes.", dropped: SuggestResponse["dropped"] = []): SuggestResponse => ({
  note,
  suggestions,
  dropped,
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 1 },
});

/** Intercept /api/suggest. Returns the request bodies seen so far. */
export async function mockApi(page: Page, answer: (body: SuggestRequest) => SuggestResponse, delayMs = 0) {
  const bodies: SuggestRequest[] = [];
  await page.route("**/api/suggest", async (route: Route) => {
    const body = route.request().postDataJSON() as SuggestRequest;
    bodies.push(body);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ json: answer(body) }).catch(() => {}); // the client may have aborted
  });
  return bodies;
}

export const del = (page: Page) => page.locator(".cm-sg-del");
export const ins = (page: Page) => page.locator(".cm-sg-ins");
export const cards = (page: Page) => page.locator(".sg-card");
