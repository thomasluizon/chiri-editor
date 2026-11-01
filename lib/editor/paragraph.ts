import type { EditorState } from "@codemirror/state";
import type { Range } from "@/lib/types";

/**
 * The paragraph around `pos`: the run of non-blank lines containing it.
 * Headings and list items are their own paragraph, so ⌘K on a bullet acts
 * on that bullet only.
 */
export function paragraphAt(state: EditorState, pos: number): Range {
  const doc = state.doc;
  const line = doc.lineAt(pos);
  if (isBlank(line.text) || isOwnBlock(line.text)) return { from: line.from, to: line.to };

  let first = line;
  while (first.number > 1) {
    const prev = doc.line(first.number - 1);
    if (isBlank(prev.text) || isOwnBlock(prev.text)) break;
    first = prev;
  }
  let last = line;
  while (last.number < doc.lines) {
    const next = doc.line(last.number + 1);
    if (isBlank(next.text) || isOwnBlock(next.text)) break;
    last = next;
  }
  return { from: first.from, to: last.to };
}

const isBlank = (text: string) => text.trim() === "";
const isOwnBlock = (text: string) => /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>)/.test(text);
