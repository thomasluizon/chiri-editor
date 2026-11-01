import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { previewSpans } from "@/lib/editor/livePreview";
import { setSuggestions, suggestionField } from "@/lib/editor/suggestions";
import type { Suggestion } from "@/lib/types";

const doc = [
  "# Title",
  "",
  "Some **bold** and _soft_ text with `code` and a [link](https://x.y).",
  "",
  "- first item",
  "- second item",
  "",
  "1. numbered",
  "",
  "> quoted ~~old~~ line",
].join("\n");

function stateWith(cursor = 0, suggestions: Suggestion[] = []) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage }), suggestionField],
  });
  return suggestions.length ? state.update({ effects: setSuggestions.of(suggestions) }).state : state;
}

/** What the reader sees: hidden spans removed, bullets drawn as "•". */
function rendered(state: EditorState, focused: boolean) {
  let out = "";
  let pos = 0;
  for (const s of previewSpans(state, focused)) {
    out += state.doc.sliceString(pos, s.from) + (s.kind === "bullet" ? "•" : "");
    pos = s.to;
  }
  return out + state.doc.sliceString(pos);
}

const line = (text: string, n: number) => text.split("\n")[n - 1];

describe("live preview", () => {
  it("hides every mark when the editor is not focused", () => {
    expect(rendered(stateWith(), false)).toBe(
      [
        "Title",
        "",
        "Some bold and soft text with code and a link.",
        "",
        "•first item",
        "•second item",
        "",
        "1. numbered",
        "",
        "quoted old line",
      ].join("\n"),
    );
  });

  it("shows the raw marks on the cursor's line only", () => {
    const at = doc.indexOf("bold");
    const out = rendered(stateWith(at), true);
    expect(line(out, 3)).toBe(line(doc, 3));
    expect(line(out, 1)).toBe("Title");
    expect(line(out, 5)).toBe("•first item");
  });

  it("reveals every line a selection spans", () => {
    const state = stateWith().update({
      selection: EditorSelection.range(doc.indexOf("first"), doc.indexOf("second")),
    }).state;
    const out = rendered(state, true);
    expect(line(out, 5)).toBe("- first item");
    expect(line(out, 6)).toBe("- second item");
    expect(line(out, 3)).toContain("Some bold");
  });

  it("keeps the doc text unchanged", () => {
    const state = stateWith();
    previewSpans(state, false);
    expect(state.doc.toString()).toBe(doc);
  });

  it("shows marks on a line where a suggestion touches a mark", () => {
    // deleting "**bold**" including its marks: the reader must see the asterisks go
    const from = doc.indexOf("**bold**");
    const s: Suggestion = { id: "a", from, to: from + 8, quote: "**bold**", replacement: "", reason: "" };
    const out = rendered(stateWith(0, [s]), false);
    expect(line(out, 3)).toBe(line(doc, 3));
  });

  it("keeps marks hidden when a suggestion only touches plain words", () => {
    const from = doc.indexOf("text with");
    const s: Suggestion = { id: "b", from, to: from + 4, quote: "text", replacement: "words", reason: "" };
    const out = rendered(stateWith(0, [s]), false);
    expect(line(out, 3)).toBe("Some bold and soft text with code and a link.");
  });
});
