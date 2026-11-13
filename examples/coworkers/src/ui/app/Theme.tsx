"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Light or dark. It follows the system until the person chooses; the choice is remembered in this browser only. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const chosen = document.documentElement.dataset.theme;
    setDark(chosen ? chosen === "dark" : systemDark());
  }, []);
  const label = dark ? "Switch to light" : "Switch to dark";
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
