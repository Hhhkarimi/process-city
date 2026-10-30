import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import type { RawSnapshot } from "../src/model.ts";

interface Source {
  state(): {
    snapshot: RawSnapshot | null;
    error: string | null;
    stale: boolean;
  };
}
export function isAllowedRequest(
  host: string | undefined,
  origin: string | undefined,
  port: number,
): boolean {
  if (!host || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(host))
    return false;
  return (
    !origin ||
    [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      "http://127.0.0.1:5174",
      "http://localhost:5174",
    ].includes(origin)
  );
}
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".csv": "text/csv",
};
export function createCityServer(
  source: Source,
  root: string,
  port: number,
): Server {
  const json = (
    res: ServerResponse,
    status: number,
    payload: unknown,
  ): void => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(payload));
  };
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (
      !isAllowedRequest(
        req.headers.host,
        req.headers.origin,
        req.socket.localPort ?? port,
      )
    ) {
      json(res, 403, {
        error: "Only same-origin loopback requests are accepted.",
      });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      json(res, 405, {
        error: "Read-only server. Only GET and HEAD are supported.",
      });
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(
        new URL(req.url ?? "/", "http://127.0.0.1").pathname,
      );
    } catch {
      json(res, 400, { error: "Invalid URL." });
      return;
    }
    if (pathname === "/api/health") {
      const s = source.state();
      json(res, 200, {
        status: s.stale ? "waiting" : "ready",
        platform: process.platform,
        readOnly: true,
        error: s.error,
      });
      return;
    }
    if (pathname === "/api/snapshot") {
      const s = source.state();
      json(res, s.stale ? 503 : 200, {
        data: s.snapshot,
        stale: s.stale,
        error: s.error,
      });
      return;
    }
    if (pathname.startsWith("/api/")) {
      json(res, 404, { error: "Unknown endpoint." });
      return;
    }
    const file = resolve(
      root,
      pathname === "/" ? "index.html" : "." + pathname,
    );
    if (!file.startsWith(resolve(root) + sep)) {
      json(res, 403, { error: "Invalid path." });
      return;
    }
    try {
      const bytes = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'",
      });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(
        "Build the application first: npm run build. Then run npm start.",
      );
    }
  });
}
