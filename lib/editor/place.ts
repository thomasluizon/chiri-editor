import type { ChangeSet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { conflicts } from "@/lib/ranges";
import type { Suggestion, SuggestionSource, SuggestResponse } from "@/lib/types";
import { mapSuggestion } from "./mapping";
import { getSuggestions, setSuggestions } from "./suggestions";

/**
 * stale: the text under a suggestion changed while the request ran.
 * conflicted: it would overlap a suggestion already on screen.
 */
export type Placement = { added: Suggestion[]; stale: number; conflicted: number; targetGone: boolean };

/**
 * Put a response's suggestions into the editor (SPEC D5). Each one is mapped
 * through `changes` (everything the user typed since the request was sent)
 * and re-checked against its quote; stale ones and ones that would overlap a
 * suggestion already on screen are counted, not shown.
 *
 * With `replace`, the response is a refinement of that suggestion: it takes
 * its place and inherits its history. If the original is gone (accepted,
 * rejected or edited away meanwhile), the refinement is discarded.
 */
export function placeSuggestions(
  view: EditorView,
  changes: ChangeSet,
  res: SuggestResponse,
  replace?: { id: string; instruction: string },
  source: SuggestionSource = replace ? "refine" : "review",
): Placement {
  const current = getSuggestions(view.state).items;
  const original = replace && current.find((s) => s.id === replace.id);
  if (replace && !original) return { added: [], stale: 0, conflicted: 0, targetGone: true };

  const keep = current.filter((s) => s.id !== replace?.id);
  const added: Suggestion[] = [];
  let stale = 0;
  let conflicted = 0;

  for (const s of res.suggestions) {
    const mapped = mapSuggestion({ ...s, model: res.model, source }, changes, view.state.doc);
    if (!mapped) {
      stale++;
      continue;
    }
    if ([...keep, ...added].some((o) => conflicts(o, mapped))) {
      conflicted++;
      continue;
    }
    if (original && replace) {
      mapped.history = [...(original.history ?? []), { instruction: replace.instruction, replacement: mapped.replacement }].slice(-4);
    }
    added.push(mapped);
  }

  // A refinement that couldn't be placed leaves the original as it was.
  if (replace && added.length === 0) return { added, stale, conflicted, targetGone: false };

  view.dispatch({ effects: setSuggestions.of([...keep, ...added]) });
  return { added, stale, conflicted, targetGone: false };
}
