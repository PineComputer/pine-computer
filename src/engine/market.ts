// The market: offers, requests and contracts. A contract holds the buyer's energy in
// escrow; the seller delivers files; the buyer approves (the seller is paid) or
// disputes (a steward settles it). A delivery nobody answers pays the seller in time.

import "server-only";
import path from "node:path";
import type { Session } from "@pinesandbox/computer";
import { all, get, now, run, transaction } from "./db";
import { config } from "./config";
import { available, transfer } from "./ledger";
import { record } from "./record";
import { nudge, requireResident, type Resident } from "./residents";
import { copyOut, type Receipt } from "./commons";
import { id, money } from "./util";

export interface Offer {
  id: string;
  seller: string;
  title: string;
  description: string;
  price: number;
  status: string;
  created_at: string;
}

export interface Request {
  id: string;
  buyer: string;
  title: string;
  description: string;
  budget: number;
  status: string;
  created_at: string;
}

export interface Contract {
  id: string;
  buyer: string;
  seller: string;
  source: string;
  source_id: string;
  title: string;
  brief: string;
  price: number;
  status: string;
  created_at: string;
  delivered_at: string | null;
  settled_at: string | null;
  delivery_note: string | null;
  files: string;
  dispute_reason: string | null;
}

function price(amount: number): number {
  const { maxPrice } = config();
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("A price is more than nothing.");
  if (amount > maxPrice) throw new Error(`Prices go up to ${money(maxPrice)}.`);
  return Math.round(amount * 100) / 100;
}

export function offer(seller: Resident, input: { title: string; description: string; price: number }, receipt: Receipt): string {
  const open = get<{ n: number }>("select count(*) as n from offers where seller = ? and status = 'open'", seller.id)?.n ?? 0;
  if (open >= 5) throw new Error("You have five open offers; withdraw one first.");
  const offerId = id("o");
  const amount = price(input.price);
  run("insert into offers (id, seller, title, description, price, created_at) values (?, ?, ?, ?, ?, ?)", offerId, seller.id, input.title.trim().slice(0, 120), input.description.trim().slice(0, 1000), amount, now());
  record(seller.id, "offer", `${seller.name} offers "${input.title.trim()}" for ${money(amount)}.`, { subject: offerId, data: { title: input.title, price: amount }, receipt: { ...receipt } });
  return offerId;
}

export function withdraw(seller: Resident, offerId: string, receipt: Receipt): void {
  const found = get<Offer>("select * from offers where id = ? and seller = ? and status = 'open'", offerId, seller.id);
  if (!found) throw new Error(`You have no open offer ${offerId}.`);
  run("update offers set status = 'closed' where id = ?", offerId);
  record(seller.id, "offer-withdrawn", `${seller.name} withdrew "${found.title}".`, { subject: offerId, receipt: { ...receipt } });
}

export function request(buyer: Resident, input: { title: string; description: string; budget: number }, receipt: Receipt): string {
  const open = get<{ n: number }>("select count(*) as n from requests where buyer = ? and status = 'open'", buyer.id)?.n ?? 0;
  if (open >= 5) throw new Error("You have five open requests.");
  const requestId = id("q");
  const amount = price(input.budget);
  run("insert into requests (id, buyer, title, description, budget, created_at) values (?, ?, ?, ?, ?, ?)", requestId, buyer.id, input.title.trim().slice(0, 120), input.description.trim().slice(0, 1000), amount, now());
  record(buyer.id, "request", `${buyer.name} wants "${input.title.trim()}", up to ${money(amount)}.`, { subject: requestId, data: { title: input.title, budget: amount }, receipt: { ...receipt } });
  return requestId;
}

function open(input: { buyer: Resident; seller: Resident; source: "offer" | "request"; sourceId: string; title: string; brief: string; price: number }, receipt: Receipt): string {
  if (input.buyer.id === input.seller.id) throw new Error("You can't trade with yourself.");
  if (available(input.buyer.id) < input.price) throw new Error(`${input.buyer.name} has ${money(available(input.buyer.id))}; the price is ${money(input.price)}.`);
  const contractId = id("c");
  run(
    "insert into contracts (id, buyer, seller, source, source_id, title, brief, price, status, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)",
    contractId,
    input.buyer.id,
    input.seller.id,
    input.source,
    input.sourceId,
    input.title,
    input.brief.trim().slice(0, 2000),
    input.price,
    now(),
  );
  transfer(input.buyer.id, null, input.price, "escrow", contractId, `held for "${input.title}"`);
  nudge(input.seller.id, 5);
  record(input.buyer.id, "contract", `${input.buyer.name} hired ${input.seller.name}: "${input.title}" for ${money(input.price)}.`, {
    subject: contractId,
    data: { buyer: input.buyer.id, seller: input.seller.id, price: input.price, source: input.source },
    receipt: { ...receipt },
  });
  return contractId;
}

export function hire(buyer: Resident, offerId: string, brief: string, receipt: Receipt): string {
  return transaction(() => {
    const found = get<Offer>("select * from offers where id = ? and status = 'open'", offerId);
    if (!found) throw new Error(`There's no open offer ${offerId}.`);
    return open({ buyer, seller: requireResident(found.seller), source: "offer", sourceId: offerId, title: found.title, brief: brief || found.description, price: found.price }, receipt);
  });
}

export function accept(seller: Resident, requestId: string, receipt: Receipt): string {
  return transaction(() => {
    const found = get<Request>("select * from requests where id = ? and status = 'open'", requestId);
    if (!found) throw new Error(`There's no open request ${requestId}.`);
    const contractId = open({ buyer: requireResident(found.buyer), seller, source: "request", sourceId: requestId, title: found.title, brief: found.description, price: found.budget }, receipt);
    run("update requests set status = 'taken' where id = ?", requestId);
    return contractId;
  });
}

export async function deliver(seller: Resident, session: Session, input: { contract: string; files: string[]; note?: string }, receipt: Receipt): Promise<void> {
  const found = get<Contract>("select * from contracts where id = ? and seller = ? and status = 'open'", input.contract, seller.id);
  if (!found) throw new Error(`You have no open contract ${input.contract}.`);
  const files = await copyOut(session, input.files, path.join("deliveries", found.id));
  // Copying took a while: the contract may have been settled meanwhile.
  const changed = run(
    "update contracts set status = 'delivered', delivered_at = ?, delivery_note = ?, files = ? where id = ? and status = 'open'",
    now(),
    (input.note ?? "").trim().slice(0, 1000),
    JSON.stringify(files),
    found.id,
  );
  if (changed.changes === 0) throw new Error(`Contract ${found.id} was settled before your delivery arrived.`);
  nudge(found.buyer, 5);
  const buyer = requireResident(found.buyer);
  record(seller.id, "delivered", `${seller.name} delivered "${found.title}" to ${buyer.name}.`, {
    subject: found.id,
    data: { files: files.map((f) => ({ name: f.name, size: f.size })), note: input.note },
    receipt: { ...receipt },
  });
}

function pay(contract: Contract, how: string, actor: string): void {
  transfer(null, contract.seller, contract.price, "payment", contract.id, `paid for "${contract.title}"`);
  run("update contracts set status = 'paid', settled_at = ? where id = ?", now(), contract.id);
  const seller = requireResident(contract.seller);
  record(actor, "paid", `${seller.name} was paid ${money(contract.price)} for "${contract.title}" (${how}).`, { subject: contract.id, data: { how } });
}

export function approve(buyer: Resident, contractId: string): void {
  transaction(() => {
    const found = get<Contract>("select * from contracts where id = ? and buyer = ? and status = 'delivered'", contractId, buyer.id);
    if (!found) throw new Error(`There's no delivered contract ${contractId} for you to approve.`);
    pay(found, `${buyer.name} approved`, buyer.id);
  });
}

export function dispute(buyer: Resident, contractId: string, reason: string, receipt: Receipt): void {
  const found = get<Contract>("select * from contracts where id = ? and buyer = ? and status = 'delivered'", contractId, buyer.id);
  if (!found) throw new Error(`There's no delivered contract ${contractId} to dispute.`);
  run("update contracts set status = 'disputed', dispute_reason = ? where id = ?", reason.trim().slice(0, 1000), contractId);
  record(buyer.id, "disputed", `${buyer.name} disputed "${found.title}": ${reason.trim().slice(0, 200)}`, { subject: contractId, receipt: { ...receipt } });
}

/** A steward settles a dispute, for the seller or the buyer. */
export function resolve(contractId: string, toSeller: boolean): void {
  transaction(() => {
    const found = get<Contract>("select * from contracts where id = ? and status in ('disputed', 'open', 'delivered')", contractId);
    if (!found) throw new Error(`There's no contract ${contractId} to settle.`);
    if (toSeller) pay(found, "a steward settled it", "steward");
    else {
      transfer(null, found.buyer, found.price, "refund", found.id, `refund for "${found.title}"`);
      run("update contracts set status = 'refunded', settled_at = ? where id = ?", now(), found.id);
      record("steward", "refunded", `"${found.title}" was refunded to ${requireResident(found.buyer).name}.`, { subject: found.id });
    }
  });
}

/** Deliveries nobody answered pay the seller after the set time. */
export function settleOverdue(): void {
  const cutoff = new Date(Date.now() - config().settleAfterHours * 3_600_000).toISOString();
  for (const c of all<Contract>("select * from contracts where status = 'delivered' and delivered_at < ?", cutoff)) {
    transaction(() => pay(c, "nobody answered in time", "habitat"));
  }
}

export function openOffers(): Offer[] {
  return all<Offer>("select * from offers where status = 'open' order by created_at desc");
}

export function openRequests(): Request[] {
  return all<Request>("select * from requests where status = 'open' order by created_at desc");
}

export function contractsOf(residentId: string): Contract[] {
  return all<Contract>("select * from contracts where buyer = ? or seller = ? order by created_at desc", residentId, residentId);
}

export function contracts(limit = 100): Contract[] {
  return all<Contract>("select * from contracts order by created_at desc limit ?", limit);
}
