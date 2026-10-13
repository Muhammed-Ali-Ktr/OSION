#!/usr/bin/env node
/**
 * Yayın paketi: yalnızca tarayıcıya gidecek dosyaları dist/ klasörüne kopyalar.
 * supabase/, tests/, tools/ ve node_modules/ yayınlanmaz.
 *
 * İçerik Güvenlik Politikası (CSP), config.js'teki Supabase adresine göre index.html'e
 * eklenir; böylece lisanslı kurulumlarda (farklı Supabase projesi) da doğru çalışır.
 *
 * Kullanım: node tools/build.js [--siki]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const FILES = [
  "index.html", "style.css", "config.js", "platform.js", "app.js", "mail.js", "favicon.svg",
  "kullanim-kosullari.html", "gizlilik.html", "legal.css"
];
const DIRS = ["car logo"];

function fail(message) {
  console.error(`Derleme hatası: ${message}`);
  process.exit(1);
}

// config.js içindeki Supabase adresini okur ve doğrular.
const config = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
const urlMatch = /supabaseUrl:\s*"(https:\/\/[a-z0-9-]+\.supabase\.co)"/.exec(config);
if (!urlMatch) fail("config.js içinde geçerli bir supabaseUrl bulunamadı.");
if (/service_role/.test(Buffer.from((/supabaseAnonKey:\s*"[^.]+\.([^.]+)\./.exec(config) || [])[1] || "", "base64").toString())) {
  fail("config.js içinde service_role anahtarı var! Yalnızca anon anahtarı kullanılmalıdır.");
}
const supabaseUrl = urlMatch[1];
const supabaseWs = supabaseUrl.replace("https://", "wss://");

// Satır içi olay işleyicileri (onclick) kullanıldığı için script-src 'unsafe-inline' gereklidir;
// asıl koruma connect-src (veri yalnızca kendi Supabase projemize gidebilir) ve otomatik kaçışlamadır.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${supabaseUrl} ${supabaseWs}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join("; ");

// Yasal metinlerdeki doldurulmamış alanlar yayını durdurmaz, uyarı verir. Yayın kopyasında
// sarı "[DOLDURUN: …]" işaretleri yerine sade bir "(güncellenecek)" yazısı gösterilir;
// kaynak dosyalar doldurulup yeniden yayınlandığında gerçek bilgiler görünür.
// Boş alan varken yayını durdurmak için: node tools/build.js --siki
const strict = process.argv.includes("--siki");
const LEGAL_FILES = ["kullanim-kosullari.html", "gizlilik.html"];
const PLACEHOLDER_RE = /<span class="fill">\[DOLDURUN:[^\]]*\]<\/span>|\[DOLDURUN:[^\]]*\]/g;
for (const file of LEGAL_FILES) {
  const missing = fs.readFileSync(path.join(ROOT, file), "utf8").match(/\[DOLDURUN:[^\]]*\]/g) || [];
  if (!missing.length) continue;
  if (strict) fail(`${file} içinde doldurulmamış alanlar var: ${[...new Set(missing)].join(", ")}`);
  console.warn(`UYARI: ${file} içinde ${missing.length} doldurulmamış alan var; sitede "(güncellenecek)" olarak görünecek.`);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

for (const file of FILES) {
  const src = path.join(ROOT, file);
  if (!fs.existsSync(src)) fail(`${file} bulunamadı.`);
  fs.copyFileSync(src, path.join(DIST, file));
}
for (const dir of DIRS) {
  fs.cpSync(path.join(ROOT, dir), path.join(DIST, dir), { recursive: true });
}

for (const file of LEGAL_FILES) {
  const target = path.join(DIST, file);
  fs.writeFileSync(target, fs.readFileSync(target, "utf8")
    .replace(PLACEHOLDER_RE, "(güncellenecek)")
    .replace(/<!-- TASLAK:[^>]*-->\r?\n?/g, ""));
}

const indexPath = path.join(DIST, "index.html");
const marker = '<meta charset="UTF-8">';
const html = fs.readFileSync(indexPath, "utf8");
if (!html.includes(marker)) fail("index.html içinde <meta charset> bulunamadı.");
fs.writeFileSync(indexPath, html.replace(marker, `${marker}\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`));

const count = fs.readdirSync(DIST, { recursive: true }).length;
console.log(`Yayın paketi hazır: dist/ (${count} öğe) · Supabase: ${supabaseUrl}`);
