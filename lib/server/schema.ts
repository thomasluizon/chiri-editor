import { z } from "zod";

/** Request and response contract for POST /api/suggest (SPEC §3). */

import { MAX_DOC_CHARS, MAX_EDITS, MAX_INSTRUCTION_CHARS, MAX_REASON_CHARS } from "@/lib/limits";

const range = z.object({ from: z.number().int().min(0), to: z.number().int().min(0) });

export const suggestRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("suggest"),
    doc: z.string(),
    instruction: z.string().trim().max(MAX_INSTRUCTION_CHARS).optional(),
    scope: range.optional(),
  }),
  z.object({
    mode: z.literal("refine"),
    doc: z.string(),
    instruction: z.string().trim().min(1).max(MAX_INSTRUCTION_CHARS),
    target: z.object({
      from: z.number().int().min(0),
      to: z.number().int().min(0),
      quote: z.string().max(MAX_DOC_CHARS),
      replacement: z.string().max(MAX_DOC_CHARS),
      history: z
        .array(
          z.object({
            instruction: z.string().max(MAX_INSTRUCTION_CHARS),
            replacement: z.string().max(MAX_DOC_CHARS),
          }),
        )
        .max(4),
    }),
  }),
]);

export type SuggestRequest = z.infer<typeof suggestRequestSchema>;

/* ----- model output ----- */

const edit = z.object({ quote: z.string(), replacement: z.string(), reason: z.string() });

/** What the model must return in "suggest" mode. More than 5 edits is a contract violation. */
export const suggestOutputSchema = z.object({
  note: z.string(),
  edits: z.array(edit).max(MAX_EDITS),
});

/** "refine" mode: the range is already known, so the model only returns the new text. */
export const refineOutputSchema = z.object({
  note: z.string(),
  replacement: z.string(),
  reason: z.string(),
});

export type ModelEdit = z.infer<typeof edit>;

/**
 * JSON schemas sent to OpenRouter with `strict: true`. Kept to the plain
 * subset every strict-mode provider accepts (no maxItems/maxLength); the
 * limits are in the prompt and enforced by zod above.
 */
export const suggestJsonSchema = {
  type: "object",
  properties: {
    note: { type: "string", description: "One sentence to the writer summarising the review." },
    edits: {
      type: "array",
      description: `At most ${MAX_EDITS} edits. An empty array is a good answer when the text is fine.`,
      items: {
        type: "object",
        properties: {
          quote: { type: "string", description: "Exact text copied from the document." },
          replacement: { type: "string", description: "New text for that span; empty string deletes it." },
          reason: { type: "string", description: `Why, in under ${MAX_REASON_CHARS} characters.` },
        },
        required: ["quote", "replacement", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["note", "edits"],
  additionalProperties: false,
} as const;

export const refineJsonSchema = {
  type: "object",
  properties: {
    note: { type: "string", description: "One short sentence to the writer." },
    replacement: { type: "string", description: "The new text for the original span." },
    reason: { type: "string", description: `Why, in under ${MAX_REASON_CHARS} characters.` },
  },
  required: ["note", "replacement", "reason"],
  additionalProperties: false,
} as const;

/* ----- response ----- */

export type DropReason = "not_found" | "ambiguous" | "overlap" | "noop" | "outside_scope";

export type PlacedSuggestion = {
  id: string;
  from: number;
  to: number;
  quote: string;
  replacement: string;
  reason: string;
};

export type SuggestResponse = {
  note: string;
  suggestions: PlacedSuggestion[];
  dropped: { quote: string; why: DropReason }[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null; latencyMs: number };
};
