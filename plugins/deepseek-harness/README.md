# Pine Computer for DeepSeek Harness

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) plugin that gives the agent a
Pine Computer: a cloud computer with a browser, a desktop, files and document tools, and an agent of its
own. The dsh agent hands it a job in plain words. The Computer does the work, stops to ask when it needs
the person, and returns a summary and the files it made.

The plugin adds to a profile:

| | |
|---|---|
| `computer_task` | hand over a job, answer the Computer's question, or follow up on a thread |
| `computer_wait` | keep waiting for a job that is still running |
| `computer_cancel` | stop a job |
| `computer_desktop` | a link where the person watches the Computer live and takes the controls |
| the `pine-computer` skill | when to hand work over, and how |

They are the same four tools, with the same descriptions and replies, as `pine-computer mcp`, registered
on dsh's own tool registry. No MCP server is involved.

## Install

It is a dsh bundle, so it installs into a profile with `dsh plugin`. The package is not on npm yet;
install it from a checkout of this repository:

```sh
cd plugins/deepseek-harness
npm install            # also builds lib/
dsh plugin --profile web add "$PWD"
```

Check that the layer is there, then start dsh as usual:

```sh
dsh --profile web --dump-config | grep -A4 dsh-plugin-pine-computer
dsh web
```

`dsh plugin --profile web remove dsh-plugin-pine-computer` takes it out again. On the Plugins page the
bundle and its two rows (the tools, the skill) can be switched off one by one.

Needs dsh 0.2.2 or later in the 0.2 line, and Node 22 or later.

## Configure

The plugin needs a Pine project key. It asks dsh's credential store for `PINE_SANDBOX_API_KEY`, which
finds the key in any of these places:

- stored in dsh under that name;
- the environment dsh was started in: `PINE_SANDBOX_API_KEY=... dsh web`;
- a `.env` file in the project folder or in `$DSH_HOME`.

If dsh has none, the plugin reads `~/.pine-computer/env`, where the `pine-computer` CLI keeps it. The key
never goes into a profile file.

Other settings go on the plugin's row, in the profile's `cordis.patch.yml`:

```yaml
- id: pine-computer
  config:
    apiKeyEnv: PINE_SANDBOX_API_KEY   # the name the key is stored under
    endpoint: https://...             # PINE_SANDBOX_ENDPOINT, when it isn't the default
    computer: default                 # which Computer this profile uses; each keeps its own sign-ins
    waitSeconds: 240                  # how long a tool call waits before it returns "still working"
```

All four are optional. A patch replaces a row's whole `config`, so write every setting you want to keep.

## Try it

> Use the Computer to find the three most recent posts on the Hacker News front page about databases,
> and give me a PDF with their titles, links and a two-line summary of each.

The agent calls `computer_task` once with the whole job. While the job runs it can give you the desktop
link; if the Computer asks a question, the agent passes it to you and sends your answer back on the same
thread. Files the job makes are copied to `pine-computer-files/` in the session's folder.

## How it behaves in dsh

- A job runs in the dsh process and outlives the tool call that started it. `computer_task` waits up to
  `wait_seconds`, then reports `state: working`, and `computer_wait` picks the job up.
- Stopping the agent during `computer_task` cancels that job, because the agent hasn't yet been told
  which thread it is. Stopping it during `computer_wait` only stops the waiting.
- The desktop pages are served by a small process of their own on `127.0.0.1` (port 4777, or
  `PINE_VIEWER_PORT`). The plugin starts it on first use and leaves it running, so a link still works
  after dsh exits.
- Threads, sign-ins and the Computer's record live in `~/.pine-computer` (or `PINE_COMPUTER_HOME`), shared
  with the `pine-computer` CLI on the same machine.

## Develop

```sh
npm run check    # type-check against the published dsh packages
npm run build    # lib/, with the core from ../../src compiled in, and the skill copied to assets/
```

The tools reuse `src/core` of this repository. dsh loads a plugin as an installed package, which can't
reach files outside itself, so the build compiles the core into `lib/`.
