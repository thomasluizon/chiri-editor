import type { SuggestRequest, SuggestResponse } from "@/lib/types";

/** POST /api/suggest. Throws an Error with the server's message on failure; AbortError on cancel. */
export async function postSuggest(body: SuggestRequest, signal: AbortSignal): Promise<SuggestResponse> {
  const res = await fetch("/api/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `The server answered ${res.status}.`);
  return json as SuggestResponse;
}

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
