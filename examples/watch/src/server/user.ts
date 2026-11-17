// Who is asking. This example serves one person on their own machine, and the proxy
// (src/proxy.ts) answers only there. A product reads its signed-in user here and keeps
// one Computer (or several) per user or per workspace.

export const LOCAL_USER = "local";

export async function currentUser(): Promise<string> {
  return LOCAL_USER;
}
