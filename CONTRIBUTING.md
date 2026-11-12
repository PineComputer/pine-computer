# Contributing

Pine Computer is in private beta, and this repository is young. Issues and pull requests are welcome,
most of all an integration with an agent app we haven't covered.

## Layout

| | |
| --- | --- |
| `src/core/` | The one core: a Computer, its threads, where their files go. Every way in uses it. |
| `src/jobs.ts` | The jobs a tool-shaped way in has handed over, and how one reports. Shared by the MCP tools and the plugins. |
| `src/mcp/`, `src/a2a/`, `src/acp/` | One thin adapter per protocol. No job logic lives here. |
| `src/viewer/` | The live desktop pages. |
| `skills/pine-computer/` | The skill: when and how an agent hands work over. |
| `plugins/` | One folder per agent app that has its own plugin system. |
| `examples/` | Whole products built on Pine Computer, brought in from their own repositories with `git subtree`. Change them there, then pull. |
| `docs/cli.md` | The CLI reference. |

## Build and check

Node.js 22 or newer, and a Pine Computer key in `~/.pine-computer/env` (see the README).

```sh
npm install
npm run build
node scripts/mcp-smoke.mjs "Open https://example.com and tell me its heading."
node scripts/a2a-smoke.mjs "Open https://example.com and tell me its heading."
node scripts/acp-smoke.mjs "Open https://example.com and tell me its heading."
```

Each smoke script drives one way in the way a real client would and prints what came back. They run real
jobs on a real Computer.

## Adding an integration

- **The app speaks MCP, A2A or ACP:** it likely works already. Add its set-up steps to `docs/cli.md`, and
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
