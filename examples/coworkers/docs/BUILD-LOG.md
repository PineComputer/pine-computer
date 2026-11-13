# Build log

Wall-clock times, from `date`, in PST.

- 2026-11-12 22:08:44 — Start.
- 2026-11-12 22:17:15 — Server done (store, one Computer per coworker, jobs, worker, routes); first job sent to a real Computer through the API.
- 2026-11-12 22:19:07 — Job 1 (researcher, Hacker News) finished on a real Computer: 30 s.
- 2026-11-12 22:26:02 — Interface done (sidebar, conversation, screen, profile, hire, vault). Jobs 2 (PDF attachment) and 3 (approval, answered with Approve in the browser) finished on real Computers.
- 2026-11-12 22:36:30 — Jobs 4 (two coworkers working at once) and 5 (take control mid-job, type, hand back) proven on real Computers.
- 2026-11-12 22:38:27 — Queueing proven: a fourth job on a Computer busy in three threads waited, said so in the thread, and started when one finished.
- 2026-11-12 22:40:38 — "Save as a skill" run three times on finished jobs; the Computer declined to author a skill each time, and the thread shows its reason. A draft, and activating one, were not seen.
- 2026-11-12 22:45:38 — Every state checked in a browser, light and dark; the four screenshots in this folder taken from real jobs.
- 2026-11-12 22:46:56 — All three Computers stopped, each stop confirmed.
- 2026-11-12 22:47:22 — `npm run check` and `npm run build` pass.
- 2026-11-12 22:47:33 — End, before the last commit. Total: 38 min 49 s.

Time blocked on outside things: none. No outage, rate limit or capacity limit was met.

## Later passes

### Design pass

- 2026-11-12 23:28:16 — Start.
- A design system in `globals.css`: paper, ink and hairlines, one green accent, amber kept for "your turn", a real type scale, serif monogram avatars with a slow ring while at work; light by default, dark by system or toggle.
- Layout: the screen is the hero, with a status line above it (what it is doing, elapsed, the Computer's state, Take control) and the trail of screens under it; a stopped Computer shows its last screen, dimmed, with Start.
- The trail: each step's picture of the screen, live from the event stream and kept beside the job afterwards; blank pictures are dropped; a file a job made sits in the trail and opens in place.
- Steps in plain words, folded when the same kind repeats, a live tail while it works, one summary line with the cost when it settles.
- Thread titles by rule from the first message; four threads a coworker in the sidebar, then "N more".
- Small things: no repeated link when a file is attached, image previews, End job beside the reply.
- Save as a skill: moved to `startLearn` with a scaffold so the author's questions reach the thread. On a signed-in portal job the author declined once ("too ambiguous"), then asked for the steps after sign-in; answered in the thread, it registered a draft. The draft was read and activated in the page and shows in the profile; a similar job then ran with it in 40 s where the first took 1 min 23 s.
- Three jobs on real Computers in a fresh workspace: Hacker News (2 min 24 s), a quotes PDF (58 s), and a warranty claim on a signed-in portal with the password from the vault, left at its approval and then declined; the claim was not submitted.
- Every state looked at in a browser at 1600×1000, light and dark, over two rounds of critique; the six screenshots in this folder replaced from those jobs.
- Every Computer stopped, each stop confirmed. `npm run check` and `npm run build` pass.
- 2026-11-13 00:11:00 — End, before the commits. This pass: 42 min 44 s.
