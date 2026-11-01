import type { ChangeDesc, Text } from "@codemirror/state";
import type { Range, Suggestion } from "@/lib/types";

/**
 * True if any change in `changes` edits text inside [from, to], or, for an
 * empty range, replaces text across that point. Typing directly before or
 * after a range does not count; it only shifts the range.
 */
export function changeTouches(changes: ChangeDesc, from: number, to: number): boolean {
  let touched = false;
  changes.iterChangedRanges((fromA, toA) => {
    if (touched) return;
    if (from === to) {
      touched = fromA < from && toA > from;
    } else {
      // a deletion/replacement overlapping the range, or an insertion strictly inside it
      touched = (fromA < to && toA > from) || (fromA === toA && fromA > from && fromA < to);
    }
  });
  return touched;
}

/** Map a range through changes. Text typed at either edge stays outside the range. */
export function mapRange(range: Range, changes: ChangeDesc): Range {
  const from = changes.mapPos(range.from, 1);
  const to = range.from === range.to ? from : changes.mapPos(range.to, -1);
  return { from, to };
}

/**
 * Move a suggestion through edits made since it was placed. Returns null if
 * the edits touched its text or the mapped range no longer holds `quote`
 * (SPEC D5: never place an edit on text that changed).
 */
export function mapSuggestion(s: Suggestion, changes: ChangeDesc, doc: Text): Suggestion | null {
  if (changeTouches(changes, s.from, s.to)) return null;
  const { from, to } = mapRange(s, changes);
  if (doc.sliceString(from, to) !== s.quote) return null;
  return from === s.from && to === s.to ? s : { ...s, from, to };
}
