import { expect, test } from "@playwright/test";
import { cards, del, DOC, FOX, getDoc, ins, mockApi, open, place, response, select } from "./helpers";

/**
 * SPEC §7.4, tests 21–32. /api/suggest is intercepted in the browser, so
 * these never reach a model. The raw Markdown is read through
 * window.__view (dev builds only), because live preview hides marks.
 */

/* ---------- tests ---------- */

test("21. Review doc, then accept: doc unchanged until Accept", async ({ page }) => {
  await open(page, DOC);
  const bodies = await mockApi(page, (b) => response([place(b.doc, "We are pleased to share that the", "The")]));

  await page.getByRole("button", { name: "Review doc" }).click();
  await expect(del(page)).toHaveText("We are pleased to share that the");
  await expect(ins(page)).toHaveText("The");

  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ mode: "suggest", doc: DOC });
  expect("scope" in bodies[0]).toBe(false);
  expect(await getDoc(page)).toBe(DOC);

  await cards(page).getByRole("button", { name: /Accept/ }).click();
  expect(await getDoc(page)).toBe("# Plan\n\nThe launch is done.\n\nMore later.");
  await expect(cards(page)).toHaveCount(0);
});

test("22. ⌘K with no selection scopes to exactly the paragraph under the cursor", async ({ page }) => {
  await open(page, DOC);
  const bodies = await mockApi(page, () => response([], "Reads well."));
  const para = { from: DOC.indexOf("We are"), to: DOC.indexOf("done.") + 5 };

  await select(page, DOC.indexOf("launch"));
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Ask AI" })).toBeVisible();
  await page.getByRole("button", { name: "Tighten" }).click();

  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({ mode: "suggest", instruction: "Tighten", scope: para });
  expect(DOC.slice(para.from, para.to)).toBe("We are pleased to share that the launch is done.");
});

test("23. Esc rejects the suggestion under the cursor; elsewhere it does what CodeMirror does", async ({ page }) => {
  await open(page, DOC);
  await mockApi(page, (b) => response([place(b.doc, "pleased to share", "glad to say")]));
  await page.getByRole("button", { name: "Review doc" }).click();
  await expect(cards(page)).toHaveCount(1);

  // outside a suggestion: Esc collapses a selection (CodeMirror's simplifySelection) and rejects nothing
  await select(page, DOC.indexOf("More"), DOC.indexOf("later"));
  await page.keyboard.press("Escape");
  await expect(cards(page)).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { __view: { state: { selection: { main: { empty: boolean } } } } }).__view.state.selection.main.empty)).toBe(true);

  // inside: Esc rejects, and the doc is byte-for-byte unchanged
  await select(page, DOC.indexOf("pleased") + 3);
  await page.keyboard.press("Escape");
  await expect(cards(page)).toHaveCount(0);
  expect(await getDoc(page)).toBe(DOC);
});

test("24. ⌥↵ accepts only inside a suggestion; ⌘↵ still inserts a blank line", async ({ page }) => {
  await open(page, DOC);
  await mockApi(page, (b) => response([place(b.doc, "pleased to share", "glad to say")]));
  await page.getByRole("button", { name: "Review doc" }).click();
  await expect(cards(page)).toHaveCount(1);

  await select(page, DOC.indexOf("More"));
  await page.keyboard.press("Alt+Enter");
  await expect(cards(page)).toHaveCount(1);
  expect(await getDoc(page)).toContain("pleased to share");

  await select(page, DOC.indexOf("pleased") + 2);
  await page.keyboard.press("Alt+Enter");
  await expect(cards(page)).toHaveCount(0);
  expect(await getDoc(page)).toContain("We are glad to say that");

  const before = (await getDoc(page)).split("\n").length;
  await select(page, (await getDoc(page)).indexOf("More"));
  await page.keyboard.press("ControlOrMeta+Enter");
  expect((await getDoc(page)).split("\n").length).toBe(before + 1);
});

test("25. Tab still indents a list item while a suggestion is showing in the list", async ({ page }) => {
  const doc = "# List\n\n- first item\n- second item";
  await open(page, doc);
  await mockApi(page, (b) => response([place(b.doc, "second", "2nd")]));
  await page.getByRole("button", { name: "Review doc" }).click();
  await expect(del(page)).toHaveText("second");

  await select(page, doc.indexOf("- first"));
  await page.keyboard.press("Tab");
  expect(await getDoc(page)).toMatch(/\n\s+- first item\n- second item$/);
  await expect(del(page)).toHaveText("second"); // the suggestion moved with the text
});

test("26. Refine sends mode refine with history and updates the suggestion in place", async ({ page }) => {
  await open(page, DOC);
  const bodies = await mockApi(page, (b) => {
    if (b.mode === "refine") {
      const next = b.target.history.length ? "Short" : "Shorter version";
      return response([{ ...place(b.doc, b.target.quote, next), from: b.target.from, to: b.target.to }], "Refined.");
    }
    return response([place(b.doc, "We are pleased to share that the", "We're happy that the")]);
  });
  await page.getByRole("button", { name: "Review doc" }).click();
  await expect(ins(page)).toHaveText("We're happy that the");

  await cards(page).getByRole("button", { name: "Refine" }).click();
  await page.getByPlaceholder("How should it change?").fill("shorter");
  await page.keyboard.press("Enter");
  await expect(ins(page)).toHaveText("Shorter version");
  await expect(del(page)).toHaveText("We are pleased to share that the"); // same place

  const first = bodies[1];
  expect(first).toMatchObject({ mode: "refine", instruction: "shorter" });
  if (first.mode !== "refine") throw new Error("expected refine");
  expect(first.target).toMatchObject({ quote: "We are pleased to share that the", replacement: "We're happy that the", history: [] });

  await cards(page).getByRole("button", { name: "Refine" }).click();
  await page.getByPlaceholder("How should it change?").fill("even shorter");
  await page.keyboard.press("Enter");
  await expect(ins(page)).toHaveText("Short");
  const second = bodies[2];
  if (second.mode !== "refine") throw new Error("expected refine");
  expect(second.target.history).toEqual([{ instruction: "shorter", replacement: "Shorter version" }]);
  expect(second.target.replacement).toBe("Shorter version");
  await expect(cards(page)).toContainText("refined 2×");
});

test("27. zero suggestions: the note is shown and nothing is decorated", async ({ page }) => {
  await open(page, DOC);
  await mockApi(page, () => response([], "This reads well; nothing to change."));
  await page.getByRole("button", { name: "Review doc" }).click();
  await expect(page.locator(".topbar__status")).toHaveText("This reads well; nothing to change.");
  await expect(del(page)).toHaveCount(0);
  await expect(ins(page)).toHaveCount(0);
});

test("28. typing while a request is running: the suggestion follows the text", async ({ page }) => {
  await open(page, FOX);
  await mockApi(page, (b) => response([place(b.doc, "quick brown fox", "fast auburn fox")]), 1500);

  await page.getByRole("button", { name: "Review doc" }).click();
  await select(page, 0);
  await page.keyboard.type("Hello world. ");
  await expect(page.locator(".cm-thinking").first()).toBeVisible(); // still waiting while we typed

  await expect(del(page)).toHaveText("quick brown fox"); // moved 13 characters, still on the right words
  expect(await getDoc(page)).toBe("Hello world. Intro.\n\nThe quick brown fox.");

  await cards(page).getByRole("button", { name: /Accept/ }).click();
  expect(await getDoc(page)).toBe("Hello world. Intro.\n\nThe fast auburn fox.");
});

test("29. typing inside the target while a request runs drops that suggestion, keeps the others", async ({ page }) => {
  await open(page, FOX);
  await mockApi(
    page,
    (b) => response([place(b.doc, "quick brown fox", "fast auburn fox"), place(b.doc, "Intro.", "Introduction.")]),
    1500,
  );

  await page.getByRole("button", { name: "Review doc" }).click();
  const brown = FOX.indexOf("brown");
  await select(page, brown, brown + 5);
  await page.keyboard.type("red");

  await expect(cards(page)).toHaveCount(1);
  await expect(del(page)).toHaveText("Intro.");
  await expect(page.locator(".topbar__status")).toContainText(/1 suggestion couldn.t be placed/);
  expect(await getDoc(page)).toBe("Intro.\n\nThe quick red fox.");
});

test("30. editing inside a suggestion that's showing removes it", async ({ page }) => {
  await open(page, FOX);
  await mockApi(page, (b) => response([place(b.doc, "quick brown fox", "fast auburn fox")]));
  await page.getByRole("button", { name: "Review doc" }).click();
  await expect(cards(page)).toHaveCount(1);

  await select(page, FOX.indexOf("brown") + 2);
  await page.keyboard.type("x");
  await expect(cards(page)).toHaveCount(0);
  await expect(del(page)).toHaveCount(0);
});

test("31. undo after accept puts the original text back", async ({ page }) => {
  await open(page, FOX);
  await mockApi(page, (b) => response([place(b.doc, "quick brown fox", "fast auburn fox")]));
  await page.getByRole("button", { name: "Review doc" }).click();
  await cards(page).getByRole("button", { name: /Accept/ }).click();
  expect(await getDoc(page)).toBe("Intro.\n\nThe fast auburn fox.");

  await select(page, 0);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await getDoc(page)).toBe(FOX);
});

test("32. Cancel aborts the request and no suggestions appear", async ({ page }) => {
  await open(page, DOC);
  await mockApi(page, (b) => response([place(b.doc, "pleased to share", "glad to say")]), 2000);
  const failed: string[] = [];
  page.on("requestfailed", (r) => r.url().includes("/api/suggest") && failed.push(r.failure()?.errorText ?? ""));

  await select(page, DOC.indexOf("launch"));
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("button", { name: "Tighten" }).click();
  await expect(page.getByText("Thinking…")).toBeVisible();
  await page.getByRole("dialog", { name: "Ask AI" }).getByRole("button", { name: /Cancel/ }).click();

  await expect(page.getByRole("dialog", { name: "Ask AI" })).toHaveCount(0);
  await expect.poll(() => failed.length).toBe(1);
  await page.waitForTimeout(2500); // past the mocked response time
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator(".cm-thinking")).toHaveCount(0);
  expect(await getDoc(page)).toBe(DOC);
});
