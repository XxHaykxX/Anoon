import "dotenv/config";
import { createServer } from "node:http";
import { Readable } from "node:stream";

import handler from "./index.ts";

// Node-адаптер для fetch-handler (backend рассчитан на Bun/Edge, где `export default
// { fetch }` работает нативно). На этой машине Node — конвертируем IncomingMessage
// в Web Request и Response обратно. В прод (Bun/Edge) этот файл не нужен.
const PORT = Number(process.env.PORT ?? 8787);

createServer(async (nodeReq, nodeRes) => {
  try {
    const url = `http://${nodeReq.headers.host ?? "localhost"}${nodeReq.url ?? "/"}`;
    const method = nodeReq.method ?? "GET";

    // Health-check без авторизации (основной handler требует JWT).
    if (new URL(url).pathname === "/health") {
      nodeRes.setHeader("content-type", "application/json");
      nodeRes.end(JSON.stringify({ ok: true }));
      return;
    }

    const hasBody = method !== "GET" && method !== "HEAD";
    const request = new Request(url, {
      method,
      headers: nodeReq.headers as Record<string, string>,
      body: hasBody ? (Readable.toWeb(nodeReq) as ReadableStream) : undefined,
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);

    const response = await handler.fetch(request);

    nodeRes.statusCode = response.status;
    response.headers.forEach((value, key) => nodeRes.setHeader(key, value));
    if (response.body) {
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(nodeRes);
    } else {
      nodeRes.end();
    }
  } catch (err) {
    nodeRes.statusCode = 500;
    nodeRes.end(JSON.stringify({ error: err instanceof Error ? err.message : "internal error" }));
  }
}).listen(PORT, () => console.log(`anoon backend → http://localhost:${PORT}`));
