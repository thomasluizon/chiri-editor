import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { PRESET_LABELS } from "@/lib/prompts";
import type { Range } from "@/lib/types";

/**
 * Slash menu (SPEC §11, D16). Typing "/" at the start of a line or after
 * whitespace opens it; the text typed after the "/" filters it. The items
 * are the ⌘K presets from lib/prompts.ts (not a copy), Review doc, and a
 * free-text Ask AI.
 */

export type SlashItem =
  | { kind: "preset"; label: string; instruction: string }
  | { kind: "review"; label: string }
  | { kind: "ask"; label: string } // nothing typed: open the ⌘K box
  | { kind: "free"; label: string; instruction: string };

export function slashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  const base: SlashItem[] = [
    ...PRESET_LABELS.map((label): SlashItem => ({ kind: "preset", label, instruction: label })),
    { kind: "review", label: "Review doc" },
  ];
  if (!q) return [...base, { kind: "ask", label: "Ask AI…" }];
  return [
    ...base.filter((i) => i.label.toLowerCase().includes(q)),
    { kind: "free", label: `Ask AI: "${query.trim()}"`, instruction: query.trim() },
  ];
}

/* ---------- when it may open ---------- */

const BLOCKED = new Set([
  "InlineCode",
  "CodeText",
  "CodeMark",
  "CodeInfo",
  "FencedCode",
  "CodeBlock",
  "URL",
  "Autolink",
  "HTMLBlock",
  "HTMLTag",
  "CommentBlock",
]);

/** A "/" typed at `at` (in `state`, before it was typed) may open the menu. */
export function slashAllowed(state: EditorState, at: number): boolean {
  const line = state.doc.lineAt(at);
  if (at > line.from && !/\s/.test(state.doc.sliceString(at - 1, at))) return false; // and/or, 1/2, https://x/
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, at + 1), 50) ?? syntaxTree(state);
  for (const side of [-1, 1] as const) {
    for (let n: { name: string; parent: unknown } | null = tree.resolveInner(at, side); n; n = n.parent as typeof n) {
      if (BLOCKED.has(n.name)) return false;
    }
  }
  return true;
}

/* ---------- state ---------- */

export type SlashState = { from: number; query: string; index: number } | null;

const openSlash = StateEffect.define<number>();
export const closeSlash = StateEffect.define<null>();
const moveSlash = StateEffect.define<number>();

const MAX_QUERY = 80;

export const slashField = StateField.define<SlashState>({
  create: () => null,
  update(value, tr) {
    let next = value;
    let opened = false;
    for (const e of tr.effects) {
      if (e.is(openSlash)) {
        next = { from: e.value, query: "", index: 0 };
        opened = true;
      } else if (e.is(closeSlash)) next = null;
      else if (e.is(moveSlash) && next) {
        const n = slashItems(next.query).length;
        next = { ...next, index: (((next.index + e.value) % n) + n) % n };
      }
    }
    if (!next || !(tr.docChanged || tr.selection)) return next;

    // follow the "/" through edits; close if it's gone or the cursor left "/query"
    const from = opened || !tr.docChanged ? next.from : tr.changes.mapPos(next.from, 1);
    if (tr.newDoc.sliceString(from, from + 1) !== "/") return null;
    const sel = tr.newSelection.main;
    if (!sel.empty || sel.head < from + 1) return null;
    const query = tr.newDoc.sliceString(from + 1, sel.head);
    if (query.includes("\n") || query.length > MAX_QUERY) return null;
    return { from, query, index: query === next.query ? next.index : 0 };
  },
});

/** Opens the menu when a single "/" is typed where it's allowed. */
const opener = EditorState.transactionExtender.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent("input.type")) return null;
  let at = -1;
  let changes = 0;
  tr.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
    changes++;
    if (fromA === toA && inserted.toString() === "/") at = fromB;
  });
  if (changes !== 1 || at < 0 || !slashAllowed(tr.startState, at)) return null;
  return { effects: openSlash.of(at) };
});

/** The field plus the opener: enough to test it on an EditorState. */
export const slashState = [slashField, opener];

/* ---------- view: keys + highlight ---------- */

/** The "/query" text the menu will remove when an item is picked. */
export const slashRange = (s: NonNullable<SlashState>): Range => ({ from: s.from, to: s.from + 1 + s.query.length });

const queryMark = Decoration.mark({ class: "cm-slash-query" });
const slashDecorations = EditorView.decorations.compute([slashField], (state) => {
  const s = state.field(slashField);
  if (!s) return Decoration.none;
  const r = slashRange(s);
  return Decoration.set([queryMark.range(r.from, r.to)]);
});

export type SlashPick = (view: EditorView, item: SlashItem, range: Range) => void;

/** Pick the highlighted (or given) item: the caller removes "/query" and acts. */
export function pickSlash(view: EditorView, onPick: SlashPick, index?: number): boolean {
  const s = view.state.field(slashField, false);
  if (!s) return false;
  const items = slashItems(s.query);
  const item = items[index ?? s.index];
  if (!item) return false;
  onPick(view, item, slashRange(s));
  return true;
}

export function slashExtension(onPick: () => SlashPick) {
  const open = (view: EditorView) => !!view.state.field(slashField, false);
  return [
    slashState,
    slashDecorations,
    Prec.highest(
      keymap.of([
        { key: "ArrowDown", run: (v) => open(v) && (v.dispatch({ effects: moveSlash.of(1) }), true) },
        { key: "ArrowUp", run: (v) => open(v) && (v.dispatch({ effects: moveSlash.of(-1) }), true) },
        { key: "Enter", run: (v) => open(v) && pickSlash(v, onPick()) },
        // Esc closes the menu and leaves "/query" as plain text
        { key: "Escape", run: (v) => open(v) && (v.dispatch({ effects: closeSlash.of(null) }), true) },
      ]),
    ),
  ];
}
