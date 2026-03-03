import Fastify from "fastify";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import type { ServerResponse, IncomingMessage } from "http";

// --- Config ---
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8888;
const htmlCanvas = readFileSync(join(__dirname, "index.html"), "utf-8");

// --- State ---
const clients = new Map<string, ServerResponse>();
const generateId = () => randomBytes(3).toString("hex").slice(0, 5);

function removeClient(id: string) {
  clients.delete(id);
}

// --- App ---
const app = Fastify({
  logger: process.env.VERCEL
    ? true
    : { transport: { target: "pino-pretty", options: { colorize: true } } },
});

app.get("/", async (_req, reply) => {
  reply.type("text/html").send(htmlCanvas);
});

app.get("/stream", (req, reply) => {
  const id = generateId();

  reply.hijack();

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Send initial event with the assigned client ID
  reply.raw.write(`event: connected\ndata: ${JSON.stringify({ clientId: id })}\n\n`);

  clients.set(id, reply.raw);
  app.log.info({ clientId: id, ip: req.ip, total: clients.size }, "SSE client connected");

  // Detect disconnects from all possible sources
  const cleanup = () => {
    removeClient(id);
    app.log.info({ clientId: id, total: clients.size }, "SSE client disconnected");
  };
  reply.raw.on("close", cleanup);
  reply.raw.on("error", cleanup);
  req.raw.on("aborted", cleanup);
});

app.get("/clients", async () => [...clients.keys()]);

app.post<{ Body: { data: string; clientId?: string } }>("/send", async (req) => {
  const { data, clientId } = req.body;
  const message = `data: ${data}\n\n`;

  // Targeted send
  if (clientId) {
    const client = clients.get(clientId);
    if (!client) return { ok: false, error: "client not found", active: clients.size };
    client.write(message);
    return { ok: true, sent: 1, active: clients.size };
  }

  // Broadcast to all clients
  for (const client of clients.values()) {
    client.write(message);
  }
  return { ok: true, sent: clients.size, active: clients.size };
});

// --- Vercel handler ---
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await app.ready();
  app.server.emit("request", req, res);
}

// --- Local dev ---
if (!process.env.VERCEL) {
  app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
    app.log.info(`Listening on ${PORT}`);
  });
}