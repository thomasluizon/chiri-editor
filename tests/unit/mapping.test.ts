import { markdown } from "@codemirror/lang-markdown";
import { ChangeSet, EditorState, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { mapSuggestion } from "@/lib/editor/mapping";
import { paragraphAt } from "@/lib/editor/paragraph";
import type { Suggestion } from "@/lib/types";

const DOC = "Intro.\n\nThe quick brown fox.";

/** A suggestion on `quote` in DOC, as the server would place it. */
function on(quote: string, replacement = "X"): Suggestion {
  const from = DOC.indexOf(quote);
  return { id: "s", from, to: from + quote.length, quote, replacement, reason: "" };
}

/** Apply `changes` to DOC and map `s` through them, like a response arriving after edits. */
function after(s: Suggestion, ...specs: Parameters<typeof ChangeSet.of>[0][]) {
  let doc = Text.of(DOC.split("\n"));
  let composed = ChangeSet.empty(doc.length);
  for (const spec of specs) {
    const cs = ChangeSet.of(spec, doc.length);
    doc = cs.apply(doc);
    composed = composed.compose(cs);
  }
  return { mapped: mapSuggestion(s, composed, doc), doc: doc.toString() };
}

describe("SPEC 7.2: mapping positions", () => {
  it("11. text inserted before a suggestion shifts its range by the inserted length", () => {
    const s = on("quick brown");
    const { mapped, doc } = after(s, { from: 0, insert: "Hello world. " });
    expect(mapped).toMatchObject({ from: s.from + 13, to: s.to + 13 });
    expect(doc.slice(mapped!.from, mapped!.to)).toBe("quick brown");
  });

  it("11b. text typed right at a suggestion's start stays outside it", () => {
    const s = on("quick brown");
    const { mapped, doc } = after(s, { from: s.from, insert: "very " });
    expect(doc.slice(mapped!.from, mapped!.to)).toBe("quick brown");
  });

  it("12. text inserted after a suggestion leaves its range unchanged", () => {
    const s = on("quick brown");
    const { mapped } = after(s, { from: DOC.length, insert: " It ran." }, { from: s.to, insert: "ish" });
    expect(mapped).toMatchObject({ from: s.from, to: s.to });
  });

  it("13. an edit inside a suggestion's range makes it stale, so it's dropped", () => {
    const s = on("quick brown");
    const brown = DOC.indexOf("brown");
    expect(after(s, { from: brown, to: brown + 5, insert: "red" }).mapped).toBeNull();
    expect(after(s, { from: brown, insert: "dark " }).mapped).toBeNull(); // pure insertion inside
  });

  it("13b. a deletion that swallows an insertion point drops that insert suggestion", () => {
    const at = DOC.indexOf("fox");
    const insert: Suggestion = { id: "i", from: at, to: at, quote: "", replacement: "red ", reason: "" };
    expect(after(insert, { from: at - 6, to: at + 3 }).mapped).toBeNull();
  });

  it("14. a suggestion still applies correctly after several changes in a row", () => {
    const s = on("quick brown");
    const { mapped, doc } = after(
      s,
      { from: 0, insert: "# " }, // heading mark before
      { from: 2 + 6, insert: " Short." }, // after "Intro."
      { from: 0, to: 2 }, // and undone again
      { from: DOC.length + 7, insert: "!" }, // end of doc
    );
    expect(mapped).not.toBeNull();
    expect(doc.slice(mapped!.from, mapped!.to)).toBe("quick brown");
    const accepted = doc.slice(0, mapped!.from) + "X" + doc.slice(mapped!.to);
    expect(accepted).toBe("Intro. Short.\n\nThe X fox.!");
  });
});

describe("SPEC 7.2: the paragraph under the cursor (⌘K scope)", () => {
  const doc = [
    "# Title here", // 0
    "",
    "First line of a paragraph", // 2
    "that wraps onto a second line.", // 3
    "",
    "- item one",
    "- item two",
  ].join("\n");
  const state = EditorState.create({ doc, extensions: [markdown()] });
  const para = { from: doc.indexOf("First"), to: doc.indexOf("second line.") + "second line.".length };
  const text = (r: { from: number; to: number }) => doc.slice(r.from, r.to);

  it("15. start, middle and end of a paragraph all give the whole paragraph", () => {
    for (const pos of [para.from, doc.indexOf("wraps"), para.to]) expect(paragraphAt(state, pos)).toEqual(para);
  });

  it("15b. a list item is its own paragraph", () => {
    expect(text(paragraphAt(state, doc.indexOf("two")))).toBe("- item two");
  });

  it("15c. a heading is its own paragraph", () => {
    expect(text(paragraphAt(state, doc.indexOf("Title")))).toBe("# Title here");
  });
});
