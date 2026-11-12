// mammoth's prebuilt browser bundle, which reads a .docx from an ArrayBuffer in the page and in
// tests alike; its API is mammoth's own (node_modules/mammoth/lib/index.d.ts).
declare module "mammoth/mammoth.browser.js" {
  const mammoth: typeof import("mammoth");
  export default mammoth;
}
