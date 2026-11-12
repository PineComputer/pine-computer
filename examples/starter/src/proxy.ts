// Who may use this app's API. It has no sign-in, so it answers only on this machine:
//
// - a Host that isn't this machine is refused, so a site that points its own name at
//   127.0.0.1 (DNS rebinding) can't read a desktop token;
// - a change sent from another site's page is refused, so a page you visit can't give
//   your agent a task.
//
// `npm run dev` and `npm start` also listen on 127.0.0.1 only. In a product, check your
// sign-in here and in src/server/user.ts instead.

import { NextResponse, type NextRequest } from "next/server";

const THIS_MACHINE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const READS = new Set(["GET", "HEAD"]);

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!THIS_MACHINE.test(host)) return refuse("This app answers only on the machine it runs on.");
  if (!READS.has(request.method)) {
    const origin = request.headers.get("origin");
    const fromHere = origin ? safeHost(origin) === host : request.headers.get("sec-fetch-site") !== "cross-site";
    if (!fromHere) return refuse("Changes come only from this app's own pages.");
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
