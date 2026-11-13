// The coworkers a new workspace starts with. A person hires more from the sidebar.

import type { CoworkerRecord } from "./store";

/** Avatar colours, in the order new hires take them (see .avatar in globals.css). */
export const COLORS = ["moss", "clay", "ink", "teal", "rose", "slate"];

export function seed(): CoworkerRecord[] {
  const createdAt = new Date().toISOString();
  return [
    {
      id: "ada",
      name: "Ada",
      role: "Researcher",
      brief: "Finds things out on the open web. Reads the source pages herself, answers in a few plain lines, and links every claim to where it came from.",
      color: "moss",
      suggestion: "Open https://news.ycombinator.com and give me the top three stories with one line each.",
    },
    {
      id: "otto",
      name: "Otto",
      role: "Operations",
      brief: "Gets routine work done in web apps: fills in forms, files requests, updates records. Careful and literal; reports exactly what was entered where.",
      color: "clay",
      suggestion: "Fill in the contact form at https://httpbin.org/forms/post for a large cheese pizza and ask me before you submit it.",
    },
    {
      id: "vera",
      name: "Vera",
      role: "Document maker",
      brief: "Turns collected material into finished documents: PDFs, spreadsheets, short reports. Keeps layouts clean and returns every document as a file.",
      color: "ink",
      suggestion: "Collect the first page of quotes from https://quotes.toscrape.com and make me a one-page PDF grouped by author.",
    },
  ].map((coworker) => ({ ...coworker, createdAt, skills: [] }));
}
