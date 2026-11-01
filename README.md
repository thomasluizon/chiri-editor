# Draft: a Markdown editor with an AI co-author

![Review doc on the sample document: real Sonnet 5.5 output](docs/screenshot-light.png)

*Real model output on the sample document: suggestions inline (red struck = removed, green underlined = added), with the reason in the margin. Nothing changes until you accept. [Dark mode](docs/screenshot-dark.png).*

## Run it

Needs Node 20.12+ and an OpenRouter key.

```sh
npm ci
cp .env.example .env               # put your key in OPENROUTER_API_KEY
npm run dev                        # http://localhost:3000

npm test                           # unit + API tests (OpenRouter mocked)
npx playwright install chromium    # once
npm run test:e2e                   # browser tests (API intercepted, nothing billed)
npm run build
```

## What it does

- **Write Markdown** in a document-style editor. Markdown marks are hidden except on the line you're editing.
- **Review doc** suggests up to five small edits for the whole document, or none if it reads well.
- **⌘K or `/`** asks about the paragraph you're in: a preset (Tighten, Fix grammar, …), Review doc, or your own instruction.
- **Each suggestion** can be accepted (⌥↵), rejected (Esc) or refined ("shorter", "more formal").
- **Keep typing while it thinks.** Answers land on the right text even after you've edited around them.
- **AI history** lists every change the AI made, with its reason and model. An accepted change can be reverted later, unless the text has changed since.

How each part works, and why, is in [SPEC.md](SPEC.md). The visual system is in [DESIGN.md](DESIGN.md).

## Trade-offs

- **Small, anchored edits instead of rewrites.** The model returns the exact text to change. If it can't be found exactly once, the edit is dropped and reported, never guessed. You lose the occasional good suggestion, but you never get one in the wrong place.
- **Two models.** Sonnet 5.5 for Review doc, which needs judgment. Haiku 5.5 for ⌘K, `/` and refine, where speed matters more. An eval chose the split: Sonnet was the only model that fixed a buried lede with small edits, and Haiku was about 1 s faster on scoped edits ([report](eval/reports/2026-11-01-17-54-haiku-luna-sonnet.md)).
- **No streaming.** The answer is a short list, so a shimmer on the text being worked on covers the 2–4 s wait.
- **Local only.** No auth, database, collaboration or deployment. The document and its AI history live in localStorage, which is enough to show the editing loop.
- **Refine works on whole sentences.** Rewriting the trimmed fragment produced broken text ("In In the first week"), so refine widens to the sentence and trims the result back down.

## How I used AI

Built with Claude Code; the raw sessions are in `ai-sessions/`.

- **Spec first.** SPEC.md (the decisions, the contract and every test) and DESIGN.md were agreed before any code. New features started as spec sections with their tests.
- **An eval chose the models**, with live spend capped for each run and every run rehearsed against a fake model first.
- **Tests as the bar.** Every step ended with `npm test`, `npm run test:e2e` and `npm run build` green. Breaking the code on purpose confirmed the key tests can fail.
- **Real runs in the browser**, with a screenshot of every step, caught what tests didn't. I looked at each screenshot, in both themes and at phone width, and fixed what looked off.
- **A fresh review.** A separate agent with no context read the code and found seven issues. Each fix began with a test that failed without it.
- **Guardrails.** A deny rule kept the agent away from the key file. The whole project used about $0.08 of the $5 key.

## With more time

- **Refine next to another suggestion.** A rewrite that reaches a neighbouring suggestion is discarded (and says so). Better: tell the model which spans are off-limits, or merge the two.
- **Word-level diffs** inside a replacement, so the unchanged middle of a rewrite isn't shown as deleted and re-added.
- **Notes that match the edits.** Haiku's one-line notes sometimes describe more than it changed. Generate the note from the placed edits instead.
- **A bigger eval:** more documents, and several runs per case.
- **Phone:** a bottom sheet for moving between suggestions; today only the active card shows under its paragraph.
