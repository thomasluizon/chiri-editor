/**
 * Print the OpenRouter key's remaining credit (GET /api/v1/key; not a model
 * call, not billed). Only money fields are printed: the key's `label` can
 * contain a masked copy of the key.
 *
 *   npm run credit
 */
try {
  process.loadEnvFile(".env");
} catch {
  // rely on the environment
}
const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error("credit: OPENROUTER_API_KEY is not set");
  process.exit(1);
}
const res = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` } });
if (!res.ok) {
  console.error(`credit: HTTP ${res.status}`);
  process.exit(1);
}
const json = (await res.json()) as Record<string, unknown> & { data?: Record<string, unknown> };
const d = json.data ?? json;
const usd = (v: unknown) => (typeof v === "number" ? `$${v.toFixed(4)}` : "n/a");
console.log(`remaining ${usd(d.limit_remaining)} of ${usd(d.limit)} · used ${usd(d.usage)}`);

export {};
