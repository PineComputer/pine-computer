"use client";

import { useEffect, useState } from "react";
import type { CheckView } from "@/shared/api";
import { TRIGGER } from "./Feed";
import { capital, clock } from "./format";

/** How much of the screen's width a close-up shows, and the shape of the box it is shown in. */
const SHOWN = 0.36;
const BOX = 3 / 2;

/** The columns of a picture that hold the page: most sites leave wide blank margins on a wide screen. */
interface Columns {
  left: number;
  right: number;
  /** The picture's width over its height. */
  ratio: number;
}

const screenOf = (check: CheckView) => `/api/checks/${check.id}/screen`;

/** Finds a picture's blank side margins by looking for columns of one flat colour. */
function useColumns(src: string | null): Columns | null {
  const [columns, setColumns] = useState<Columns | null>(null);
  useEffect(() => {
    if (!src) return;
    const image = new Image();
    image.onload = () => {
      const width = 240;
      const height = 120;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, width, height);
      const { data } = context.getImageData(0, 0, width, height);
      const flat = (x: number) => {
        for (let y = 1; y < height; y++) for (let c = 0; c < 3; c++) if (Math.abs(data[(y * width + x) * 4 + c] - data[x * 4 + c]) > 10) return false;
        return true;
      };
      let left = 0;
      let right = width;
      while (left < width / 3 && flat(left)) left++;
      while (right > (2 * width) / 3 && flat(right - 1)) right--;
      setColumns({ left: left / width, right: right / width, ratio: image.naturalWidth / image.naturalHeight });
    };
    image.src = src;
    return () => void (image.onload = null);
  }, [src]);
  return src ? columns : null;
}

/** The CSS that shows the part of the picture named by `place` ("top left", "centre"…), zoomed. */
function closeUp(place = "top left", columns: Columns | null): { backgroundSize: string; backgroundPosition: string } {
  const { left, right, ratio } = columns ?? { left: 0, right: 1, ratio: 2 };
  const [row, column] = place === "centre" ? ["middle", "centre"] : place.split(" ");
  // The picture's width and height, in boxes; and so how much of it the box shows.
  const wide = 1 / Math.min(SHOWN, right - left);
  const tall = (wide * BOX) / ratio;
  const x = column === "right" ? right - 1 / wide : column === "centre" ? (left + right - 1 / wide) / 2 : left;
  const y = row === "bottom" ? 1 - 1 / tall : row === "middle" ? (1 - 1 / tall) / 2 : 0;
  const percent = (from: number, size: number) => `${((Math.max(0, from) * size) / (size - 1)) * 100}%`;
  return { backgroundSize: `${wide * 100}% auto`, backgroundPosition: `${percent(x, wide)} ${percent(y, tall)}` };
}

/**
 * The picture of the screen a check kept: a close-up of the part it read, or the whole
 * screen. Click to switch; a pair switches together, and shows the same part of both.
 */
function Shot({ check, place, columns, whole, onToggle, className = "" }: { check: CheckView; place?: string; columns: Columns | null; whole: boolean; onToggle: () => void; className?: string }) {
  if (!check.hasScreen) return <div className={`shot shot-empty ${className}`}>This check kept no picture.</div>;
  return (
    <div
      role="img"
      aria-label={`The screen at ${clock(check.endedAt ?? check.startedAt)}`}
      title={whole ? "Show the part it read" : "Show the whole screen"}
      className={`shot ${className}`}
      data-whole={whole}
      onClick={onToggle}
      style={{ backgroundImage: `url(${screenOf(check)})`, ...(whole ? { backgroundSize: "contain", backgroundPosition: "50% 50%" } : closeUp(place, columns)) }}
    />
  );
}

const kicker = (check: CheckView) => `${TRIGGER[check.trigger]}${check.dueAt ? ` for ${clock(check.dueAt)}` : ""}`;

/** The proof: one change, with the screen before and the screen after, side by side. */
export function Change({ check, before }: { check: CheckView; before: CheckView }) {
  const [whole, setWhole] = useState(false);
  const columns = useColumns(check.hasScreen ? screenOf(check) : null);
  const differences = check.change?.differences ?? [];
  const side = (which: "before" | "after", shown: CheckView) => (
    <div className={`side-shot ${which}`}>
      <Shot check={shown} place={check.place} columns={columns} whole={whole} onToggle={() => setWhole(!whole)} className={which} />
      <p className="caption">
        <span className="label">{which}</span>
        <time>{clock(shown.endedAt ?? shown.startedAt, true)}</time>
      </p>
      {differences.slice(0, 3).map((d) => (
        <p key={d.label} className="value">
          {differences.length > 1 && <small>{d.label}</small>}
          {d[which] || "—"}
        </p>
      ))}
    </div>
  );
  return (
    <section className="proof">
      <div className="kicker">
        <span className="tag" data-tone="changed">
          Changed
        </span>
        <span>{kicker(check)}</span>
      </div>
      <p className="sentence">{check.change?.sentence}</p>
      <div className="pair">
        {side("before", before)}
        {side("after", check)}
      </div>
    </section>
  );
}

/** A check that found no change, the first look, or one that didn't finish: what it read and its screen. */
export function Reading({ check, before }: { check: CheckView; before?: CheckView }) {
  const [whole, setWhole] = useState(false);
  const columns = useColumns(check.hasScreen ? screenOf(check) : null);
  const failed = check.state === "failed";
  return (
    <section className="proof">
      <div className="kicker">
        <span className="tag" data-tone={failed ? "bad" : undefined}>
          {failed ? "Didn't finish" : check.outcome === "first" ? "First look" : "No change"}
        </span>
        <span>
          {kicker(check)} · {clock(check.endedAt ?? check.startedAt, true)}
        </span>
      </div>
      <p className="sentence quiet">
        {failed ? check.problem : before ? `The same as at ${clock(before.endedAt ?? before.startedAt)}.` : "This is what later checks are compared with."}
      </p>
      {!failed && (
        <div className="reading">
          <Shot check={check} place={check.place} columns={columns} whole={whole} onToggle={() => setWhole(!whole)} />
          <div className="fields">
            {check.fields?.map((field) => (
              <p key={field.label} className="value">
                <small>{capital(field.label)}</small>
                {field.value}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
