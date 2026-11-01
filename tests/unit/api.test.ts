import { afterEach, describe, expect, it, vi } from "vitest";
import { isAbort, postSuggest } from "@/lib/client/api";

const body = { mode: "suggest" as const, doc: "Hello." };
afterEach(() => vi.unstubAllGlobals());

describe("review fixes: API client (R4)", () => {
  it("R4a. a 200 whose body isn't JSON throws a readable error instead of returning null", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>proxy page</html>", { status: 200 }));
    await expect(postSuggest(body, new AbortController().signal)).rejects.toThrow(/unreadable/i);
  });

  it("R4b. a cancel while the body downloads stays a cancel (AbortError), not a null result", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: () => Promise.reject(new DOMException("The operation was aborted.", "AbortError")),
    }));
    const err = await postSuggest(body, new AbortController().signal).then(
      (v) => v,
      (e) => e,
    );
    expect(isAbort(err)).toBe(true);
  });
});
