"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/** The yellow board, or the night one; remembered in this browser only. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);
  return (
    <button
      className="btn ghost sm"
      title={dark ? "Switch to the yellow board" : "Switch to the night board"}
      onClick={() => {
        const next = !dark;
        setDark(next);
        if (next) document.documentElement.dataset.theme = "dark";
        else delete document.documentElement.dataset.theme;
        try {
          if (next) localStorage.setItem("theme", "dark");
          else localStorage.removeItem("theme");
        } catch {
          // private windows: the choice lasts until the page closes
        }
      }}
    >
      {dark ? <Moon /> : <Sun />}
    </button>
  );
}
