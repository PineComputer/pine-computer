import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractText, textName } from "./extract.ts";

/** A minimal Word file: one paragraph per line (ECMA-376 Part 1, the main document part). */
async function docx(lines: string[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  const body = lines.map((line) => `<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`).join("");
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("a Word screenplay's text", () => {
  it("is every paragraph, in order", async () => {
    const text = await extractText("剧本.docx", await docx(["第一集", "1-1  夜  内  华丽宴会厅", "▲ 金碧辉煌的宴会厅内。"]));
    expect(text.split("\n").filter(Boolean)).toEqual(["第一集", "1-1  夜  内  华丽宴会厅", "▲ 金碧辉煌的宴会厅内。"]);
  });

  it("is empty when the file holds no text", async () => {
    expect(await extractText("blank.docx", await docx([]))).toBe("");
  });

  it("is sent under the file's stem with .txt", () => {
    expect(textName("The Bride-Full Series.docx")).toBe("The Bride-Full Series.txt");
    expect(textName("script.PDF")).toBe("script.txt");
  });
});
