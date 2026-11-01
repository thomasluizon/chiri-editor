"use client";

import { forwardRef } from "react";
import { kindOf, type Suggestion } from "@/lib/types";

const kindLabel = { insert: "Insert", delete: "Delete", replace: "Replace" } as const;

type Props = {
  suggestion: Suggestion;
  active: boolean;
  hover: boolean;
  inline?: boolean;
  style?: React.CSSProperties;
  onAccept: () => void;
  onReject: () => void;
  onRefine: () => void;
  onFocus: () => void;
  onHover: (on: boolean) => void;
};

export const SuggestionCard = forwardRef<HTMLDivElement, Props>(function SuggestionCard(
  { suggestion, active, hover, inline, style, onAccept, onReject, onRefine, onFocus, onHover },
  ref,
) {
  const kind = kindOf(suggestion);
  const cls = ["sg-card", active && "is-active", hover && "is-hover", inline && "is-inline"].filter(Boolean).join(" ");

  return (
    <div
      ref={ref}
      className={cls}
      style={style}
      data-sid={suggestion.id}
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest("button")) onFocus();
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="sg-card__kind">
        <span className="sg-card__dot" aria-hidden />
        {kindLabel[kind]}
      </div>
      <p className="sg-card__reason">{suggestion.reason}</p>
      <div className="sg-card__actions">
        <button type="button" className="btn btn--accept" onClick={onAccept}>
          Accept
          {active && <kbd>⌥↵</kbd>}
        </button>
        <button type="button" className="btn btn--text" onClick={onReject}>
          Reject
          {active && <kbd>esc</kbd>}
        </button>
        <button type="button" className="btn btn--text" onClick={onRefine}>
          Refine
        </button>
      </div>
    </div>
  );
});
