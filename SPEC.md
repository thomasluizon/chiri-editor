# SPEC: AI co-author for Markdown

Status: agreed. Next step is the model comparison (§6), then the app.

## 1. What we're building

A single-page Markdown editor where an AI suggests a few targeted edits that show up **inline, like suggesting mode in Google Docs**. Each suggestion has **Accept**, **Reject** and **Refine**. The document text only changes when the user accepts. The user can keep typing while the AI is thinking, and suggestions still land on the right text when they arrive.

There are two ways to ask:
- **Review doc** (a toolbar button). It works on the whole document and is what a first-time visitor will probably click first.
- **⌘K**. It works on the selection, or on the paragraph under the cursor if nothing is selected, and takes a free-text instruction or a preset.

## 2. Decisions and why

| # | Decision | Why |
|---|----------|-----|
| D1 | **CodeMirror 6** with `@codemirror/lang-markdown`, not TipTap | The Markdown string is the thing we store and edit, so there's no conversion between Markdown and a rich-text tree, and the AI's offsets point straight at the raw text. TipTap's track-changes extension is paid. CM6 has what we need for free: `Decoration` for inline diffs, `StateField` for suggestion state, and `ChangeSet.mapPos` to move positions through edits. |
| D2 | **Suggestions are decorations, not document changes** | Deleted text is shown with a strikethrough `Decoration.mark`. Inserted text is a `Decoration.widget` that sits next to it, plus a small card with the reason and Accept / Reject / Refine. Because nothing is written into the doc until Accept, a reject or a page reload can never leave half-applied AI text behind. |
| D3 | **The model returns at most 5 small edits, and fewer (or none) is fine** | Each edit is `{ quote, replacement, reason }`. The prompt says outright that zero edits is a good answer when the text is already fine. With more than about 5 edits it starts to feel like a linter rather than a co-author. Small edits also keep output tokens and cost low, and match the brief's "not something that completes the whole document". |
| D4 | **The server places each quote by exact match. Zero matches or more than one means the edit is dropped.** | No fuzzy matching or guessing. A suggestion in the wrong place is worse than a missing one. The prompt tells the model to quote enough surrounding text to be unique. Dropped edits are reported back (see §3) so the UI can say "1 suggestion couldn't be placed" instead of failing silently. |
| D5 | **Positions follow the user's typing** | The client takes a snapshot of the doc when it sends a request and collects every change made after that. When the response arrives, each `from/to` is mapped through those changes. Then we **re-check that the mapped range still contains exactly `quote`**. If the user edited inside that range, the suggestion is stale and gets dropped. Suggestions already on screen are mapped on every transaction the same way, and are removed if an edit touches their range. |
| D6 | **One Next.js app (App Router) with one route, `POST /api/suggest`** | The route holds the OpenRouter key. It's a thin wrapper around `suggest()` in `lib/server/`, so the eval script (§7) exercises exactly the same prompt and placement code as the app. No DB, no auth. |
| D7 | **Model: decided by the comparison in §6**, configurable with `OPENROUTER_MODEL` | We're comparing Haiku 5.5, GPT-6 Luna and Sonnet 5.5 on the same docs. Speed counts as much as quality. |
| D8 | **Structured output**: OpenRouter `response_format: { type: "json_schema", strict: true }`, and the server validates again with zod | The model is asked for a strict JSON shape, and the server still re-checks it before use. If the output doesn't validate, we return a 502 with a clear message. There are no automatic retries, so a bad response never costs us twice. |
| D9 | **No streaming** | The output is a short JSON list, so streaming partial JSON adds complexity without much visible benefit. The UI shows a "thinking…" state on the target range, with a Cancel button that uses `AbortController`. |
| D10 | **The doc is autosaved to `localStorage`** | A reload doesn't lose the user's work, and we still don't need a backend. Pending suggestions are not saved. A sample doc loads on the first visit so there's something to review straight away. |
| D11 | **Accept is a normal CM6 transaction** | Accepting can be undone with ⌘Z using the editor's built-in history, so we don't need a custom undo system. |
| D12 | **All prompts live in one file, `lib/prompts.ts`** | Most of the quality comes from the prompts. Keeping the system prompt, the review, ⌘K and refine templates, and the preset wording in one place makes them easy to read, compare and tune with the eval script. No other file contains prompt text. |
| D13 | **Our shortcuts never take keys the editor or the OS already uses** | ⌘⌫ (delete to line start on macOS), ⌘↵ (CM6 "insert blank line") and Tab/Shift-Tab (list indenting) are left alone. See §4 for what we use instead. |
| D14 | **Live preview: Markdown marks are hidden except on the lines being edited** | The document still reads like a document (DESIGN.md), and the stored text stays raw Markdown. If a suggestion touches a mark, that line shows its marks, so a diff never hides a syntax change. |

### Placement rules (beyond plain exact matching)

1. **When there's a selection or a ⌘K paragraph, only look for quotes inside it.** Quotes only have to be unique inside that range. Offsets are translated back to whole-document positions before they're returned. Review doc searches the whole document.
2. **Trim the shared start and end of each edit.** The server cuts the characters that `quote` and `replacement` have in common at the start and end, then snaps to word boundaries, so the stored `from/to` is as small as possible. Without this, "add a sentence after X" would show as *delete X, insert X + sentence*.
3. **Drop overlapping edits and no-ops.** If two edits overlap, the first one wins and the second is dropped as `overlap`. If an edit's replacement is the same as its quote, it's dropped as `noop`. New suggestions that overlap a suggestion already on screen are dropped on the client.
4. **Requests can run at the same time.** Each request keeps its own snapshot and its own list of changes made since (D5), so a Refine can run while a Review doc request is still in flight.

## 3. API contract

Offsets are **UTF-16 code-unit indices** into the doc string. That's what both JS strings and CM6 use, so emoji and other non-ASCII text map the same way on both sides. Line endings are `\n`, because CM6 normalizes them.

### Request: `POST /api/suggest`

```ts
type SuggestRequest =
  | {
      mode: "suggest";
      doc: string;                       // full doc as sent (≤ 40,000 chars)
      instruction?: string;              // ≤ 500 chars; omitted = general review
      scope?: { from: number; to: number }; // ⌘K: selection or cursor paragraph. Omitted = Review doc
    }
  | {
      mode: "refine";
      doc: string;
      instruction: string;               // e.g. "shorter", "more formal"
      target: {
        from: number; to: number;        // the suggestion's current range in `doc`
        quote: string;                   // original text in that range
        replacement: string;             // the latest suggested text
        history: { instruction: string; replacement: string }[]; // last ≤ 4 turns
      };
    };
```

The ⌘K preset chips (*Tighten*, *Fix grammar*, *More formal*, *More casual*, *Clarify*) send instruction strings whose wording lives in `lib/prompts.ts`.

### Model output (JSON schema enforced by OpenRouter)

```ts
{
  note: string;   // one sentence to the user, e.g. "Moved the key point up; the rest reads well."
  edits: { quote: string; replacement: string; reason: string }[]; // 0–5 items, reason ≤ 120 chars
}
```

In `refine` mode the model returns `{ note, replacement, reason }`, with no `quote`: the range is already known from `target`, so there is nothing to locate or mismatch. The server trims the shared start and end the same way as in suggest mode.

### Response: `200`

```ts
type SuggestResponse = {
  note: string;
  suggestions: {
    id: string;          // server-generated
    from: number;        // offset in the doc *as sent*
    to: number;
    quote: string;       // doc.slice(from, to) after prefix/suffix trimming
    replacement: string;
    reason: string;
  }[];
  dropped: { quote: string; why: "not_found" | "ambiguous" | "overlap" | "noop" | "outside_scope" }[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null; latencyMs: number };
};
```

An empty `suggestions` list is a normal answer. The UI shows the `note` (for example, "This reads well; nothing to change.").

### Errors

| Status | When |
|--------|------|
| 400 | Body fails zod validation, or `scope`/`target` is out of bounds |
| 413 | `doc` is over 40,000 chars |
| 502 | OpenRouter error, or the model output doesn't validate (message passed through, key never included) |
| 504 | Upstream took longer than 30 s |

Server-side limits: `max_tokens: 1200`, reasoning off (`reasoning: {effort: "none"}`), and a 30 s timeout.

Implementation notes, learned while building:
- **No `temperature`.** None of the shortlisted models list it as supported on OpenRouter, and with `provider.require_parameters: true` (which makes sure the provider honours structured outputs) an unsupported parameter would leave no provider to route to.
- **Limits live in zod, not the JSON schema.** Strict mode may reject keywords such as `maxItems`/`maxLength`, so the schema sent to the model is plain. "At most 5 edits" is in the prompt and enforced by zod: a sixth edit is a 502. A `reason` over 120 characters is cut at a word boundary rather than failing the whole response.
- **Some models can't turn reasoning off.** Sonnet 5.5 rejects `effort: "none"` (see §6), so a model that needs reasoning would need its own setting.

## 4. UI behaviour

- **Toolbar.** **Review doc**, prev/next suggestion arrows, **Accept all / Reject all**, and a status area with the last `note` and how many suggestions were dropped.
- **⌘K** opens a small inline prompt anchored to the selection, or to the paragraph under the cursor, with preset chips under it. It's not a chat sidebar.
- **While waiting.** The target range (or the whole doc for Review doc) gets a subtle shimmer and the request shows "thinking…" with a Cancel button. The editor stays fully editable.
- **Showing suggestions.** Deleted text is red with a strikethrough. Inserted text is green. Putting the cursor in a suggestion or hovering over it opens its card with the reason and **Accept / Reject / Refine**.
- **Refine.** Opens a one-line input on the card. The suggestion is replaced in place when the response arrives.

### Keyboard (only active when the cursor is inside a suggestion; otherwise the key passes through)

| Key | Action | Why this key |
|-----|--------|--------------|
| ⌘K | Open the Ask AI prompt (works anywhere) | Not bound by CM6 (only Ctrl-K/Shift-⌘K are) |
| ⌥↵ | Accept | ⌘↵ is CM6 "insert blank line". ⌥↵ is free. |
| Esc | Reject | CM6 binds Esc to "simplify selection". Ours runs first only when the cursor is on a suggestion. |

There's no keyboard shortcut for moving between suggestions; the toolbar arrows do that. Tab and Shift-Tab always indent and outdent. These choices were checked against `@codemirror/commands` `defaultKeymap`/`standardKeymap`.

## 5. Out of scope (on purpose)

- Auth, database, multi-user real-time collaboration (CRDT/OT), deployment, Docker
- Fuzzy or "best guess" quote matching (D4)
- Streaming responses (D9)
- A rendered Markdown preview pane. The source gets syntax highlighting, and that's all.
- Saved version history beyond CM6 undo
- Saving pending suggestions across reloads
- Rate limiting. The app runs locally on the reviewer's own key, and the server limits in §3 cap what one request can spend.

## 6. Model choice: comparison first

These are OpenRouter list prices fetched from `GET /api/v1/models` on **2026-11-01**. Every model listed supports strict `structured_outputs`.

| Model | $/M input | $/M output | Est. cost per request* |
|-------|-----------|-----------|----------------------|
| anthropic/claude-haiku-5.5 | 0.10 | 0.50 | ~$0.0007 |
| openai/gpt-6-luna | 0.10 | 0.50 | ~$0.0007 |
| anthropic/claude-sonnet-5.5 | 2.00 | 10.00 | ~$0.014 |

\*Assumes about 4k input tokens and 600 output tokens.

**How we'll compare them.** Run `npm run eval -- --models haiku,luna,sonnet` (§7.5) once the prompts and `suggest()` exist. That's 4 cases × 3 models = 12 calls, about **$0.07**. The script writes a side-by-side report for each case showing every model's note, placed suggestions, dropped edits, latency and cost. **You pick the model from that report.** Then we set the default `OPENROUTER_MODEL` and commit the report as `eval/reports/model-comparison.md`, as evidence for the choice.

**First run (2026-11-01):** `eval/reports/2026-11-01-17-42-haiku-luna-sonnet.md`. Haiku 5.5 and GPT-6 Luna both passed 14 of 15 checks, counting the one false negative noted in the report. Luna averaged 2.5 s per call and Haiku 3.2 s. Neither had a single quote dropped. Sonnet 5.5 didn't run at all, because it can't turn reasoning off. The default model stays Haiku until you pick.

**Budget.** Development and every automated test use mocked responses. The live spend I expect (comparison, a few rounds of prompt tuning, a final eval run) is under **$0.40**, which leaves more than $4.50 for reviewers. Sonnet at roughly $0.014 per request would still allow about 300 reviewer requests, if it wins.

## 7. Tests that show it works

Unit and API tests use **Vitest**. End-to-end tests use **Playwright** and intercept `/api/suggest`, so they cost nothing and give the same result every run.

### 7.1 Unit: placing quotes (`locateEdits`, a pure function)
1. A quote that appears once is placed at the correct `from/to`.
2. A quote that appears 0 times is dropped as `not_found`.
3. A quote that appears 2 times is dropped as `ambiguous`.
4. A quote that appears twice in the doc but once inside `scope` is placed at the occurrence inside the scope.
5. A quote that's only outside the scope is dropped as `outside_scope`.
6. Two overlapping edits: the first is kept and the second is dropped as `overlap`.
7. `replacement === quote` is dropped as `noop`.
8. Trimming: quote `"The cat sat."` with replacement `"The black cat sat."` becomes an insertion of `"black "` at the right offset.
9. Offsets are correct when emoji and accented characters come before the quote (UTF-16).
10. A sixth edit from a misbehaving model is rejected by validation (we accept at most 5).

### 7.2 Unit: mapping positions (client, pure functions over CM6 `ChangeSet`)
11. Text inserted before a suggestion shifts its range by the inserted length.
12. Text inserted after a suggestion leaves its range unchanged.
13. An edit inside a suggestion's range makes it stale, and it's dropped because the re-check against `quote` fails.
14. A suggestion still applies correctly after several changes were made in a row.
15. The paragraph under the cursor is detected correctly at the start, middle and end of a paragraph, inside a list item and on a heading.

### 7.3 API route (OpenRouter `fetch` mocked)
16. A valid model JSON response returns 200 with the expected `suggestions`, `dropped` and `usage.latencyMs`.
17. A response with zero edits returns 200 with an empty `suggestions` list and the `note`.
18. Model output that isn't valid JSON or doesn't match the schema returns 502, and the body doesn't contain the API key.
19. A doc over 40k chars returns 413. A bad scope returns 400.
20. The outgoing request uses `OPENROUTER_MODEL`, `max_tokens: 1200` and a `json_schema` response format.

### 7.4 End-to-end (Playwright, mocked route)
21. **Review doc, then accept.** Clicking Review doc sends no `scope`. The suggestion renders as a strikethrough plus the inserted text, and the doc is unchanged until Accept. After Accept the doc equals the expected string.
22. **⌘K on a paragraph.** With no selection, `scope` covers exactly the paragraph under the cursor.
23. **Reject with Esc.** With the cursor in a suggestion, Esc removes it and the doc is byte-for-byte unchanged. With the cursor outside any suggestion, Esc does what CM6 normally does.
24. **Accept with ⌥↵.** It works only when the cursor is in a suggestion. ⌘↵ still inserts a blank line.
25. **Tab is untouched.** With a suggestion visible inside a list, Tab still indents the list item.
26. **Refine.** The card input sends `mode: "refine"` with `history`, and the inserted text is updated in place.
27. **Zero suggestions.** The note is shown and there are no decorations.
28. **Typing while a request is running (the key test).** The doc is `"Intro.\n\nThe quick brown fox."`. Ask for a suggestion. The mock holds the response for 1.5 s and returns a replacement of `"quick brown fox"` with `"fast auburn fox"`. While it's pending, type `"Hello world. "` at the start of the doc. Then check:
    - the suggestion appears on `quick brown fox`, which has moved 13 characters, and not at the old offset;
    - after Accept the doc is exactly `"Hello world. Intro.\n\nThe fast auburn fox."`;
    - the text typed during the wait is intact.
29. **Typing inside the target while a request is running.** Same setup, but change `brown` to `red` before the response arrives. That suggestion is dropped and the status area reports it. Other suggestions in the same response still show.
30. **Editing inside a suggestion that's already showing** removes it.
31. **Undo after accept.** ⌘Z puts back the original text.
32. **Cancel.** Clicking Cancel aborts the fetch, and no suggestions appear.

### 7.5 Live eval: `npm run eval` (real API calls, costs money, never run by default)

The same script is used for prompt tuning and for the model comparison. It calls `suggest()` directly, so it runs the real prompts and the real placement code.

**Fixtures** live in `eval/docs/`. Each doc has real problems planted in it, plus one paragraph that is already fine, to catch the model editing things that don't need editing:

| Doc | Planted problems |
|-----|------------------|
| `launch-update.md` (team update) | **Buried lede**: the key news is in paragraph 3. Also one **typo** (`recieve`). |
| `onboarding-guide.md` (how-to) | **A rambling paragraph** of about 180 words that repeats itself, plus **passive voice** ("The form should be submitted by the new hire…"). |
| `product-memo.md` (opinion memo) | Passive voice, a vague claim, and the typo `definately`. |

**Cases:**
- Review doc on each of the 3 docs.
- ⌘K "Tighten" on the rambling paragraph only.

**Checks**, defined next to each fixture in `eval/cases.ts`:
- **Typo:** some placed suggestion's quote contains `recieve` or `definately` and its replacement fixes the spelling. Pass/fail.
- **Problem area touched:** at least one placed suggestion overlaps the buried-lede paragraph, the rambling paragraph, and the passive sentence. Pass/fail. Whether the fix is actually *good* is your call from the printed output.
- **Leaves the good paragraph alone:** no suggestion touches the control paragraph. Pass/fail.
- **Fits the contract:** 5 edits or fewer, schema valid, no `scope` violations.

**Output:**
- A terminal summary table: one row per case × model with checks passed, placed/dropped counts, latency and cost.
- A Markdown report in `eval/reports/` with the full side-by-side output for each case: the model's note, then each suggestion as `quote → replacement — reason`, then the dropped edits with their reasons. Columns are the models.
- Flags: `--models <list>` (default: `OPENROUTER_MODEL`) and `--case <name>`. Calls run one at a time so the latency numbers are fair.

## 8. Planned layout

```
app/page.tsx                 editor page (client)
app/api/suggest/route.ts     thin HTTP wrapper: validate → suggest() → JSON
lib/prompts.ts               every prompt and preset string (D12)
lib/server/suggest.ts        builds messages, calls OpenRouter, validates, places edits
lib/server/locate.ts         locateEdits(): exact match, scope, trim, overlap/noop
lib/editor/suggestions.ts    CM6 StateField + decorations + mapping (D5)
lib/editor/keymap.ts         ⌘K / ⌥↵ / Esc (D13)
lib/types.ts                 SuggestRequest / SuggestResponse (shared)
eval/run.ts, eval/cases.ts, eval/docs/*.md, eval/reports/
tests/unit, tests/e2e
```

## 9. Project hygiene

- The key lives only in `.env` (`OPENROUTER_API_KEY`, optionally `OPENROUTER_MODEL`), which Next.js loads on the server. `.env` is git-ignored, and an `.env.example` gets committed.
- `.claude/settings.json` blocks Claude Code from reading or editing `.env*`. Limitation: the `Read`/`Edit` rules fully cover the built-in tools, but the `Bash` rules only block the common commands (`cat`, `grep`, `source`, `printenv`, and so on). Something like `node -e` could still get around them, so we also stick to that rule by choice. Code reads the key only through `process.env` on the server.
- The brief requires committing the raw Claude Code session `.jsonl` files. Before committing them we grep for `sk-or-` and mask any match. That's the only change the brief allows.
- README: how to run, what we built, and what we'd do differently, as the brief asks.
