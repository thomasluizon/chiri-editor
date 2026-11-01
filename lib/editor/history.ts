import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Range, SuggestionSource } from "@/lib/types";
import { changeTouches, mapRange } from "./mapping";

/**
 * AI history (SPEC §10, D15): every accepted or rejected suggestion.
 * Accepted entries keep the range of the text they put in the doc, mapped
 * through every later edit. Revert follows the placement rule: only if no
 * edit touched that range and the text there is still exactly `after`.
 */

export type HistoryEntry = {
  id: string;
  at: number; // epoch ms
  status: "accepted" | "rejected" | "reverted";
  source?: SuggestionSource;
  model?: string;
  reason: string;
  before: string;
  after: string;
  /** accepted only: where `after` sits in the current doc */
  range?: Range;
  /** an edit touched the accepted text since, so it can't be reverted */
  broken?: boolean;
};

const MAX_ENTRIES = 200;

export const addHistory = StateEffect.define<HistoryEntry[]>();
export const setHistory = StateEffect.define<HistoryEntry[]>();
const markReverted = StateEffect.define<string>();

export const historyField = StateField.define<HistoryEntry[]>({
  create: () => [],
  update(entries, tr) {
    let next = entries;
    if (tr.docChanged) {
      next = next.map((e) => {
        if (e.status !== "accepted" || !e.range || e.broken) return e;
        if (changeTouches(tr.changes, e.range.from, e.range.to)) return { ...e, broken: true };
        return { ...e, range: mapRange(e.range, tr.changes) };
      });
    }
    for (const effect of tr.effects) {
      // new entries arrive in the new doc's coordinates, so they're added after mapping
      if (effect.is(addHistory)) next = [...effect.value, ...next].slice(0, MAX_ENTRIES);
      else if (effect.is(setHistory)) next = effect.value;
      else if (effect.is(markReverted)) next = next.map((e) => (e.id === effect.value ? { ...e, status: "reverted" } : e));
    }
    return next;
  },
});

/** The field, starting from saved entries. */
export const historyExtension = (initial: HistoryEntry[] = []) => historyField.init(() => initial);

export type RevertCheck = "ok" | "changed" | "unavailable";

export function revertCheck(state: EditorState, id: string): RevertCheck {
  const e = state.field(historyField).find((x) => x.id === id);
  if (!e || e.status !== "accepted" || !e.range) return "unavailable";
  const { from, to } = e.range;
  if (e.broken || to > state.doc.length || state.doc.sliceString(from, to) !== e.after) return "changed";
  return "ok";
}

/** Put `before` back, as one normal (undoable) transaction, if the rule allows it. */
export function revertEntry(view: EditorView, id: string): RevertCheck {
  const check = revertCheck(view.state, id);
  if (check !== "ok") return check;
  const e = view.state.field(historyField).find((x) => x.id === id)!;
  view.dispatch({
    changes: { from: e.range!.from, to: e.range!.to, insert: e.before },
    effects: markReverted.of(id),
    userEvent: "input.revert",
  });
  return "ok";
}

/* ---------- persistence (saved with the doc, SPEC §10) ---------- */

export const serializeHistory = (entries: HistoryEntry[]) => JSON.stringify({ version: 1, entries });

/** Parse saved history. Anything malformed is dropped; ranges that don't fit the doc can't be reverted. */
export function loadHistory(raw: string | null, docLength: number): HistoryEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (parsed as { entries?: unknown })?.entries;
  if (!Array.isArray(list)) return [];
  return list.filter(isEntry).map((e) =>
    e.range && (e.range.from > e.range.to || e.range.to > docLength) ? { ...e, broken: true } : e,
  );
}

function isEntry(v: unknown): v is HistoryEntry {
  const e = v as HistoryEntry;
  return (
    !!e &&
    typeof e.id === "string" &&
    typeof e.at === "number" &&
    ["accepted", "rejected", "reverted"].includes(e.status) &&
    typeof e.before === "string" &&
    typeof e.after === "string" &&
    typeof e.reason === "string" &&
    (e.range === undefined || (Number.isInteger(e.range.from) && Number.isInteger(e.range.to)))
  );
}
