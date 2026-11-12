# Pine Drama Studio

A studio for makers of AI vertical short dramas, built on [Pine Computer](https://pinecomputer.io).
Drop in a screenplay; Pine's agents, each on its own Computer, make the bible, the cast,
the storyboards, the takes and the cut, many episodes at once. You review and decide
where they ask: the leads' looks, every episode's storyboards, takes with dialogue, and
every cut. Everything they return stays in the studio's library.

Design: [docs/PROPOSAL.md](docs/PROPOSAL.md). Build plan and the rules the flow keeps:
[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## Run it

You need Node.js 24.

```sh
npm install
npm run dev          # the engine on 127.0.0.1:4310 and the UI on http://127.0.0.1:5173
```

Open the link the engine prints (`Open http://127.0.0.1:5173/api/open?ticket=…`). The
studio answers only windows that came in through it, so other programs and web pages on
the machine can't use your project. In development the link stays the same across
restarts; the desktop app will open it for you.

On first run the studio asks for your Pine project's API key (Project → API keys in the
Pine console). It checks the key with Pine, then keeps it sealed; nothing needs editing.
The project needs Pine's drama skill; any drama can instead be rehearsed (see Develop).
Settings changes or forgets the key, and forgetting it first stops every Computer the
project has running for the studio. When something goes wrong, Settings → Troubleshooting
saves a diagnostics file to send Pine: the engine's log (`logs/engine.log` in the data
folder) and the state of your dramas with Pine's ids, never the key or your files.

What you drop on New drama is source material: the screenplay in any format (a Word or
PDF screenplay goes to the agent as its text, with the file beside it), and any notes or
brief of your own. You mark the screenplay and choose a preset template; the studio reads
the screenplay's structure (its scene and episode headings, not its dialogue) to tell
drama-cli whether it is written the Chinese or the English way. What you set in New drama
(title, template, format, episode length) is final wherever your files say otherwise. **Your reviews** sets how much you approve yourself: every step, the
cast and the cuts, or none; the studio approves the rest as the agent stops for it, and
you can change it on the drama's page. Pine bills the agents' turns and, separately,
generated video by the minute; the agents aren't told about cost, and the drama's page
shows what it and each episode have spent so far.

Where things are kept:

- **Data:** the system's place for app data: `~/Library/Application Support/Pine Drama Studio`
  on macOS, `%APPDATA%\Pine Drama Studio` on Windows, `$XDG_DATA_HOME/pine-drama-studio` on
  Linux. `npm run dev` uses the repository's `.data/` instead, so development never touches
  an installed studio's data. One engine runs per data folder.
- **The sealing key** for the API key and Computer credentials: the macOS Keychain, the
  Secret Service on Linux, or, in the desktop app on Windows, Electron's safeStorage. Where
  none is available, a file in the data folder only your account can read.

Or choose **replay**: recorded turns and placeholder pictures and video, so every screen
works with no project and no spend, and **Start the sample drama** sets one up in a click.
Replay Computers live in memory, so restarting the engine stops them the way a real stop
would: their episodes show **Resume**.

For development, these override what the app saves:

| Variable | |
| --- | --- |
| `PINE_SANDBOX_API_KEY`, `PINE_SANDBOX_ENDPOINT` | Use this project instead of the saved one. |
| `PINE_SANDBOX_CONTROL_HOST` | The SDK's `controlHost`, for a Pine run locally (PineSandbox's `./pine dev`). |
| `STUDIO_MODE=replay` | Start in replay. |
| `STUDIO_REPLAY_SPEED` | Play the replay faster, e.g. `4`. |
| `STUDIO_DATA_DIR` | Records and library. `npm run dev` sets `.data/`. |
| `STUDIO_PORT` | The engine's port on 127.0.0.1. Default 4310; `0` takes any free port. |

Put them in `.env.local` and `npm run dev` reads it.

## Desktop app

```sh
npm run desktop      # builds the UI, the engine and the shell, then opens the app
npm run package      # installers in release/: dmg and zip on macOS (Apple silicon and Intel), NSIS on Windows, AppImage on Linux
```

The app is the same engine and UI in Electron (`desktop/main.ts`). The engine runs in a
utility process on a free port with a token made for this launch, and the app opens its
own window with it, so there is no link to open. One copy runs at a time. On macOS the
studio's bar is the window's title bar, the dock badge counts the reviews waiting, and
closing the window keeps the line running until you quit.
`python3 scripts/icon.py` draws the icon.

**Checks and releases.** Every pull request runs the tests and starts the packaged app on
Linux (`.github/workflows/ci.yml`). A release is a version bump: run
`npm version minor --no-git-tag-version` (or `patch`) in a pull request, and merging it runs
`.github/workflows/release.yml`. It checks again, makes a draft release `v<version>` pinned to
the merged commit, builds macOS (signed and notarized, for Apple silicon and Intel), Windows
and Linux into it, checks that every installer and update manifest is there and matches
(`scripts/verify-release.mjs`), and publishes it. A merge that keeps a released version only
runs the checks.

**Updates.** The app checks the releases when it starts and every hour
(`desktop/updates.ts`). It downloads a new version in the background and puts it in place
when you quit; a notification says when it's ready, and clicking it restarts into it at
once. On macOS it offers, at first start, to move itself to Applications, where it can
replace itself. What the updater does goes to `logs/desktop.log`, which the diagnostics file
includes.

**Signing.** The release workflow signs and notarizes macOS with the repository secrets it
lists, and fails without them. Locally, `npm run package` does the same given a Developer ID
Application certificate (`CSC_LINK` and `CSC_KEY_PASSWORD`, or `CSC_NAME`) and an App Store
Connect API key (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`); without them it signs
ad hoc (`electron-builder.config.mjs`). An ad-hoc copy that was downloaded or sent through a
chat app opens only once you allow it (open it, then System Settings → Privacy & Security →
Open Anyway), and when a new version is out it says so and opens the download page, since
macOS won't let an ad-hoc app replace itself. Windows builds aren't signed yet, so
SmartScreen warns on the first install; updates install without asking.

## How it fits together

```text
UI (React, Vite)  ── HTTP + one event stream ──▶  engine (Node, 127.0.0.1)  ── server SDK ──▶  Pine Computers
                                                   scheduler · follower · reviews · library (SQLite + files)
```

- `src/engine/scheduler.ts` starts each drama's setup, then fills free sessions from the episode
  queue (episodes at once, episodes per Computer, at most four waiting for you), and raises a
  Computer's idle timeout to three hours while one of its sessions waits on you.
- `src/engine/follow.ts` follows every turn and saves its files before its question can be answered.
- `src/engine/reviews.ts` turns questions into reviews and your decision into one answer, quoting you.
- `src/engine/goals.ts` holds the plain-language goals the studio gives Pine's agent.
- `src/ui/screens/Review.tsx` is the review room: filmstrip, notes pinned to a spot or a time, approve or revise.

## Develop

```sh
npm run check        # typecheck and tests, including the whole flow in replay mode
npm run pine:check   # the studio's Pine calls against your real project (see below)
npm run build        # the UI into dist/ui, which the engine then serves itself
```

Test in this order; each step costs more and catches what the one before can't:

1. **`npm run check`**, on every change. The scheduler, reviews and flow run against the
   replay, with failures injected (lost Creates, a busy project, turns that break off).
2. **Replay in `npm run dev`**, for screens and the flow by hand, at no cost.
3. **`npm run pine:check`**, after changing how the studio talks to Pine, after an SDK
   upgrade, and against a new project or endpoint. It goes through the engine's own Pine
   layer: it creates a Computer, gives two sessions files (with Chinese names), runs three
   small plain-language turns (one asks a question and gets an answer), hands a folder packed
   in parts from one session to the other the way pre-production hands the project to
   episodes, then stops the Computer, starts it again from its saved credentials, and
   recovers it as if its binding were lost. It needs no drama skill, takes a few minutes,
   and Pine bills the turns, a few cents. It also reads the project's lifecycle (idle timeout
   and running time per start), sets the studio's idle timeouts and reads them back, and says
   whether the project offers the drama skill.
4. **A rehearsal on your Pine project**, with or without the drama skill. New drama offers
   it on any Pine project (checked when a Computer has said the skill is missing), a drama
   held for want of the skill offers **Rehearse instead**, and the Slate rehearses the
   sample drama in a click. The goals are the real ones, with Pine's agent standing in for
   the skill through `fixtures/rehearsal/standin.py`, a small kit that draws placeholder
   looks, plates, storyboards and 9:16 clips where the skill would. Everything else is
   real: Computers, sessions, stops and reviews, decisions, the handoff between Computers,
   resumes, the project's limits. Pine bills the Computers and turns; a 10-episode
   rehearsal costs about a dollar of turns.
5. **Your Pine project in `npm run dev`** with the drama skill: the real thing, billed at
   Pine's rates.

## License

[Apache-2.0](LICENSE), like Pine's SDKs.
