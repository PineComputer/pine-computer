// The demo's synthetic world: one customer, their orders, the warranty rule. Nothing here is real.

export const CUSTOMER = {
  name: "Jordan Lee",
  first: "Jordan",
  email: "jordan.lee@example.com",
  phone: "(415) 555-0142",
  address: ["1824 Alder Street", "Apt 3", "Portland, OR 97214"],
};

export const PRODUCTS = {
  "AP3": { name: "Larkspur AeroPure 300 Air Purifier", short: "AeroPure 300", warrantyMonths: 12, serialPattern: /^AP3-\d{4}-\d{4}$/, serialExample: "AP3-0000-0000", claimable: true },
  "FLT2": { name: "AeroPure HEPA Filter, 2-pack", short: "HEPA filter 2-pack", warrantyMonths: 0, claimable: false },
  "BRZ": { name: "Larkspur Breeze 16\" Tower Fan", short: "Breeze tower fan", warrantyMonths: 12, serialPattern: /^BRZ-\d{4}-\d{4}$/, serialExample: "BRZ-0000-0000", claimable: true },
};

export const ORDERS = [
  { id: "LK-20260302-1187", date: "2026-03-02", product: "AP3", price: 249.0, qty: 1, ship: "Delivered Mar 5, 2026" },
  { id: "LK-20251109-0442", date: "2025-11-09", product: "FLT2", price: 39.0, qty: 1, ship: "Delivered Nov 12, 2025" },
  { id: "LK-20240614-0921", date: "2024-06-14", product: "BRZ", price: 89.0, qty: 1, ship: "Delivered Jun 18, 2024" },
];

export const ISSUES = ["Won't power on", "Fan noise or rattling", "Air quality sensor error", "Display or buttons not working", "Other"];
export const RESOLUTIONS = ["Replacement", "Repair"];

export const order = (id) => ORDERS.find((o) => o.id === id);

/** The last day of cover: the day before the anniversary of purchase, `months` later. */
export function coverEnds(o) {
  const p = PRODUCTS[o.product];
  if (!p.warrantyMonths) return null;
  const d = new Date(`${o.date}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + p.warrantyMonths);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function inWarranty(o, today = new Date().toISOString().slice(0, 10)) {
  const end = coverEnds(o);
  return !!end && today <= end;
}

export const money = (n) => `$${n.toFixed(2)}`;
export function day(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
