# CLAUDE.md

Markdown editor with inline AI suggestions (Next.js + CodeMirror 6 + OpenRouter). `SPEC.md` is the source of truth: read it before changing behaviour, and update it when a decision changes.

## Commands

- `npm run dev`: app on http://localhost:3000 (currently the design mock; `?state=ask` / `?state=thinking` show those states)
- `npm run typecheck`
- `npm test`: Vitest unit and API route tests (`tests/unit/`, OpenRouter mocked). Test names carry their SPEC §7 numbers.
- `npm run screenshots -- <base url>`: design screenshots (1440/390 × light/dark × states) into `design/screenshots/`, which is git-ignored

- `npm run eval -- --dry-run [--models …]`: the eval against a fake model. Free, offline. Run this before any live eval.
- `npm run eval -- [--models haiku,luna,sonnet] [--case name] [--max-usd 0.15]`: **real API calls, costs money.** Ask before running it. Every call's worst case is checked against `--max-usd` before it's sent.

Planned, not wired yet:
- `npm run test:e2e`: Playwright (`/api/suggest` is intercepted, no API calls)

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
