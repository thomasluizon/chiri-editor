import { expect, test, type Page } from "@playwright/test";
import { getDoc, mockApi, open, response, select } from "./helpers";

/** SPEC §7.7, tests 44–47: the slash menu. */

const DOC = "# Notes\n\nThe quick brown fox jumps over the lazy dog.\n\nEnd of notes.";
const menu = (page: Page) => page.getByRole("listbox", { name: "AI actions" });
const highlighted = (page: Page) => menu(page).locator('[role="option"][aria-selected="true"]');

test("44. /tig filters to Tighten; Enter asks about the paragraph with the /tig already gone", async ({ page }) => {
  await open(page, DOC);
  const bodies = await mockApi(page, () => response([], "Reads well."));
  await select(page, DOC.indexOf("The quick"));
  await page.keyboard.type("/tig");

  await expect(menu(page)).toBeVisible();
  await expect(highlighted(page)).toContainText("Tighten");
  await page.keyboard.press("Enter");

  await expect.poll(() => bodies.length).toBe(1);
  const para = { from: DOC.indexOf("The quick"), to: DOC.indexOf("dog.") + 4 };
  expect(bodies[0]).toMatchObject({ mode: "suggest", instruction: "Tighten", scope: para, doc: DOC });
  expect(await getDoc(page)).toBe(DOC);
  await expect(menu(page)).toHaveCount(0);
});

test("45. arrows move the highlight; Enter on Review doc reviews the whole doc and removes the /", async ({ page }) => {
  await open(page, DOC);
  const bodies = await mockApi(page, () => response([], "Reads well."));
  await select(page, DOC.indexOf("End"));
  await page.keyboard.type("/");
  await expect(highlighted(page)).toContainText("Tighten");

  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowDown");
  await expect(highlighted(page)).toContainText("Review doc");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(highlighted(page)).toContainText("Review doc");
  await page.keyboard.press("Enter");

  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({ mode: "suggest", doc: DOC });
  expect("scope" in bodies[0]).toBe(false);
  expect(await getDoc(page)).toBe(DOC);
});

test("46. Esc closes the menu and leaves the / and the typed text", async ({ page }) => {
  await open(page, DOC);
  const bodies = await mockApi(page, () => response([], "Reads well."));
  await select(page, DOC.indexOf("End"));
  await page.keyboard.type("/ti");
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(menu(page)).toHaveCount(0);
  expect(await getDoc(page)).toBe(DOC.replace("End", "/tiEnd"));
  expect(bodies.length).toBe(0);
});

test("47. free text goes as the instruction; and/or, code and URLs never open the menu", async ({ page }) => {
  const doc = "# Notes\n\nCats and dogs.\n\nRun `npm a b` here.\n\nSee https://example.com now.";
  await open(page, doc);
  const bodies = await mockApi(page, () => response([], "Reads well."));

  await select(page, doc.indexOf("Cats"));
  await page.keyboard.type("/make it shorter");
  await expect(highlighted(page)).toContainText('Ask AI: "make it shorter"');
  await page.keyboard.press("Enter");
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({ instruction: "make it shorter", doc });
  await page.getByRole("dialog", { name: "Ask AI" }).getByRole("button", { name: /Close/ }).click();

  const noMenu = async (pos: number, text: string) => {
    await select(page, pos);
    await page.keyboard.type(text);
    await page.waitForTimeout(150);
    await expect(menu(page)).toHaveCount(0);
  };
  await noMenu((await getDoc(page)).indexOf(" dogs"), " and/or"); // and/or
  await noMenu((await getDoc(page)).indexOf("b`"), "/"); // inside inline code, after a space
  await noMenu((await getDoc(page)).indexOf(" now"), "/"); // https://example.com/
  expect(bodies.length).toBe(1);
});
