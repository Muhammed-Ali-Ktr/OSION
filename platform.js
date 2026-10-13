/**
 * OSION - Platform katmanı
 * Oturum yönetimi, Supabase veri erişimi, giriş/kayıt/davet ekranları, ilk kurulum sihirbazı,
 * işletme ayarları ve işletme ayarlarına göre biçimlendirme (para birimi, tarih, marka).
 *
 * app.js'ten önce yüklenir. app.js'teki render fonksiyonları (renderAll, switchView vb.)
 * yalnızca çalışma anında çağrılır.
 *
 * Güvenlik notu: İstemcideki rol kontrolleri yalnızca arayüz kolaylığıdır.
 * Asıl yetkilendirme ve işletme veri ayrımı veritabanında (RLS, supabase/migrations) yapılır.
 */

const APP_CONFIG = Object.assign({ supabaseUrl: "", supabaseAnonKey: "", productName: "OSION", supportContact: "" }, window.OSION_CONFIG || {});
const ACTIVE_TENANT_KEY = "osion_active_tenant";
const CACHE_PREFIX = "osion_cache_";
const NOTICE_KEY = "osion_notice";
// Kullanım Koşulları / Aydınlatma Metni değişince güncellenir; kabul edilen sürüm kullanıcı kaydında saklanır.
const TERMS_VERSION = "2026-10";

const platform = {
  user: null,
  role: null,
  tenant: null,
  plan: null,
  tenants: [],
  mail: null,
  offline: false
};

/** Supabase istemcisi; bootApp içinde yapılandırma doğrulandıktan sonra oluşturulur. */
let sb = null;

const ROLE_LABELS = { owner: "İşletme Sahibi", admin: "Yönetici", staff: "Çalışan" };
const SUBSCRIPTION_LABELS = { trialing: "Deneme sürümü", active: "Aktif", past_due: "Ödeme gecikmiş", canceled: "İptal edildi" };
const CURRENCY_SYMBOLS = { TRY: "₺", EUR: "€", USD: "$", GBP: "£" };
const CURRENCY_OPTIONS = [
  { value: "TRY", label: "Türk Lirası (₺)" },
  { value: "EUR", label: "Euro (€)" },
  { value: "USD", label: "ABD Doları ($)" },
  { value: "GBP", label: "İngiliz Sterlini (£)" }
];
const LOCALE_OPTIONS = [
  { value: "tr-TR", label: "Türkiye — 1.234,56" },
  { value: "de-DE", label: "Almanya — 1.234,56" },
  { value: "en-GB", label: "Birleşik Krallık — 1,234.56" },
  { value: "en-US", label: "ABD — 1,234.56" }
];
const DATE_FORMAT_OPTIONS = [
  { value: "DD.MM.YYYY", label: "GG.AA.YYYY — 31.12.2026" },
  { value: "DD/MM/YYYY", label: "GG/AA/YYYY — 31/12/2026" },
  { value: "YYYY-MM-DD", label: "YYYY-AA-GG — 2026-12-31" },
  { value: "MM/DD/YYYY", label: "AA/GG/YYYY — 12/31/2026" }
];

// Veritabanındaki usta anahtarları (supabase/migrations: private.technician_keys ile aynı sıra).
const TECHNICIAN_KEYS = [
  "mechanic", "electrician", "boyaci", "cikmaci", "egzozcu", "frenci", "kapakci", "kaportaci",
  "kurtarici", "parcaci", "pompaci", "tornaci", "turbocu", "tupcu", "yagci", "yikamaci"
];

// ==========================================================================
// GÜVENLİ HTML ŞABLONU
// html`...` içine yerleştirilen tüm değerler otomatik kaçışlanır. Zaten güvenli
// olan HTML parçaları (başka html`` sonuçları veya rawHtml) olduğu gibi eklenir.
// ==========================================================================
class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function rawHtml(value) {
  return new SafeHtml(String(value ?? ""));
}

function renderHtmlValue(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(renderHtmlValue).join("");
  if (value === null || value === undefined || value === false) return "";
  return escapeHtml(value);
}

function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => { out += renderHtmlValue(value) + strings[i + 1]; });
  return new SafeHtml(out);
}

// ==========================================================================
// DEPOLAMA (tarayıcı izin vermezse sessizce devre dışı kalır)
// ==========================================================================
function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* kota dolu veya gizli mod */ }
}
function storageRemove(key) {
  try { localStorage.removeItem(key); } catch { /* yok say */ }
}
function clearTenantCaches() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* yok say */ }
}

// ==========================================================================
// VERİ DÖNÜŞÜMÜ (veritabanı snake_case <-> uygulama camelCase)
// ==========================================================================
function mapCustomer(r) {
  return {
    id: r.id, firstName: r.first_name, lastName: r.last_name, phone: r.phone, email: r.email || "",
    reference: r.reference, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at
  };
}

function mapVehicle(r) {
  return {
    id: r.id, customerId: r.customer_id, brand: r.brand, model: r.model, plate: r.plate,
    chassisNo: r.chassis_no, entryDate: r.entry_date, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at
  };
}

function mapServiceRecord(r) {
  const out = {
    id: r.id, vehicleId: r.vehicle_id, entryKm: Number(r.entry_km), recordDate: r.record_date,
    generalSummary: r.general_summary, paymentStatus: r.payment_status,
    totalAmount: Number(r.total_amount), paidAmount: Number(r.paid_amount), remainingAmount: Number(r.remaining_amount),
    createdAt: r.created_at, updatedAt: r.updated_at
  };
  const fees = r.fees || {};
  const notes = r.notes || {};
  TECHNICIAN_KEYS.forEach((k) => {
    out[`${k}Fee`] = Number(fees[k]) || 0;
    out[`${k}Note`] = notes[k] || "";
  });
  return out;
}

function mapTenant(r) {
  return {
    id: r.id, name: r.name || "", phone: r.phone || "", address: r.address || "", logoDataUrl: r.logo_data_url || "",
    currency: r.currency, locale: r.locale, dateFormat: r.date_format,
    legalName: r.legal_name || "", taxOffice: r.tax_office || "", taxNumber: r.tax_number || "",
    setupCompleted: !!r.setup_completed, status: r.status, createdAt: r.created_at
  };
}

function customerRow(p) {
  return {
    first_name: p.firstName, last_name: p.lastName, phone: p.phone, email: p.email || "",
    reference: p.reference || "", notes: p.notes || ""
  };
}

function vehicleRow(p) {
  return {
    customer_id: p.customerId, brand: p.brand, model: p.model, plate: p.plate,
    chassis_no: p.chassisNo || "", entry_date: p.entryDate || null, notes: p.notes || ""
  };
}

// Toplam, ödenen ve kalan tutarlar veritabanında hesaplanır; istemci yalnızca kalemleri gönderir.
function serviceRecordRow(p) {
  const fees = {};
  const notes = {};
  TECHNICIAN_KEYS.forEach((k) => {
    fees[k] = Number(p[`${k}Fee`]) || 0;
    notes[k] = p[`${k}Note`] || "";
  });
  return {
    vehicle_id: p.vehicleId, entry_km: p.entryKm, record_date: p.recordDate,
    general_summary: p.generalSummary || "", payment_status: p.paymentStatus || "Ödenmedi",
    paid_amount: Number(p.paidAmount) || 0, fees, notes
  };
}

function tenantProfileRow(p) {
  return {
    name: p.name, phone: p.phone, address: p.address, logo_data_url: p.logoDataUrl || "",
    currency: p.currency, locale: p.locale, date_format: p.dateFormat,
    legal_name: p.legalName || "", tax_office: p.taxOffice || "", tax_number: p.taxNumber || ""
  };
}

function mapTenantData(data) {
  return {
    customers: (data.customers || []).map(mapCustomer),
    vehicles: (data.vehicles || []).map(mapVehicle),
    serviceRecords: (data.serviceRecords || []).map(mapServiceRecord)
  };
}

function mapBootstrap(b) {
  return {
    user: b.user,
    tenants: b.tenants || [],
    needsTenantChoice: !!b.needsTenantChoice,
    noTenant: !!b.noTenant,
    role: b.role || null,
    tenant: b.tenant ? mapTenant(b.tenant) : null,
    plan: b.plan || null,
    data: b.data ? mapTenantData(b.data) : null
  };
}

// ==========================================================================
// API İSTEMCİSİ
// app.js ve ayar ekranları işlemleri isimleriyle çağırır (apiCall("addCustomer", ...)).
// Her işlem tek bir Supabase isteğidir; yetki ve işletme ayrımını veritabanı denetler.
// ==========================================================================
class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const NETWORK_MESSAGE = "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.";

function isNetworkError(error) {
  // Supabase Auth, sunucu tarafı zaman aşımlarını (ör. e-posta sunucusu yanıt vermeyince 504)
  // de "AuthRetryableFetchError" olarak bildirir; bunlar kullanıcının bağlantı sorunu değildir.
  if (error && Number(error.status) >= 500) return false;
  const text = `${error && error.name} ${error && error.message}`;
  return /Failed to fetch|NetworkError|Load failed|fetch failed|AuthRetryableFetchError|network/i.test(text);
}

/** Supabase / PostgREST hatasını kullanıcıya gösterilebilir ApiError'a çevirir. */
function toApiError(error) {
  if (error instanceof ApiError) return error;
  if (!error) return new ApiError("İşlem tamamlanamadı.", "UNKNOWN");
  // Veritabanı fonksiyonlarımız hata kodunu "hint" alanında, Türkçe mesajı "message" alanında döndürür.
  if (error.hint && /^[A-Z_]+$/.test(error.hint)) return new ApiError(error.message, error.hint);
  if (isNetworkError(error)) return new ApiError(NETWORK_MESSAGE, "NETWORK");
  switch (error.code) {
    case "42501": return new ApiError("Bu işlem için yetkiniz bulunmuyor.", "FORBIDDEN");
    case "23503": return new ApiError("İlişkili kayıt bulunamadı. Sayfayı yenileyip tekrar deneyin.", "NOT_FOUND");
    case "23502": case "23514": case "22001": case "22003": case "22007": case "22008": case "22P02":
      return new ApiError("Girilen bilgilerden biri geçersiz. Alanları kontrol edip tekrar deneyin.", "VALIDATION");
    case "PGRST116": return new ApiError("Kayıt bulunamadı veya bu işlem için yetkiniz yok.", "NOT_FOUND");
    case "PGRST301": case "PGRST303":
      return new ApiError("Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.", "AUTH_REQUIRED");
    default: break;
  }
  if (error.status === 401 || /JWT|refresh token/i.test(String(error.message))) {
    return new ApiError("Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.", "AUTH_REQUIRED");
  }
  console.error("[OSION] Beklenmeyen hata:", error);
  return new ApiError("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.", "UNKNOWN");
}

/** Supabase Auth hatalarını Türkçe mesaja çevirir. */
function authErrorMessage(error) {
  if (isNetworkError(error)) return NETWORK_MESSAGE;
  const code = error && (error.code || "");
  const msg = String(error && error.message || "");
  if (code === "invalid_credentials" || /Invalid login credentials/i.test(msg)) return "E-posta veya şifre hatalı.";
  if (code === "email_not_confirmed" || /Email not confirmed/i.test(msg)) return "E-posta adresiniz henüz doğrulanmadı. Gelen kutunuzdaki doğrulama bağlantısına tıklayın.";
  if (code === "user_already_exists" || /already registered/i.test(msg)) return "Bu e-posta adresiyle kayıtlı bir hesap zaten var. Lütfen giriş yapın.";
  if (code === "weak_password" || /password/i.test(msg) && /least|weak|short/i.test(msg)) return "Şifre yeterince güçlü değil. En az 8 karakter, harf ve rakam kullanın.";
  if (code === "same_password") return "Yeni şifre eskisiyle aynı olamaz.";
  if (/rate limit|too many|security purposes/i.test(msg) || code === "over_email_send_rate_limit" || code === "over_request_rate_limit") {
    return "Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.";
  }
  if (code === "signup_disabled" || /Signups not allowed/i.test(msg)) return "Yeni hesap açılışı şu anda kapalı. Hizmet sağlayıcınızla iletişime geçin.";
  if (code === "otp_expired" || /expired/i.test(msg)) return "Bağlantının süresi dolmuş. Lütfen yeni bir bağlantı isteyin.";
  if (/sending .*email|email .*send|smtp/i.test(msg) || Number(error && error.status) >= 500) {
    return "E-posta şu anda gönderilemedi (e-posta sunucusu yanıt vermedi). Lütfen birkaç dakika sonra tekrar deneyin; sorun sürerse hizmet sağlayıcınıza bildirin.";
  }
  console.error("[OSION] Kimlik doğrulama hatası:", error);
  return "İşlem tamamlanamadı. Lütfen tekrar deneyin.";
}

/** { data, error } döndüren Supabase çağrısını bekler; hata varsa ApiError fırlatır. */
async function run(promise) {
  let result;
  try {
    result = await promise;
  } catch (err) {
    throw toApiError(err);
  }
  if (result.error) throw toApiError(result.error);
  return result.data;
}

const rpc = (fn, args) => run(sb.rpc(fn, args));

function requireTenantId() {
  if (!platform.tenant) throw new ApiError("Aktif işletme bulunamadı. Sayfayı yenileyin.", "AUTH_REQUIRED");
  return platform.tenant.id;
}

function findState(list, id, label) {
  const item = state[list].find((x) => x.id === id);
  if (!item) throw new ApiError(`${label} bulunamadı. Sayfayı yenileyip tekrar deneyin.`, "NOT_FOUND");
  return item;
}

async function insertRow(table, row, mapper) {
  return mapper(await run(sb.from(table).insert({ ...row, tenant_id: requireTenantId() }).select().single()));
}

async function updateRow(table, id, row, mapper) {
  return mapper(await run(sb.from(table).update(row).eq("id", id).select().single()));
}

// RLS bir silmeyi engellediğinde PostgREST hata değil boş sonuç döndürür; bunu yetki hatasına çeviririz.
async function deleteRow(table, id) {
  const rows = await run(sb.from(table).delete().eq("id", id).select("id"));
  if (!rows || !rows.length) throw new ApiError("Kayıt silinemedi: kayıt bulunamadı veya bu işlem için yetkiniz yok.", "FORBIDDEN");
  return { id };
}

/** Oturum sahibinin şifresini yeniden doğrular (hassas işlemler öncesi). */
async function verifyCurrentPassword(password) {
  const { error } = await sb.auth.signInWithPassword({ email: platform.user.email, password: password || "" });
  if (error) {
    throw new ApiError(isNetworkError(error) ? NETWORK_MESSAGE : "Şifreniz hatalı.", isNetworkError(error) ? "NETWORK" : "INVALID_CREDENTIALS");
  }
}

const API_ACTIONS = {
  bootstrap: async () => mapBootstrap(await rpc("app_bootstrap", { p_tenant: storageGet(ACTIVE_TENANT_KEY) || null })),
  getData: async () => {
    const b = mapBootstrap(await rpc("app_bootstrap", { p_tenant: requireTenantId() }));
    if (b.tenant) {
      platform.tenant = b.tenant;
      platform.plan = b.plan;
      platform.role = b.role;
    }
    return b.data || { customers: [], vehicles: [], serviceRecords: [] };
  },

  addCustomer: (p) => insertRow("customers", customerRow(p), mapCustomer),
  updateCustomer: (p) => updateRow("customers", p.id, customerRow({ ...findState("customers", p.id, "Müşteri"), ...p }), mapCustomer),
  deleteCustomer: (p) => deleteRow("customers", p.id),
  addVehicle: (p) => insertRow("vehicles", vehicleRow(p), mapVehicle),
  updateVehicle: (p) => updateRow("vehicles", p.id, vehicleRow({ ...findState("vehicles", p.id, "Araç"), ...p }), mapVehicle),
  deleteVehicle: (p) => deleteRow("vehicles", p.id),
  addServiceRecord: (p) => insertRow("service_records", serviceRecordRow(p), mapServiceRecord),
  updateServiceRecord: (p) => updateRow("service_records", p.id,
    serviceRecordRow({ ...findState("serviceRecords", p.id, "Servis kaydı"), ...p }), mapServiceRecord),
  deleteServiceRecord: (p) => deleteRow("service_records", p.id),

  saveBusinessProfile: async (p) => {
    await run(sb.from("tenants").update(tenantProfileRow(p)).eq("id", requireTenantId()).select("id").single());
    return API_ACTIONS.bootstrap();
  },
  listMembers: () => rpc("list_members", { p_tenant: requireTenantId() }),
  createInvite: (p) => rpc("create_invite", { p_tenant: requireTenantId(), p_email: p.email, p_role: p.role }),
  revokeInvite: (p) => rpc("revoke_invite", { p_tenant: requireTenantId(), p_id: p.id }),
  updateMemberRole: (p) => rpc("update_member_role", { p_tenant: requireTenantId(), p_membership: p.membershipId, p_role: p.role }),
  removeMember: (p) => rpc("remove_member", { p_tenant: requireTenantId(), p_membership: p.membershipId }),
  exportTenantData: async () => {
    const b = await API_ACTIONS.bootstrap();
    return { exportedAt: new Date().toISOString(), tenant: b.tenant, data: b.data };
  },
  closeTenant: async (p) => {
    await verifyCurrentPassword(p.password);
    return rpc("close_tenant", { p_tenant: requireTenantId(), p_confirm_name: p.confirmName });
  },
  mailStatus: () => rpc("mail_status", { p_tenant: requireTenantId() }),
  saveMailSettings: (p) => rpc("save_mail_settings", {
    p_tenant: requireTenantId(), p_provider: p.provider, p_host: p.host || null,
    p_user: p.user, p_password: p.password || "", p_from_name: p.fromName || ""
  }),
  deleteMailSettings: () => rpc("delete_mail_settings", { p_tenant: requireTenantId() }),
  sendMail: async (p) => {
    // Gönderim, işletmenin SMTP şifresini çözebilen "send-mail" Edge Function'ında yapılır.
    let result;
    try {
      result = await sb.functions.invoke("send-mail", { body: { ...p, tenantId: requireTenantId() } });
    } catch (err) {
      throw toApiError(err);
    }
    if (!result.error) return result.data;
    const err = result.error;
    if (err.context && typeof err.context.json === "function") {
      let body = null;
      try { body = await err.context.json(); } catch { /* gövde okunamadı */ }
      if (body && body.error) throw new ApiError(body.error, body.code || "SEND_FAILED");
      if (err.context.status === 401) throw new ApiError("Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.", "AUTH_REQUIRED");
      if (err.context.status === 404) throw new ApiError("E-posta servisi henüz kurulmamış (send-mail). Hizmet sağlayıcınızla iletişime geçin.", "MAIL_NOT_CONFIGURED");
    }
    if (err.name === "FunctionsFetchError") throw new ApiError(NETWORK_MESSAGE, "NETWORK");
    throw toApiError(err);
  },
  changePassword: async (p) => {
    await verifyCurrentPassword(p.currentPassword);
    const { error } = await sb.auth.updateUser({ password: p.newPassword });
    if (error) throw new ApiError(authErrorMessage(error), isNetworkError(error) ? "NETWORK" : "VALIDATION");
    // Diğer cihazlardaki oturumlar kapatılır; bu cihaz açık kalır.
    try { await sb.auth.signOut({ scope: "others" }); } catch { /* yok say */ }
    return { changed: true };
  }
};

async function apiCall(action, payload = {}) {
  const handler = API_ACTIONS[action];
  if (!handler) throw new ApiError("Geçersiz işlem isteği.", "BAD_REQUEST");
  try {
    return await handler(payload);
  } catch (error) {
    const err = toApiError(error);
    if (err.code === "AUTH_REQUIRED") {
      err.handled = true;
      handleSessionExpired(err.message);
    }
    throw err;
  }
}

/**
 * Başarılı bir yazma işleminin sonucunu yerel duruma uygular.
 * Böylece her kayıttan sonra tüm işletme verisini yeniden indirmeye gerek kalmaz.
 */
function applyLocalChange(action, payload, result) {
  const upsert = (list, item) => {
    const i = state[list].findIndex((x) => x.id === item.id);
    if (i === -1) state[list].push(item);
    else state[list][i] = item;
  };
  switch (action) {
    case "addCustomer": case "updateCustomer": upsert("customers", result); break;
    case "addVehicle": case "updateVehicle": upsert("vehicles", result); break;
    case "addServiceRecord": case "updateServiceRecord": upsert("serviceRecords", result); break;
    case "deleteServiceRecord":
      state.serviceRecords = state.serviceRecords.filter((r) => r.id !== payload.id);
      break;
    case "deleteVehicle":
      state.vehicles = state.vehicles.filter((v) => v.id !== payload.id);
      state.serviceRecords = state.serviceRecords.filter((r) => r.vehicleId !== payload.id);
      break;
    case "deleteCustomer": {
      // Veritabanı müşteriye bağlı araçları ve servis kayıtlarını da siler (ON DELETE CASCADE).
      const vehicleIds = new Set(state.vehicles.filter((v) => v.customerId === payload.id).map((v) => v.id));
      state.customers = state.customers.filter((c) => c.id !== payload.id);
      state.vehicles = state.vehicles.filter((v) => !vehicleIds.has(v.id));
      state.serviceRecords = state.serviceRecords.filter((r) => !vehicleIds.has(r.vehicleId));
      break;
    }
    default: return false;
  }
  writeTenantCache();
  return true;
}

function reportError(err) {
  if (err && err.handled) return;
  showToast((err && err.message) || "Beklenmeyen bir hata oluştu.", "error");
}

async function handleSessionExpired(message) {
  try { await sb.auth.signOut({ scope: "local" }); } catch { /* yok say */ }
  clearTenantCaches();
  try { sessionStorage.setItem(NOTICE_KEY, message || "Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın."); } catch { /* yok say */ }
  // Sayfayı yeniden yükleyerek önceki işletmenin verisinin bellekte/ekranda kalmamasını garanti ederiz.
  window.location.reload();
}

// ==========================================================================
// OTURUM VE VERİ ÖNBELLEĞİ
// ==========================================================================
function applySession(data) {
  if (data.tenant) storageSet(ACTIVE_TENANT_KEY, data.tenant.id);
  platform.user = data.user;
  platform.role = data.role;
  platform.tenant = data.tenant;
  platform.plan = data.plan;
  platform.tenants = data.tenants || [];
  if (data.data) setTenantData(data.data);
}

function setTenantData(data, { fromCache = false } = {}) {
  state.customers = normalizeCustomerPhones(data.customers || []);
  state.vehicles = data.vehicles || [];
  state.serviceRecords = data.serviceRecords || [];
  if (!fromCache) writeTenantCache();
}

function tenantCacheKey() {
  return platform.tenant && platform.user ? `${CACHE_PREFIX}${platform.tenant.id}_${platform.user.id}` : null;
}

// Çevrimdışı salt okunur görüntüleme için son veriler, işletme + kullanıcı anahtarıyla saklanır
// ve çıkışta silinir. Böylece aynı tarayıcıda başka bir işletmenin verisi gösterilmez.
function writeTenantCache() {
  const key = tenantCacheKey();
  if (!key) return;
  storageSet(key, JSON.stringify({
    savedAt: new Date().toISOString(),
    session: { user: platform.user, role: platform.role, tenant: platform.tenant, plan: platform.plan, tenants: platform.tenants },
    data: { customers: state.customers, vehicles: state.vehicles, serviceRecords: state.serviceRecords }
  }));
  storageSet(`${CACHE_PREFIX}last`, key);
}

function readLastTenantCache() {
  const key = storageGet(`${CACHE_PREFIX}last`);
  if (!key) return null;
  try { return JSON.parse(storageGet(key)); } catch { return null; }
}

function isManager() {
  return platform.role === "owner" || platform.role === "admin";
}
function isOwner() {
  return platform.role === "owner";
}
function canDelete() {
  return isManager() && !platform.offline;
}

// ==========================================================================
// BİÇİMLENDİRME (işletme ayarlarına göre)
// ==========================================================================
function tenantSettings() {
  const t = platform.tenant || {};
  return { currency: t.currency || "TRY", locale: t.locale || "tr-TR", dateFormat: t.dateFormat || "DD.MM.YYYY" };
}

function formatMoneyWith(value, currency, locale) {
  const n = Number(value) || 0;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${CURRENCY_SYMBOLS[currency] || currency}`;
  }
}

function formatMoney(value) {
  const s = tenantSettings();
  return formatMoneyWith(value, s.currency, s.locale);
}

function formatNumber(value) {
  return (Number(value) || 0).toLocaleString(tenantSettings().locale);
}

function currencySymbol() {
  const { currency } = tenantSettings();
  return CURRENCY_SYMBOLS[currency] || currency;
}

const pad2 = (n) => String(n).padStart(2, "0");

// "YYYY-AA-GG" değerleri yerel takvim günü olarak yorumlanır (UTC kayması olmaz).
function parseDateValue(value) {
  if (!value) return null;
  const s = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateWith(value, format) {
  const d = parseDateValue(value);
  if (!d) return "";
  return format.replace("DD", pad2(d.getDate())).replace("MM", pad2(d.getMonth() + 1)).replace("YYYY", String(d.getFullYear()));
}

function formatDisplayDate(value) {
  return formatDateWith(value, tenantSettings().dateFormat);
}

function toIsoDate(value) {
  const d = parseDateValue(value);
  return d ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : "";
}

function todayIso() {
  return toIsoDate(new Date().toString());
}

function initials(text) {
  return String(text || "").trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toLocaleUpperCase("tr-TR")).join("");
}

// ==========================================================================
// EKRAN YÖNETİMİ
// ==========================================================================
const SCREEN_IDS = { boot: "bootScreen", notice: "noticeScreen", auth: "authScreen", setup: "setupScreen" };

function showScreen(name) {
  Object.entries(SCREEN_IDS).forEach(([key, id]) => {
    document.getElementById(id).classList.toggle("hidden", key !== name);
  });
  document.body.classList.toggle("app-ready", name === "app");
}

function showNotice({ title, message, actions = [] }) {
  document.getElementById("noticeTitle").textContent = title;
  document.getElementById("noticeMessage").textContent = message;
  const container = document.getElementById("noticeActions");
  container.innerHTML = "";
  actions.forEach(({ label, onClick, variant = "primary" }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn btn-${variant}`;
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    container.appendChild(btn);
  });
  showScreen("notice");
}

function showAlert(id, message, type = "error") {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `form-alert form-alert-${type}`;
  el.textContent = message;
}

function hideAlert(id) {
  const el = document.getElementById(id);
  if (el) el.className = "form-alert hidden";
}

function setFieldError(input, message) {
  if (!input) return;
  input.classList.add("is-invalid");
  input.setAttribute("aria-invalid", "true");
  const group = input.closest(".form-group") || input.parentElement;
  let el = group.querySelector(".field-error");
  if (!el) {
    el = document.createElement("p");
    el.className = "field-error";
    group.appendChild(el);
  }
  el.textContent = message;
}

function clearFieldErrors(root) {
  root.querySelectorAll(".is-invalid").forEach((el) => {
    el.classList.remove("is-invalid");
    el.removeAttribute("aria-invalid");
  });
  root.querySelectorAll(".field-error").forEach((el) => el.remove());
}

/** { inputId: mesaj } nesnesini alanlara uygular; hata varsa true döner. */
function applyFieldErrors(errors) {
  const ids = Object.keys(errors);
  ids.forEach((id) => setFieldError(document.getElementById(id), errors[id]));
  if (ids.length) {
    const first = document.getElementById(ids[0]);
    if (first && first.focus) first.focus();
  }
  return ids.length > 0;
}

async function withButtonLoading(button, loadingText, fn) {
  const original = button ? button.textContent : "";
  if (button) {
    button.disabled = true;
    button.textContent = loadingText;
  }
  try {
    return await fn();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[0-9+()\-\s]{7,25}$/;

function passwordProblem(password) {
  if (password.length < 8) return "Şifre en az 8 karakter olmalıdır.";
  if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(password) || !/\d/.test(password)) return "Şifre en az bir harf ve bir rakam içermelidir.";
  return "";
}

const fieldValue = (id) => (document.getElementById(id)?.value || "").trim();

// ==========================================================================
// AÇILIŞ AKIŞI
// ==========================================================================
async function bootApp() {
  document.querySelectorAll("[data-product-name]").forEach((el) => { el.textContent = APP_CONFIG.productName; });
  document.title = APP_CONFIG.productName;

  if (!APP_CONFIG.supabaseUrl || !APP_CONFIG.supabaseAnonKey || !window.supabase) {
    showNotice({
      title: "Sunucu bağlantısı yapılandırılmamış",
      message: "config.js dosyasındaki supabaseUrl ve supabaseAnonKey alanlarını doldurun. Kurulum adımları README.md dosyasındadır."
    });
    return;
  }

  let notice = null;
  try {
    notice = sessionStorage.getItem(NOTICE_KEY);
    sessionStorage.removeItem(NOTICE_KEY);
  } catch { /* yok say */ }

  // E-posta bağlantılarından (doğrulama, şifre sıfırlama) dönüşte adres çubuğundaki bilgiler.
  const hashParams = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const isRecovery = hashParams.get("type") === "recovery";
  const linkError = hashParams.get("error_description") || hashParams.get("error");
  const inviteCode = readInviteCodeFromHash();

  sb = window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" }
  });

  const { data: sessionData, error: sessionError } = await sb.auth.getSession();
  if (hashParams.has("access_token") || linkError) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  const session = sessionData && sessionData.session;

  if (isRecovery && session) {
    showAuth("newpass");
    return;
  }
  if (!session) {
    if (sessionError && isNetworkError(sessionError) && enterOfflineFromCache()) return;
    const message = linkError
      ? authErrorMessage({ message: linkError, code: hashParams.get("error_code") || "" })
      : notice;
    showAuth(inviteCode ? "invite" : "login", { message, inviteCode });
    return;
  }

  try {
    handleBootstrap(await apiCall("bootstrap"));
  } catch (err) {
    if (err.handled) return;
    if (err.code === "NETWORK" && enterOfflineFromCache()) return;
    showNotice({
      title: "Bağlantı kurulamadı",
      message: err.message,
      actions: [
        { label: "Tekrar Dene", onClick: () => window.location.reload() },
        { label: "Çıkış Yap", variant: "secondary", onClick: () => logout() }
      ]
    });
  }
}

function enterOfflineFromCache() {
  const cached = readLastTenantCache();
  if (!cached || !cached.session || !cached.session.tenant || !cached.session.tenant.setupCompleted) return false;
  applySession({ ...cached.session });
  setTenantData(cached.data || {}, { fromCache: true });
  enterApp({ offline: true });
  showToast("Sunucuya ulaşılamadı. Son kaydedilen veriler salt okunur gösteriliyor.", "warning");
  return true;
}

/** Açılış verisine göre işletme seçimi, bilgilendirme veya uygulamaya giriş. */
function handleBootstrap(data) {
  if (data.needsTenantChoice) {
    showAuth("choose");
    renderTenantChoices(data.tenants);
    return;
  }
  if (!data.tenant) {
    showNotice({
      title: "Bağlı işletme bulunamadı",
      message: "Bu hesaba bağlı aktif bir işletme yok. Bir işletmeye davet edildiyseniz davet kodunuzla katılabilirsiniz.",
      actions: [
        { label: "Davet Kodu Gir", onClick: () => showAuth("invite") },
        { label: "Çıkış Yap", variant: "secondary", onClick: () => logout() }
      ]
    });
    return;
  }
  applySession(data);
  routeAfterAuth();
}

function readInviteCodeFromHash() {
  const m = /^#davet=([A-Za-z0-9-]{16,40})$/.exec(window.location.hash || "");
  if (!m) return "";
  // Kodu adres çubuğunda/geçmişte bırakmamak için hemen temizle.
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return m[1];
}

function routeAfterAuth() {
  if (!platform.tenant.setupCompleted) {
    if (isManager()) {
      showSetupWizard();
    } else {
      showNotice({
        title: "İşletme kurulumu bekleniyor",
        message: `${platform.tenant.name} için ilk kurulum henüz tamamlanmadı. İşletme sahibi kurulumu tamamladığında uygulamayı kullanabilirsiniz.`,
        actions: [
          { label: "Tekrar Kontrol Et", onClick: () => window.location.reload() },
          { label: "Çıkış Yap", variant: "secondary", onClick: () => logout() }
        ]
      });
    }
    return;
  }
  enterApp();
}

function enterApp({ offline = false } = {}) {
  platform.offline = offline;
  applyTenantBranding();
  showScreen("app");
  renderAll();
  const target = state.currentView && document.getElementById(`view-${state.currentView}`) ? state.currentView : "dashboard";
  switchView(target);
  setSyncStatus(offline ? "offline" : "connected");
  if (!offline) loadMailStatus();
  if (!offline && platform.plan && platform.plan.canWrite === false) {
    showToast("Deneme süreniz veya aboneliğiniz sona erdi. Kayıtlarınızı görüntüleyebilirsiniz; yeni kayıt için aboneliğinizi yenileyin.", "warning");
  }
}

async function logout() {
  // "local": yalnızca bu cihazın oturumu kapanır; çevrimdışıyken de yerel oturum silinir.
  if (sb) {
    try { await sb.auth.signOut({ scope: "local" }); } catch { /* oturum zaten geçersiz olabilir */ }
  }
  storageRemove(ACTIVE_TENANT_KEY);
  clearTenantCaches();
  window.location.reload();
}

function setSyncStatus(status) {
  const dot = document.getElementById("apiStatusDot");
  const text = document.getElementById("apiStatusText");
  const badge = document.getElementById("apiStatusBadge");
  if (!dot || !text) return;
  const map = {
    syncing: ["status-dot", "Senkronize ediliyor…", "Sunucuyla veri alışverişi yapılıyor."],
    connected: ["status-dot connected", "Sunucuya bağlı", "Veriler sunucuyla senkronize."],
    offline: ["status-dot local", "Çevrimdışı · salt okunur", "Sunucuya ulaşılamadı; son kaydedilen veriler gösteriliyor."],
    error: ["status-dot error", "Bağlantı hatası", "Son işlem sunucuya iletilemedi."]
  };
  const [cls, label, title] = map[status] || map.connected;
  dot.className = cls;
  text.textContent = label;
  if (badge) badge.title = title;
}

function applyTenantBranding() {
  const t = platform.tenant;
  document.title = `${t.name} · ${APP_CONFIG.productName}`;
  document.getElementById("tenantNameText").textContent = t.name;
  renderLogoInto(document.getElementById("tenantLogo"), t.logoDataUrl, t.name);
  document.querySelectorAll("[data-currency-symbol]").forEach((el) => { el.textContent = currencySymbol(); });

  document.getElementById("userAvatar").textContent = initials(platform.user.displayName || platform.user.email);
  document.getElementById("userNameText").textContent = platform.user.displayName || platform.user.email;
  document.getElementById("userRoleText").textContent = ROLE_LABELS[platform.role] || "";

  document.body.classList.remove("role-owner", "role-admin", "role-staff");
  document.body.classList.add(`role-${platform.role}`);
  document.body.classList.toggle("is-offline", platform.offline);
  const adminOption = document.querySelector('#newInviteRole option[value="admin"]');
  if (adminOption) adminOption.disabled = !isOwner();
}

function renderLogoInto(el, dataUrl, name) {
  if (!el) return;
  el.innerHTML = "";
  if (dataUrl && /^data:image\/(png|jpeg|webp);base64,/.test(dataUrl)) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = dataUrl;
    el.appendChild(img);
    el.classList.add("has-image");
  } else {
    el.textContent = initials(name) || "?";
    el.classList.remove("has-image");
  }
}

// ==========================================================================
// GİRİŞ / KAYIT / DAVET
// ==========================================================================
function showAuth(tab = "login", { message, inviteCode } = {}) {
  showAuthTab(tab);
  if (message) showAlert("authAlert", message, "info");
  if (inviteCode) document.getElementById("inv_code").value = inviteCode;
  showScreen("auth");
  const firstInput = document.querySelector(`[data-auth-panel="${tab}"] input:not([type=hidden])`);
  if (firstInput) firstInput.focus();
}

function showAuthTab(tab) {
  hideAlert("authAlert");
  document.querySelectorAll("[data-auth-panel]").forEach((el) => {
    el.classList.toggle("hidden", el.dataset.authPanel !== tab);
    clearFieldErrors(el);
  });
  document.querySelectorAll("[data-auth-tab]").forEach((el) => {
    const active = el.dataset.authTab === tab;
    el.classList.toggle("active", active);
    el.setAttribute("aria-selected", String(active));
  });
}

function clearAuthPasswords() {
  ["login_password", "reg_password", "reg_password2", "inv_password", "np_password", "np_password2"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

/** Oturum açıldıktan sonra işletme verisini yükleyip uygun ekrana geçer. */
async function continueAfterSignIn() {
  clearAuthPasswords();
  handleBootstrap(await apiCall("bootstrap"));
}

function termsAcceptance() {
  return { terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString() };
}

/** E-posta doğrulama ve şifre sıfırlama bağlantılarının döneceği adres (bu sayfa). */
function appUrl() {
  return window.location.origin + window.location.pathname;
}

async function finishSignIn() {
  try {
    await continueAfterSignIn();
  } catch (err) {
    if (!err.handled) showAlert("authAlert", err.message);
  }
}

function showResendConfirmation(email) {
  const alert = document.getElementById("authAlert");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "link-btn";
  btn.textContent = "Doğrulama e-postasını tekrar gönder";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const { error } = await sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: appUrl() } });
    showAlert("authAlert", error ? authErrorMessage(error) : "Doğrulama e-postası tekrar gönderildi. Gelen kutunuzu (ve gereksiz klasörünü) kontrol edin.", error ? "error" : "success");
  });
  alert.appendChild(document.createTextNode(" "));
  alert.appendChild(btn);
}

function isUnconfirmedEmail(error) {
  return error.code === "email_not_confirmed" || /Email not confirmed/i.test(error.message);
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearFieldErrors(form);
  hideAlert("authAlert");
  const email = fieldValue("login_email").toLowerCase();
  const password = document.getElementById("login_password").value;
  const errors = {};
  if (!EMAIL_RE.test(email)) errors.login_email = "Geçerli bir e-posta adresi girin.";
  if (!password) errors.login_password = "Şifrenizi girin.";
  if (applyFieldErrors(errors)) return;

  await withButtonLoading(document.getElementById("btnLogin"), "Giriş yapılıyor…", async () => {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      showAlert("authAlert", authErrorMessage(error));
      if (isUnconfirmedEmail(error)) showResendConfirmation(email);
      return;
    }
    await finishSignIn();
  });
}

function renderTenantChoices(tenants) {
  const list = document.getElementById("tenantChoiceList");
  list.innerHTML = "";
  tenants.forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tenant-choice";
    btn.innerHTML = html`<span class="tenant-choice-avatar">${initials(t.name)}</span>
      <span class="tenant-choice-text"><strong>${t.name}</strong><small>${ROLE_LABELS[t.role] || ""}</small></span>
      <span aria-hidden="true">&rarr;</span>`;
    btn.addEventListener("click", async () => {
      list.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      storageSet(ACTIVE_TENANT_KEY, t.id);
      await finishSignIn();
      list.querySelectorAll("button").forEach((b) => { b.disabled = false; });
    });
    list.appendChild(btn);
  });
}

/**
 * E-posta doğrulaması açıkken kayıtlı bir e-postayla tekrar kayıt olunursa Supabase hata
 * yerine kimliği (identity) olmayan bir kullanıcı döndürür; bunu ayırt ederiz.
 */
function isExistingAccountSignup(data) {
  return !!(data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0);
}

/** Doğrulama e-postası gönderildiyse giriş sekmesine dönüp bilgi verir. */
function showCheckEmail(form, email, message) {
  form.reset();
  showAuth("login");
  document.getElementById("login_email").value = email;
  showAlert("authAlert", message, "success");
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearFieldErrors(form);
  hideAlert("authAlert");
  const payload = {
    businessName: fieldValue("reg_businessName"),
    displayName: fieldValue("reg_displayName"),
    email: fieldValue("reg_email").toLowerCase(),
    password: document.getElementById("reg_password").value
  };
  const errors = {};
  if (payload.businessName.length < 2) errors.reg_businessName = "İşletme adı en az 2 karakter olmalıdır.";
  if (payload.displayName.length < 2) errors.reg_displayName = "Adınızı ve soyadınızı girin.";
  if (!EMAIL_RE.test(payload.email)) errors.reg_email = "Geçerli bir e-posta adresi girin.";
  const pwProblem = passwordProblem(payload.password);
  if (pwProblem) errors.reg_password = pwProblem;
  else if (payload.password !== document.getElementById("reg_password2").value) errors.reg_password2 = "Şifreler eşleşmiyor.";
  if (!document.getElementById("reg_terms").checked) errors.reg_terms = "Devam etmek için Kullanım Koşulları'nı kabul edin.";
  if (applyFieldErrors(errors)) return;

  await withButtonLoading(document.getElementById("btnRegister"), "Hesap oluşturuluyor…", async () => {
    // İşletme ve sahip üyeliği, kullanıcı oluşturulurken veritabanında açılır (handle_new_user).
    const { data, error } = await sb.auth.signUp({
      email: payload.email,
      password: payload.password,
      options: {
        data: { display_name: payload.displayName, business_name: payload.businessName, ...termsAcceptance() },
        emailRedirectTo: appUrl()
      }
    });
    if (error) return showAlert("authAlert", authErrorMessage(error));
    if (isExistingAccountSignup(data)) {
      return showAlert("authAlert", "Bu e-posta adresiyle kayıtlı bir hesap zaten var. Lütfen giriş yapın.");
    }
    if (data.session) return finishSignIn();
    showCheckEmail(form, payload.email,
      `Hesabınız oluşturuldu. ${payload.email} adresine gönderilen doğrulama bağlantısına tıklayın; ardından otomatik olarak giriş yapacaksınız.`);
  });
}

async function handleInviteSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearFieldErrors(form);
  hideAlert("authAlert");
  const payload = {
    code: fieldValue("inv_code"),
    email: fieldValue("inv_email").toLowerCase(),
    displayName: fieldValue("inv_displayName"),
    password: document.getElementById("inv_password").value
  };
  const errors = {};
  if (payload.code.replace(/[^A-Za-z0-9]/g, "").length < 16) errors.inv_code = "Davet kodunu eksiksiz girin.";
  if (!EMAIL_RE.test(payload.email)) errors.inv_email = "Geçerli bir e-posta adresi girin.";
  if (!payload.password) errors.inv_password = "Şifre girin.";
  if (applyFieldErrors(errors)) return;

  await withButtonLoading(document.getElementById("btnInvite"), "Doğrulanıyor…", async () => {
    try {
      await rpc("check_invite", { p_code: payload.code, p_email: payload.email });
    } catch (err) {
      return showAlert("authAlert", err.message);
    }

    // 1) Hesabı olan kullanıcı: giriş yapıp daveti kabul eder.
    const signIn = await sb.auth.signInWithPassword({ email: payload.email, password: payload.password });
    if (!signIn.error) {
      try {
        storageSet(ACTIVE_TENANT_KEY, await rpc("accept_invite", { p_code: payload.code }));
      } catch (err) {
        return showAlert("authAlert", err.message);
      }
      return finishSignIn();
    }
    if (isUnconfirmedEmail(signIn.error)) {
      showAlert("authAlert", authErrorMessage(signIn.error));
      return showResendConfirmation(payload.email);
    }
    const invalidCredentials = signIn.error.code === "invalid_credentials" || /Invalid login credentials/i.test(signIn.error.message);
    if (!invalidCredentials) return showAlert("authAlert", authErrorMessage(signIn.error));

    // 2) Yeni kullanıcı: hesap açılırken davet veritabanında kabul edilir.
    if (!document.getElementById("inv_terms").checked) {
      return applyFieldErrors({ inv_terms: "Yeni hesap için Kullanım Koşulları'nı kabul edin." });
    }
    if (payload.displayName.length < 2) {
      setFieldError(document.getElementById("inv_displayName"), "Yeni hesap oluşturuyorsanız adınızı ve soyadınızı girin.");
      return showAlert("authAlert", "Bu e-postayla giriş yapılamadı. Hesabınız varsa şifrenizi kontrol edin; yoksa adınızı soyadınızı girerek yeni hesap oluşturun.");
    }
    const pwProblem = passwordProblem(payload.password);
    if (pwProblem) return applyFieldErrors({ inv_password: pwProblem });

    const { data, error } = await sb.auth.signUp({
      email: payload.email,
      password: payload.password,
      options: { data: { display_name: payload.displayName, invite_code: payload.code, ...termsAcceptance() }, emailRedirectTo: appUrl() }
    });
    if (error) return showAlert("authAlert", authErrorMessage(error));
    if (isExistingAccountSignup(data)) return showAlert("authAlert", "Bu e-posta ile kayıtlı bir hesabınız var; lütfen mevcut şifrenizi girin.");
    if (data.session) return finishSignIn();
    showCheckEmail(form, payload.email,
      `Hesabınız oluşturuldu ve davet kabul edildi. ${payload.email} adresine gönderilen doğrulama bağlantısına tıklayarak giriş yapın.`);
  });
}

async function handleForgotSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearFieldErrors(form);
  hideAlert("authAlert");
  const email = fieldValue("fp_email").toLowerCase();
  if (applyFieldErrors(EMAIL_RE.test(email) ? {} : { fp_email: "Geçerli bir e-posta adresi girin." })) return;
  await withButtonLoading(document.getElementById("btnForgot"), "Gönderiliyor…", async () => {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
    if (error) return showAlert("authAlert", authErrorMessage(error));
    // Hesabın var olup olmadığı bilinçli olarak belirtilmez.
    showAlert("authAlert", `${email} adresine kayıtlı bir hesap varsa şifre sıfırlama bağlantısı gönderildi. Gelen kutunuzu kontrol edin.`, "success");
  });
}

async function handleNewPasswordSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearFieldErrors(form);
  hideAlert("authAlert");
  const password = document.getElementById("np_password").value;
  const problem = passwordProblem(password);
  const errors = {};
  if (problem) errors.np_password = problem;
  else if (password !== document.getElementById("np_password2").value) errors.np_password2 = "Şifreler eşleşmiyor.";
  if (applyFieldErrors(errors)) return;
  await withButtonLoading(document.getElementById("btnNewPassword"), "Kaydediliyor…", async () => {
    const { error } = await sb.auth.updateUser({ password });
    if (error) return showAlert("authAlert", authErrorMessage(error));
    showToast("Şifreniz güncellendi.", "success");
    await finishSignIn();
  });
}

// ==========================================================================
// İŞLETME PROFİLİ ALANLARI (kurulum sihirbazı ve ayarlar ortak kullanır)
// ==========================================================================
const BUSINESS_FIELD_GROUPS = {
  identity: {
    title: "İşletme Bilgileri",
    fields: [
      { key: "name", label: "İşletme / dükkan adı", required: true, type: "text", maxlength: 80, placeholder: "Örn: Yıldız Oto Servis", autocomplete: "organization" },
      { key: "phone", label: "Telefon", required: true, type: "tel", maxlength: 25, placeholder: "Örn: 0212 555 44 33", autocomplete: "tel" },
      { key: "address", label: "Adres", required: true, type: "textarea", maxlength: 300, placeholder: "Mahalle, cadde/sokak, no, ilçe / il" },
      { key: "logoDataUrl", label: "Logo", type: "logo", hint: "İsteğe bağlı. PNG, JPEG veya WEBP; otomatik küçültülür." }
    ]
  },
  regional: {
    title: "Para Birimi ve Biçimler",
    fields: [
      { key: "currency", label: "Para birimi", required: true, type: "select", options: CURRENCY_OPTIONS },
      { key: "locale", label: "Sayı biçimi", required: true, type: "select", options: LOCALE_OPTIONS },
      { key: "dateFormat", label: "Tarih biçimi", required: true, type: "select", options: DATE_FORMAT_OPTIONS }
    ]
  },
  tax: {
    title: "Vergi Bilgileri (isteğe bağlı)",
    fields: [
      { key: "legalName", label: "Ticari unvan", type: "text", maxlength: 150, hint: "Belgelerde kullanılacak resmi unvan." },
      { key: "taxOffice", label: "Vergi dairesi", type: "text", maxlength: 80 },
      { key: "taxNumber", label: "Vergi no / TC kimlik no", type: "text", maxlength: 11, inputmode: "numeric", hint: "10 haneli vergi numarası veya 11 haneli TC kimlik numarası." }
    ]
  }
};

const logoValues = {};

function fieldId(prefix, key) {
  return `${prefix}_${key}`;
}

function renderBusinessFields(container, prefix, groupKeys, values, { showTitles = false } = {}) {
  logoValues[prefix] = values.logoDataUrl || "";
  container.innerHTML = groupKeys.map((groupKey) => {
    const group = BUSINESS_FIELD_GROUPS[groupKey];
    const fields = group.fields.map((f) => {
      const id = fieldId(prefix, f.key);
      const label = html`<label class="form-label" for="${id}">${f.label}${f.required ? " *" : ""}</label>`;
      const hint = f.hint ? html`<p class="field-hint">${f.hint}</p>` : "";
      const value = values[f.key] ?? "";
      if (f.type === "logo") {
        return html`<div class="form-group">
          ${label}
          <div class="logo-field">
            <div class="logo-icon tenant-logo logo-field-preview" id="${id}_preview"></div>
            <div class="logo-field-actions">
              <input type="file" id="${id}" accept="image/png,image/jpeg,image/webp" class="visually-hidden" data-logo-prefix="${prefix}">
              <label for="${id}" class="btn btn-secondary btn-mini">Görsel Seç</label>
              <button type="button" class="btn btn-secondary btn-mini" data-logo-remove="${prefix}">Kaldır</button>
            </div>
          </div>
          ${hint}
        </div>`;
      }
      if (f.type === "select") {
        const options = f.options.map((o) => html`<option value="${o.value}"${o.value === value ? rawHtml(" selected") : ""}>${o.label}</option>`);
        return html`<div class="form-group">${label}<select id="${id}" class="form-control"${f.required ? rawHtml(" required") : ""}>${options}</select>${hint}</div>`;
      }
      if (f.type === "textarea") {
        return html`<div class="form-group">${label}<textarea id="${id}" class="form-control" rows="2" maxlength="${f.maxlength}" placeholder="${f.placeholder || ""}"${f.required ? rawHtml(" required") : ""}>${value}</textarea>${hint}</div>`;
      }
      return html`<div class="form-group">${label}<input type="${f.type}" id="${id}" class="form-control" value="${value}" maxlength="${f.maxlength}"
        placeholder="${f.placeholder || ""}" autocomplete="${f.autocomplete || "off"}"${f.inputmode ? rawHtml(` inputmode="${f.inputmode}"`) : ""}${f.required ? rawHtml(" required") : ""}>${hint}</div>`;
    });
    return html`${showTitles ? html`<h3 class="form-section-title">${group.title}</h3>` : ""}<div class="form-section">${fields}</div>`;
  }).map(String).join("");

  const fileInput = container.querySelector(`input[data-logo-prefix="${prefix}"]`);
  if (fileInput) {
    renderLogoInto(document.getElementById(`${fieldId(prefix, "logoDataUrl")}_preview`), logoValues[prefix], values.name);
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (!file) return;
      const group = fileInput.closest(".form-group");
      clearFieldErrors(group);
      try {
        logoValues[prefix] = await processLogoFile(file);
        renderLogoInto(document.getElementById(`${fieldId(prefix, "logoDataUrl")}_preview`), logoValues[prefix], fieldValue(fieldId(prefix, "name")));
        container.dispatchEvent(new Event("input", { bubbles: true }));
      } catch (err) {
        setFieldError(fileInput, err.message);
      }
    });
    container.querySelector(`[data-logo-remove="${prefix}"]`).addEventListener("click", () => {
      logoValues[prefix] = "";
      renderLogoInto(document.getElementById(`${fieldId(prefix, "logoDataUrl")}_preview`), "", fieldValue(fieldId(prefix, "name")));
      container.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
}

function readBusinessFields(prefix) {
  const out = {};
  Object.values(BUSINESS_FIELD_GROUPS).forEach((group) => group.fields.forEach((f) => {
    if (f.type === "logo") {
      out.logoDataUrl = logoValues[prefix] || "";
    } else {
      const el = document.getElementById(fieldId(prefix, f.key));
      if (el) out[f.key] = el.value.trim();
    }
  }));
  return out;
}

function validateBusinessFields(prefix, groupKeys) {
  const v = readBusinessFields(prefix);
  const errors = {};
  const id = (k) => fieldId(prefix, k);
  if (groupKeys.includes("identity")) {
    if (v.name.length < 2) errors[id("name")] = "İşletme adı en az 2 karakter olmalıdır.";
    if (!v.phone) errors[id("phone")] = "Telefon numarası zorunludur.";
    else if (!PHONE_RE.test(v.phone)) errors[id("phone")] = "Geçerli bir telefon numarası girin.";
    if (v.address.length < 5) errors[id("address")] = "Adres en az 5 karakter olmalıdır.";
  }
  if (groupKeys.includes("tax")) {
    if (v.taxNumber && !/^\d{10,11}$/.test(v.taxNumber)) errors[id("taxNumber")] = "10 veya 11 haneli, yalnızca rakamlardan oluşan bir numara girin.";
  }
  return errors;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Görsel okunamadı. Farklı bir dosya deneyin.")); };
    img.src = url;
  });
}

// Logo, E-Tablo hücre sınırına (50.000 karakter) sığması için tarayıcıda küçültülür.
async function processLogoFile(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Lütfen PNG, JPEG veya WEBP biçiminde bir görsel seçin.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Görsel en fazla 5 MB olabilir.");
  const img = await loadImageFromFile(file);
  for (const size of [160, 128, 96, 64]) {
    const scale = Math.min(1, size / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    for (const [type, quality] of [["image/webp", 0.9], ["image/png"], ["image/jpeg", 0.85]]) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (type === "image/jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL(type, quality);
      if (dataUrl.startsWith(`data:${type};base64,`) && dataUrl.length <= 44000) return dataUrl;
    }
  }
  throw new Error("Görsel çok büyük. Daha sade bir logo deneyin.");
}

// ==========================================================================
// İLK KURULUM SİHİRBAZI
// ==========================================================================
const setupState = { step: 1 };
const SETUP_STEP_GROUPS = { 1: "identity", 2: "regional", 3: "tax" };
// Son adım: işletmenin e-posta hesabı (isteğe bağlı, mail.js).
const SETUP_MAIL_STEP = 4;

function showSetupWizard() {
  const t = platform.tenant;
  const values = { ...t };
  Object.entries(SETUP_STEP_GROUPS).forEach(([step, group]) => {
    renderBusinessFields(document.querySelector(`[data-setup-step="${step}"]`), "setup", [group], values);
  });
  // renderBusinessFields her çağrıda logo değerini sıfırladığı için mevcut logoyu tekrar ata
  logoValues.setup = t.logoDataUrl || "";
  renderLogoInto(document.getElementById("setup_logoDataUrl_preview"), logoValues.setup, t.name);
  renderMailFields(document.querySelector(`[data-setup-step="${SETUP_MAIL_STEP}"]`), "setup", null, { optional: true });

  document.getElementById("setupUserText").textContent = `${platform.user.displayName} · ${ROLE_LABELS[platform.role]}`;
  const form = document.getElementById("setupForm");
  form.oninput = updateSetupPreview;
  form.onchange = updateSetupPreview;
  hideAlert("setupAlert");
  setupState.step = 1;
  goToSetupStep(1, { skipValidation: true });
  updateSetupPreview();
  showScreen("setup");
  document.getElementById("setup_name").focus();
}

function goToSetupStep(step, { skipValidation = false } = {}) {
  const form = document.getElementById("setupForm");
  if (step > setupState.step && !skipValidation) {
    clearFieldErrors(form);
    if (applyFieldErrors(validateBusinessFields("setup", [SETUP_STEP_GROUPS[setupState.step]]))) return;
  }
  setupState.step = Math.min(SETUP_MAIL_STEP, Math.max(1, step));
  document.querySelectorAll("[data-setup-step]").forEach((el) => {
    el.classList.toggle("hidden", Number(el.dataset.setupStep) !== setupState.step);
  });
  document.querySelectorAll("[data-setup-indicator]").forEach((el) => {
    const n = Number(el.dataset.setupIndicator);
    el.classList.toggle("active", n === setupState.step);
    el.classList.toggle("completed", n < setupState.step);
  });
  document.getElementById("setupBackBtn").classList.toggle("invisible", setupState.step === 1);
  document.getElementById("setupNextBtn").classList.toggle("hidden", setupState.step === SETUP_MAIL_STEP);
  document.getElementById("setupFinishBtn").classList.toggle("hidden", setupState.step !== SETUP_MAIL_STEP);
}

function updateSetupPreview() {
  const v = readBusinessFields("setup");
  document.getElementById("previewName").textContent = v.name || "İşletme adı";
  document.getElementById("previewContact").textContent = v.phone || "";
  renderLogoInto(document.getElementById("previewLogo"), logoValues.setup, v.name);
  document.getElementById("previewMoney").textContent = formatMoneyWith(12345.5, v.currency || "TRY", v.locale || "tr-TR");
  document.getElementById("previewDate").textContent = formatDateWith(todayIso(), v.dateFormat || "DD.MM.YYYY");
}

async function handleSetupSubmit(event) {
  event.preventDefault();
  if (setupState.step < SETUP_MAIL_STEP) {
    goToSetupStep(setupState.step + 1);
    return;
  }
  const form = event.currentTarget;
  clearFieldErrors(form);
  hideAlert("setupAlert");
  const errors = validateBusinessFields("setup", ["identity", "regional", "tax"]);
  if (Object.keys(errors).length) {
    const firstId = Object.keys(errors)[0];
    const step = Object.entries(SETUP_STEP_GROUPS).find(([, g]) => BUSINESS_FIELD_GROUPS[g].fields.some((f) => fieldId("setup", f.key) === firstId));
    if (step) goToSetupStep(Number(step[0]), { skipValidation: true });
    applyFieldErrors(errors);
    return;
  }
  const mail = readMailFields("setup");
  if (applyFieldErrors(validateMailFields("setup", mail, { optional: true }))) return;
  await withButtonLoading(document.getElementById("setupFinishBtn"), "Kaydediliyor…", async () => {
    try {
      applySession(await apiCall("saveBusinessProfile", readBusinessFields("setup")));
    } catch (err) {
      if (!err.handled) showAlert("setupAlert", err.message);
      return;
    }
    enterApp();
    showToast(`Kurulum tamamlandı. ${platform.tenant.name} için hazırsınız!`, "success");
    // E-posta hesabı isteğe bağlıdır; kaydedilemezse kurulum yine tamamlanmış olur.
    if (mail.user) {
      try {
        setMailStatus(await apiCall("saveMailSettings", mail));
        renderAll();
        showToast("E-posta hesabınız kaydedildi. Ayarlar > E-posta bölümünden test e-postası gönderebilirsiniz.", "info");
      } catch (err) {
        if (!err.handled) showToast(`E-posta hesabı kaydedilemedi: ${err.message} Ayarlar > E-posta bölümünden tekrar deneyin.`, "warning");
      }
    }
  });
}

// ==========================================================================
// İŞLETME AYARLARI SAYFASI
// ==========================================================================
const settingsState = { tab: null };

function renderSettings() {
  showSettingsTab(settingsState.tab || (isManager() ? "profile" : "account"));
}

function showSettingsTab(tab) {
  if (!isManager()) tab = "account";
  settingsState.tab = tab;
  document.querySelectorAll("[data-settings-tab]").forEach((el) => {
    const active = el.dataset.settingsTab === tab;
    el.classList.toggle("active", active);
    el.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-settings-panel]").forEach((el) => el.classList.toggle("hidden", el.dataset.settingsPanel !== tab));
  if (tab === "profile") renderProfileForm();
  else if (tab === "team") loadTeam();
  else if (tab === "plan") renderPlan();
  else if (tab === "mail") renderMailSettings();
  else renderAccount();
}

function renderProfileForm() {
  hideAlert("profileAlert");
  renderBusinessFields(document.getElementById("profileFields"), "profile", ["identity", "regional", "tax"], platform.tenant, { showTitles: true });
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  if (platform.offline) return showToast("Çevrimdışıyken ayarlar değiştirilemez.", "warning");
  const form = event.currentTarget;
  clearFieldErrors(form);
  hideAlert("profileAlert");
  if (applyFieldErrors(validateBusinessFields("profile", ["identity", "regional", "tax"]))) return;
  await withButtonLoading(document.getElementById("btnSaveProfile"), "Kaydediliyor…", async () => {
    try {
      applySession(await apiCall("saveBusinessProfile", readBusinessFields("profile")));
      applyTenantBranding();
      renderAll();
      renderProfileForm();
      showToast("İşletme bilgileri güncellendi.", "success");
    } catch (err) {
      if (!err.handled) showAlert("profileAlert", err.message);
    }
  });
}

async function loadTeam() {
  const members = document.getElementById("membersList");
  const invites = document.getElementById("invitesList");
  members.innerHTML = `<div class="list-placeholder">Ekip bilgileri yükleniyor…</div>`;
  invites.innerHTML = "";
  if (platform.offline) {
    members.innerHTML = `<div class="list-placeholder">Çevrimdışıyken ekip bilgileri görüntülenemez.</div>`;
    return;
  }
  try {
    renderTeam(await apiCall("listMembers"));
  } catch (err) {
    if (err.handled) return;
    members.innerHTML = "";
    const box = document.createElement("div");
    box.className = "list-placeholder";
    box.textContent = `Ekip bilgileri alınamadı: ${err.message}`;
    members.appendChild(box);
  }
}

function renderTeam(team) {
  document.getElementById("seatBadge").textContent = `${team.seats.used} / ${team.seats.max} kullanıcı`;
  const members = document.getElementById("membersList");
  members.innerHTML = team.members.map((m) => {
    const canManage = !m.isCurrentUser && m.role !== "owner" && (isOwner() || m.role === "staff");
    const roleControl = isOwner() && m.role !== "owner" && !m.isCurrentUser
      ? html`<select class="form-control form-control-sm" data-role-select="${m.membershipId}" aria-label="Rol">
          <option value="staff"${m.role === "staff" ? rawHtml(" selected") : ""}>Çalışan</option>
          <option value="admin"${m.role === "admin" ? rawHtml(" selected") : ""}>Yönetici</option>
        </select>`
      : html`<span class="role-badge role-badge-${m.role}">${ROLE_LABELS[m.role] || m.role}</span>`;
    return html`<div class="member-row">
      <div class="user-avatar">${initials(m.displayName || m.email)}</div>
      <div class="member-info">
        <strong>${m.displayName || m.email}${m.isCurrentUser ? " (siz)" : ""}</strong>
        <small>${m.email}</small>
      </div>
      <div class="member-actions">
        ${roleControl}
        ${canManage ? html`<button type="button" class="btn btn-danger btn-mini" data-remove-member="${m.membershipId}" data-member-name="${m.displayName || m.email}">Çıkar</button>` : ""}
      </div>
    </div>`;
  }).map(String).join("") || `<div class="list-placeholder">Henüz ekip üyesi yok.</div>`;

  members.querySelectorAll("[data-role-select]").forEach((select) => {
    select.addEventListener("change", async () => {
      select.disabled = true;
      try {
        await apiCall("updateMemberRole", { membershipId: select.dataset.roleSelect, role: select.value });
        showToast("Kullanıcı rolü güncellendi.", "success");
      } catch (err) {
        reportError(err);
      }
      loadTeam();
    });
  });
  members.querySelectorAll("[data-remove-member]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(`${btn.dataset.memberName} işletmeden çıkarılsın mı? Kullanıcının oturumu hemen kapatılır.`)) return;
      btn.disabled = true;
      try {
        await apiCall("removeMember", { membershipId: btn.dataset.removeMember });
        showToast("Kullanıcı işletmeden çıkarıldı.", "info");
      } catch (err) {
        reportError(err);
      }
      loadTeam();
    });
  });

  const invites = document.getElementById("invitesList");
  invites.innerHTML = team.invitations.map((inv) => html`<div class="member-row">
    <div class="user-avatar user-avatar-muted">@</div>
    <div class="member-info">
      <strong>${inv.email}</strong>
      <small>${ROLE_LABELS[inv.role] || inv.role} · Son geçerlilik: ${formatDisplayDate(inv.expiresAt)}</small>
    </div>
    <div class="member-actions">
      <button type="button" class="btn btn-secondary btn-mini" data-revoke-invite="${inv.id}">İptal Et</button>
    </div>
  </div>`).map(String).join("") || `<div class="list-placeholder">Bekleyen davet yok.</div>`;

  invites.querySelectorAll("[data-revoke-invite]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await apiCall("revokeInvite", { id: btn.dataset.revokeInvite });
        showToast("Davet iptal edildi.", "info");
      } catch (err) {
        reportError(err);
      }
      loadTeam();
    });
  });
}

async function handleCreateInvite(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearFieldErrors(form);
  const email = fieldValue("newInviteEmail");
  const role = document.getElementById("newInviteRole").value;
  if (applyFieldErrors(EMAIL_RE.test(email) ? {} : { newInviteEmail: "Geçerli bir e-posta adresi girin." })) return;
  await withButtonLoading(document.getElementById("btnCreateInvite"), "Oluşturuluyor…", async () => {
    try {
      const result = await apiCall("createInvite", { email, role });
      form.reset();
      showInviteResult(result);
      loadTeam();
    } catch (err) {
      reportError(err);
    }
  });
}

function showInviteResult({ invitation, code }) {
  const box = document.getElementById("inviteResult");
  const link = `${window.location.origin}${window.location.pathname}#davet=${code}`;
  box.innerHTML = html`<div class="invite-result-title">Davet oluşturuldu: ${invitation.email}</div>
    <p class="card-desc">Bu kod güvenlik nedeniyle yalnızca şimdi gösterilir. Çalışanınıza iletin; kod ${formatDisplayDate(invitation.expiresAt)} tarihine kadar geçerlidir.</p>
    <div class="copy-row"><code class="invite-code">${code}</code><button type="button" class="btn btn-secondary btn-mini" data-copy="${code}">Kodu Kopyala</button></div>
    <div class="copy-row"><code class="invite-link">${link}</code><button type="button" class="btn btn-secondary btn-mini" data-copy="${link}">Bağlantıyı Kopyala</button></div>`.toString();
  box.classList.remove("hidden");
  box.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        showToast("Panoya kopyalandı.", "success");
      } catch {
        showToast("Kopyalanamadı; metni seçip elle kopyalayın.", "warning");
      }
    });
  });
}

function renderPlan() {
  const p = platform.plan || {};
  const container = document.getElementById("planDetails");
  const rows = [
    ["Plan", p.name || "-"],
    ["Durum", SUBSCRIPTION_LABELS[p.subscriptionStatus] || p.subscriptionStatus || "-"],
    ["Kullanıcı sınırı", p.maxUsers ? `${p.maxUsers} kullanıcı` : "-"]
  ];
  if (p.subscriptionStatus === "trialing" && p.trialEndsAt) rows.push(["Deneme bitişi", formatDisplayDate(p.trialEndsAt)]);
  if (p.currentPeriodEnd) rows.push(["Dönem sonu", formatDisplayDate(p.currentPeriodEnd)]);
  const contact = APP_CONFIG.supportContact ? ` İletişim: ${APP_CONFIG.supportContact}` : "";
  container.innerHTML = html`<h2 class="card-title">Abonelik</h2>
    <dl class="detail-list">${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
    ${p.billingEnabled ? "" : html`<div class="form-alert form-alert-info">Online ödeme altyapısı henüz etkin değil. Plan yükseltme ve fatura işlemleri için hizmet sağlayıcınızla iletişime geçin.${contact}</div>`}`.toString();
}

function renderAccount() {
  const t = platform.tenant;
  document.getElementById("accountInfo").innerHTML = html`<dl class="detail-list">
    <div><dt>Ad soyad</dt><dd>${platform.user.displayName}</dd></div>
    <div><dt>E-posta</dt><dd>${platform.user.email}</dd></div>
    <div><dt>İşletme</dt><dd>${t.name}</dd></div>
    <div><dt>Rol</dt><dd>${ROLE_LABELS[platform.role] || platform.role}</dd></div>
  </dl>`.toString();
  document.getElementById("retentionDaysText").textContent = (platform.plan && platform.plan.dataRetentionDays) || 30;

  const switchBox = document.getElementById("tenantSwitch");
  const others = (platform.tenants || []).filter((x) => x.id !== t.id);
  switchBox.classList.toggle("hidden", others.length === 0);
  if (!others.length) return;
  switchBox.innerHTML = html`<div class="tenant-switch">
    <label class="form-label" for="tenantSwitchSelect">Başka bir işletmeye geç</label>
    <div class="copy-row">
      <select id="tenantSwitchSelect" class="form-control">${others.map((o) => html`<option value="${o.id}">${o.name} — ${ROLE_LABELS[o.role] || ""}</option>`)}</select>
      <button type="button" class="btn btn-secondary" id="btnSwitchTenant">Geç</button>
    </div>
  </div>`.toString();
  document.getElementById("btnSwitchTenant").addEventListener("click", async (e) => {
    await withButtonLoading(e.currentTarget, "Geçiliyor…", async () => {
      // Erişim her istekte veritabanında denetlendiği için yalnızca aktif işletme değiştirilir.
      storageSet(ACTIVE_TENANT_KEY, document.getElementById("tenantSwitchSelect").value);
      clearTenantCaches();
      window.location.reload();
    });
  });
}

async function handlePasswordChange(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearFieldErrors(form);
  hideAlert("passwordAlert");
  const currentPassword = document.getElementById("pw_current").value;
  const newPassword = document.getElementById("pw_new").value;
  const errors = {};
  if (!currentPassword) errors.pw_current = "Mevcut şifrenizi girin.";
  const problem = passwordProblem(newPassword);
  if (problem) errors.pw_new = problem;
  else if (newPassword !== document.getElementById("pw_new2").value) errors.pw_new2 = "Şifreler eşleşmiyor.";
  if (applyFieldErrors(errors)) return;
  await withButtonLoading(document.getElementById("btnChangePassword"), "Güncelleniyor…", async () => {
    try {
      await apiCall("changePassword", { currentPassword, newPassword });
      form.reset();
      showToast("Şifreniz güncellendi. Diğer cihazlardaki oturumlar kapatıldı.", "success");
    } catch (err) {
      if (!err.handled) showAlert("passwordAlert", err.message);
    }
  });
}

async function handleExportData() {
  await withButtonLoading(document.getElementById("btnExportData"), "Hazırlanıyor…", async () => {
    try {
      const data = await apiCall("exportTenantData");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const slug = normalizeSearchText(platform.tenant.name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "isletme";
      a.href = url;
      a.download = `${slug}-yedek-${todayIso()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("Veri dosyası indirildi.", "success");
    } catch (err) {
      reportError(err);
    }
  });
}

async function handleCloseAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearFieldErrors(form);
  hideAlert("closeAlert");
  const confirmName = fieldValue("close_name");
  const password = document.getElementById("close_password").value;
  const errors = {};
  if (confirmName !== platform.tenant.name.trim()) errors.close_name = "İşletme adını birebir aynı yazın.";
  if (!password) errors.close_password = "Şifrenizi girin.";
  if (applyFieldErrors(errors)) return;
  if (!confirm(`${platform.tenant.name} işletme hesabı kapatılacak ve tüm kullanıcıların erişimi sonlanacak. Devam edilsin mi?`)) return;

  await withButtonLoading(document.getElementById("btnCloseAccount"), "Kapatılıyor…", async () => {
    try {
      const result = await apiCall("closeTenant", { confirmName, password });
      try { await sb.auth.signOut({ scope: "local" }); } catch { /* yok say */ }
      storageRemove(ACTIVE_TENANT_KEY);
      clearTenantCaches();
      showNotice({
        title: "İşletme hesabı kapatıldı",
        message: `Verileriniz ${formatDisplayDate(result.deleteAfter)} tarihine kadar saklanacak, ardından kalıcı olarak silinecek. Bu süre içinde hesabı yeniden açtırmak için hizmet sağlayıcınızla iletişime geçebilirsiniz.`,
        actions: [{ label: "Giriş ekranına dön", onClick: () => window.location.reload() }]
      });
    } catch (err) {
      if (!err.handled) showAlert("closeAlert", err.message);
    }
  });
}
