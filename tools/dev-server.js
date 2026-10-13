#!/usr/bin/env node
/**
 * Yerel geliştirme sunucusu (yalnızca geliştirme/deneme içindir, üretimde kullanılmaz).
 *
 * - Uygulama dosyalarını http://localhost:8787 adresinden sunar.
 * - /api adresinde gerçek code.gs dosyasını sahte Apps Script ortamında çalıştırır;
 *   böylece giriş, kurulum ve çok işletmeli akışlar Google hesabı olmadan denenebilir.
 * - Veriler .dev-data/ klasöründe JSON olarak saklanır.
 *
 * Kullanım:
 *   node tools/dev-server.js [--port 8787] [--reset] [--seed-legacy]
 *   --reset        Yerel veritabanını sıfırlar.
 *   --seed-legacy  Eski (tek işletmeli) örnek verileri oluşturur ve geçişi çalıştırır.
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createGasRuntime, FakeSpreadsheet } = require("./gas-runtime");
const { seedLegacySpreadsheet } = require("./legacy-seed");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, ".dev-data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf("--port") + 1]) || Number(process.env.PORT) || 8787;

const PUBLIC_FILES = new Set(["index.html", "style.css", "app.js", "platform.js", "config.js"]);
const PUBLIC_DIRS = ["car logo"];
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webp": "image/webp"
};

if (args.includes("--reset") && fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);

function loadState() {
  if (!fs.existsSync(DB_FILE)) return { spreadsheet: new FakeSpreadsheet("OtoTakip Yerel Veritabanı"), properties: {} };
  const json = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  return { spreadsheet: FakeSpreadsheet.fromJSON(json.spreadsheet), properties: json.properties || {} };
}

const initial = loadState();
const runtime = createGasRuntime(initial);

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify({ spreadsheet: runtime.spreadsheet.toJSON(), properties: Object.fromEntries(runtime.properties) }));
}

if (args.includes("--seed-legacy")) {
  if (runtime.spreadsheet.getSheets().length) {
    console.log("Veritabanı boş değil; eski veri tohumlaması atlandı (--reset ile birlikte kullanın).");
  } else {
    runtime.properties.set("LEGACY_TENANT_NAME", "Eski Servis (Örnek)");
    seedLegacySpreadsheet(runtime.spreadsheet);
    const result = runtime.run("migrateLegacyData");
    persist();
    // Yerel deneme ortamı olduğu için kod terminale yazdırılır; gerçek ortamda Script Properties'ten okunur.
    console.log(`Eski veriler "${result.tenantId}" işletmesine taşındı.`);
    console.log(`Sahip davet kodu: ${runtime.properties.get("OWNER_CLAIM_" + result.tenantId)}`);
  }
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end("Bulunamadı"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(content);
  });
}

function resolvePublicPath(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "") || "index.html";
  if (PUBLIC_FILES.has(rel)) return path.join(ROOT, rel);
  const dir = PUBLIC_DIRS.find((d) => rel.startsWith(d + "/"));
  if (!dir) return null;
  const full = path.resolve(ROOT, rel);
  return full.startsWith(path.join(ROOT, dir) + path.sep) ? full : null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 3_000_000) req.destroy();
    });
    req.on("end", () => {
      let action = "-";
      try { action = String(JSON.parse(body).action || "-"); } catch { /* geçersiz gövde code.gs'te yanıtlanır */ }
      const result = runtime.context.doPost({ postData: { contents: body } }).getContent();
      persist();
      // Yalnızca işlem adı ve sonuç loglanır; istek içeriği (kişisel veri, şifre) loglanmaz.
      console.log(`[api] ${action} -> ${JSON.parse(result).success ? "ok" : JSON.parse(result).code}`);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(result);
    });
    return;
  }

  if (req.method !== "GET") { res.writeHead(405); res.end(); return; }

  if (url.pathname === "/config.js") {
    const base = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
    res.writeHead(200, { "Content-Type": MIME[".js"], "Cache-Control": "no-store" });
    res.end(`${base}\n// Yerel geliştirme sunucusu: API adresi yerel taklide yönlendirildi.\nwindow.OTO_TAKIP_CONFIG = Object.assign({}, window.OTO_TAKIP_CONFIG, { apiUrl: "/api" });\n`);
    return;
  }

  const filePath = resolvePublicPath(url.pathname);
  if (!filePath) { res.writeHead(404); res.end("Bulunamadı"); return; }
  sendFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`OtoTakip yerel geliştirme sunucusu: http://localhost:${PORT}`);
});
