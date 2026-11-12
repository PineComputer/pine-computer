"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

const ORDER = ["dark", "light", "system"] as const;
type Theme = (typeof ORDER)[number];
const ICONS = { dark: Moon, light: Sun, system: Monitor };
const WORDS = { dark: "Dark", light: "Light", system: "Match the system" };

/** Dark, light, or whatever the system says; remembered in this browser only. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const saved = document.documentElement.dataset.theme;
    if (saved === "light" || saved === "system") setTheme(saved);
  }, []);
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const Icon = ICONS[theme];
  return (
    <button
      className="btn ghost sm"
      title={`Theme: ${WORDS[theme]}. Switch to ${WORDS[next].toLowerCase()}`}
      onClick={() => {
        setTheme(next);
        if (next === "dark") delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = next;
        try {
          if (next === "dark") localStorage.removeItem("theme");
          else localStorage.setItem("theme", next);
        } catch {
          // private windows: the choice lasts until the page closes
        }
      }}
    >
      <Icon /> {WORDS[theme]}
    </button>
  );
}
