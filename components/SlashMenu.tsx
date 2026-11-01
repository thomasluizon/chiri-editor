"use client";

import { FileSearch, PenLine } from "lucide-react";
import type { SlashItem } from "@/lib/editor/slash";

type Props = {
  items: SlashItem[];
  index: number;
  style: React.CSSProperties;
  onPick: (index: number) => void;
  onHighlight: (index: number) => void;
};

/** The "/" menu (SPEC §11, DESIGN.md "Slash menu"). Keys are handled in the editor. */
export function SlashMenu({ items, index, style, onPick, onHighlight }: Props) {
  return (
    <div className="slash" style={style}>
      <div role="listbox" aria-label="AI actions" className="slash__list">
        {items.map((item, i) => (
          <div
            key={item.label}
            role="option"
            aria-selected={i === index}
            className={i === index ? "slash__item is-active" : "slash__item"}
            // keep focus (and the cursor) in the editor
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(i);
            }}
            onMouseMove={() => i !== index && onHighlight(i)}
          >
            <span className="slash__icon" aria-hidden>
              {item.kind === "review" ? (
                <FileSearch size={15} strokeWidth={1.75} />
              ) : item.kind === "preset" ? (
                <PenLine size={15} strokeWidth={1.75} />
              ) : (
                <span className="ask__mark slash__mark">A</span>
              )}
            </span>
            {item.kind === "free" ? (
              <span className="slash__label">
                Ask AI: <span className="slash__query">{item.label.slice("Ask AI: ".length)}</span>
              </span>
            ) : (
              <span className="slash__label">{item.label}</span>
            )}
          </div>
        ))}
      </div>
      <div className="slash__hint" aria-hidden>
        ↑↓ to move · ↵ to pick · esc to close
      </div>
    </div>
  );
}
