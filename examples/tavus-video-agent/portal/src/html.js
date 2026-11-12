// The portal's pages: a plain, slightly old-fashioned support site, the kind an agent meets in real work.

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const LEAF = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M20.5 3.5c-7.6.2-13.4 3.2-15.6 8.6-1 2.4-.9 4.9.2 7l-1.6 1.6 1.1 1.1 1.6-1.6c2.1 1.1 4.6 1.2 7-.2 5.4-2.2 8.4-8 8.6-15.6l.1-1-1.4.1Zm-8.2 13.9c-1.8.7-3.6.7-5.1 0l6.3-6.3-1.1-1.1-6.3 6.3c-.7-1.5-.7-3.3 0-5.1 1.7-4.2 6.1-6.8 12.4-7.2-.4 6.3-3 10.7-6.2 13.4Z"/></svg>`;

export function page({ title, user, body, flash, active = "" }) {
  const nav = user
    ? `<nav>
        <a href="/account" class="${active === "account" ? "on" : ""}">My account</a>
        <a href="/orders" class="${active === "orders" ? "on" : ""}">Orders</a>
        <a href="/claims" class="${active === "claims" ? "on" : ""}">Warranty claims</a>
        <a href="/warranty">Warranty policy</a>
        <form method="post" action="/sign-out"><button class="link">Sign out</button></form>
      </nav>`
    : `<nav><a href="/warranty">Warranty policy</a><a href="/sign-in">Sign in</a></nav>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Larkspur Care</title>
<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/portal.css">
</head><body>
<header class="top"><div class="wrap">
  <a class="brand" href="/">${LEAF}<span>Larkspur <b>Care</b></span></a>
  ${nav}
</div></header>
${user ? `<div class="strip"><div class="wrap">Signed in as <b>${esc(user.name)}</b> · ${esc(user.email)}</div></div>` : ""}
<main class="wrap">
${flash ? `<div class="flash ${esc(flash.kind)}">${esc(flash.text)}</div>` : ""}
${body}
</main>
<footer class="wrap">Larkspur Home Appliances · Support Center · <a href="/warranty">Limited warranty</a> · This is a demonstration site with synthetic data.</footer>
</body></html>`;
}

export const field = ({ label, name, value = "", type = "text", hint = "", required = false, attrs = "", error = "" }) => `
  <label class="field${error ? " bad" : ""}"><span>${esc(label)}${required ? ' <i class="req">*</i>' : ""}</span>
    <input type="${type}" name="${esc(name)}" id="${esc(name)}" value="${esc(value)}" ${required ? "required" : ""} ${attrs}>
    ${hint ? `<small>${esc(hint)}</small>` : ""}${error ? `<em>${esc(error)}</em>` : ""}
  </label>`;

export const select = ({ label, name, options, value = "", required = false, error = "" }) => `
  <label class="field${error ? " bad" : ""}"><span>${esc(label)}${required ? ' <i class="req">*</i>' : ""}</span>
    <select name="${esc(name)}" id="${esc(name)}" ${required ? "required" : ""}>
      <option value="">Select…</option>
      ${options.map((o) => `<option${o === value ? " selected" : ""}>${esc(o)}</option>`).join("")}
    </select>${error ? `<em>${esc(error)}</em>` : ""}
  </label>`;
