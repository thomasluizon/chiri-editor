import { EditorState, StateEffect, StateField, type Range as DecoRange } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { kindOf, type Range, type Suggestion } from "@/lib/types";
import { mapRange, mapSuggestion } from "./mapping";
import { paragraphAt } from "./paragraph";

/* ---------- state ---------- */

export type SuggestionState = {
  items: Suggestion[]; // sorted by `from`
  active: string | null;
  hover: string | null;
  /** On narrow screens the active card is rendered inside the doc, under its paragraph. */
  inlineCards: boolean;
  /** Ask popover target, highlighted while the popover is open. */
  askTarget: Range | null;
  /** Range the AI is working on; shimmers. */
  thinking: Range | null;
};

export const setSuggestions = StateEffect.define<Suggestion[]>();
export const removeSuggestion = StateEffect.define<string>();
export const setActive = StateEffect.define<string | null>();
export const setHover = StateEffect.define<string | null>();
export const setInlineCards = StateEffect.define<boolean>();
export const setAskTarget = StateEffect.define<Range | null>();
export const setThinking = StateEffect.define<Range | null>();

const byFrom = (a: Suggestion, b: Suggestion) => a.from - b.from;

export function suggestionAt(items: Suggestion[], pos: number): Suggestion | undefined {
  return items.find((s) => pos >= s.from && pos <= s.to);
}

export const suggestionField = StateField.define<SuggestionState>({
  create: () => ({ items: [], active: null, hover: null, inlineCards: false, askTarget: null, thinking: null }),

  update(value, tr) {
    let next = value;

    if (tr.docChanged) {
      const items = value.items
        .map((s) => mapSuggestion(s, tr.changes, tr.newDoc))
        .filter((s): s is Suggestion => s !== null);
      next = {
        ...next,
        items,
        askTarget: value.askTarget && mapRange(value.askTarget, tr.changes),
        thinking: value.thinking && mapRange(value.thinking, tr.changes),
      };
    }

    for (const e of tr.effects) {
      if (e.is(setSuggestions)) next = { ...next, items: [...e.value].sort(byFrom) };
      else if (e.is(removeSuggestion)) next = { ...next, items: next.items.filter((s) => s.id !== e.value) };
      else if (e.is(setActive)) next = { ...next, active: e.value };
      else if (e.is(setHover)) next = { ...next, hover: e.value };
      else if (e.is(setInlineCards)) next = { ...next, inlineCards: e.value };
      else if (e.is(setAskTarget)) next = { ...next, askTarget: e.value };
      else if (e.is(setThinking)) next = { ...next, thinking: e.value };
    }

    // The cursor decides which suggestion is active when the user moves it.
    if (tr.selection && tr.isUserEvent("select")) {
      next = { ...next, active: suggestionAt(next.items, tr.selection.main.head)?.id ?? null };
    }

    const ids = new Set(next.items.map((s) => s.id));
    if (next.active && !ids.has(next.active)) next = { ...next, active: null };
    if (next.hover && !ids.has(next.hover)) next = { ...next, hover: null };
    return next;
  },
});

/* ---------- commands ---------- */

export function getSuggestions(state: EditorState): SuggestionState {
  return state.field(suggestionField);
}

/** After accept/reject, the next suggestion (or the previous one at the end) becomes active. */
function neighbourOf(items: Suggestion[], id: string): string | null {
  const i = items.findIndex((s) => s.id === id);
  return items[i + 1]?.id ?? items[i - 1]?.id ?? null;
}

export function acceptSuggestion(view: EditorView, id: string): boolean {
  const { items } = getSuggestions(view.state);
  const s = items.find((x) => x.id === id);
  if (!s) return false;
  const end = s.from + s.replacement.length;
  view.dispatch({
    changes: { from: s.from, to: s.to, insert: s.replacement },
    effects: [removeSuggestion.of(id), setActive.of(neighbourOf(items, id))],
    selection: { anchor: end },
    userEvent: "input.accept",
  });
  return true;
}

export function rejectSuggestion(view: EditorView, id: string): boolean {
  const { items } = getSuggestions(view.state);
  if (!items.some((x) => x.id === id)) return false;
  view.dispatch({ effects: [removeSuggestion.of(id), setActive.of(neighbourOf(items, id))] });
  return true;
}

export function acceptAll(view: EditorView) {
  const { items } = getSuggestions(view.state);
  if (!items.length) return;
  view.dispatch({
    changes: items.map((s) => ({ from: s.from, to: s.to, insert: s.replacement })),
    effects: setSuggestions.of([]),
    userEvent: "input.accept",
  });
}

export function rejectAll(view: EditorView) {
  view.dispatch({ effects: setSuggestions.of([]) });
}

/** Make a suggestion active and scroll it into view. */
export function focusSuggestion(view: EditorView, id: string) {
  const s = getSuggestions(view.state).items.find((x) => x.id === id);
  if (!s) return;
  view.dispatch({
    effects: [setActive.of(id), EditorView.scrollIntoView(s.from, { y: "center" })],
  });
}

/** The suggestion under the cursor, if any (for keyboard accept/reject). */
export function suggestionUnderCursor(state: EditorState): Suggestion | undefined {
  return suggestionAt(getSuggestions(state).items, state.selection.main.head);
}

/* ---------- decorations ---------- */

class InsertWidget extends WidgetType {
  constructor(
    readonly id: string,
    readonly text: string,
    readonly cls: string,
  ) {
    super();
  }
  eq(other: InsertWidget) {
    return other.id === this.id && other.text === this.text && other.cls === this.cls;
  }
  toDOM() {
    // Leading/trailing spaces stay unstyled, so a wrapped insert never leaves
    // a stray highlighted space at the end of the previous line.
    const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(this.text)!;
    const wrap = document.createElement("span");
    wrap.className = "cm-sg-ins-wrap";
    wrap.dataset.sid = this.id;
    const mark = document.createElement("span");
    mark.className = this.cls;
    mark.textContent = core;
    wrap.append(lead, mark, trail);
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

/**
 * Mount points for inline (mobile) cards. React portals the card into the
 * element; CodeMirror places it as a block under the paragraph.
 */
const slots = new Map<string, HTMLElement>();
export function cardSlot(id: string): HTMLElement {
  let el = slots.get(id);
  if (!el) {
    el = document.createElement("div");
    el.className = "cm-card-slot";
    slots.set(id, el);
  }
  return el;
}

class CardSlotWidget extends WidgetType {
  constructor(readonly id: string) {
    super();
  }
  eq(other: CardSlotWidget) {
    return other.id === this.id;
  }
  toDOM() {
    return cardSlot(this.id);
  }
  ignoreEvent() {
    return true; // clicks inside the card are the card's business
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const v = state.field(suggestionField);
  const ranges: DecoRange<Decoration>[] = [];

  for (const s of v.items) {
    const flags = [s.id === v.active && "is-active", s.id === v.hover && "is-hover"].filter(Boolean).join(" ");
    const kind = kindOf(s);
    if (kind !== "insert") {
      ranges.push(
        Decoration.mark({
          class: `cm-sg-del ${flags}`,
          attributes: { "data-sid": s.id },
        }).range(s.from, s.to),
      );
    }
    if (kind !== "delete") {
      ranges.push(
        Decoration.widget({ widget: new InsertWidget(s.id, s.replacement, `cm-sg-ins ${flags}`), side: 1 }).range(s.to),
      );
    }
  }

  if (v.inlineCards && v.active) {
    const s = v.items.find((x) => x.id === v.active);
    if (s) {
      const end = paragraphAt(state, s.to).to;
      ranges.push(Decoration.widget({ widget: new CardSlotWidget(s.id), block: true, side: 1 }).range(end));
    }
  }

  if (v.askTarget && v.askTarget.from < v.askTarget.to) {
    ranges.push(Decoration.mark({ class: "cm-ask-target" }).range(v.askTarget.from, v.askTarget.to));
  }
  if (v.thinking && v.thinking.from < v.thinking.to) {
    ranges.push(Decoration.mark({ class: "cm-thinking" }).range(v.thinking.from, v.thinking.to));
  }

  return Decoration.set(ranges, true);
}

const suggestionDecorations = EditorView.decorations.compute([suggestionField], buildDecorations);

/** Clicks and hover on inline suggestion text. */
const suggestionEvents = EditorView.domEventHandlers({
  mousedown(event, view) {
    const el = (event.target as HTMLElement).closest<HTMLElement>(".cm-sg-ins-wrap");
    if (!el?.dataset.sid) return false;
    const s = getSuggestions(view.state).items.find((x) => x.id === el.dataset.sid);
    if (!s) return false;
    event.preventDefault();
    view.dispatch({ selection: { anchor: s.to }, effects: setActive.of(s.id) });
    view.focus();
    return true;
  },
  mouseover(event, view) {
    const id = (event.target as HTMLElement).closest<HTMLElement>("[data-sid]")?.dataset.sid ?? null;
    if (id !== getSuggestions(view.state).hover) view.dispatch({ effects: setHover.of(id) });
    return false;
  },
  mouseleave(_event, view) {
    if (getSuggestions(view.state).hover) view.dispatch({ effects: setHover.of(null) });
    return false;
  },
});

export const suggestionsExtension = [suggestionField, suggestionDecorations, suggestionEvents];
