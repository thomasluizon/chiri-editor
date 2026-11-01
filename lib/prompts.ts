/**
 * Every piece of prompt text the app sends to a model (SPEC D12).
 * Change wording here, then re-run `npm run eval` and compare reports.
 */

import type { Range } from "@/lib/types";
import { MAX_EDITS, MAX_REASON_CHARS } from "@/lib/limits";

export type ChatMessage = { role: "system" | "user"; content: string };

/* ---------- presets (the ⌘K chips) ---------- */

/** Chip labels the client shows; the server expands them to the instructions below. */
export const PRESET_LABELS = ["Tighten", "Fix grammar", "More formal", "More casual", "Clarify"] as const;

const PRESET_INSTRUCTIONS: Record<(typeof PRESET_LABELS)[number], string> = {
  Tighten: "Tighten this. Cut filler, repetition and throat-clearing. Keep every fact and the author's voice.",
  "Fix grammar": "Fix spelling, grammar and punctuation only. Do not change wording for style.",
  "More formal": "Make the tone more formal and precise, without becoming stiff or wordy.",
  "More casual": "Make the tone warmer and more conversational, without losing precision.",
  Clarify: "Make this easier to understand on first read: shorter sentences, concrete words, clear subjects.",
};

const DEFAULT_REVIEW =
  "Review this document as a sharp, kind editor. Suggest the few edits that would improve it most.";

export function expandInstruction(instruction: string | undefined): string {
  if (!instruction) return DEFAULT_REVIEW;
  return PRESET_INSTRUCTIONS[instruction as keyof typeof PRESET_INSTRUCTIONS] ?? instruction;
}

/* ---------- suggest ---------- */

const SUGGEST_SYSTEM = `You are a co-author reviewing a Markdown document with its writer. You propose a few precise edits; the writer accepts or rejects each one. You never rewrite the whole document.

Choosing edits
- Go for what matters most: a main point buried below less important text, rambling or repetitive sentences, passive voice that hides who does what, typos and grammar mistakes, vague claims that need a concrete word.
- Propose at most ${MAX_EDITS} edits. Fewer is better. If the text is already good, return an empty "edits" array. That is a good answer, not a failure.
- Leave good writing alone. Keep the writer's voice, facts, numbers, names and Markdown structure unless changing them is the point of the edit.
- Each edit is one focused change: a word, a phrase, a sentence, or at most one short paragraph.
- If the main news is buried further down, rewrite the opening so it leads with that news. The detail can stay where it is further down; you don't need to move or delete it.

Writing each edit
- "quote": copy the exact text you want to change from the document, character for character, including Markdown marks (#, **, _, \`, -, >) and punctuation. Never paraphrase or fix anything inside the quote. It must occur exactly once in the allowed text; add a few neighbouring words if needed to make it unique, but otherwise keep it short. Never include a blank line in a quote.
- "replacement": the new text for exactly that span. Use "" to delete. To insert, quote the words next to the insertion point and repeat them in the replacement with the new text added.
- "reason": one plain sentence to the writer, under ${MAX_REASON_CHARS} characters, saying why. Don't start with "I".
- "note": one sentence to the writer that describes only what your edits actually do, e.g. "Opened with the launch date and fixed a typo." Never mention a change that isn't in your edits. If you made no edits, say briefly why.

Return only JSON matching the schema.`;

export function suggestMessages(doc: string, instruction: string | undefined, scope?: Range): ChatMessage[] {
  const task = expandInstruction(instruction);
  const where = scope
    ? "Only edit the passage below. Every quote must come from inside it. The full document is there for context."
    : "You may edit anywhere in the document.";
  const passage = scope ? `\n\n<passage>\n${doc.slice(scope.from, scope.to)}\n</passage>` : "";

  return [
    { role: "system", content: SUGGEST_SYSTEM },
    {
      role: "user",
      content: `Task: ${task}\n${where}\n\n<document>\n${doc}\n</document>${passage}`,
    },
  ];
}

/* ---------- refine ---------- */

const REFINE_SYSTEM = `You are a co-author refining one suggested edit in a Markdown document. The writer saw your suggestion and asked for a change to it.

- Return a new "replacement" for the text inside <original>…</original>. It replaces exactly that span, and the words just before and after it stay in the document, so the sentence must read correctly with them. Never repeat a word that sits right outside the span (if "In" comes just before the span, don't start the replacement with "In").
- Follow the writer's request. Otherwise keep what was good about the previous suggestion.
- Keep Markdown marks the original had unless the request is about them.
- "reason": one plain sentence, under ${MAX_REASON_CHARS} characters, about the new version. Don't start with "I".
- "note": one short sentence to the writer.

Return only JSON matching the schema.`;

export function refineMessages(
  doc: string,
  instruction: string,
  target: { from: number; to: number; quote: string; replacement: string; history: { instruction: string; replacement: string }[] },
  context: Range,
): ChatMessage[] {
  const history = target.history.length
    ? `\n\nEarlier rounds:\n${target.history.map((h, i) => `${i + 1}. Writer: "${h.instruction}" → you suggested: "${h.replacement}"`).join("\n")}`
    : "";

  return [
    { role: "system", content: REFINE_SYSTEM },
    {
      role: "user",
      content: `The paragraph, with the span being edited marked:\n<context>\n${doc.slice(context.from, target.from)}<original>${target.quote}</original>${doc.slice(target.to, context.to)}\n</context>

Your current suggestion for that span:\n<suggestion>\n${target.replacement}\n</suggestion>${history}

Writer's request: ${expandInstruction(instruction)}`,
    },
  ];
}
