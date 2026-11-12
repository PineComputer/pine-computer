---
name: pine-computer
description: Hand work that needs a real computer to a Pine Computer, a cloud computer with its own agent. Use when a job means signing in to a website, clicking through pages, filling in and submitting forms, working across several sites or business tools, or producing a finished file (a PDF, a spreadsheet, a deck) from what it finds. Not for work this agent can finish with its own tools, such as reading one public page or editing local files.
---

# Pine Computer

A Pine Computer is a whole cloud computer with a browser, a desktop, files, and document and media tools. It
has an agent of its own. You hand it a job in plain words, it does the work, and it gives you back a summary
and the files it made. It stays signed in to the sites it has used, so the next job starts where the last
one ended.

You reach it through four tools: `computer_task`, `computer_wait`, `computer_cancel` and `computer_desktop`.
If they are missing, the Pine Computer server isn't connected: tell the person to run
`pine-computer mcp` as an MCP server, or to install this plugin.

## When to hand a job over

Hand it over when the work needs a computer that you don't have:

- a site that needs a sign-in, or a session that has to stay signed in;
- a task with many steps across pages: search, compare, fill in, review, submit;
- a form, a booking, an order, a claim, an upload;
- a finished document built from what it finds on the way.

Keep the work yourself when your own tools finish it faster: reading a public page, calling an API you
already have, editing files in this workspace.

## How to hand a job over

1. **Give the whole job, not a step.** Write what a capable colleague would need: the goal, the sites or
   accounts involved, what the finished work looks like, and anything it must not do. Don't script clicks.
   One `computer_task` call per job.
2. **Use a thread per piece of work.** Follow-ups on the same thread build on what it did ("now make it a
   PDF"). A new piece of work gets a new thread.
3. **Wait, don't repeat.** `computer_task` returns when the job is done, when it has a question, or after a
   few minutes with the job still running. If it is still running, call `computer_wait`; never send the
   same task again.
4. **Pass its questions to the person, word for word.** The Computer stops and asks before anything that
   spends money, sends or submits, and whenever it needs something only the person has. Don't answer for
   them. Send their answer back as the next `computer_task` on the same thread.
5. **Offer the screen.** `computer_desktop` gives a link where the person watches the Computer work live,
   takes the controls (to type a code, pass a check, or show it how) and hands them back. Offer it when the
   job needs a sign-in or the person wants to see it.
6. **Bring the work back.** Tell the person what was done and where the files are. Files a job makes are
   copied next to this workspace and linked in the reply.

## Rules

- Never put a password, a card number or a one-time code in a task. The person types those on the desktop
  page, or the operator sets a named secret the Computer can use without seeing it.
- Never approve on the person's behalf. A yes to "shall I submit it?" comes from them.
- Say what the Computer did in its words. Don't claim a result the reply doesn't show.
- If a job fails or stalls, say so, and use `computer_cancel` before starting over.
