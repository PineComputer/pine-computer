"use client";

// The front page: say what to check, or start from a suggestion; under it, every run
// this workspace kept.

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { brand } from "@/brand";
import { host, open, tally, working, type RunView } from "@/shared/api";
import { call } from "../common/api";
import { ago } from "../common/format";
import { useWorkspace } from "./Workspace";

/** First runs to offer: public practice sites built for testing, whose login pages publish their own test users. */
const SUGGESTIONS = [
  {
    label: "A store with known defects",
    target: "https://www.saucedemo.com",
    checks: [
      "Sign in as problem_user (password secret_sauce; the login page publishes both).",
      "Every product on the inventory page shows its own picture.",
      "Adding the Backpack and the Bike Light makes the cart badge read 2.",
      "Sorting by price, low to high, puts the cheapest product first.",
    ],
  },
  {
    label: "The same store, a healthy user",
    target: "https://www.saucedemo.com",
    checks: [
      "Sign in as standard_user (password secret_sauce; the login page publishes both).",
      "Add the Backpack and the Bike Light to the cart; the cart lists both.",
      "Check out as Ada Tester, postcode 94107; the item total plus tax equals the total.",
      "Finish the order; the confirmation page thanks the customer.",
    ],
  },
  {
    label: "A page of practice cases",
    target: "https://the-internet.herokuapp.com",
    checks: [
      "The Broken Images page shows three pictures and none of them is broken.",
      "On Form Authentication, signing in as tomsmith (password SuperSecretPassword!; the page publishes both) reaches the secure area.",
      "Signing in with a wrong password shows an error message.",
    ],
  },
];

/** A run's key: its record, its session's name and its idempotency key. */
export const newKey = () => `r-${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

export function Home() {
  const { ws, act } = useWorkspace();
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [checks, setChecks] = useState("");
  const [busy, setBusy] = useState(false);
  const going = ws.runs.find(open);

  const start = async (to: string, what: string) => {
    setBusy(true);
    const key = newKey();
    const started = await act(() => call("/api/runs", { body: { key, target: to, checks: what } }));
    setBusy(false);
    if (started) router.push(`/r/${key}`);
  };

  return (
    <main className="home">
      <div className="home-in">
        <header className="home-head">
          <h1>What should it check?</h1>
          <p>{brand.tagline}</p>
        </header>

        <form
          className="ask-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (target.trim() && checks.trim() && !busy) void start(target, checks);
          }}
        >
          <label className="field-row">
            <span className="label">Target</span>
            <input className="mono" name="target" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="https://your-app.example" autoComplete="off" spellCheck={false} />
          </label>
          <label className="field-row tall">
            <span className="label">Check</span>
            <textarea
              name="checks"
              rows={4}
              value={checks}
              onChange={(event) => setChecks(event.target.value)}
              placeholder={"Sign in, add two items to the cart, check out.\nThe totals must add up."}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit();
              }}
            />
          </label>
          <div className="ask-foot">
            <small>{going ? "A run is going. The next one starts when it ends." : "It asks before it submits a payment or sends anything real."}</small>
            <button className="btn primary lg" disabled={busy || Boolean(going) || !target.trim() || !checks.trim()}>
              Run the checks <ArrowRight />
            </button>
          </div>
        </form>

        {ws.runs.length === 0 ? (
          <section className="rows">
            <h2 className="label">Try it on a practice site</h2>
            <ul className="tries">
              {SUGGESTIONS.map((s) => (
                <li key={s.label}>
                  <button className="try" disabled={busy} onClick={() => void start(s.target, s.checks.join("\n"))}>
                    <small>{s.label}</small>
                    <b className="mono">{host(s.target)}</b>
                    <span>{s.checks.slice(1).join(" ")}</span>
                    <i className="go">
                      <ArrowRight />
                    </i>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="rows">
            <h2 className="label">Runs</h2>
            <ul className="runs">
              {ws.runs.map((run) => (
                <li key={run.id}>
                  <RunRow run={run} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

function RunRow({ run }: { run: RunView }) {
  const count = tally(run.findings);
  const state = working(run) ? "Checking" : run.state === "needs_input" ? "Waiting for you" : run.state === "completed" ? null : run.state === "canceled" ? "Stopped" : run.state === "failed" ? "Did not run" : "Stopped";
  return (
    <Link href={`/r/${run.id}`} className="run-row">
      <i className="verdict" data-status={working(run) ? "working" : run.state === "needs_input" ? "asking" : count.failed ? "failed" : count.checks ? "passed" : "none"} />
      <b className="mono">{host(run.target)}</b>
      <span className="what">{run.checks.split("\n")[0]}</span>
      <span className="count" data-failed={count.failed > 0 || undefined}>
        {state ? `${state}${count.checks ? ` · ${count.words}` : ""}` : count.words}
      </span>
      <time>{ago(Date.parse(run.askedAt))}</time>
    </Link>
  );
}
