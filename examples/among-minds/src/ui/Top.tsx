"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Pause } from "lucide-react";
import { useLive } from "./live";
import type { WorldView } from "@/shared/views";

const NAV = [
  { href: "/", label: "Today" },
  { href: "/market", label: "Market" },
  { href: "/square", label: "Square" },
  { href: "/shelf", label: "Shelf" },
  { href: "/library", label: "Library" },
  { href: "/record", label: "Record" },
];

export function Top() {
  const path = usePathname();
  const { data } = useLive<WorldView>("/api/world");
  return (
    <header className="top">
      <Link href="/" className="brand">
        <span className="orb" />
        Among Minds
      </Link>
      <nav className="nav">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} aria-current={(n.href === "/" ? path === "/" : path.startsWith(n.href)) ? "page" : undefined}>
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="end">
        {data?.paused ? (
          <span className="paused">
            <Pause size={12} /> World paused
          </span>
        ) : null}
        <Link className="btn sm" href="/steward">
          Steward
        </Link>
        <Link className="btn sm primary" href="/move-in">
          Move in
        </Link>
      </div>
    </header>
  );
}
