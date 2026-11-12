// Walks the portal the way the agent will: sign in, find the order, file a claim, review, submit,
// and checks the staff view saw it. Then resets the demo.
//   PORTAL_URL=… PORTAL_STAFF_KEY=… PLAYWRIGHT=… CHROMIUM=… node scripts/smoke.mjs [screenshot dir]
const base = process.env.PORTAL_URL ?? "https://larkspur-care-demo.19pine.workers.dev";
const key = process.env.PORTAL_STAFF_KEY;
const shots = process.argv[2];
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright-core");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
let n = 0;
const shot = async (name) => shots && (await page.screenshot({ path: `${shots}/${String(++n).padStart(2, "0")}-${name}.png`, fullPage: true }));
const expect = (ok, what) => {
  if (!ok) throw new Error(`smoke: ${what}`);
  console.log("ok", what);
};

if (key) await fetch(`${base}/staff/reset?key=${key}`, { method: "POST", redirect: "manual" });
await page.goto(`${base}/orders`);
expect(page.url().includes("/sign-in"), "orders redirects to sign-in when signed out");
await shot("sign-in");
await page.fill("#email", "jordan.lee@example.com");
await page.fill("#password", "wrong");
await page.click("button.primary");
expect((await page.textContent(".flash")).includes("don't match"), "a wrong password is refused");
await page.fill("#password", process.env.PORTAL_PASSWORD ?? "AeroPure-2026");
await page.click("button.primary");
expect(page.url().endsWith("/orders"), "sign-in returns to the page asked for");
await shot("orders");
await page.click('a[href="/orders/LK-20260302-1187"]');
await shot("order");
await page.goto(`${base}/claims/new?order=LK-20240614-0921`);
expect((await page.textContent("h1")).includes("isn't covered"), "an expired order can't be claimed");
await page.goto(`${base}/orders/LK-20260302-1187`);
await page.click("text=Start a warranty claim");
await page.selectOption("#issue", "Won't power on");
await page.fill("#description", "Stopped turning on two days ago; the power light doesn't come on.");
await page.fill("#serial", "12345");
await page.check('input[value="Replacement"]');
await page.check('input[name="confirm"]');
await page.click("button.primary");
expect((await page.textContent(".flash")).includes("fix"), "a malformed serial number is refused");
await shot("form-error");
await page.fill("#serial", "AP3-4471-9026");
await Promise.all([page.waitForURL(/\/claims\/review\//), page.click("button.primary")]);
expect(page.url().includes("/claims/review/"), "a complete form goes to review");
await shot("review");
await Promise.all([page.waitForURL(/\/claims\/LC-\d{6}/), page.click("button:has-text(\"Submit claim\")")]);
const number = (await page.textContent("h1")).match(/LC-\d{6}/)?.[0];
expect(!!number, `submitting gives a claim number (${number})`);
await shot("confirmation");
if (key) {
  const state = await (await fetch(`${base}/staff/api/state?key=${key}`)).json();
  expect(state.claims.some((c) => c.number === number && c.serial === "AP3-4471-9026"), "the staff view has the claim");
  await page.goto(`${base}/staff?key=${key}`);
  await shot("staff");
  await fetch(`${base}/staff/reset?key=${key}`, { method: "POST", redirect: "manual" });
}
await browser.close();
