"use client";

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { suggestionKeymap } from "@/lib/editor/keymap";
import { livePreview } from "@/lib/editor/livePreview";
import { markdownLines } from "@/lib/editor/markdownLines";
import { suggestionsExtension } from "@/lib/editor/suggestions";
import { editorStyling } from "@/lib/editor/theme";

type Props = {
  initialDoc: string;
  onReady: (view: EditorView) => void;
  onUpdate: (view: EditorView) => void;
  onAsk: () => boolean;
};

/** Mounts CodeMirror once. All later interaction goes through the view. */
export function Editor({ initialDoc, onReady, onUpdate, onAsk }: Props) {
  const host = useRef<HTMLDivElement>(null);
  // keep callbacks fresh without rebuilding the editor
  const cb = useRef({ onUpdate, onAsk });
  cb.current = { onUpdate, onAsk };

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage }), // GFM: strikethrough, tables, task lists
          markdownLines,
          livePreview,
          editorStyling,
          suggestionsExtension,
          suggestionKeymap(() => cb.current.onAsk()),
          // Tab indents (lists especially); Esc then Tab still leaves the editor for keyboard users
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.contentAttributes.of({ "aria-label": "Document", spellcheck: "true" }),
          EditorView.updateListener.of((u) => cb.current.onUpdate(u.view)),
        ],
      }),
    });
    onReady(view);
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="doc-editor" />;
}
