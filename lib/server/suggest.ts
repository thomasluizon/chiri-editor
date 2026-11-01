import { MAX_DOC_CHARS, MAX_REASON_CHARS, UPSTREAM_TIMEOUT_MS } from "@/lib/limits";
import { refineMessages, suggestMessages, type ChatMessage } from "@/lib/prompts";
import type { Range } from "@/lib/types";
import type { z } from "zod";
import { locateEdits, sharedEnds } from "./locate";
import { maxTokensFor, modelConfig } from "./models";
import {
  refineJsonSchema,
  refineOutputSchema,
  suggestJsonSchema,
  suggestOutputSchema,
  suggestRequestSchema,
  type PlacedSuggestion,
  type SuggestRequest,
  type SuggestResponse,
} from "./schema";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export class SuggestError extends Error {
  constructor(
    readonly status: 400 | 413 | 500 | 502 | 504,
    message: string,
  ) {
    super(message);
  }
}

export type SuggestOptions = {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  newId?: () => string;
};

/* ---------- request validation ---------- */

/** Validates an untrusted body: 413 for an oversized doc, 400 for anything else wrong. */
export function parseSuggestRequest(body: unknown): SuggestRequest {
  const doc = (body as { doc?: unknown } | null)?.doc;
  if (typeof doc === "string" && doc.length > MAX_DOC_CHARS) {
    throw new SuggestError(413, `The document is over ${MAX_DOC_CHARS.toLocaleString("en")} characters.`);
  }

  const parsed = suggestRequestSchema.safeParse(body);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    throw new SuggestError(400, `Invalid request. ${detail}`);
  }

  const req = parsed.data;
  const inBounds = (r: Range) => r.from <= r.to && r.to <= req.doc.length;
  if (req.mode === "suggest" && req.scope && !inBounds(req.scope)) {
    throw new SuggestError(400, "Invalid request. scope is outside the document.");
  }
  if (req.mode === "refine") {
    if (!inBounds(req.target)) throw new SuggestError(400, "Invalid request. target is outside the document.");
    if (req.doc.slice(req.target.from, req.target.to) !== req.target.quote) {
      throw new SuggestError(400, "Invalid request. target.quote doesn't match the document at that range.");
    }
  }
  return req;
}

/* ---------- main entry ---------- */

/** Ask the model for suggestions and place them in the doc. Shared by the API route and the eval. */
export async function suggest(req: SuggestRequest, opts: SuggestOptions): Promise<SuggestResponse> {
  const started = performance.now();
  const newId = opts.newId ?? (() => crypto.randomUUID());

  if (req.mode === "suggest") {
    const completion = await callModel(opts, suggestMessages(req.doc, req.instruction, req.scope), "edits", suggestJsonSchema);
    const out = parseOutput(suggestOutputSchema, completion.content);
    const { placed, dropped } = locateEdits(req.doc, out.edits, req.scope);
    return {
      note: out.note.trim(),
      suggestions: placed.map((p) => ({ id: newId(), ...p, reason: clipReason(p.reason) })),
      dropped,
      usage: usageOf(completion.usage, started),
    };
  }

  // refine: the range is known, so the model only supplies new text for it.
  // Placed suggestions are trimmed and can start mid-phrase ("In [the first week…]"),
  // and models rewrite fragments badly ("In In the first week"). So the model gets
  // the whole sentence(s) with the current suggestion applied, and the result is
  // trimmed back down to a small diff.
  const sentence = sentencesAround(req.doc, req.target);
  const target = {
    from: sentence.from,
    to: sentence.to,
    quote: req.doc.slice(sentence.from, sentence.to),
    replacement:
      req.doc.slice(sentence.from, req.target.from) + req.target.replacement + req.doc.slice(req.target.to, sentence.to),
    history: req.target.history,
  };
  const context = paragraphAround(req.doc, target);
  const completion = await callModel(opts, refineMessages(req.doc, req.instruction, target, context), "refinement", refineJsonSchema);
  const out = parseOutput(refineOutputSchema, completion.content);

  const suggestions: PlacedSuggestion[] = [];
  const dropped: SuggestResponse["dropped"] = [];
  if (out.replacement === target.quote) {
    dropped.push({ quote: req.target.quote, why: "noop" });
  } else {
    const { prefix, suffix } = sharedEnds(target.quote, out.replacement);
    suggestions.push({
      id: newId(),
      from: target.from + prefix,
      to: target.to - suffix,
      quote: target.quote.slice(prefix, target.quote.length - suffix),
      replacement: out.replacement.slice(prefix, out.replacement.length - suffix),
      reason: clipReason(out.reason),
    });
  }
  return { note: out.note.trim(), suggestions, dropped, usage: usageOf(completion.usage, started) };
}

/* ---------- OpenRouter ---------- */

type Usage = { prompt_tokens?: number; completion_tokens?: number; cost?: number | null } | undefined;

async function callModel(
  opts: SuggestOptions,
  messages: ChatMessage[],
  schemaName: string,
  schema: object,
): Promise<{ content: string; usage: Usage }> {
  const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const body = {
    model: opts.model,
    messages,
    max_tokens: maxTokensFor(opts.model),
    reasoning: { effort: modelConfig(opts.model).effort },
    response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
    // only route to providers that honour every parameter above (structured outputs in particular)
    provider: { require_parameters: true },
  };

  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Draft (AI co-author)",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    if (timeout.aborted) throw new SuggestError(504, `The model took longer than ${UPSTREAM_TIMEOUT_MS / 1000} s.`);
    throw new SuggestError(502, opts.signal?.aborted ? "The request was cancelled." : "Couldn't reach the model provider.");
  }

  const redact = (s: string) => s.split(opts.apiKey).join("[redacted]");
  let data: {
    error?: { message?: string };
    choices?: { message?: { content?: unknown } }[];
    usage?: Usage;
  };
  try {
    data = JSON.parse(await res.text());
  } catch {
    throw new SuggestError(502, `The model provider sent an unreadable response (HTTP ${res.status}).`);
  }
  if (!res.ok || data.error) {
    throw new SuggestError(502, redact(`Model provider error: ${data.error?.message ?? `HTTP ${res.status}`}`));
  }

  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new SuggestError(502, "The model returned an empty answer.");
  return { content, usage: data.usage };
}

/** Parse the model's JSON against a schema. Code fences are tolerated; anything else is a 502. */
function parseOutput<T>(schema: z.ZodType<T>, content: string): T {
  const raw = content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new SuggestError(502, "The model's answer wasn't valid JSON.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "output"}: ${i.message}`).join("; ");
    throw new SuggestError(502, `The model's answer didn't match the expected format. ${detail}`);
  }
  return parsed.data;
}

/* ---------- helpers ---------- */

function usageOf(u: Usage, started: number): SuggestResponse["usage"] {
  return {
    inputTokens: u?.prompt_tokens ?? 0,
    outputTokens: u?.completion_tokens ?? 0,
    costUsd: typeof u?.cost === "number" ? u.cost : null,
    latencyMs: Math.round(performance.now() - started),
  };
}

/** The reason is shown in a small card; keep it to the contract length, cut at a word. */
export function clipReason(reason: string): string {
  const r = reason.trim().replace(/\s+/g, " ");
  if (r.length <= MAX_REASON_CHARS) return r;
  const cut = r.slice(0, MAX_REASON_CHARS - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 60)).replace(/[\s,;:.-]+$/, "")}…`;
}

/**
 * Widen a range to the whole sentence(s) it touches, within its line: back to
 * the start of the line or just after ". ", "! ", "? "; forward to the end of
 * the line or just after the next ".", "!" or "?" that ends a sentence.
 */
export function sentencesAround(doc: string, r: Range): Range {
  const isEnd = (i: number) => /[.!?]/.test(doc[i] ?? "") && (i + 1 >= doc.length || /\s/.test(doc[i + 1]));
  let from = r.from;
  while (from > 0 && doc[from - 1] !== "\n" && !(doc[from - 1] === " " && isEnd(from - 2))) from--;
  let to = r.to;
  if (!(to > from && isEnd(to - 1))) {
    while (to < doc.length && doc[to] !== "\n" && !isEnd(to)) to++;
    if (to < doc.length && isEnd(to)) to++;
  }
  return { from, to };
}

/** The blank-line-delimited block(s) around a range, for refine context. */
function paragraphAround(doc: string, r: Range): Range {
  const start = doc.lastIndexOf("\n\n", r.from);
  const end = doc.indexOf("\n\n", r.to);
  return { from: start === -1 ? 0 : start + 2, to: end === -1 ? doc.length : end };
}
