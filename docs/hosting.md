# Hosting it for many projects

`pine-computer serve` puts one Computer behind MCP, A2A and AG-UI for one person, with their key in the
environment. The same process, with `PINE_HOSTED=1`, serves every project: each caller sends its own Pine
Computer project key as the bearer token, and reaches only its own Computer and threads.

```sh
docker build -t pine-computer .
docker run -p 8080:8080 \
  -e PINE_SANDBOX_ENDPOINT=… \
  -e PINE_PUBLIC_URL=https://agents.example.com \
  -e PINE_DATABASE_URL=postgres://… \
  -e PINE_STORE_KEY="$(openssl rand -base64 32)" \
  pine-computer
```

| Setting | What it is |
| --- | --- |
| `PINE_HOSTED=1` | The bearer token is the caller's project key. Set in the image. |
| `PINE_SANDBOX_ENDPOINT` | The platform every project's key is for. |
| `PINE_PUBLIC_URL` | The address people reach the service at. The desktop and file links in replies start with it. |
| `PINE_DATABASE_URL` | Postgres. Records are kept in one table, `pine_computer_store`, made on first start. Without it they are files under `PINE_COMPUTER_HOME`, which suits one process only. |
| `PINE_STORE_KEY` | 32 random bytes in base64. Seals what is stored and signs the links. Keep it: without it the records can't be read and every link stops working. |

An app then adds Pine Computer with one address and one key:

| | Address |
| --- | --- |
| MCP | `https://agents.example.com/mcp` |
| A2A | `https://agents.example.com/.well-known/agent-card.json` |
| AG-UI | `https://agents.example.com/agui` |

## How it holds together

- **The key is checked, not kept.** A project's key is checked with the platform the first time a process sees
  it, and held in memory only. What is stored sits under a name derived from the key.
- **The platform keeps the job.** A job is a turn on the project's Computer. A thread records its turn in
  flight, so any process follows it to its end: a client that comes back after a restart, or reaches another
  process, gets the steps it missed and the result. An end nobody was connected to hear is kept and told once.
- **A link reaches one thing.** A desktop link is signed for one conversation, a file link for one thread's
  files. Neither carries the key, so both can be pasted into a chat. They don't expire.
- **Records are sealed.** They hold session tokens, which can run a shell on a Computer. The desktop page gets a
  short-lived desktop token for one session instead.

## Limits today

- Files a job returns are on the disk of the process that followed the job. With more than one process they
  need shared storage, which isn't built yet.
- A2A tasks are kept in memory: an A2A client loses its task when the process restarts. MCP and AG-UI don't.
- When a project has every session on its Computer in use, the service closes the one used longest ago. With
  more than one process it can't yet tell that another process has a job running in it.
- `PINE_SECRET_*` values are for the single-person CLI. A hosted project has no named secrets yet.
