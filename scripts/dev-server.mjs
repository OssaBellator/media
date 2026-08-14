import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT || 4173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const target = decoded === "/" ? "/apps/studio/index.html" : decoded;
  const resolved = normalize(join(root, target));
  return resolved.startsWith(root) ? resolved : null;
}

const server = createServer(async (request, response) => {
  const path = safePath(request.url || "/");
  if (!path) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const info = await stat(path);
    const filePath = info.isDirectory() ? join(path, "index.html") : path;
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mime[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Media Studio: http://127.0.0.1:${port}`);
});
