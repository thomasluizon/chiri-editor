"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { kindOf, type Suggestion } from "@/lib/types";

const kindLabel = { insert: "Insert", delete: "Delete", replace: "Replace" } as const;

/** Refine state for one card (DESIGN.md "Suggestion card": Refining / Thinking). */
export type RefineUI = { phase: "input" } | { phase: "thinking" } | { phase: "message"; message: string };

type Props = {
  suggestion: Suggestion;
  active: boolean;
  hover: boolean;
  inline?: boolean;
  refine?: RefineUI;
  style?: React.CSSProperties;
  onAccept: () => void;
  onReject: () => void;
  onRefineOpen: () => void;
  onRefineSubmit: (instruction: string) => void;
  onRefineClose: () => void;
  onFocus: () => void;
  onHover: (on: boolean) => void;
};

export const SuggestionCard = forwardRef<HTMLDivElement, Props>(function SuggestionCard(props, ref) {
  const { suggestion, active, hover, inline, refine, style } = props;
  const kind = kindOf(suggestion);
  const thinking = refine?.phase === "thinking";
  const rounds = suggestion.history?.length ?? 0;
  const cls = ["sg-card", active && "is-active", hover && "is-hover", inline && "is-inline", thinking && "is-thinking"]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={ref}
      className={cls}
      style={style}
      data-sid={suggestion.id}
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest("button, input")) props.onFocus();
      }}
      onMouseEnter={() => props.onHover(true)}
      onMouseLeave={() => props.onHover(false)}
    >
      <div className="sg-card__kind">
        <span className="sg-card__dot" aria-hidden />
        {kindLabel[kind]}
        {rounds > 0 && <span className="sg-card__rounds">· refined {rounds === 1 ? "once" : `${rounds}×`}</span>}
      </div>
      <p className={thinking ? "sg-card__reason shimmer-text" : "sg-card__reason"}>{suggestion.reason}</p>

      {refine?.phase === "input" ? (
        <RefineInput onSubmit={props.onRefineSubmit} onClose={props.onRefineClose} />
      ) : (
        <>
          {refine?.phase === "message" && (
            <p className="sg-card__message" role="status">
              {refine.message}
            </p>
          )}
          <div className="sg-card__actions">
            <button type="button" className="btn btn--accept" onClick={props.onAccept} disabled={thinking}>
              Accept
              {active && !thinking && <kbd>⌥↵</kbd>}
            </button>
            <button type="button" className="btn btn--text" onClick={props.onReject} disabled={thinking}>
              Reject
              {active && !thinking && <kbd>esc</kbd>}
            </button>
            <button type="button" className="btn btn--text" onClick={props.onRefineOpen} disabled={thinking}>
              {thinking ? <span className="shimmer-text">Refining…</span> : "Refine"}
            </button>
          </div>
        </>
      )}
    </div>
  );
});

function RefineInput({ onSubmit, onClose }: { onSubmit: (s: string) => void; onClose: () => void }) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), []);

  return (
    <form
      className="sg-card__refine"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <input
        ref={input}
        className="sg-card__refine-input"
        value={value}
        placeholder="How should it change?"
        aria-label="How should this suggestion change?"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <button type="submit" className="btn btn--accept btn--small" disabled={!value.trim()}>
        Send
      </button>
    </form>
  );
}
