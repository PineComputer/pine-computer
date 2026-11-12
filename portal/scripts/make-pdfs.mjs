// Writes the portal's documents into public/: the Limited Warranty and a receipt per order.
//   PLAYWRIGHT=<path to playwright-core> CHROMIUM=<browser binary> node scripts/make-pdfs.mjs
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CUSTOMER, ORDERS, PRODUCTS, day, money } from "../src/data.js";

const out = fileURLToPath(new URL("../public/", import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright-core");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage();

const shell = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { font: 11pt/1.5 Georgia, "Times New Roman", serif; color: #1d2320; margin: 0; }
  h1 { font: 700 20pt Arial, sans-serif; color: #1f4d3a; margin: 0 0 4pt; }
  h2 { font: 700 12pt Arial, sans-serif; color: #1f4d3a; margin: 16pt 0 4pt; }
  .head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2pt solid #1f4d3a; padding-bottom: 8pt; margin-bottom: 14pt; font-family: Arial, sans-serif; }
  .brand { font: 700 15pt Arial, sans-serif; color: #1f4d3a; } .meta { font: 9pt Arial, sans-serif; color: #5d6762; }
  table { width: 100%; border-collapse: collapse; font: 10pt Arial, sans-serif; } td, th { padding: 6pt 4pt; border-bottom: .5pt solid #c9d1cd; text-align: left; }
  th { font-size: 8.5pt; text-transform: uppercase; color: #5d6762; } .r { text-align: right; } .tot td { font-weight: 700; border-bottom: 0; }
  ul { margin: 4pt 0; padding-left: 16pt; } li { margin: 2pt 0; } .note { font: 9pt Arial, sans-serif; color: #5d6762; margin-top: 18pt; }
</style></head><body>${body}</body></html>`;

const warranty = shell(`
  <div class="head"><span class="brand">Larkspur Home Appliances</span><span class="meta">Limited Warranty · Form LW-2025 · Effective January 1, 2025</span></div>
  <h1>Limited Warranty</h1>
  <p>Larkspur Home Appliances ("Larkspur") warrants its products against defects in materials and workmanship under normal household use, as set out below. This warranty applies to the original purchaser of a product bought new from Larkspur or an authorized retailer.</p>
  <h2>1. How long coverage lasts</h2>
  <table><tr><th>Product</th><th>Coverage period</th></tr>
    <tr><td>AeroPure air purifiers (all models)</td><td>12 months from the original purchase date</td></tr>
    <tr><td>Breeze fans (all models)</td><td>12 months from the original purchase date</td></tr>
    <tr><td>Filters, pre-filters and other consumable parts</td><td>Not covered</td></tr></table>
  <h2>2. What Larkspur will do</h2>
  <p>If a covered product fails during the coverage period, Larkspur will, at its option and taking the customer's stated preference into account, <b>replace</b> the product with a new or equivalent unit or <b>repair</b> it. Larkspur provides a prepaid return label. Replacements ship within 5 business days after the defective unit is dropped off; repairs take 7–10 business days.</p>
  <h2>3. What is not covered</h2>
  <ul><li>Damage from accidents, misuse, power surges, or use not in accordance with the manual</li><li>Commercial or rental use</li><li>Repairs or modifications by anyone other than Larkspur</li><li>Cosmetic wear, scratches and dents</li><li>Products whose serial number label is missing, altered or unreadable</li></ul>
  <h2>4. How to file a claim</h2>
  <p>Sign in to Larkspur Care, open the order under <b>Orders</b>, and choose <b>Start a warranty claim</b>. You will need:</p>
  <ul><li>the order number or proof of purchase;</li><li>the product's <b>serial number</b>, printed on the label under the base (AeroPure 300: <b>AP3-####-####</b>). Serial numbers are not recorded at purchase, so the portal cannot fill this in for you;</li><li>a short description of the problem, and your preferred resolution.</li></ul>
  <p>Claims for in-warranty orders filed through Larkspur Care are approved when submitted. You will receive a claim number and a prepaid return label.</p>
  <h2>5. Limitation</h2>
  <p>This warranty is the only express warranty for Larkspur products. Some states do not allow limitations on implied warranties, so the above may not apply to you. This warranty gives you specific legal rights, and you may have others that vary by state.</p>
  <p class="note">Larkspur Care · 1-800-555-0199 · This document is part of a demonstration with synthetic data.</p>`);

await mkdir(`${out}docs`, { recursive: true });
await page.setContent(warranty);
await page.pdf({ path: `${out}docs/larkspur-limited-warranty.pdf`, format: "Letter", margin: { top: "0.8in", bottom: "0.8in", left: "0.9in", right: "0.9in" } });

await mkdir(`${out}receipts`, { recursive: true });
for (const o of ORDERS) {
  const p = PRODUCTS[o.product];
  await page.setContent(shell(`
    <div class="head"><span class="brand">Larkspur Home Appliances</span><span class="meta">Receipt · Order ${o.id}</span></div>
    <h1>Receipt</h1>
    <table><tr><td><b>Order</b><br>${o.id}<br>Placed ${day(o.date)}</td><td><b>Bill to</b><br>${CUSTOMER.name}<br>${CUSTOMER.address.join("<br>")}</td><td><b>Payment</b><br>Visa ending 4417<br>${o.ship}</td></tr></table>
    <h2>Items</h2>
    <table><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr>
      <tr><td>${p.name}</td><td class="r">${o.qty}</td><td class="r">${money(o.price)}</td><td class="r">${money(o.price * o.qty)}</td></tr>
      <tr><td>Shipping</td><td></td><td></td><td class="r">$0.00</td></tr><tr><td>Sales tax (OR)</td><td></td><td></td><td class="r">$0.00</td></tr>
      <tr class="tot"><td>Total paid</td><td></td><td></td><td class="r">${money(o.price * o.qty)}</td></tr></table>
    <p class="note">${p.warrantyMonths ? `Covered by the Larkspur Limited Warranty for ${p.warrantyMonths} months from the purchase date. Serial numbers are not recorded at purchase: keep the label under the base.` : "Consumable part: not covered by the Limited Warranty."}<br>Larkspur Care · 1-800-555-0199 · Demonstration document with synthetic data.</p>`));
  await page.pdf({ path: `${out}receipts/${o.id}.pdf`, format: "Letter", margin: { top: "0.8in", bottom: "0.8in", left: "0.9in", right: "0.9in" } });
}
await browser.close();
console.log("wrote docs/larkspur-limited-warranty.pdf and", ORDERS.length, "receipts");
