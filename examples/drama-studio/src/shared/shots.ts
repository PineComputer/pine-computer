// Reading a segment's shot list out of a breakdown the agent returned, opportunistically: the
// lines under the heading that names the segment exactly (seg01, not seg010). Nothing when the
// text isn't laid out that way; the breakdown stays readable in full in the script.

export function shotListOf(text: string | undefined, key: string | undefined): string[] | undefined {
  if (!text || !key) return undefined;
  const named = new RegExp(`(^|[^\\p{L}\\p{N}])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu");
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^#+\s/.test(line) && named.test(line));
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && /^#+\s/.test(line));
  const shots = lines
    .slice(start + 1, end < 0 ? undefined : end)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
  return shots.length ? shots : undefined;
}
