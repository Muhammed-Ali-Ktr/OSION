/**
 * Kamera ile okuma ve QR üretimi
 *  - Şasi numarası (VIN): kapı direği etiketindeki barkod (Code 39/128, Data Matrix, QR) veya
 *    ön camdaki/ruhsattaki yazı (OCR). Okunan değer kullanıcı onayından sonra alana yazılır.
 *  - Ekip daveti: işletme sahibinin ekranındaki QR kodu giriş sayfasından okutulur.
 *
 * Barkod okuma tarayıcının yerleşik BarcodeDetector'ını, yoksa yerel ZXing kütüphanesini
 * (vendor/zxing.min.js) kullanır. Yazı tanıma (Tesseract) yalnızca şasi okuturken yüklenir.
 */

const ZXING_SRC = "vendor/zxing.min.js";
const TESSERACT_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const TESSERACT_SRI = "sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F";

const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
const VIN_VALUES = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

const scriptPromises = {};
function loadScriptOnce(src, integrity) {
  if (!scriptPromises[src]) {
    scriptPromises[src] = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      if (integrity) {
        el.integrity = integrity;
        el.crossOrigin = "anonymous";
      }
      el.onload = resolve;
      el.onerror = () => {
        delete scriptPromises[src];
        reject(new Error("Gerekli bileşen yüklenemedi. İnternet bağlantınızı kontrol edin."));
      };
      document.head.appendChild(el);
    });
  }
  return scriptPromises[src];
}

// ==========================================================================
// ŞASİ NUMARASI (VIN) DOĞRULAMA
// ==========================================================================

/** Kontrol hanesi (9. karakter) doğru mu? Kuzey Amerika VIN'lerinde zorunlu, Avrupa'da isteğe bağlıdır. */
function vinCheckDigitValid(vin) {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    sum += (/\d/.test(c) ? Number(c) : VIN_VALUES[c]) * VIN_WEIGHTS[i];
  }
  const r = sum % 11;
  return vin[8] === (r === 10 ? "X" : String(r));
}

function isValidVinFormat(vin) {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);
}

/**
 * Metinden 17 haneli şasi numarası adaylarını çıkarır. VIN'de bulunmayan I/O/Q harfleri
 * OCR'ın sık karıştırdığı 1/0'a çevrilir. Kontrol hanesi tutan aday öne alınır.
 */
function extractVinCandidates(text, { fromBarcode = false } = {}) {
  // aday → puan: tam 17 karakterlik dizi > kontrol hanesi tutan > uzun dizinin sonu
  const scores = new Map();
  const lines = String(text || "").toUpperCase()
    .replace(/\b(VIN|NO|ŞAS[İI]|SAS[İI]|CHASSIS)\b\s*[:.]?/g, " ")
    .split(/[\r\n]+/);
  lines.push(lines.join(""));
  for (let line of lines) {
    line = line.replace(/[\s*.:\-_|]/g, "");
    // Barkodlu etiketlerde VIN'den önce ithalat işareti "I" bulunabilir.
    if (fromBarcode && line.length === 18 && line[0] === "I") line = line.slice(1);
    line = line.replace(/O|Q/g, "0").replace(/I/g, "1");
    const runs = line.match(/[A-HJ-NPR-Z0-9]{17,}/g) || [];
    for (const run of runs) {
      for (let i = 0; i + 17 <= run.length; i++) {
        const vin = run.slice(i, i + 17);
        const score = (run.length === 17 ? 4 : 0) + (vinCheckDigitValid(vin) ? 2 : 0) + (i + 17 === run.length ? 1 : 0);
        scores.set(vin, Math.max(scores.get(vin) || 0, score));
      }
    }
  }
  return [...scores.keys()].sort((a, b) => scores.get(b) - scores.get(a));
}

/** Davet bağlantısından veya düz metinden davet kodunu çıkarır. */
function extractInviteCode(text) {
  const value = String(text || "").trim();
  const fromLink = /#davet=([A-Za-z0-9-]{16,40})/.exec(value);
  if (fromLink) return fromLink[1].toUpperCase();
  const compact = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (/^[0-9A-F]{24}$/.test(compact)) return compact.match(/.{4}/g).join("-");
  return "";
}

// ==========================================================================
// BARKOD / QR ÇÖZÜCÜLER
// ==========================================================================
const NATIVE_FORMATS = { vin: ["code_39", "code_128", "data_matrix", "qr_code", "pdf417"], qr: ["qr_code"] };

async function createBarcodeDecoder(mode) {
  if ("BarcodeDetector" in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = NATIVE_FORMATS[mode].filter((f) => supported.includes(f));
      if (formats.includes(mode === "qr" ? "qr_code" : "code_39")) {
        const detector = new window.BarcodeDetector({ formats });
        const decode = async (source) => {
          const codes = await detector.detect(source);
          return codes.map((c) => c.rawValue).filter(Boolean);
        };
        decode.native = true;
        return decode;
      }
    } catch { /* yerleşik okuyucu kullanılamıyor; ZXing'e geç */ }
  }
  await loadScriptOnce(ZXING_SRC);
  const Z = window.ZXing;
  const formats = mode === "qr"
    ? [Z.BarcodeFormat.QR_CODE]
    : [Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.DATA_MATRIX, Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.PDF_417];
  const reader = new Z.MultiFormatReader();
  reader.setHints(new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, formats], [Z.DecodeHintType.TRY_HARDER, true]]));
  return async (canvas) => {
    try {
      const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
      return [reader.decodeWithState(bitmap).getText()];
    } catch {
      return [];
    } finally {
      reader.reset();
    }
  };
}

let ocrWorkerPromise = null;
function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      await loadScriptOnce(TESSERACT_SRC, TESSERACT_SRI);
      const worker = await window.Tesseract.createWorker("eng", 1);
      await worker.setParameters({
        tessedit_char_whitelist: VIN_CHARS + "OIQ",
        tessedit_pageseg_mode: "7",
        preserve_interword_spaces: "0"
      });
      return worker;
    })().catch((err) => {
      ocrWorkerPromise = null;
      throw err;
    });
  }
  return ocrWorkerPromise;
}

// ==========================================================================
// KAMERA EKRANI
// ==========================================================================
const SCANNER_TEXT = {
  vin: {
    title: "Şasi Numarası Okut",
    hint: "Şasi numarasını (yazı veya barkod) çerçevenin içine yatay hizalayın",
    searching: "Barkod ve şasi yazısı aranıyor…"
  },
  qr: {
    title: "Davet QR Kodunu Okut",
    hint: "İşletme yöneticinizin ekranındaki QR kodu çerçeveye hizalayın",
    searching: "QR kod aranıyor…"
  }
};

const ICONS = {
  close: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  torch: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="M8 2h8l-2 6h4l-10 14 2-10H6z"/></svg>`,
  image: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  keyboard: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6.01" y2="10"/><line x1="10" y1="10" x2="10.01" y2="10"/><line x1="14" y1="10" x2="14.01" y2="10"/><line x1="18" y1="10" x2="18.01" y2="10"/><line x1="7" y1="14" x2="17" y2="14"/></svg>`
};

let activeScanner = null;

function cameraErrorMessage(err) {
  if (!window.isSecureContext) return "Kamera yalnızca güvenli bağlantıda (https) kullanılabilir.";
  switch (err && err.name) {
    case "NotAllowedError": case "SecurityError":
      return "Kamera izni verilmedi. Tarayıcının adres çubuğundaki kamera simgesinden izin verin veya fotoğraftan okutun.";
    case "NotFoundError": case "OverconstrainedError":
      return "Bu cihazda kullanılabilir kamera bulunamadı. Fotoğraftan okutabilir veya elle yazabilirsiniz.";
    case "NotReadableError":
      return "Kamera başka bir uygulama tarafından kullanılıyor. Diğer uygulamayı kapatıp tekrar deneyin.";
    default:
      return "Kamera açılamadı. Fotoğraftan okutabilir veya elle yazabilirsiniz.";
  }
}

/**
 * Tam ekran kamera görünümünü açar.
 * mode: "vin" | "qr" · onResult(value) onaylanan değerle çağrılır · onManual() "Elle yaz" seçilince.
 */
function openScanner({ mode, onResult, onManual }) {
  closeScanner();
  const text = SCANNER_TEXT[mode];
  const overlay = document.createElement("div");
  overlay.className = `scanner-overlay scanner-${mode}`;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", text.title);
  overlay.innerHTML = html`
    <div class="scanner-top">
      <button type="button" class="scanner-icon-btn" data-scan="close" aria-label="Kapat">${rawHtml(ICONS.close)}</button>
      <div class="scanner-title">${text.title}</div>
      <button type="button" class="scanner-icon-btn hidden" data-scan="torch" aria-label="Feneri aç/kapat" aria-pressed="false">${rawHtml(ICONS.torch)}</button>
    </div>
    <div class="scanner-stage">
      <video class="scanner-video" playsinline muted autoplay></video>
      <div class="scanner-frame"><span class="scanner-corner tl"></span><span class="scanner-corner tr"></span><span class="scanner-corner bl"></span><span class="scanner-corner br"></span><span class="scanner-laser"></span></div>
    </div>
    <div class="scanner-bottom">
      <p class="scanner-hint">${text.hint}</p>
      <p class="scanner-status" aria-live="polite">Kamera açılıyor…</p>
      <div class="scanner-actions">
        <label class="scanner-pill">${rawHtml(ICONS.image)}<span>Fotoğraftan Oku</span><input type="file" accept="image/*" data-scan="file" hidden></label>
        ${onManual ? html`<button type="button" class="scanner-pill" data-scan="manual">${rawHtml(ICONS.keyboard)}<span>Elle Yaz</span></button>` : ""}
      </div>
    </div>
    <div class="scanner-sheet hidden" data-scan="sheet">
      <div class="scanner-sheet-handle"></div>
      <div class="scanner-sheet-title">Okunan şasi numarası</div>
      <input type="text" class="form-control scanner-sheet-input" data-scan="value" maxlength="17" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Okunan şasi numarası">
      <p class="scanner-sheet-note" data-scan="note"></p>
      <div class="scanner-sheet-actions">
        <button type="button" class="btn btn-secondary" data-scan="retry">Tekrar Tara</button>
        <button type="button" class="btn btn-accent" data-scan="accept">Bu Numarayı Kullan</button>
      </div>
    </div>`.toString();
  document.body.appendChild(overlay);
  document.body.classList.add("scanner-open");

  const $ = (name) => overlay.querySelector(`[data-scan="${name}"]`);
  const video = overlay.querySelector(".scanner-video");
  const frame = overlay.querySelector(".scanner-frame");
  const statusEl = overlay.querySelector(".scanner-status");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const scanner = {
    mode, overlay, stream: null, closed: false, paused: false, timers: [],
    decodeBarcode: null, lastOcr: "", ocrBusy: false, torchOn: false
  };
  activeScanner = scanner;

  const setStatus = (message, tone = "") => {
    statusEl.textContent = message;
    statusEl.dataset.tone = tone;
  };

  const later = (fn, ms) => {
    const id = setTimeout(() => { if (!scanner.closed) fn(); }, ms);
    scanner.timers.push(id);
  };

  // Görünen çerçevenin video karesindeki karşılığını (object-fit: cover) hesaplar.
  const frameCrop = (pad = 0) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const vr = video.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    const scale = Math.max(vr.width / vw, vr.height / vh);
    const offX = (vw * scale - vr.width) / 2;
    const offY = (vh * scale - vr.height) / 2;
    const padX = fr.width * pad;
    const padY = fr.height * pad;
    const x = Math.max(0, (fr.left - vr.left - padX + offX) / scale);
    const y = Math.max(0, (fr.top - vr.top - padY + offY) / scale);
    const w = Math.min(vw - x, (fr.width + padX * 2) / scale);
    const h = Math.min(vh - y, (fr.height + padY * 2) / scale);
    return { x, y, w, h };
  };

  const drawCrop = (crop, targetWidth) => {
    const ratio = Math.min(1, targetWidth / crop.w) || 1;
    canvas.width = Math.round(crop.w * ratio);
    canvas.height = Math.round(crop.h * ratio);
    ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
    return canvas;
  };

  const vibrate = () => { try { navigator.vibrate && navigator.vibrate(60); } catch { /* yok say */ } };

  const finish = (value) => {
    vibrate();
    closeScanner();
    onResult(value);
  };

  const showVinSheet = (vin, source) => {
    scanner.paused = true;
    vibrate();
    overlay.classList.add("has-result");
    const sheet = $("sheet");
    const input = $("value");
    const note = $("note");
    const updateNote = () => {
      const v = input.value;
      if (v.length !== 17) note.textContent = `${v.length}/17 karakter — eksik veya fazla karakter var.`;
      else if (!isValidVinFormat(v)) note.textContent = "Şasi numarasında I, O ve Q harfleri bulunmaz; kontrol edin.";
      else if (vinCheckDigitValid(v)) note.textContent = "✓ Kontrol hanesi doğrulandı.";
      else note.textContent = `${source === "barcode" ? "Barkoddan" : "Yazıdan"} okundu. Araçtaki numarayla karşılaştırıp onaylayın.`;
      note.dataset.tone = v.length === 17 && isValidVinFormat(v) ? "ok" : "warn";
    };
    input.value = vin;
    input.oninput = () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      updateNote();
    };
    updateNote();
    sheet.classList.remove("hidden");
  };

  const handleCandidates = (values, source, { force = false } = {}) => {
    if ((scanner.paused && !force) || scanner.closed) return false;
    if (mode === "qr") {
      const code = values.map(extractInviteCode).find(Boolean);
      if (code) { finish(code); return true; }
      if (values.length) setStatus("Bu bir OSION davet QR kodu değil.", "warn");
      return false;
    }
    const fromBarcode = source === "barcode";
    const candidates = values.flatMap((v) => extractVinCandidates(v, { fromBarcode }));
    if (!candidates.length) return false;
    const best = candidates[0];
    // Yazıdan okumada yanlış okumayı azaltmak için aynı sonuç iki kez gelmeli (kontrol hanesi tutmuyorsa).
    if (fromBarcode || force || vinCheckDigitValid(best) || scanner.lastOcr === best) {
      showVinSheet(best, source);
      return true;
    }
    scanner.lastOcr = best;
    setStatus(`Okunuyor: ${best}`, "info");
    return false;
  };

  const barcodeLoop = async () => {
    if (scanner.closed) return;
    if (!scanner.paused && video.readyState >= 2 && scanner.decodeBarcode) {
      try {
        const source = scanner.decodeBarcode.native
          ? video
          : drawCrop(frameCrop(mode === "qr" ? 0.15 : 0.35), 1280);
        handleCandidates(await scanner.decodeBarcode(source), "barcode");
      } catch { /* bir sonraki kareyi dene */ }
    }
    later(barcodeLoop, 220);
  };

  const ocrLoop = async () => {
    if (scanner.closed) return;
    if (!scanner.paused && video.readyState >= 2 && !scanner.ocrBusy) {
      scanner.ocrBusy = true;
      try {
        const worker = await getOcrWorker();
        if (!scanner.closed && !scanner.paused) {
          if (!scanner.ocrReady) {
            scanner.ocrReady = true;
            setStatus(text.searching);
          }
          const { data } = await worker.recognize(drawCrop(frameCrop(0.05), 1400));
          handleCandidates([data.text || ""], "ocr");
        }
      } catch (err) {
        if (!scanner.ocrFailed) {
          scanner.ocrFailed = true;
          setStatus("Yazı tanıma yüklenemedi; barkodla okutabilir veya elle yazabilirsiniz.", "warn");
        }
      } finally {
        scanner.ocrBusy = false;
      }
    }
    later(ocrLoop, scanner.ocrFailed ? 60000 : 350);
  };

  const scanImageFile = async (file) => {
    if (!file) return;
    scanner.paused = true;
    setStatus("Fotoğraf inceleniyor…", "info");
    try {
      const bitmap = await createImageBitmap(file);
      const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * ratio);
      canvas.height = Math.round(bitmap.height * ratio);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const decode = scanner.decodeBarcode || await createBarcodeDecoder(mode);
      if (handleCandidates(await decode(canvas), "barcode", { force: true })) return;
      if (mode === "vin") {
        const worker = await getOcrWorker();
        await worker.setParameters({ tessedit_pageseg_mode: "6" });
        const { data } = await worker.recognize(canvas);
        await worker.setParameters({ tessedit_pageseg_mode: "7" });
        if (handleCandidates([data.text || ""], "ocr", { force: true })) return;
      }
      scanner.paused = false;
      setStatus(mode === "qr" ? "Fotoğrafta QR kod bulunamadı." : "Fotoğrafta şasi numarası bulunamadı. Numaraya yakından, net bir fotoğraf çekin.", "warn");
    } catch {
      scanner.paused = false;
      setStatus("Fotoğraf okunamadı.", "warn");
    }
  };

  $("close").addEventListener("click", closeScanner);
  $("file").addEventListener("change", (e) => {
    scanImageFile(e.target.files && e.target.files[0]);
    e.target.value = "";
  });
  if (onManual) $("manual").addEventListener("click", () => { closeScanner(); onManual(); });
  $("retry").addEventListener("click", () => {
    $("sheet").classList.add("hidden");
    overlay.classList.remove("has-result");
    scanner.lastOcr = "";
    scanner.paused = false;
    setStatus(text.searching);
  });
  $("accept").addEventListener("click", () => {
    const v = $("value").value;
    if (v.length !== 17) {
      $("value").focus();
      return;
    }
    finish(v);
  });
  $("torch").addEventListener("click", async () => {
    const track = scanner.stream && scanner.stream.getVideoTracks()[0];
    if (!track) return;
    try {
      scanner.torchOn = !scanner.torchOn;
      await track.applyConstraints({ advanced: [{ torch: scanner.torchOn }] });
      $("torch").setAttribute("aria-pressed", String(scanner.torchOn));
    } catch {
      scanner.torchOn = false;
    }
  });
  scanner.onKey = (e) => { if (e.key === "Escape") closeScanner(); };
  document.addEventListener("keydown", scanner.onKey);

  (async () => {
    try {
      scanner.decodeBarcode = await createBarcodeDecoder(mode);
    } catch (err) {
      setStatus(err.message, "warn");
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus(cameraErrorMessage(null), "warn");
      overlay.classList.add("no-camera");
      return;
    }
    try {
      scanner.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
    } catch (err) {
      setStatus(cameraErrorMessage(err), "warn");
      overlay.classList.add("no-camera");
      return;
    }
    if (scanner.closed) return stopStream(scanner);
    video.srcObject = scanner.stream;
    try { await video.play(); } catch { /* autoplay muted ile oynatılır */ }
    const track = scanner.stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    if (caps.torch) $("torch").classList.remove("hidden");
    if (caps.focusMode && caps.focusMode.includes("continuous")) {
      track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
    }
    setStatus(mode === "vin" ? "Yazı tanıma hazırlanıyor… Barkodlar şimdiden okunabilir." : text.searching);
    barcodeLoop();
    if (mode === "vin") ocrLoop();
  })();
}

function stopStream(scanner) {
  if (scanner.stream) scanner.stream.getTracks().forEach((t) => t.stop());
  scanner.stream = null;
}

function closeScanner() {
  const scanner = activeScanner;
  if (!scanner) return;
  activeScanner = null;
  scanner.closed = true;
  scanner.timers.forEach(clearTimeout);
  stopStream(scanner);
  document.removeEventListener("keydown", scanner.onKey);
  scanner.overlay.remove();
  document.body.classList.remove("scanner-open");
}

/** Araç formundaki "Kamerayla okut" düğmesi. */
function scanVinInto(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  openScanner({
    mode: "vin",
    onResult: (vin) => {
      input.value = vin;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      showToast(`Şasi numarası okundu: ${vin}`, "success");
    },
    onManual: () => input.focus()
  });
}

/** Giriş ekranındaki "QR kodu okut" düğmesi: davet kodunu doldurur. */
function scanInviteQr() {
  if (typeof showAuthTab === "function") showAuthTab("invite");
  openScanner({
    mode: "qr",
    onResult: (code) => {
      document.getElementById("inv_code").value = code;
      showAlert("authAlert", "Davet kodu QR'dan alındı. Davet edilen e-posta adresinizi ve şifrenizi girerek katılın.", "info");
      const email = document.getElementById("inv_email");
      if (email) email.focus();
    },
    onManual: () => document.getElementById("inv_code").focus()
  });
}

// ==========================================================================
// QR ÜRETİMİ (davet kartı)
// ==========================================================================
async function renderQrSvg(text, { margin = 2 } = {}) {
  await loadScriptOnce(ZXING_SRC);
  const Z = window.ZXing;
  const hints = new Map([[Z.EncodeHintType.ERROR_CORRECTION, "M"], [Z.EncodeHintType.MARGIN, margin]]);
  const matrix = new Z.QRCodeWriter().encode(text, Z.BarcodeFormat.QR_CODE, 0, 0, hints);
  const size = matrix.getWidth();
  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (matrix.get(x, y)) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="Davet QR kodu"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#0b1220"/></svg>`;
}

/** SVG QR kodunu PNG olarak indirir. */
async function downloadQrPng(svg, fileName) {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
    const c = document.createElement("canvas");
    c.width = c.height = 1024;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0, 1024, 1024);
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = fileName;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** QR kodunu tam ekranda büyük gösterir (yeni üyenin telefonla okutması için). */
function showQrFullscreen({ svg, title, subtitle }) {
  const overlay = document.createElement("div");
  overlay.className = "qr-fullscreen";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = html`<div class="qr-fullscreen-card">
      <div class="qr-fullscreen-title">${title}</div>
      <div class="qr-fullscreen-code">${rawHtml(svg)}</div>
      <p class="qr-fullscreen-sub">${subtitle}</p>
      <button type="button" class="btn btn-secondary btn-block" data-close>Kapat</button>
    </div>`.toString();
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay || e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
}
