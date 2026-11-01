import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Range, SuggestRequest, SuggestResponse } from "@/lib/types";

/**
 * Eval cases (SPEC §7.5). Each fixture has real problems planted in it plus
 * one paragraph that's already fine, so the checks catch both missed
 * problems and over-editing. Checks are pass/fail; whether a fix is *good*
 * is for a human reading the report.
 */

export type Check =
  /** Passes when the misspelling is gone once the suggestions are applied (rewording it away counts). */
  | { kind: "fixes"; label: string; typo: string }
  /** "phrase": an edit must overlap `text` itself. "paragraph": anywhere in its paragraph. */
  | { kind: "touches"; label: string; text: string; within: "phrase" | "paragraph" }
  | { kind: "untouched"; label: string; text: string };

export type EvalCase = {
  name: string;
  title: string;
  docFile: string;
  problems: string[];
  /** Builds the request from the doc text. */
  request: (doc: string) => SuggestRequest;
  checks: Check[];
};

export const loadDoc = (file: string) => readFileSync(join(import.meta.dirname, "docs", file), "utf8");

/** The range of `text` in `doc`; throws if it isn't there exactly once (a broken fixture). */
export function rangeOf(doc: string, text: string): Range {
  const at = doc.indexOf(text);
  if (at < 0 || doc.indexOf(text, at + 1) >= 0) throw new Error(`fixture text not unique: ${text.slice(0, 40)}`);
  return { from: at, to: at + text.length };
}

const RAMBLING = "When it comes to getting access to the tools";
const paragraphOf = (doc: string, start: string): Range => {
  const from = rangeOf(doc, start).from;
  const end = doc.indexOf("\n\n", from);
  return { from, to: end === -1 ? doc.length : end };
};

export const cases: EvalCase[] = [
  {
    name: "launch-update",
    title: "Review doc: team update",
    docFile: "launch-update.md",
    problems: ["Buried lede: the news is in paragraph 3", "Typo: recieve"],
    request: (doc) => ({ mode: "suggest", doc }),
    checks: [
      { kind: "fixes", label: "fixes 'recieve'", typo: "recieve" },
      { kind: "touches", label: "reworks the opening (lede)", text: "This week the billing team continued working", within: "paragraph" },
      { kind: "untouched", label: "leaves the thanks paragraph alone", text: "Thanks to Priya" },
    ],
  },
  {
    name: "onboarding-guide",
    title: "Review doc: how-to guide",
    docFile: "onboarding-guide.md",
    problems: ["Rambling, repetitive paragraph (~170 words)", "Passive voice: 'should be submitted by the new hire'"],
    request: (doc) => ({ mode: "suggest", doc }),
    checks: [
      { kind: "touches", label: "touches the rambling paragraph", text: RAMBLING, within: "paragraph" },
      { kind: "touches", label: "rewrites the passive phrase", text: "should be submitted by the new hire", within: "phrase" },
      { kind: "untouched", label: "leaves 'Getting help' alone", text: "Post in #it-help" },
    ],
  },
  {
    name: "product-memo",
    title: "Review doc: opinion memo",
    docFile: "product-memo.md",
    problems: ["Passive voice hiding who acted", "Vague claim: 'improve things a lot'", "Typo: definately"],
    request: (doc) => ({ mode: "suggest", doc }),
    checks: [
      { kind: "fixes", label: "fixes 'definately'", typo: "definately" },
      { kind: "touches", label: "rewrites 'Mistakes were made'", text: "Mistakes were made", within: "phrase" },
      { kind: "touches", label: "rewrites the vague claim", text: "things a lot", within: "phrase" },
      { kind: "untouched", label: "leaves the costs paragraph alone", text: "Running it is not free." },
    ],
  },
  {
    name: "tighten-paragraph",
    title: "⌘K 'Tighten' on the rambling paragraph",
    docFile: "onboarding-guide.md",
    problems: ["Same rambling paragraph, scoped request"],
    request: (doc) => ({ mode: "suggest", doc, instruction: "Tighten", scope: paragraphOf(doc, RAMBLING) }),
    checks: [{ kind: "touches", label: "edits the paragraph", text: RAMBLING, within: "paragraph" }],
  },
];

export type CheckResult = { label: string; pass: boolean };

const overlaps = (a: Range, b: Range) =>
  a.from === a.to ? a.from >= b.from && a.from <= b.to : a.from < b.to && b.from < a.to;

export function runChecks(c: EvalCase, doc: string, res: SuggestResponse): CheckResult[] {
  const out: CheckResult[] = c.checks.map((check) => {
    switch (check.kind) {
      case "fixes":
        return { label: check.label, pass: !applyAll(doc, res).includes(check.typo) };
      case "touches": {
        const target = check.within === "paragraph" ? paragraphOf(doc, check.text) : rangeOf(doc, check.text);
        return { label: check.label, pass: res.suggestions.some((s) => overlaps(s, target)) };
      }
      case "untouched": {
        const target = paragraphOf(doc, check.text);
        return { label: check.label, pass: !res.suggestions.some((s) => overlaps(s, target)) };
      }
    }
  });
  // contract: schema-valid (we got a response at all), ≤ 5 edits (zod), nothing outside the scope
  out.push({ label: "fits the contract", pass: !res.dropped.some((d) => d.why === "outside_scope") });
  return out;
}

/** The doc with every placed suggestion accepted (they never overlap, so apply back to front). */
export function applyAll(doc: string, res: SuggestResponse): string {
  return [...res.suggestions]
    .sort((a, b) => b.from - a.from)
    .reduce((text, s) => text.slice(0, s.from) + s.replacement + text.slice(s.to), doc);
}
