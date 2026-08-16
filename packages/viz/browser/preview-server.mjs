// Minimal static server for browser tests on CI.
// Serves the prebuilt `browser/dist` (built by `vp run -F @mantaq/viz browser:build`)
// with SPA fallback to index.html for extension-less routes.
//
// Node-only, spawns no child processes — deliberately avoids launching `vp` from
// playwright, which fails on GitHub runners with EINVAL (os error 22) when vp
// spawns its build/preview child.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const ROOT = join(import.meta.dirname, "dist");
const INDEX = join(ROOT, "index.html");
const PORT = 4173;
const HOST = "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

function safeJoin(base, urlPath) {
  const rel = normalize(urlPath)
    .replace(/^([/\\])+/, "")
    .split(sep)
    .join("/");
  const candidate = join(base, rel);
  return candidate.startsWith(base + sep) ? candidate : INDEX;
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const decoded = decodeURIComponent(pathname);
    let filePath = decoded === "/" ? INDEX : safeJoin(ROOT, decoded);
    let info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) {
      if (extname(decoded)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      filePath = INDEX;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500);
    res.end(`server error: ${err.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`preview server listening on http://${HOST}:${PORT}`);
});
