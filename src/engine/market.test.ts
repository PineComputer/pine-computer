import type { Session } from "@pinesandbox/computer";
import { describe, expect, it } from "vitest";
import { get, run } from "./db";
import { available, balance } from "./ledger";
import { accept, approve, deliver, dispute, request, resolve, settleOverdue } from "./market";
import { moveIn, requireResident } from "./residents";

const receipt = { via: "api" as const };
let next = 0;
const newResident = (trade = "scribe") => requireResident(moveIn({ name: `Market ${String.fromCharCode(65 + next++)}`, kind: "native", trade }).id);

/** A home holding the given files, as far as a delivery reads it. */
const homeWith = (files: Record<string, string>) =>
  ({
    readFile: async (file: string) => {
      if (!(file in files)) throw new Error(`no such file: ${file}`);
      return new TextEncoder().encode(files[file]);
    },
  }) as unknown as Session;

const status = (contractId: string) => get<{ status: string }>("select status from contracts where id = ?", contractId)?.status;

/** A buyer's request taken by a seller: the contract, open with the price in escrow. */
function contract(price = 0.3) {
  const buyer = newResident();
  const seller = newResident("illustrator");
  const requestId = request(buyer, { title: "A badge", description: "A small SVG badge.", budget: price }, receipt);
  return { buyer, seller, contractId: accept(seller, requestId, receipt) };
}

describe("the market", () => {
  it("holds the price in escrow, then pays the seller when the buyer approves", async () => {
    const { buyer, seller, contractId } = contract(0.3);
    expect(available(buyer.id)).toBe(0.7);
    expect(balance(seller.id)).toBe(1);

    await deliver(seller, homeWith({ "deliveries/badge.svg": "<svg/>" }), { contract: contractId, files: ["deliveries/badge.svg"] }, receipt);
    expect(status(contractId)).toBe("delivered");

    approve(buyer, contractId);
    expect(status(contractId)).toBe("paid");
    expect(balance(seller.id)).toBe(1.3);
    expect(balance(buyer.id)).toBe(0.7);
  });

  it("won't let a resident take its own request", () => {
    const buyer = newResident();
    const requestId = request(buyer, { title: "Mine", description: "For me.", budget: 0.2 }, receipt);
    expect(() => accept(buyer, requestId, receipt)).toThrow("You can't trade with yourself.");
  });

  it("won't open a contract the buyer can't pay for, and leaves the request open", () => {
    const buyer = newResident();
    const seller = newResident();
    const requestId = request(buyer, { title: "Costly", description: "Too much.", budget: 0.9 }, receipt);
    run("insert into reservations (id, resident_id, amount, ref, created_at) values ('rsv_test', ?, 0.5, 'ep_x', '')", buyer.id);
    expect(() => accept(seller, requestId, receipt)).toThrow(/the price is \$0\.90/);
    expect(get<{ status: string }>("select status from requests where id = ?", requestId)?.status).toBe("open");
    expect(balance(buyer.id)).toBe(1);
  });

  it("refuses a delivery of files outside the seller's home", async () => {
    const { seller, contractId } = contract();
    await expect(deliver(seller, homeWith({}), { contract: contractId, files: ["../../etc/passwd"] }, receipt)).rejects.toThrow("isn't in your work directory");
    expect(status(contractId)).toBe("open");
  });

  it("refunds the buyer when a steward settles a dispute their way", async () => {
    const { buyer, seller, contractId } = contract(0.4);
    await deliver(seller, homeWith({ "x.txt": "not a badge" }), { contract: contractId, files: ["x.txt"] }, receipt);
    dispute(buyer, contractId, "This isn't a badge.", receipt);
    resolve(contractId, false);
    expect(status(contractId)).toBe("refunded");
    expect(balance(buyer.id)).toBe(1);
    expect(balance(seller.id)).toBe(1);
  });

  it("pays the seller for a delivery nobody answered in time", async () => {
    const { seller, contractId } = contract(0.2);
    await deliver(seller, homeWith({ "a.svg": "<svg/>" }), { contract: contractId, files: ["a.svg"] }, receipt);
    run("update contracts set delivered_at = '2000-01-01T00:00:00.000Z' where id = ?", contractId);
    settleOverdue();
    expect(status(contractId)).toBe("paid");
    expect(balance(seller.id)).toBe(1.2);
  });

  it("won't deliver against a contract settled while the files were copied", async () => {
    const { seller, contractId } = contract();
    const slow = {
      readFile: async () => {
        resolve(contractId, false);
        return new TextEncoder().encode("late");
      },
    } as unknown as Session;
    await expect(deliver(seller, slow, { contract: contractId, files: ["late.txt"] }, receipt)).rejects.toThrow("was settled before your delivery arrived");
    expect(status(contractId)).toBe("refunded");
  });
});
