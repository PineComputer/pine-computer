// Trades: how homes differ. A trade is a skill written into the home and a choice of
// Pine's built-in skills switched on or off, so what one computer does easily another
// cannot do at all, and the market has something to trade.

export interface Trade {
  id: string;
  title: string;
  /** One line, for people. */
  summary: string;
  /** Pine built-in skills this home keeps on; the other switchable ones are switched off. */
  builtins: string[];
  /** The trade's own skill, written into the home at move-in. */
  skill: { name: string; md: string };
}

const skill = (name: string, description: string, body: string) => ({
  name,
  md: `---\nname: ${name}\ndescription: ${description}\n---\n\n${body.trim()}\n`,
});

export const TRADES: Trade[] = [
  {
    id: "illustrator",
    title: "Illustrator",
    summary: "Makes images: drawings, diagrams, posters, generated art.",
    builtins: ["media-generation"],
    skill: skill(
      "illustration",
      "Make finished images: SVG drawings, diagrams and posters, or generated pictures. Use when a task needs something to look at.",
      `
# Illustration

1. Settle the subject, the size and the palette in one line before drawing.
2. For diagrams, posters and marks, write SVG by hand in \`works/<slug>.svg\`; keep it
   self-contained (no external fonts or images).
3. For pictures, use the media generation skill and save the result in \`works/\`.
4. Open the file in the browser and look at it. Fix what looks wrong before calling it done.
5. Note in \`note.md\` what you made and where it is.
`,
    ),
  },
  {
    id: "scribe",
    title: "Scribe",
    summary: "Writes: essays, briefs, documents and slide decks.",
    builtins: ["docx", "pptx", "pdf"],
    skill: skill(
      "prose",
      "Write and edit finished prose: essays, briefs, documents, slide decks. Use when the result is words someone will read.",
      `
# Prose

1. Write the point of the piece in one sentence first; cut anything that does not serve it.
2. Draft in Markdown in \`works/<slug>.md\`. Short paragraphs, plain words, concrete examples.
3. When someone needs a document or deck, produce .docx or .pptx with the document skills.
4. Read it once aloud in your head and fix what stumbles.
5. Note in \`note.md\` what you wrote and where it is.
`,
    ),
  },
  {
    id: "analyst",
    title: "Analyst",
    summary: "Works with numbers: data, spreadsheets, charts and analysis.",
    builtins: ["pdf"],
    skill: skill(
      "data-analysis",
      "Turn data into findings: gather numbers, clean them, analyse with Python, chart them. Use when a question has a numeric answer.",
      `
# Data analysis

1. Write the question as a number you could compute.
2. Gather the data into \`data/<slug>.csv\` and note its source.
3. Analyse with Python in the shell (pandas, matplotlib); save the script beside the data.
4. Save charts as PNG in \`works/\` with labelled axes and a one-line takeaway.
5. Report the answer with the uncertainty you actually have.
`,
    ),
  },
  {
    id: "scout",
    title: "Scout",
    summary: "Reads the web: finds sources, checks facts, builds reference lists.",
    builtins: [],
    skill: skill(
      "field-research",
      "Research the public web carefully: find primary sources, check claims, and build cited reference notes. Use when a question needs evidence.",
      `
# Field research

1. Decide what would settle the question before searching.
2. Prefer primary sources; open them, do not trust snippets.
3. Write findings in \`research/<slug>.md\`: each claim with its link and the date you read it.
4. Say what you could not confirm.
5. Never sign up, submit forms or post anywhere outside the habitat.
`,
    ),
  },
  {
    id: "builder",
    title: "Builder",
    summary: "Builds small tools and pages: single-file HTML apps, scripts, utilities.",
    builtins: [],
    skill: skill(
      "small-builds",
      "Build small working things: single-file HTML tools and pages, scripts and utilities. Use when the answer is something people can run.",
      `
# Small builds

1. Write what it does in one sentence, and the one way to tell it works.
2. Build it as one self-contained file in \`works/<slug>.html\` (no external requests) or a
   script in \`tools/\`.
3. Open it in the browser or run it, and use it once the way a stranger would.
4. Fix what broke. Keep it small.
5. Note in \`note.md\` what it does and how to use it.
`,
    ),
  },
  {
    id: "librarian",
    title: "Librarian",
    summary: "Keeps knowledge: summaries, indexes, comparisons and collections.",
    builtins: ["pdf", "docx"],
    skill: skill(
      "curation",
      "Organise knowledge: summarise, compare, index and collect works and sources. Use when there is more to read than anyone can.",
      `
# Curation

1. Read the whole thing before summarising it.
2. Keep collections in \`library/\`: one index file linking every item with a line on why it matters.
3. When comparing, use the same questions for every item.
4. Credit every author by name.
5. Note in \`note.md\` what you added and what is missing.
`,
    ),
  },
];

export function trade(id: string): Trade {
  const found = TRADES.find((t) => t.id === id);
  if (!found) throw new Error(`There's no trade called ${id}.`);
  return found;
}
