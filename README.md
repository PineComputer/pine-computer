<p align="center">
  <a href="https://pinecomputer.io">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/brand/mark-on-dark.svg">
      <img alt="Pine Computer" src="docs/brand/mark.svg" width="72" height="72">
    </picture>
  </a>
</p>

<h1 align="center">Pine Computer</h1>

<p align="center">
  <b>A computer built for AI. Give the agent you already use a computer of its own.</b><br>
  A whole cloud computer with an agent built in: hand it a job in plain words, watch it work,<br>
  step in when it asks, and get the finished work back.
</p>

<p align="center">
  <a href="https://pinecomputer.io">Website</a> ·
  <a href="https://console.pinecomputer.io/docs">Developer docs</a> ·
  <a href="https://pinecomputer.io/use-cases/">Use cases</a> ·
  <a href="examples/">Built on Pine Computer</a> ·
  <a href="https://discord.gg/gVawMHNde">Discord</a> ·
  <a href="https://x.com/pine_computer">X</a>
</p>

<p align="center">
  <img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-3a3a3a?style=flat-square">
  <img alt="Status: private beta" src="https://img.shields.io/badge/status-private%20beta-d69e2e?style=flat-square">
  <img alt="MCP · A2A · ACP" src="https://img.shields.io/badge/MCP%20%C2%B7%20A2A%20%C2%B7%20ACP-one%20core-2fd892?style=flat-square">
</p>

<br>

<p align="center">
  <img src="docs/showcase/pine-as-a-bot-openmausbot.gif" alt="A Pine Computer as a bot in a chat app: it takes a job, asks one question before submitting, gets a thumbs-up, and finishes, with its live desktop beside the chat" width="100%">
  <br>
  <sub>A Pine Computer as a coworker in a chat of bots: it does the job, asks before it submits, and shows its screen.</sub>
</p>

<p align="center">
  <a href="#what-it-is">What it is</a> ·
  <a href="#four-ways-in">Four ways in</a> ·
  <a href="#get-started">Get started</a> ·
  <a href="#how-a-job-goes">How a job goes</a> ·
  <a href="#built-on-pine-computer">Built on it</a> ·
  <a href="#build-it-into-your-product">SDKs</a> ·
  <a href="#status">Status</a>
</p>

<br>

<table>
  <tr>
    <td width="25%" valign="top">
      <h3>A whole computer</h3>
      A browser, a desktop, files, a shell, and document and media tools. It works across websites and business software the way a person at a desk does.
    </td>
    <td width="25%" valign="top">
      <h3>An agent built in</h3>
      Hand over a job, not a script of clicks. Your agent keeps its own model, logic and tools, and gets the finished work back.
    </td>
    <td width="25%" valign="top">
      <h3>Stays signed in</h3>
      Sign-ins belong to the Computer. The next job starts where the last one ended, and a job carries on after the chat that started it closes.
    </td>
    <td width="25%" valign="top">
      <h3>Your turn, when it matters</h3>
      It asks before it spends, sends or submits. Watch the live screen, take the controls to type a code or show it how, and hand them back.
    </td>
  </tr>
</table>

<br>

## What it is

Agents are good at deciding what to do. Most of the world's work still happens behind a sign-in, on a web
page, in a file. Pine Computer is the computer for that work: a cloud computer with its own agent, which
your product or your agent hands a job to.

This repository is the open-source way in. It holds:

- **`pine-computer`**, a CLI that puts one Computer behind the protocols agent apps already speak;
- **a skill** that teaches an agent when and how to hand work over ([`skills/pine-computer`](skills/pine-computer/SKILL.md));
- **plugins** for the agent apps that have their own plugin system ([`plugins/`](plugins/));
- **examples**: real products built on it ([`examples/`](examples/)).

## Four ways in

One core, four doors. Pick the one your app already has.

| | For | What the app sees |
| --- | --- | --- |
| **A tool** · `pine-computer mcp` | Agents that call tools: Claude Code, Codex, Cursor, chat apps with an MCP panel | Four tools: `computer_task`, `computer_wait`, `computer_cancel`, `computer_desktop` |
| **A hosted tool or agent** · `pine-computer serve` | Web apps and agent platforms, over HTTP | The same tools at `/mcp`, and an A2A agent at `/a2a` with its card |
| **A coworker** · `pine-computer acp` | Apps that run agents over the Agent Client Protocol: OpenMausBot, nightly-labs OpenBot, Zed | A bot. Each chat thread is a thread on the Computer; its steps show as it works; its summary is the reply |
| **The terminal** · `pine-computer run "…"` | You | One job, its steps as it goes |

As a tool, your agent stays in charge and hands over the computer work. As a coworker, the Computer is a
bot of its own. [`docs/cli.md`](docs/cli.md) is the full reference.

## Get started

Pine Computer is in private beta. [Request access at pinecomputer.io](https://pinecomputer.io) for a key.

Node.js 22 or newer.

```sh
git clone https://github.com/PineComputer/pine-computer && cd pine-computer
npm install && npm run build && npm link          # puts `pine-computer` on your PATH

mkdir -p ~/.pine-computer && chmod 700 ~/.pine-computer
printf 'PINE_SANDBOX_API_KEY=…\nPINE_SANDBOX_ENDPOINT=…\n' > ~/.pine-computer/env && chmod 600 ~/.pine-computer/env

pine-computer run "Open https://news.ycombinator.com and tell me the top 3 stories."
```

Then give it to your agent.

**Claude Code**, as a plugin (the tools and the skill together):

```
/plugin marketplace add PineComputer/pine-computer
/plugin install pine-computer@pine-computer
```

**Claude Code, Codex, Cursor**, as an MCP server:

```sh
claude mcp add --scope user pine-computer -- pine-computer mcp
codex mcp add pine-computer -- pine-computer mcp
```

```json
{ "mcpServers": { "pine-computer": { "command": "pine-computer", "args": ["mcp"] } } }
```

**DeepSeek Harness**: [`plugins/deepseek-harness`](plugins/deepseek-harness).

**OpenMausBot, nightly-labs OpenBot, hosted MCP and A2A**: [`docs/cli.md`](docs/cli.md).

Then ask for something that needs a computer:

> Use the Pine Computer to open quotes.toscrape.com, collect the first two pages of quotes, and make me a
> one-page PDF brief of them grouped by author.

## How a job goes

- **A message starts a job.** The Computer's agent works on its own. Its steps stream back as it goes
  ("Open a page", "Fill in “Email address”", "Create report.pdf"), and its summary is the reply.
- **A question ends the turn.** When it needs something only the person has, or before anything that spends
  money, sends or submits, it stops and asks. The person's next message answers it.
- **The thread remembers.** Each thread has its own session on the Computer, so a follow-up ("now make it a
  PDF") builds on what it did. Sign-ins are shared by every thread.
- **The screen is there.** Every thread has a live desktop page: watch the Computer work, take the controls,
  hand them back.
- **Files come back.** Files a job makes are copied next to your workspace and linked in the reply. Files you
  attach go up to the Computer with the message.
- **Passwords stay out of the model.** A named secret is typed by the Computer as `$NAME` without the model
  seeing it.

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/showcase/pine-as-a-bot-openmausbot.gif" alt="The Computer as a bot: a question, a thumbs-up, the claim submitted, the desktop showing the result" width="100%"><br>
      <sub><b>As a coworker:</b> a bot in the chat, with its own screen.</sub>
    </td>
    <td width="50%" valign="top">
      <img src="docs/showcase/pine-as-a-tool-openmausbot.gif" alt="The Computer as a tool: a Claude bot hands the job over, relays the Computer's question and passes the answer back" width="100%"><br>
      <sub><b>As a tool:</b> another agent hands the job over and relays the question.</sub>
    </td>
  </tr>
</table>

## Built on Pine Computer

Real products, each with its own model, logic and interface:

- **[Pine Computer starter](https://github.com/PineComputer/pine-computer-starter)**: a complete product to
  rename and ship. Sessions side by side, the work live, the controls, skills, a vault, files in and out.
- **[Pine Drama Studio](https://github.com/PineComputer/open-pinedrama)**: a studio for makers of AI
  vertical short dramas.
- **Pine Computer × Tavus**: a video agent takes a customer's call and hands the claim to a Pine Computer,
  which files it while they talk. Opening soon.

More in [`examples/`](examples/).

## Build it into your product

The CLI in this repository is built on the same SDKs your product can use directly: create a Computer, hand
it a job, embed its live screen, take the controls, bring the work back.

- Server SDK for TypeScript: [`@pinesandbox/computer`](https://www.npmjs.com/package/@pinesandbox/computer)
- Web SDK, the live desktop in your page: [`@pinesandbox/computer-web`](https://www.npmjs.com/package/@pinesandbox/computer-web)
- Every SDK and the full guide: [developer docs](https://console.pinecomputer.io/docs)

The [starter](https://github.com/PineComputer/pine-computer-starter) is the shortest path from the SDK to a
product.

## Status

Private beta. What has been run end to end:

| | State |
| --- | --- |
| Claude Code, over MCP | Run |
| Codex, over MCP | Run |
| OpenMausBot, as a coworker (ACP) and as a tool (MCP) | Run |
| A2A agent and hosted MCP (`pine-computer serve`) | Run against the protocol's own clients |
| Cursor, Claude Desktop, nightly-labs OpenBot | Configuration given, not yet run by us |
| DeepSeek Harness plugin | Loads in dsh, with its tools and skill registered; no job run through it yet |

## License

[Apache-2.0](LICENSE). Built by [Pine AI](https://pinecomputer.io).
