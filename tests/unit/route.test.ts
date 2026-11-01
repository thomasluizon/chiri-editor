import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/suggest/route";

const KEY = "sk-or-v1-test-SECRET-do-not-leak";
const DOC = "# Notes\n\nWe recieve feedback weekly. The team is great.";

function call(body: unknown) {
  return POST(
    new Request("http://localhost/api/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

/** A fake OpenRouter chat completion whose message content is `content`. */
function completion(content: string, usage = { prompt_tokens: 812, completion_tokens: 64, cost: 0.00011 }) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", KEY);
  vi.stubEnv("OPENROUTER_MODEL_REVIEW", "test-vendor/review-model");
  vi.stubEnv("OPENROUTER_MODEL_EDIT", "test-vendor/edit-model");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("SPEC 7.3: API route (OpenRouter mocked)", () => {
  it("16. a valid model response returns 200 with suggestions, dropped and usage.latencyMs", async () => {
    fetchMock.mockResolvedValue(
      completion(
        JSON.stringify({
          note: "One typo.",
          edits: [
            { quote: "We recieve feedback", replacement: "We receive feedback", reason: "Spelling." },
            { quote: "not in the doc", replacement: "x", reason: "Made up." },
          ],
        }),
      ),
    );
    const res = await call({ mode: "suggest", doc: DOC });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.note).toBe("One typo.");
    expect(body.suggestions).toHaveLength(1);
    const s = body.suggestions[0];
    expect(s).toMatchObject({ quote: "recieve", replacement: "receive", reason: "Spelling." });
    expect(DOC.slice(s.from, s.to)).toBe("recieve");
    expect(typeof s.id).toBe("string");
    expect(body.dropped).toEqual([{ quote: "not in the doc", why: "not_found" }]);
    expect(body.usage).toMatchObject({ inputTokens: 812, outputTokens: 64, costUsd: 0.00011 });
    expect(body.usage.latencyMs).toBeTypeOf("number");
    expect(body.usage.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("17. zero edits returns 200 with an empty suggestions list and the note", async () => {
    fetchMock.mockResolvedValue(completion(JSON.stringify({ note: "This reads well; nothing to change.", edits: [] })));
    const res = await call({ mode: "suggest", doc: DOC });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suggestions).toEqual([]);
    expect(body.dropped).toEqual([]);
    expect(body.note).toBe("This reads well; nothing to change.");
  });

  it("18. output that isn't JSON, or doesn't match the schema, returns 502 without the key", async () => {
    for (const content of ["Sure! Here are some edits: ...", JSON.stringify({ note: "n", edits: [{ quote: "x" }] })]) {
      fetchMock.mockResolvedValueOnce(completion(content));
      const res = await call({ mode: "suggest", doc: DOC });
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(JSON.parse(text).error).toBeTruthy();
      expect(text).not.toContain(KEY);
    }
  });

  it("18b. a provider error that echoes the key is redacted", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: `Invalid key ${KEY}` } }), { status: 401 }),
    );
    const res = await call({ mode: "suggest", doc: DOC });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(text).toContain("[redacted]");
  });

  it("19. a doc over 40k chars returns 413; a bad scope returns 400", async () => {
    const big = await call({ mode: "suggest", doc: "a".repeat(40_001) });
    expect(big.status).toBe(413);

    const badScope = await call({ mode: "suggest", doc: DOC, scope: { from: 5, to: DOC.length + 10 } });
    expect(badScope.status).toBe(400);
    const reversed = await call({ mode: "suggest", doc: DOC, scope: { from: 20, to: 10 } });
    expect(reversed.status).toBe(400);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("R-nit. oversized refine fields are rejected with 400 before any model call", async () => {
    const target = { from: 12, to: 19, quote: DOC.slice(12, 19), replacement: "receive", history: [] as { instruction: string; replacement: string }[] };
    const huge = "x".repeat(40_001);
    const cases = [
      { ...target, replacement: huge },
      { ...target, history: [{ instruction: "shorter", replacement: huge }] },
      { ...target, history: [{ instruction: "y".repeat(501), replacement: "ok" }] },
    ];
    for (const t of cases) {
      const res = await call({ mode: "refine", doc: DOC, instruction: "shorter", target: t });
      expect(res.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("20. the outgoing request uses the right model per request, max_tokens 1200 and a strict json_schema", async () => {
    fetchMock.mockImplementation(async () => completion(JSON.stringify({ note: "n", edits: [] })));
    const sentModel = (i: number) => JSON.parse((fetchMock.mock.calls[i] as [string, RequestInit])[1].body as string).model;

    // ⌘K (scoped) and refine go to the edit model; Review doc (no scope) to the review model
    await call({ mode: "suggest", doc: DOC, instruction: "Tighten", scope: { from: 9, to: DOC.length } });
    await call({
      mode: "refine",
      doc: DOC,
      instruction: "shorter",
      target: { from: 12, to: 19, quote: DOC.slice(12, 19), replacement: "receive", history: [] },
    });
    await call({ mode: "suggest", doc: DOC });
    expect([sentModel(0), sentModel(1), sentModel(2)]).toEqual([
      "test-vendor/edit-model",
      "test-vendor/edit-model",
      "test-vendor/review-model",
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);

    const sent = JSON.parse(init.body as string);
    expect(sent.max_tokens).toBe(1200);
    expect(sent.response_format.type).toBe("json_schema");
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect(sent.response_format.json_schema.schema.required).toEqual(["note", "edits"]);
    expect(sent.reasoning).toEqual({ effort: "none" });
  });

  it("20b. a model that can't disable reasoning gets its lowest effort and a reasoning reserve", async () => {
    vi.stubEnv("OPENROUTER_MODEL_REVIEW", "anthropic/claude-sonnet-5.5");
    fetchMock.mockResolvedValue(completion(JSON.stringify({ note: "n", edits: [] })));
    await call({ mode: "suggest", doc: DOC });

    const sent = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(sent.reasoning).toEqual({ effort: "low" });
    // 1200 for the answer + 1024, Anthropic's minimum thinking budget, which counts inside max_tokens
    expect(sent.max_tokens).toBe(2224);
  });
});
