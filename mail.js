/**
 * OSION - Araç sahiplerine e-posta
 * İşletmenin kendi e-posta hesabı (uygulama şifresiyle) ayarları, servis fişi gönderimi
 * ve müşteriye mesaj penceresi. platform.js ve app.js'ten sonra yüklenir.
 *
 * Uygulama şifresi tarayıcıda yalnızca kaydedilirken bulunur; veritabanında Vault'ta
 * şifreli saklanır ve gönderim "send-mail" Edge Function'ında yapılır.
 */

const MAIL_PROVIDERS = {
  gmail: {
    label: "Gmail / Google Workspace",
    help: html`Google hesabınızda <strong>2 Adımlı Doğrulama</strong> açık olmalıdır.
      <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">myaccount.google.com/apppasswords</a>
      adresinde "OSION" adıyla bir uygulama şifresi oluşturun ve 16 haneli şifreyi buraya yapıştırın. Normal Gmail şifreniz çalışmaz.`
  },
  yandex: {
    label: "Yandex Mail",
    help: html`<a href="https://id.yandex.com/security/app-passwords" target="_blank" rel="noopener noreferrer">Yandex ID &gt; Uygulama şifreleri</a>
      bölümünden "Posta" için şifre oluşturun. Yandex Mail ayarlarında IMAP/SMTP erişiminin açık olduğundan emin olun.`
  },
  yahoo: {
    label: "Yahoo Mail",
    help: html`<a href="https://login.yahoo.com/account/security" target="_blank" rel="noopener noreferrer">Yahoo Hesap Güvenliği</a>
      sayfasında "Uygulama şifresi oluştur" ile şifre alın.`
  },
  custom: {
    label: "Diğer (kendi alan adınız / hosting)",
    help: html`Hosting firmanızın verdiği SMTP sunucusunu ve e-posta şifrenizi girin. Sunucu <strong>465 (SSL)</strong> portunu desteklemelidir.`
  }
};

// ==========================================================================
// DURUM
// ==========================================================================
function mailReady() {
  return !!(platform.mail && platform.mail.configured && !platform.offline);
}

// Arka planda gelen eski bir durum yanıtı, sonradan kaydedilen ayarın üzerine yazmasın diye sürüm tutulur.
let mailStatusVersion = 0;

function setMailStatus(status) {
  mailStatusVersion++;
  platform.mail = status;
}

async function loadMailStatus() {
  const version = ++mailStatusVersion;
  let status;
  try {
    status = await apiCall("mailStatus");
  } catch (err) {
    // E-posta durumu alınamazsa yalnızca e-posta düğmeleri gizli kalır.
    if (!err.handled) console.warn("[OSION] E-posta durumu alınamadı:", err.message);
    return;
  }
  if (version !== mailStatusVersion) return;
  platform.mail = status;
  if (status.configured) renderAll();
}

// ==========================================================================
// AYAR FORMU (kurulum sihirbazı ve İşletme Ayarları ortak kullanır)
// ==========================================================================
function renderMailFields(container, prefix, status, { optional = false } = {}) {
  const st = status || { configured: false };
  const provider = st.provider || "gmail";
  const id = (k) => `${prefix}_mail${k}`;
  const options = Object.entries(MAIL_PROVIDERS).map(([value, p]) =>
    html`<option value="${value}"${value === provider ? rawHtml(" selected") : ""}>${p.label}</option>`);

  container.innerHTML = html`
    ${optional ? html`<p class="card-desc">Servis fişlerini ve müşteri mesajlarını araç sahiplerine kendi e-posta adresinizden göndermek için hesabınızı ekleyin. Bu adımı atlayıp daha sonra <strong>İşletme Ayarları &gt; E-posta</strong> bölümünden de ekleyebilirsiniz.</p>` : ""}
    <div class="form-section">
      <div class="form-group">
        <label class="form-label" for="${id("Provider")}">E-posta sağlayıcısı</label>
        <select id="${id("Provider")}" class="form-control">${options}</select>
      </div>
      <div class="form-group" data-mail-host>
        <label class="form-label" for="${id("Host")}">SMTP sunucusu *</label>
        <input type="text" id="${id("Host")}" class="form-control" maxlength="253" placeholder="Örn: mail.alanadiniz.com" value="${provider === "custom" ? st.host || "" : ""}" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label" for="${id("User")}">E-posta adresi${optional ? "" : " *"}</label>
        <input type="email" id="${id("User")}" class="form-control" maxlength="120" value="${st.address || ""}" autocomplete="off" placeholder="Örn: yildizoto@gmail.com">
      </div>
      <div class="form-group">
        <label class="form-label" for="${id("Password")}">Uygulama şifresi${st.configured ? "" : " *"}</label>
        <input type="password" id="${id("Password")}" class="form-control" maxlength="200" autocomplete="new-password"
          placeholder="${st.configured ? "Değiştirmeyecekseniz boş bırakın" : "Örn: abcd efgh ijkl mnop"}">
      </div>
      <div class="form-group">
        <label class="form-label" for="${id("FromName")}">Gönderen adı</label>
        <input type="text" id="${id("FromName")}" class="form-control" maxlength="80" value="${st.fromName || ""}" placeholder="${(platform.tenant && platform.tenant.name) || "İşletme adınız"}">
        <p class="field-hint">Boş bırakılırsa işletme adınız kullanılır.</p>
      </div>
      <div class="form-alert form-alert-info mail-help" data-mail-help></div>
      <p class="field-hint">Outlook / Hotmail hesapları desteklenmez (Microsoft uygulama şifresiyle e-posta gönderimini kapattı).</p>
    </div>`.toString();

  const select = document.getElementById(id("Provider"));
  const sync = () => {
    container.querySelector("[data-mail-host]").classList.toggle("hidden", select.value !== "custom");
    container.querySelector("[data-mail-help]").innerHTML = MAIL_PROVIDERS[select.value].help.toString();
  };
  select.addEventListener("change", sync);
  sync();
}

function readMailFields(prefix) {
  const v = (k) => (document.getElementById(`${prefix}_mail${k}`)?.value || "").trim();
  return {
    provider: v("Provider") || "gmail",
    host: v("Host").toLowerCase(),
    user: v("User").toLowerCase(),
    // Uygulama şifreleri boşluklu gösterilir (abcd efgh ...); boşluklar şifreye dahil değildir.
    password: (document.getElementById(`${prefix}_mailPassword`)?.value || "").replace(/\s+/g, ""),
    fromName: v("FromName")
  };
}

function validateMailFields(prefix, m, { optional = false, configured = false } = {}) {
  const errors = {};
  const id = (k) => `${prefix}_mail${k}`;
  if (optional && !m.user && !m.password) return errors;
  if (!EMAIL_RE.test(m.user)) errors[id("User")] = "Geçerli bir e-posta adresi girin.";
  if (!m.password && !configured) errors[id("Password")] = "Uygulama şifresini girin.";
  if (m.provider === "custom" && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(m.host)) errors[id("Host")] = "Geçerli bir SMTP sunucu adresi girin.";
  return errors;
}

// ==========================================================================
// İŞLETME AYARLARI > E-POSTA
// ==========================================================================
async function renderMailSettings() {
  hideAlert("mailAlert");
  const fields = document.getElementById("mailFields");
  fields.innerHTML = `<div class="list-placeholder">E-posta ayarları yükleniyor…</div>`;
  if (platform.offline) {
    fields.innerHTML = `<div class="list-placeholder">Çevrimdışıyken e-posta ayarları görüntülenemez.</div>`;
    return;
  }
  try {
    setMailStatus(await apiCall("mailStatus"));
  } catch (err) {
    if (err.handled) return;
    fields.innerHTML = "";
    showAlert("mailAlert", `E-posta ayarları alınamadı: ${err.message}`);
    return;
  }
  renderMailFields(fields, "settings", platform.mail);
  updateMailSettingsState();
}

function updateMailSettingsState() {
  const st = platform.mail || { configured: false };
  const badge = document.getElementById("mailStatusBadge");
  badge.textContent = !st.configured ? "Ayarlanmadı" : st.verified ? "Bağlı ✓" : "Test edilmedi";
  badge.title = !st.configured ? "" : st.verified ? "Test e-postası başarıyla gönderildi." : "Kaydedildi; test e-postası gönderip bağlantıyı doğrulayın.";
  document.getElementById("btnTestMail").classList.toggle("hidden", !st.configured);
  document.getElementById("btnDeleteMail").classList.toggle("hidden", !st.configured);
}

async function handleMailSettingsSubmit(event) {
  event.preventDefault();
  if (platform.offline) return showToast("Çevrimdışıyken ayarlar değiştirilemez.", "warning");
  const form = event.currentTarget;
  clearFieldErrors(form);
  hideAlert("mailAlert");
  const m = readMailFields("settings");
  if (applyFieldErrors(validateMailFields("settings", m, { configured: !!(platform.mail && platform.mail.configured) }))) return;
  await withButtonLoading(document.getElementById("btnSaveMail"), "Kaydediliyor…", async () => {
    try {
      setMailStatus(await apiCall("saveMailSettings", m));
      renderMailFields(document.getElementById("mailFields"), "settings", platform.mail);
      updateMailSettingsState();
      renderAll();
      showAlert("mailAlert", platform.mail.verified
        ? "E-posta ayarları kaydedildi."
        : "E-posta ayarları kaydedildi. Şimdi \"Test E-postası Gönder\" ile bağlantıyı doğrulayın.", "success");
    } catch (err) {
      if (!err.handled) showAlert("mailAlert", err.message);
    }
  });
}

async function handleMailTest() {
  hideAlert("mailAlert");
  await withButtonLoading(document.getElementById("btnTestMail"), "Gönderiliyor…", async () => {
    try {
      const result = await apiCall("sendMail", { kind: "test" });
      setMailStatus({ ...platform.mail, verified: true });
      updateMailSettingsState();
      showAlert("mailAlert", `Test e-postası ${result.to} adresine gönderildi. Gelen kutunuzu kontrol edin.`, "success");
    } catch (err) {
      if (!err.handled) showAlert("mailAlert", err.message);
    }
  });
}

async function handleMailDelete() {
  if (!confirm("E-posta hesabı kaldırılsın mı? Araç sahiplerine e-posta gönderimi durur ve kayıtlı uygulama şifresi silinir.")) return;
  await withButtonLoading(document.getElementById("btnDeleteMail"), "Kaldırılıyor…", async () => {
    try {
      await apiCall("deleteMailSettings");
      setMailStatus({ configured: false });
      renderMailFields(document.getElementById("mailFields"), "settings", platform.mail);
      updateMailSettingsState();
      renderAll();
      showAlert("mailAlert", "E-posta hesabı kaldırıldı.", "info");
    } catch (err) {
      if (!err.handled) showAlert("mailAlert", err.message);
    }
  });
}

// ==========================================================================
// KARTLARDAKİ DÜĞMELER
// ==========================================================================
function receiptMailButton(rec) {
  if (!mailReady()) return "";
  return html`<button type="button" class="btn btn-secondary btn-mini" onclick="sendServiceReceipt('${rec.id}')" title="Servis fişini araç sahibine e-postayla gönder">E-posta</button>`;
}

function customerMailButton(c) {
  if (!mailReady()) return "";
  return html`<button type="button" class="btn btn-secondary btn-mini" onclick="openMailCompose('${c.id}')" title="Müşteriye e-posta gönder">E-posta</button>`;
}

function customerForRecord(rec) {
  const vehicle = state.vehicles.find((v) => v.id === rec.vehicleId);
  return vehicle ? state.customers.find((c) => c.id === vehicle.customerId) : null;
}

/** Müşterinin e-postası yoksa uyarır ve düzenleme penceresini açar. */
function ensureCustomerEmail(customer) {
  if (customer && customer.email) return true;
  showToast("Bu müşterinin e-posta adresi kayıtlı değil. Müşteri bilgilerine e-posta ekleyin.", "warning");
  if (customer) openCustomerEditModal(customer.id);
  return false;
}

async function sendServiceReceipt(recordId) {
  const rec = state.serviceRecords.find((r) => r.id === recordId);
  if (!rec) return;
  const customer = customerForRecord(rec);
  if (!ensureCustomerEmail(customer)) return;
  if (!confirm(`Servis fişi ${customer.email} adresine gönderilsin mi?`)) return;
  showToast("Servis fişi gönderiliyor…", "info");
  try {
    const result = await apiCall("sendMail", { kind: "receipt", serviceRecordId: recordId });
    showToast(`Servis fişi ${result.to} adresine gönderildi.`, "success");
  } catch (err) {
    reportError(err);
  }
}

// ==========================================================================
// MÜŞTERİYE MESAJ PENCERESİ
// ==========================================================================
const mailComposeState = { customerId: null };

function mailTemplates(customer) {
  const t = platform.tenant;
  const plates = state.vehicles.filter((v) => v.customerId === customer.id).map((v) => v.plate);
  const vehicleIds = new Set(state.vehicles.filter((v) => v.customerId === customer.id).map((v) => v.id));
  const debt = state.serviceRecords.filter((r) => vehicleIds.has(r.vehicleId)).reduce((sum, r) => sum + getRemainingAmount(r), 0);
  const plateText = plates.length ? `${plates.join(", ")} plakalı aracınızın` : "Aracınızın";
  const signature = `\n\n${t.name}${t.phone ? ` · ${t.phone}` : ""}`;
  return [
    { label: "Aracınız hazır", subject: "Aracınız teslime hazır",
      message: `${plateText} işlemleri tamamlanmıştır. Uygun olduğunuz bir zamanda teslim alabilirsiniz.${signature}` },
    { label: "Bakım hatırlatması", subject: "Periyodik bakım hatırlatması",
      message: `${plateText} periyodik bakım zamanı yaklaşmaktadır. Randevu için bizimle iletişime geçebilirsiniz.${signature}` },
    { label: "Ödeme hatırlatması", subject: "Ödeme hatırlatması",
      message: `Servis hizmetlerimize ait ${formatMoney(debt)} tutarında bakiyeniz bulunmaktadır. Uygun olduğunuz bir zamanda ödemenizi rica ederiz.${signature}` }
  ];
}

function ensureMailComposeModal() {
  let modal = document.getElementById("mailComposeModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.className = "modal-backdrop hidden";
  modal.id = "mailComposeModal";
  modal.innerHTML = `
    <div class="modal-content" style="width: 520px;">
      <h2 class="card-title">Müşteriye E-posta</h2>
      <p class="card-desc" id="mailComposeTo"></p>
      <form id="mailComposeForm" novalidate>
        <div class="form-group">
          <span class="form-label">Hazır şablonlar</span>
          <div class="mail-templates" id="mailComposeTemplates"></div>
        </div>
        <div class="form-group">
          <label class="form-label" for="mailComposeSubject">Konu *</label>
          <input type="text" id="mailComposeSubject" class="form-control" maxlength="150" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="mailComposeMessage">Mesaj *</label>
          <textarea id="mailComposeMessage" class="form-control" rows="7" maxlength="3000" required></textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" id="btnMailComposeCancel">İptal</button>
          <button type="submit" class="btn btn-primary" id="btnMailComposeSend">Gönder</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector("#btnMailComposeCancel").addEventListener("click", closeMailCompose);
  modal.querySelector("#mailComposeForm").addEventListener("submit", handleMailComposeSubmit);
  return modal;
}

function openMailCompose(customerId) {
  const customer = state.customers.find((c) => c.id === customerId);
  if (!ensureCustomerEmail(customer)) return;
  const modal = ensureMailComposeModal();
  mailComposeState.customerId = customerId;
  const form = modal.querySelector("#mailComposeForm");
  form.reset();
  clearFieldErrors(form);
  modal.querySelector("#mailComposeTo").textContent = `Alıcı: ${customer.firstName} ${customer.lastName} <${customer.email}>`;
  const templates = mailTemplates(customer);
  const box = modal.querySelector("#mailComposeTemplates");
  box.innerHTML = "";
  templates.forEach((tpl) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary btn-mini";
    btn.textContent = tpl.label;
    btn.addEventListener("click", () => {
      modal.querySelector("#mailComposeSubject").value = tpl.subject;
      modal.querySelector("#mailComposeMessage").value = tpl.message;
    });
    box.appendChild(btn);
  });
  modal.classList.remove("hidden");
  modal.querySelector("#mailComposeSubject").focus();
}

function closeMailCompose() {
  const modal = document.getElementById("mailComposeModal");
  if (modal) modal.classList.add("hidden");
  mailComposeState.customerId = null;
}

async function handleMailComposeSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearFieldErrors(form);
  const subject = fieldValue("mailComposeSubject");
  const message = fieldValue("mailComposeMessage");
  const errors = {};
  if (subject.length < 2) errors.mailComposeSubject = "Konu girin.";
  if (message.length < 2) errors.mailComposeMessage = "Mesaj girin.";
  if (applyFieldErrors(errors)) return;
  await withButtonLoading(document.getElementById("btnMailComposeSend"), "Gönderiliyor…", async () => {
    try {
      const result = await apiCall("sendMail", { kind: "message", customerId: mailComposeState.customerId, subject, message });
      closeMailCompose();
      showToast(`E-posta ${result.to} adresine gönderildi.`, "success");
    } catch (err) {
      reportError(err);
    }
  });
}

// ==========================================================================
// WHATSAPP (wa.me ile — işletmenin kendi WhatsApp'ından gönderilir)
// ==========================================================================
// Ek kurulum, API anahtarı veya ücret gerektirmez. Düğmeye basılınca müşterinin numarası
// ve hazır mesaj ile WhatsApp (mobilde uygulama, bilgisayarda WhatsApp Web / Masaüstü) açılır;
// işletme "Gönder"e basarak mesajı kendi hesabından iletir.

/** Telefonu WhatsApp'ın istediği uluslararası biçime (yalnızca rakam, ülke kodlu) çevirir. */
function whatsappNumber(phone) {
  let d = String(phone || "").replace(/[^\d+]/g, "");
  const international = d.startsWith("+") || d.startsWith("00");
  d = d.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (international) return d.length >= 8 && d.length <= 15 ? d : null;
  if (/^0\d{10}$/.test(d)) return `90${d.slice(1)}`;   // 05551234567
  if (/^\d{10}$/.test(d)) return `90${d}`;              // 5551234567
  if (/^90\d{10}$/.test(d)) return d;                   // 905551234567
  return null;
}

function openWhatsapp(phone, text) {
  const number = whatsappNumber(phone);
  if (!number) {
    showToast("Müşterinin telefon numarası WhatsApp için geçerli değil. Numarayı düzeltin.", "warning");
    return false;
  }
  const url = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) window.location.href = url; // açılır pencere engellendiyse aynı sekmede aç
  return true;
}

const WHATSAPP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:-2px;margin-right:3px"><path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.4-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.4.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg>`;

function receiptWhatsappButton(rec) {
  return html`<button type="button" class="btn btn-success btn-mini" onclick="sendServiceReceiptWhatsapp('${rec.id}')" title="Servis fişini araç sahibine WhatsApp ile gönder">${rawHtml(WHATSAPP_ICON)}WhatsApp</button>`;
}

function customerWhatsappButton(c) {
  return html`<button type="button" class="btn btn-success btn-mini" onclick="openWhatsappCompose('${c.id}')" title="Müşteriye WhatsApp mesajı gönder">${rawHtml(WHATSAPP_ICON)}WhatsApp</button>`;
}

function whatsappReceiptText(rec, customer) {
  const t = platform.tenant || {};
  const vehicle = state.vehicles.find((v) => v.id === rec.vehicleId);
  const total = parseFloat(rec.totalAmount) || 0;
  const paid = getPaidAmount(rec);
  const remaining = getRemainingAmount(rec);
  const items = TECHNICIANS
    .map((tech) => ({ label: tech.label, fee: Number(rec[tech.feeKey]) || 0, note: String(rec[tech.noteKey] || "").trim() }))
    .filter((i) => i.fee > 0 || i.note);
  const lines = [
    `*${t.name || "Servis"}*`,
    [t.phone, t.address].filter(Boolean).join(" · "),
    "",
    `Sayın ${customer.firstName} ${customer.lastName}, aracınıza yapılan işlemlerin özeti:`,
    ""
  ];
  if (vehicle) lines.push(`*Araç:* ${vehicle.plate} — ${vehicle.brand} ${vehicle.model}`);
  lines.push(`*Servis tarihi:* ${formatDate(rec.recordDate)}`);
  lines.push(`*Giriş km:* ${Number(rec.entryKm).toLocaleString("tr-TR")} km`);
  if (items.length) {
    lines.push("", "*Yapılan işlemler*");
    items.forEach((i) => lines.push(`• ${i.label}: ${formatMoney(i.fee)}${i.note ? ` (${i.note})` : ""}`));
  }
  if (rec.generalSummary) lines.push("", `*Açıklama:* ${rec.generalSummary}`);
  lines.push("", `*Toplam:* ${formatMoney(total)}`, `*Ödenen:* ${formatMoney(paid)}`);
  lines.push(`*Kalan:* ${formatMoney(remaining)}`, `*Ödeme durumu:* ${rec.paymentStatus}`);
  lines.push("", "Teşekkür ederiz.");
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim();
}

function sendServiceReceiptWhatsapp(recordId) {
  const rec = state.serviceRecords.find((r) => r.id === recordId);
  if (!rec) return;
  const customer = customerForRecord(rec);
  if (!customer) return;
  openWhatsapp(customer.phone, whatsappReceiptText(rec, customer));
}

// --- Müşteriye WhatsApp mesaj penceresi ---
const whatsappComposeState = { customerId: null };

function ensureWhatsappComposeModal() {
  let modal = document.getElementById("whatsappComposeModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.className = "modal-backdrop hidden";
  modal.id = "whatsappComposeModal";
  modal.innerHTML = `
    <div class="modal-content" style="width: 520px;">
      <h2 class="card-title">Müşteriye WhatsApp</h2>
      <p class="card-desc" id="whatsappComposeTo"></p>
      <form id="whatsappComposeForm" novalidate>
        <div class="form-group">
          <span class="form-label">Hazır şablonlar</span>
          <div class="mail-templates" id="whatsappComposeTemplates"></div>
        </div>
        <div class="form-group">
          <label class="form-label" for="whatsappComposeMessage">Mesaj *</label>
          <textarea id="whatsappComposeMessage" class="form-control" rows="7" maxlength="3000" required></textarea>
          <p class="field-hint">WhatsApp açılır; mesajı gözden geçirip WhatsApp içinden "Gönder"e basın.</p>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" id="btnWhatsappComposeCancel">İptal</button>
          <button type="submit" class="btn btn-success" id="btnWhatsappComposeSend">WhatsApp'ta Aç</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector("#btnWhatsappComposeCancel").addEventListener("click", closeWhatsappCompose);
  modal.querySelector("#whatsappComposeForm").addEventListener("submit", handleWhatsappComposeSubmit);
  return modal;
}

function openWhatsappCompose(customerId) {
  const customer = state.customers.find((c) => c.id === customerId);
  if (!customer) return;
  if (!whatsappNumber(customer.phone)) {
    showToast("Müşterinin telefon numarası WhatsApp için geçerli değil. Numarayı düzeltin.", "warning");
    openCustomerEditModal(customer.id);
    return;
  }
  const modal = ensureWhatsappComposeModal();
  whatsappComposeState.customerId = customerId;
  const form = modal.querySelector("#whatsappComposeForm");
  form.reset();
  clearFieldErrors(form);
  modal.querySelector("#whatsappComposeTo").textContent = `Alıcı: ${customer.firstName} ${customer.lastName} (${customer.phone})`;
  const box = modal.querySelector("#whatsappComposeTemplates");
  box.innerHTML = "";
  mailTemplates(customer).forEach((tpl) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary btn-mini";
    btn.textContent = tpl.label;
    btn.addEventListener("click", () => {
      modal.querySelector("#whatsappComposeMessage").value = `Sayın ${customer.firstName} ${customer.lastName},\n\n${tpl.message}`;
    });
    box.appendChild(btn);
  });
  modal.classList.remove("hidden");
  modal.querySelector("#whatsappComposeMessage").focus();
}

function closeWhatsappCompose() {
  const modal = document.getElementById("whatsappComposeModal");
  if (modal) modal.classList.add("hidden");
  whatsappComposeState.customerId = null;
}

function handleWhatsappComposeSubmit(event) {
  event.preventDefault();
  clearFieldErrors(event.currentTarget);
  const message = fieldValue("whatsappComposeMessage");
  if (applyFieldErrors(message.length < 2 ? { whatsappComposeMessage: "Mesaj girin." } : {})) return;
  const customer = state.customers.find((c) => c.id === whatsappComposeState.customerId);
  if (customer && openWhatsapp(customer.phone, message)) closeWhatsappCompose();
}
