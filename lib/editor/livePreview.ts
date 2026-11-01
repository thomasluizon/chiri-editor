import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, Range as DecoRange } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { Range } from "@/lib/types";
import { suggestionField } from "./suggestions";

/**
 * Live preview, like Obsidian's: Markdown marks are hidden except on the
 * lines being edited. The document text never changes; this only decides
 * which characters are drawn.
 *
 * A mark is shown when:
 *   - the editor has focus and a selection range touches its line, or
 *   - a suggestion touches any mark on that line (so the diff shows exactly
 *     what will change, syntax included).
 */

export type PreviewSpan = Range & { kind: "hide" | "bullet" };

/** Every mark live preview could hide inside `ranges`, before reveal rules. */
export function findMarks(state: EditorState, ranges: readonly Range[]): PreviewSpan[] {
  const doc = state.doc;
  const end = ranges.reduce((max, r) => Math.max(max, r.to), 0);
  const tree = ensureSyntaxTree(state, end, 50) ?? syntaxTree(state);
  const out: PreviewSpan[] = [];
  // a block mark takes the single space after it with it ("# ", "> ", "- ")
  const withSpace = (to: number) => (doc.sliceString(to, to + 1) === " " ? to + 1 : to);

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter(n) {
        const parent = n.node.parent;
        switch (n.name) {
          case "HeaderMark":
            if (parent?.name.startsWith("ATXHeading")) out.push({ from: n.from, to: withSpace(n.to), kind: "hide" });
            break;
          case "QuoteMark":
            out.push({ from: n.from, to: withSpace(n.to), kind: "hide" });
            break;
          case "ListMark":
            // bullets become a drawn dot; ordered list numbers stay as they are
            if (parent?.parent?.name === "BulletList") out.push({ from: n.from, to: withSpace(n.to), kind: "bullet" });
            break;
          case "EmphasisMark":
          case "StrikethroughMark":
            out.push({ from: n.from, to: n.to, kind: "hide" });
            break;
          case "CodeMark":
            if (parent?.name === "InlineCode") out.push({ from: n.from, to: n.to, kind: "hide" });
            break;
          case "LinkMark":
          case "URL":
          case "LinkTitle":
            // inline links only: [text](url) shows as "text". Reference links stay raw.
            if (parent?.name === "Link" && parent.getChild("URL")) out.push({ from: n.from, to: n.to, kind: "hide" });
            break;
        }
      },
    });
  }
  return dedupe(out);
}

/** Line numbers whose marks stay visible. */
export function revealedLines(state: EditorState, focused: boolean, marks: PreviewSpan[]): Set<number> {
  const doc = state.doc;
  const lines = new Set<number>();
  const addLines = (from: number, to: number) => {
    for (let n = doc.lineAt(from).number, last = doc.lineAt(to).number; n <= last; n++) lines.add(n);
  };

  if (focused) for (const r of state.selection.ranges) addLines(r.from, r.to);

  const items = state.field(suggestionField, false)?.items ?? [];
  for (const s of items) {
    // touching counts: deleting the text between "**" and "**" leaves "****"
    if (marks.some((m) => s.from <= m.to && s.to >= m.from)) addLines(s.from, s.to);
  }
  return lines;
}

/** The spans to hide or replace, after reveal rules. Pure; unit tested. */
export function previewSpans(state: EditorState, focused: boolean, ranges?: readonly Range[]): PreviewSpan[] {
  const marks = findMarks(state, ranges ?? [{ from: 0, to: state.doc.length }]);
  const reveal = revealedLines(state, focused, marks);
  return marks.filter((m) => !reveal.has(state.doc.lineAt(m.from).number));
}

function dedupe(spans: PreviewSpan[]): PreviewSpan[] {
  const seen = new Set<string>();
  return spans
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .filter((s) => {
      const key = `${s.from}:${s.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/* ---------- view ---------- */

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-bullet";
    el.setAttribute("aria-hidden", "true");
    el.textContent = "•";
    return el;
  }
}
const bullet = Decoration.replace({ widget: new BulletWidget() });
const hidden = Decoration.replace({});

function build(view: EditorView): DecorationSet {
  const spans = previewSpans(view.state, view.hasFocus, view.visibleRanges);
  const ranges: DecoRange<Decoration>[] = spans.map((s) => (s.kind === "bullet" ? bullet : hidden).range(s.from, s.to));
  return Decoration.set(ranges, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.focusChanged ||
        syntaxTree(u.state) !== syntaxTree(u.startState) ||
        u.state.field(suggestionField) !== u.startState.field(suggestionField)
      ) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
