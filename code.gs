/**
 * OtoTakip - Çok İşletmeli (Multi-Tenant) Servis Takip API'si
 * Google Apps Script arka ucu (code.gs)
 *
 * Bu dosya bir Google E-Tablo'ya bağlı Apps Script projesine yapıştırılır ve
 * "Web uygulaması" olarak dağıtılır. Kurulum, Script Properties ayarları ve
 * eski (tek işletmeli) verilerin taşınması için README.md dosyasına bakın.
 *
 * GÜVENLİK MODELİ (ÖZET)
 * - doGet hiçbir işletme verisi döndürmez.
 * - Veri işlemleri yalnızca oturum anahtarı (token) içeren POST istekleriyle yapılır.
 * - İşletme (tenant) kimliği her istekte sunucudaki oturum kaydından belirlenir;
 *   istemcinin gönderdiği tenantId veya benzeri alanlar yok sayılır.
 * - Her okuma/güncelleme/silme, satırın tenantId sütunu oturumdaki işletmeyle
 *   eşleştirilerek yapılır. Başka işletmenin kaydı "bulunamadı" olarak yanıtlanır.
 * - Şifreler PBKDF2-HMAC-SHA256 ile, oturum/davet anahtarları SHA-256 özetiyle saklanır.
 * - Hücreye yazılan metinler formül olarak yorumlanmasın diye kaçışlanır.
 */

// ---------------------------------------------------------------------------
// SABİTLER VE ŞEMA
// ---------------------------------------------------------------------------
var SCHEMA_VERSION = '2';
var SESSION_TTL_HOURS = 24 * 7;
var INVITE_TTL_DAYS = 7;
var OWNER_CLAIM_TTL_DAYS = 14;
var TRIAL_DAYS = 30;
var PASSWORD_MIN_LENGTH = 8;
var PASSWORD_ITERATIONS = 4000;
var MAX_FAILED_LOGINS = 5;
var LOGIN_LOCK_MINUTES = 15;
var DEFAULT_RETENTION_DAYS = 30;
var DEFAULT_SIGNUP_HOURLY_LIMIT = 20;
var MAX_LOGO_LENGTH = 45000;

var MANAGER_ROLES = ['owner', 'admin'];

// Plan kataloğu. Ödeme sağlayıcısı entegrasyonu yokken planlar operatör
// tarafından setTenantPlan() ile atanır (bkz. README > Abonelik).
var PLANS = {
  trial: { name: 'Deneme', maxUsers: 3 },
  basic: { name: 'Temel', maxUsers: 3 },
  pro: { name: 'Profesyonel', maxUsers: 15 },
  legacy: { name: 'Kurucu İşletme', maxUsers: 15 }
};
var SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'canceled'];

var CURRENCIES = ['TRY', 'EUR', 'USD', 'GBP'];
var LOCALES = ['tr-TR', 'en-US', 'en-GB', 'de-DE'];
var DATE_FORMATS = ['DD.MM.YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY'];
var PAYMENT_STATUSES = ['Ödenmedi', 'Kısmi Ödendi', 'Nakit Ödendi', 'Havale Yapıldı', 'Kartla Ödendi', 'Ödendi'];

var TECHNICIAN_KEYS = [
  'mechanic', 'electrician', 'boyaci', 'cikmaci', 'egzozcu', 'frenci', 'kapakci', 'kaportaci',
  'kurtarici', 'parcaci', 'pompaci', 'tornaci', 'turbocu', 'tupcu', 'yagci', 'yikamaci'
];
var FEE_KEYS = TECHNICIAN_KEYS.map(function (k) { return k + 'Fee'; });
var NOTE_KEYS = TECHNICIAN_KEYS.map(function (k) { return k + 'Note'; });

var SERVICE_HEADERS = ['id', 'vehicleId', 'entryKm', 'recordDate']
  .concat(TECHNICIAN_KEYS.reduce(function (acc, k) { return acc.concat([k + 'Fee', k + 'Note']); }, []))
  .concat(['generalSummary', 'paymentStatus', 'totalAmount', 'paidAmount', 'remainingAmount', 'createdAt', 'tenantId', 'updatedAt']);

// Eski sayfaların sütun sırası korunur; yeni sütunlar (tenantId, updatedAt) sona eklenir.
var SHEETS = {
  Tenants: ['id', 'name', 'phone', 'address', 'logoDataUrl', 'currency', 'locale', 'dateFormat',
    'legalName', 'taxOffice', 'taxNumber', 'setupCompleted', 'status', 'planId', 'subscriptionStatus',
    'trialEndsAt', 'billingProvider', 'billingCustomerId', 'billingSubscriptionId', 'currentPeriodEnd',
    'createdAt', 'updatedAt', 'closedAt', 'deleteAfter'],
  Users: ['id', 'email', 'displayName', 'passwordHash', 'passwordSalt', 'passwordIterations', 'status',
    'failedLogins', 'lockedUntil', 'createdAt', 'lastLoginAt'],
  Memberships: ['id', 'tenantId', 'userId', 'role', 'status', 'createdAt', 'updatedAt'],
  Sessions: ['id', 'tokenHash', 'userId', 'tenantId', 'createdAt', 'expiresAt', 'revokedAt'],
  Invitations: ['id', 'tenantId', 'email', 'role', 'codeHash', 'invitedBy', 'createdAt', 'expiresAt',
    'acceptedAt', 'revokedAt'],
  AuditLog: ['id', 'tenantId', 'userId', 'action', 'entity', 'entityId', 'createdAt'],
  Customers: ['id', 'firstName', 'lastName', 'phone', 'reference', 'notes', 'createdAt', 'tenantId', 'updatedAt'],
  Vehicles: ['id', 'customerId', 'brand', 'model', 'plate', 'chassisNo', 'entryDate', 'notes', 'createdAt',
    'tenantId', 'updatedAt'],
  ServiceRecords: SERVICE_HEADERS
};

var TENANT_DATA_SHEETS = ['Customers', 'Vehicles', 'ServiceRecords'];
var TEXT_COLUMNS = {
  Customers: ['phone'],
  Tenants: ['phone', 'taxNumber'],
  Vehicles: ['plate', 'chassisNo']
};
var DATE_ONLY_FIELDS = ['entryDate', 'recordDate'];

// ---------------------------------------------------------------------------
// HTTP GİRİŞ NOKTALARI
// ---------------------------------------------------------------------------
function doGet() {
  return json_({
    success: true,
    service: 'OtoTakip API',
    schemaVersion: SCHEMA_VERSION,
    message: 'Bu adres yalnızca uygulama tarafından, oturum açılmış POST istekleriyle kullanılır.'
  });
}

// public: oturum gerektirmez | roles: izinli roller | setup: işletme kurulumu tamamlanmış olmalı
// lock: işlem betik kilidi altında çalışır (satır kaymalarına karşı)
var ROUTES = {
  register: { public: true, fn: register_ },
  login: { public: true, fn: login_ },
  acceptInvite: { public: true, fn: acceptInvite_ },

  bootstrap: { fn: bootstrap_ },
  logout: { fn: logout_, lock: true },
  switchTenant: { fn: switchTenant_, lock: true },
  changePassword: { fn: changePassword_ },

  saveBusinessProfile: { fn: saveBusinessProfile_, roles: MANAGER_ROLES, lock: true },
  listMembers: { fn: listMembers_, roles: MANAGER_ROLES, setup: true },
  createInvite: { fn: createInvite_, roles: MANAGER_ROLES, setup: true, lock: true },
  revokeInvite: { fn: revokeInvite_, roles: MANAGER_ROLES, setup: true, lock: true },
  updateMemberRole: { fn: updateMemberRole_, roles: ['owner'], setup: true, lock: true },
  removeMember: { fn: removeMember_, roles: MANAGER_ROLES, setup: true, lock: true },
  exportTenantData: { fn: exportTenantData_, roles: ['owner'], setup: true },
  closeTenant: { fn: closeTenant_, roles: ['owner'] },

  getData: { fn: getData_, setup: true },
  addCustomer: { fn: addCustomer_, setup: true, lock: true },
  updateCustomer: { fn: updateCustomer_, setup: true, lock: true },
  deleteCustomer: { fn: deleteCustomer_, roles: MANAGER_ROLES, setup: true, lock: true },
  addVehicle: { fn: addVehicle_, setup: true, lock: true },
  updateVehicle: { fn: updateVehicle_, setup: true, lock: true },
  deleteVehicle: { fn: deleteVehicle_, roles: MANAGER_ROLES, setup: true, lock: true },
  addServiceRecord: { fn: addServiceRecord_, setup: true, lock: true },
  updateServiceRecord: { fn: updateServiceRecord_, setup: true, lock: true },
  deleteServiceRecord: { fn: deleteServiceRecord_, roles: MANAGER_ROLES, setup: true, lock: true }
};

function doPost(e) {
  var action = '';
  try {
    var body = parseRequestBody_(e);
    action = typeof body.action === 'string' ? body.action : '';
    var route = Object.prototype.hasOwnProperty.call(ROUTES, action) ? ROUTES[action] : null;
    if (!route) throw apiError_('BAD_REQUEST', 'Geçersiz işlem isteği.');

    ensureSchema_();

    var payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {};
    var ctx = null;
    if (!route.public) {
      ctx = authenticate_(body.token);
      if (route.roles && route.roles.indexOf(ctx.role) === -1) {
        throw apiError_('FORBIDDEN', 'Bu işlem için yetkiniz bulunmuyor.');
      }
      if (route.setup && !isTrue_(ctx.tenant.setupCompleted)) {
        throw apiError_('SETUP_REQUIRED', 'İşletme kurulumu tamamlanmadan bu işlem yapılamaz.');
      }
    }

    var result = route.lock
      ? withLock_(function () { return route.fn(ctx, payload); })
      : route.fn(ctx, payload);
    return json_({ success: true, data: result === undefined ? null : result });
  } catch (err) {
    return json_(toErrorResponse_(err, action));
  }
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function parseRequestBody_(e) {
  if (!e || !e.postData || typeof e.postData.contents !== 'string') {
    throw apiError_('BAD_REQUEST', 'İstek gövdesi bulunamadı.');
  }
  if (e.postData.contents.length > 2000000) throw apiError_('BAD_REQUEST', 'İstek çok büyük.');
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (parseErr) {
    throw apiError_('BAD_REQUEST', 'İstek gövdesi okunamadı.');
  }
  if (!body || typeof body !== 'object') throw apiError_('BAD_REQUEST', 'İstek gövdesi geçersiz.');
  return body;
}

function apiError_(code, message) {
  var err = new Error(message);
  err.apiCode = code;
  return err;
}

function toErrorResponse_(err, action) {
  if (err && err.apiCode) return { success: false, code: err.apiCode, error: err.message };
  // Beklenmeyen hata: istek içeriği (müşteri verisi, şifre vb.) asla loglanmaz.
  console.error('[OtoTakip] Beklenmeyen hata. islem=' + (action || '-') + ' hata=' +
    String(err && err.message ? err.message : err).slice(0, 300));
  return { success: false, code: 'INTERNAL', error: 'Sunucuda beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.' };
}

// ---------------------------------------------------------------------------
// KİMLİK DOĞRULAMA VE OTURUM
// ---------------------------------------------------------------------------
function authenticate_(token) {
  var expired = apiError_('AUTH_REQUIRED', 'Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.');
  if (typeof token !== 'string' || token.length < 40 || token.length > 200) {
    throw apiError_('AUTH_REQUIRED', 'Bu işlem için giriş yapmalısınız.');
  }
  var hash = sha256Hex_(token);
  var session = findRow_(table_('Sessions'), function (r) { return String(r.tokenHash) === hash; });
  if (!session || session.revokedAt || toTime_(session.expiresAt) <= Date.now()) throw expired;

  var user = findRow_(table_('Users'), function (r) { return String(r.id) === String(session.userId); });
  if (!user || user.status !== 'active') throw expired;

  var membership = findRow_(table_('Memberships'), function (r) {
    return String(r.userId) === String(user.id) && String(r.tenantId) === String(session.tenantId) && r.status === 'active';
  });
  if (!membership) throw apiError_('AUTH_REQUIRED', 'Bu işletmeye erişiminiz kaldırılmış.');

  var tenant = findRow_(table_('Tenants'), function (r) { return String(r.id) === String(session.tenantId); });
  if (!tenant || tenant.status !== 'active') throw apiError_('AUTH_REQUIRED', 'Bu işletme hesabı aktif değil.');

  return {
    session: session,
    user: user,
    membership: membership,
    tenant: tenant,
    role: String(membership.role),
    tenantId: String(tenant.id),
    userId: String(user.id)
  };
}

function createSession_(userId, tenantId) {
  var token = randomToken_();
  var now = new Date();
  insert_(table_('Sessions'), {
    id: newId_('SES'),
    tokenHash: sha256Hex_(token),
    userId: userId,
    tenantId: tenantId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_HOURS * 3600000).toISOString(),
    revokedAt: ''
  });
  return token;
}

function revokeSessions_(predicate) {
  var sessions = table_('Sessions');
  var nowIso = new Date().toISOString();
  sessions.rows.forEach(function (r) {
    if (!r.revokedAt && r.id && predicate(r)) {
      r.revokedAt = nowIso;
      update_(sessions, r);
    }
  });
}

function sessionPayload_(user, membership, tenant, token) {
  var out = {
    user: { id: String(user.id), email: String(user.email), displayName: String(user.displayName || '') },
    role: String(membership.role),
    tenant: publicTenant_(tenant),
    plan: planInfo_(tenant),
    tenants: userTenants_(String(user.id)),
    data: isTrue_(tenant.setupCompleted) ? tenantData_(String(tenant.id)) : null
  };
  if (token) out.token = token;
  return out;
}

function userTenants_(userId) {
  var tenants = table_('Tenants').rows;
  return table_('Memberships').rows
    .filter(function (m) { return String(m.userId) === userId && m.status === 'active'; })
    .map(function (m) {
      var t = tenants.filter(function (x) { return String(x.id) === String(m.tenantId) && x.status === 'active'; })[0];
      return t ? { id: String(t.id), name: String(t.name || ''), role: String(m.role) } : null;
    })
    .filter(function (x) { return x; });
}

function register_(ctx, p) {
  if (getSetting_('SIGNUP_MODE', 'open') !== 'open') {
    throw apiError_('FORBIDDEN', 'Yeni işletme kaydı şu anda kapalı. Hesap açmak için hizmet sağlayıcınızla iletişime geçin.');
  }
  var businessName = str_(p.businessName, 'İşletme adı', { required: true, min: 2, max: 80 });
  var displayName = str_(p.displayName, 'Ad soyad', { required: true, min: 2, max: 80 });
  var email = email_(p.email);
  var credentials = hashNewPassword_(password_(p.password));

  return withLock_(function () {
    var users = table_('Users');
    if (findUserByEmail_(users, email)) {
      throw apiError_('CONFLICT', 'Bu e-posta adresiyle kayıtlı bir hesap zaten var. Lütfen giriş yapın.');
    }
    enforceSignupRate_();

    var now = new Date();
    var nowIso = now.toISOString();
    var tenant = newTenant_(businessName, 'trial', 'trialing', addDays_(now, TRIAL_DAYS).toISOString());
    insert_(table_('Tenants'), tenant);
    var user = newUser_(email, displayName, credentials);
    insert_(users, user);
    var membership = newMembership_(tenant.id, user.id, 'owner');
    insert_(table_('Memberships'), membership);
    var token = createSession_(user.id, tenant.id);
    audit_({ tenantId: tenant.id, userId: user.id }, 'register', 'tenant', tenant.id);
    return sessionPayload_(user, membership, tenant, token);
  });
}

function login_(ctx, p) {
  var email = normalizeEmail_(p.email);
  var password = typeof p.password === 'string' ? p.password : '';
  if (!email || !password) throw apiError_('VALIDATION', 'E-posta ve şifre zorunludur.');
  var invalid = apiError_('INVALID_CREDENTIALS', 'E-posta veya şifre hatalı.');

  var user = findUserByEmail_(table_('Users'), email);
  if (!user || user.status !== 'active') {
    hashPassword_(password, 'zamanlama-esitleme', PASSWORD_ITERATIONS); // kullanıcı var/yok ayrımını zorlaştırır
    throw invalid;
  }
  if (toTime_(user.lockedUntil) > Date.now()) {
    throw apiError_('RATE_LIMITED', 'Çok fazla hatalı deneme yapıldı. Lütfen ' + LOGIN_LOCK_MINUTES + ' dakika sonra tekrar deneyin.');
  }
  var ok = verifyPassword_(user, password);

  return withLock_(function () {
    var users = table_('Users');
    var fresh = findRow_(users, function (r) { return String(r.id) === String(user.id); });
    if (!ok) {
      var failed = (Number(fresh.failedLogins) || 0) + 1;
      if (failed >= MAX_FAILED_LOGINS) {
        fresh.failedLogins = 0;
        fresh.lockedUntil = new Date(Date.now() + LOGIN_LOCK_MINUTES * 60000).toISOString();
      } else {
        fresh.failedLogins = failed;
      }
      update_(users, fresh);
      throw invalid;
    }

    var tenants = userTenants_(String(fresh.id));
    if (!tenants.length) throw apiError_('FORBIDDEN', 'Bu hesaba bağlı aktif bir işletme bulunamadı.');

    var chosen = null;
    if (p.tenantId) {
      chosen = tenants.filter(function (t) { return t.id === String(p.tenantId); })[0];
      if (!chosen) throw apiError_('FORBIDDEN', 'Seçilen işletmeye erişiminiz bulunmuyor.');
    } else if (tenants.length === 1) {
      chosen = tenants[0];
    } else {
      return { needsTenantChoice: true, tenants: tenants };
    }

    fresh.failedLogins = 0;
    fresh.lockedUntil = '';
    fresh.lastLoginAt = new Date().toISOString();
    update_(users, fresh);

    var membership = findActiveMembership_(chosen.id, String(fresh.id));
    var tenant = findRow_(table_('Tenants'), function (r) { return String(r.id) === chosen.id; });
    var token = createSession_(String(fresh.id), chosen.id);
    audit_({ tenantId: chosen.id, userId: String(fresh.id) }, 'login', 'user', String(fresh.id));
    return sessionPayload_(fresh, membership, tenant, token);
  });
}

function acceptInvite_(ctx, p) {
  var code = normalizeCode_(p.code);
  var email = email_(p.email);
  var password = typeof p.password === 'string' ? p.password : '';
  var invalid = apiError_('INVALID_INVITE', 'Davet kodu geçersiz, kullanılmış veya süresi dolmuş.');
  if (code.length < 16) throw invalid;
  var codeHash = sha256Hex_(code);

  var invitation = findRow_(table_('Invitations'), function (r) { return String(r.codeHash) === codeHash; });
  if (!invitation || !isPendingInvite_(invitation, Date.now())) throw invalid;
  if (invitation.email && String(invitation.email) !== email) {
    throw apiError_('INVALID_INVITE', 'Bu davet farklı bir e-posta adresi için oluşturulmuş.');
  }
  var existingUser = findUserByEmail_(table_('Users'), email);
  var credentials = null;
  var displayName = '';
  if (existingUser) {
    if (existingUser.status !== 'active' || !verifyPassword_(existingUser, password)) {
      throw apiError_('INVALID_CREDENTIALS', 'Bu e-posta ile kayıtlı hesabınızın şifresini doğru girin.');
    }
  } else {
    displayName = str_(p.displayName, 'Ad soyad', { required: true, min: 2, max: 80 });
    credentials = hashNewPassword_(password_(password));
  }

  return withLock_(function () {
    var invitations = table_('Invitations');
    var inv = findRow_(invitations, function (r) { return String(r.codeHash) === codeHash; });
    if (!inv || !isPendingInvite_(inv, Date.now())) throw invalid;
    var tenantId = String(inv.tenantId);
    var tenant = findRow_(table_('Tenants'), function (r) { return String(r.id) === tenantId; });
    if (!tenant || tenant.status !== 'active') throw invalid;

    var users = table_('Users');
    var user = findUserByEmail_(users, email);
    if (!user) {
      user = newUser_(email, displayName, credentials);
      insert_(users, user);
    }

    var memberships = table_('Memberships');
    var membership = findRow_(memberships, function (r) {
      return String(r.tenantId) === tenantId && String(r.userId) === String(user.id);
    });
    if (membership && membership.status === 'active') {
      throw apiError_('CONFLICT', 'Bu işletmenin zaten üyesisiniz. Giriş yapabilirsiniz.');
    }
    if (inv.role !== 'owner') {
      var used = countActiveMembers_(tenantId, memberships);
      if (used >= planInfo_(tenant).maxUsers) {
        throw apiError_('PLAN_LIMIT', 'İşletmenin kullanıcı sınırı dolu. İşletme yöneticinizle iletişime geçin.');
      }
    }
    if (membership) {
      membership.role = inv.role;
      membership.status = 'active';
      membership.updatedAt = new Date().toISOString();
      update_(memberships, membership);
    } else {
      membership = newMembership_(tenantId, String(user.id), String(inv.role));
      insert_(memberships, membership);
    }

    inv.acceptedAt = new Date().toISOString();
    update_(invitations, inv);
    if (inv.role === 'owner') PropertiesService.getScriptProperties().deleteProperty('OWNER_CLAIM_' + tenantId);

    var token = createSession_(String(user.id), tenantId);
    audit_({ tenantId: tenantId, userId: String(user.id) }, 'accept', 'invitation', String(inv.id));
    return sessionPayload_(user, membership, tenant, token);
  });
}

function bootstrap_(ctx) {
  return sessionPayload_(ctx.user, ctx.membership, ctx.tenant);
}

function logout_(ctx) {
  var sessionId = String(ctx.session.id);
  revokeSessions_(function (r) { return String(r.id) === sessionId; });
  return { loggedOut: true };
}

function switchTenant_(ctx, p) {
  var tenantId = id_(p.tenantId, 'İşletme');
  var membership = findActiveMembership_(tenantId, ctx.userId);
  var tenant = findRow_(table_('Tenants'), function (r) { return String(r.id) === tenantId; });
  if (!membership || !tenant || tenant.status !== 'active') {
    throw apiError_('FORBIDDEN', 'Seçilen işletmeye erişiminiz bulunmuyor.');
  }
  var currentId = String(ctx.session.id);
  revokeSessions_(function (r) { return String(r.id) === currentId; });
  var token = createSession_(ctx.userId, tenantId);
  return sessionPayload_(ctx.user, membership, tenant, token);
}

function changePassword_(ctx, p) {
  if (!verifyPassword_(ctx.user, typeof p.currentPassword === 'string' ? p.currentPassword : '')) {
    throw apiError_('INVALID_CREDENTIALS', 'Mevcut şifreniz hatalı.');
  }
  var credentials = hashNewPassword_(password_(p.newPassword));
  return withLock_(function () {
    var users = table_('Users');
    var user = findRow_(users, function (r) { return String(r.id) === ctx.userId; });
    user.passwordHash = credentials.hash;
    user.passwordSalt = credentials.salt;
    user.passwordIterations = credentials.iterations;
    update_(users, user);
    var currentId = String(ctx.session.id);
    revokeSessions_(function (r) { return String(r.userId) === ctx.userId && String(r.id) !== currentId; });
    audit_(ctx, 'change_password', 'user', ctx.userId);
    return { changed: true };
  });
}

// ---------------------------------------------------------------------------
// İŞLETME PROFİLİ, ÜYELER, DAVETLER, YAŞAM DÖNGÜSÜ
// ---------------------------------------------------------------------------
function saveBusinessProfile_(ctx, p) {
  var tenants = table_('Tenants');
  var tenant = findRow_(tenants, function (r) { return String(r.id) === ctx.tenantId; });
  var profile = {
    name: str_(p.name, 'İşletme adı', { required: true, min: 2, max: 80 }),
    phone: phone_(p.phone, 'İşletme telefonu', true),
    address: str_(p.address, 'Adres', { required: true, min: 5, max: 300 }),
    currency: oneOf_(p.currency, CURRENCIES, 'Para birimi'),
    locale: oneOf_(p.locale, LOCALES, 'Sayı biçimi'),
    dateFormat: oneOf_(p.dateFormat, DATE_FORMATS, 'Tarih biçimi'),
    legalName: str_(p.legalName, 'Ticari unvan', { max: 150 }),
    taxOffice: str_(p.taxOffice, 'Vergi dairesi', { max: 80 }),
    taxNumber: str_(p.taxNumber, 'Vergi / TC kimlik no', { max: 11 })
  };
  if (profile.taxNumber && !/^\d{10,11}$/.test(profile.taxNumber)) {
    throw apiError_('VALIDATION', 'Vergi numarası 10, TC kimlik numarası 11 haneli olmalıdır.');
  }
  if (p.logoDataUrl !== undefined) profile.logoDataUrl = logo_(p.logoDataUrl);

  Object.keys(profile).forEach(function (k) { tenant[k] = profile[k]; });
  var firstSetup = !isTrue_(tenant.setupCompleted);
  tenant.setupCompleted = true;
  tenant.updatedAt = new Date().toISOString();
  update_(tenants, tenant);
  audit_(ctx, firstSetup ? 'setup_completed' : 'profile_updated', 'tenant', ctx.tenantId);
  return sessionPayload_(ctx.user, ctx.membership, tenant);
}

function listMembers_(ctx) {
  var users = table_('Users').rows;
  var members = table_('Memberships').rows
    .filter(function (m) { return String(m.tenantId) === ctx.tenantId && m.status === 'active'; })
    .map(function (m) {
      var u = users.filter(function (x) { return String(x.id) === String(m.userId); })[0] || {};
      return {
        membershipId: String(m.id),
        userId: String(m.userId),
        displayName: String(u.displayName || ''),
        email: String(u.email || ''),
        role: String(m.role),
        createdAt: isoString_(m.createdAt),
        isCurrentUser: String(m.userId) === ctx.userId
      };
    });
  var now = Date.now();
  var invitations = table_('Invitations').rows
    .filter(function (r) { return String(r.tenantId) === ctx.tenantId && r.role !== 'owner' && isPendingInvite_(r, now); })
    .map(publicInvite_);
  var plan = planInfo_(ctx.tenant);
  return { members: members, invitations: invitations, seats: { used: members.length + invitations.length, max: plan.maxUsers } };
}

function createInvite_(ctx, p) {
  var email = email_(p.email);
  var role = p.role === 'admin' || p.role === 'staff' ? p.role : null;
  if (!role) throw apiError_('VALIDATION', 'Geçerli bir rol seçin.');
  if (role === 'admin' && ctx.role !== 'owner') {
    throw apiError_('FORBIDDEN', 'Yönetici davet etme yetkisi yalnızca işletme sahibindedir.');
  }
  var memberships = table_('Memberships');
  var existingUser = findUserByEmail_(table_('Users'), email);
  if (existingUser && findActiveMembership_(ctx.tenantId, String(existingUser.id), memberships)) {
    throw apiError_('CONFLICT', 'Bu kullanıcı zaten işletmenizin üyesi.');
  }

  var invitations = table_('Invitations');
  var now = new Date();
  invitations.rows.forEach(function (r) {
    if (String(r.tenantId) === ctx.tenantId && String(r.email) === email && isPendingInvite_(r, now.getTime())) {
      r.revokedAt = now.toISOString();
      update_(invitations, r);
    }
  });
  var pending = invitations.rows.filter(function (r) {
    return String(r.tenantId) === ctx.tenantId && r.role !== 'owner' && isPendingInvite_(r, now.getTime());
  }).length;
  var maxUsers = planInfo_(ctx.tenant).maxUsers;
  if (countActiveMembers_(ctx.tenantId, memberships) + pending >= maxUsers) {
    throw apiError_('PLAN_LIMIT', 'Planınızın kullanıcı sınırına ulaşıldı (' + maxUsers + ' kullanıcı). Bekleyen bir daveti iptal edin veya planınızı yükseltin.');
  }

  var code = newInviteCode_();
  var invitation = {
    id: newId_('INV'),
    tenantId: ctx.tenantId,
    email: email,
    role: role,
    codeHash: sha256Hex_(normalizeCode_(code)),
    invitedBy: ctx.userId,
    createdAt: now.toISOString(),
    expiresAt: addDays_(now, INVITE_TTL_DAYS).toISOString(),
    acceptedAt: '',
    revokedAt: ''
  };
  insert_(invitations, invitation);
  audit_(ctx, 'create', 'invitation', invitation.id);
  return { invitation: publicInvite_(invitation), code: code };
}

function revokeInvite_(ctx, p) {
  var id = id_(p.id, 'Davet');
  var invitations = table_('Invitations');
  var inv = findInTenant_(invitations, ctx.tenantId, id);
  if (!inv || inv.role === 'owner') throw notFound_('Davet');
  if (!inv.revokedAt && !inv.acceptedAt) {
    inv.revokedAt = new Date().toISOString();
    update_(invitations, inv);
    audit_(ctx, 'revoke', 'invitation', id);
  }
  return { id: id };
}

function updateMemberRole_(ctx, p) {
  var id = id_(p.membershipId, 'Üyelik');
  var role = p.role === 'admin' || p.role === 'staff' ? p.role : null;
  if (!role) throw apiError_('VALIDATION', 'Geçerli bir rol seçin.');
  var memberships = table_('Memberships');
  var m = findInTenant_(memberships, ctx.tenantId, id);
  if (!m || m.status !== 'active') throw notFound_('Kullanıcı');
  if (m.role === 'owner') throw apiError_('FORBIDDEN', 'İşletme sahibinin rolü değiştirilemez.');
  m.role = role;
  m.updatedAt = new Date().toISOString();
  update_(memberships, m);
  audit_(ctx, 'change_role', 'membership', id);
  return { membershipId: id, role: role };
}

function removeMember_(ctx, p) {
  var id = id_(p.membershipId, 'Üyelik');
  var memberships = table_('Memberships');
  var m = findInTenant_(memberships, ctx.tenantId, id);
  if (!m || m.status !== 'active') throw notFound_('Kullanıcı');
  if (m.role === 'owner') throw apiError_('FORBIDDEN', 'İşletme sahibi işletmeden çıkarılamaz.');
  if (ctx.role !== 'owner' && m.role !== 'staff') {
    throw apiError_('FORBIDDEN', 'Yöneticileri yalnızca işletme sahibi çıkarabilir.');
  }
  if (String(m.userId) === ctx.userId) throw apiError_('FORBIDDEN', 'Kendinizi işletmeden çıkaramazsınız.');
  m.status = 'removed';
  m.updatedAt = new Date().toISOString();
  update_(memberships, m);
  var userId = String(m.userId);
  revokeSessions_(function (r) { return String(r.userId) === userId && String(r.tenantId) === ctx.tenantId; });
  audit_(ctx, 'remove', 'membership', id);
  return { membershipId: id };
}

function exportTenantData_(ctx) {
  audit_(ctx, 'export', 'tenant', ctx.tenantId);
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    tenant: publicTenant_(ctx.tenant),
    data: tenantData_(ctx.tenantId)
  };
}

function closeTenant_(ctx, p) {
  if (!verifyPassword_(ctx.user, typeof p.password === 'string' ? p.password : '')) {
    throw apiError_('INVALID_CREDENTIALS', 'Şifreniz hatalı.');
  }
  if (String(p.confirmName || '').trim() !== String(ctx.tenant.name).trim()) {
    throw apiError_('VALIDATION', 'Onay için işletme adını birebir yazın.');
  }
  return withLock_(function () {
    var tenants = table_('Tenants');
    var tenant = findRow_(tenants, function (r) { return String(r.id) === ctx.tenantId; });
    var now = new Date();
    var retentionDays = Number(getSetting_('DATA_RETENTION_DAYS', String(DEFAULT_RETENTION_DAYS))) || DEFAULT_RETENTION_DAYS;
    tenant.status = 'closed';
    tenant.closedAt = now.toISOString();
    tenant.deleteAfter = addDays_(now, retentionDays).toISOString();
    tenant.updatedAt = now.toISOString();
    update_(tenants, tenant);

    revokeSessions_(function (r) { return String(r.tenantId) === ctx.tenantId; });
    var invitations = table_('Invitations');
    invitations.rows.forEach(function (r) {
      if (String(r.tenantId) === ctx.tenantId && isPendingInvite_(r, now.getTime())) {
        r.revokedAt = now.toISOString();
        update_(invitations, r);
      }
    });
    audit_(ctx, 'close', 'tenant', ctx.tenantId);
    return { closed: true, deleteAfter: tenant.deleteAfter };
  });
}

// ---------------------------------------------------------------------------
// İŞLETME VERİLERİ (MÜŞTERİ / ARAÇ / SERVİS KAYDI)
// ---------------------------------------------------------------------------
var CUSTOMER_FIELDS = ['firstName', 'lastName', 'phone', 'reference', 'notes'];
var VEHICLE_FIELDS = ['customerId', 'brand', 'model', 'plate', 'chassisNo', 'entryDate', 'notes'];
var SERVICE_FIELDS = ['vehicleId', 'entryKm', 'recordDate', 'generalSummary', 'paymentStatus', 'paidAmount']
  .concat(FEE_KEYS).concat(NOTE_KEYS);

function getData_(ctx) {
  return tenantData_(ctx.tenantId);
}

function tenantData_(tenantId) {
  var tz = timeZone_();
  var pick = function (name) {
    return table_(name).rows
      .filter(function (r) { return r.id !== '' && String(r.tenantId) === tenantId; })
      .map(function (r) { return publicRecord_(r, tz); });
  };
  return { customers: pick('Customers'), vehicles: pick('Vehicles'), serviceRecords: pick('ServiceRecords') };
}

function addCustomer_(ctx, p) {
  return insertTenantRecord_(ctx, 'Customers', 'CST', 'customer', cleanCustomer_(p));
}

function updateCustomer_(ctx, p) {
  return updateTenantRecord_(ctx, 'Customers', 'Müşteri', 'customer', CUSTOMER_FIELDS, p, cleanCustomer_);
}

function deleteCustomer_(ctx, p) {
  var id = id_(p.id, 'Müşteri');
  var customers = table_('Customers');
  var row = findInTenant_(customers, ctx.tenantId, id);
  if (!row) throw notFound_('Müşteri');
  deleteRows_(customers, [row]);
  // Mevcut davranış korunur: müşteriye ait araçlar da silinir (yalnızca aynı işletmede).
  var vehicles = table_('Vehicles');
  deleteRows_(vehicles, vehicles.rows.filter(function (v) {
    return String(v.tenantId) === ctx.tenantId && String(v.customerId) === id;
  }));
  audit_(ctx, 'delete', 'customer', id);
  return { id: id };
}

function addVehicle_(ctx, p) {
  return insertTenantRecord_(ctx, 'Vehicles', 'VHC', 'vehicle', cleanVehicle_(p, ctx.tenantId));
}

function updateVehicle_(ctx, p) {
  return updateTenantRecord_(ctx, 'Vehicles', 'Araç', 'vehicle', VEHICLE_FIELDS, p, function (src) {
    return cleanVehicle_(src, ctx.tenantId);
  });
}

function deleteVehicle_(ctx, p) {
  return deleteTenantRecord_(ctx, 'Vehicles', 'Araç', 'vehicle', p);
}

function addServiceRecord_(ctx, p) {
  return insertTenantRecord_(ctx, 'ServiceRecords', 'SRV', 'service_record', cleanService_(p, ctx.tenantId));
}

function updateServiceRecord_(ctx, p) {
  return updateTenantRecord_(ctx, 'ServiceRecords', 'Servis kaydı', 'service_record', SERVICE_FIELDS, p, function (src) {
    return cleanService_(src, ctx.tenantId);
  });
}

function deleteServiceRecord_(ctx, p) {
  return deleteTenantRecord_(ctx, 'ServiceRecords', 'Servis kaydı', 'service_record', p);
}

function insertTenantRecord_(ctx, sheetName, prefix, entity, data) {
  var nowIso = new Date().toISOString();
  var record = {};
  Object.keys(data).forEach(function (k) { record[k] = data[k]; });
  record.id = newId_(prefix);
  record.tenantId = ctx.tenantId; // istemciden gelen değer değil, oturumdaki işletme
  record.createdAt = nowIso;
  record.updatedAt = nowIso;
  insert_(table_(sheetName), record);
  audit_(ctx, 'create', entity, record.id);
  return { id: record.id, createdAt: nowIso };
}

function updateTenantRecord_(ctx, sheetName, label, entity, fields, p, clean) {
  var id = id_(p.id, label);
  var t = table_(sheetName);
  var row = findInTenant_(t, ctx.tenantId, id);
  if (!row) throw notFound_(label);
  var current = publicRecord_(row, timeZone_());
  var merged = {};
  fields.forEach(function (f) { merged[f] = p[f] !== undefined ? p[f] : current[f]; });
  var data = clean(merged);
  Object.keys(data).forEach(function (k) { row[k] = data[k]; });
  row.updatedAt = new Date().toISOString();
  update_(t, row);
  audit_(ctx, 'update', entity, id);
  return { id: id };
}

function deleteTenantRecord_(ctx, sheetName, label, entity, p) {
  var id = id_(p.id, label);
  var t = table_(sheetName);
  var row = findInTenant_(t, ctx.tenantId, id);
  if (!row) throw notFound_(label);
  deleteRows_(t, [row]);
  audit_(ctx, 'delete', entity, id);
  return { id: id };
}

function cleanCustomer_(src) {
  return {
    firstName: str_(src.firstName, 'İsim', { required: true, max: 60 }),
    lastName: str_(src.lastName, 'Soyisim', { required: true, max: 60 }),
    phone: phone_(src.phone, 'Telefon', true),
    reference: str_(src.reference, 'Referans', { max: 120 }),
    notes: str_(src.notes, 'Müşteri notu', { max: 2000 })
  };
}

function cleanVehicle_(src, tenantId) {
  var customerId = id_(src.customerId, 'Müşteri');
  if (!findInTenant_(table_('Customers'), tenantId, customerId)) {
    throw apiError_('NOT_FOUND', 'Seçilen müşteri bulunamadı.');
  }
  return {
    customerId: customerId,
    brand: str_(src.brand, 'Marka', { required: true, max: 40 }),
    model: str_(src.model, 'Model', { required: true, max: 80 }),
    plate: str_(src.plate, 'Plaka', { required: true, max: 15 }).replace(/\s+/g, '').toUpperCase(),
    chassisNo: str_(src.chassisNo, 'Şasi numarası', { max: 30 }).toUpperCase(),
    entryDate: dateOnly_(src.entryDate, 'Giriş tarihi', false) || todayInTz_(),
    notes: str_(src.notes, 'Araç notu', { max: 2000 })
  };
}

function cleanService_(src, tenantId) {
  var vehicleId = id_(src.vehicleId, 'Araç');
  if (!findInTenant_(table_('Vehicles'), tenantId, vehicleId)) {
    throw apiError_('NOT_FOUND', 'Seçilen araç bulunamadı.');
  }
  var out = {
    vehicleId: vehicleId,
    entryKm: num_(src.entryKm, 'Giriş kilometresi', { required: true, max: 10000000 }),
    recordDate: dateOnly_(src.recordDate, 'Servis tarihi', true),
    generalSummary: str_(src.generalSummary, 'Genel işlem özeti', { max: 4000 }),
    paymentStatus: src.paymentStatus === undefined || src.paymentStatus === '' ? 'Ödenmedi'
      : oneOf_(src.paymentStatus, PAYMENT_STATUSES, 'Ödeme durumu')
  };
  var total = 0;
  TECHNICIAN_KEYS.forEach(function (k) {
    var fee = num_(src[k + 'Fee'], 'İşçilik ücreti', { max: 1000000000 });
    out[k + 'Fee'] = fee;
    out[k + 'Note'] = str_(src[k + 'Note'], 'İşlem notu', { max: 2000 });
    total += fee;
  });
  // İş kuralı: toplam tutar her zaman usta/işçilik ücretlerinin toplamıdır.
  out.totalAmount = round2_(total);
  if (out.paymentStatus === 'Kısmi Ödendi') {
    var paid = Math.min(num_(src.paidAmount, 'Alınan ödeme', { max: 1000000000 }), out.totalAmount);
    out.paidAmount = round2_(paid);
    out.remainingAmount = round2_(out.totalAmount - paid);
  } else {
    out.paidAmount = 0;
    out.remainingAmount = 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// OPERATÖR FONKSİYONLARI (Apps Script düzenleyicisinden çalıştırılır)
// ---------------------------------------------------------------------------

/**
 * Tek işletmeli eski verileri varsayılan bir işletmeye bağlar.
 * - Tekrar çalıştırılabilir (idempotent): yalnızca tenantId'si boş satırları işler.
 * - Hiçbir satırı silmez; ilk çalıştırmada E-Tablonun tam yedeğini Drive'a kopyalar.
 * - İşletme sahibi yoksa tek kullanımlık bir "sahip davet kodu" üretir ve
 *   Script Properties içine OWNER_CLAIM_<işletmeId> anahtarıyla yazar.
 */
function migrateLegacyData() {
  return withLock_(function () {
    var props = PropertiesService.getScriptProperties();
    var ss = ss_();
    var pending = countUnassignedRows_(ss);
    var totalPending = pending.Customers + pending.Vehicles + pending.ServiceRecords;
    var legacyId = props.getProperty('LEGACY_TENANT_ID');

    if (!totalPending && !legacyId) {
      Logger.log('Taşınacak eski veri bulunamadı. İşlem yapılmadı.');
      return { migrated: false, pending: pending };
    }

    if (totalPending && !props.getProperty('LEGACY_BACKUP_ID')) {
      var stamp = Utilities.formatDate(new Date(), timeZone_(), 'yyyy-MM-dd HH-mm');
      var backup = ss.copy(ss.getName() + ' - Yedek (çok işletmeli geçiş öncesi ' + stamp + ')');
      props.setProperty('LEGACY_BACKUP_ID', backup.getId());
      Logger.log('Geçiş öncesi yedek oluşturuldu. Dosya kimliği: ' + backup.getId());
    }

    ensureSchemaUnlocked_(true);

    var tenants = table_('Tenants');
    var tenant = legacyId ? findRow_(tenants, function (r) { return String(r.id) === legacyId; }) : null;
    if (!tenant) {
      tenant = newTenant_(getSetting_('LEGACY_TENANT_NAME', 'İşletmem'), 'legacy', 'active', '');
      insert_(tenants, tenant);
      props.setProperty('LEGACY_TENANT_ID', tenant.id);
    }
    var tenantId = String(tenant.id);

    var assigned = {};
    TENANT_DATA_SHEETS.forEach(function (name) { assigned[name] = assignTenantColumn_(name, tenantId); });

    var claim = ensureOwnerClaim_(tenantId);
    audit_({ tenantId: tenantId, userId: 'system' }, 'legacy_migrated', 'tenant', tenantId);

    var summary = { migrated: true, tenantId: tenantId, assigned: assigned, ownerClaimCreated: claim };
    Logger.log('Eski veri geçişi tamamlandı: ' + JSON.stringify(summary));
    if (claim) {
      Logger.log('İşletme sahibi davet kodu Proje Ayarları > Komut dosyası özellikleri altında OWNER_CLAIM_' +
        tenantId + ' anahtarına yazıldı.');
    }
    return summary;
  });
}

/** Kayıt kapalıyken (SIGNUP_MODE=closed) yeni bir işletme ve sahip davet kodu oluşturur. */
function provisionTenant(businessName) {
  return withLock_(function () {
    ensureSchemaUnlocked_(false);
    var tenant = newTenant_(str_(businessName, 'İşletme adı', { required: true, min: 2, max: 80 }),
      'trial', 'trialing', addDays_(new Date(), TRIAL_DAYS).toISOString());
    insert_(table_('Tenants'), tenant);
    ensureOwnerClaim_(String(tenant.id));
    audit_({ tenantId: tenant.id, userId: 'system' }, 'provision', 'tenant', tenant.id);
    Logger.log('İşletme oluşturuldu: ' + tenant.id + '. Sahip davet kodu OWNER_CLAIM_' + tenant.id +
      ' özelliğine yazıldı.');
    return { tenantId: tenant.id };
  });
}

/** Ödeme entegrasyonu yokken plan/abonelik durumunu elle günceller. */
function setTenantPlan(tenantId, planId, subscriptionStatus) {
  if (!PLANS[planId]) throw new Error('Bilinmeyen plan: ' + planId);
  if (SUBSCRIPTION_STATUSES.indexOf(subscriptionStatus) === -1) throw new Error('Bilinmeyen abonelik durumu.');
  return withLock_(function () {
    var tenants = table_('Tenants');
    var tenant = findRow_(tenants, function (r) { return String(r.id) === String(tenantId); });
    if (!tenant) throw new Error('İşletme bulunamadı: ' + tenantId);
    tenant.planId = planId;
    tenant.subscriptionStatus = subscriptionStatus;
    tenant.updatedAt = new Date().toISOString();
    update_(tenants, tenant);
    audit_({ tenantId: String(tenant.id), userId: 'system' }, 'plan_changed', 'tenant', String(tenant.id));
    return { tenantId: String(tenant.id), planId: planId, subscriptionStatus: subscriptionStatus };
  });
}

/** Kapatılmış (henüz silinmemiş) bir işletmeyi yeniden etkinleştirir. */
function restoreTenant(tenantId) {
  return withLock_(function () {
    var tenants = table_('Tenants');
    var tenant = findRow_(tenants, function (r) { return String(r.id) === String(tenantId); });
    if (!tenant || tenant.status !== 'closed') throw new Error('Geri alınabilir kapalı işletme bulunamadı.');
    tenant.status = 'active';
    tenant.closedAt = '';
    tenant.deleteAfter = '';
    tenant.updatedAt = new Date().toISOString();
    update_(tenants, tenant);
    audit_({ tenantId: String(tenant.id), userId: 'system' }, 'restore', 'tenant', String(tenant.id));
    return { tenantId: String(tenant.id) };
  });
}

/**
 * Günlük bakım: saklama süresi dolan kapalı işletmelerin verilerini kalıcı olarak siler,
 * süresi geçmiş oturumları temizler. Zaman tetikleyicisiyle (günlük) çalıştırılması önerilir.
 */
function dailyMaintenance() {
  return withLock_(function () {
    ensureSchemaUnlocked_(false);
    var purged = purgeClosedTenants_(Date.now());
    var removedSessions = cleanupSessions_(Date.now());
    Logger.log('Bakım tamamlandı. Silinen işletme sayısı: ' + purged.length + ', temizlenen oturum: ' + removedSessions);
    return { purgedTenants: purged, removedSessions: removedSessions };
  });
}

function purgeClosedTenants_(nowMs) {
  var tenants = table_('Tenants');
  var due = tenants.rows.filter(function (t) {
    return t.status === 'closed' && t.deleteAfter && toTime_(t.deleteAfter) <= nowMs;
  });
  due.forEach(function (tenant) {
    var tenantId = String(tenant.id);
    TENANT_DATA_SHEETS.concat(['Memberships', 'Invitations', 'Sessions']).forEach(function (name) {
      var t = table_(name);
      deleteRows_(t, t.rows.filter(function (r) { return String(r.tenantId) === tenantId; }));
    });
    var fresh = table_('Tenants');
    var row = findRow_(fresh, function (r) { return String(r.id) === tenantId; });
    ['name', 'phone', 'address', 'logoDataUrl', 'legalName', 'taxOffice', 'taxNumber',
      'billingCustomerId', 'billingSubscriptionId'].forEach(function (k) { row[k] = ''; });
    row.status = 'purged';
    row.updatedAt = new Date(nowMs).toISOString();
    update_(fresh, row);
    audit_({ tenantId: tenantId, userId: 'system' }, 'purge', 'tenant', tenantId);
  });
  return due.map(function (t) { return String(t.id); });
}

function cleanupSessions_(nowMs) {
  var sessions = table_('Sessions');
  var stale = sessions.rows.filter(function (r) {
    if (!r.id) return false;
    var end = r.revokedAt ? toTime_(r.revokedAt) : toTime_(r.expiresAt);
    return end && end < nowMs - 24 * 3600000;
  });
  deleteRows_(sessions, stale);
  return stale.length;
}

function countUnassignedRows_(ss) {
  var result = {};
  TENANT_DATA_SHEETS.forEach(function (name) {
    result[name] = 0;
    var sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) return;
    var values = sheet.getDataRange().getValues();
    var headers = values[0].map(function (h) { return String(h).trim(); });
    var idIdx = headers.indexOf('id');
    var tIdx = headers.indexOf('tenantId');
    for (var i = 1; i < values.length; i++) {
      if (idIdx !== -1 && String(values[i][idIdx]).trim() === '') continue;
      if (tIdx === -1 || String(values[i][tIdx]).trim() === '') result[name]++;
    }
  });
  return result;
}

function assignTenantColumn_(name, tenantId) {
  var t = table_(name);
  var col = t.headers.indexOf('tenantId') + 1;
  if (!col || !t.rows.length) return 0;
  var count = 0;
  var column = t.rows.map(function (r) {
    if (String(r.id).trim() !== '' && String(r.tenantId).trim() === '') {
      count++;
      return [tenantId];
    }
    return [toCell_(r.tenantId)];
  });
  if (count) t.sheet.getRange(2, col, column.length, 1).setValues(column);
  return count;
}

function ensureOwnerClaim_(tenantId) {
  var hasOwner = table_('Memberships').rows.some(function (m) {
    return String(m.tenantId) === tenantId && m.role === 'owner' && m.status === 'active';
  });
  if (hasOwner) return false;
  var invitations = table_('Invitations');
  var now = new Date();
  var props = PropertiesService.getScriptProperties();
  var stillValid = invitations.rows.some(function (r) {
    return String(r.tenantId) === tenantId && r.role === 'owner' && isPendingInvite_(r, now.getTime());
  });
  if (stillValid && props.getProperty('OWNER_CLAIM_' + tenantId)) return false; // mevcut geçerli kod korunur
  invitations.rows.forEach(function (r) {
    if (String(r.tenantId) === tenantId && r.role === 'owner' && isPendingInvite_(r, now.getTime())) {
      r.revokedAt = now.toISOString();
      update_(invitations, r);
    }
  });
  var code = newInviteCode_();
  insert_(invitations, {
    id: newId_('INV'),
    tenantId: tenantId,
    email: '',
    role: 'owner',
    codeHash: sha256Hex_(normalizeCode_(code)),
    invitedBy: 'system',
    createdAt: now.toISOString(),
    expiresAt: addDays_(now, OWNER_CLAIM_TTL_DAYS).toISOString(),
    acceptedAt: '',
    revokedAt: ''
  });
  // Kod düz metin olarak yalnızca betik sahibinin görebildiği Script Properties'e yazılır; loglanmaz.
  PropertiesService.getScriptProperties().setProperty('OWNER_CLAIM_' + tenantId, code);
  return true;
}

// ---------------------------------------------------------------------------
// ŞEMA VE TABLO ERİŞİM KATMANI
// ---------------------------------------------------------------------------
function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function timeZone_() {
  return ss_().getSpreadsheetTimeZone() || 'Europe/Istanbul';
}

function ensureSchema_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SCHEMA_VERSION') === SCHEMA_VERSION) return;
  withLock_(function () { ensureSchemaUnlocked_(false); });
}

function ensureSchemaUnlocked_(force) {
  var props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty('SCHEMA_VERSION') === SCHEMA_VERSION) return;
  var ss = ss_();
  Object.keys(SHEETS).forEach(function (name) { ensureSheet_(ss, name, SHEETS[name]); });
  props.setProperty('SCHEMA_VERSION', SCHEMA_VERSION);
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  var lastCol = sheet.getLastColumn();
  var existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  var hasHeaders = existing.some(function (h) { return h !== ''; });
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    existing = headers.slice();
  } else {
    // Eksik sütunları sona ekle; mevcut sütunların yeri ve verisi değişmez.
    var missing = headers.filter(function (h) { return existing.indexOf(h) === -1; });
    if (missing.length) {
      sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
      existing = existing.concat(missing);
    }
  }
  sheet.getRange('1:1').setFontWeight('bold').setBackground('#e8f0fe');
  (TEXT_COLUMNS[name] || []).forEach(function (col) {
    var idx = existing.indexOf(col);
    if (idx !== -1) {
      var letter = columnLetter_(idx + 1);
      sheet.getRange(letter + ':' + letter).setNumberFormat('@');
    }
  });
}

function columnLetter_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function table_(name) {
  var sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error('Sayfa bulunamadı: ' + name);
  var values = sheet.getDataRange().getValues();
  var headers = (values[0] || []).map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = { _row: i + 1, _raw: values[i] };
    for (var j = 0; j < headers.length; j++) {
      if (headers[j]) obj[headers[j]] = values[i][j];
    }
    rows.push(obj);
  }
  return { name: name, sheet: sheet, headers: headers, rows: rows };
}

function findRow_(t, predicate) {
  for (var i = 0; i < t.rows.length; i++) {
    if (predicate(t.rows[i])) return t.rows[i];
  }
  return null;
}

// Tüm işletme verisi erişimleri bu fonksiyondan geçer: kimlik VE işletme eşleşmelidir.
function findInTenant_(t, tenantId, id) {
  if (!tenantId) return null;
  return findRow_(t, function (r) { return String(r.id) === String(id) && String(r.tenantId) === String(tenantId); });
}

function insert_(t, obj) {
  t.sheet.appendRow(t.headers.map(function (h) { return h ? toCell_(obj[h]) : ''; }));
}

function update_(t, obj) {
  var row = t.headers.map(function (h, j) {
    return h ? toCell_(obj[h]) : (obj._raw ? obj._raw[j] : '');
  });
  t.sheet.getRange(obj._row, 1, 1, t.headers.length).setValues([row]);
}

function deleteRows_(t, rows) {
  rows.slice().sort(function (a, b) { return b._row - a._row; }).forEach(function (r) {
    t.sheet.deleteRow(r._row);
  });
}

// Hücreye yazılacak değeri hazırlar. "=", "+", "-", "@" ile başlayan metinler
// formül olarak çalıştırılmasın (ve başka satırları sızdırmasın) diye kaçışlanır.
function toCell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number' || typeof v === 'boolean' || isDate_(v)) return v;
  var s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function publicRecord_(row, tz) {
  var out = {};
  Object.keys(row).forEach(function (k) {
    if (k === '_row' || k === '_raw' || k === 'tenantId' || k === '') return;
    var v = row[k];
    if (isDate_(v)) {
      v = DATE_ONLY_FIELDS.indexOf(k) !== -1 ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v.toISOString();
    }
    if (k === 'phone' && v !== '' && v !== null && v !== undefined) {
      v = String(v);
      if (/^\d{10}$/.test(v)) v = '0' + v;
    }
    out[k] = v;
  });
  return out;
}

function publicTenant_(t) {
  var r = publicRecord_(t, timeZone_());
  return {
    id: String(r.id),
    name: String(r.name || ''),
    phone: String(r.phone || ''),
    address: String(r.address || ''),
    logoDataUrl: String(r.logoDataUrl || ''),
    currency: CURRENCIES.indexOf(r.currency) !== -1 ? r.currency : 'TRY',
    locale: LOCALES.indexOf(r.locale) !== -1 ? r.locale : 'tr-TR',
    dateFormat: DATE_FORMATS.indexOf(r.dateFormat) !== -1 ? r.dateFormat : 'DD.MM.YYYY',
    legalName: String(r.legalName || ''),
    taxOffice: String(r.taxOffice || ''),
    taxNumber: String(r.taxNumber || ''),
    setupCompleted: isTrue_(t.setupCompleted),
    status: String(r.status || ''),
    createdAt: isoString_(r.createdAt)
  };
}

function planInfo_(t) {
  var planId = PLANS[t.planId] ? String(t.planId) : 'trial';
  return {
    id: planId,
    name: PLANS[planId].name,
    maxUsers: PLANS[planId].maxUsers,
    subscriptionStatus: String(t.subscriptionStatus || 'trialing'),
    trialEndsAt: isoString_(t.trialEndsAt),
    currentPeriodEnd: isoString_(t.currentPeriodEnd),
    billingEnabled: !!getSetting_('BILLING_PROVIDER', ''),
    dataRetentionDays: Number(getSetting_('DATA_RETENTION_DAYS', String(DEFAULT_RETENTION_DAYS))) || DEFAULT_RETENTION_DAYS
  };
}

function publicInvite_(r) {
  return {
    id: String(r.id),
    email: String(r.email || ''),
    role: String(r.role),
    createdAt: isoString_(r.createdAt),
    expiresAt: isoString_(r.expiresAt)
  };
}

function newTenant_(name, planId, subscriptionStatus, trialEndsAt) {
  var nowIso = new Date().toISOString();
  return {
    id: newId_('TNT'), name: name, phone: '', address: '', logoDataUrl: '',
    currency: 'TRY', locale: 'tr-TR', dateFormat: 'DD.MM.YYYY',
    legalName: '', taxOffice: '', taxNumber: '',
    setupCompleted: false, status: 'active',
    planId: planId, subscriptionStatus: subscriptionStatus, trialEndsAt: trialEndsAt,
    billingProvider: '', billingCustomerId: '', billingSubscriptionId: '', currentPeriodEnd: '',
    createdAt: nowIso, updatedAt: nowIso, closedAt: '', deleteAfter: ''
  };
}

function newUser_(email, displayName, credentials) {
  return {
    id: newId_('USR'), email: email, displayName: displayName,
    passwordHash: credentials.hash, passwordSalt: credentials.salt, passwordIterations: credentials.iterations,
    status: 'active', failedLogins: 0, lockedUntil: '', createdAt: new Date().toISOString(), lastLoginAt: ''
  };
}

function newMembership_(tenantId, userId, role) {
  var nowIso = new Date().toISOString();
  return { id: newId_('MEM'), tenantId: tenantId, userId: userId, role: role, status: 'active', createdAt: nowIso, updatedAt: nowIso };
}

function findUserByEmail_(users, email) {
  return findRow_(users, function (r) { return String(r.email).toLowerCase() === email; });
}

function findActiveMembership_(tenantId, userId, memberships) {
  return findRow_(memberships || table_('Memberships'), function (r) {
    return String(r.tenantId) === String(tenantId) && String(r.userId) === String(userId) && r.status === 'active';
  });
}

function countActiveMembers_(tenantId, memberships) {
  return memberships.rows.filter(function (m) { return String(m.tenantId) === tenantId && m.status === 'active'; }).length;
}

function isPendingInvite_(r, nowMs) {
  return !!r.id && !r.acceptedAt && !r.revokedAt && toTime_(r.expiresAt) > nowMs;
}

function audit_(ctx, action, entity, entityId) {
  // Denetim kaydı yalnızca kimlikleri içerir; müşteri adı, telefon gibi kişisel veriler yazılmaz.
  try {
    insert_(table_('AuditLog'), {
      id: newId_('AUD'), tenantId: ctx.tenantId, userId: ctx.userId,
      action: action, entity: entity, entityId: entityId, createdAt: new Date().toISOString()
    });
  } catch (err) {
    console.warn('[OtoTakip] Denetim kaydı yazılamadı: ' + String(err && err.message).slice(0, 200));
  }
}

function enforceSignupRate_() {
  var limit = Number(getSetting_('SIGNUP_HOURLY_LIMIT', String(DEFAULT_SIGNUP_HOURLY_LIMIT))) || DEFAULT_SIGNUP_HOURLY_LIMIT;
  var since = Date.now() - 3600000;
  var recent = table_('Tenants').rows.filter(function (t) { return toTime_(t.createdAt) > since; }).length;
  if (recent >= limit) {
    throw apiError_('RATE_LIMITED', 'Şu anda çok fazla kayıt isteği var. Lütfen daha sonra tekrar deneyin.');
  }
}

var lockDepth_ = 0;
function withLock_(fn) {
  if (lockDepth_ > 0) return fn();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw apiError_('BUSY', 'Sunucu şu anda yoğun. Lütfen birkaç saniye sonra tekrar deneyin.');
  }
  lockDepth_++;
  try {
    var result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lockDepth_--;
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// DOĞRULAMA YARDIMCILARI
// ---------------------------------------------------------------------------
function validation_(message) {
  return apiError_('VALIDATION', message);
}

function notFound_(label) {
  return apiError_('NOT_FOUND', label + ' bulunamadı.');
}

function str_(v, label, opts) {
  opts = opts || {};
  var s = v === undefined || v === null ? '' : String(v).trim();
  if (opts.required && !s) throw validation_(label + ' zorunludur.');
  if (opts.min && s && s.length < opts.min) throw validation_(label + ' en az ' + opts.min + ' karakter olmalıdır.');
  if (opts.max && s.length > opts.max) throw validation_(label + ' en fazla ' + opts.max + ' karakter olabilir.');
  return s;
}

function num_(v, label, opts) {
  opts = opts || {};
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw validation_(label + ' zorunludur.');
    return 0;
  }
  var n = Number(v);
  if (!isFinite(n)) throw validation_(label + ' geçerli bir sayı olmalıdır.');
  if (n < 0) throw validation_(label + ' negatif olamaz.');
  if (opts.max !== undefined && n > opts.max) throw validation_(label + ' çok büyük.');
  return round2_(n);
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

function dateOnly_(v, label, required) {
  var s = isDate_(v) ? Utilities.formatDate(v, timeZone_(), 'yyyy-MM-dd') : String(v === undefined || v === null ? '' : v).trim();
  if (!s) {
    if (required) throw validation_(label + ' zorunludur.');
    return '';
  }
  s = s.split('T')[0];
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  var d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!d || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw validation_(label + ' geçerli bir tarih olmalıdır.');
  }
  return s;
}

function oneOf_(v, list, label) {
  if (list.indexOf(v) === -1) throw validation_(label + ' için geçerli bir seçim yapın.');
  return v;
}

function phone_(v, label, required) {
  var s = str_(v, label, { required: required, max: 25 });
  if (!s) return '';
  if (!/^[0-9+()\-\s]{7,25}$/.test(s)) throw validation_(label + ' geçerli bir telefon numarası olmalıdır.');
  if (/^\d{10}$/.test(s)) s = '0' + s;
  return s;
}

function id_(v, label) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  if (!/^[A-Za-z]{2,4}-[A-Za-z0-9]{1,40}$/.test(s)) throw validation_(label + ' kimliği geçersiz.');
  return s;
}

function normalizeEmail_(v) {
  return String(v === undefined || v === null ? '' : v).trim().toLowerCase();
}

function email_(v) {
  var s = normalizeEmail_(v);
  if (!s) throw validation_('E-posta adresi zorunludur.');
  if (s.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw validation_('Geçerli bir e-posta adresi girin.');
  return s;
}

function password_(v) {
  var s = typeof v === 'string' ? v : '';
  if (s.length < PASSWORD_MIN_LENGTH) throw validation_('Şifre en az ' + PASSWORD_MIN_LENGTH + ' karakter olmalıdır.');
  if (s.length > 128) throw validation_('Şifre en fazla 128 karakter olabilir.');
  if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(s) || !/\d/.test(s)) throw validation_('Şifre en az bir harf ve bir rakam içermelidir.');
  return s;
}

function logo_(v) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) return '';
  if (s.length > MAX_LOGO_LENGTH) throw validation_('Logo dosyası çok büyük. Daha küçük bir görsel seçin.');
  // SVG kabul edilmez (betik içerebilir); yalnızca raster görseller.
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(s)) {
    throw validation_('Logo PNG, JPEG veya WEBP biçiminde olmalıdır.');
  }
  return s;
}

function isTrue_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

function toTime_(v) {
  if (!v) return 0;
  if (isDate_(v)) return v.getTime();
  var t = Date.parse(String(v));
  return isNaN(t) ? 0 : t;
}

function isoString_(v) {
  var t = toTime_(v);
  return t ? new Date(t).toISOString() : '';
}

function addDays_(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function todayInTz_() {
  return Utilities.formatDate(new Date(), timeZone_(), 'yyyy-MM-dd');
}

function getSetting_(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return v === null || v === undefined || v === '' ? fallback : String(v);
}

// ---------------------------------------------------------------------------
// KRİPTOGRAFİ YARDIMCILARI
// ---------------------------------------------------------------------------
function newId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase();
}

function randomToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

// 24 rastgele onaltılık karakter (96 bit), okunabilirlik için 4'lü gruplar halinde.
function newInviteCode_() {
  var raw = (Utilities.getUuid().replace(/-/g, '').substring(0, 12) +
    Utilities.getUuid().replace(/-/g, '').substring(0, 12)).toUpperCase();
  return raw.match(/.{4}/g).join('-');
}

function normalizeCode_(v) {
  return String(v === undefined || v === null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function sha256Hex_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  return bytesToHex_(bytes);
}

function bytesToHex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function hashNewPassword_(password) {
  var salt = Utilities.getUuid();
  return { hash: hashPassword_(password, salt, PASSWORD_ITERATIONS), salt: salt, iterations: PASSWORD_ITERATIONS };
}

// PBKDF2-HMAC-SHA256 (tek blok, 32 bayt çıktı). Apps Script'te yerel PBKDF2 olmadığı için
// HMAC üzerinden uygulanır; doğruluğu testlerde Node'un crypto.pbkdf2Sync çıktısıyla karşılaştırılır.
function hashPassword_(password, salt, iterations) {
  var key = Utilities.newBlob(String(password)).getBytes();
  var u = Utilities.computeHmacSha256Signature(Utilities.newBlob(String(salt)).getBytes().concat([0, 0, 0, 1]), key);
  var out = u.slice();
  for (var i = 1; i < iterations; i++) {
    u = Utilities.computeHmacSha256Signature(u, key);
    for (var j = 0; j < out.length; j++) out[j] ^= u[j];
  }
  return Utilities.base64Encode(out);
}

function verifyPassword_(user, password) {
  if (!password || !user || !user.passwordHash) return false;
  var iterations = Number(user.passwordIterations) || PASSWORD_ITERATIONS;
  return safeEqual_(hashPassword_(password, String(user.passwordSalt), iterations), String(user.passwordHash));
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
