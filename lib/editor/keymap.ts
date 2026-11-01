import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { acceptSuggestion, rejectSuggestion, suggestionUnderCursor } from "./suggestions";

/**
 * Our keys (SPEC §4, D13). Accept/reject only fire with the cursor inside a
 * suggestion; otherwise they return false and the default binding runs.
 * Deliberately not bound: Tab, Shift-Tab, Mod-Backspace, Mod-Enter.
 */
export function suggestionKeymap(onAsk: () => boolean) {
  return Prec.highest(
    keymap.of([
      { key: "Mod-k", run: onAsk, preventDefault: true },
      {
        key: "Alt-Enter",
        run: (view) => {
          const s = suggestionUnderCursor(view.state);
          return s ? acceptSuggestion(view, s.id) : false;
        },
      },
      {
        key: "Escape",
        run: (view) => {
          const s = suggestionUnderCursor(view.state);
          return s ? rejectSuggestion(view, s.id) : false;
        },
      },
    ]),
  );
}
