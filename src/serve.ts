// `pine-computer serve`: the Computer over HTTP, for web apps, hosted chat apps and agent platforms that
// can't start a process on this machine. One origin serves MCP (Streamable HTTP) at /mcp, the A2A agent at
// /a2a with its card at /.well-known/agent-card.json, the AG-UI agent at /agui, and the desktop pages and the
// jobs' files. /mcp, /a2a and /agui take a bearer token; the pages and files carry a key in their address,
// like a share link.

import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { AGENT_CARD_PATH, AgentCard } from "@a2a-js/sdk";
import { legacyAgentCardRouter } from "@a2a-js/sdk/compat/v0_3/server/express";
import { DefaultRequestHandler, InMemoryTaskStore, type User } from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler } from "@a2a-js/sdk/server/express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, { type Request, type RequestHandler, type Response } from "express";
import { agentCard, PineExecutor } from "./a2a/agent.js";
import { aguiHandler } from "./agui/agent.js";
import { at, log } from "./core/home.js";
import { inScope, local, scoped } from "./core/store.js";
import { mcpServer } from "./mcp/server.js";
import { handleViewer, hostViewer } from "./viewer/server.js";

const HOST = process.env.PINE_SERVE_HOST ?? "127.0.0.1";
const PORT = Number(process.env.PINE_SERVE_PORT ?? 4778);

/** PINE_SERVE_TOKEN, or one made on first start and kept in serve.json. */
async function token(): Promise<string> {
  if (process.env.PINE_SERVE_TOKEN) return process.env.PINE_SERVE_TOKEN;
  const saved = await local.get<{ token: string }>(["serve"]);
  if (saved?.token) return saved.token;
  const fresh = randomBytes(24).toString("base64url");
  await local.set(["serve"], { token: fresh });
  return fresh;
}

/** Every caller with the token is the same app, so A2A's per-user task scope is one scope. */
const APP: User = { isAuthenticated: true, userName: "app" };

export async function serve(): Promise<void> {
  const origin = (process.env.PINE_PUBLIC_URL ?? `http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}`).replace(/\/+$/, "");
  // PINE_HOSTED=1: one service for many projects, each by its own key. See src/hosted.
  const many = process.env.PINE_HOSTED === "1" ? await (await import("./hosted/index.js")).hosted() : null;
  const expected = Buffer.from(many ? "" : await token());
  hostViewer(origin, many ?? undefined);

  const auth: RequestHandler = async (req, res, next) => {
    const sent = req.get("authorization") ?? "";
    const given = Buffer.from(/^Bearer (.+)$/i.exec(sent)?.[1] ?? "");
    if (many) {
      // Some chat apps send their key field as the whole header.
      const key = given.toString() || sent.trim();
      try {
        const project = key ? await many.project(key) : null;
        if (project) return inScope(project, () => {
          res.locals.project = project.project;
          next();
        });
      } catch (error) {
        log("checking a project key failed:", error);
        return void res.status(503).json({ error: "The key couldn't be checked just now. Try again." });
      }
      return void res.status(401).set("www-authenticate", 'Bearer realm="pine-computer"').json({ error: "A Pine Computer project key is required as the bearer token." });
    }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
    res.status(401).set("www-authenticate", 'Bearer realm="pine-computer"').json({ error: "A bearer token is required: the one in ~/.pine-computer/serve.json, or PINE_SERVE_TOKEN." });
  };

  const app = express();
  app.disable("x-powered-by");
  app.get("/health", (_req, res) => void res.json({ app: "pine-computer", serves: ["mcp", "a2a", "agui", "desktop"] }));

  // A2A: the card is public, so a client can find out how to authenticate; the agent takes the token.
  const card = agentCard(origin);
  const a2a = new DefaultRequestHandler(card, new InMemoryTaskStore(), new PineExecutor());
  // A 0.3 client gets the card converted by the SDK; a 1.0 client gets it in the protocol's JSON form (the SDK's
  // own 1.0 handler writes its in-memory shape as it is).
  app.use(
    `/${AGENT_CARD_PATH}`,
    (_req, res, next) => (res.append("vary", "A2A-Version"), next()),
    legacyAgentCardRouter({ agentCardProvider: async () => card }),
    agentCardHandler({ agentCardProvider: async () => AgentCard.toJSON(card) as AgentCard }),
  );
  app.use("/a2a", auth, jsonRpcHandler({ requestHandler: a2a, userBuilder: async (req) => (many ? { isAuthenticated: true, userName: String((req as Request).res?.locals.project) } : APP), legacyCompat: { enabled: true } }));

  // AG-UI: one POST per run, answered with a stream of events. A message may carry the person's files inline.
  app.post("/agui", auth, express.json({ limit: "32mb" }), aguiHandler());

  // MCP: a server of its own per client session; the jobs belong to the process.
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  app.post("/mcp", auth, express.json({ limit: "4mb" }), async (req: Request, res: Response) => {
    const id = req.get("mcp-session-id");
    let transport = id ? sessions.get(scoped(id)) : undefined;
    if (!transport) {
      if (id) return void res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
      if (!isInitializeRequest(req.body)) return void res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Start with initialize" }, id: null });
      // A session belongs to the project that opened it: another project naming it finds nothing.
      let held = "";
      const fresh = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (sid) => void sessions.set((held = scoped(sid)), fresh) });
      fresh.onclose = () => void sessions.delete(held);
      await mcpServer({ hosted: true }).connect(fresh);
      transport = fresh;
    }
    await transport.handleRequest(req, res, req.body);
  });
  const existing: RequestHandler = async (req, res) => {
    const transport = sessions.get(scoped(req.get("mcp-session-id") ?? ""));
    if (!transport) return void res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
    await transport.handleRequest(req, res);
  };
  app.get("/mcp", auth, existing);
  app.delete("/mcp", auth, existing);

  // The desktop pages and the files, on the same origin as the links the replies carry.
  app.use((req, res) => void handleViewer(req, res));

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(PORT, HOST, (error?: Error) => (error ? reject(error) : resolve()));
    server.on("error", reject);
  });
  console.log(`Serving Pine Computer "${process.env.PINE_COMPUTER || "default"}" on ${origin}`);
  console.log(`  MCP   ${origin}/mcp`);
  console.log(`  A2A   ${origin}/${AGENT_CARD_PATH}`);
  console.log(`  AG-UI ${origin}/agui`);
  console.log(many ? "  Token each caller's own project key" : `  Token PINE_SERVE_TOKEN, or the one in ${at("serve.json")}`);
}
