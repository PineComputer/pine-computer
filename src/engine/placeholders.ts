// Placeholder pictures for replay mode: simple SVGs that look like what the drama skill
// returns (look sheets, location plates, multi-panel storyboards), clearly labelled as
// placeholders.

const HUES: Record<string, number> = { lin: 340, wei: 210, mother: 30, letter: 45, home: 160, office: 260 };

function hue(name: string): number {
  return HUES[name] ?? [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;
}

function esc(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function figure(x: number, y: number, scale: number, color: string, stroke: string): string {
  const r = 14 * scale;
  return `<g fill="${color}" stroke="${stroke}" stroke-width="${2 * scale}">
    <circle cx="${x}" cy="${y}" r="${r}"/>
    <path d="M${x - r * 1.4},${y + r * 5.5} L${x - r * 1.1},${y + r * 1.4} Q${x},${y + r * 1.1} ${x + r * 1.1},${y + r * 1.4} L${x + r * 1.4},${y + r * 5.5} Z"/>
  </g>`;
}

export function lookSheet(name: string, look: string, version: string): string {
  const h = hue(name);
  const views = [0, 1, 2]
    .map((i) => figure(150 + i * 230, 260, 4, `hsl(${h} 45% ${42 - i * 6}%)`, `hsl(${h} 60% 80%)`))
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768">
  <rect width="1024" height="768" fill="hsl(${h} 18% 14%)"/>
  ${views}
  <rect x="770" y="120" width="210" height="260" rx="10" fill="hsl(${h} 25% 22%)"/>
  <circle cx="875" cy="230" r="70" fill="hsl(${h} 45% 45%)"/>
  <text x="40" y="700" fill="#fff" font-family="sans-serif" font-size="34" font-weight="600">${esc(name)} · ${esc(look)} · ${version}</text>
  <text x="40" y="740" fill="#ffffff99" font-family="sans-serif" font-size="20">front · side · back · close-up — placeholder</text>
</svg>`;
}

export function plate(name: string, version: string): string {
  const h = hue(name);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h} 35% 30%)"/><stop offset="1" stop-color="hsl(${h} 25% 10%)"/></linearGradient></defs>
  <rect width="1536" height="1024" fill="url(#g)"/>
  <rect x="160" y="420" width="420" height="300" fill="hsl(${h} 20% 22%)"/>
  <rect x="900" y="300" width="300" height="420" fill="hsl(${h} 20% 26%)"/>
  <rect x="0" y="720" width="1536" height="304" fill="hsl(${h} 15% 16%)"/>
  <text x="48" y="960" fill="#fff" font-family="sans-serif" font-size="44" font-weight="600">${esc(name)} · plate · ${version}</text>
  <text x="48" y="1000" fill="#ffffff99" font-family="sans-serif" font-size="24">floor plan · front · back · left · right — placeholder</text>
</svg>`;
}

export function prop(name: string, version: string): string {
  const h = hue(name);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768" viewBox="0 0 768 768">
  <rect width="768" height="768" fill="#f4f1ea"/>
  <rect x="214" y="234" width="340" height="250" rx="6" fill="hsl(${h} 50% 85%)" stroke="hsl(${h} 40% 35%)" stroke-width="4" transform="rotate(-6 384 359)"/>
  <text x="40" y="720" fill="#333" font-family="sans-serif" font-size="30" font-weight="600">${esc(name)} · ${version} — placeholder</text>
</svg>`;
}

/** A multi-panel storyboard: one 9:16 panel per shot, three to a row. */
export function storyboard(label: string, shots: string[], style: string, version: string, mark = -1): string {
  const lineArt = style === "line-art";
  const cols = 3;
  const rows = Math.ceil(shots.length / cols);
  const pw = 270;
  const ph = 480;
  const gap = 18;
  const width = cols * pw + (cols + 1) * gap;
  const height = rows * ph + (rows + 1) * gap + 70;
  const panels = shots
    .map((shot, i) => {
      const x = gap + (i % cols) * (pw + gap);
      const y = gap + Math.floor(i / cols) * (ph + gap);
      const bg = lineArt ? "#ffffff" : `hsl(${(i * 47) % 360} 30% 22%)`;
      const ink = lineArt ? "#1b1b1b" : "#f4f4f4";
      const figures = figure(x + pw * 0.38, y + ph * 0.42, 1.6, lineArt ? "none" : `hsl(${(i * 47 + 180) % 360} 40% 55%)`, ink) +
        (i % 2 ? figure(x + pw * 0.68, y + ph * 0.46, 1.4, lineArt ? "none" : "hsl(30 40% 50%)", ink) : "") +
        (i === mark ? figure(x + pw * 0.85, y + ph * 0.36, 0.9, lineArt ? "none" : "#777", ink) : "");
      return `<g>
        <rect x="${x}" y="${y}" width="${pw}" height="${ph}" fill="${bg}" stroke="${ink}" stroke-width="3"/>
        ${figures}
        <rect x="${x}" y="${y}" width="44" height="34" fill="${ink}"/>
        <text x="${x + 22}" y="${y + 24}" text-anchor="middle" fill="${bg}" font-family="sans-serif" font-size="20" font-weight="700">${i + 1}</text>
        <text x="${x + 12}" y="${y + ph - 16}" fill="${ink}" font-family="sans-serif" font-size="16">${esc(shot.slice(0, 28))}</text>
      </g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${lineArt ? "#eeeeea" : "#0d0d0f"}"/>
  ${panels}
  <text x="${gap}" y="${height - 26}" fill="${lineArt ? "#333" : "#ddd"}" font-family="sans-serif" font-size="24">${esc(label)} · ${style} · ${version} — placeholder</text>
</svg>`;
}

/** A blocking frame, upright like the vertical drama it is for: where the actors stand in the shot. */
export function blocking(label: string, version: string): string {
  const h = hue(label);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="576" height="1024" viewBox="0 0 576 1024">
  <rect width="576" height="1024" fill="hsl(${h} 12% 90%)"/>
  <rect x="0" y="640" width="576" height="384" fill="hsl(${h} 10% 82%)"/>
  <rect x="330" y="250" width="170" height="300" fill="none" stroke="hsl(${h} 12% 55%)" stroke-width="3"/>
  ${figure(190, 420, 3.2, "none", "#2a2420")}${figure(390, 470, 2.6, "none", "#2a2420")}
  <text x="40" y="960" fill="#3a332e" font-family="sans-serif" font-size="24">${esc(label)} · blocking · ${version}</text>
  <text x="40" y="992" fill="#6a625b" font-family="sans-serif" font-size="20">placeholder</text>
</svg>`;
}
