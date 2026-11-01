/**
 * Live eval and model comparison (SPEC §7.5).
 *
 *   npm run eval -- --models haiku,luna,sonnet [--case name] [--max-usd 0.15] [--out file] [--dry-run]
 *
 * Real API calls, real money. Calls run one at a time so latency is
 * comparable. Before each call the worst-case cost (input estimate + the
 * full max_tokens of output) is checked against --max-usd; a call that
 * could break the budget is skipped, not sent. --dry-run uses a fake
 * OpenRouter and makes no network calls.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { MAX_OUTPUT_TOKENS } from "@/lib/limits";
import { suggestMessages } from "@/lib/prompts";
import { DEFAULT_MODEL, suggest, SuggestError } from "@/lib/server/suggest";
import type { SuggestResponse } from "@/lib/types";
import { cases, loadDoc, runChecks, type CheckResult, type EvalCase } from "./cases";

const ALIASES: Record<string, string> = {
  haiku: "anthropic/claude-haiku-5.5",
  luna: "openai/gpt-6-luna",
  sonnet: "anthropic/claude-sonnet-5.5",
};

const { values: args } = parseArgs({
  options: {
    models: { type: "string" },
    case: { type: "string" },
    "max-usd": { type: "string", default: "0.15" },
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const dryRun = args["dry-run"];
const maxUsd = Number(args["max-usd"]);
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file; rely on the environment
}
const apiKey = process.env.OPENROUTER_API_KEY ?? "";
if (!dryRun && !apiKey) fail("OPENROUTER_API_KEY is not set (.env or environment).");
if (!(maxUsd > 0)) fail("--max-usd must be a positive number.");

const modelNames = (args.models ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL).split(",").map((m) => m.trim());
const models = modelNames.map((m) => ({ label: Object.keys(ALIASES).find((k) => ALIASES[k] === m) ?? m, id: ALIASES[m] ?? m }));
for (const m of models) m.label = Object.keys(ALIASES).find((k) => ALIASES[k] === m.id) ?? m.id;
const selected = args.case ? cases.filter((c) => c.name === args.case) : cases;
if (!selected.length) fail(`No case named "${args.case}". Cases: ${cases.map((c) => c.name).join(", ")}`);

type Price = { input: number; output: number }; // USD per token
type Run = {
  c: EvalCase;
  model: { label: string; id: string };
  res?: SuggestResponse;
  error?: string;
  skipped?: string;
  checks: CheckResult[];
  latencyMs: number;
  costUsd: number;
  /** false when the provider returned no usage (e.g. a rejected request); costUsd is then the worst case. */
  costKnown: boolean;
};


async function main() {
  const prices = await loadPrices(models.map((m) => m.id));
  let spent = 0;
  const runs: Run[] = [];

  console.log(`${dryRun ? "DRY RUN (fake model) · " : ""}${selected.length} cases × ${models.length} models · budget $${maxUsd.toFixed(4)}\n`);

  for (const c of selected) {
    const doc = loadDoc(c.docFile);
    const req = c.request(doc);
    for (const model of models) {
      const run: Run = { c, model, checks: [], latencyMs: 0, costUsd: 0, costKnown: true };
      runs.push(run);

      const worst = worstCaseUsd(req.mode === "suggest" ? suggestMessages(doc, req.instruction, req.scope) : [], prices[model.id]);
      if (spent + worst > maxUsd) {
        run.skipped = `budget: worst case $${worst.toFixed(4)} would exceed $${maxUsd.toFixed(4)}`;
        console.log(`skip  ${c.name} × ${model.label}: ${run.skipped}`);
        continue;
      }

      // Read usage from the raw provider response, so the cost is counted
      // even when the answer then fails validation.
      let rawUsage: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined;
      const countingFetch: typeof fetch = async (input, init) => {
        const res = await (dryRun ? fakeOpenRouter : fetch)(input, init);
        try {
          rawUsage = (await res.clone().json())?.usage;
        } catch {
          rawUsage = undefined;
        }
        return res;
      };

      const started = performance.now();
      try {
        run.res = await suggest(req, { apiKey: apiKey || "dry-run", model: model.id, fetch: countingFetch });
        run.checks = runChecks(c, doc, run.res);
        run.latencyMs = run.res.usage.latencyMs;
      } catch (e) {
        run.error = e instanceof SuggestError ? e.message : String(e);
        run.latencyMs = Math.round(performance.now() - started);
        run.checks = c.checks.map((k) => ({ label: k.label, pass: false })).concat({ label: "fits the contract", pass: false });
      }
      const known = costOf(rawUsage, prices[model.id]);
      // No usage back (rejected request): book the worst case against the budget, but label it as such.
      run.costKnown = known !== null;
      run.costUsd = known ?? worst;
      spent += run.costUsd;

      const passed = run.checks.filter((k) => k.pass).length;
      console.log(
        `done  ${c.name} × ${model.label}: ${run.error ? `ERROR ${run.error}` : `${passed}/${run.checks.length} checks`}` +
          ` · ${(run.latencyMs / 1000).toFixed(1)} s · ${money(run)} (budget used $${spent.toFixed(4)})`,
      );
    }
  }

  const summary = summaryTable(runs);
  const report = renderReport(runs, summary, spent);
  const out =
    args.out ??
    join("eval", "reports", `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${models.map((m) => m.label).join("-")}${dryRun ? "-dry" : ""}.md`);
  mkdirSync(join(out, ".."), { recursive: true });
  writeFileSync(out, report);

  console.log(`\n${summary}\n\nBudget used: $${spent.toFixed(4)} of $${maxUsd.toFixed(4)} (worst case for calls that returned no usage)\nReport: ${out}`);
}

/* ---------- money ---------- */

async function loadPrices(ids: string[]): Promise<Record<string, Price>> {
  if (dryRun) {
    // list prices on 2026-11-01 (SPEC §6), so the budget guard behaves as it would live
    const known: Record<string, Price> = {
      "anthropic/claude-haiku-5.5": { input: 0.1e-6, output: 0.5e-6 },
      "openai/gpt-6-luna": { input: 0.1e-6, output: 0.5e-6 },
      "anthropic/claude-sonnet-5.5": { input: 2e-6, output: 10e-6 },
    };
    return Object.fromEntries(ids.map((id) => [id, known[id] ?? { input: 1e-6, output: 5e-6 }]));
  }
  // public endpoint, no key, not a model call
  const res = await fetch("https://openrouter.ai/api/v1/models");
  const { data } = (await res.json()) as { data: { id: string; pricing: { prompt: string; completion: string } }[] };
  const out: Record<string, Price> = {};
  for (const id of ids) {
    const m = data.find((x) => x.id === id);
    if (!m) fail(`Unknown model on OpenRouter: ${id}`);
    out[id] = { input: Number(m.pricing.prompt), output: Number(m.pricing.completion) };
  }
  return out;
}

/** Upper bound: ~3 chars per input token (generous) and the full output allowance. */
function worstCaseUsd(messages: { content: string }[], p: Price): number {
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  return Math.ceil(chars / 3) * p.input + MAX_OUTPUT_TOKENS * p.output;
}

function costOf(u: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined, p: Price) {
  if (!u) return null;
  if (typeof u.cost === "number") return u.cost;
  return (u.prompt_tokens ?? 0) * p.input + (u.completion_tokens ?? 0) * p.output;
}

/* ---------- output ---------- */

function summaryTable(runs: Run[]): string {
  const rows = runs.map((r) => {
    const passed = r.checks.filter((k) => k.pass).length;
    return [
      r.c.name,
      r.model.label,
      r.skipped ? "skipped" : r.error ? `error` : `${passed}/${r.checks.length}`,
      r.res ? String(r.res.suggestions.length) : "-",
      r.res ? String(r.res.dropped.length) : "-",
      r.skipped ? "-" : `${(r.latencyMs / 1000).toFixed(1)} s`,
      r.skipped ? "-" : money(r),
    ];
  });

  const totals = models.map((m) => {
    const mine = runs.filter((r) => r.model.id === m.id && !r.skipped);
    const passed = mine.reduce((n, r) => n + r.checks.filter((k) => k.pass).length, 0);
    const total = mine.reduce((n, r) => n + r.checks.length, 0);
    const avg = mine.length ? mine.reduce((n, r) => n + r.latencyMs, 0) / mine.length : 0;
    return [
      "**all**",
      `**${m.label}**`,
      `**${passed}/${total}**`,
      String(mine.reduce((n, r) => n + (r.res?.suggestions.length ?? 0), 0)),
      String(mine.reduce((n, r) => n + (r.res?.dropped.length ?? 0), 0)),
      `**${(avg / 1000).toFixed(1)} s avg**`,
      `**$${mine.reduce((n, r) => n + r.costUsd, 0).toFixed(4)}**`,
    ];
  });

  const header = ["Case", "Model", "Checks", "Placed", "Dropped", "Latency", "Cost"];
  return [header, header.map(() => "---"), ...rows, ...totals].map((r) => `| ${r.join(" | ")} |`).join("\n");
}

function renderReport(runs: Run[], summary: string, spent: number): string {
  const lines = [
    `# Model comparison`,
    ``,
    `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · models: ${models.map((m) => `\`${m.id}\``).join(", ")}${dryRun ? " · **DRY RUN (fake model)**" : ""}`,
    ``,
    `Each case is run once per model, one call at a time. Checks are pass/fail and listed per case; whether a fix is actually good is a judgement call, so every suggestion is shown in full below. Fixtures: \`eval/docs/\`. Prompts: \`lib/prompts.ts\`.`,
    ``,
    `## Summary`,
    ``,
    summary,
    ``,
    `Budget used: $${spent.toFixed(4)} (calls with no usage returned are counted at their worst case)`,
  ];

  for (const c of selected) {
    const doc = loadDoc(c.docFile);
    const mine = runs.filter((r) => r.c === c);
    lines.push(``, `## ${c.title}`, ``, `\`${c.docFile}\` · planted: ${c.problems.join("; ")}`, ``);
    lines.push(`| | ${mine.map((r) => r.model.label).join(" | ")} |`, `|---|${mine.map(() => "---").join("|")}|`);
    const row = (name: string, cell: (r: Run) => string) => lines.push(`| **${name}** | ${mine.map((r) => cell(r)).join(" | ")} |`);
    row("Note", (r) => (r.res ? esc(r.res.note) : r.error ? `⚠ ${esc(r.error)}` : esc(r.skipped ?? "")));
    row("Suggestions", (r) => (r.res ? r.res.suggestions.map((s, i) => `${i + 1}. ${showSuggestion(doc, s)}`).join("<br><br>") || "_none_" : ""));
    row("Dropped", (r) => (r.res ? r.res.dropped.map((d) => `${d.why}: “${esc(clip(d.quote, 60))}”`).join("<br>") || "_none_" : ""));
    row("Checks", (r) => r.checks.map((k) => `${k.pass ? "✓" : "✗"} ${esc(k.label)}`).join("<br>"));
    row("Latency", (r) => (r.skipped ? "-" : `${(r.latencyMs / 1000).toFixed(1)} s`));
    row("Tokens in/out", (r) => (r.res ? `${r.res.usage.inputTokens} / ${r.res.usage.outputTokens}` : "-"));
    row("Cost", (r) => (r.skipped ? "-" : money(r)));
  }
  return lines.join("\n") + "\n";
}

function showSuggestion(doc: string, s: SuggestResponse["suggestions"][number]): string {
  const before = esc(clip(doc.slice(Math.max(0, s.from - 24), s.from), 24, true));
  const del = s.quote ? `<del>${esc(s.quote)}</del>` : "";
  const ins = s.replacement ? `<ins>${esc(s.replacement)}</ins>` : "";
  return `…${before}${del}${ins}<br>_${esc(s.reason)}_`;
}

const money = (r: Run) => (r.costKnown ? `$${r.costUsd.toFixed(4)}` : `≤ $${r.costUsd.toFixed(4)} (no usage returned)`);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "&#124;").replace(/\n/g, "↵");
const clip = (s: string, n: number, fromEnd = false) =>
  s.length <= n ? s : fromEnd ? s.slice(s.length - n) : `${s.slice(0, n)}…`;

function fail(msg: string): never {
  console.error(`eval: ${msg}`);
  process.exit(1);
}

/* ---------- dry run ---------- */

/** A stand-in OpenRouter: fixes known typos, adds one unplaceable edit. Offline. */
async function fakeOpenRouter(_url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const body = JSON.parse(String(init?.body));
  const user: string = body.messages.at(-1).content;
  const edits = [];
  if (user.includes("recieve")) edits.push({ quote: "will recieve their", replacement: "will receive their", reason: "Spelling." });
  if (user.includes("definately")) edits.push({ quote: "definately", replacement: "definitely", reason: "Spelling." });
  if (user.includes("Mistakes were made"))
    edits.push({ quote: "Mistakes were made in how", replacement: "We made mistakes in how", reason: "Say who acted." });
  edits.push({ quote: "text that is not there", replacement: "x", reason: "Exercises not_found." });
  await new Promise((r) => setTimeout(r, 20));
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ note: "Dry run.", edits }) } }],
      usage: { prompt_tokens: 900, completion_tokens: 120, cost: 0.0001 },
    }),
    { status: 200 },
  );
}

// last, so every helper above is initialised before it runs
await main();
