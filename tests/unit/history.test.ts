import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  historyField,
  historyExtension,
  loadHistory,
  revertCheck,
  revertEntry,
  serializeHistory,
  type HistoryEntry,
} from "@/lib/editor/history";
import { acceptAll, acceptSuggestion, rejectAll, rejectSuggestion, setSuggestions, suggestionField } from "@/lib/editor/suggestions";
import type { Suggestion } from "@/lib/types";

const DOC = "Intro line.\n\nThe quick brown fox jumps.\n\nLast line here.";

/** Just enough of an EditorView for the commands: state + dispatch. */
function fakeView(doc = DOC, initial: HistoryEntry[] = []) {
  let state = EditorState.create({ doc, extensions: [suggestionField, historyExtension(initial)] });
  return {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
  } as unknown as EditorView & { state: EditorState };
}

function on(doc: string, quote: string, replacement: string, extra: Partial<Suggestion> = {}): Suggestion {
  const from = doc.indexOf(quote);
  return { id: `s-${quote}`, from, to: from + quote.length, quote, replacement, reason: `why ${quote}`, model: "anthropic/claude-sonnet-5.5", source: "review", ...extra };
}

const entries = (v: EditorView) => v.state.field(historyField);
const text = (v: EditorView) => v.state.doc.toString();

describe("SPEC 7.6: AI history", () => {
  it("33. accept records before/after/reason/model/source and the accepted range; accept all records each", () => {
    const v = fakeView();
    const s = on(DOC, "quick brown", "fast red");
    v.dispatch({ effects: setSuggestions.of([s]) });
    acceptSuggestion(v, s.id);

    const [e] = entries(v);
    expect(e).toMatchObject({ status: "accepted", before: "quick brown", after: "fast red", reason: "why quick brown", model: "anthropic/claude-sonnet-5.5", source: "review" });
    expect(text(v).slice(e.range!.from, e.range!.to)).toBe("fast red");

    const w = fakeView();
    const all = [on(DOC, "Intro", "Opening"), on(DOC, "quick", "slow"), on(DOC, "Last", "Final")];
    w.dispatch({ effects: setSuggestions.of(all) });
    acceptAll(w);
    expect(entries(w)).toHaveLength(3);
    for (const e of entries(w)) expect(text(w).slice(e.range!.from, e.range!.to)).toBe(e.after);
  });

  it("34. entries follow later edits, and revert puts the original back exactly", () => {
    const v = fakeView();
    const s = on(DOC, "quick brown", "fast red");
    v.dispatch({ effects: setSuggestions.of([s]) });
    acceptSuggestion(v, s.id);
    v.dispatch({ changes: { from: 0, insert: "Hello. " } }); // typing before the range
    v.dispatch({ changes: { from: text(v).length, insert: " Bye." } }); // and after it

    const [e] = entries(v);
    expect(revertCheck(v.state, e.id)).toBe("ok");
    expect(revertEntry(v, e.id)).toBe("ok");
    expect(text(v)).toBe("Hello. " + DOC + " Bye.");
    expect(entries(v)[0].status).toBe("reverted");
    expect(revertCheck(v.state, e.id)).toBe("unavailable");
  });

  it("35. an edit inside the accepted text, or deleting it, makes revert refuse and change nothing", () => {
    for (const edit of ["inside", "deleted"] as const) {
      const v = fakeView();
      const s = on(DOC, "quick brown", "fast red");
      v.dispatch({ effects: setSuggestions.of([s]) });
      acceptSuggestion(v, s.id);
      const at = text(v).indexOf("fast red");
      v.dispatch({ changes: edit === "inside" ? { from: at + 4, insert: "est" } : { from: at - 4, to: at + 12 } });

      const before = text(v);
      const id = entries(v)[0].id;
      expect(revertCheck(v.state, id)).toBe("changed");
      expect(revertEntry(v, id)).toBe("changed");
      expect(text(v)).toBe(before);
    }
  });

  it("36. reject (one or all) records rejected entries with no range", () => {
    const v = fakeView();
    const a = on(DOC, "Intro", "Opening");
    const b = on(DOC, "quick", "slow");
    const c = on(DOC, "Last", "Final");
    v.dispatch({ effects: setSuggestions.of([a, b, c]) });
    rejectSuggestion(v, a.id);
    rejectAll(v);
    const rejected = entries(v);
    expect(rejected.map((e) => e.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(rejected.every((e) => e.range === undefined)).toBe(true);
    expect(text(v)).toBe(DOC);
  });

  it("37. save and load round-trip; an entry that doesn't fit the loaded doc can't be reverted", () => {
    const v = fakeView();
    const s = on(DOC, "quick brown", "fast red");
    v.dispatch({ effects: setSuggestions.of([s]) });
    acceptSuggestion(v, s.id);
    const saved = serializeHistory(entries(v));

    const loaded = loadHistory(saved, text(v).length);
    expect(loaded).toEqual(entries(v));
    const again = fakeView(text(v), loaded);
    expect(revertEntry(again, loaded[0].id)).toBe("ok");
    expect(text(again)).toBe(DOC);

    const short = loadHistory(saved, 5); // the doc was truncated since
    const w = fakeView("Short", short);
    expect(revertCheck(w.state, short[0].id)).toBe("changed");
    expect(loadHistory("not json", 10)).toEqual([]);
  });
});
