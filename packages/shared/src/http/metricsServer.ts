import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Metrics } from "../metrics.js";

export function startMetricsServer(metrics: Metrics, port: number, extra?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>): Server {
  const server = createServer(async (req, res) => {
    if (extra && (await extra(req, res))) return;
    if (req.url === "/metrics") {
      res.setHeader("content-type", metrics.register.contentType);
      res.end(await metrics.register.metrics());
      return;
    }
    if (req.url === "/health/live") {
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  server.listen(port);
  return server;
}
