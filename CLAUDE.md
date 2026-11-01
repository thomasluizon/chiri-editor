# CLAUDE.md

Markdown editor with inline AI suggestions (Next.js + CodeMirror 6 + OpenRouter). `SPEC.md` is the source of truth: read it before changing behaviour, and update it when a decision changes.

## Commands

> These are planned; no app code exists yet. Update this list when `package.json` lands.

- `npm run dev`: app on http://localhost:3000
- `npm test`: Vitest unit and API tests (OpenRouter is mocked)
- `npm run test:e2e`: Playwright (`/api/suggest` is intercepted, no API calls)
- `npm run eval -- [--models haiku,luna,sonnet] [--case name]`: **real API calls, costs money.** Ask before running it.

## Things that aren't obvious from the code

- **Never read, print or edit `.env`.** It holds `OPENROUTER_API_KEY` on a $5 cap that is mostly reserved for reviewers. Only server code touches the key, through `process.env`. Use mocks; live calls only go through `npm run eval`, and only after asking.
- **The doc only changes on Accept.** Suggestions are CM6 decorations held in a `StateField`, not edits to the doc.
- **Offsets are UTF-16 indices** into the doc *as sent*. The client maps them through the user's edits made since the request, then re-checks that the text at the mapped range still equals `quote`, and drops the suggestion if it doesn't. Never place an edit by guessing.
- **Quote matching is exact.** A quote that matches zero times or more than once is dropped, never fuzzy-matched.
- **All prompt text lives in `lib/prompts.ts`.** Don't put prompt strings anywhere else. After changing a prompt, re-run the eval (with permission) and compare.
- **Max 5 edits per request**, and zero is a valid answer.
- **Keymap:** don't bind Tab/Shift-Tab (list indenting), ⌘⌫ (macOS delete to line start) or ⌘↵ (CM6 insert blank line). Accept is ⌥↵ and reject is Esc, and both only fire when the cursor is inside a suggestion.
- **Session logs:** the raw `.jsonl` transcripts get committed (the brief requires it). Before committing them, grep for `sk-or-` and mask any match. Make no other edits to them.
