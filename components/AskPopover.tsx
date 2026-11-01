"use client";

import { useEffect, useRef, useState } from "react";
import { PRESET_LABELS } from "@/lib/prompts";

/** input → thinking → (closes with suggestions) | done (nothing to change) | error */
export type AskPhase = "input" | "thinking" | "done" | "error";

type Props = {
  phase: AskPhase;
  scope: "paragraph" | "selection";
  message?: string;
  style: React.CSSProperties;
  onSubmit: (instruction: string) => void;
  onCancel: () => void;
};

/** The ⌘K box. Attached under the text it acts on (DESIGN.md "Ask popover"). */
export function AskPopover({ phase, scope, message, style, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState("");
  const [last, setLast] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase === "input") input.current?.focus({ preventScroll: true });
  }, [phase]);

  const submit = (instruction: string) => {
    setLast(instruction);
    onSubmit(instruction);
  };

  return (
    <div
      className="ask"
      style={style}
      role="dialog"
      aria-label="Ask AI"
      tabIndex={-1}
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
        ) : phase === "done" ? (
          <span className="ask__done" role="status">
            {message}
          </span>
        ) : (
          <input
            ref={input}
            className="ask__input"
            value={value}
            placeholder={`Ask AI to edit this ${scope}…`}
            aria-label={`Ask AI to edit this ${scope}`}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) submit(value.trim());
            }}
          />
        )}
        {phase === "thinking" || phase === "done" ? (
          <button type="button" className="btn btn--text btn--small" onClick={onCancel}>
            {phase === "thinking" ? "Cancel" : "Close"} <kbd>esc</kbd>
          </button>
        ) : (
          <kbd className={value ? "ask__enter is-ready" : "ask__enter"}>↵</kbd>
        )}
      </div>

      {phase === "error" && (
        <div className="ask__error" role="alert">
          <span>{message ?? "Couldn’t reach the model."}</span>
          <button type="button" className="btn btn--text btn--small" onClick={() => submit(last || value)}>
            Try again
          </button>
        </div>
      )}

      {phase === "input" && (
        <div className="ask__chips">
          {PRESET_LABELS.map((p) => (
            <button key={p} type="button" className="chip" onClick={() => submit(p)}>
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
