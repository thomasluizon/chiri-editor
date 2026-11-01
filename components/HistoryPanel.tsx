"use client";

import { useEffect, useRef, useState } from "react";
import type { HistoryEntry, RevertCheck } from "@/lib/editor/history";
import type { SuggestionSource } from "@/lib/types";

const sourceLabel: Record<SuggestionSource, string> = {
  review: "Review doc",
  ask: "⌘K",
  slash: "Slash menu",
  refine: "Refined",
};

/** "anthropic/claude-sonnet-5.5" → "Sonnet 5.5" */
export function modelName(id?: string): string {
  if (!id) return "";
  const name = id.split("/").pop()!.replace(/^claude-/, "");
  return name
    .split("-")
    .map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type Props = {
  entries: HistoryEntry[];
  onRevert: (id: string) => RevertCheck;
  onClear: () => void;
  onClose: () => void;
};

/** AI history (SPEC §10, DESIGN.md "History panel"). */
export function HistoryPanel({ entries, onRevert, onClear, onClose }: Props) {
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const now = Date.now();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest(".hist-toggle")) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const meta = (e: HistoryEntry) => [e.source && sourceLabel[e.source], modelName(e.model), ago(e.at, now)].filter(Boolean).join(" · ");

  return (
    <div className="hist" role="dialog" aria-label="AI history" ref={ref}>
      <div className="hist__head">
        <span className="hist__title">AI history</span>
        {entries.length > 0 &&
          (confirming ? (
            <span className="hist__confirm">
              Clear all?
              <button type="button" className="btn btn--text btn--small" onClick={() => (onClear(), setConfirming(false))}>
                Yes, clear
              </button>
              <button type="button" className="btn btn--text btn--small" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn--text btn--small" onClick={() => setConfirming(true)}>
              Clear
            </button>
          ))}
      </div>

      {entries.length === 0 ? (
        <p className="hist__empty">Accepted and rejected AI suggestions show up here.</p>
      ) : (
        <ul className="hist__list">
          {entries.map((e) =>
            e.status === "rejected" ? (
              <li key={e.id} className="hist-item is-rejected">
                <div className="hist-meta">
                  <span>Rejected · {meta(e)}</span>
                </div>
                <div className="hist-change">
                  {e.before && <span className="hist-before">{e.before}</span>}
                  {e.after && <span className="hist-after">{e.after}</span>}
                </div>
                <p className="hist-reason">{e.reason}</p>
              </li>
            ) : (
              <li key={e.id} className={e.status === "reverted" ? "hist-item is-reverted" : "hist-item"}>
                <div className="hist-meta">
                  <span>{meta(e)}</span>
                  {e.status === "reverted" ? (
                    <span className="hist-state">Reverted</span>
                  ) : changed.has(e.id) ? null : (
                    <button
                      type="button"
                      className="btn btn--text btn--small"
                      onClick={() => {
                        if (onRevert(e.id) === "changed") setChanged((c) => new Set(c).add(e.id));
                      }}
                    >
                      Revert
                    </button>
                  )}
                </div>
                <div className="hist-change">
                  {e.before && <span className="hist-before">{e.before}</span>}
                  {e.after && <span className="hist-after">{e.after}</span>}
                </div>
                <p className="hist-reason">{e.reason}</p>
                {changed.has(e.id) && (
                  <p className="hist-state is-changed" role="status">
                    The text changed since, so it can&rsquo;t be reverted.
                  </p>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
