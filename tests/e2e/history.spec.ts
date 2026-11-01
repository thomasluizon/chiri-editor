import { expect, test, type Page } from "@playwright/test";
import { cards, getDoc, mockApi, open, place, response, select } from "./helpers";

/** SPEC §7.6, tests 38–41: the AI history panel. */

const DOC = "# Notes\n\nWe are pleased to share the news.\n\nThe launch is done.\n\nMore later.";

const panel = (page: Page) => page.getByRole("dialog", { name: "AI history" });
const openPanel = (page: Page) => page.getByRole("button", { name: /AI history/ }).click();

/** Review → two suggestions → accept the first, reject the second. */
async function acceptOneRejectOne(page: Page) {
  await mockApi(page, (b) =>
    response([place(b.doc, "We are pleased to share", "Here is"), place(b.doc, "More later.", "That's all.")]),
  );
  await page.getByRole("button", { name: "Review doc" }).click();
  await expect(cards(page)).toHaveCount(2);
  await cards(page).nth(0).getByRole("button", { name: /Accept/ }).click();
  await cards(page).nth(0).getByRole("button", { name: /Reject/ }).click();
  await expect(cards(page)).toHaveCount(0);
}

const ACCEPTED_DOC = DOC.replace("We are pleased to share", "Here is");

test("38. the panel lists accepted and rejected changes, newest first; Esc closes it", async ({ page }) => {
  await open(page, DOC);
  await acceptOneRejectOne(page);
  await openPanel(page);

  const items = panel(page).getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveClass(/is-rejected/); // newest first
  await expect(items.nth(0)).toContainText("Rejected");
  const accepted = items.nth(1);
  await expect(accepted.locator(".hist-before")).toHaveText("We are pleased to share");
  await expect(accepted.locator(".hist-after")).toHaveText("Here is");
  await expect(accepted).toContainText("Because."); // the reason
  await expect(accepted).toContainText("Sonnet 5.5"); // the model
  await expect(accepted.getByRole("button", { name: "Revert" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
});

test("39. revert after editing elsewhere restores the original exactly and keeps the other edit", async ({ page }) => {
  await open(page, DOC);
  await acceptOneRejectOne(page);
  await select(page, (await getDoc(page)).indexOf("done") + 4);
  await page.keyboard.type(" today");

  await openPanel(page);
  await panel(page).getByRole("button", { name: "Revert" }).click();
  await expect(panel(page).getByText("Reverted")).toBeVisible();
  expect(await getDoc(page)).toBe(DOC.replace("is done.", "is done today."));
});

test("40. revert after the accepted text changed says so and changes nothing", async ({ page }) => {
  await open(page, DOC);
  await acceptOneRejectOne(page);
  await select(page, ACCEPTED_DOC.indexOf("Here is") + 4);
  await page.keyboard.type(" really");
  const before = await getDoc(page);

  await openPanel(page);
  await panel(page).getByRole("button", { name: "Revert" }).click();
  await expect(panel(page)).toContainText("text changed since");
  expect(await getDoc(page)).toBe(before);
});

test("41. history survives a reload; Clear empties it for good", async ({ page }) => {
  await open(page, DOC);
  await acceptOneRejectOne(page);
  await page.waitForTimeout(600); // autosave debounce
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as { __view?: unknown }).__view);

  await openPanel(page);
  await expect(panel(page).getByRole("listitem")).toHaveCount(2);
  // still revertible after the reload: the range was saved with the doc
  await panel(page).getByRole("button", { name: "Revert" }).click();
  expect(await getDoc(page)).toBe(DOC);

  await panel(page).getByRole("button", { name: "Clear" }).click();
  await panel(page).getByRole("button", { name: "Yes, clear" }).click();
  await expect(panel(page).getByRole("listitem")).toHaveCount(0);
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as { __view?: unknown }).__view);
  await openPanel(page);
  await expect(panel(page).getByRole("listitem")).toHaveCount(0);
  await expect(panel(page)).toContainText("show up here");
});
