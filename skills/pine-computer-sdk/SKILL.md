---
name: pine-computer-sdk
description: Build Pine Computer into a product with its SDKs. Use when writing or changing code that creates a Pine Computer, hands its agent a job, shows its live desktop in a page, lets a person take the controls, or moves files in and out, in TypeScript, Go, Ruby or Python. Not for handing a job to a Computer from this chat; that is the pine-computer skill.
---

# Build with Pine Computer

A Pine Computer is a cloud computer with an agent built in. A product gives it a job in plain words, shows
its screen to the person, lets them step in, and gets the finished work back. The product keeps its own
model, logic and interface.

This skill tells you which way in fits and where the facts are. It does not restate the API: the API belongs
to the SDK version the project has installed, and the guide for that version ships inside the package.

## Pick the way in

| The job | Use |
| --- | --- |
| An agent or chat app should be able to hand work to a Computer | The tools or a bot from this repository (`pine-computer mcp`, `acp`, `serve`). No SDK code. See `docs/cli.md`. |
| A product of your own should run Computers for its users | A server SDK in the backend, and the web SDK in the page that shows the desktop. |
| A new product, from nothing | Copy `examples/starter` and change it. It already has sessions, the live work, the controls, files and a vault. |

## Read the guide for the version in the project

Do this before writing any SDK call. Don't write one from memory.

1. **Find the SDK the project uses**: the dependency in its manifest (`package.json`, `go.mod`, `Gemfile`,
   `pyproject.toml`), and the version its lockfile resolves to.
2. **Read the guide that came with it.** In a JavaScript project, resolve the package from the app's own
   folder (in a workspace it may sit in a parent `node_modules`) and read its `README.md` and `CHANGELOG.md`:
   - `@pinesandbox/computer`: the server SDK. Computers, sessions, Pine's agent, files, artifacts, control,
     skills, errors.
   - `@pinesandbox/computer-web`: the browser SDK. The `<pine-desktop>` element and its React and Vue adapters.

   For Go (`go.pinesandbox.io/computer`), Ruby (`pinesandbox`) and Python (`pinesandbox`), read the README
   inside the installed module, gem or wheel. They have the same objects and verbs as the TypeScript SDK.
3. **Not installed yet?** Install the SDK first, then read what was installed. If you can't install, say so
   and use the integration guide at https://console.pinecomputer.io/docs/integration, and tell the person the
   guide may be for a newer version than the one they end up with.
4. **A type or method the guide doesn't cover**: read the package's type declarations. If it isn't there, it
   isn't in that version.

## What holds in every version

- **The server SDK runs on the server only.** It holds the project key, the Computer's credentials and the
  session tokens, and it refuses to load in a browser.
- **The browser gets one thing**: a short-lived desktop connection your backend issues for one session, for a
  signed-in user, with `Cache-Control: no-store`. Never send the project key or a session token to a page.
- **Save what the SDK tells you to save.** A Computer's credentials are the only way to start it again. Store
  them like any other secret, per user or per workspace.
- **Hand over the job, not the clicks.** Give Pine's agent the goal and what done looks like. Stream its
  activity to the person; don't script the browser step by step.
- **Build the question and the take-over into the product.** The agent can stop and ask, and a person can take
  the controls and hand them back. A product that only shows a spinner until the result has thrown away the
  two things people need most.
- **Decide what needs the person's yes in your own code.** If your product must never spend, send or submit
  without approval, say so in the goal and check it in your flow. Don't rely on the agent's habit alone.

## Before you say it works

Run it against a real Computer with a real key: create one, hand it a small job, watch the activity arrive,
open the desktop in the page, take and release control, and bring one file back. A type-check is not a run.
