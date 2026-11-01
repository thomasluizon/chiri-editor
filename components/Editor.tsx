"use client";

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap, type ViewUpdate } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { suggestionKeymap } from "@/lib/editor/keymap";
import { historyExtension, type HistoryEntry } from "@/lib/editor/history";
import { livePreview } from "@/lib/editor/livePreview";
import { markdownLines } from "@/lib/editor/markdownLines";
import { suggestionsExtension } from "@/lib/editor/suggestions";
import { editorStyling } from "@/lib/editor/theme";

type Props = {
  /** Read once, on mount (client only, so it can come from localStorage). */
  getInitialDoc: () => string;
  /** Saved AI history for that doc (SPEC §10). */
  getInitialHistory: (docLength: number) => HistoryEntry[];
  onReady: (view: EditorView) => void;
  onUpdate: (update: ViewUpdate) => void;
  onAsk: () => boolean;
};

/** Mounts CodeMirror once. All later interaction goes through the view. */
export function Editor({ getInitialDoc, getInitialHistory, onReady, onUpdate, onAsk }: Props) {
  const host = useRef<HTMLDivElement>(null);
  // keep callbacks fresh without rebuilding the editor
  const cb = useRef({ onUpdate, onAsk });
  cb.current = { onUpdate, onAsk };

  useEffect(() => {
    const doc = getInitialDoc();
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc,
        extensions: [
          historyExtension(getInitialHistory(doc.length)),
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          // keep the cursor clear of the sticky top bar and the mobile review bar when scrolling to it
          EditorView.scrollMargins.of(() => ({ top: 72, bottom: 72 })),
          markdown({ base: markdownLanguage }), // GFM: strikethrough, tables, task lists
          markdownLines,
          livePreview,
          editorStyling,
          suggestionsExtension,
          suggestionKeymap(() => cb.current.onAsk()),
          // Tab indents (lists especially); Esc then Tab still leaves the editor for keyboard users
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.contentAttributes.of({ "aria-label": "Document", spellcheck: "true" }),
          EditorView.updateListener.of((u) => cb.current.onUpdate(u)),
        ],
      }),
    });
    // e2e tests read the raw Markdown through this (live preview hides marks in the DOM)
    if (process.env.NODE_ENV !== "production") (window as unknown as { __view?: EditorView }).__view = view;
    onReady(view);
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="doc-editor" />;
}
