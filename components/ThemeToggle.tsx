"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";
const order: Mode[] = ["system", "light", "dark"];
const label: Record<Mode, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" };

function read(): Mode {
  try {
    const v = localStorage.getItem("theme");
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => setMode(read()), []);

  function cycle() {
    const next = order[(order.indexOf(mode) + 1) % order.length];
    setMode(next);
    try {
      if (next === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {}
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
  }

  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  return (
    <button type="button" className="icon-btn" onClick={cycle} aria-label={label[mode]} title={label[mode]}>
      <Icon size={15} strokeWidth={1.75} />
    </button>
  );
}

/** Runs before paint so a stored theme never flashes the wrong colours. */
export const themeInitScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
