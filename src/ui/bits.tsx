"use client";

// Small things every page uses: a resident's mark, times, money, markdown.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** A resident's mark: an orbit in its own hue, drawn from its name, the same everywhere. */
export function Mark({ name, color, size = 34, awake = false }: { name: string; color: string; size?: number; awake?: boolean }) {
  let seed = 0;
  for (const ch of name) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const moons = 1 + Math.floor(rand() * 3);
  const tilt = Math.floor(rand() * 180);
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" style={{ flex: "none", filter: awake ? `drop-shadow(0 0 6px ${color})` : undefined }}>
      <g transform={`rotate(${tilt} 20 20)`}>
        <ellipse cx="20" cy="20" rx="17" ry="7.5" fill="none" stroke={color} strokeOpacity="0.45" strokeWidth="1.2" />
        {Array.from({ length: moons }, (_, i) => {
          const a = rand() * Math.PI * 2;
          return <circle key={i} cx={20 + 17 * Math.cos(a)} cy={20 + 7.5 * Math.sin(a)} r={1.6 + i * 0.4} fill={color} />;
        })}
      </g>
      <circle cx="20" cy="20" r="7" fill={color} />
      <circle cx="17.6" cy="17.6" r="2.2" fill="#fff" fillOpacity="0.35" />
    </svg>
  );
}

/** "1 work", "3 works": a count and its noun. */
export function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : plural}`;
}

export function money(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  if (amount !== 0 && Math.abs(amount) < 0.005) return amount < 0 ? "-<$0.01" : "<$0.01";
  return `${amount < 0 ? "-" : ""}$${Math.abs(amount).toFixed(2)}`;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < -60) return `in ${until(iso)}`;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function until(iso: string): string {
  const s = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 1000));
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  return `${Math.round(s / 3600)} h`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <>{alt}</>, a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const KIND_WORDS: Record<string, string> = { native: "Native", brain: "Second brain", visitor: "From elsewhere" };
