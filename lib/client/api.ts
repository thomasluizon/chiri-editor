import type { SuggestRequest, SuggestResponse } from "@/lib/types";

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** POST /api/suggest. Throws an Error with the server's message on failure; AbortError on cancel. */
export async function postSuggest(body: SuggestRequest, signal: AbortSignal): Promise<SuggestResponse> {
  const res = await fetch("/api/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch (e) {
    if (isAbort(e)) throw e; // cancelled while the body was downloading: still a cancel
  }

  if (!res.ok) throw new Error((json as { error?: string } | null)?.error ?? `The server answered ${res.status}.`);
  if (!json || !Array.isArray((json as SuggestResponse).suggestions)) {
    throw new Error("The server sent an unreadable answer.");
  }
  return json as SuggestResponse;
}
