"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { Suggestion } from "@/lib/types";

const GAP = 8;
const ESTIMATED_HEIGHT = 128;

/**
 * Stack cards so none overlap. The active card sits exactly on its line;
 * cards after it are pushed down, cards before it are pushed up.
 */
export function layoutCards(
  items: { id: string; top: number }[],
  heights: Record<string, number>,
  activeId: string | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!items.length) return out;
  const h = (id: string) => heights[id] ?? ESTIMATED_HEIGHT;
  const pivot = Math.max(0, items.findIndex((x) => x.id === activeId));

  out[items[pivot].id] = items[pivot].top;
  for (let i = pivot + 1; i < items.length; i++) {
    const prev = items[i - 1];
    out[items[i].id] = Math.max(items[i].top, out[prev.id] + h(prev.id) + GAP);
  }
  for (let i = pivot - 1; i >= 0; i--) {
    const next = items[i + 1];
    out[items[i].id] = Math.min(items[i].top, out[next.id] - h(items[i].id) - GAP);
  }
  return out;
}

type Props = {
  items: Suggestion[];
  anchors: Record<string, number>; // desired top per suggestion, relative to the margin column
  active: string | null;
  renderCard: (s: Suggestion, style: React.CSSProperties, ref: (el: HTMLDivElement | null) => void) => React.ReactNode;
};

/** Desktop: one card per suggestion in the right margin, next to its line. */
export function MarginCards({ items, anchors, active, renderCard }: Props) {
  const [heights, setHeights] = useState<Record<string, number>>({});
  const refs = useRef(new Map<string, HTMLDivElement>());

  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => {
      const next: Record<string, number> = {};
      refs.current.forEach((el, id) => (next[id] = el.offsetHeight));
      setHeights((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    });
    refs.current.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [items]);

  const placed = items.filter((s) => anchors[s.id] !== undefined).map((s) => ({ id: s.id, top: anchors[s.id] }));
  const tops = layoutCards(placed, heights, active);

  return (
    <aside className="margin" aria-label="Suggestions">
      {items.map((s) =>
        tops[s.id] === undefined
          ? null
          : renderCard(s, { transform: `translate(${s.id === active ? -8 : 0}px, ${tops[s.id]}px)` }, (el) => {
              if (el) refs.current.set(s.id, el);
              else refs.current.delete(s.id);
            }),
      )}
    </aside>
  );
}
