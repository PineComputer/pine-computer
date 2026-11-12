// The text of a Word or PDF file, read in the page. drama-cli reads a screenplay only as UTF-8
// text (short_drama drama_cli/stages.py, _read_bytes), so New drama sends a Word or PDF
// screenplay's text as the screenplay and keeps the file beside it; the review rooms show the
// same text for a Word or PDF file the agent returns. Read in the page so the engine needs no
// parser: mammoth (raw text of a .docx) and pdf.js (each page's text items, a line where
// pdf.js marks an end of line). Both load only when such a file comes.

/** Word and PDF files, whose text the page reads with a parser. */
export const EXTRACTED = /\.(docx|pdf)$/i;

/** The file name of a Word or PDF file's text: its stem with .txt. */
export function textName(name: string): string {
  return name.replace(EXTRACTED, ".txt");
}

/** The text of a .docx or .pdf file; "" when it holds none (a scanned PDF, say). */
export async function extractText(name: string, data: ArrayBuffer): Promise<string> {
  if (/\.docx$/i.test(name)) {
    // Its standalone browser file (node_modules/mammoth/README.md:132): it takes an ArrayBuffer in the page and in tests.
    const mammoth = (await import("mammoth/mammoth.browser.js")).default;
    const { value } = await mammoth.extractRawText({ arrayBuffer: data });
    return value.trim() ? value : "";
  }
  if (/\.pdf$/i.test(name)) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc ||= (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    // pdf.js takes the bytes over (transfers them to its worker): give it a copy.
    const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
    const document = await task.promise;
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const content = await (await document.getPage(number)).getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join(""));
    }
    await task.destroy();
    // A PDF's fonts may map a character to a Kangxi radical that looks the same (⼀ for 一):
    // those take their compatibility decomposition, the unified ideograph (Unicode, Kangxi
    // Radicals block U+2F00–U+2FD5). Nothing else is normalized.
    const text = pages.join("\n").replace(/[\u2F00-\u2FD5]/g, (radical) => radical.normalize("NFKC"));
    return text.trim() ? text : "";
  }
  throw new Error(`Not a Word or PDF file: ${name}`);
}
