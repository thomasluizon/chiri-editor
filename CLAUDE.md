# CLAUDE.md

Markdown editor with inline AI suggestions (Next.js + CodeMirror 6 + OpenRouter). `SPEC.md` is the source of truth: read it before changing behaviour, and update it when a decision changes.

## Commands

- `npm run dev`: app on http://localhost:3000 (needs `OPENROUTER_API_KEY` in `.env`; see `.env.example`). Node ≥ 20.12.
- `npm run screenshots -- <url>` drives the UI with `/api/suggest` mocked, so it shows the default, ⌘K and thinking states without spending anything
- `npm run typecheck`
- `npm test`: Vitest unit and API route tests (`tests/unit/`, OpenRouter mocked). Test names carry their SPEC §7 numbers.
- Screenshots land in `design/screenshots/` (git-ignored)

- `npm run test:e2e`: Playwright, SPEC 7.4 (21–32). It starts its own dev server on port 3210 with an invalid key, and `/api/suggest` is intercepted in the browser.
- `node scripts/live-walkthrough.mjs <url> [--mock]`: drives the real UI through review, accept, reject, refine ×2 and typing during ⌘K, with screenshots in `design/screenshots/live/`. **Without `--mock` it calls the real models (about 1¢), so ask first.**
- `npm run credit`: the key's remaining credit (GET /api/v1/key, not billed).
- `npm run eval -- --dry-run [--models …]`: the eval against a fake model. Free and offline; reports go to `eval/reports/dry/` (git-ignored). Run this before any live eval.
- `npm run eval -- [--models haiku,luna,sonnet] [--case name] [--max-usd 0.15]`: **real API calls, costs money.** Ask before running it. Every call's worst case is checked against `--max-usd` before it's sent.


## Things that aren't obvious from the code

- **Never read, print or edit `.env`.** It holds `OPENROUTER_API_KEY` on a $5 cap that is mostly reserved for reviewers. Only server code touches the key, through `process.env`. Use mocks; live calls only go through `npm run eval`, and only after asking.
- **The doc only changes on Accept.** Suggestions are CM6 decorations held in a `StateField`, not edits to the doc.
- **Offsets are UTF-16 indices** into the doc *as sent*. The client maps them through the user's edits made since the request, then re-checks that the text at the mapped range still equals `quote`, and drops the suggestion if it doesn't. Never place an edit by guessing.
- **Quote matching is exact.** A quote that matches zero times or more than once is dropped, never fuzzy-matched.
- **All prompt text lives in `lib/prompts.ts`.** Don't put prompt strings anywhere else. After changing a prompt, re-run the eval (with permission) and compare.
- **Max 5 edits per request**, and zero is a valid answer.
- **Keymap:** Tab/Shift-Tab indent via CM6 `indentWithTab`. It isn't in `defaultKeymap`, so without it Tab would leave the editor. Never take Tab, ⌘⌫ (macOS delete to line start) or ⌘↵ (CM6 insert blank line) for our own commands. Accept is ⌥↵ and reject is Esc, and both only fire when the cursor is inside a suggestion.
- **Session logs:** the raw `.jsonl` transcripts get committed (the brief requires it). Before committing them, grep for `sk-or-` and mask any match. Make no other edits to them.
- **Next 16 writes `AGENTS.md`** on `next dev`, pointing to the bundled docs in `node_modules/next/dist/docs/`. Check those before using a Next API from memory.
- **Design tokens** live in `DESIGN.md` and `app/tokens.css`. Change both together, and keep the two dark blocks in `tokens.css` identical.
- **Live preview hides Markdown marks** but never edits the text. Positions are always raw-doc offsets. If you add a new syntax mark, update `findMarks` and its tests; a hidden mark must never sit inside a suggestion's range (`revealedLines` handles that).
- **OpenRouter request shape:** don't add `temperature` (the chosen models don't support it, and `require_parameters` would then find no provider). Reasoning effort and any extra `max_tokens` are set per model in `lib/server/models.ts`. Sonnet 5.5 rejects `effort: "none"` and needs a 1024-token reasoning reserve.
