import type { Range } from "@/lib/types";

/**
 * Two suggestion ranges conflict if they overlap, or if either is an
 * insertion sitting inside or on the edge of the other. Shared by the
 * server (locateEdits) and the client (placeSuggestions) so both drop the
 * same edits.
 */
export function conflicts(a: Range, b: Range): boolean {
  if (a.from === a.to || b.from === b.to) return a.from <= b.to && b.from <= a.to;
  return a.from < b.to && b.from < a.to;
}
