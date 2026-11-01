import { DEFAULT_MODEL, parseSuggestRequest, suggest, SuggestError } from "@/lib/server/suggest";

/**
 * POST /api/suggest (SPEC §3). Thin wrapper: the key stays here on the
 * server; all behaviour lives in lib/server/suggest.ts.
 */
export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return error(500, "The server has no OPENROUTER_API_KEY. Add it to .env and restart.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, "Invalid request. The body must be JSON.");
  }

  try {
    const req = parseSuggestRequest(body);
    const result = await suggest(req, {
      apiKey,
      model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
      signal: request.signal,
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof SuggestError) return error(e.status, e.message);
    console.error("suggest failed", e instanceof Error ? e.message : e);
    return error(500, "Something went wrong on the server.");
  }
}

const error = (status: number, message: string) => Response.json({ error: message }, { status });
