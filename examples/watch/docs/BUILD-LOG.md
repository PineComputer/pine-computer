# Build log

Wall-clock times from `date`, November 13, 2026, PST.

## Functional build

| time | what |
|---|---|
| 17:03:56 | Start. Read the starter's server code, the SDK guides and types. |
| 17:05:10 | A probe script ran one check on a real Computer to learn the timings and shapes: create 4.0 s, the turn 14 s, `stop()` 12 s, start again 5.4 s; a picture of the screen arrives in `agent.events()` as WebP, 1911 × 954. |
| 17:14:22 | Server, routes and page written; typecheck and tests pass; the server runs on port 3130. |
| 17:14:44 | First watch created in the product ("The top story on Hacker News"). Its first check ended at 17:15:06 with a reading and a picture, and the worker stopped the Computer. |
| 17:17:27 | "Check now" on a second watch (Hacker News, newest) found the first real change, with before and after screens. |
| 17:19:22 – 17:25:08 | A watch on a page behind a sign-in (`the-internet.herokuapp.com/secure`, a public test site). The agent asked; the controls were taken in the page, the test account signed in on the Computer's screen, the controls handed back; the check finished with its reading. |
| 17:29:48, 17:30:12 | The worker made the first two scheduled checks (due 17:29:44 and 17:30:00) with no page open. Both found a real change. |

## Design polish

| time | what |
|---|---|
| 17:17 – 17:33 | Between the runs above: close-ups that trim a page's blank margins, the 16:9 live screen that fades in over the last kept screen once the browser is open, only browser steps shown as the step, the dark theme, whole-minute times for interval watches. |
| 17:33:00 | `npm run check` and `npm run build` pass. |

## Checking, and the scheduled checks

| time | what |
|---|---|
| 17:35:23 | Production build started on a fresh data directory. Watch 1 (Hacker News, top story, every 15 minutes) created; first check 17:35:23 – 17:35:43. |
| 17:35:45 | Watch 2 (BBC News, lead headline, every 15 minutes) created; first check ended 17:36:26. Paused at 17:36:35. |
| 17:37:00 | One more change to the close-up's scale; rebuilt and restarted while the Computer was stopped. |
| 17:38:35 | An icon added (the page asked for one); rebuilt and restarted while the Computer was stopped. |
| 17:49:35 – 17:50:23 | Waited for the schedule. **Scheduled check 1** of watch 1: due 17:50:00, started by the worker at 17:50:00, ended 17:50:23, found a real change ("Amtrak booking system experiencing major issues amid nationwide FAA ground stop" to "FAA issues national ground stop"), with before and after screens. The Computer had been stopped since 17:36:40. Watch 2, paused, was due at 17:50:00 too and was not checked. |
| 17:50:46 | Watch 2 resumed: its next check moved to 18:05. |
| 17:50:47 – 17:51:06 | "Check now" on watch 1: no change, shown as "checked by hand". The Computer stopped again. |
| 17:56 – 18:01 | Take 2 of the film dropped (below); its watch deleted. A watch on the sign-in test page: the question, then "Skip this check" (canceled), then the watch deleted. |
| 18:01:52 | A check's question no longer shows the empty reading the agent may append to it; `npm run check` and `npm run build` pass; restarted while the Computer was stopped. **No product code changed after this.** |
| 18:05:00 – 18:05:44 | **Scheduled check 2** of watch 1, 15 minutes after the first: due 18:05:00, started 18:05:00, ended 18:05:21, a real change ("FAA issues national ground stop" to "FAA lifted National Ground Stop at 0119Z"). Watch 2's resumed check ran after it (18:05:24 – 18:05:44, changed). The Computer was stopped from 17:51 to 18:05:00 and stopped again after. |
| 18:20:00 – 18:20:42 | Scheduled checks 3 of watch 1 and 2 of watch 2: both "no change". |
| 18:21:10 – 18:23:31 | The sign-in watch on the final build: asked, controls taken, signed in on the Computer's screen, handed back, reading stored. This check kept no picture (see "Not working"). |
| 18:23:51 | All watches paused, the Computer stopped (confirmed by id at 18:24:07, as was the development Computer), the server stopped. |

Waiting for the schedule, separate from work: 17:38 – 17:50 for the first scheduled check (12 min, partly used for the
recording lock below), 17:51 – 18:05 for the second (14 min, used for the film's first part and the sign-in runs), and
18:02:36 – 18:17:00 for the film's scheduled check (14 min 24 s).

## Filming

| time | what |
|---|---|
| 17:37:42 | Take 1 started as a rehearsal and waited for the recording lock; stopped at 17:38 for the icon rebuild. It left the lock directory behind (taken at 17:38:14, in the same second it was stopped). |
| 17:38:42 – 17:53:22 | **Blocked, 14 min 40 s:** every recorder, mine and another builder's, waited on that orphaned lock until it was traced to take 1 and removed. |
| 17:56:08 – 17:56:37 | Take 2, first part. Dropped: a fourth watch was added from another window in the middle of it. |
| 18:02:08 – 18:02:36 | Take 3, first part: the watch typed and created, its first check (18:02:15 – 18:02:33). |
| 18:16:53 – 18:17:29 | Take 3, second part: the scheduled check, due 18:17:00, started 18:17:00.6, ended 18:17:22, changed. |
| 18:18:40 | Film cut (23.9 s) and delivered with its poster and log. |

## Sites the runs touched

- `news.ycombinator.com` and `news.ycombinator.com/newest` (Hacker News) and `www.bbc.com/news`: real public sites.
- `the-internet.herokuapp.com/secure`: a public test site, signed in with the test account printed on its own page.

## Not working, or not checked

- A check that ends after the person signed in stores its reading but kept no picture in both runs: the agent's
  last turn produced no picture of the screen. The product says "This check kept no picture."
- Whether a sign-in survives a Stop was not tested; the product says it may need repeating.
- A limit on running Computers was never met, so the "waiting for a Computer" state was not seen live.
- A daily cadence (a time of day) is unit-tested but no daily check was waited for.

## End

| time | what |
|---|---|
| 18:24:07 | End. Total 1 h 20 min 11 s from 17:03:56, of which about 41 min was waiting for the schedule and 14 min 40 s was the lock. |
