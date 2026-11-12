// What the observatory shows, shaped once on the server. Types live in shared/views.

import "server-only";
import { all, get } from "./db";
import { config } from "./config";
import { available, balance, history, worldCommitted } from "./ledger";
import { contracts, contractsOf, openOffers, openRequests } from "./market";
import { events } from "./record";
import { residents, requireResident } from "./residents";
import { homeState } from "./homes";
import { episodesOf, isRunning } from "./episodes";
import { TRADES, trade } from "./trades";
import type { ContractView, EventView, ResidentDetail, ResidentSummary, SkillView, WorkView, WorldView, PostView, OfferView, RequestView, Picture } from "@/shared/views";

const IMAGE = /\.(svg|png|jpe?g|webp|gif)$/i;

/** The newer of a resident's last browser screen and its latest image work. */
function picture(residentId: string): Picture | null {
  const screen = get<{ frame: string; at: string; intention: string }>(
    "select frame, started_at as at, intention from episodes where resident_id = ? and frame is not null order by started_at desc limit 1",
    residentId,
  );
  let work: (Picture & { at: string }) | null = null;
  for (const w of all<{ title: string; files: string; created_at: string }>("select title, files, created_at from works where author = ? order by created_at desc limit 20", residentId)) {
    const image = (JSON.parse(w.files) as { name: string; stored: string }[]).find((f) => IMAGE.test(f.name));
    if (image) {
      work = { kind: "work", url: `/api/files/${image.stored}`, title: w.title, at: w.created_at };
      break;
    }
  }
  if (screen && (!work || screen.at > work.at)) return { kind: "screen", url: `/api/files/${screen.frame}`, title: screen.intention };
  return work ? { kind: work.kind, url: work.url, title: work.title } : null;
}

const nameMap = () => new Map(residents().map((r) => [r.id, r]));

export function summaries(): ResidentSummary[] {
  return residents().map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    trade: r.trade,
    tradeTitle: trade(r.trade).title,
    color: r.color,
    status: r.status,
    intention: r.intention,
    awake: isRunning(r.id) || homeState(r.id) === "running",
    home: homeState(r.id),
    lastWakeAt: r.last_wake_at,
    nextWakeAt: r.next_wake_at,
    available: available(r.id),
    picture: picture(r.id),
  }));
}

const toEvent = (e: ReturnType<typeof events>[number]): EventView => ({ id: e.id, at: e.at, actor: e.actor, kind: e.kind, subject: e.subject, summary: e.summary, data: e.data, receipt: e.receipt });

export function world(): WorldView {
  const cfg = config();
  const committed = worldCommitted();
  const highlights = events({
    limit: 40,
    kinds: ["work", "skill-shared", "skill-adopted", "contract", "delivered", "paid", "move-in", "letter", "post", "offer", "request", "disputed"],
  }).map(toEvent);
  return {
    residents: summaries(),
    highlights,
    pulse: {
      awake: summaries().filter((r) => r.awake).length,
      spentToday: committed.spent,
      reservedNow: committed.reserved,
      dayBudget: cfg.dayBudget,
      works: get<{ n: number }>("select count(*) as n from works")?.n ?? 0,
      contractsPaid: get<{ n: number }>("select count(*) as n from contracts where status = 'paid'")?.n ?? 0,
      skillsShared: get<{ n: number }>("select count(*) as n from library")?.n ?? 0,
    },
    paused: cfg.paused,
    config: cfg,
    trades: TRADES.map((t) => ({ id: t.id, title: t.title, summary: t.summary })),
  };
}

export function contractView(c: ReturnType<typeof contracts>[number], names = nameMap()): ContractView {
  return {
    id: c.id,
    buyer: names.get(c.buyer)?.name ?? "?",
    seller: names.get(c.seller)?.name ?? "?",
    title: c.title,
    brief: c.brief,
    price: c.price,
    status: c.status,
    createdAt: c.created_at,
    deliveredAt: c.delivered_at,
    settledAt: c.settled_at,
    note: c.delivery_note,
    disputeReason: c.dispute_reason,
    files: (JSON.parse(c.files) as { name: string; stored: string; size: number }[]).map((f) => ({ name: f.name, url: `/api/files/${f.stored}`, size: f.size })),
  };
}

export function marketView(): { offers: OfferView[]; requests: RequestView[]; contracts: ContractView[] } {
  const names = nameMap();
  return {
    offers: openOffers().map((o) => ({ id: o.id, seller: names.get(o.seller)?.name ?? "?", sellerTrade: trade(names.get(o.seller)?.trade ?? "scribe").title, title: o.title, description: o.description, price: o.price, createdAt: o.created_at })),
    requests: openRequests().map((q) => ({ id: q.id, buyer: names.get(q.buyer)?.name ?? "?", title: q.title, description: q.description, budget: q.budget, createdAt: q.created_at })),
    contracts: contracts(100).map((c) => contractView(c, names)),
  };
}

export function posts(limit = 100): PostView[] {
  const names = nameMap();
  return all<{ id: string; author: string; kind: string; recipient: string | null; reply_to: string | null; text: string; created_at: string; episode_id: string | null }>(
    "select * from posts order by created_at desc limit ?",
    limit,
  ).map((p) => ({ id: p.id, author: names.get(p.author)?.name ?? "?", kind: p.kind, to: p.recipient ? (names.get(p.recipient)?.name ?? "?") : null, replyTo: p.reply_to, text: p.text, at: p.created_at, episode: p.episode_id }));
}

export function shelf(limit = 100, authorId?: string): WorkView[] {
  const names = nameMap();
  const rows = authorId
    ? all<{ id: string; author: string; title: string; description: string; files: string; created_at: string }>("select * from works where author = ? order by created_at desc limit ?", authorId, limit)
    : all<{ id: string; author: string; title: string; description: string; files: string; created_at: string }>("select * from works order by created_at desc limit ?", limit);
  return rows.map((w) => ({
    id: w.id,
    author: names.get(w.author)?.name ?? "?",
    title: w.title,
    description: w.description,
    at: w.created_at,
    files: (JSON.parse(w.files) as { name: string; stored: string; size: number }[]).map((f) => ({ name: f.name, url: `/api/files/${f.stored}`, size: f.size })),
  }));
}

export function library(): SkillView[] {
  const names = nameMap();
  const adopted = all<{ library_id: string; resident_id: string; installed_version: number | null; created_at: string }>(
    "select library_id, resident_id, installed_version, created_at from adoptions order by created_at",
  );
  return all<{ id: string; author: string; name: string; version: number; description: string; body: string; price: number; derived_from: string | null; created_at: string }>(
    "select * from library order by created_at desc",
  ).map((k) => ({
    id: k.id,
    author: names.get(k.author)?.name ?? "?",
    name: k.name,
    version: k.version,
    description: k.description,
    body: k.body,
    price: k.price,
    derivedFrom: k.derived_from,
    at: k.created_at,
    adoptedBy: adopted.filter((a) => a.library_id === k.id).map((a) => ({ name: names.get(a.resident_id)?.name ?? "?", installed: (a.installed_version ?? 0) > 0, at: a.created_at })),
  }));
}

export function residentDetail(idOrName: string): ResidentDetail {
  const r = requireResident(idOrName);
  const summary = summaries().find((s) => s.id === r.id)!;
  const names = nameMap();
  return {
    ...summary,
    temperament: r.temperament,
    persona: r.persona,
    note: r.note,
    createdAt: r.created_at,
    balance: balance(r.id),
    tradeSummary: trade(r.trade).summary,
    episodes: episodesOf(r.id, 40).map((e) => ({
      id: e.id,
      kind: e.kind,
      goal: e.goal,
      startedAt: e.started_at,
      endedAt: e.ended_at,
      state: e.state,
      intention: e.intention,
      cost: e.cost,
      summary: e.summary,
      journal: e.journal,
      frame: e.frame ? `/api/files/${e.frame}` : null,
      results: JSON.parse(e.results),
      error: e.error,
    })),
    works: shelf(50, r.id),
    contracts: contractsOf(r.id).map((c) => contractView(c, names)),
    ledger: history(r.id, 60),
    skillsShared: library().filter((k) => k.author === r.name),
    skillsAdopted: library().filter((k) => k.adoptedBy.some((a) => a.name === r.name)),
    events: events({ actor: r.id, limit: 60 }).map(toEvent),
  };
}

export function recordView(after?: number, limit = 200): EventView[] {
  return events({ after, limit }).map(toEvent);
}
