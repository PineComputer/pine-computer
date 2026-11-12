# Pine Drama Studio: proposal

**Status:** draft v5 for review, 22 October 2026. Working name; repository `open-pinedrama`, private until it is ready to join Pine Computer's open-source projects.
**Changes from v4:** the integration is now plain Pine Computer:
- each episode is a session;
- the app gives each session what it needs as attachments and reads back the files it returns;
- a dynamic idle timeout keeps Computers alive while the maker reviews.

Packs, the "kit" and the custom turn report are gone.

**Asks of the reviewer:** [section 9](#9-decisions-needed).

## TL;DR

- **What it is.** A desktop app (macOS and Windows first; also runs as a local web app) where a maker turns a screenplay into a finished vertical drama of 50–100 episodes. Pine Computers do the work, many episodes at once. The app makes that work easy to start, watch, direct and approve.
- **References.** The three apps you named each solve one part well:
  - **BigBanana:** the phase rail, the shooting-script view, the director workbench, the nine-panel picker, the export sequence map.
  - **LocalMiniDrama:** project cards, the episode grid, one-click start, asset cards that show which shots they affect, take history, the canvas.
  - **FastMovieAI:** the per-episode editor with a large preview, a generation history column, a filmstrip and an inspector; looks and voice per actor; batch actions.

  In all three the person presses "generate" on every item. In ours Pine's agent does the generating, and the maker reviews, notes and approves.
- **How it uses Pine Computer.**
  - A drama starts in one session, which reads the screenplay, writes the bible and makes the cast, locations and props.
  - Each episode then gets its own session, on the drama's Computer or on more Computers, with the screenplay, bible and approved references attached and a plain goal.
  - The agent asks when it needs the maker; the answer goes back to it. Files come back with each turn and the app keeps them.
  - While a session waits on the maker, the app raises that Computer's idle timeout to one to three hours. Once Pine's artifacts store ships, a stop no longer loses work.
- **ComfyUI.** The agent can export the drama as a ComfyUI workflow. The app draws that graph natively as its Canvas view and offers the file as a download. ComfyUI does not run anywhere.
- **Electron + React. Plan:** a two-week spike, a six-week MVP, then scale.

## 1. Introduction

Pine's drama skill (drama-cli, used by Pine's agent inside a Computer) produces an episode from a finished screenplay and a brief:
- a bible;
- character looks, location plates and key props;
- a breakdown into 4–30 second segments with shot lists;
- a blocking reference and a multi-panel storyboard per segment;
- Seedance takes, checked by an observer model;
- an edited cut.

It stops for the person at fixed points: the leads' looks, every episode's storyboards before any video, takes whose dialogue no model heard, and every cut ([drama-workflow skill](../../short_drama/skills/drama-workflow/SKILL.md)).

Makers producing AI vertical dramas have no proper tool to drive that across a whole series. This app is that tool. It joins Pine Computer's open-source projects, beside [pine-computer-starter](../../pine-computer-starter) and [amongminds](../../amongminds), when ready.

## 2. The problem

- **The maker talks to an agent in text,** opening files by path and answering in a text box.
- **There is no overview** of 80 episodes at different stages: what runs, what waits for the maker, what changed.
- **Evidence is scattered.** A storyboard needs its shot list and the observer's notes beside it; a take needs its planned lines; a cut needs notes at a timecode.
- **One session works one episode at a time,** and a series needs many running together.
- **The money is invisible until afterwards:** $39 or $59 per generated minute of video.

## 3. The reference apps

Screenshots are in [references/](references/). They are third-party images for this internal review and must be removed before the repository goes public.

### 3.1 BigBanana AI Director

A browser app: project library → one project → four phases in a left rail.

| Screen | What it does well | Screenshot |
|---|---|---|
| **Phase rail** | Script & story → Characters & scenes → Director workbench → Export, always visible on the left with "Phase 01–04" labels. The maker always knows where the project stands. | all |
| **Shooting script (拍摄清单)** | Story summary and cast on the left. On the right, scene headers (number, place, time, mood) with shot rows: shot number, shot-size and camera tags, action, quoted dialogue, character chips, and the picture prompt beside them. | [script](references/bigbanana-script-manifest.png) |
| **Characters & scenes** | Cards with image, name, gender and age, wardrobe variants, regenerate / upload / "replace from library", and the prompt. | [cast](references/bigbanana-cast.png) |
| **Director workbench** | A grid of shot cards (number, camera tag, frame, a VIDEO badge, action), a "2 / 32 done" counter and "batch generate first frames". Clicking a card opens a detail drawer with previous and next, the shot's characters with a look selector, action and dialogue, and start and end frames. | [workbench](references/bigbanana-director-workbench.png) |
| **Nine-panel storyboard** | A 3×3 image beside its panel descriptions. Use the whole grid, or crop one panel, as the start frame. | [grid](references/bigbanana-nine-grid.png) |
| **Export** | A master card (shots, estimated vs. target duration, render %), a **sequence map** with one cell per shot coloured by state, preview, MP4 and EDL/XML, source assets, render log. | [export](references/bigbanana-export.png) |

**Limits:**
- one short per project in its open snapshot;
- jobs live in the browser tab;
- media is stored as base64 in IndexedDB;
- every frame and video is a manual generate button.

### 3.2 LocalMiniDrama

An Electron app: projects → drama → episode production page, with a canvas mode.

| Screen | What it does well | Screenshot |
|---|---|---|
| **Projects** | Cards tagged with status, episode count, shot count, aspect, look and genre; a "quick start" card that imports an example; global character, scene and prop libraries. | [projects](references/localminidrama-projects.png) |
| **Drama page** | Drama info, an **episode grid** (number, title, script preview, shot count, status, "enter production"), batch-import episodes, the drama's own asset library. | (`DramaDetail.vue`) |
| **One-click full pipeline** | A bar at the top of the episode page (9:16, 15 s per segment, language, look, Start) that skips finished work and retries each step. | [cast](references/localminidrama-cast-affected-shots.png) |
| **Character cards** | Role tag, description, multi-view images, "add to this drama / library". The card shows **"affects shots #1 … #10"** with a one-click "regenerate those storyboards". | [cast](references/localminidrama-cast-affected-shots.png) |
| **Shot rows** | Script, frame and video side by side; character, scene and prop pickers; take history ("history 2, 3, 4") under the video; a dialog for shot size, camera move, angle, lighting and depth of field; batch generate. | [rows](references/localminidrama-shot-rows.png) |
| **Canvas mode** | Characters and scenes as image nodes, shots, prompts and videos as nodes, grouped "episode 1 · act 1 · 10 shots"; re-run a group; minimap. | [canvas](references/localminidrama-canvas.png) |
| **In-drama assistant** | A chat that acts on the current drama; deletions need confirmation. | (`AgentDrawer.vue`) |

**Limits:**
- one 10,800-line page per episode;
- no view of all episodes by stage;
- the canvas tangles at real scale;
- the person drives every generation.

### 3.3 FastMovieAI

A web SaaS: works → drama details → episode directory → per-episode workspace.

| Screen | What it does well | Screenshot |
|---|---|---|
| **Drama details** | Short-drama craft fields: selling point (卖点), payoff beats (爽点), main conflict (主线), relationships, outline, episode count, look; AI cover. | [editor](references/fastmovieai-editor.png) |
| **Episode workspace header** | Back to the episode directory; cover, title, episode count; **segmented stage tabs** (script, actors, props, scenes, storyboard); credits always visible. | (`pages/generate/index.vue`) |
| **Actors** | Look image, three-view sheet, costumes, voice, the original look's history. | (`works/modules/actors.vue`) |
| **Storyboard editor** | A large preview with image and video tabs, beside a **generation history column** (each attempt a thumbnail, spinning while it runs; click to use it). A **filmstrip of every shot** along the bottom (reorder, delete). An inspector with the actors in the shot, **timed dialogue rows**, and scenes scoped to "this episode / this drama". | [editor](references/fastmovieai-editor.png) |
| **Batch and delivery** | Batch images, videos, dialogue audio, narration; ZIP package; export video. | (`pages/generate/index.vue`) |

**Limits:**
- stale since February 2026;
- one aggregator for every model call;
- the person drives every item.

### 3.4 What we take, and where we go further

| | The three apps | Pine Drama Studio |
|---|---|---|
| Who generates | The person, per item or one-click | Pine's agent, end to end. The maker reviews, notes and approves. |
| Where the maker is | The stage they opened | A **board** of every episode by stage, and an **inbox** of what needs them |
| Storyboards | Per shot, or a nine-panel grid as a start frame | One multi-panel storyboard per segment, line-art and photoreal. The maker notes a spot on a panel, and the agent redraws that panel. |
| Evidence | The image and its prompt | The image, the shot list and lines, and the observer's findings the agent reports |
| Change impact | "Affects shots #1–#10" (LocalMiniDrama) | The same, from the drama's lineage graph, with the cost to redo shown before the maker confirms |
| Takes | History under the video, or a history column | The same, with each take's check and the planned lines as captions; compare two takes |
| Throughput | One machine, one episode | An episode per session, many sessions across Computers (§5.4) |
| Money | Credits counter | An estimate before shooting, spend per episode, a budget in every goal |

### 3.5 Pine's reference apps

From pine-computer-starter and amongminds we reuse:
- the project key and Computer credentials kept on the server, with only a two-minute desktop token in the page;
- the Computer rebuilt from saved records;
- `agent.run` with idempotency keys, and a background worker following turns with `wait`;
- one resumable event stream to the page;
- each turn's files copied into the app, so history outlives the Computer;
- `<PineDesktop>` with take-control;
- from amongminds, a clock that starts Computers for due work under a cap, and hands each session its files when it starts.

## 4. The maker's flow

### 4.1 Principles

1. **Review, don't generate.** The screens look like the reference apps' editors, but their buttons are approve, note and send back.
2. **One place for "what needs me":** the inbox, a dock and tray badge, and an OS notification.
3. **Never wait on the machine.** Notes go out at once; other episodes keep moving.
4. **The evidence sits beside the decision.**
5. **Film words** (cast, locations, storyboards, takes, cut, crew), not infrastructure words.
6. **Vertical first.** Every player is a 9:16 phone frame.
7. **Cost before commitment.** (Later: the first release shows no budget or spend.)
8. **Fast hands.** Keyboard review, approve all, compare versions.
9. **Chinese and English** from the first release.

### 4.2 Screens

**Slate** (LocalMiniDrama's project cards). Each drama is a card showing progress, what needs the maker, its crew and its spend.

```text
┌ Pine Drama ───────────────────────────── [ Cast library ] [ Locations ] [ + New drama ] ┐
│ ┌────────────────────────┐ ┌────────────────────────┐ ┌────────────────────────┐       │
│ │ [poster]               │ │ [poster]               │ │ [poster]               │       │
│ │ Stepmother in the 80s  │ │ The CEO's Secret       │ │ Return of the Heir     │       │
│ │ 80 eps · 9:16 · live   │ │ 60 eps · 9:16 · anime  │ │ 100 eps · 9:16 · live  │       │
│ │ ███████░░░░ 23/80 done │ │ ██░░░░░░░░░ 6/60       │ │ casting                │       │
│ │ ● 4 need you  ⟳ 8 busy │ │ ● 1 needs you ⟳ 3 busy │ │ ⟳ 1 busy               │       │
│ │ $3,120 of $9,000       │ │ $840 of $7,000         │ │ $40 of $12,000         │       │
│ └────────────────────────┘ └────────────────────────┘ └────────────────────────┘       │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

**New drama** (LocalMiniDrama's one-click bar; FastMovieAI's drama fields, kept optional). The maker drops in whatever they have; the agent reads it and asks for anything missing.

```text
┌ New drama ──────────────────────────────────────────────────────────────────────┐
│ ┌───────────────────────────────────────────┐  Title     [                    ] │
│ │  Drop the screenplay and any notes        │  Language  (•) 中文   ( ) English │
│ │  PDF · Word · Fountain · text             │  Look      [ live action ▾ ]      │
│ └───────────────────────────────────────────┘  Format    9:16 · 480p ▾          │
│ Selling point / payoff beats (optional) [                                       ]│
│ Budget [ $ 9,000 ]     Work on up to [ 8 ] episodes at once                      │
│                                                         [ Start production ]    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Drama board.** Ours; none of the three has a view of all episodes by stage. A tab bar runs along the top, a phase rail in BigBanana's spirit.

```text
┌ ← Stepmother in the 80s · 80 eps · 9:16 480p ─── ● 4 need you · ⟳ 8 at work · $3,120 of $9,000 ┐
│ Board   Script   Cast & world   Inbox 4   Canvas   Crew   Spend                       [ Chat ▸ ] │
├───────┬───────────┬───────────┬────────────────┬──────────┬────────┬────────────────┬───────────┤
│       │ Breakdown │ Blocking  │ Storyboards    │ Takes    │ Cut    │ Now            │ Crew      │
│ EP001 │ ✓         │ ✓ 8/8     │ ✓ approved     │ ✓ 8/8    │ ✓ v2   │ done           │           │
│ EP002 │ ✓         │ ✓ 9/9     │ ● review (9)   │          │        │ waits for you  │ PC-2 · s1 │
│ EP003 │ ✓         │ ✓ 7/7     │ ✓ approved     │ ⟳ 5/7    │        │ shooting       │ PC-3 · s2 │
│ EP004 │ ⟳         │           │                │          │        │ breaking down  │ PC-1 · s3 │
│ EP012 │ queued    │           │                │          │        │ in line, #2    │           │
└───────┴───────────┴───────────┴────────────────┴──────────┴────────┴────────────────┴───────────┘
 8 episodes at work on 3 Computers · 3 wait for you · next review ready in about 20 minutes
```

**Script** (BigBanana's shooting script). The screenplay as the agent broke it down: episodes, segments with place, time and length, shots with size, action and quoted lines, and character chips. A note on a line goes to that episode's session as a breakdown revision.

**Cast & world** (BigBanana's cards, LocalMiniDrama's "affects shots", FastMovieAI's looks and voice). Characters with face and looks (S0 everyday, S1 wedding…), locations with their views, props. The leads' looks are approved here.

```text
┌ Cast & world ─────────────────────── Characters (12)   Locations (9)   Props (6) ───────────┐
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ [face] [S0 sheet] [S1 sheet] [S2 sheet]     Lin Xiaoyu · lead · 26 · female            │ │
│ │                                            Looks: S0 everyday ✓  S1 wedding ✓  S2 ●    │ │
│ │                                            In EP001–EP014, EP020 · 61 segments          │ │
│ │ Versions v3 ✓ · v2 · v1                     [ Approve ]  [ Note… ]                       │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

A note on an approved look first shows its impact, from the lineage graph: "61 segments use this look: 23 storyboards and 9 takes would be redone, about $410." Only then does the maker confirm.

**Episode room.** FastMovieAI's editor layout and BigBanana's workbench, built for review. Stage tabs: Storyboards | Takes | Cut. A segment filmstrip runs along the top, the selected segment fills the centre, and the inspector sits on the right.

```text
┌ ← EP002 · "The letter" · 9 segments · 1:41 ─────── Storyboards ● │ Takes │ Cut ── [ Approve all ] ┐
│ ┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐                                    │
│ │seg01││seg02││seg03││seg04││seg05││seg06││seg07││seg08││seg09│   ✓ approved  ● to review           │
│ │  ✓  ││  ✓  ││  ●  ││  ●  ││  ●  ││  ●  ││  ●  ││  ●  ││  ●  │                                     │
│ └─────┘└─────┘└─────┘└─────┘└─────┘└─────┘└─────┘└─────┘└─────┘                                    │
├──────────────────────────────────────────────────────────┬───────────────────────────────────────┤
│ seg03 · Living room · night · 12 s                       │ Shot list                              │
│   ┌───────┬───────┬───────┐                              │ 1  MS   Lin enters, sees Wei     2.0 s │
│   │   1   │   2   │   3   │   line-art │ photoreal │ ◫   │ 2  CU   Wei: "You're late."      1.5 s │
│   ├───────┼───────┼───────┤                              │ 3  OTS  Lin hides the letter     3.0 s │
│   │  4 ✎  │   5   │   6   │                              │ 4  CU   the torn letter          1.5 s │
│   └───────┴───────┴───────┘                              │                                        │
│ ✎ on panel 4 ▸ [ the letter should be in her left hand ] │ Agent  "Panel 4 shows a third person   │
│ Versions  v3 ● · v2 · v1                                 │  in the background."                   │
│                                                          │ [A] approve  [N] note  [R] send back   │
└──────────────────────────────────────────────────────────┴───────────────────────────────────────┘
```

- **Storyboards.** Click anywhere on the image to pin a note there; this is BigBanana's nine-panel picker turned into a correction tool. The note goes to the agent with the spot it points at. Toggle line-art, photoreal or both. J and K move between segments.
- **Takes.** A 9:16 player with the planned lines as captions. Beside it, a take column (FastMovieAI's history column) with what the agent said about each take. Compare two takes; "use this take".
- **Cut.** A phone-frame player, notes pinned to timecodes, a segment strip to jump, and BigBanana's sequence map showing which segments are final.

**Inbox.** Every question the agents ask, across dramas, most blocking first, grouped by drama and episode with thumbnails. The kinds follow the skill's stops: lead looks, storyboards, takes with dialogue, cuts, items out of attempts, and plain questions.

**Canvas** (§6). The drama's lineage, drawn natively from the ComfyUI workflow the agent exports. Clicking a node opens its review.

**Crew.** Ours: the drama's Computers, their sessions and the queue.

```text
┌ Crew · 3 Computers · 8 sessions at work · project limit 10 Computers ──── [ + Computer ] [ Pause ] ┐
│ PC-1  idle timeout 15 m · 2 days left                                                            │
│   s1  EP001 done                       s2  EP009 redrawing seg04, seg07   s3  EP004 breaking down │
│ PC-2  idle timeout 3 h (EP002 waits for you) · 2 days left                                        │
│   s1  EP002 waits for you              s2  EP006 storyboards 7/9          s3  EP008 blocking      │
│ PC-3  idle timeout 15 m · 6 days left                                                            │
│   s1  EP005 shooting seg05             s2  EP003 shooting 5/7             s3  —                   │
│ Queue    EP012 · EP013 · EP014                                                                    │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Each session has "watch" (its live desktop) and "take control".

**Chat** (LocalMiniDrama's in-drama assistant). A side panel showing the agent's narration and questions for the session in focus. While the agent works, a message steers it; when it is idle, a message starts a new run.

**Spend.** Budget, actual spend per episode, an estimate for the rest of the drama.

**Delivery** (BigBanana's export, FastMovieAI's package). Download an episode, a range or the whole drama, as MP4 or a ZIP with its source files.

## 5. How the app works with Pine Computer

### 5.1 The pieces we use

| Pine Computer | How the app uses it |
|---|---|
| **Computer:** an identity you keep; started, stopped or paused; runs up to three sessions | One per drama to start, more for more parallel episodes |
| **Session:** its own agent, browser window, shell and working directory; sessions don't see each other's files | One for the drama's setup and casting; then one per episode in progress |
| **Agent turns:** `run` a goal, `wait`, `answer` its question, `steer`, `cancel` | Goals per step; questions become inbox items; the maker's decisions become answers |
| **Files:** `writeFile` into the session's attachments; the turn's `result.artifacts` lists the files it produced; `readFile` / `openFile`; `listFiles` | Hand each session the screenplay, bible and approved references; copy every returned file into the app's library |
| **Events:** progress narration, activity steps (including working-directory files), screen frames | The chat, the crew view, live progress on the board |
| **Idle timeout:** use keeps a Computer running; waiting for an answer does not; `setIdleTimeout` changes it while running | Raised while a session waits on the maker (§5.3) |
| **Desktop:** `delegateDesktop` + `<PineDesktop>`, take and release control | "Watch" and "take control" on any session |
| **Skills:** Pine's own (the drama skill) found from the goal; the maker's own via `learn`, `refine`, `activate` | Check the drama skill is enabled; "save this as the drama's style" (§5.5) |
| **Usage:** each turn's `usage.cost` | Spend per episode, with video charges from Pine's usage |

### 5.2 A drama, step by step

1. **Setup session.** The app creates the drama's Computer and a session. It writes the screenplay and the maker's notes into the session (`writeFile`) and runs:
   > "Make a short drama from the attached screenplay. Language: Chinese; look: live action; 9:16, 480p; budget $9,000. Read it, ask me anything missing, write the bible, and make the cast, locations and props. Stop for my approval of the leads' looks."

   The agent's questions ("How old is Lin?") arrive in the inbox. The returned bible and images fill Cast & world.
2. **Episode sessions.** Once the cast is approved, the app opens a session per episode, up to the maker's limit. It puts sessions on the drama's Computer while it has room (three per Computer) and starts another Computer when it doesn't. Sessions don't share files, so the app gives each new one what it needs: the screenplay, the bible, and the approved character, location and prop images, as attachments. Then it runs:
   > "Make episode 7 of this drama from the attached screenplay, using the attached bible and approved cast, locations and props without redesigning them. Stop for my review of its storyboards."
3. **Review and continue.** Each stop is a question in the inbox, with the files the turn returned. The maker's decision goes back as the answer, quoting their words:
   > "Approved seg01–seg02 and seg04–seg09. seg03: on panel 4, the letter should be in her left hand."

   The agent records the approval and redraws; later stops bring takes and then the cut.
4. **Done.** The accepted cut is copied into the library and the session is closed. Its slot takes the next episode in the queue.

- **Every run carries an idempotency key** saved first, as in the starter.
- **A worker follows each turn** with `wait` and keeps the event cursors.
- **A turn runs up to an hour** unless `max_wall_ms` is raised; an unfinished step gets a "continue" run.

### 5.3 Keeping sessions alive while the maker reviews

- Work keeps a Computer running; a question waiting for an answer does not. So when any session on a Computer stops for the maker, the app raises that Computer's idle timeout with `setIdleTimeout`, by default to 3 hours (1 hour at least). When none of its sessions is waiting, the app sets it back to minutes.
- A Computer whose sessions are all finished or waiting longer than its timeout stops. If the maker answers after that, the app opens a new session for the episode with everything the library holds for it, and the agent continues from those files; some work may be redone.
- The scheduler starts no new episode on a Computer near its 7-day limit, and stops Computers that have nothing to do.
- When Pine's artifacts store ships, a session's work survives a stop, and this becomes a setting rather than a safeguard.

### 5.4 Many episodes at once

- **A slot is one session;** a Computer has three. The maker sets how many episodes work at once. The scheduler fills free slots from the queue in episode order, and starts Computers within the project's limit on concurrent Computers.
- **A cap on episodes waiting for the maker** (default 4) keeps the line from drawing storyboards faster than the maker reviews them, which wastes money if the direction changes.
- **Consistency across episodes** comes from giving every episode session the same approved bible and references. When the maker changes an approved look, the app sends the new references to the episodes that use it (from the lineage graph) with a note to update them.

### 5.5 Library, money, security, skills

- **Library.** Every file a turn returns is copied into a local library per drama, named by content hash, with what it is (episode, segment, version) taken from its path and the agent's words. Review, screening, delivery and the next sessions' attachments all come from it. It works offline and outlives every Computer.
- **Money** (after the first release). Before shooting an episode, the app shows an estimate (segments × seconds × the per-minute rate × a retake allowance). Each goal states the budget left for that episode, and the skill honours a spending limit it is given. Spend comes from each turn's usage and Pine's video charges.
- **Security.** One secret, the Pine project API key, stored with the OS keychain and held only by the engine. The interface receives two-minute desktop tokens and nothing that can drive a Computer.
- **Skills.**
  - **Before the first run,** the app checks that Pine's drama skill is enabled on the Computer.
  - **Saving a style.** After an episode the maker is happy with, "Save as this drama's style" runs `learn` to draft a skill from it. The maker reads the draft and activates it, and every later episode on that Computer follows it. The app uploads the same skill to the drama's other Computers.

## 6. ComfyUI: in the Computer or in the app?

drama-cli has two ComfyUI pieces ([review: ComfyUI preview](../../short_drama/doc/drama-cli/review.md#comfyui-preview), decisions D49 and D50):

- **The export** writes the drama's lineage as a ComfyUI workflow file. The graph has one node per stage (looks, plates, props, breakdown, blocking, storyboards, takes, cut), showing its working version, whether it is accepted, whether it is fresh, and its picture. Links run from each picture to the stages that used it, in groups.
- **A live preview** installs a pinned local ComfyUI (about 1.6 GB, with PyTorch) only to show that graph, read-only, refreshing every two seconds. Editing through ComfyUI was considered and not taken.

**Recommendation:**

| Piece | Where | Why |
|---|---|---|
| Making the graph | **Computer**: the agent exports the ComfyUI workflow when asked, and returns the file | Only the drama skill reads its own records |
| Showing it | **App**: the Canvas, drawn natively from that file | A 1.6 GB PyTorch app to draw a read-only graph is the wrong tool on a maker's laptop. Running it in the Computer and viewing it over the remote desktop is slow and outside the app. A native canvas shows the same graph with our thumbnails and statuses, and opens the review rooms. |
| The file itself | **App** offers "Download as ComfyUI workflow" | For makers who use ComfyUI |
| "Used in" and change impact | **App**, computed from the same graph | LocalMiniDrama's "affects shots", made automatic |

The Canvas keeps the preview's groups, its node titles ("EP001 seg02 line-art · v11 ✓v9") and red for outdated nodes.

## 7. Platform and stack

**Electron**, with the engine in a utility process and one React UI that also runs as a local web app.

- **Why Electron:**
  - Pine's server SDK runs inside it unchanged; its README names Electron's main process as a supported runtime.
  - One bundled Chromium plays and seeks video the same way on every OS.
  - LocalMiniDrama, the reference closest to ours in form, ships on it.
- **Tauri is the runner-up:** its three system webviews still have open local-video bugs, and the SDK would need a separate 58–112 MB sidecar.

| Concern | Choice |
|---|---|
| UI | React 19, Vite, TanStack Router and Query, Radix primitives, React Flow for the Canvas |
| Desktop | Electron 45. The engine runs in a `utilityProcess` and reaches the UI over a MessagePort. The library is served through a privileged scheme with range support. Tray, notifications, auto-update, signed downloads. |
| Local web | The same engine serves the same UI on 127.0.0.1, as the starter does |
| Data | SQLite (`node:sqlite`, through Drizzle) and the library folder |
| Pine | `@pinesandbox/computer` 0.3.x in the engine; `@pinesandbox/computer-web` for live screens |

```text
open-pinedrama/
  apps/desktop/      Electron main and preload; runs the engine in a utility process
  apps/web/          the engine serving the UI on 127.0.0.1
  packages/engine/   dramas, Computers, sessions and the queue, turns and events, library, spend
  packages/ui/       slate, new drama, board, script, cast & world, episode room, inbox, canvas, crew, chat, spend
  packages/brand/    name, colours and copy in one place, as the starter's brand.ts
  docs/
```

## 8. Plan

| Phase | Scope | Done when |
|---|---|---|
| **0. Spike** (2 weeks) | One drama on staging: a setup session for casting, then two episode sessions in parallel, given the approved references as attachments. Storyboard and cut review in a bare episode room. Idle timeout raised during reviews. Clickable mock-ups of the other screens. | Two episodes from one script to accepted cuts, in parallel, with every decision made in the app. We have measured time per step, cost, file sizes, and how well the episode sessions keep to the approved cast. |
| **1. MVP** (about 6 weeks) | Slate, new drama, board, cast & world, episode room (storyboards, takes, cut), inbox, chat, crew, spend, delivery, notifications; sessions and the queue across Computers; the waiting cap; macOS and Windows builds | A maker produces a 20-episode drama with 6 or more episodes at work at once, without a terminal. |
| **2. Polish and scale** | Script view, Canvas, change impact, take compare, keyboard review everywhere, approve all, saved styles, cast library across dramas, Linux | An 80-episode drama, with the maker's review time the only bottleneck. |
| **Later** | Durable session work through Pine's artifacts store; delivery options rendered by the agent (subtitles, music, cards); self-hosted teams; open-source release | As Pine's capabilities ship. |

## 9. Decisions needed

1. **MVP scope.** The Phase 1 screens, or fewer.
2. **Platform.** Electron (proposed) or Tauri.
3. **Name.**

## 10. Risks

| Risk | Mitigation |
|---|---|
| A Computer stops while the maker takes longer than its idle timeout | 3-hour default during reviews, adjustable; a reminder before it lapses; the library lets a new session continue; Pine's artifacts store removes the risk later |
| Episode sessions drift from the approved cast | The same approved references and bible attached to every session; measured in the spike |
| The maker becomes the bottleneck | Inbox ordering, approve all, keyboard review, the cap on waiting episodes |
| Project limit on concurrent Computers | Three sessions per Computer first; the queue; ask Pine for a limit sized to the line |

## Appendix: platform comparison

| Option | Web engine | Pine server SDK | Local video with seeking | Verdict |
|---|---|---|---|---|
| **Electron 45** | Bundled Chromium on every OS | In-process (`utilityProcess`); named in the SDK's README | Privileged scheme with range responses; `registerSource` | **Recommended** |
| **Tauri 2.12** (Tauri 3 with CEF in alpha) | WKWebView, WebView2, WebKitGTK | Sidecar: about 58 MB with Bun, about 112 MB as a Node executable | Open bugs on Linux ([#15472](https://github.com/tauri-apps/tauri/issues/15472)) and macOS ([wry #1822](https://github.com/tauri-apps/wry/issues/1822)) | Runner-up |
| **Electrobun 2** | System webview or CEF | Bun | Little evidence | Too young |
| **Flutter, React Native desktop** | No DOM | Sidecar | Plugins | No |
