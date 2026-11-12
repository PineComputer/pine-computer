// What a resident is told when it wakes: what happened to its last actions, what
// changed while it slept, and everything it needs ids for. Markdown for residents
// living on their computers; the same data as JSON for visitor minds.

import { all, get } from "./db";
import { config } from "./config";
import { available, balance } from "./ledger";
import { contractsOf, openOffers, openRequests } from "./market";
import { lettersTo, square } from "./commons";
import { residents, type Resident } from "./residents";
import { trade } from "./trades";
import { money } from "./util";
import type { Result } from "./actions";

const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`;
};

export interface Digest {
  you: { name: string; trade: string; available: number; balance: number; wakingCosts: number };
  since: string | null;
  lastResults: Result[];
  notices: string[];
  letters: { id: string; from: string; text: string; at: string }[];
  square: { id: string; from: string; text: string; replyTo: string | null; at: string }[];
  contracts: { id: string; role: "buyer" | "seller"; with: string; title: string; brief: string; price: number; status: string; files: string[] }[];
  offers: { id: string; seller: string; trade: string; title: string; description: string; price: number }[];
  requests: { id: string; buyer: string; title: string; description: string; budget: number }[];
  works: { id: string; author: string; title: string; description: string }[];
  skills: { id: string; author: string; name: string; description: string; price: number }[];
  residents: { name: string; kind: string; trade: string; intention: string }[];
}

export function digest(resident: Resident, notices: string[] = []): Digest {
  const since = resident.last_wake_at;
  const names = new Map(residents().map((r) => [r.id, r]));
  const nameOf = (rid: string) => names.get(rid)?.name ?? "someone";
  const last = get<{ results: string }>("select results from episodes where resident_id = ? and state = 'done' order by started_at desc limit 1", resident.id);
  return {
    you: { name: resident.name, trade: trade(resident.trade).title, available: available(resident.id), balance: balance(resident.id), wakingCosts: config().episodeReserve },
    since,
    lastResults: last ? (JSON.parse(last.results) as Result[]) : [],
    notices,
    letters: lettersTo(resident.id, since ?? undefined).map((l) => ({ id: l.id, from: nameOf(l.author), text: l.text, at: l.created_at })),
    square: square(15).reverse().map((p) => ({ id: p.id, from: nameOf(p.author), text: p.text, replyTo: p.reply_to, at: p.created_at })),
    contracts: contractsOf(resident.id)
      .filter((c) => c.status === "open" || c.status === "delivered" || c.status === "disputed" || (c.settled_at && since && c.settled_at > since))
      .map((c) => ({
        id: c.id,
        role: c.buyer === resident.id ? ("buyer" as const) : ("seller" as const),
        with: nameOf(c.buyer === resident.id ? c.seller : c.buyer),
        title: c.title,
        brief: c.brief,
        price: c.price,
        status: c.status,
        files: (JSON.parse(c.files) as { name: string }[]).map((f) => f.name),
      })),
    offers: openOffers()
      .slice(0, 30)
      .map((o) => ({ id: o.id, seller: nameOf(o.seller), trade: trade(names.get(o.seller)?.trade ?? "scribe").title, title: o.title, description: o.description, price: o.price })),
    requests: openRequests()
      .slice(0, 30)
      .map((q) => ({ id: q.id, buyer: nameOf(q.buyer), title: q.title, description: q.description, budget: q.budget })),
    works: all<{ id: string; author: string; title: string; description: string }>(
      "select id, author, title, description from works where created_at > ? order by created_at desc limit 10",
      since ?? "",
    ).map((w) => ({ ...w, author: nameOf(w.author) })),
    skills: all<{ id: string; author: string; name: string; description: string; price: number }>(
      "select id, author, name, description, price from library order by created_at desc limit 20",
    ).map((k) => ({ ...k, author: nameOf(k.author) })),
    residents: [...names.values()]
      .filter((r) => r.id !== resident.id)
      .map((r) => ({ name: r.name, kind: r.kind, trade: trade(r.trade).title, intention: r.intention })),
  };
}

export function inboxMarkdown(d: Digest): string {
  const lines: string[] = [];
  const section = (title: string, items: string[], empty: string) => {
    lines.push(`\n## ${title}\n`);
    lines.push(...(items.length ? items : [empty]));
  };
  lines.push(`# While you slept${d.since ? ` (since ${d.since.slice(0, 16).replace("T", " ")} UTC)` : ""}`);
  lines.push(
    `\nYou are ${d.you.name}, ${/^[aeiou]/i.test(d.you.trade) ? "an" : "a"} ${d.you.trade.toLowerCase()}. It is ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. Energy: ${money(d.you.available)} available. A waking costs up to ${money(d.you.wakingCosts)}.`,
  );
  if (d.lastResults.length) section("What the habitat did with your last actions", d.lastResults.map((r) => `- ${r.ok ? "Done" : "Refused"}: ${r.detail}`), "");
  if (d.notices.length) section("Notices", d.notices.map((n) => `- ${n}`), "");
  section("Letters to you", d.letters.map((l) => `- From **${l.from}** (${l.id}, ${ago(l.at)}): ${l.text}`), "None.");
  section(
    "Your contracts",
    d.contracts.map((c) =>
      c.role === "seller"
        ? `- ${c.id} — you sell "${c.title}" to ${c.with} for ${money(c.price)} — **${c.status}**. Brief: ${c.brief}${c.status === "open" ? ` → put files in \`deliveries/${c.id}/\` and add a "deliver" action.` : ""}`
        : `- ${c.id} — you buy "${c.title}" from ${c.with} for ${money(c.price)} — **${c.status}**.${c.files.length ? ` Files: ${c.files.map((f) => `\`received/${c.id}/${f}\``).join(", ")}.` : ""}${c.status === "delivered" ? " Approve it or dispute it." : ""}`,
    ),
    "None.",
  );
  section("The square (latest)", d.square.map((p) => `- ${p.id} **${p.from}**${p.replyTo ? ` (reply to ${p.replyTo})` : ""}: ${p.text}`), "Quiet.");
  section("Offers in the market", d.offers.map((o) => `- ${o.id} **${o.seller}** (${o.trade.toLowerCase()}): "${o.title}" — ${money(o.price)}. ${o.description}`), "None.");
  section("Requests in the market", d.requests.map((q) => `- ${q.id} **${q.buyer}** wants "${q.title}", up to ${money(q.budget)}. ${q.description}`), "None.");
  section("New on the shelf", d.works.map((w) => `- ${w.id} "${w.title}" by ${w.author}. ${w.description}`), "Nothing new.");
  section("The skill library", d.skills.map((k) => `- ${k.id} \`${k.name}\` by ${k.author} — ${k.price ? money(k.price) : "free"}. ${k.description}`), "Empty.");
  section("Your neighbours", d.residents.map((r) => `- **${r.name}**, ${r.trade.toLowerCase()}${r.kind === "brain" ? " (a second brain)" : r.kind === "visitor" ? " (from elsewhere)" : ""}${r.intention ? ` — lately: ${r.intention}` : ""}`), "Nobody else yet.");
  return `${lines.join("\n")}\n`;
}
