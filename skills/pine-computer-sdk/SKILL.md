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
| An agent or chat app should be able to hand work to a Computer | The tools or a bot from the `pine-computer` CLI (`pine-computer mcp`, `acp`, `serve`). No SDK code. See `docs/cli.md`. |
| A product of your own should run Computers for its users | A server SDK in the backend, and the web SDK in the page that shows the desktop. |
| A new product, from nothing | Copy `examples/starter` and change it. It already has sessions, the live work, the controls, files and a vault. |

`docs/cli.md` and `examples/starter` are in https://github.com/PineComputer/pine-computer. If that repository
isn't on disk, read them there.

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
3. **Not installed yet?** Install the SDK first, then read what was installed: `npm install
   @pinesandbox/computer` (Node.js 22 or later), and `@pinesandbox/computer-web` for a page that shows the
   desktop. The project key and the endpoint come from the Console (https://console.pinecomputer.io) and go
   in the server's environment; the guide names the variables. If you can't install, say so and use the
   integration guide at https://console.pinecomputer.io/docs/integration, and tell the person the guide may
   be for a newer version than the one they end up with.
4. **A type or method the guide doesn't cover**: read the package's type declarations. If it isn't there, it
   isn't in that version.

## What holds in every version

- **The server SDK runs on the server only.** It holds the project key, the Computer's credentials and the
  session tokens, and it refuses to load in a browser.
- **The browser gets one thing**: a desktop connection your backend issues for one session, for a signed-in
  user, with `Cache-Control: no-store`. It lasts minutes, so the page asks for a fresh one each time it
  connects. Never send the project key or a session token to a page.
- **Save three things, as secrets, per user or per workspace.** The Computer's credentials, before you create
  it: they are the only way to start it again. Its binding, after every create and every start. A session's
  name and token, if the session is to be continued later.
- **Hand over the job, not the clicks.** Give Pine's agent the goal and what done looks like; don't script the
  browser step by step, even where the guide shows how.
- **Activity is for showing, waiting is for the outcome.** The stream of the agent's activity doesn't end by
  itself when the job does: wait on the turn for its result, and end the stream then. A step arrives once as
  it starts and again with its outcome. Where nothing shows the screen, turn the screen frames off.
- **Build the question and the take-over into the product.** The agent can stop and ask, and a person can take
  the controls and hand them back. A product that only shows a spinner until the result has thrown away the
  two things people need most.
- **Decide what needs the person's yes in your own code.** If your product must never spend, send or submit
  without approval, say so in the goal and check it in your flow. Don't rely on the agent's habit alone.
- **Stop what you started.** A script or a test stops its Computer when it is done, also when it fails, and
  treats a stop that isn't confirmed as not stopped. A product lets the idle timeout do it.

## Before you say it works

Run it against a real Computer with a real key. A type-check is not a run.

- **A backend**: create a Computer, hand it a small job, see the activity arrive and the result come back,
  issue a desktop connection, stop the Computer.
- **A product with a page**: all of that, and open the desktop in the page, take the controls and hand them
  back, and bring one file back.
