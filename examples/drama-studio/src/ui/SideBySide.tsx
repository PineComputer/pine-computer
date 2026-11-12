import type { ReactNode } from "react";

/**
 * Two documents in two columns, each in a wrapper of its own: a document view renders its link
 * and its body as siblings, so unwrapped they took a grid cell each instead of a column. Each
 * column scrolls on its own.
 */
export function SideBySide({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="side-by-side">
      <div className="side-doc">{left}</div>
      <div className="side-doc">{right}</div>
    </div>
  );
}
