import { MAX_OUTPUT_TOKENS } from "@/lib/limits";
import type { SuggestRequest } from "./schema";

/**
 * Per-model request settings. Most models run with reasoning off: the task
 * is short and latency matters. Models that can't turn reasoning off get
 * the lowest effort they accept, plus extra output tokens for it, because
 * reasoning tokens count inside max_tokens.
 */

export type ReasoningEffort = "none" | "low" | "medium" | "high";

export type ModelConfig = {
  effort: ReasoningEffort;
  /** Output tokens reserved for reasoning, on top of MAX_OUTPUT_TOKENS for the answer. */
  reasoningTokens: number;
};

const DEFAULT_CONFIG: ModelConfig = { effort: "none", reasoningTokens: 0 };

const OVERRIDES: Record<string, ModelConfig> = {
  // Rejects effort "none" ("Reasoning is mandatory for this endpoint"). "low" is the
  // lowest effort Claude accepts on OpenRouter, and Anthropic thinking budgets are at
  // least 1024 tokens, so without the reserve the JSON answer would get ~176 tokens.
  "anthropic/claude-sonnet-5.5": { effort: "low", reasoningTokens: 1024 },
};

export function modelConfig(model: string): ModelConfig {
  return OVERRIDES[model] ?? DEFAULT_CONFIG;
}

/** max_tokens to request: the answer allowance plus any reasoning reserve. */
export function maxTokensFor(model: string): number {
  return MAX_OUTPUT_TOKENS + modelConfig(model).reasoningTokens;
}

/* ---------- which model handles which request ---------- */

/** Review doc needs judgment (structure, the buried lede). Chosen in eval/reports/2026-11-01-17-54-*. */
export const DEFAULT_REVIEW_MODEL = "anthropic/claude-sonnet-5.5";
/** ⌘K and refine are small, scoped edits where speed matters most. */
export const DEFAULT_EDIT_MODEL = "anthropic/claude-haiku-5.5";

export type ModelEnv = Record<string, string | undefined>;

/** Review doc (no scope) → review model; ⌘K (scoped) and refine → edit model. */
export function modelFor(req: SuggestRequest, env: ModelEnv): string {
  const isReview = req.mode === "suggest" && !req.scope;
  return isReview
    ? env.OPENROUTER_MODEL_REVIEW || DEFAULT_REVIEW_MODEL
    : env.OPENROUTER_MODEL_EDIT || DEFAULT_EDIT_MODEL;
}
