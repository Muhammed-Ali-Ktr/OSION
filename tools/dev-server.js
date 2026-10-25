#!/usr/bin/env node
/**
 * Yerel geliştirme sunucusu: uygulama dosyalarını http://localhost:8787 adresinden sunar.
 * Veriler config.js'teki Supabase projesine gider (yerel veritabanı yoktur).
 *
 * Kullanım: node tools/dev-server.js [--port 8787] [--dist]
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
// --dist: yayın paketini (npm run build çıktısı) olduğu gibi sunar.
const SERVE_DIST = args.includes("--dist");
const ROOT = path.resolve(__dirname, "..", SERVE_DIST ? "dist" : "");
const PORT = Number(args[args.indexOf("--port") + 1]) || Number(process.env.PORT) || 8787;

const PUBLIC_FILES = new Set(["index.html", "site.css", "site.js", "panel.html", "admin.html", "admin.css", "admin.js", "style.css", "app.js", "platform.js", "catalog.js", "scanner.js", "mail.js", "config.js",
  "favicon.svg", "favicon.ico", "manifest.webmanifest", "robots.txt", "sitemap.xml", "legal.css", "kullanim-kosullari.html", "gizlilik.html"]);
const PUBLIC_DIRS = ["car logo", "icons", "vendor"];
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8"
};

function resolvePublic(urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "").replace(/\/+$/, "") || "index.html";
  // Vercel "cleanUrls" gibi: /panel → panel.html
  if (!path.extname(rel)) rel += ".html";
  const full = path.resolve(ROOT, rel);
  if (!full.startsWith(ROOT + path.sep)) return null;
  const relNorm = path.relative(ROOT, full).split(path.sep).join("/");
  if (PUBLIC_FILES.has(relNorm) || PUBLIC_DIRS.some((d) => relNorm.startsWith(`${d}/`))) return full;
  return null;
}

http.createServer((req, res) => {
  const file = resolvePublic(req.url);
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Bulunamadı");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`OSION geliştirme sunucusu: http://localhost:${PORT}`);
});
