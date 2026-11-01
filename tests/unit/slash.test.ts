import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { PRESET_LABELS } from "@/lib/prompts";
import { slashField, slashItems, slashState } from "@/lib/editor/slash";

/** Type `text` at `pos` the way the keyboard does, one character per transaction. */
function typeAt(doc: string, pos: number, text: string) {
  let state = EditorState.create({ doc, selection: { anchor: pos }, extensions: [markdown({ base: markdownLanguage }), slashState] });
  for (const ch of text) {
    const at = state.selection.main.head;
    state = state.update({ changes: { from: at, insert: ch }, selection: { anchor: at + 1 }, userEvent: "input.type" }).state;
  }
  return state;
}
const isOpen = (s: EditorState) => s.field(slashField) !== null;

describe("SPEC 7.7: slash menu", () => {
  it("42. opens at the start of a line or after a space", () => {
    expect(isOpen(typeAt("Hello\n", 6, "/"))).toBe(true); // start of an empty line
    expect(isOpen(typeAt("Some text", 0, "/"))).toBe(true); // start of a line with text
    expect(isOpen(typeAt("Some text", 4, " /"))).toBe(true); // after a space
    expect(typeAt("Some text", 9, " /tig").field(slashField)).toMatchObject({ query: "tig" });
  });

  it("42b. never opens after a non-space, in code, or in a URL", () => {
    expect(isOpen(typeAt("and", 3, "/or"))).toBe(false); // and/or
    expect(isOpen(typeAt("1", 1, "/2"))).toBe(false); // 1/2
    const inline = "Run `npm a b` now";
    expect(isOpen(typeAt(inline, inline.indexOf("b`"), "/"))).toBe(false); // inside inline code, after a space
    const fenced = "Text\n\n```\nline\n\n```\n";
    expect(isOpen(typeAt(fenced, fenced.indexOf("line\n\n") + 5, "/"))).toBe(false); // empty line in a code block
    const url = "See https://example.com now";
    expect(isOpen(typeAt(url, url.indexOf(" now"), "/"))).toBe(false); // https://example.com/
    const link = "A [link](https://a.com) here";
    expect(isOpen(typeAt(link, link.indexOf(")"), "/"))).toBe(false); // in a link destination
  });

  it("42c. closes when the / is deleted or the cursor leaves it", () => {
    let s = typeAt("Text", 4, " /ti");
    expect(isOpen(s)).toBe(true);
    s = s.update({ selection: { anchor: 0 } }).state;
    expect(isOpen(s)).toBe(false);
    s = typeAt("Text", 4, " /");
    s = s.update({ changes: { from: 5, to: 6 } }).state; // delete the /
    expect(isOpen(s)).toBe(false);
  });

  it("43. items are PRESET_LABELS in order, then Review doc, then Ask AI…; typing filters; free text last", () => {
    const all = slashItems("");
    expect(all.slice(0, PRESET_LABELS.length).map((i) => i.label)).toEqual([...PRESET_LABELS]);
    expect(all.slice(PRESET_LABELS.length).map((i) => i.kind)).toEqual(["review", "ask"]);

    const tig = slashItems("TIG");
    expect(tig.map((i) => i.label)).toEqual(["Tighten", 'Ask AI: "TIG"']);
    expect(tig[0]).toMatchObject({ kind: "preset", instruction: "Tighten" });
    expect(tig[1]).toMatchObject({ kind: "free", instruction: "TIG" });

    expect(slashItems("make it shorter").map((i) => i.kind)).toEqual(["free"]);
    expect(slashItems("rev")[0]).toMatchObject({ kind: "review" });
  });
});
