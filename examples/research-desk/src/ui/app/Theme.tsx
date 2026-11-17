"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/** The blue room or the ivory one. Blue until the person chooses; the choice is remembered in this browser only. */
export function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const chosen = document.documentElement.dataset.theme;
    setDark(chosen !== "light");
  }, []);
  const label = dark ? "Switch to the ivory room" : "Switch to the blue room";
  return (
    <button
      className="btn ghost sm icon"
      title={label}
      aria-label={label}
      onClick={() => {
        const next = dark ? "light" : "dark";
        setDark(!dark);
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("theme", next);
        } catch {
          // private windows: the choice lasts until the page closes
        }
      }}
    >
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}
