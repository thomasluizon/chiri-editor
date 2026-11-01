# DESIGN

How the editor looks and behaves. Tokens here are mirrored 1:1 as CSS custom properties in `app/tokens.css`; if you change one, change both.

## Principles

1. **The document is the product.** The writing surface looks like a page, not an app. Chrome is small, low-contrast and stays out of the reading column.
2. **The AI is a second author with its own ink.** Everything the AI proposes is in the accent colour. Nothing else on screen uses it at full strength, so "green = the AI's words" holds everywhere.
3. **Changes read like Google Docs suggesting mode.** Deleted text stays in place, struck through. New text sits right after it, underlined. The difference is never carried by colour alone.
4. **Quiet until needed.** No spinners, no toasts, no badges. Waiting is a shimmer on the text being worked on; finished work is the suggestion itself.

References: iA Writer (writing surface), Linear (chrome), Google Docs suggesting mode (changes), Notion AI (the ask popover).
Not doing: default shadcn styling, gradients, glass/blur, emoji, drop-shadow-heavy cards.

## Tokens

### Type

| Token | Value | Use |
|---|---|---|
| `--font-doc` | Source Serif 4 (variable, optical sizing), Georgia fallback | Document text |
| `--font-ui` | Inter (variable), system-ui fallback | All chrome: bars, cards, popover |
| `--font-mono` | IBM Plex Mono | Inline code and fences in the doc |

Why Source Serif 4: it's a true proportional text face built for long reading, and its optical sizes keep the headings crisp. iA Writer Quattro (iA's own font, OFL) was considered, but it's semi-monospaced, and we want a fully proportional face for a document feel. Inter for the chrome keeps the UI neutral and clearly separate from the document.

**Document scale** (desktop / ≤ 760px):

| Role | Size | Line height | Weight | Notes |
|---|---|---|---|---|
| Body | 19px / 17px | 1.7 | 400 | Measure `34em` ≈ 70 characters |
| H1 | 36px / 30px | 1.2 | 650 | 1.4em space above |
| H2 | 27px / 23px | 1.3 | 620 | 1.2em space above |
| H3 | 22px / 19px | 1.4 | 600 | |
| Code (inline) | 0.86em | inherit | 400 | `--sunk` background, 3px radius |
| Markdown marks (`#`, `**`, `_`, `` ` ``, `>`, `-`, `[]()`) | inherit | | 400 | Hidden by live preview (see below); `--ink-3` when shown |

**UI scale:** 12px (labels, meta), 13px (default chrome), 14px (popover input, card reason). Letter-spacing −0.005em at 13–14px; labels are sentence case, never all caps.

### Colour

One accent (jade, "the AI's ink") plus one semantic colour for deletions. Everything else is warm neutrals.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#FBF9F4` | `#171614` | Page background |
| `--raised` | `#FFFFFE` | `#201F1C` | Cards, popover, bars |
| `--sunk` | `#F2EFE7` | `#262420` | Chips, inline code, hover fills |
| `--ink` | `#1C1B19` | `#ECE8E1` | Body text |
| `--ink-2` | `#5F5A51` | `#A9A398` | Secondary text, card reasons |
| `--ink-3` | `#948E83` | `#736D63` | Markdown marks, meta, placeholders |
| `--line` | `#E8E3D9` | `#2F2D29` | Hairlines, card borders |
| `--line-strong` | `#D5CFC3` | `#423F39` | Active borders, input borders |
| `--accent` | `#1F6E58` | `#6CC4A4` | AI ink: insertions, Accept, focus ring, shimmer |
| `--accent-hover` | `#185B48` | `#88D3B7` | Accept hover |
| `--on-accent` | `#FFFFFF` | `#0D1F18` | Text on accent fills |
| `--ins-ink` | `#145A45` | `#A2E2C9` | Inserted text |
| `--ins-bg` | `rgba(31,110,88,.11)` | `rgba(108,196,164,.15)` | Inserted text background |
| `--del-ink` | `#9C3A2C` | `#EFA294` | Deleted text |
| `--del-bg` | `rgba(196,64,46,.08)` | `rgba(239,128,108,.12)` | Deleted text background |
| `--del-line` | `#C4402E` | `#E8806F` | Strike line |
| `--selection` | `rgba(28,27,25,.09)` | `rgba(236,232,225,.12)` | Text selection, ⌘K target, thinking base tint. Neutral on purpose: green is reserved for the AI's words |

Contrast: `--ink` on `--paper` ≥ 15:1 in both themes. `--ink-2` ≥ 6:1. `--ins-ink`/`--del-ink` on their backgrounds ≥ 6:1. `--ink-3` (~3:1) is only used for decorative marks and meta, never for anything you need to read to act.

### Spacing

4px base: `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 24, `--s-6` 32, `--s-7` 48, `--s-8` 64, `--s-9` 96.

Layout:
- Top bar 48px tall, `--s-4` side padding.
- Desktop: the doc column (`34em`) and the margin column (`300px`) are centred together, `--s-7` gap between them. Doc top padding `--s-8`, bottom padding 40vh, so the last line can be scrolled up to eye level.
- ≤ 1080px: the margin narrows to 260px. ≤ 760px: the margin column goes away, cards drop under their paragraph, side gutters are `--s-4`, and a review bar sticks to the bottom.

### Radius

`--r-1` 3px (inline code, insert/delete highlight), `--r-2` 6px (buttons, chips, inputs), `--r-3` 8px (cards), `--r-4` 10px (popover).

### Elevation

Borders do the work; shadows are a hint.
- `--shadow-card-active`: light `0 1px 2px rgb(28 27 25 / .05), 0 4px 14px rgb(28 27 25 / .06)`, dark `0 1px 2px rgb(0 0 0 / .4), 0 6px 18px rgb(0 0 0 / .35)`.
- `--shadow-pop`: light `0 2px 4px rgb(28 27 25 / .05), 0 10px 30px rgb(28 27 25 / .10)`, dark `0 2px 4px rgb(0 0 0 / .45), 0 12px 32px rgb(0 0 0 / .45)`.
- Inactive cards have no shadow.

### Motion

| Token | Value | Use |
|---|---|---|
| `--t-fast` | 120ms `cubic-bezier(.2,0,0,1)` | Hover, press, colour changes |
| `--t-move` | 200ms `cubic-bezier(.2,.8,.2,1)` | Cards sliding to new positions |
| `--t-enter` | 140ms ease-out, opacity 0→1 and translateY 4px→0 | Popover and card appearance |
| `--shimmer` | 1.8s linear, infinite | Thinking state |

`prefers-reduced-motion: reduce` turns the shimmer into a static `--ins-bg` tint, and removes the enter/move transforms. Fades stay.

## Components and states

### Top bar
Left: the document name (13px `--ink-2`; `--ink` on hover, since it's editable later). Right: the review controls (only shown when there are suggestions), a **Review doc** button, and the theme toggle.
- **Review doc**: a secondary button (`--raised` fill, `--line-strong` border, `--ink`). It's the one labelled button in the bar. States: rest / hover (`--sunk` fill) / pressed (translateY 0.5px) / busy (label becomes "Reviewing…" with the shimmer on the label, disabled) / disabled.
- **Review controls**: "3 suggestions", ‹ › arrows, *Accept all*, *Reject all*. All are 13px text buttons in `--ink-2`, hover `--ink` on a `--sunk` fill.
- **Theme toggle**: a 28px icon button cycling system → light → dark. Its tooltip names the current mode.
- The bar has no bottom border until the page scrolls; then it gets a `--line` hairline.

### Document surface
- `--paper` background over the whole page. No visible editor box, no gutter, no line numbers, no active-line highlight.
- Caret: 2px `--accent`. Selection: `--selection` (neutral, see Colour).
- **Live preview** (like Obsidian): the doc is always raw Markdown, but marks are only drawn on the lines being edited (`lib/editor/livePreview.ts`).
  - Hidden everywhere else: `#` and its space, `**`/`_`/`~~`, inline-code backticks, `> ` (the quote keeps its left rule), and `[`, `](url)` on inline links.
  - Bullet `- ` becomes a drawn `•` in `--ink-3`, 1.1em wide, matching the hanging indent so wrapped lines align with the text. Ordered-list numbers stay as typed.
  - Revealed: every line a selection touches, but only while the editor has focus, so an unfocused document reads clean. Also any line where a suggestion touches a mark, so the diff shows exactly what changes, syntax included.
  - Not hidden: fenced code fences, reference-style links, HTML, setext underlines.
- Headings get their size from **line decorations**, so a revealed `#` scales with the heading but stays `--ink-3`.
- Links: `--ink` text with an `--ink-3` underline at a 3px offset. That's enough to read as a link once the URL is hidden.
- Block quotes: a 2px `--line-strong` rule on the left, text in `--ink-2`.
- Footer meta (fixed bottom-left on desktop, hidden on mobile): word count · "Saved", 12px `--ink-3`.

### Suggestion (inline)
How a suggestion appears in the text:
- **Delete**: `--del-ink` text on `--del-bg`, `line-through` with a 1.5px `--del-line` stroke.
- **Insert**: `--ins-ink` text on `--ins-bg`, with a 1.5px `--accent` underline at a 3px offset. Leading and trailing spaces in the inserted text are not highlighted, so a wrapped insert never leaves a stray green sliver at the end of a line.
- **Replace**: delete immediately followed by insert, with no space between them.
- Insert and delete each have their own text decoration, so the difference reads without colour (strike vs underline).

States:
- **Rest**: as above.
- **Hover / linked**: hovering the text or its card deepens both backgrounds (`--ins-bg-strong` / `--del-bg-strong`) and gives the card a `--line-strong` border.
- **Active**: the cursor is inside the suggestion, or its card was clicked. Same deeper backgrounds, and the insert underline goes to 2px. There's no outline box: in review it read as an error state.
- **Stale**: removed immediately. There's no "stale" visual; the status area reports dropped suggestions.

### Suggestion card (margin)
- 300px wide, `--raised` fill, 1px `--line` border, `--r-3` radius, `--s-3` padding.
- Header row (12px `--ink-3`): a kind label, e.g. "Replace" / "Delete" / "Insert", with a 6px accent dot.
- Reason: 14px/1.45 `--ink-2`, max 3 lines when inactive.
- Actions row: **Accept** (solid `--accent`, `--on-accent` text, 28px tall), **Reject** (text button), **Refine** (text button). On the active card, each shows its key hint (⌥↵, esc).
- Positioned with its top aligned to the first line of its suggestion. Cards never overlap: the active card sits exactly on its line, and the other cards stack above and below it with an 8px gap.

States:
- **Rest**: no shadow, actions at `--ink-2`.
- **Hover**: border `--line-strong`.
- **Active**: border `--line-strong`, `--shadow-card-active`, shifted 8px left towards the text, and reason shown in full.
- **Refining**: the actions row is replaced by a one-line input ("How should it change?") and a Send button. Esc goes back.
- **Thinking (refine running)**: the reason text shimmers and the actions are disabled.
- **Enter**: `--t-enter`; cards slide to their positions with `--t-move`.

### Suggestion card (≤ 760px)
- Only the **active** suggestion's card is shown, full column width, directly under the paragraph that contains it. It's a block in the document flow, so the text below moves down rather than being covered.
- Tapping any suggestion makes it active.
- The bottom review bar (48px, `--raised`, top hairline) shows "2 of 3" with ‹ › arrows on the left, and *Accept all* on the right.

### Ask popover (⌘K)
- Attached to the target: its left edge is aligned with the paragraph or selection, and it sits 8px below the target's last line (or above it, if there's no room below). 440px wide on desktop, full column width on mobile.
- `--raised` fill, 1px `--line-strong` border, `--r-4` radius, `--shadow-pop`.
- Row 1: a 16px accent "A" mark (a small rounded square), then a borderless 14px input, placeholder "Ask AI to edit this paragraph…" (or "…this selection…"), with a ↵ hint on the right.
- Row 2: preset chips, 12px, `--sunk` fill, `--r-2` radius: Tighten, Fix grammar, More formal, More casual, Clarify.
- The target text gets a `--selection` background while the popover is open, so it's clear what it will act on. Opening the popover scrolls the target into view if needed.

States:
- **Open**: `--t-enter`. Focus is in the input.
- **Typing**: the ↵ hint turns `--ink-2`.
- **Thinking**: the input is replaced with "Thinking…" (shimmering text), the chips are hidden, and a Cancel text button with an `esc` hint shows on the right. The target text shimmers.
- **Error**: one line in `--del-ink` ("Couldn't reach the model. Try again.") with Retry.
- **Closed**: Esc, or a click outside.

### Thinking shimmer (on the text)
- The target keeps the neutral `--selection` tint from the ⌘K state, so it stays marked in every frame. A soft `--ins-bg-strong` band sweeps across it from left to right with `--shimmer`. The text colour doesn't change and the text stays editable.
- A whole-document review gets the sweep only, without the tint. A tint over every line reads as "everything is selected".
- The band uses `background-attachment: fixed` (viewport coordinates). CodeMirror splits a marked range into several spans, one per syntax highlight; without the fixed attachment, each span would run its own gradient and the band would break up.
- No spinners anywhere in the app.

### Focus
- Every interactive control shows a 2px `--accent` focus ring at a 2px offset when focused with the keyboard (`:focus-visible`).
