# Contributing

Issues and pull requests are welcome,
most of all an integration with an agent app we haven't covered.

## Layout

| | |
| --- | --- |
| `src/core/` | The one core: a Computer, its threads, where their files go. Every way in uses it. |
| `src/jobs.ts` | The jobs a tool-shaped way in has handed over, and how one reports. Shared by the MCP tools and the plugins. |
| `src/mcp/`, `src/a2a/`, `src/acp/`, `src/agui/` | One thin adapter per protocol. No job logic lives here. |
| `src/viewer/` | The live desktop pages. |
| `src/hosted/` | One service for many projects, each by its own key. Loaded only with `PINE_HOSTED=1`; see `docs/hosting.md`. |
| `skills/pine-computer/` | The hand-over skill: when and how an agent gives a job to a Computer. It describes the tools in `src/mcp`, so change them together. |
| `skills/pine-computer-sdk/` | The build skill: how a coding agent builds Pine Computer into a product. It sends the agent to the guide inside the installed SDK, and never restates the API. |
| `plugins/` | One folder per agent app that has its own plugin system. |
| `examples/` | Whole products built on Pine Computer, brought in from their own repositories with `git subtree`. Change them there, then pull. |
| `docs/cli.md` | The CLI reference. |

## Build and check

Node.js 22 or newer, and a Pine Computer key in `~/.pine-computer/env` (see the README).

```sh
npm install
npm run build
npm run check        # types, and two projects kept apart on one store (no key needed)
node scripts/mcp-smoke.mjs "Open https://example.com and tell me its heading."
node scripts/a2a-smoke.mjs "Open https://example.com and tell me its heading."
node scripts/agui-smoke.mjs "Open https://example.com and tell me its heading."
node scripts/acp-smoke.mjs "Open https://example.com and tell me its heading."
node scripts/recover-smoke.mjs   # a job sent by a process that died is found again, not sent twice
```

Each smoke script drives one way in the way a real client would and prints what came back. They run real
jobs on a real Computer.

## Adding an integration

- **The app speaks MCP, A2A, AG-UI or ACP:** it likely works already. Add its set-up steps to `docs/cli.md`, and
  say plainly what you ran and what you didn't.
- **The app has its own plugin system:** add `plugins/<app>/`, built on `src/core/`, exposing the same four
  tools with the same descriptions, and shipping the skill if the app has skills.
- **A new protocol:** one adapter folder in `src/`, on the core. If it needs logic the core lacks, the core
  grows; the adapter stays thin.

## Commits

[Conventional Commits](https://www.conventionalcommits.org): `feat: …`, `fix: …`, `docs: …`. The subject
states the change; the body says why.

## Security

Never commit a key, a token or a `.env` file. To report a vulnerability, write to us through
[pinecomputer.io](https://pinecomputer.io) rather than opening a public issue.
