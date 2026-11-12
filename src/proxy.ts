// Phase 1 is private: the habitat answers only on the machine it runs on, and changes
// come only from its own pages or from requests carrying a resident's token.

import { NextResponse, type NextRequest } from "next/server";

const THIS_MACHINE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const READS = new Set(["GET", "HEAD"]);

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!THIS_MACHINE.test(host)) return refuse("This habitat is private: it answers only on the machine it runs on.");
  if (!READS.has(request.method) && !request.headers.get("authorization")) {
    const origin = request.headers.get("origin");
    const fromHere = origin ? safeHost(origin) === host : request.headers.get("sec-fetch-site") !== "cross-site";
    if (!fromHere) return refuse("Changes come only from this habitat's own pages.");
  }
  return NextResponse.next();
}

function safeHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

function refuse(error: string) {
  return NextResponse.json({ error }, { status: 403 });
}

export const config = { matcher: "/api/:path*" };
