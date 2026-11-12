# Hosting it for many projects

`pine-computer serve` puts one Computer behind MCP, A2A and AG-UI for one person, with their key in the
environment. The same server, started with `PINE_HOSTED=1`, serves many projects: each caller sends its own
Pine Computer project key as the bearer token, and reaches only its own Computer and threads. The code is in
[`src/hosted`](../src/hosted); nothing in it is loaded otherwise.

```sh
docker build -t pine-computer .
docker run -p 8080:8080 -v pine-computer-data:/data \
  -e PINE_SANDBOX_ENDPOINT=… \
  -e PINE_PUBLIC_URL=https://agents.example.com \
  -e PINE_STORE_KEY="$(openssl rand -base64 32)" \
  pine-computer
```

| Setting | What it is |
| --- | --- |
| `PINE_HOSTED=1` | The bearer token is the caller's project key. Set in the image. |
| `PINE_SANDBOX_ENDPOINT` | The platform every project's key is for. |
| `PINE_PUBLIC_URL` | The address people reach the service at. The desktop and file links in replies start with it. |
| `PINE_STORE_KEY` | 32 random bytes in base64. Signs the links and seals what Postgres stores. Keep it: without it every link stops working and the stored records can't be read. |
| `PINE_DATABASE_URL` | Optional. Postgres, for records that outlive the disk: one table, `pine_computer_store`, made on first start. Needs the `pg` package, which the image has. Without it the records are files under `/data`. |

An app then adds Pine Computer with one address and one key:

| | Address |
| --- | --- |
| MCP | `https://agents.example.com/mcp` |
| A2A | `https://agents.example.com/.well-known/agent-card.json` |
| AG-UI | `https://agents.example.com/agui` |

## How it holds together

- **The key is checked, not kept.** A project's key is checked with the platform when a process first sees
  it and again every five minutes, so a revoked key stops working within that time. It is held in memory only.
- **Records sit under the key's name.** The platform doesn't yet say which project a key belongs to, so what
  is stored sits under a name derived from the key. A project that changes its key starts with a new Computer.
- **The platform keeps the job.** A job is a turn on the project's Computer. A thread writes its job down
  before sending it, so a process that didn't start the job can follow it to its end: a client that comes back
  after a restart gets the steps it missed and the result. An end nobody was connected to hear is kept and
  told once.
- **A link reaches one thing, for a while.** A desktop link is signed for one conversation, a file link for
  one thread's files. Neither carries the key, so both can be pasted into a chat. A desktop link lets its
  holder watch and take the controls of that conversation, so it opens for an hour. A page that stays open
  keeps working for up to twelve hours, then asks for a new link; every reply in the chat carries a new one.
  A file link downloads for seven days. The connection to the screen itself is separate and shorter: the
  page asks for a fresh one, good for minutes, each time it connects.
- **Files a job made can't run here.** A file that could run script in a browser (a web page, an SVG) is
  downloaded, never shown on the service's origin.

## Run one instance

Run a single instance with a volume at `/data`. It restarts cleanly: jobs in flight are picked up, and with
Postgres the records don't depend on the volume. More than one instance isn't supported yet, for three
reasons:

- Files a job returns are on the disk of the process that followed the job.
- An MCP client's connection, and an A2A client's task, belong to the process that opened them. An A2A client
  also loses its task when that process restarts; MCP and AG-UI clients don't lose their job.
- When a project has every session on its Computer in use, the service closes the one used longest ago, and
  it can't tell that another process has a job running in it.

`PINE_SECRET_*` values are for the single-person CLI. A hosted project has no named secrets yet.
