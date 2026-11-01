"use client";

import { EditorView } from "@codemirror/view";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { paragraphAt } from "@/lib/editor/paragraph";
import {
  acceptAll,
  acceptSuggestion,
  cardSlot,
  focusSuggestion,
  getSuggestions,
  rejectAll,
  rejectSuggestion,
  setActive,
  setAskTarget,
  setHover,
  setInlineCards,
  setSuggestions,
  setThinking,
  type SuggestionState,
} from "@/lib/editor/suggestions";
import { seedDoc, seedSuggestions } from "@/lib/mock/seed";
import type { Range } from "@/lib/types";
import { AskPopover, type AskPhase } from "./AskPopover";
import { Editor } from "./Editor";
import { MarginCards } from "./MarginCards";
import { SuggestionCard } from "./SuggestionCard";
import { ThemeToggle } from "./ThemeToggle";

/** Static states for design screenshots. Goes away when the AI is wired up. */
export type DemoState = "default" | "ask" | "thinking";

type Ask = { phase: AskPhase; scope: "paragraph" | "selection"; target: Range };
type AskPos = { left: number; top: number };

const MOCK_NOTE = "The news is buried in the first paragraph. The rest needs only small cuts.";
const POPOVER_W = 440;

function useMediaQuery(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatch(mq.matches);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

const countWords = (text: string) => text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
const sameRecord = (a: Record<string, number>, b: Record<string, number>) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => Math.abs(a[k] - b[k]) < 0.5);

export function Workspace({ demo = "default" }: { demo?: DemoState }) {
  const viewRef = useRef<EditorView | null>(null);
  const docColRef = useRef<HTMLDivElement>(null);
  const marginRef = useRef<HTMLDivElement>(null);

  const [sg, setSg] = useState<SuggestionState | null>(null);
  const [anchors, setAnchors] = useState<Record<string, number>>({});
  const [ask, setAsk] = useState<Ask | null>(null);
  const [askPos, setAskPos] = useState<AskPos | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [note, setNote] = useState<string | null>(MOCK_NOTE);
  const [words, setWords] = useState(() => countWords(seedDoc));
  const [title, setTitle] = useState("Untitled");
  const [scrolled, setScrolled] = useState(false);
  const narrow = useMediaQuery("(max-width: 760px)");

  /* ----- layout: card anchors + popover position, read during CM's measure phase ----- */

  const scheduleMeasure = useCallback((view: EditorView) => {
    view.requestMeasure({
      key: "workspace-layout",
      read(view) {
        const st = getSuggestions(view.state);
        const marginTop = marginRef.current?.getBoundingClientRect().top ?? 0;
        const next: Record<string, number> = {};
        for (const s of st.items) {
          const c = view.coordsAtPos(s.from, 1);
          next[s.id] = (c ? c.top : view.lineBlockAt(s.from).top + view.documentTop) - marginTop;
        }

        let pos: AskPos | null = null;
        const target = st.askTarget ?? st.thinking;
        const col = docColRef.current?.getBoundingClientRect();
        if (target && col) {
          const start = view.coordsAtPos(target.from, 1);
          const end = view.coordsAtPos(target.to, -1);
          if (start && end) {
            const maxLeft = Math.max(0, col.width - POPOVER_W);
            pos = { left: Math.min(Math.max(0, start.left - col.left), maxLeft), top: end.bottom - col.top + 8 };
          }
        }
        return { next, pos };
      },
      write({ next, pos }) {
        setAnchors((prev) => (sameRecord(prev, next) ? prev : next));
        setAskPos((prev) => (prev && pos && prev.left === pos.left && prev.top === pos.top ? prev : pos));
      },
    });
  }, []);

  const onUpdate = useCallback(
    (view: EditorView) => {
      setSg(getSuggestions(view.state));
      setWords(countWords(view.state.doc.toString()));
      setTitle(view.state.doc.line(1).text.replace(/^#+\s*/, "").trim() || "Untitled");
      scheduleMeasure(view);
    },
    [scheduleMeasure],
  );

  /* ----- ask popover ----- */

  const openAsk = useCallback(() => {
    const view = viewRef.current;
    if (!view) return false;
    const sel = view.state.selection.main;
    const scope = sel.empty ? "paragraph" : "selection";
    const target = sel.empty ? paragraphAt(view.state, sel.head) : { from: sel.from, to: sel.to };
    view.dispatch({ effects: [setAskTarget.of(target), EditorView.scrollIntoView(target.from, { y: "nearest", yMargin: 160 })] });
    setAsk({ phase: "input", scope, target });
    return true;
  }, []);

  const closeAsk = useCallback(() => {
    viewRef.current?.dispatch({ effects: [setAskTarget.of(null), setThinking.of(null)] });
    setAsk(null);
    viewRef.current?.focus();
  }, []);

  const submitAsk = useCallback(() => {
    const view = viewRef.current;
    if (!view || !ask) return;
    view.dispatch({ effects: [setAskTarget.of(null), setThinking.of(ask.target)] });
    setAsk({ ...ask, phase: "thinking" });
    // Mock only: no model yet, so "thinking" just ends.
    window.setTimeout(closeAsk, 2400);
  }, [ask, closeAsk]);

  // Click outside closes the popover while it's waiting for input.
  useEffect(() => {
    if (ask?.phase !== "input") return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".ask")) closeAsk();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ask?.phase, closeAsk]);

  /* ----- review doc (mock: shimmer the whole doc, then re-seed) ----- */

  function reviewDoc() {
    const view = viewRef.current;
    if (!view || reviewing) return;
    setReviewing(true);
    setNote(null);
    view.dispatch({ effects: [setSuggestions.of([]), setThinking.of({ from: 0, to: view.state.doc.length })] });
    window.setTimeout(() => {
      setReviewing(false);
      setNote(MOCK_NOTE);
      let items: ReturnType<typeof seedSuggestions> = [];
      try {
        items = seedSuggestions(view.state.doc.toString());
      } catch {
        // the user edited the seeded text; nothing to show in the mock
      }
      view.dispatch({ effects: [setThinking.of(null), setSuggestions.of(items)] });
    }, 2000);
  }

  /* ----- setup ----- */

  const onReady = useCallback(
    (view: EditorView) => {
      viewRef.current = view;
      const doc = view.state.doc.toString();
      const effects = [setSuggestions.of(seedSuggestions(doc)), setActive.of("s1")];
      view.dispatch({ effects });

      if (demo === "ask") {
        const target = paragraphAt(view.state, doc.indexOf("New accounts"));
        view.dispatch({ effects: [setAskTarget.of(target), EditorView.scrollIntoView(target.from, { y: "center" })] });
        setAsk({ phase: "input", scope: "paragraph", target });
      } else if (demo === "thinking") {
        const target = paragraphAt(view.state, doc.indexOf("Thanks to everyone"));
        view.dispatch({ effects: [setThinking.of(target), EditorView.scrollIntoView(target.from, { y: "center" })] });
        setAsk({ phase: "thinking", scope: "paragraph", target });
      }
      onUpdate(view);
      document.fonts?.ready.then(() => scheduleMeasure(view));
    },
    [demo, onUpdate, scheduleMeasure],
  );

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setInlineCards.of(narrow) });
  }, [narrow]);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  // CodeMirror must re-measure when the inline card (a block widget) changes size.
  const activeId = sg?.active ?? null;
  useEffect(() => {
    if (!narrow || !activeId) return;
    const slot = cardSlot(activeId);
    const ro = new ResizeObserver(() => viewRef.current?.requestMeasure());
    ro.observe(slot);
    return () => ro.disconnect();
  }, [narrow, activeId]);

  /* ----- render ----- */

  const items = sg?.items ?? [];
  const activeIndex = items.findIndex((s) => s.id === activeId);
  const step = (dir: 1 | -1) => {
    const view = viewRef.current;
    if (!view || !items.length) return;
    const i = activeIndex < 0 ? (dir === 1 ? 0 : items.length - 1) : (activeIndex + dir + items.length) % items.length;
    focusSuggestion(view, items[i].id);
  };
  const withView = (fn: (v: EditorView) => void) => () => viewRef.current && fn(viewRef.current);
  const cardActions = {
    onAccept: (id: string) => withView((v) => acceptSuggestion(v, id))(),
    onReject: (id: string) => withView((v) => rejectSuggestion(v, id))(),
    onRefine: (_id: string) => {}, // wired with the API
    onFocus: (id: string) => withView((v) => v.dispatch({ effects: setActive.of(id) }))(),
    onHover: (id: string | null) => withView((v) => v.dispatch({ effects: setHover.of(id) }))(),
  };
  const activeSuggestion = items.find((s) => s.id === activeId);
  const count = `${items.length} suggestion${items.length === 1 ? "" : "s"}`;

  return (
    <div className="workspace">
      <header className={scrolled ? "topbar is-scrolled" : "topbar"}>
        <div className="topbar__doc">
          <span className="topbar__crumb">Drafts</span>
          <span className="topbar__sep" aria-hidden>
            /
          </span>
          <span className="topbar__title">{title}</span>
        </div>

        <div className="topbar__status" aria-live="polite">
          {reviewing ? <span className="shimmer-text">Reading the document…</span> : note}
        </div>

        <div className="topbar__actions">
          {items.length > 0 && (
            <div className="review-controls">
              <span className="review-controls__count">{count}</span>
              <button type="button" className="icon-btn" aria-label="Previous suggestion" onClick={() => step(-1)}>
                <ChevronLeft size={15} strokeWidth={1.75} />
              </button>
              <button type="button" className="icon-btn" aria-label="Next suggestion" onClick={() => step(1)}>
                <ChevronRight size={15} strokeWidth={1.75} />
              </button>
              <span className="divider" aria-hidden />
              <button type="button" className="btn btn--text" onClick={withView(acceptAll)}>
                Accept all
              </button>
              <button type="button" className="btn btn--text" onClick={withView(rejectAll)}>
                Reject all
              </button>
            </div>
          )}
          <button type="button" className="btn btn--secondary" onClick={reviewDoc} disabled={reviewing}>
            {reviewing ? <span className="shimmer-text">Reviewing…</span> : "Review doc"}
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="stage">
        <div className="doc-col" ref={docColRef}>
          <Editor initialDoc={seedDoc} onReady={onReady} onUpdate={onUpdate} onAsk={openAsk} />
          {ask && askPos && (
            <AskPopover
              phase={ask.phase}
              scope={ask.scope}
              style={{ left: askPos.left, top: askPos.top }}
              onSubmit={submitAsk}
              onCancel={closeAsk}
            />
          )}
        </div>
        <div className="margin-col" ref={marginRef}>
          {!narrow && (
            <MarginCards items={items} anchors={anchors} active={activeId} hover={sg?.hover ?? null} {...cardActions} />
          )}
        </div>
      </main>

      {narrow &&
        activeSuggestion &&
        createPortal(
          <SuggestionCard
            inline
            suggestion={activeSuggestion}
            active
            hover={false}
            onAccept={() => cardActions.onAccept(activeSuggestion.id)}
            onReject={() => cardActions.onReject(activeSuggestion.id)}
            onRefine={() => cardActions.onRefine(activeSuggestion.id)}
            onFocus={() => {}}
            onHover={() => {}}
          />,
          cardSlot(activeSuggestion.id),
        )}

      {narrow && items.length > 0 && (
        <nav className="review-bar" aria-label="Suggestions">
          <button type="button" className="icon-btn" aria-label="Previous suggestion" onClick={() => step(-1)}>
            <ChevronLeft size={16} strokeWidth={1.75} />
          </button>
          <span className="review-bar__count">
            {activeIndex >= 0 ? `${activeIndex + 1} of ${items.length}` : count}
          </span>
          <button type="button" className="icon-btn" aria-label="Next suggestion" onClick={() => step(1)}>
            <ChevronRight size={16} strokeWidth={1.75} />
          </button>
          <span className="review-bar__spacer" />
          <button type="button" className="btn btn--text" onClick={withView(rejectAll)}>
            Reject all
          </button>
          <button type="button" className="btn btn--secondary" onClick={withView(acceptAll)}>
            Accept all
          </button>
        </nav>
      )}

      <footer className="doc-meta">
        {words} words <span aria-hidden>·</span> Saved
      </footer>
    </div>
  );
}
