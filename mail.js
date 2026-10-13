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
