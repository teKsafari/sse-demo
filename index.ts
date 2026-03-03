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



// --- App ---
const app = Fastify();

app.get("/", async (_req, reply) => {
  reply.type("text/html").send(htmlCanvas);
});

app.get("/stream", (req, reply) => {
  const id = generateId();

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive", 
  });

  reply.raw.write(`event: connected\ndata: ${JSON.stringify({ clientId: id })}\n\n`);
  clients.set(id, reply.raw);
  req.raw.on("close", () => clients.delete(id));
});

app.get("/clients", async () => [...clients.keys()]);

app.post<{ Body: { data: string; clientId?: string } }>("/send", async (req) => {
  const { data, clientId } = req.body;

  if (clientId) {
    const client = clients.get(clientId);
    if (!client) return { ok: false, error: "client not found" };
    client.write(`data: ${data}\n\n`);
    return { ok: true, sent: 1 };
  }

  for (const client of clients.values()) {
    client.write(`data: ${data}\n\n`);
  }
  return { ok: true, sent: clients.size };
});

// --- Vercel handler ---
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await app.ready();
  app.server.emit("request", req, res);
}

// --- Local dev ---
if (!process.env.VERCEL) {
  app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
    console.log(`Listening on ${PORT}`);
  });
}