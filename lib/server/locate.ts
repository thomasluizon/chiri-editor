import type { Range } from "@/lib/types";
import type { DropReason, ModelEdit } from "./schema";

/**
 * Place model edits in the document by exact match (SPEC D4 and the
 * placement rules in §2). Pure: no I/O, no randomness except ids passed in.
 *
 * For each edit, in order:
 *   1. a no-op (replacement === quote) or empty quote is dropped
 *   2. the quote must occur exactly once inside `scope` (or the doc);
 *      0 → not_found / outside_scope, 2+ → ambiguous
 *   3. if it overlaps an edit already placed, it's dropped as overlap
 *   4. the shared start and end of quote/replacement are trimmed, snapped to
 *      word boundaries, so the stored range is as small as it can be
 */

export type Located = { from: number; to: number; quote: string; replacement: string; reason: string };
export type LocateResult = { placed: Located[]; dropped: { quote: string; why: DropReason }[] };

export function locateEdits(doc: string, edits: ModelEdit[], scope?: Range): LocateResult {
  const placed: (Located & { full: Range })[] = [];
  const dropped: LocateResult["dropped"] = [];
  const region = scope ? doc.slice(scope.from, scope.to) : doc;
  const offset = scope?.from ?? 0;

  for (const e of edits) {
    if (e.quote === e.replacement) {
      dropped.push({ quote: e.quote, why: "noop" });
      continue;
    }
    if (e.quote === "") {
      dropped.push({ quote: e.quote, why: "not_found" });
      continue;
    }

    const hits = occurrences(region, e.quote, 2);
    if (hits.length === 0) {
      const why = scope && occurrences(doc, e.quote, 1).length > 0 ? "outside_scope" : "not_found";
      dropped.push({ quote: e.quote, why });
      continue;
    }
    if (hits.length > 1) {
      dropped.push({ quote: e.quote, why: "ambiguous" });
      continue;
    }

    const full = { from: offset + hits[0], to: offset + hits[0] + e.quote.length };
    if (placed.some((p) => full.from < p.full.to && p.full.from < full.to)) {
      dropped.push({ quote: e.quote, why: "overlap" });
      continue;
    }

    const { prefix, suffix } = sharedEnds(e.quote, e.replacement);
    placed.push({
      full,
      from: full.from + prefix,
      to: full.to - suffix,
      quote: e.quote.slice(prefix, e.quote.length - suffix),
      replacement: e.replacement.slice(prefix, e.replacement.length - suffix),
      reason: e.reason,
    });
  }

  return {
    placed: placed.sort((a, b) => a.from - b.from).map(({ full: _full, ...rest }) => rest),
    dropped,
  };
}

/** Start indices of `needle` in `hay`, including overlapping ones, up to `limit`. */
function occurrences(hay: string, needle: string, limit: number): number[] {
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i !== -1 && out.length < limit; i = hay.indexOf(needle, i + 1)) out.push(i);
  return out;
}

const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}_'’]/u.test(ch);

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** A cut at `i` doesn't split a word, or an emoji's surrogate pair, in `s`. */
const atBoundary = (s: string, i: number) =>
  i === 0 || i === s.length || (!isHighSurrogate(s.charCodeAt(i - 1)) && (!isWord(s[i - 1]) || !isWord(s[i])));

/**
 * Length of the common prefix and suffix of a and b, each shrunk until it
 * ends on a word boundary in both strings, so "colour" → "color" stays a
 * whole-word change instead of deleting one letter.
 */
export function sharedEnds(a: string, b: string): { prefix: number; suffix: number } {
  const max = Math.min(a.length, b.length);

  let prefix = 0;
  while (prefix < max && a[prefix] === b[prefix]) prefix++;
  while (prefix > 0 && !(atBoundary(a, prefix) && atBoundary(b, prefix))) prefix--;

  let suffix = 0;
  while (suffix < max - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  while (suffix > 0 && !(atBoundary(a, a.length - suffix) && atBoundary(b, b.length - suffix))) suffix--;

  return { prefix, suffix };
}
