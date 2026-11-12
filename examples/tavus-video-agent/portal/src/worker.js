// Larkspur Care: a synthetic warranty-support portal for the Tavus × Pine Computer demo.
// The agent signs in, finds the order, reads the warranty PDF, files a claim (which needs a
// serial number only the customer has), stops on the review page for approval, and submits.
// One Durable Object keeps sign-ins, drafts and claims; /staff shows them and resets the demo.

import { DurableObject } from "cloudflare:workers";
import { CUSTOMER, ISSUES, ORDERS, PRODUCTS, RESOLUTIONS, coverEnds, day, inWarranty, money, order } from "./data.js";
import { esc, field, page, select } from "./html.js";

const COOKIE = "lc_session";
const MONTH = 60 * 60 * 24 * 30;

export class Store extends DurableObject {
  async state() {
    return (await this.ctx.storage.get("state")) ?? { epoch: 1, mfa: false, sessions: {}, pending: {}, drafts: {}, claims: [] };
  }
  async save(s) {
    await this.ctx.storage.put("state", s);
  }
  async read() {
    return this.state();
  }
  async session(token) {
    const s = await this.state();
    const found = token && s.sessions[token];
    return found && found.epoch === s.epoch ? found : null;
  }
  async signIn(remember) {
    const s = await this.state();
    const token = crypto.randomUUID();
    s.sessions[token] = { email: CUSTOMER.email, epoch: s.epoch, at: new Date().toISOString(), remember };
    await this.save(s);
    return token;
  }
  async signOut(token) {
    const s = await this.state();
    delete s.sessions[token];
    await this.save(s);
  }
  /** A sign-in that still needs its code; the code is what the staff page shows as "sent". */
  async challenge(remember) {
    const s = await this.state();
    const id = crypto.randomUUID();
    const code = String(100000 + Math.floor(Math.random() * 900000));
    s.pending = { [id]: { code, remember, at: Date.now() } };
    s.lastCode = { code, at: new Date().toISOString() };
    await this.save(s);
    return id;
  }
  async verify(id, code) {
    const s = await this.state();
    const p = s.pending[id];
    if (!p || Date.now() - p.at > 10 * 60 * 1000) return { error: "That code has expired. Sign in again." };
    if (p.code !== code.trim()) return { error: "That code isn't right. Check the text message and try again." };
    delete s.pending[id];
    await this.save(s);
    return { token: await this.signIn(p.remember) };
  }
  async saveDraft(values, id) {
    const s = await this.state();
    id ||= crypto.randomUUID().slice(0, 8);
    s.drafts[id] = { ...values, at: new Date().toISOString() };
    await this.save(s);
    return id;
  }
  async draft(id) {
    return (await this.state()).drafts[id] ?? null;
  }
  async submit(id) {
    const s = await this.state();
    const d = s.drafts[id];
    if (!d) return null;
    const existing = s.claims.find((c) => c.draft === id);
    if (existing) return existing.number;
    const number = `LC-${String(Math.floor(Math.random() * 900000) + 100000)}`;
    s.claims.unshift({ number, draft: id, ...d, submittedAt: new Date().toISOString(), status: `Approved · ${d.resolution.toLowerCase()}` });
    delete s.drafts[id];
    await this.save(s);
    return number;
  }
  async staff(action) {
    const s = await this.state();
    if (action === "reset") Object.assign(s, { drafts: {}, claims: [], pending: {} });
    if (action === "signout") Object.assign(s, { epoch: s.epoch + 1, sessions: {}, pending: {} });
    if (action === "mfa-on") s.mfa = true;
    if (action === "mfa-off") s.mfa = false;
    await this.save(s);
  }
}

// ---------- helpers ----------

const store = (env) => env.STORE.get(env.STORE.idFromName("main"));
const html = (body, status = 200, headers = {}) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers } });
const go = (to, headers = {}) => new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store", ...headers } });
const cookieOf = (req) => Object.fromEntries((req.headers.get("cookie") ?? "").split(/;\s*/).filter(Boolean).map((c) => c.split("=").map(decodeURIComponent)))[COOKIE];
const setCookie = (token, remember) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax${remember ? `; Max-Age=${MONTH}` : ""}`;
const form = async (req) => Object.fromEntries((await req.formData()).entries());
const productOf = (o) => PRODUCTS[o.product];
const crumbs = (...parts) => `<p class="crumbs">${parts.map(([t, h]) => (h ? `<a href="${h}">${esc(t)}</a>` : esc(t))).join(" › ")}</p>`;

function coverText(o) {
  const p = productOf(o);
  if (!p.warrantyMonths) return { ok: false, text: "Not covered · consumable part" };
  const end = coverEnds(o);
  return inWarranty(o) ? { ok: true, text: `In warranty · covered until ${day(end)}` } : { ok: false, text: `Warranty expired ${day(end)}` };
}

// ---------- pages ----------

function signInPage({ error, next = "", email = "" } = {}) {
  return page({
    title: "Sign in",
    body: `<section class="card narrow">
      <h1>Sign in to Larkspur Care</h1>
      <p class="muted">Track orders, register products and file warranty claims.</p>
      ${error ? `<div class="flash bad">${esc(error)}</div>` : ""}
      <form method="post" action="/sign-in" class="stack">
        <input type="hidden" name="next" value="${esc(next)}">
        ${field({ label: "Email address", name: "email", type: "email", value: email, required: true, attrs: 'autocomplete="username"' })}
        ${field({ label: "Password", name: "password", type: "password", required: true, attrs: 'autocomplete="current-password"' })}
        <label class="check"><input type="checkbox" name="remember" checked> Keep me signed in on this device</label>
        <button class="primary">Sign in</button>
      </form>
      <p class="muted small">Forgot your password? Call 1-800-555-0199 (demo).</p>
    </section>`,
  });
}

function verifyPage({ id, error }) {
  return page({
    title: "Verify it's you",
    body: `<section class="card narrow">
      <h1>Verify it's you</h1>
      <p>We sent a 6-digit code to the phone number on your account, ${esc(CUSTOMER.phone.replace(/\d{3}-(\d{4})$/, "***-$1"))}.</p>
      ${error ? `<div class="flash bad">${esc(error)}</div>` : ""}
      <form method="post" action="/verify" class="stack">
        <input type="hidden" name="id" value="${esc(id)}">
        ${field({ label: "Verification code", name: "code", required: true, attrs: 'inputmode="numeric" autocomplete="one-time-code" maxlength="6"' })}
        <button class="primary">Verify</button>
      </form>
    </section>`,
  });
}

function accountPage(user, s) {
  const open = s.claims.length;
  return page({
    title: "My account", user, active: "account",
    body: `<h1>Welcome back, ${esc(CUSTOMER.first)}</h1>
    <div class="grid3">
      <a class="tile" href="/orders"><b>Orders</b><span>${ORDERS.length} orders · receipts and product details</span></a>
      <a class="tile" href="/claims"><b>Warranty claims</b><span>${open ? `${open} claim${open > 1 ? "s" : ""} on file` : "No claims on file"}</span></a>
      <a class="tile" href="/warranty"><b>Warranty policy</b><span>What's covered, and how to file a claim</span></a>
    </div>
    <section class="card"><h2>Account details</h2>
      <dl class="dl"><dt>Name</dt><dd>${esc(CUSTOMER.name)}</dd><dt>Email</dt><dd>${esc(CUSTOMER.email)}</dd><dt>Phone</dt><dd>${esc(CUSTOMER.phone)}</dd><dt>Shipping address</dt><dd>${CUSTOMER.address.map(esc).join("<br>")}</dd></dl>
    </section>`,
  });
}

function ordersPage(user) {
  return page({
    title: "Orders", user, active: "orders",
    body: `${crumbs(["My account", "/account"], ["Orders"])}<h1>Your orders</h1>
    <table class="table"><thead><tr><th>Order</th><th>Date</th><th>Item</th><th>Total</th><th>Warranty</th><th></th></tr></thead><tbody>
    ${ORDERS.map((o) => {
      const c = coverText(o);
      return `<tr><td class="mono">${o.id}</td><td>${day(o.date)}</td><td>${esc(productOf(o).name)}</td><td>${money(o.price)}</td><td><span class="pill ${c.ok ? "ok" : "no"}">${esc(c.text)}</span></td><td><a href="/orders/${o.id}">View order</a></td></tr>`;
    }).join("")}
    </tbody></table>`,
  });
}

function orderPage(user, o) {
  const p = productOf(o);
  const c = coverText(o);
  return page({
    title: `Order ${o.id}`, user, active: "orders",
    body: `${crumbs(["My account", "/account"], ["Orders", "/orders"], [o.id])}
    <h1>Order ${o.id}</h1>
    <section class="card">
      <dl class="dl">
        <dt>Item</dt><dd>${esc(p.name)} × ${o.qty}</dd>
        <dt>Purchased</dt><dd>${day(o.date)}</dd>
        <dt>Total</dt><dd>${money(o.price)}</dd>
        <dt>Delivery</dt><dd>${esc(o.ship)}</dd>
        <dt>Serial number</dt><dd>${p.claimable ? `<span class="muted">Not registered.</span> You'll need it to file a claim: it's on the label under the base (${esc(p.serialExample.replace(/0/g, "#"))}).` : "—"}</dd>
        <dt>Warranty</dt><dd><span class="pill ${c.ok ? "ok" : "no"}">${esc(c.text)}</span></dd>
      </dl>
      <div class="row">
        <a class="button" href="/receipts/${o.id}.pdf">Download receipt (PDF)</a>
        ${p.claimable ? `<a class="button primary" href="/claims/new?order=${o.id}">Start a warranty claim</a>` : ""}
      </div>
    </section>`,
  });
}

function claimForm(user, o, v = {}, errors = {}) {
  const p = productOf(o);
  return page({
    title: "New warranty claim", user, active: "claims",
    body: `${crumbs(["Orders", "/orders"], [o.id, `/orders/${o.id}`], ["New warranty claim"])}
    <h1>New warranty claim</h1>
    <p class="muted">Step 1 of 2 · Claim details. You can review everything before you submit.</p>
    ${Object.keys(errors).length ? `<div class="flash bad">Please fix the highlighted fields.</div>` : ""}
    <form method="post" action="/claims/new" class="card stack">
      <input type="hidden" name="order" value="${o.id}"><input type="hidden" name="draft" value="${esc(v.draft ?? "")}">
      <div class="readonly"><span>Product</span><b>${esc(p.name)}</b><small>Order ${o.id} · purchased ${day(o.date)}</small></div>
      ${select({ label: "What's wrong?", name: "issue", options: ISSUES, value: v.issue, required: true, error: errors.issue })}
      <label class="field${errors.description ? " bad" : ""}"><span>Describe the problem <i class="req">*</i></span>
        <textarea name="description" id="description" rows="3" required>${esc(v.description ?? "")}</textarea>
        <small>When did it start, and what happens when you try to use it?</small>${errors.description ? `<em>${esc(errors.description)}</em>` : ""}</label>
      ${field({ label: "Serial number", name: "serial", value: v.serial, required: true, hint: `On the label under the base, for example ${p.serialExample.replace(/0/g, "#")}.`, error: errors.serial, attrs: 'autocomplete="off"' })}
      <fieldset class="field${errors.resolution ? " bad" : ""}"><span>Preferred resolution <i class="req">*</i></span>
        <div class="radios">${RESOLUTIONS.map((r) => `<label><input type="radio" name="resolution" value="${r}"${v.resolution === r ? " checked" : ""}> ${r}</label>`).join("")}</div>
        ${errors.resolution ? `<em>${esc(errors.resolution)}</em>` : ""}</fieldset>
      <label class="field${errors.address ? " bad" : ""}"><span>Return shipping address <i class="req">*</i></span>
        <textarea name="address" id="address" rows="3" required>${esc(v.address ?? CUSTOMER.address.join("\n"))}</textarea>${errors.address ? `<em>${esc(errors.address)}</em>` : ""}</label>
      ${field({ label: "Contact phone", name: "phone", value: v.phone ?? CUSTOMER.phone, required: true })}
      <label class="check${errors.confirm ? " bad" : ""}"><input type="checkbox" name="confirm"${v.confirm ? " checked" : ""}> I confirm this information is accurate.</label>
      <div class="row"><a class="button" href="/orders/${o.id}">Cancel</a><button class="primary">Continue to review</button></div>
    </form>`,
  });
}

function validate(v) {
  const o = order(v.order);
  const errors = {};
  if (!o || !productOf(o).claimable) errors.order = "This order can't be claimed.";
  else if (!inWarranty(o)) errors.order = "This order is outside its warranty period.";
  if (!ISSUES.includes(v.issue)) errors.issue = "Choose what's wrong.";
  if ((v.description ?? "").trim().length < 10) errors.description = "Tell us a little more (at least 10 characters).";
  const serial = (v.serial ?? "").trim().toUpperCase();
  if (o && !productOf(o).serialPattern?.test(serial)) errors.serial = `Enter the serial number as it appears on the label (${productOf(o).serialExample?.replace(/0/g, "#")}).`;
  if (!RESOLUTIONS.includes(v.resolution)) errors.resolution = "Choose replacement or repair.";
  if ((v.address ?? "").trim().length < 10) errors.address = "Enter a full address.";
  if (!v.confirm) errors.confirm = "Confirm the information is accurate.";
  return { errors, clean: { order: v.order, issue: v.issue, description: (v.description ?? "").trim(), serial, resolution: v.resolution, address: (v.address ?? "").trim(), phone: (v.phone ?? "").trim(), confirm: !!v.confirm } };
}

function reviewPage(user, id, d) {
  const o = order(d.order);
  return page({
    title: "Review your claim", user, active: "claims",
    body: `${crumbs(["Orders", "/orders"], [o.id, `/orders/${o.id}`], ["Review"])}
    <h1>Review your claim</h1>
    <div class="flash warn">Not submitted yet. Check the details, then choose <b>Submit claim</b>.</div>
    <section class="card">
      <dl class="dl">
        <dt>Product</dt><dd>${esc(productOf(o).name)}</dd><dt>Order</dt><dd class="mono">${o.id} · ${day(o.date)}</dd>
        <dt>Problem</dt><dd>${esc(d.issue)}<br><span class="muted">${esc(d.description)}</span></dd>
        <dt>Serial number</dt><dd class="mono">${esc(d.serial)}</dd><dt>Resolution</dt><dd>${esc(d.resolution)}</dd>
        <dt>Return address</dt><dd>${esc(d.address).replace(/\n/g, "<br>")}</dd><dt>Phone</dt><dd>${esc(d.phone)}</dd>
      </dl>
      <form method="post" action="/claims/submit/${id}" class="row">
        <a class="button" href="/claims/edit/${id}">Edit</a><button class="primary">Submit claim</button>
      </form>
    </section>`,
  });
}

function claimPage(user, c, fresh) {
  const o = order(c.order);
  return page({
    title: `Claim ${c.number}`, user, active: "claims",
    flash: fresh ? { kind: "good", text: `Claim submitted. We've emailed a confirmation to ${CUSTOMER.email}.` } : null,
    body: `${crumbs(["Warranty claims", "/claims"], [c.number])}
    <h1>Claim <span class="mono">${esc(c.number)}</span></h1>
    <section class="card">
      <dl class="dl">
        <dt>Status</dt><dd><span class="pill ok">${esc(c.status)}</span></dd><dt>Submitted</dt><dd>${new Date(c.submittedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" })} PT</dd>
        <dt>Product</dt><dd>${esc(productOf(o).name)} · <span class="mono">${esc(c.serial)}</span></dd><dt>Problem</dt><dd>${esc(c.issue)}</dd>
        <dt>Next steps</dt><dd>Print the prepaid return label and drop the unit at any UPS location within 14 days. ${c.resolution === "Replacement" ? "Your replacement ships within 5 business days of drop-off." : "Repairs take 7–10 business days from drop-off."}</dd>
      </dl>
      <div class="row"><a class="button primary" href="/claims/${esc(c.number)}/label">Return label</a><a class="button" href="/claims">All claims</a></div>
    </section>`,
  });
}

function claimsPage(user, s) {
  return page({
    title: "Warranty claims", user, active: "claims",
    body: `${crumbs(["My account", "/account"], ["Warranty claims"])}<h1>Warranty claims</h1>
    ${s.claims.length ? `<table class="table"><thead><tr><th>Claim</th><th>Product</th><th>Submitted</th><th>Status</th><th></th></tr></thead><tbody>
      ${s.claims.map((c) => `<tr><td class="mono">${esc(c.number)}</td><td>${esc(productOf(order(c.order)).short)}</td><td>${day(c.submittedAt.slice(0, 10))}</td><td><span class="pill ok">${esc(c.status)}</span></td><td><a href="/claims/${esc(c.number)}">View</a></td></tr>`).join("")}
    </tbody></table>` : `<section class="card"><p>No claims yet. To file one, open the order from <a href="/orders">Orders</a> and choose <b>Start a warranty claim</b>.</p></section>`}`,
  });
}

function labelPage(c) {
  const o = order(c.order);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Return label ${esc(c.number)}</title><link rel="stylesheet" href="/portal.css"></head>
  <body class="label"><div class="lbl">
    <div class="lbl-h"><b>PREPAID RETURN · UPS GROUND</b><span>Larkspur Care</span></div>
    <div class="lbl-r"><small>FROM</small>${esc(CUSTOMER.name)}<br>${esc(c.address).replace(/\n/g, "<br>")}</div>
    <div class="lbl-r"><small>TO</small>Larkspur Returns Center<br>4400 Industrial Way, Dock 7<br>Reno, NV 89502</div>
    <div class="lbl-bar" aria-hidden="true"></div>
    <div class="lbl-f"><span>Claim <b>${esc(c.number)}</b></span><span>${esc(productOf(o).short)} · ${esc(c.serial)}</span></div>
  </div></body></html>`;
}

function warrantyPage(user) {
  return page({
    title: "Warranty policy", user,
    body: `<h1>Larkspur Limited Warranty</h1>
    <section class="card"><p>Every Larkspur appliance comes with a limited warranty against defects in materials and workmanship. The full terms, including what's covered, how long, and what you'll need to file a claim, are in the warranty document.</p>
    <div class="row"><a class="button primary" href="/docs/larkspur-limited-warranty.pdf">Read the Limited Warranty (PDF)</a></div></section>`,
  });
}

function staffPage(s, key) {
  const k = encodeURIComponent(key);
  const btn = (action, label) => `<form method="post" action="/staff/${action}?key=${k}"><button>${label}</button></form>`;
  return page({
    title: "Staff",
    body: `<h1>Staff console <span class="muted small">(demo control)</span></h1>
    <section class="card"><h2>Sign-in</h2>
      <p>Signed-in devices: <b>${Object.values(s.sessions).filter((x) => x.epoch === s.epoch).length}</b> · Verification code at sign-in: <b>${s.mfa ? "required" : "off"}</b>${s.lastCode ? ` · Last code sent: <b class="mono big">${esc(s.lastCode.code)}</b>` : ""}</p>
      <div class="row">${btn(s.mfa ? "mfa-off" : "mfa-on", s.mfa ? "Turn verification off" : "Require a verification code")}${btn("signout", "Sign out every device")}</div>
    </section>
    <section class="card"><h2>Claims (${s.claims.length})</h2>
      ${s.claims.length ? `<table class="table"><thead><tr><th>Claim</th><th>Order</th><th>Serial</th><th>Issue</th><th>Resolution</th><th>Submitted</th></tr></thead><tbody>${s.claims.map((c) => `<tr><td class="mono">${esc(c.number)}</td><td class="mono">${esc(c.order)}</td><td class="mono">${esc(c.serial)}</td><td>${esc(c.issue)}</td><td>${esc(c.resolution)}</td><td>${esc(c.submittedAt)}</td></tr>`).join("")}</tbody></table>` : "<p>No claims.</p>"}
      <p>Drafts in progress: ${Object.keys(s.drafts).length}</p>
      <div class="row">${btn("reset", "Reset claims and drafts")}</div>
    </section>`,
  });
}

// ---------- routing ----------

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const db = store(env);
    const token = cookieOf(req);
    const session = await db.session(token);
    const user = session && { name: CUSTOMER.name, email: CUSTOMER.email };
    const need = () => go(`/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`);

    // staff: demo control, behind STAFF_KEY
    if (path.startsWith("/staff")) {
      const key = url.searchParams.get("key") ?? "";
      if (!env.STAFF_KEY || key !== env.STAFF_KEY) return html(page({ title: "Not found", body: "<h1>Not found</h1>" }), 404);
      if (path === "/staff/api/state") {
        const s = await db.read();
        return Response.json({ mfa: s.mfa, lastCode: s.lastCode ?? null, signedIn: Object.values(s.sessions).filter((x) => x.epoch === s.epoch).length, drafts: Object.keys(s.drafts).length, claims: s.claims }, { headers: { "cache-control": "no-store" } });
      }
      if (req.method === "POST") {
        await db.staff(path.slice("/staff/".length));
        return go(`/staff?key=${encodeURIComponent(key)}`);
      }
      return html(staffPage(await db.read(), key));
    }

    if (path === "/") return user ? go("/account") : html(signInPage());
    if (path === "/warranty") return html(warrantyPage(user));

    if (path === "/sign-in") {
      if (req.method === "GET") return user ? go(url.searchParams.get("next") || "/account") : html(signInPage({ next: url.searchParams.get("next") ?? "" }));
      const f = await form(req);
      const next = f.next?.startsWith("/") ? f.next : "/account";
      if (f.email?.trim().toLowerCase() !== CUSTOMER.email || f.password !== (env.DEMO_PASSWORD || "AeroPure-2026"))
        return html(signInPage({ error: "That email and password don't match our records.", next: f.next, email: f.email }), 401);
      const remember = !!f.remember;
      if ((await db.read()).mfa) return go(`/verify?id=${encodeURIComponent(await db.challenge(remember))}&next=${encodeURIComponent(next)}`);
      return go(next, { "set-cookie": setCookie(await db.signIn(remember), remember) });
    }
    if (path === "/verify") {
      if (req.method === "GET") return html(verifyPage({ id: url.searchParams.get("id") ?? "" }));
      const f = await form(req);
      const r = await db.verify(f.id ?? "", f.code ?? "");
      if (r.error) return html(verifyPage({ id: f.id, error: r.error }), 401);
      const s = (await db.read()).sessions[r.token];
      return go(url.searchParams.get("next") || "/account", { "set-cookie": setCookie(r.token, s?.remember) });
    }
    if (path === "/sign-out" && req.method === "POST") {
      if (token) await db.signOut(token);
      return go("/sign-in", { "set-cookie": `${COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax` });
    }

    if (!user) return need();
    if (path === "/account") return html(accountPage(user, await db.read()));
    if (path === "/orders") return html(ordersPage(user));
    let m;
    if ((m = path.match(/^\/orders\/([\w-]+)$/))) {
      const o = order(m[1]);
      return o ? html(orderPage(user, o)) : html(page({ title: "Not found", user, body: "<h1>Order not found</h1>" }), 404);
    }
    if (path === "/claims") return html(claimsPage(user, await db.read()));
    if (path === "/claims/new") {
      if (req.method === "GET") {
        const o = order(url.searchParams.get("order"));
        if (!o) return go("/orders");
        if (!inWarranty(o)) return html(page({ title: "Not covered", user, body: `<h1>This order isn't covered</h1><section class="card"><p>${esc(productOf(o).name)} (order ${o.id}): ${esc(coverText(o).text)}.</p><p><a href="/orders">Back to orders</a></p></section>` }), 409);
        return html(claimForm(user, o));
      }
      const v = await form(req);
      const o = order(v.order);
      if (!o) return go("/orders");
      const { errors, clean } = validate(v);
      if (Object.keys(errors).length) return html(claimForm(user, o, { ...v, draft: v.draft }, errors), 422);
      return go(`/claims/review/${await db.saveDraft(clean, v.draft)}`);
    }
    if ((m = path.match(/^\/claims\/edit\/(\w+)$/))) {
      const d = await db.draft(m[1]);
      return d ? html(claimForm(user, order(d.order), { ...d, draft: m[1] })) : go("/claims");
    }
    if ((m = path.match(/^\/claims\/review\/(\w+)$/))) {
      const d = await db.draft(m[1]);
      return d ? html(reviewPage(user, m[1], d)) : go("/claims");
    }
    if ((m = path.match(/^\/claims\/submit\/(\w+)$/)) && req.method === "POST") {
      const number = await db.submit(m[1]);
      return number ? go(`/claims/${number}?submitted=1`) : go("/claims");
    }
    if ((m = path.match(/^\/claims\/(LC-\d{6})(\/label)?$/))) {
      const c = (await db.read()).claims.find((x) => x.number === m[1]);
      if (!c) return html(page({ title: "Not found", user, body: "<h1>Claim not found</h1>" }), 404);
      return html(m[2] ? labelPage(c) : claimPage(user, c, url.searchParams.has("submitted")));
    }
    return html(page({ title: "Not found", user, body: "<h1>Page not found</h1>" }), 404);
  },
};
