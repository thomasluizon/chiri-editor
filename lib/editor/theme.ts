import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * CodeMirror styling. Colours, fonts and sizes come from the CSS tokens in
 * app/tokens.css so both themes work without rebuilding the editor.
 * Suggestion and line-level classes live in app/editor.css.
 */
export const editorTheme = EditorView.theme({
  "&": {
    color: "var(--ink)",
    backgroundColor: "transparent",
    fontSize: "var(--doc-size)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-doc)",
    lineHeight: "var(--doc-leading)",
    overflow: "visible",
  },
  ".cm-content": {
    padding: "0",
    caretColor: "var(--accent)",
    fontVariantLigatures: "common-ligatures",
    fontOpticalSizing: "auto",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeft: "2px solid var(--accent)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--selection)" },
});

const markdownHighlight = HighlightStyle.define([
  // #, **, _, `, >, -, [ ]( ) all quiet
  { tag: t.processingInstruction, color: "var(--ink-3)", fontWeight: "400", fontStyle: "normal" },
  { tag: t.heading, fontWeight: "650", letterSpacing: "-0.012em" },
  { tag: t.strong, fontWeight: "650" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  {
    tag: t.link,
    color: "var(--ink)",
    textDecoration: "underline",
    textDecorationColor: "var(--ink-3)",
    textUnderlineOffset: "3px",
  },
  { tag: t.url, color: "var(--ink-3)" },
  {
    tag: t.monospace,
    fontFamily: "var(--font-mono)",
    fontSize: "0.84em",
    backgroundColor: "var(--sunk)",
    borderRadius: "var(--r-1)",
    padding: "0.1em 0.2em",
  },
  { tag: t.quote, color: "var(--ink-2)" },
  { tag: t.contentSeparator, color: "var(--ink-3)" },
]);

export const editorStyling = [editorTheme, syntaxHighlighting(markdownHighlight)];
