# Implementation plan: MVP

Builds [PROPOSAL.md](PROPOSAL.md) v5. This file is the working plan; it changes as the build teaches us.

## Progress

**Milestone 1 built, 22 October 2026, in replay mode.** The engine and these screens work:
- slate, new drama, board, setup steps;
- inbox with "next review";
- review rooms for questions, looks, storyboards, takes and cuts;
- cast & world, crew, chat;
- Chinese and English.

`npm run check` passes: typecheck, and 12 tests. The tests include the whole flow through the HTTP API:
- the setup question;
- looks, with one revision;
- two episodes on two Computers at once;
- idle timeouts raised to 3 h while waiting;
- EP001 through storyboards, takes and cut;
- EP003 taking the freed slot.

The restart path is checked by hand: lost Computers mark episodes stopped and end their reviews; "continue in a new session" resumes.

**Onboarding and look, same day.**
- No `.env` to edit. The first run asks for the project key, checks it with Pine (`projectPolicy`), and keeps it sealed in the data folder. Replay is one click from there, with a bundled sample screenplay.
- Settings changes or forgets the key; forgetting stops the project's running Computers first.
- No backend is needed for a maker with their own project; one would only serve makers without a Pine project, teams sharing a line, or a later "Sign in with Pine".
- The screens moved to a paper-and-ink studio look: posters with the leads behind the title, a production sheet with each episode's newest frame, a dark viewing room for review.

**Safety and desktop readiness, 23 October 2026,** after an independent review of the code:
- Each drama belongs to the mode it was made in, so connecting Pine never starts paid Computers for a replay drama.
- A Create or Start that fails is retried as the same Computer, with backoff; after three failures the drama says so and waits for "try again". A stop counts only once Pine confirms it, and disconnecting keeps the key if any Computer won't stop.
- A turn's files and the flow's move after it are marked separately, and decisions in flight when the engine stopped are checked against Pine on start. Chat can't answer a review that has files to look at; a cut counts as accepted only with a verdict on it.
- The API needs this launch's token (a cookie from the printed link) and the studio's own origin for changes; returned files can't run scripts in the studio's origin.
- Data lives where each OS keeps app data, one engine per data folder; the sealing key moved to the Keychain or Secret Service; bundled files resolve from the code's location, not the working directory.
- Errors reach the maker as codes the UI words in their language; review drafts survive leaving the page.
- Budget and spend were taken out until we knew where video charges appear (rule 6).

**Desktop app, 23 October 2026.** Electron 44 (Node 24, with `node:sqlite`) around the same engine and UI:
- The engine runs in a utility process on a free port; the shell makes the launch token and opens the window through the engine's link. One copy runs at a time.
- The data folder is the one the engine always uses; Chromium's files go in its `browser` folder. On Windows the sealing key is kept with safeStorage.
- On macOS the bar is the title bar, the dock badge counts waiting reviews, and closing the window keeps the line running.
- `npm run package` builds with electron-builder; the UI, the engine and the shell are bundled, so the app ships no `node_modules`. An unsigned macOS build was opened and ran the sample drama from its own bundled files.

**Pre-production, 23 October 2026.** Parallel episodes now start from one accepted project: the setup session also writes every breakdown and draws every shared look, place and prop, the maker approves them in a "shared references" review, and the session packs the project for the episodes. The board's setup steps show pre-production; breakdowns belong to their episodes once listed, and the review room reads each episode's shot list from them.

**Next: seeing the drama, not only its reviews** (reviewed with Codex, 23 October). Outside a waiting review the maker could not browse an episode, read the bible or breakdowns, see a character's looks together, or download a cut. In order:
1. **Episode page** (`/d/:drama/e/:code`), read only, opened from any board card or row. A segment selector and one viewer; each segment's storyboards and takes as *receipts* (what one turn returned), newest first by arrival, with the maker's verdict on that receipt's review item and a link to the review. A verdict covers the group a review showed, never one file of it; pinned notes show only on their own file. The cut's versions the same way. Every returned file the app doesn't recognise is listed plainly, with a download. Decisions stay in reviews: the page judges nothing, though it offers Resume for a stopped episode as the board does.
2. **Script**: the inputs, the newest bible and each episode's newest breakdown (including pre-production's, before episodes are listed), rendered as documents by a small Markdown subset made of React elements (no HTML injection).
3. **Delivery**: per episode, the latest cut with its own review status, and the accepted cut where it differs: the one cut in the newest approved cut review, or nothing when that review showed several. Downloads per file; a season ZIP waits for a ZIP64-capable streaming writer.
4. **Cast cards**: each character with its base look and states, versions newest first, each with its verdict; then places and props.

Files are reassigned to episodes by the same path reading as everywhere else (`classify`), and the shot-list excerpt matches a segment exactly (`seg01` is not `seg010`).

**On real Pine, before the drama skill, 23 October 2026.** `npm run pine:check` drives the engine's own Pine layer against a project (README, "Develop"); on the staging project every call the studio makes works: create, start from saved credentials, recovery of a Computer whose binding was lost, stop; sessions, attachments with Chinese names, returned files from nested folders, a question answered and followed to the turn it opened, events, and a project packed in parts in one session and restored in another. It found, and the studio now handles:
- **Projects without a lifetime policy**, where a running Computer's idle timeout can't change: the studio starts their Computers with the waiting timeout (3 h) and leaves it.
- **The drama skill missing**: before the setup's first run the studio asks the Computer which skills it offers (`skills.list`); without `drama-workflow` it holds the drama and says so in the maker's language, rather than let the agent improvise a drama at the project's expense. Checked in the app on staging: Computer started, session opened, drama held with no run sent, Computer stopped, in about 20 seconds.
- **Events before a session's first run** answer 404 (no task yet), so the studio follows a session's events only once Pine has its run.

And, from Pine's limits and lifecycle docs: a turn that breaks off (the Computer's services restarted, or the turn ran out of its 60 minutes) now carries on in the same session, where its files still are, within the same bounded "continue" runs as a turn that stopped short, and reaching the maker resets that count; an episode or setup that won't start backs off (15 s, doubling, at most 5 min) and after three tries says why, instead of retrying every tick.

**With lifecycle control, same day**, on a project with a lifetime policy (idle timeout adjustable up to 24 h, 7 days of running time per start, no Pause):
- The idle timeout the studio keeps is the one Pine says it applied; `pine:check` sets the studio's own values (3 h waiting, 1 h working) and reads them back.
- Each start's stop-by time is kept (Pine's `stopAt`, when its graceful Stop begins, twelve minutes before the hard deadline). In the last 6 hours (the last half, on projects whose starts run less than 12) a Computer takes no new session and stops once its sessions close, then starts again with a fresh allowance, so no turn is cut off by the limit. A session already waiting on the maker stays; if Pine stops it, the maker's decision resumes the episode in a new session as before.
- Computers belong to the project they were made in: switching projects never starts the old project's Computers on the new one; the drama gets new ones there.

**Rehearsals on staging, 23 October 2026.** Before the project has the drama skill, a drama can be rehearsed: the same goals, with Pine's agent standing in for the skill through `fixtures/rehearsal/standin.py`, a kit that draws placeholder looks, plates, storyboards and 9:16 clips (Pillow and ffmpeg are on Pine's Computers) where the skill would. Three rounds on staging ran 9 dramas to the end: 61 episodes on 48 Computers, up to 20 at once (the project's limit, with the rest waiting their turn), 544 turns for $4.38 of turns, 456 decisions by a reviewer script and by hand. Every Computer stopped once its drama was done. What they found, now handled:
- **How the agent stops.** Asked to "stop and ask me, returning the files", Pine's agent does one of four things: asks with the files, asks and only names them (a question carries no files), asks and mentions neither, or ends its turn with the files and its question in the summary. Every one is now a review. Named files are fetched; failing that, the agent's own folder is listed for what it made, which goes beside a question asked in words, since a stop that points at nothing may be asking something else; a finished turn with something to review, or a closing request to reply or approve, is a stop, and the decision goes as the session's next run. A review's kind comes from its files alone, so one with nothing to look at is a question, never an empty decision; a turn that keeps finishing short of a review reaches the maker as a question rather than failing the episode; and an episode with a cut can be finished from its question.
- **What the agent writes.** Line breaks sometimes arrive written out as `\n`, which ran episode lists together; files are returned again unchanged at later stops, which made the accepted cut look like a new, unreviewed one. Both are read for what they are.
- **Restarts mid-flight.** An engine stopped between opening a session and sending its run, or between Pine taking a decision and the studio recording the turn it opened, left an episode waiting forever. Both are recovered.
- **The skill can go.** The skill is checked at every episode start, not only the setup, and a drama in production holds with a notice if it is gone.
- **On screen:** questions as Markdown with links to their files, the agent's long messages kept to three lines in the review room, the chat drawer out of the page column, readable cast names, the setup's steps following what it made, a picture of the maker's own on any review note (used by the agent on staging), and the season's approved cuts as one ZIP64 download.

**The drama skill on staging, 24 October 2026.** With `drama-workflow` in the Computer image, one real drama ("The Last Ferry", one episode of about 28 seconds) went from screenplay to an accepted cut through the app: the bible and the leads, pre-production, storyboards, a take of each of its two segments, and the cut, for $19.77 ($18.20 of it video at $39 a minute, 480p). On Pine's side it found:
- The provider sidecar pushed each Computer pod past GKE Autopilot's 10 GiB cap on ephemeral storage, so no new Computer could start until staging was changed.
- Pine's video profile takes at most 15 seconds a request: it lists Seedance 2.0's durations, where 2.5 takes 4 to 30 seconds, which is what drama-cli plans for. The skill's breakdown made one 28-second segment; the agent split it in two when asked.
- The profile first refused Seedance 2.5's `omni_reference_task_type`, which every shot with reference images sends.
- Asset-library registrations belong to the session that made them. The episode restored the setup's project with its registrations, and Pine refused every video request (drama-cli reports any 400 or 403 at submission as `ModuleAdmission`). Registering the references again in the episode's session fixed it.

And in the studio, now handled:
- **Spend.** Pine bills generated video on the turn that made it, and the charge can arrive after the turn ends. The studio keeps each turn's highest reading, reads a Computer's last turns again before stopping it, and shows what each drama and episode spent. Agents are told nothing of cost (rule 6).
- **drama-cli init's inputs.** `drama-cli init` takes them all at once: `--preset`, `--inputs.screenplay`, `--inputs.brief` and `--screenplay-language` (the language of the screenplay's scene headings, not its dialogue), and writes `budget_usd` as 1000, where null means no cap. The maker chooses which file is the screenplay and a preset template (`src/shared/presets.ts`); the studio sets the screenplay language itself (`src/shared/screenplay-language.ts`, the person's decision): it counts the lines carrying a structural mark of each form drama-cli reads (Fountain's headings in any case, forced or not, and `# Episode n`; 内景/外景, `第n集`, `1-1 夜 内 …`, 人物：, △/▲) and takes the form with more, showing the result as text; with neither (prose, no structure) it asks the maker for the language the headings will be in, never guessing it from the preset. Our own heuristic. A template is a kind of drama with its own casting and wardrobe rules, not just a language: Chinese vertical drama (`zh-cn-live-sfw`) and English vertical drama (`en-us-live-sfw`) for now, with anime, 3D animation, vertical ads and custom presets shown greyed until they are supported. Only the presets named there are offered, so a preset drama-cli adds (an adult one, say) stays hidden until someone adds it. New drama no longer asks for a language or a look: the agent writes to the maker in the studio's language, the preset gives the style, and the dialogue's language is detected where subtitles are timed. The studio writes `brief.md` from the form: the "Title:" and "Episode length:" lines init asks for, then the maker's notes. The setup goal gives the exact init command, with the inputs copied into `drama/inputs/` so they travel with the project; each episode session runs the same init on the restored project, which points its config at the new folder and keeps every setting. A drama made before New drama asked for these waits at setup for the maker to choose them; one made before the studio wrote `brief.md` gets it then, from its title, notes and episode length (asked when it has none). The screenplay is marked by its place among the files, as two may share a name.
- **Screenplay files.** drama-cli reads a screenplay only as UTF-8 text, so a Word or PDF screenplay goes to the agent as its text (`<stem>.txt`), extracted in the page with mammoth and pdf.js (`src/ui/extract.ts`), with the file itself beside it as a source; one with no text (a scanned PDF) can't be the screenplay. The studio saves the files a question names with extensions up to eight letters (`.fountain`, the rewrite drama-cli checks) and shows text files, Markdown with fenced blocks (a rewrite's `review.md` line table), and a Word or PDF file's text on the review page and in Script.
- **Episodes.** The goal has each episode register its references again in its own session, and return its breakdown when it revises it.
- **Reading what the skill returns.** A lead's face (a look state named `face`) counts with the base looks; an episode's title comes from its "EP001: title" line, not a passing mention; a long question reads at body size with its pictures and the answer beside it; a blocking diagram no longer stands for an episode on the board; names with underscores stay upright.
- **Stopping.** The maker can stop a drama: its Computers stop and nothing new starts until they try again.

**A second drama, the same day.** "Behind the Moth Mask" (three episodes of about 30 seconds) stalled where the first didn't:
- drama-cli wouldn't make a project without a budget (`init --budget` was required), so the skill asked the maker for one. Each goal now says there is no cap (rule 6), and drama-cli no longer requires one.
- The skill's `en-us-live-sfw` preset dresses every adult woman lead short, low-cut and cinched, whatever the screenplay says. The heroine's stage gown, written that way and drawn as an edit of her photoreal sheet, was refused by OpenAI's moderation. drama-cli's fallback for a refusal, Seedream, wasn't a model Pine's provider runtime offered. Setup finished without the look, and the episode that needs it couldn't start.
- Each breakdown is one segment of 25 to 30 seconds, inside Seedance 2.5's range, and Pine's profile refused every one after its storyboards were approved. An episode may now split its own segments when the model won't take them.
- Pine fixed both profiles that evening (PineSandbox #892: Seedance 2.5 takes 4 to 30 seconds, and Seedream is offered), and the preset now keeps what the screenplay says a character wears.
- Three questions waited three hours, and their Computers stopped, as designed.

And in the studio, now handled:
- **Packs.** An episode packs its folder under the same name at every stop. When a question named the pack rather than returning it, the studio kept the first one, and a resumed episode lost the maker's approvals. Every stop's pack is now kept whole.
- **Questions.** The agent's question about the missing look returned no files; the studio found the new references in its folder and offered them for approval, the maker approved them, and the question went unanswered. A stop that neither returns nor names anything to review is now asked in words, with what the folder holds beside it. A resumed session that asks about files the drama already has, such as the same storyboards unchanged, shows them again.
- **Counts.** The board's "Needs you" and the drama's "Waiting for you" count the same episodes: those waiting on an answer and those stopped.

**Desktop delivery.** macOS builds are signed with Pine's Developer ID and notarized; Gatekeeper accepts a downloaded copy. Updating itself was tested end to end on Apple silicon: two signed builds and a local feed, where the older found the newer, Squirrel staged it, a normal quit put it in place, and it started again as the new version. A failed download is logged, not left unhandled.

**Not yet verified:** parallel episodes on the real skill (the rehearsals ran up to 20 at once on stand-ins); recording real turns as the replay; a Computer actually reaching its running-time limit; the first release run in CI; updating on an Intel Mac, on Windows (NSIS) and on Linux (AppImage), and the click on the "ready" notification.

## Decisions carried in

- The app is UI/UX and flow. Pine's agent, with Pine's drama skill on the Computer, does all processing: reading scripts, the bible, cast, storyboards, takes, the cut. The app never runs drama-cli or reads its internal records.
- Only today's public SDK: `@pinesandbox/computer` 0.3.x (server) and `@pinesandbox/computer-web` 0.3.x (desktop view). No artifacts API.
- Only secret: the maker's Pine project API key.
- References for UX: BigBanana AI Director, LocalMiniDrama, FastMovieAI (screenshots in `references/`).

## Where episodes run

Sessions on one Computer run concurrently (three at most) but share no files; Pine lists cross-session storage as coming. So putting two episodes on one Computer only saves Computer quota and makes them share its CPU and memory.

- **Pre-production comes first, in one session.** drama-cli keeps a drama in one project whose accepted items are bound to their exact files, and it makes looks per episode; episodes drawn in parallel from loose copies would be refused or would draw the same look twice. So the setup session, on the first Computer of the drama's pool, does all that episodes share, in one project: it reads the screenplay and asks what is missing, writes the bible, draws the leads (the maker approves), writes and accepts every episode's breakdown, and draws every reference `drama-cli status` lists as needed by the accepted breakdowns (the maker approves this shared set). Then it packs the project, records included, into parts of at most 60 MB (`handoff/project.tar.part-*`) and lists the episodes.
- **Episodes run on copies of that project.** Every Computer in the pool takes episodes from the drama's queue. Each episode session gets the project's parts as attachments, restores them, points the config at its own folder with `drama-cli init` (drama-cli's records hold project-relative paths and hashes, so a copy keeps its acceptances), and works only inside `episodes/EPxxx`, never making a new version of anything shared. If it needs a look, place or prop that isn't accepted, it stops and asks. At each stop it packs its own folder (`handoff/EPxxx.tar.part-*`), so a new session can carry on from it after a lost Computer.
- **Default: one episode at a time per Computer.** When an episode is finished, its session closes and the same Computer takes the next one. The maker sets the pool size: "work on up to N episodes at once".
- **Setting: episodes per Computer, 1–3**, for projects whose Computer limit is the bottleneck. When Pine's shared storage ships, packing episodes onto fewer Computers becomes worth it, because the cast is set up once per Computer. Then the default can change.
- **Attachments:** the project's parts keep their names, so `cat project.tar.part-*` puts them back in order; other attachments get flat, collision-free names. A file over 64 MiB is never attached. A drama set up before pre-production existed still gets its references as loose files.
- **Provider registrations don't travel with the project.** Pine scopes asset-library registrations to the session that made them, so each episode session sets aside those in the restored project and registers its references again from their files before compiling video prompts (found on staging, 24 October).
- **Idle timeout** is per Computer: 1 h while it works, 3 h while any of its sessions waits on the maker (`setIdleTimeout`). The 1 h base matters because a question can arrive while the app is closed, when nothing can raise the timeout. On a project without a lifetime policy the timeout is fixed at start, so its Computers start with 3 h. Near the end of a start's running time a Computer takes no new session (see Progress).

## Rules the flow depends on

From the plan review (Codex, 23 October), checked against Pine's docs:

1. **Save before continuing.** A turn's returned files are paths in a working directory that the next turn can change ([files](../../../PineAI/PineSandbox/docs/pine/portal/files-and-shell.md)). The follower copies every file of an ended turn, `needs_input` included, into the library before the question becomes answerable. Until then the question shows "saving review files". A failed copy is kept for retry. Notes are bound to the saved file.
2. **One answer per question.** The maker's per-item decisions are kept locally, then sent as one combined answer to the turn that asked. Pine accepts an answer only for the latest turn and makes a repeated identical answer safe ([agent](../../../PineAI/PineSandbox/docs/pine/portal/agent.md)). While a question waits, the chat box answers it instead of starting other work.
3. **No silent stale approvals.** If the question no longer waits (its Computer stopped, or it was cancelled), the decision is never resent automatically. The review shows "this session ended". One click starts a new session for the episode, with the saved files it approved attached, and the decision quoted.
4. **Reconcile on start and after downtime.** When the app starts, or a Computer stops, the engine:
   - checks every saved Computer and session;
   - follows turns that are still running from their saved ids;
   - marks episodes whose Computer stopped as "stopped, resume?";
   - never claims a stopped session's files or turns survive.

   Run idempotency keys are saved before `run`. Lifecycle actions on one Computer are serialized.
5. **Path labels are hints.** Pine guarantees each returned file's path, size, hash and type, not drama stages or segments. The library tags files from their paths when it can; every screen also works from the agent's own words and the plain file list. The spike checks what the drama skill actually returns.
6. **Spend is shown, never put in a goal.** Pine bills the agent's turns and, separately, generated video by the minute on the turn that made it; the video charge can settle after the turn ends, as a usage event. The studio records each turn's highest reading and shows what each drama and episode spent. There is no budget: agents are told nothing of cost but that there is no cap. drama-cli used to require one (`init --budget`), and the skill asked the maker for it; init now writes `budget_usd` as 1000, where null means no cap, so each goal tells the agent to set it to null and never to ask about cost. With no cap the skill still asked before a paid take, as it does whenever spending isn't authorized, so each goal also says spending is authorized.

## Shape of the code

One npm package, as Pine's starter is, with two hosts:

```text
src/
  engine/      Node 24: Pine adapter, store (node:sqlite), scheduler, runs and turns, library, live events, HTTP API
  ui/          React 19 + Vite: screens and components
  shared/      types and API contract used by both
  desktop/     Electron main and preload (milestone 4)
docs/
```

- **Local web:** `npm run dev` starts the engine on 127.0.0.1 and serves the UI through Vite. This is the same model as the starter: loopback only, and the API answers only its own pages.
- **Desktop:** Electron's main process starts the engine in a `utilityProcess`, waits for its port, and loads the same UI. The engine and the UI use the same HTTP + SSE API in both hosts, with a per-launch token in desktop mode. That keeps one transport.
- **Libraries:** Hono (HTTP and SSE), node:sqlite, the Pine SDKs, React 19, react-router, lucide-react icons, plain CSS with tokens (as the starter), vitest. Nothing else unless a screen needs it.

## Engine

| Module | Does |
|---|---|
| `pine.ts` | A small interface over the SDK calls we use: create/start/stop Computers, sessions, `writeFile`, `run`/`wait`/`answer`/`steer`/`cancel`, `events`, `readFile`/`openFile`, `setIdleTimeout`, `delegateDesktop`, skills check. The real implementation wraps the SDK. |
| `replay.ts` | Plays recorded turns (questions, summaries, placeholder files) through the same calls, for development, tests and demos without a key or any spend. It starts with a hand-written recording of the drama skill's stops and is replaced by real recordings from the spike. It is not a simulated agent. |
| `store.ts` | SQLite: dramas, episodes, computers, sessions, runs, questions, files. The API key, credentials, bindings and session tokens are sealed with AES-GCM. The key is generated on first run and kept in the OS credential store (Keychain, Secret Service, or Electron's safeStorage from the desktop shell), so the maker manages no second secret. |
| `goals.ts` | The plain-language goals: setup, episode up to storyboards, continue after a decision, apply notes, finish. |
| `scheduler.ts` | Every few seconds: start the drama's setup; after approval, fill free slots from the episode queue (pool size, Computer limit, cap on episodes waiting for the maker); start and stop Computers; idle-timeout policy. |
| `follow.ts` | Follows every running turn with `wait`; on `needs_input` records a question; on the end of a turn copies the returned files into the library; follows events for live progress; saves cursors. |
| `library.ts` | Files by SHA-256 under the data directory. Each file is tagged with drama, episode, segment, kind (bible, look, location, prop, breakdown, blocking, storyboard, take, cut, other) and version, from its path. Unknown paths are kept as "other". |
| `decisions.ts` | Turns a maker's decision (verdict, verbatim words, notes pinned to a spot on an image or a timecode) into the answer text, answers the turn if it still waits, or queues a follow-up run with the same text. |
| `live.ts` + `http.ts` | REST for reads and actions. One SSE stream says what changed, and the UI refetches; after a reconnect the UI simply refetches its screen. |

## UI

Review throughput is the main navigation. With 80 episodes, the maker should rarely go Board → episode → Board.

1. **Slate** and **New drama** (drop files, title, language, look, format, episodes at once).
2. **Inbox first.** A persistent "Next review (n)" control on every screen. Reviews open in the room for their kind and move to the next one when sent. A review ends with **Send review**, which shows a summary of the verdicts and notes before it goes. Plain questions are answered right in the inbox. A maker who wants it fast reviews less: **Your reviews** (New drama, and the drama's production line) is every step, the cast and the cuts, or none, and the studio approves the rest as the agent stops for it, telling it "Approved without review". A question in words always waits for the maker.
3. **Drama** with tabs: **Board** (a wall of the episodes in their 9:16 frames, or a sheet of episodes × stages), **Cast & world**, **Crew**, **To review**; a **Chat** drawer (narration, questions, steer).
4. **Episode room:**
   - **Storyboards:** filmstrip of segments, the image at its own aspect ratio with notes pinned to a spot, the agent's words and the shot list, approve / note / send back, keyboard.
   - **Takes:** 9:16 player, take column, compare.
   - **Cut:** player, timecode notes.
5. **Notifications** when a review is ready, and the dock and tray badge.

Visual direction: a calm studio look (BigBanana's restraint), dark by default for viewing images and video, Chinese and English. Video players are 9:16. Storyboard grids and cast sheets keep their own aspect ratio.

## Milestones

| # | Delivers | Check |
|---|---|---|
| 1 | Scaffold; engine on the real SDK with the replay stand-in; store, scheduler, follower (save before continuing), library, decisions, reconcile, API; Slate, New drama, Board, Inbox, Storyboards room | Typecheck and tests pass. In replay: a drama goes from New drama to cast approval, to episodes waiting for storyboard review, and on after the decision. |
| 2 | **Spike on real Pine (staging, with the maker's go-ahead and a spend cap):** setup → two episodes at once → storyboard reviews → takes → cuts saved. Record the real turns as the new replay. Electron smoke test: engine in a utility process, `node:sqlite`, video seek. | One real drama with two concurrent episodes through the app. We have measured file sizes, paths and wording; we know where video spend appears. |
| 3 | Takes and Cut rooms, Cast & world, Crew, Chat, Spend, notifications, delivery download; fixes from the spike | A real episode reaches an accepted cut in the app, and the cut downloads |
| 4 | Electron packaging (signed macOS and Windows builds, auto-update), keyboard review everywhere, approve all, compare | A maker installs the app and produces a 20-episode drama |

## Not now

Script view, Canvas (ComfyUI graph), saved styles, cast library across dramas, Linux build, self-hosted teams, delivery options rendered by the agent.
