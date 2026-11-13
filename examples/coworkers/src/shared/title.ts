// A thread's name in the sidebar, made from its first message by rule: the site it is
// about and what is wanted there ("Hacker News: top stories"), or the document it asks
// for ("Quotes PDF"). No model writes it, so it is instant and always the same.

const URL = /\bhttps?:\/\/[^\s)>\]]+/gi;
const HOST = /\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|app|ai|co|gov|edu)\b(?:\/[^\s)>\]]*)?/gi;

/** Sites whose name isn't their address. */
const SITES: Record<string, string> = {
  "news.ycombinator.com": "Hacker News",
  "github.com": "GitHub",
  "wikipedia.org": "Wikipedia",
  "youtube.com": "YouTube",
  "arxiv.org": "arXiv",
  "linkedin.com": "LinkedIn",
};

const DELIVERABLES: [RegExp, string][] = [
  [/\bpdf\b/i, "PDF"],
  [/\bspreadsheet\b|\bxlsx\b|\bexcel\b/i, "spreadsheet"],
  [/\bcsv\b/i, "CSV"],
  [/\bslides?\b|\bdeck\b/i, "deck"],
  [/\b(?:a|the|short|written|weekly|monthly)\s+report\b/i, "report"],
  [/\bchart\b/i, "chart"],
];

/** Openers that say where to go, not what the job is. */
const BOILERPLATE = /^(?:please\s+)?(?:open|go to|visit|navigate to|browse to|sign in to|log in to|log into|sign into)\b[^.,;]*?(?:\s+and\s+|[.,;]\s*|$)/i;
const DROPPED = new Set("a an the this that these those my our your me us all each every one two three four five six seven eight nine ten first second third please just".split(" "));
const STOPS = /\s+(?:on|at|from|in|for|with|to|into|about|using|through|via|by|and|then|so|as|before|after|whether|if)\s+|[.,;:?!]/i;
/** "the first page of quotes" is about the quotes. */
const CONTAINER = /^(?:(?:the|a|an|first|last|top|next|whole|full|entire)\s+)*(?:pages?|list|set|table|rows?|collection|batch|copy|summary|overview)\s+of\s+/i;

function siteFromHost(host: string): string {
  const name = host.replace(/^www\./, "").toLowerCase();
  for (const [known, label] of Object.entries(SITES)) if (name === known || name.endsWith(`.${known}`)) return label;
  const labels = name.split(".");
  return labels.length > 1 ? labels[labels.length - 2] : name;
}

/** A site named in the words themselves: "on Hacker News", "to the Larkspur Care support portal". */
function siteFromWords(text: string): string | null {
  const found = /\b(?:on|at|to|in|from|into)\s+(?:the\s+)?((?:[A-Z][A-Za-z0-9&'’-]*)(?:\s+[A-Z][A-Za-z0-9&'’-]*){0,3})/.exec(text);
  return found ? found[1] : null;
}

const clip = (text: string, max: number) => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 12)).replace(/[\s,;:.]+$/, "")}…`;
};

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The thing the first clause asks about: "Read the top five stories on …" is about "top stories". */
function topic(clause: string): string {
  let words = clause.replace(CONTAINER, "").trim();
  // A question opens with how it asks, an imperative with its verb ("Fill in …"); a
  // container may follow either.
  const question = /^(?:what|which|who|where|when|how)(?:\s+(?:is|are|was|were|do|does|did|many|much))?\s+/i;
  words = question.test(words) ? words.replace(question, "") : words.replace(/^[A-Za-z’']+\s+(?:(?:in|out|up|down|off|over)\s+)?/, "");
  const head = words.replace(CONTAINER, "").split(STOPS)[0] ?? "";
  return head
    .split(/\s+/)
    .filter((word) => word && !DROPPED.has(word.toLowerCase()))
    .slice(0, 5)
    .join(" ")
    .replace(/\s+of$/i, "");
}

/** What the job leaves behind in the app it works in: "… and prepare a warranty claim for …" is a warranty claim. */
const OUTCOME = /\b(?:prepare|file|open|raise|submit|book|schedule|place|request|start|lodge)\s+(?:a|an|the)\s+((?:new\s+)?[a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}?\s*(?:claim|ticket|request|order|booking|appointment|refund|return|application|case|invoice|expense))\b/i;

export function titleOf(goal: string): string {
  const flat = goal.replace(/\s+/g, " ").trim();
  const host = (URL.exec(flat)?.[0] ?? HOST.exec(flat)?.[0])?.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
  URL.lastIndex = 0;
  HOST.lastIndex = 0;
  // Addresses, sign-in names and secrets say nothing about the job.
  const words = flat
    .replace(/\S+@\S+/g, "")
    .replace(URL, "")
    .replace(HOST, "")
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, "")
    .replace(/\s+(?:at|as|with|from|on)(?=\s+(?:at|as|with|and)\b|\s*[.,;]|\s*$)/gi, "")
    .replace(/\s+(?:at|as|with|from|on)(?=\s+(?:at|as|with|and)\b|\s*[.,;]|\s*$)/gi, "")
    .replace(/\s+([.,;])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  const site = siteFromWords(words) ?? (host ? siteFromHost(host) : null);
  const body = words.replace(BOILERPLATE, "").trim() || words;
  const outcome = OUTCOME.exec(body)?.[1].replace(/^new\s+/i, "").trim();
  const subject = outcome ?? topic(body);
  const deliverable = DELIVERABLES.find(([pattern]) => pattern.test(words))?.[1];

  if (deliverable && subject) {
    const named = subject.toLowerCase().includes(deliverable.toLowerCase()) ? subject : `${subject} ${deliverable}`;
    return clip(capital(named), 40);
  }
  if (site && subject && !subject.toLowerCase().includes(site.toLowerCase())) return clip(`${site}: ${subject}`, 44);
  if (subject) return clip(capital(subject), 40);
  return clip(capital(words || flat), 40);
}
