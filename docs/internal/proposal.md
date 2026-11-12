# Pine Computer in other people's agents

Draft proposal, November 9, 2026.

Any app that already runs agents gets a Pine Computer to hand work to: a whole cloud computer with a browser,
a desktop, files and document tools, that stays signed in to the sites it has used. The app keeps its model,
its logic, its memory and its UI. It hands the Computer a job and gets the finished work back, and the person
can watch the Computer and take the controls at any point.

## What it is not

- **Not the app's language model.** Pine doesn't write the app's replies, memory, titles or summaries. When
  an app routes its own thinking to Pine, the bridge turns it away (see "What OpenMausBot taught us").
- **Not a sandbox the app's model drives.** The app never clicks, types or runs commands on the Computer
  step by step. It hands over a job, in words, and the agent on the Computer does the work.
- **Not a browser agent.** The job gets a whole computer: a browser, a shell, files, document and media
  tools, and sign-ins that last.

## Three levels

| Level | Who | How |
| --- | --- | --- |
| **SDK** | Products with their own backend | `@pinesandbox/computer`, with the live desktop from `@pinesandbox/computer-web` in their own UI. The Tavus demo works this way. |
| **Protocols, no code** | Apps and agents that speak MCP, A2A or ACP | The `pine-computer` bridge: one core, one front door per protocol. |
| **The person** | Someone at a terminal | `pine-computer run "…"`, and the desktop page to watch and take over. |

This proposal is about the middle level.

## Two shapes

**Pine as a tool, the default.** The app's own agent stays in charge and calls the Computer when the work
needs one. It is the boundary story taken literally. The app's thinking stays on the app's model by
construction, and it reaches the most apps.

- **MCP**: Claude Code, Codex, Cursor, Claude Desktop, and any chat app whose bots take MCP servers. The
  Computer is four tools: `computer_task`, `computer_wait`, `computer_cancel`, `computer_desktop`.
- **A2A**: agent frameworks and platforms that delegate to remote agents (ADK, the A2A-capable orchestrators).
  The Computer is a remote agent with an agent card. Its tasks stream steps, stop with `input-required` on a
  question, and return files as artifacts.

**Pine as a bot, for coworker apps.** Pine takes the app's engine slot, so a bot in the app *is* a Pine
Computer.

- **ACP**: OpenMausBot, nightly-labs OpenBot, Zed.
- **AG-UI** (not built): CopilotKit OpenBot, OpenDots.

It makes the strongest demo ("a teammate with a computer of its own"). The cost is that the app treats the
engine as a language model, so the bridge has to say no to some things, and the app shows the Computer's
steps in its generic tool-call UI.

## One core

Every front door maps the app's conversation model onto the same core:

| In the app | On Pine |
| --- | --- |
| A thread (a chat, an MCP thread, an A2A context) | A session on the Computer, which remembers the thread's work |
| A message | A job (`agent.run`) |
| The agent's question | The end of the turn; the next message answers it (`agent.answer`) |
| A message while a job runs | Steering that job (`agent.steer`) |
| Steps | Tool calls (ACP), progress (MCP), status updates (A2A) |
| Files the job made | Copies next to the thread, linked in the reply (ACP, MCP) or as artifacts (A2A) |
| Files the person attached | Uploaded to the session's workspace |
| A password | `PINE_SECRET_<NAME>`, typed by the agent as `$NAME`, never seen by the model |
| More threads than sessions | The idle thread used longest ago gives up its session; it reopens later with a recap, still signed in |

Around the core:

- **Desktop pages.** Every thread has a page to watch the Computer and take the controls. So does every
  Computer, following whichever thread is working.
- **Sign-ins.** Sign-ins belong to the Computer, so every thread on it shares them. Name a Computer per app or
  per bot (`PINE_COMPUTER`) to keep identities apart.

## Local and hosted

**Local (built).** The app starts `pine-computer acp` or `pine-computer mcp` on stdio. The desktop pages are
served on 127.0.0.1 by a small process of their own, which outlives the app's process.

**Hosted (built).** `pine-computer serve` runs one HTTP process, so a web app, a hosted chat app or an
agent platform can reach the Computer over the network:

| Path | What |
| --- | --- |
| `/mcp` | MCP over Streamable HTTP: the same four tools |
| `/.well-known/agent-card.json` | The A2A agent card |
| `/a2a` | A2A over JSON-RPC, for clients on A2A 1.0 and on 0.3: send, stream, get, cancel, resubscribe |
| `/<key>/view/…` | The desktop pages |
| `/<key>/files/…` | Files the jobs made, for clients that can't read this machine's disk |

`/mcp` and `/a2a` need a bearer token (`PINE_SERVE_TOKEN`, or one generated on first start). The desktop and
file addresses carry a key in the path, like a share link. Links use `PINE_PUBLIC_URL` when the process sits
behind a domain.

## A2A, in detail

- **Context = thread.** A message with no context starts a thread; a context id keeps the conversation on
  the same session.
- **Task = one job, across its questions.** The first status carries the desktop link. Each finished step
  is a `working` status update with the step in words, plus its kind and page in metadata. A question ends in
  `input-required`, with the question and the desktop link; a message on the same task answers it. A new
  task in a context whose job is waiting drops that question and starts fresh.
- **Results.** The summary is the final status message and a text artifact. Each file is an artifact: inline
  bytes up to 10 MB, a link above that.
- **Cancel** stops the job, or drops a waiting question.

## What OpenMausBot taught us

OpenMausBot is the test case for the bot shape. Every lesson is likely to repeat in the next app:

- **It uses the engine as its language model.** It ran memory upkeep through the bot's engine: five
  sessions on the Computer, four real jobs at about $0.03 each, all to write a few lines of notes. The
  bridge now refuses those calls at once, and the bot's memory is off. The proper fix lives in the app: let
  an engine say it doesn't write background text, so the app's helper model does.
- **It wraps the person's words.** It sends about three thousand words of instructions for its own agents
  ahead of each message. The bridge keeps the person's words and the time they sent them.
- **It probes the engine.** It runs the engine's command with `--version`.
- **It renders the Computer generically.** It keeps a step's first title, words unknown steps as "Running
  <title>", and its screen panel only shows its own computers. So the Computer's desktop lives on a page the
  bot links to (or a pinned panel).
- **Yes and no work without cards.** 👍 on a question comes back as "yes, go ahead". The agent asks in
  words, without choices, so Allow/Deny cards would break questions like "which size?".

The general rule: the bridge passes on jobs from people and turns away everything else.

The tool shape had a lesson of its own in the same app. A capable model does what it can with its own tools
before it reaches for the Computer: Claude read a static page with WebFetch and posted a simple form with
`curl`. That's the boundary working as it should, and it means the pitch, and the bot's instructions, should
name the work only a computer does: sign-ins that last, sites that need a real browser, a person taking
over, files made with desktop tools. One line of instructions ("hand anything that needs a computer to the
Pine Computer") was enough. Claude then relayed the Computer's question and passed the person's answer back.

## Showcase

Recorded in OpenMausBot on the same job, the pizza form with a question before submitting
([showcase/](showcase/)):

- **Pine as a bot.** The question, a 👍, the form submitted, and the Computer's desktop showing the form
  filled in and the response after.
- **Pine as a tool.** A Claude bot hands the form to the Computer, relays its question as a table, takes
  "yes, submit it" and passes it back.

## Status

- **Proven against a real Computer:**
  - the terminal;
  - ACP inside OpenMausBot (a PDF brief, a form with a question and its answer, 👍 to submit, the desktop
    page in a sandboxed frame);
  - MCP over stdio, from headless Claude Code and scripted clients;
  - MCP over HTTP, from headless Claude Code, which wrote its own job for the Computer and used the answer;
  - MCP over stdio, from Codex (`codex exec`, GPT-6 Astra): it handed the Computer a job on a page rendered
    by JavaScript, waited on it, and got a one-page PDF back next to its working folder;
  - A2A 1.0 (the JS SDK): a question, its answer on the same task, a follow-up PDF returned as an artifact,
    and a cancel;
  - A2A 0.3 (the Python SDK most platforms pin): a streamed job end to end.
- **Not run yet:**
  - nightly OpenBot, Zed;
  - the Codex desktop app, Cursor and Claude Desktop;
  - MCP inside OpenMausBot;
  - an A2A platform (ADK, an orchestrator) rather than its SDK.

## Gaps

- **Pine:**
  - A step names its page only when it ends.
  - Questions carry no choices, so apps can't show answer cards.
  - Three sessions per Computer limits how many threads can be open at once.
- **Apps:**
  - OpenMausBot: a switch for a custom engine to skip background text.
  - OpenMausBot: a way for an engine to supply the Bot's screen.
- **Distribution:**
  - Publish the CLI so `npx pine-computer …` works.
  - A sign-in instead of pasting the project key.
  - Hosted auth beyond one shared token (per-app tokens, OAuth for MCP).

## Moving into PineSandbox

Once the tool shape is proven over HTTP, it moves into the main repo as part of Pine Computer's
integrations:

- **The package.** The core, MCP (stdio and HTTP) and A2A, as a package next to the TypeScript SDK
  (`sdks/pine-computer/`), published with the `pine-computer` command. Its exact place and name are for the
  repo's owners.
- **The docs.** "Use Pine Computer from your agent" pages for MCP and A2A, with the client snippets from this
  repo's README.
- **ACP stays here for now.** It moves in once a second app besides OpenMausBot runs it.

## Next

1. A showcase job that only a computer can do (a lasting sign-in, a site that needs a real browser), so the
   tool shape can't be done with the model's own tools.
2. Run the tool shape in one A2A platform and one desktop MCP app.
3. For hosting beyond one machine: persistent A2A tasks (the SDK has database stores), per-app tokens.
4. Move the tool shape into PineSandbox.
5. The AG-UI front door.
