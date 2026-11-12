"use client";

import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

/**
 * The agent's words. It may write GitHub-flavored Markdown and links the files it
 * makes by their path in its working directory. Raw HTML is never rendered; a line
 * break is a line break, as in a GitHub comment.
 */
export function Markdown({ text, fileUrl }: { text: string; fileUrl?: (path: string) => string | null }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          img: ({ alt }) => <>{alt}</>,
          a: ({ href = "", children }) => {
            if (/^(https?:)?\/\//i.test(href)) {
              return (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              );
            }
            // A relative path is a file in the Computer's working directory. Its query
            // or fragment (#page=2) is not part of it.
            const path = href.split(/[?#]/, 1)[0];
            const url = path && !path.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(path) ? fileUrl?.(decoded(path).replace(/^\.\//, "")) : null;
            return url ? <a href={url}>{children}</a> : <span>{children}</span>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function decoded(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
