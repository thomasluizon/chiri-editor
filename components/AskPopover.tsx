"use client";

import { useEffect, useRef, useState } from "react";

export const PRESETS = ["Tighten", "Fix grammar", "More formal", "More casual", "Clarify"] as const;

export type AskPhase = "input" | "thinking" | "error";

type Props = {
  phase: AskPhase;
  scope: "paragraph" | "selection";
  style: React.CSSProperties;
  onSubmit: (instruction: string) => void;
  onCancel: () => void;
};

/** The ⌘K box. Attached under the text it acts on (DESIGN.md "Ask popover"). */
export function AskPopover({ phase, scope, style, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase === "input") input.current?.focus({ preventScroll: true });
  }, [phase]);

  return (
    <div
      className="ask"
      style={style}
      role="dialog"
      aria-label="Ask AI"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="ask__row">
        <span className="ask__mark" aria-hidden>
          A
        </span>
        {phase === "thinking" ? (
          <span className="ask__thinking shimmer-text">Thinking…</span>
        ) : (
          <input
            ref={input}
            className="ask__input"
            value={value}
            placeholder={`Ask AI to edit this ${scope}…`}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) onSubmit(value.trim());
            }}
          />
        )}
        {phase === "thinking" ? (
          <button type="button" className="btn btn--text btn--small" onClick={onCancel}>
            Cancel <kbd>esc</kbd>
          </button>
        ) : (
          <kbd className={value ? "ask__enter is-ready" : "ask__enter"}>↵</kbd>
        )}
      </div>

      {phase === "error" && (
        <div className="ask__error">
          Couldn&rsquo;t reach the model.
          <button type="button" className="btn btn--text btn--small" onClick={() => onSubmit(value)}>
            Try again
          </button>
        </div>
      )}

      {phase === "input" && (
        <div className="ask__chips">
          {PRESETS.map((p) => (
            <button key={p} type="button" className="chip" onClick={() => onSubmit(p)}>
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
