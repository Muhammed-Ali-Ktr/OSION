/**
 * Google Apps Script ortamının Node.js için hafif bir taklidi.
 *
 * code.gs dosyasını değiştirmeden, bellek içi bir E-Tablo üzerinde çalıştırır.
 * Hem otomatik testler (tests/) hem de yerel geliştirme sunucusu (tools/dev-server.js)
 * tarafından kullanılır. Harici bağımlılık yoktur.
 *
 * Gerçek Google Sheets davranışlarından taklit edilenler:
 * - Sayısal görünen metinler sayıya, "YYYY-AA-GG" metinleri tarihe dönüşür (metin biçimli sütunlar hariç).
 * - "'" ile başlayan metinler düz metin olarak saklanır (kesme işareti saklanmaz).
 * - "=", "+", "@" ile başlayan metinler formül sayılır; bu yazımlar formulaWrites listesinde izlenir.
 */
"use strict";

const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CODE_PATH = path.join(__dirname, "..", "code.gs");
const TIME_ZONE = "Europe/Istanbul";

function columnIndexFromLetters(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }

  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const src = this.sheet.data[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = src[this.col - 1 + c];
        line.push(v === undefined ? "" : v);
      }
      out.push(line);
    }
    return out;
  }

  setValues(values) {
    values.forEach((line, r) => {
      line.forEach((v, c) => this.sheet.writeCell(this.row + r, this.col + c, v));
    });
    return this;
  }

  setValue(v) {
    this.sheet.writeCell(this.row, this.col, v);
    return this;
  }

  setNumberFormat(format) {
    if (this.wholeColumns) {
      for (let c = this.col; c < this.col + this.numCols; c++) this.sheet.formats[c] = format;
    }
    return this;
  }

  setFontWeight() { return this; }
  setBackground() { return this; }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.data = [];
    this.formats = {};
    this.formulaWrites = [];
  }

  getName() { return this.name; }

  getLastRow() {
    for (let r = this.data.length; r > 0; r--) {
      if ((this.data[r - 1] || []).some((v) => v !== "" && v !== undefined)) return r;
    }
    return 0;
  }

  getLastColumn() {
    let max = 0;
    this.data.forEach((row) => {
      for (let c = row.length; c > max; c--) {
        if (row[c - 1] !== "" && row[c - 1] !== undefined) { max = c; break; }
      }
    });
    return max;
  }

  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  }

  getRange(a, b, c, d) {
    if (typeof a === "string") {
      let m = /^([A-Z]+):([A-Z]+)$/.exec(a);
      if (m) {
        const start = columnIndexFromLetters(m[1]);
        const range = new FakeRange(this, 1, start, Math.max(1, this.data.length), columnIndexFromLetters(m[2]) - start + 1);
        range.wholeColumns = true;
        return range;
      }
      m = /^(\d+):(\d+)$/.exec(a);
      if (m) return new FakeRange(this, Number(m[1]), 1, Number(m[2]) - Number(m[1]) + 1, Math.max(1, this.getLastColumn()));
      throw new Error("Desteklenmeyen A1 aralığı: " + a);
    }
    if (!(a >= 1 && b >= 1)) throw new Error("Geçersiz aralık");
    return new FakeRange(this, a, b, c || 1, d || 1);
  }

  appendRow(values) {
    const rowIndex = this.getLastRow() + 1;
    values.forEach((v, i) => this.writeCell(rowIndex, i + 1, v));
    return this;
  }

  deleteRow(row) {
    if (row < 1 || row > this.data.length) throw new Error("Satır aralık dışında: " + row);
    this.data.splice(row - 1, 1);
  }

  writeCell(row, col, value) {
    while (this.data.length < row) this.data.push([]);
    const line = this.data[row - 1];
    while (line.length < col) line.push("");
    line[col - 1] = this.coerce(col, value, row);
  }

  coerce(col, value, row) {
    if (value === null || value === undefined) return "";
    if (typeof value !== "string") return value;
    if (value.startsWith("'")) return value.slice(1);
    if (/^[=+@]/.test(value) || (/^-/.test(value) && !/^-\d+(\.\d+)?$/.test(value))) {
      this.formulaWrites.push({ row, col, value });
      return "#FORMULA!";
    }
    if (this.formats[col] === "@") return value;
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00+03:00`);
    if (value === "TRUE" || value === "FALSE") return value === "TRUE";
    return value;
  }
}

class FakeSpreadsheet {
  constructor(name = "OtoTakip Veritabanı") {
    this.name = name;
    this.id = "SS-" + crypto.randomUUID();
    this.sheets = [];
    this.copies = [];
  }

  getName() { return this.name; }
  getId() { return this.id; }
  getSpreadsheetTimeZone() { return TIME_ZONE; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }

  insertSheet(name) {
    if (this.getSheetByName(name)) throw new Error("Sayfa zaten var: " + name);
    const sheet = new FakeSheet(name);
    this.sheets.push(sheet);
    return sheet;
  }

  copy(name) {
    const clone = FakeSpreadsheet.fromJSON(this.toJSON());
    clone.name = name;
    clone.id = "SS-" + crypto.randomUUID();
    this.copies.push(clone);
    return clone;
  }

  toJSON() {
    return {
      name: this.name,
      id: this.id,
      sheets: this.sheets.map((s) => ({
        name: s.name,
        formats: s.formats,
        data: s.data.map((row) => row.map((v) => (v instanceof Date ? { $date: v.toISOString() } : v)))
      }))
    };
  }

  static fromJSON(json) {
    const ss = new FakeSpreadsheet(json.name);
    ss.id = json.id || ss.id;
    (json.sheets || []).forEach((s) => {
      const sheet = ss.insertSheet(s.name);
      sheet.formats = s.formats || {};
      sheet.data = (s.data || []).map((row) => row.map((v) => (v && typeof v === "object" && v.$date ? new Date(v.$date) : v)));
    });
    return ss;
  }
}

const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const toBuffer = (x) => (typeof x === "string" ? Buffer.from(x, "utf8") : Buffer.from(Array.from(x, (b) => b & 255)));

function formatDate(date, timeZone, pattern) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return pattern
    .replace("yyyy", parts.year).replace("MM", parts.month).replace("dd", parts.day)
    .replace("HH", parts.hour).replace("mm", parts.minute);
}

/**
 * code.gs'i yalıtılmış bir VM bağlamında yükler.
 * @param {{spreadsheet?: FakeSpreadsheet, properties?: Object<string,string>}} options
 */
function createGasRuntime(options = {}) {
  const spreadsheet = options.spreadsheet || new FakeSpreadsheet();
  const properties = new Map(Object.entries(options.properties || {}));
  const logs = [];

  const context = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: () => {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (properties.has(k) ? properties.get(k) : null),
        setProperty(k, v) { properties.set(k, String(v)); return this; },
        deleteProperty(k) { properties.delete(k); return this; },
        getProperties: () => Object.fromEntries(properties)
      })
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (content) => ({ setMimeType() { return this; }, getContent: () => content })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, value) => toSigned(crypto.createHash(alg).update(toBuffer(value)).digest()),
      computeHmacSha256Signature: (value, key) => toSigned(crypto.createHmac("sha256", toBuffer(key)).update(toBuffer(value)).digest()),
      base64Encode: (data) => toBuffer(data).toString("base64"),
      newBlob: (s) => ({ getBytes: () => toSigned(Buffer.from(String(s), "utf8")) }),
      formatDate
    },
    Logger: { log: (...args) => logs.push({ level: "log", message: args.join(" ") }) },
    console: {
      log: (...a) => logs.push({ level: "log", message: a.join(" ") }),
      info: (...a) => logs.push({ level: "info", message: a.join(" ") }),
      warn: (...a) => logs.push({ level: "warn", message: a.join(" ") }),
      error: (...a) => logs.push({ level: "error", message: a.join(" ") })
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(CODE_PATH, "utf8"), context, { filename: "code.gs" });

  return {
    context,
    spreadsheet,
    properties,
    logs,
    /** Ham istek gövdesiyle doPost çağırır ve JSON yanıtı döndürür. */
    postRaw(contents) {
      return JSON.parse(context.doPost({ postData: { contents } }).getContent());
    },
    post(action, payload, token) {
      return this.postRaw(JSON.stringify({ action, payload, token }));
    },
    get() {
      return JSON.parse(context.doGet({}).getContent());
    },
    run(fnName, ...args) {
      return context[fnName](...args);
    }
  };
}

module.exports = { createGasRuntime, FakeSpreadsheet, FakeSheet, TIME_ZONE };
