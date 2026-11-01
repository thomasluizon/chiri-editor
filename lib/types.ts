/** A placed AI suggestion. Offsets are UTF-16 indices into the current doc. */
export type Suggestion = {
  id: string;
  from: number;
  to: number;
  /** doc.slice(from, to) at the time it was placed; used to detect staleness. */
  quote: string;
  replacement: string;
  reason: string;
  /** Earlier refine rounds that led to this replacement (sent back on the next refine). */
  history?: { instruction: string; replacement: string }[];
  /** Which model suggested it and from where, for AI history (SPEC §10). */
  model?: string;
  source?: SuggestionSource;
};

export type SuggestionSource = "review" | "ask" | "slash" | "refine";

export type SuggestionKind = "insert" | "delete" | "replace";

export function kindOf(s: Pick<Suggestion, "from" | "to" | "replacement">): SuggestionKind {
  if (s.from === s.to) return "insert";
  if (s.replacement === "") return "delete";
  return "replace";
}

export type Range = { from: number; to: number };

export type { DropReason, PlacedSuggestion, SuggestRequest, SuggestResponse } from "@/lib/server/schema";
