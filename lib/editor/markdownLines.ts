import { syntaxTree } from "@codemirror/language";
import type { Range as DecoRange } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";

/**
 * Line-level styling for Markdown blocks. Headings are sized on the line (not
 * the text span), so their `#` marks scale with them while staying dimmed.
 * Blank lines get a shorter height so paragraph gaps read like a document,
 * not like an empty line of code.
 */
const lineClass: Record<string, string> = {
  ATXHeading1: "cm-h1",
  SetextHeading1: "cm-h1",
  ATXHeading2: "cm-h2",
  SetextHeading2: "cm-h2",
  ATXHeading3: "cm-h3",
  ATXHeading4: "cm-h4",
  ATXHeading5: "cm-h4",
  ATXHeading6: "cm-h4",
  Blockquote: "cm-quote",
  FencedCode: "cm-codeblock",
  ListItem: "cm-li",
};

function build(view: EditorView): DecorationSet {
  const ranges: DecoRange<Decoration>[] = [];
  const doc = view.state.doc;
  const seen = new Set<string>();

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        const cls = lineClass[node.name];
        if (!cls) return;
        // a list item's own line only; nested lines are handled by their own nodes
        const last = node.name === "ListItem" ? doc.lineAt(node.from) : doc.lineAt(node.to);
        for (let n = doc.lineAt(node.from).number; n <= last.number; n++) {
          const line = doc.line(n);
          const key = `${line.from}:${cls}`;
          if (seen.has(key)) continue;
          seen.add(key);
          ranges.push(Decoration.line({ class: cls }).range(line.from));
        }
      },
    });

    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      if (line.text.trim() === "") ranges.push(Decoration.line({ class: "cm-gap" }).range(line.from));
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

export const markdownLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
