# pine-computer-bridge

Hand chat threads to a Pine Computer. An app that already runs agents (a chat app of bots, an editor, a
coding agent) gets a Computer to give work to: a whole cloud computer with a browser, a desktop, files and
document and media tools, that stays signed in to the sites it has used. The app keeps its own model,
logic and tools; it hands the Computer a job and gets the finished work back.

Four ways in, on one core:

| | For | What the app sees |
| --- | --- | --- |
| `pine-computer mcp` | Agents that call tools: Claude Code, Codex, Cursor, Claude Desktop, the chat apps' MCP panels | Four tools: `computer_task`, `computer_wait`, `computer_cancel`, `computer_desktop` |
| `pine-computer serve` | Web apps, hosted chat apps and agent platforms, over HTTP | The same MCP tools at `/mcp`, and an A2A agent at `/a2a` with its card |
| `pine-computer acp` | Apps that run agents over the Agent Client Protocol: OpenMausBot, nightly-labs OpenBot, Zed | A bot. Each chat thread is a thread on the Computer; its steps show as tool calls; its summary is the reply |
| `pine-computer run "…"` | The terminal | One job, its steps as it goes |

The first two make the Computer a tool: the app's own agent stays in charge and hands it the computer work.
The third makes it a bot of its own. [docs/proposal.md](docs/proposal.md) lays out the design.

Every thread also has a live desktop page on `127.0.0.1`: the person watches the Computer work, takes the
controls (to type a code, pass a check, or show it how) and hands them back. Each Computer has a page too,
which follows whichever of its threads is working: `pine-computer desktop` prints its address, to pin in a
chat app. The pages run in a small process of their own that starts on first use and stays up, so links in
a chat keep working after the app closes the bridge.

## How a thread works

- **A message starts a job.** The agent on the Computer works on its own. Its steps stream back as it
  goes ("Open a page", "Fill in “Email address”", "Create report.pdf"), and its summary is the reply.
- **A question ends the turn.** When the agent needs something only the person has, or before anything that
  spends money, sends or submits, it stops and asks. The person's next message in the thread answers it.
- **The thread remembers.** Each thread has its own session on the Computer, so a follow-up ("now make it a
  PDF") builds on what it did. Sign-ins belong to the Computer and are shared by every thread.
- **Files come back.** Files a job makes are copied into the thread's folder (`pine-computer-files/` in the
  app's working folder), and links in the reply point at the copies. Files the person attaches go up to
  the Computer with the message.
- **Passwords stay out of the model.** `PINE_SECRET_<NAME>=value` makes a secret the agent types as
  `$NAME` without seeing it.
- **Threads share a Computer's sessions.** A Computer holds a few sessions at a time (three on our
  project). When they're all in use, the thread used longest ago gives its session up; if it's used again,
  it reopens with a recap of its history, still signed in. A thread with a job running is never closed.

## Set up

Node.js 22 or newer.

```sh
npm install
npm run build
npm link                     # puts `pine-computer` on your PATH
mkdir -p ~/.pine-computer && chmod 700 ~/.pine-computer
printf 'PINE_SANDBOX_API_KEY=…\nPINE_SANDBOX_ENDPOINT=…\n' > ~/.pine-computer/env && chmod 600 ~/.pine-computer/env
pine-computer run "Open https://news.ycombinator.com and tell me the top 3 stories."
```

The key can also go in each app's environment settings instead of `~/.pine-computer/env`.

### OpenMausBot

Add an instance to `~/.openmausbot/config.json`, then restart the app. A bot on it is a Pine Computer.
A saved `instances` list replaces the built-in engines, so a new list names the ones you use too (with
`claude` or `codex` in it, the app adds back the rest of its engines).

```json
{
  "instances": {
    "claude": { "driver": "claudeAgent" },
    "codex": { "driver": "codex" },
    "pine": {
      "driver": "customAcp",
      "displayName": "Pine Computer",
      "environment": { "PINE_COMPUTER": "openmausbot" },
      "config": { "cli": "pine-computer acp" }
    }
  }
}
```

Then make a bot on the Pine Computer engine, with **Works on** set to Off: the Pine Computer is its computer.
From the command line, `pnpm omb team apply` with a file like this does it:

```yaml
version: 1
bots:
  - name: Pine Computer
    title: Works on its own cloud computer
    chief: false
    model: pine/agent-default
    computer: "off"
```

Then, in the bot's settings, turn **Memory** off (or `PATCH /api/bots/<id>` with
`{"memoryEnabled": false, "memoryUpkeep": false}`). OpenMausBot runs memory upkeep with the bot's own
engine, a whole job on the Computer for a few lines of notes, and with memory on it puts recalled notes into
each message. The Computer keeps its own memory: its sign-ins and skills.

What else to know:

- **Its own instructions are left out.** OpenMausBot puts its instructions for its own agents (their tools,
  the bot's settings) ahead of each message. The Computer gets the person's words and the time they sent
  them.
- **Background calls are turned away.** Each comes in a fresh session in a temporary `omb-acp-…` folder,
  and the bridge refuses it at once instead of starting a cloud job.
- **Yes or no in one tap.** A 👍 or 👎 on the bot's question answers it ("yes, go ahead").
- **Pine's mark.** Add `"icon": { "kind": "custom", "dataUrl": "data:image/png;base64,…" }` to the
  `pine` instance, and set the mark as the bot's avatar in its profile.
- **The desktop in the app.** In Advanced mode, **Settings → General → Pinned panels** pins the address
  `pine-computer desktop` prints. It opens in the app's main area, in place of the chat.

The Computer can also be a tool for a Claude bot, the tool shape:
1. In **Plugins → MCP servers → Add server**, paste `pine-computer mcp`, with `PINE_COMPUTER` in its
   environment.
2. Give a bot that server.
3. Add one line to the bot's instructions: hand anything that needs a computer to the Pine Computer.

Without that line, Claude does what it can with its own tools: it read Hacker News with WebFetch and posted a
form with `curl`. With it, Claude hands the job over, relays the Computer's question, and passes the answer
back. The app's Claude engine can't switch its own tools off (`native:` tool selection isn't supported there).

[docs/showcase/](docs/showcase/) has both shapes on the same job, recorded in the app: the bot (a question,
👍, submitted, the desktop showing the result) and the tool (Claude relaying the question and the answer).

### nightly-labs OpenBot

Add a custom ACP agent with the command `pine-computer` and the argument `acp`. Environment values such
as `PINE_COMPUTER` go in the same dialog.

### Claude Code, Codex, Cursor, Claude Desktop

```sh
claude mcp add --scope user pine-computer -- pine-computer mcp
codex mcp add pine-computer -- pine-computer mcp
```

In Cursor (`~/.cursor/mcp.json`) or Claude Desktop:

```json
{ "mcpServers": { "pine-computer": { "command": "pine-computer", "args": ["mcp"] } } }
```

`computer_task` waits up to four minutes for a job, then returns; a longer job keeps running and
`computer_wait` picks it up. MCP clients that ask for progress get each step as it happens.

### Hosted: MCP and A2A over HTTP

`pine-computer serve` runs one HTTP process for apps that can't start a process on this machine. It serves:
- MCP over Streamable HTTP at `/mcp`
- the A2A agent at `/a2a`, with its card at `/.well-known/agent-card.json`
- the desktop pages and the jobs' files

```sh
PINE_COMPUTER=my-app pine-computer serve      # http://127.0.0.1:4778
```

`/mcp` and `/a2a` take a bearer token: `PINE_SERVE_TOKEN`, or the one `serve` makes on first start and keeps
in `~/.pine-computer/serve.json`. Behind a domain, set `PINE_SERVE_HOST=0.0.0.0` and
`PINE_PUBLIC_URL=https://…`, so the links in replies and in the card use it.

An MCP client that speaks HTTP:

```sh
claude mcp add --transport http pine-computer http://127.0.0.1:4778/mcp --header "Authorization: Bearer $TOKEN"
```

```json
{ "mcpServers": { "pine-computer": { "type": "http", "url": "http://127.0.0.1:4778/mcp", "headers": { "Authorization": "Bearer …" } } } }
```

Over HTTP, `computer_task` takes no file paths (they'd name files on the client's machine), and the files a job
makes come back as links.

An A2A client finds the agent from `http://127.0.0.1:4778` (its card) and sends the token as a bearer.
Clients on A2A 1.0 and on 0.3 are both served.
- **A context is a thread** with its own session on the Computer.
- **A task is one job, across its questions.** Each finished step arrives as a `working` status, with its
  kind and page in the message metadata. The first status carries the desktop link.
- **A question ends in `input-required`.** A message on the same task answers it. A new task in that context
  drops the question and starts fresh.
- **Results.** The summary is the final status message and a `summary` artifact. Each file is an artifact of
  its own: its bytes up to 10 MB, a link above that.
- **Cancel** stops the job, or drops a question it's waiting on.

### Any other ACP client

Point it at `pine-computer acp` on stdio. It supports `session/new`, `session/load` (with the thread's
history replayed), `session/prompt` and `session/cancel`.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `PINE_SANDBOX_API_KEY`, `PINE_SANDBOX_ENDPOINT` | | The Pine project. |
| `PINE_COMPUTER` | `default` | Which Computer. Give each app, or each bot, its own name for its own identity and sign-ins; share a name to share them. |
| `PINE_SECRET_<NAME>` | | A secret the agent can type as `$NAME`. |
| `PINE_CONTEXT` | | Extra standing instructions for the agent: who it works for, house rules. |
| `PINE_IDLE_TIMEOUT_SECONDS` | `1800` | How long a Computer stays up with nothing to do. It starts again on the next message, still signed in. |
| `PINE_VIEWER_PORT` | `4777` | The desktop page's port on 127.0.0.1. |
| `PINE_SERVE_HOST`, `PINE_SERVE_PORT` | `127.0.0.1`, `4778` | Where `serve` listens. |
| `PINE_PUBLIC_URL` | `http://<host>:<port>` | The address `serve` is reached at, for the card and the links in replies. |
| `PINE_SERVE_TOKEN` | made on first start | The bearer token for `/mcp` and `/a2a`. |
| `PINE_COMPUTER_HOME` | `~/.pine-computer` | Where Computers' credentials, threads and the viewer key are kept (this user only). |

`pine-computer status` shows the Computer's state; `pine-computer stop` stops it and keeps its sign-ins;
`pine-computer desktop` prints the Computer's desktop page, starting the page process if it isn't running
(`pine-computer viewer` runs it in the foreground). A new build replaces a page process left from an older one.

## Develop

```sh
npm run dev                                              # tsc --watch
node scripts/acp-smoke.mjs "a job" "a reply" "/reload" "/cancel 8 another job"
node scripts/mcp-smoke.mjs "a job" "a reply"
```

The smoke scripts drive the bridge the way an app does and print every update. `/reload` restarts the
agent process and reopens the thread; `/cancel 8 …` cancels after eight seconds.

## Tested

Nov 8, 2026, against a real Computer:

- `run`: the top three Hacker News stories, 16 s, $0.04.
- ACP: a form filled in, a question ("Which size?"), the answer in the next message, then submitted, in
  24 s. A job cancelled mid-way; the agent process restarted and the thread reopened with its history;
  a one-page PDF made and returned to the thread's folder.
- MCP: signed in to a support portal with a `PINE_SECRET_`, reported the warranty status of three orders
  without filing anything ($0.08), then made a one-page PDF summary on the same thread ($0.07).

Nov 9, 2026, inside OpenMausBot 0.1.150 (its server from source, driven with `pnpm omb run`):

- A one-page PDF of the top five Hacker News stories, linked in the reply and saved in the conversation's
  folder, in about 85 s.
- A pizza order form filled in, a question (which size, and whether to submit), the answer in the
  conversation's next message, then submitted.
- From the app's own chat (`pnpm dev`): a weather.gov answer with its source link in about 30 s; the form
  again, with "May I submit it?" answered by a 👍 on the question, then submitted. The Computer's page
  followed the working conversation, also inside a frame sandboxed the way the app frames pinned panels.

Nov 9, 2026, `serve` on a real Computer:

- A2A 1.0 (the JS SDK's client, `scripts/a2a-smoke.mjs`), three messages in one context, 58 s in all:
  - the pizza form, ending in `input-required` with "May I submit it?";
  - the answer on the same task, then submitted;
  - "now make a one-page PDF receipt", in the same session, returned as an inline PDF artifact with its
    hosted link in the summary.
- A2A 1.0 cancel: a long job cancelled at 15 s, ending `canceled` with what it had done so far.
- A2A 0.3 (the Python `a2a-sdk` 0.3.26 client): the card, a streamed job, the final flag, `tasks/get`.
- MCP over HTTP (`scripts/mcp-smoke.mjs`): a file made and returned as a link, $0.04.
- Headless Claude Code with only the HTTP server: it wrote its own job ("report the #1 ranked story"),
  and answered with the story and its points, $0.04 on the Computer.
- The file links serve only files their thread's history names.

Not yet run inside nightly-labs OpenBot: the configuration above follows its documentation.

## Known limits

- The desktop page is served on 127.0.0.1 for the person at this machine. Each address carries a key kept
  in `~/.pine-computer/viewer.json`. The desktop takes about ten seconds to appear when a page opens.
- The person's next message answers the agent's question. There's no Allow/Deny card for approvals: the
  agent asks in words, without choices, so a card would break questions like "which size?".
- OpenMausBot words steps it has no name for by their titles ("Running Open a page"). Commands carry
  their command and read as its own do ("Ran pdfinfo").
- A job runs inside the process that started it. If that process exits mid-job, the Computer finishes the
  job, and the thread picks up from the agent's state on its next message.
- `serve` keeps A2A tasks in memory: after a restart a context carries on, but a task from before it is
  unknown. One token covers every caller.
