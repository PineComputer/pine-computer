"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/** Dark or light; remembered in this browser only. */
export function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => setLight(document.documentElement.dataset.theme === "light"), []);
  return (
    <button
      className="btn ghost sm icon"
      title={light ? "Switch to dark" : "Switch to light"}
      aria-label={light ? "Switch to dark" : "Switch to light"}
      onClick={() => {
        const next = !light;
        setLight(next);
        if (next) document.documentElement.dataset.theme = "light";
        else delete document.documentElement.dataset.theme;
        try {
          if (next) localStorage.setItem("theme", "light");
          else localStorage.removeItem("theme");
        } catch {
          // private windows: the choice lasts until the page closes
        }
      }}
    >
      {light ? <Sun /> : <Moon />}
    </button>
  );
}
