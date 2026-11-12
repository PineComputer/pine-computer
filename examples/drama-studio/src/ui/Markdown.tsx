// The text the agent returns (bibles, breakdowns, a screenplay rewrite's review), set as a
// document: headings, lists, emphasis, code, fenced blocks (kept line for line, as a
// rewrite's line table is) and paragraphs, built as React elements, so nothing in the text can run.
// Anything else stays readable as written. Very long text is cut short, with a note.
import { Fragment, type ReactNode } from "react";

const LIMIT = 200_000;

/**
 * **bold**, *italic* or _italic_, `code` and [links], inside one line. Underscores inside a
 * word (omni_reference_task_type) are the word's own. A link, or a backquoted path, opens only a file the
 * studio saved (`links`, by its path in the session); any other target is shown, not followed.
 */
function inline(text: string, links?: Map<string, string>): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\[[^\]\n]+\]\(\s*<?[^)\s>]+>?\s*\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|(?<![\p{L}\p{N}_])_[^_\s][^_]*_(?![\p{L}\p{N}_]))/gu;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = out.length;
    const link = token.match(/^\[([^\]]+)\]\(\s*<?([^)\s>]+)>?\s*\)$/);
    if (link) {
      const url = links?.get(link[2].replace(/^\.\//, ""));
      out.push(
        url ? (
          <a key={key} href={url} target="_blank" rel="noreferrer" className="link">
            {link[1]}
          </a>
        ) : (
          <span key={key} className="named" title={link[2]}>
            {link[1]}
          </span>
        ),
      );
    } else if (token.startsWith("**")) out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) {
      const url = links?.get(token.slice(1, -1).replace(/^\.\//, ""));
      out.push(
        url ? (
          <a key={key} href={url} target="_blank" rel="noreferrer" className="link">
            <code>{token.slice(1, -1)}</code>
          </a>
        ) : (
          <code key={key}>{token.slice(1, -1)}</code>
        ),
      );
    }
    else out.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, links, className = "document" }: { text: string; links?: Map<string, string>; className?: string }) {
  const cut = text.length > LIMIT;
  const lines = (cut ? text.slice(0, LIMIT) : text).replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length}>{inline(paragraph.join(" "), links)}</p>);
    paragraph = [];
    if (list) {
      const items = list.items.map((item, index) => <li key={index}>{inline(item, links)}</li>);
      blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    }
    list = undefined;
  };
  let fence: string[] | undefined;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      // A fenced block (CommonMark, "Fenced code blocks"): its lines as written, in monospace.
      if (fence) {
        blocks.push(<pre key={blocks.length} className="fenced">{fence.join("\n")}</pre>);
        fence = undefined;
      } else {
        flush();
        fence = [];
      }
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (heading) {
      flush();
      const level = Math.min(4, heading[1].length + 1);
      const Tag = `h${level}` as "h2" | "h3" | "h4";
      blocks.push(<Tag key={blocks.length}>{inline(heading[2], links)}</Tag>);
    } else if (bullet || numbered) {
      if (paragraph.length) flush();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      blocks.push(<hr key={blocks.length} />);
    } else if (!line.trim()) {
      flush();
    } else {
      if (list) flush();
      paragraph.push(line.trim());
    }
  }
  if (fence) blocks.push(<pre key={blocks.length} className="fenced">{fence.join("\n")}</pre>);
  flush();
  return (
    <div className={className}>
      {blocks.map((block, index) => (
        <Fragment key={index}>{block}</Fragment>
      ))}
      {cut && <p className="quiet">…</p>}
    </div>
  );
}
