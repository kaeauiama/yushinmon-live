/**
 * 開発用の静的サーバー。
 *
 * このページは ES Modules と fetch("./config.json") を使うため、
 * file:// では動かない。ローカルで確認するときはこれを使う。
 *
 *   node tools/serve.js
 *   → http://localhost:8123
 *
 * 依存パッケージは無い（NFR-03: ビルド工程を持たない）。
 * 公開物ではないので、GitHub Pages 上で参照されることはない。
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT || 8123);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));

    if (!filePath.startsWith(ROOT)) throw new Error("out of root");

    const info = await stat(filePath).catch(() => null);
    if (!info || info.isDirectory()) filePath = path.join(filePath, "index.html");

    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": TYPES[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }
}).listen(PORT, () => {
  console.log(`serving ${ROOT} on http://localhost:${PORT}`);
});
