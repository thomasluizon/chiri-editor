"use client";

import { ChangeSet } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isAbort, postSuggest } from "@/lib/client/api";
import { paragraphAt } from "@/lib/editor/paragraph";
import { placeSuggestions } from "@/lib/editor/place";
import {
  acceptAll,
  acceptSuggestion,
  addThinking,
  cardSlot,
  focusSuggestion,
  getSuggestions,
  rejectAll,
  rejectSuggestion,
  removeThinking,
  setActive,
  setAskTarget,
  setHover,
  setInlineCards,
  type SuggestionState,
} from "@/lib/editor/suggestions";
import { SAMPLE_DOC } from "@/lib/sampleDoc";
import type { Range, Suggestion, SuggestRequest, SuggestResponse } from "@/lib/types";
import { AskPopover, type AskPhase } from "./AskPopover";
import { Editor } from "./Editor";
import { MarginCards } from "./MarginCards";
import { SuggestionCard, type RefineUI } from "./SuggestionCard";
import { ThemeToggle } from "./ThemeToggle";

const STORAGE_KEY = "draft:doc";
const POPOVER_W = 440;

type Ask = { phase: AskPhase; scope: "paragraph" | "selection"; target: Range; message?: string; requestId?: string };
type AskPos = { left: number; top: number };
type Status = { text: string; tone: "note" | "error" } | null;
/** A request in flight: the edits made since it was sent, so its answer can be mapped (SPEC D5). */
type Pending = { changes: ChangeSet; controller: AbortController };

/* ---------- small helpers ---------- */

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

function loadDoc(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? SAMPLE_DOC;
  } catch {
    return SAMPLE_DOC;
  }
}

const countWords = (text: string) => text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
const titleOf = (firstLine: string) => firstLine.replace(/^#+\s*/, "").trim() || "Untitled";
const sameRecord = (a: Record<string, number>, b: Record<string, number>) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => Math.abs(a[k] - b[k]) < 0.5);
const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/** The note plus how many suggestions couldn't be placed (server drops + stale on arrival). */
function resultText(res: SuggestResponse, stale: number): string {
  const lost = res.dropped.length + stale;
  return lost ? `${res.note} · ${lost} suggestion${lost === 1 ? "" : "s"} couldn’t be placed` : res.note;
}

/* ---------- workspace ---------- */

export function Workspace() {
  const viewRef = useRef<EditorView | null>(null);
  const docColRef = useRef<HTMLDivElement>(null);
  const marginRef = useRef<HTMLDivElement>(null);
  const pending = useRef(new Map<string, Pending>());
  const saveTimer = useRef<number | undefined>(undefined);

  const [sg, setSg] = useState<SuggestionState | null>(null);
  const [anchors, setAnchors] = useState<Record<string, number>>({});
  const [ask, setAsk] = useState<Ask | null>(null);
  const [askPos, setAskPos] = useState<AskPos | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [refine, setRefine] = useState<Record<string, RefineUI>>({});
  const [status, setStatus] = useState<Status>(null);
  const [words, setWords] = useState(() => countWords(SAMPLE_DOC));
  const [title, setTitle] = useState(() => titleOf(SAMPLE_DOC.split("\n")[0]));
  const [scrolled, setScrolled] = useState(false);
  const narrow = useMediaQuery("(max-width: 760px)");

  /* ----- layout: card anchors + popover position, read in CodeMirror's measure phase ----- */

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
        const target = st.askTarget ?? st.thinking.find((t) => t.id === askRequestRef.current)?.range;
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
        setAskPos((prev) => (prev && pos && prev.left === pos.left && prev.top === pos.top ? prev : (pos ?? prev)));
      },
    });
  }, []);
  const askRequestRef = useRef<string | undefined>(undefined);
  askRequestRef.current = ask?.requestId;

  const onUpdate = useCallback(
    (u: ViewUpdate) => {
      if (u.docChanged) {
        // every request in flight needs to know what changed since it was sent
        for (const p of pending.current.values()) p.changes = p.changes.compose(u.changes);
        const doc = u.state.doc.toString();
        setWords(countWords(doc));
        setTitle(titleOf(u.state.doc.line(1).text));
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          try {
            localStorage.setItem(STORAGE_KEY, doc);
          } catch {
            // private mode or full storage: keep editing, just don't persist
          }
        }, 400);
      }
      setSg(getSuggestions(u.state));
      scheduleMeasure(u.view);
    },
    [scheduleMeasure],
  );

  /* ----- requests ----- */

  /** Send a request built from the current doc; track edits made while it runs. */
  function startRequest(build: (doc: string) => SuggestRequest, thinking: Range | null) {
    const view = viewRef.current!;
    const id = crypto.randomUUID();
    const entry: Pending = { changes: ChangeSet.empty(view.state.doc.length), controller: new AbortController() };
    const body = build(view.state.doc.toString());
    pending.current.set(id, entry);
    if (thinking) view.dispatch({ effects: addThinking.of({ id, range: thinking }) });
    const done = postSuggest(body, entry.controller.signal).finally(() => {
      pending.current.delete(id);
      viewRef.current?.dispatch({ effects: removeThinking.of(id) });
    });
    return { id, done, changes: () => entry.changes };
  }

  const cancelRequest = (id: string | undefined) => id && pending.current.get(id)?.controller.abort();

  async function reviewDoc() {
    const view = viewRef.current;
    if (!view || reviewId) return;
    const req = startRequest((doc) => ({ mode: "suggest", doc }), { from: 0, to: view.state.doc.length });
    setReviewId(req.id);
    setStatus(null);
    try {
      const res = await req.done;
      const placed = placeSuggestions(view, req.changes(), res);
      setStatus({ text: resultText(res, placed.stale), tone: "note" });
    } catch (e) {
      if (!isAbort(e)) setStatus({ text: errorText(e), tone: "error" });
    } finally {
      setReviewId(null);
    }
  }

  /* ----- ⌘K ----- */

  const openAsk = useCallback(() => {
    const view = viewRef.current;
    if (!view) return false;
    const sel = view.state.selection.main;
    const scope = sel.empty ? "paragraph" : "selection";
    const target = sel.empty ? paragraphAt(view.state, sel.head) : { from: sel.from, to: sel.to };
    if (target.from === target.to) return false; // a blank line: nothing to edit
    view.dispatch({
      effects: [setAskTarget.of(target), EditorView.scrollIntoView(target.from, { y: "nearest", yMargin: 160 })],
    });
    setAsk({ phase: "input", scope, target });
    return true;
  }, []);

  const closeAsk = useCallback(() => {
    cancelRequest(askRequestRef.current);
    viewRef.current?.dispatch({ effects: setAskTarget.of(null) });
    setAsk(null);
    viewRef.current?.focus();
  }, []);

  async function submitAsk(instruction: string) {
    const view = viewRef.current;
    if (!view || !ask) return;
    // the target follows edits made while the popover was open
    const target = getSuggestions(view.state).askTarget ?? ask.target;
    view.dispatch({ effects: setAskTarget.of(null) });
    const req = startRequest((doc) => ({ mode: "suggest", doc, instruction, scope: target }), target);
    setAsk({ ...ask, target, phase: "thinking", requestId: req.id });
    try {
      const res = await req.done;
      const placed = placeSuggestions(view, req.changes(), res);
      if (placed.added.length) {
        setAsk(null);
        setStatus({ text: resultText(res, placed.stale), tone: "note" });
      } else {
        setAsk((a) => a && { ...a, phase: "done", message: resultText(res, placed.stale), requestId: undefined });
      }
    } catch (e) {
      if (isAbort(e)) return;
      setAsk((a) => a && { ...a, phase: "error", message: errorText(e), requestId: undefined });
    }
  }

  // Click outside closes the popover unless a request is running.
  useEffect(() => {
    if (!ask || ask.phase === "thinking") return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".ask")) closeAsk();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ask, closeAsk]);

  /* ----- refine ----- */

  const setRefineFor = (id: string, ui: RefineUI | null) =>
    setRefine((r) => {
      const next = { ...r };
      if (ui) next[id] = ui;
      else delete next[id];
      return next;
    });

  async function submitRefine(id: string, instruction: string) {
    const view = viewRef.current;
    const s = view && getSuggestions(view.state).items.find((x) => x.id === id);
    if (!view || !s) return;
    const wasActive = getSuggestions(view.state).active === id;
    const req = startRequest(
      (doc) => ({
        mode: "refine",
        doc,
        instruction,
        target: { from: s.from, to: s.to, quote: s.quote, replacement: s.replacement, history: (s.history ?? []).slice(-4) },
      }),
      null,
    );
    setRefineFor(id, { phase: "thinking" });
    try {
      const res = await req.done;
      const placed = placeSuggestions(view, req.changes(), res, { id, instruction });
      setRefineFor(id, null);
      if (placed.added.length) {
        if (wasActive) view.dispatch({ effects: setActive.of(placed.added[0].id) });
      } else if (!placed.targetGone) {
        const message = res.dropped.some((d) => d.why === "noop")
          ? "No better version. Kept it as it was."
          : "The text changed while refining. Kept the original.";
        setRefineFor(id, { phase: "message", message });
      }
    } catch (e) {
      setRefineFor(id, isAbort(e) ? null : { phase: "message", message: errorText(e) });
    }
  }

  /* ----- setup ----- */

  const onReady = useCallback(
    (view: EditorView) => {
      viewRef.current = view;
      setWords(countWords(view.state.doc.toString()));
      setTitle(titleOf(view.state.doc.line(1).text));
      setSg(getSuggestions(view.state));
      scheduleMeasure(view);
      document.fonts?.ready.then(() => scheduleMeasure(view));
    },
    [scheduleMeasure],
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
    const ro = new ResizeObserver(() => viewRef.current?.requestMeasure());
    ro.observe(cardSlot(activeId));
    return () => ro.disconnect();
  }, [narrow, activeId]);

  // Once every suggestion has been accepted or rejected, the review's note is stale.
  const itemCount = sg?.items.length ?? 0;
  const hadItems = useRef(false);
  useEffect(() => {
    if (itemCount > 0) hadItems.current = true;
    else if (hadItems.current) {
      hadItems.current = false;
      setStatus((s) => (s?.tone === "note" ? null : s));
    }
  }, [itemCount]);

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

  const card = (s: Suggestion, extra: { inline?: boolean; style?: React.CSSProperties; ref?: (el: HTMLDivElement | null) => void }) => (
    <SuggestionCard
      key={s.id}
      ref={extra.ref}
      inline={extra.inline}
      style={extra.style}
      suggestion={s}
      active={s.id === activeId}
      hover={s.id === sg?.hover}
      refine={refine[s.id]}
      onAccept={withView((v) => acceptSuggestion(v, s.id))}
      onReject={withView((v) => rejectSuggestion(v, s.id))}
      onRefineOpen={() => {
        setRefineFor(s.id, { phase: "input" });
        viewRef.current?.dispatch({ effects: setActive.of(s.id) });
      }}
      onRefineSubmit={(text) => submitRefine(s.id, text)}
      onRefineClose={() => setRefineFor(s.id, null)}
      onFocus={withView((v) => v.dispatch({ effects: setActive.of(s.id) }))}
      onHover={(on) => viewRef.current?.dispatch({ effects: setHover.of(on ? s.id : null) })}
    />
  );

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

        <div className={status?.tone === "error" ? "topbar__status is-error" : "topbar__status"} role="status" aria-live="polite">
          {reviewId ? <span className="shimmer-text">Reading the document…</span> : status?.text}
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
          {reviewId && (
            <button type="button" className="btn btn--text" onClick={() => cancelRequest(reviewId)}>
              Cancel
            </button>
          )}
          <button type="button" className="btn btn--secondary" onClick={reviewDoc} disabled={!!reviewId}>
            {reviewId ? <span className="shimmer-text">Reviewing…</span> : "Review doc"}
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="stage">
        <div className="doc-col" ref={docColRef}>
          <Editor getInitialDoc={loadDoc} onReady={onReady} onUpdate={onUpdate} onAsk={openAsk} />
          {ask && askPos && (
            <AskPopover
              phase={ask.phase}
              scope={ask.scope}
              message={ask.message}
              style={{ left: askPos.left, top: askPos.top }}
              onSubmit={submitAsk}
              onCancel={closeAsk}
            />
          )}
        </div>
        <div className="margin-col" ref={marginRef}>
          {!narrow && (
            <MarginCards
              items={items}
              anchors={anchors}
              active={activeId}
              renderCard={(s, style, ref) => card(s, { style, ref })}
            />
          )}
        </div>
      </main>

      {narrow && activeSuggestion && createPortal(card(activeSuggestion, { inline: true }), cardSlot(activeSuggestion.id))}

      {narrow && items.length > 0 && (
        <nav className="review-bar" aria-label="Suggestions">
          <button type="button" className="icon-btn" aria-label="Previous suggestion" onClick={() => step(-1)}>
            <ChevronLeft size={16} strokeWidth={1.75} />
          </button>
          <span className="review-bar__count">{activeIndex >= 0 ? `${activeIndex + 1} of ${items.length}` : count}</span>
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
