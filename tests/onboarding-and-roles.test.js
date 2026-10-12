"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { PASSWORD, PROFILE, ok, fails, registerTenant, addCustomer, addVehicle, addService, sheetRows, newRuntime } = require("./helpers");

test("kurulum tamamlanmadan işletme verisi işlemleri yapılamaz", () => {
  const rt = newRuntime();
  const reg = ok(rt.post("register", { businessName: "Yeni Servis", displayName: "Ali Usta", email: "ali@ornek.com", password: PASSWORD }));
  assert.equal(reg.tenant.setupCompleted, false);
  assert.equal(reg.data, null);
  fails(rt.post("getData", {}, reg.token), "SETUP_REQUIRED");
  fails(rt.post("addCustomer", { firstName: "A", lastName: "B", phone: "05320000000" }, reg.token), "SETUP_REQUIRED");
  fails(rt.post("createInvite", { email: "c@ornek.com", role: "staff" }, reg.token), "SETUP_REQUIRED");
});

test("işletme profili doğrulanır ve kaydedilince kurulum tamamlanır", () => {
  const rt = newRuntime();
  const reg = ok(rt.post("register", { businessName: "Yeni Servis", displayName: "Ali Usta", email: "ali@ornek.com", password: PASSWORD }));
  fails(rt.post("saveBusinessProfile", { ...PROFILE, name: "" }, reg.token), "VALIDATION");
  fails(rt.post("saveBusinessProfile", { ...PROFILE, currency: "XYZ" }, reg.token), "VALIDATION");
  fails(rt.post("saveBusinessProfile", { ...PROFILE, taxNumber: "12ab" }, reg.token), "VALIDATION");
  fails(rt.post("saveBusinessProfile", { ...PROFILE, logoDataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }, reg.token), "VALIDATION");

  const logo = "data:image/png;base64,iVBORw0KGgo=";
  const saved = ok(rt.post("saveBusinessProfile", { ...PROFILE, currency: "EUR", taxNumber: "1234567890", logoDataUrl: logo }, reg.token));
  assert.equal(saved.tenant.setupCompleted, true);
  assert.equal(saved.tenant.currency, "EUR");
  assert.equal(saved.tenant.logoDataUrl, logo);
  assert.deepEqual(saved.data, { customers: [], vehicles: [], serviceRecords: [] });
  assert.equal(ok(rt.post("bootstrap", {}, reg.token)).tenant.name, PROFILE.name);
});

test("aynı e-posta ile ikinci kayıt engellenir; kayıt kapalıysa yeni işletme açılamaz", () => {
  const rt = newRuntime();
  registerTenant(rt, { name: "A Oto", email: "a@ornek.com" });
  fails(rt.post("register", { businessName: "Kopya", displayName: "X Y", email: "A@ornek.com", password: PASSWORD }), "CONFLICT");
  rt.properties.set("SIGNUP_MODE", "closed");
  fails(rt.post("register", { businessName: "Kapalı", displayName: "X Y", email: "z@ornek.com", password: PASSWORD }), "FORBIDDEN");
});

test("zayıf şifre reddedilir", () => {
  const rt = newRuntime();
  fails(rt.post("register", { businessName: "Servis", displayName: "X Y", email: "x@ornek.com", password: "kisa1" }), "VALIDATION");
  fails(rt.post("register", { businessName: "Servis", displayName: "X Y", email: "x@ornek.com", password: "sadeceharf" }), "VALIDATION");
});

test("şifre özeti PBKDF2-HMAC-SHA256 standardıyla birebir aynıdır ve düz şifre saklanmaz", () => {
  const rt = newRuntime();
  const ours = rt.run("hashPassword_", "Şifre-123", "tuz-degeri", 1000);
  const reference = crypto.pbkdf2Sync(Buffer.from("Şifre-123"), Buffer.from("tuz-degeri"), 1000, 32, "sha256").toString("base64");
  assert.equal(ours, reference);

  registerTenant(rt, { name: "A Oto", email: "a@ornek.com" });
  const user = sheetRows(rt, "Users")[0];
  assert.ok(!JSON.stringify(user).includes(PASSWORD));
  const token = ok(rt.post("login", { email: "a@ornek.com", password: PASSWORD })).token;
  assert.ok(!JSON.stringify(sheetRows(rt, "Sessions")).includes(token), "oturum anahtarı düz metin saklanmamalı");
});

test("hatalı girişler sonrası hesap geçici olarak kilitlenir", () => {
  const rt = newRuntime();
  registerTenant(rt, { name: "A Oto", email: "a@ornek.com" });
  for (let i = 0; i < 5; i++) fails(rt.post("login", { email: "a@ornek.com", password: "Yanlis1234" }), "INVALID_CREDENTIALS");
  fails(rt.post("login", { email: "a@ornek.com", password: PASSWORD }), "RATE_LIMITED");
  fails(rt.post("login", { email: "yok@ornek.com", password: PASSWORD }), "INVALID_CREDENTIALS");
});

test("çalışan daveti: e-posta eşleşmeli, kabul edilince yalnızca o işletmeye erişir", () => {
  const rt = newRuntime();
  const a = registerTenant(rt, { name: "A Oto", email: "a@ornek.com" });
  const b = registerTenant(rt, { name: "B Oto", email: "b@ornek.com" });
  addCustomer(rt, a.token);
  addCustomer(rt, b.token, { firstName: "Gizli" });

  const { code } = ok(rt.post("createInvite", { email: "usta@ornek.com", role: "staff" }, a.token));
  assert.match(code, /^[0-9A-F]{4}(-[0-9A-F]{4}){5}$/);
  assert.ok(!JSON.stringify(sheetRows(rt, "Invitations")).includes(code.replace(/-/g, "")), "davet kodu düz metin saklanmamalı");

  fails(rt.post("acceptInvite", { code, email: "baska@ornek.com", displayName: "Usta", password: PASSWORD }), "INVALID_INVITE");
  fails(rt.post("acceptInvite", { code: "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF", email: "usta@ornek.com", displayName: "Usta", password: PASSWORD }), "INVALID_INVITE");
  const staff = ok(rt.post("acceptInvite", { code, email: "usta@ornek.com", displayName: "Usta Mehmet", password: PASSWORD }));
  assert.equal(staff.role, "staff");
  assert.equal(staff.tenant.id, a.tenantId);
  assert.equal(staff.data.customers.length, 1);
  assert.equal(staff.data.customers[0].firstName, "Ahmet");

  // Davet kodu ikinci kez kullanılamaz
  fails(rt.post("acceptInvite", { code, email: "usta@ornek.com", displayName: "Usta", password: PASSWORD }), "INVALID_INVITE");
});

test("çalışan rolü: kayıt ekleyip düzenleyebilir; silme, ayar ve kullanıcı yönetimi yapamaz", () => {
  const rt = newRuntime();
  const a = registerTenant(rt, { name: "A Oto", email: "a@ornek.com" });
  const { code } = ok(rt.post("createInvite", { email: "usta@ornek.com", role: "staff" }, a.token));
  const staff = ok(rt.post("acceptInvite", { code, email: "usta@ornek.com", displayName: "Usta", password: PASSWORD }));

  const cust = addCustomer(rt, staff.token);
  const veh = addVehicle(rt, staff.token, cust);
  const srv = addService(rt, staff.token, veh);
  ok(rt.post("updateServiceRecord", { id: srv, paymentStatus: "Nakit Ödendi" }, staff.token));

  fails(rt.post("deleteServiceRecord", { id: srv }, staff.token), "FORBIDDEN");
  fails(rt.post("deleteCustomer", { id: cust }, staff.token), "FORBIDDEN");
  fails(rt.post("saveBusinessProfile", { name: "Ele Geçir" }, staff.token), "FORBIDDEN");
  fails(rt.post("createInvite", { email: "x@ornek.com", role: "staff" }, staff.token), "FORBIDDEN");
  fails(rt.post("listMembers", {}, staff.token), "FORBIDDEN");
  fails(rt.post("closeTenant", { password: PASSWORD, confirmName: "A Oto" }, staff.token), "FORBIDDEN");
});

test("işletmeden çıkarılan kullanıcının oturumu anında geçersiz olur", () => {
  const rt = newRuntime();
  const a = registerTenant(rt, { name: "A Oto", email: "a@ornek.com" });
  const { code } = ok(rt.post("createInvite", { email: "usta@ornek.com", role: "staff" }, a.token));
  const staff = ok(rt.post("acceptInvite", { code, email: "usta@ornek.com", displayName: "Usta", password: PASSWORD }));
  const members = ok(rt.post("listMembers", {}, a.token)).members;
  const target = members.find((m) => m.email === "usta@ornek.com");
  ok(rt.post("removeMember", { membershipId: target.membershipId }, a.token));
  fails(rt.post("getData", {}, staff.token), "AUTH_REQUIRED");
  fails(rt.post("login", { email: "usta@ornek.com", password: PASSWORD }), "FORBIDDEN");
});

test("işletme sahibi kendini çıkaramaz; başka işletmenin üyeliği yönetilemez", () => {
  const rt = newRuntime();
  const a = registerTenant(rt, { name: "A Oto", email: "a@ornek.com" });
  const b = registerTenant(rt, { name: "B Oto", email: "b@ornek.com" });
  const ownerA = ok(rt.post("listMembers", {}, a.token)).members[0];
  fails(rt.post("removeMember", { membershipId: ownerA.membershipId }, a.token), "FORBIDDEN");
  fails(rt.post("removeMember", { membershipId: ownerA.membershipId }, b.token), "NOT_FOUND");
  fails(rt.post("updateMemberRole", { membershipId: ownerA.membershipId, role: "staff" }, b.token), "NOT_FOUND");
});

test("plan kullanıcı sınırı davetlerde uygulanır", () => {
  const rt = newRuntime();
  const a = registerTenant(rt, { name: "A Oto", email: "a@ornek.com" }); // deneme planı: 3 kullanıcı
  ok(rt.post("createInvite", { email: "u1@ornek.com", role: "staff" }, a.token));
  ok(rt.post("createInvite", { email: "u2@ornek.com", role: "staff" }, a.token));
  fails(rt.post("createInvite", { email: "u3@ornek.com", role: "staff" }, a.token), "PLAN_LIMIT");
});

test("birden fazla işletmeye üye kullanıcı giriş yaparken işletme seçer", () => {
  const rt = newRuntime();
  const a = registerTenant(rt, { name: "A Oto", email: "a@ornek.com" });
  const b = registerTenant(rt, { name: "B Oto", email: "b@ornek.com" });
  const { code } = ok(rt.post("createInvite", { email: "a@ornek.com", role: "staff" }, b.token));
  fails(rt.post("acceptInvite", { code, email: "a@ornek.com", password: "Yanlis1234" }), "INVALID_CREDENTIALS");
  ok(rt.post("acceptInvite", { code, email: "a@ornek.com", password: PASSWORD }));

  const choice = ok(rt.post("login", { email: "a@ornek.com", password: PASSWORD }));
  assert.equal(choice.needsTenantChoice, true);
  assert.equal(choice.token, undefined);
  assert.deepEqual(choice.tenants.map((t) => t.id).sort(), [a.tenantId, b.tenantId].sort());

  const inB = ok(rt.post("login", { email: "a@ornek.com", password: PASSWORD, tenantId: b.tenantId }));
  assert.equal(inB.tenant.id, b.tenantId);
  assert.equal(inB.role, "staff");
  const switched = ok(rt.post("switchTenant", { tenantId: a.tenantId }, inB.token));
  assert.equal(switched.role, "owner");
  fails(rt.post("getData", {}, inB.token), "AUTH_REQUIRED");
});

test("servis tutarı sunucuda usta ücretlerinden hesaplanır, kısmi ödeme sınırlandırılır", () => {
  const rt = newRuntime();
  const a = registerTenant(rt, { name: "A Oto", email: "a@ornek.com" });
  const veh = addVehicle(rt, a.token, addCustomer(rt, a.token));
  const id = addService(rt, a.token, veh, { totalAmount: 1, paymentStatus: "Kısmi Ödendi", paidAmount: 999999 });
  const rec = ok(rt.post("getData", {}, a.token)).serviceRecords.find((r) => r.id === id);
  assert.equal(rec.totalAmount, 2000);
  assert.equal(rec.paidAmount, 2000);
  assert.equal(rec.remainingAmount, 0);
  fails(rt.post("addServiceRecord", { vehicleId: veh, entryKm: 5, recordDate: "2026-10-01", mechanicFee: -10 }, a.token), "VALIDATION");
  fails(rt.post("addServiceRecord", { vehicleId: veh, entryKm: 5, recordDate: "2026-10-01", paymentStatus: "Bedava" }, a.token), "VALIDATION");
  fails(rt.post("addServiceRecord", { vehicleId: veh, entryKm: 5, recordDate: "2026-02-30" }, a.token), "VALIDATION");
});

test("hesap kapatma: oturumlar düşer, saklama süresi sonunda yalnızca o işletmenin verisi silinir", () => {
  const rt = newRuntime();
  const a = registerTenant(rt, { name: "A Oto", email: "a@ornek.com" });
  const b = registerTenant(rt, { name: "B Oto", email: "b@ornek.com" });
  addService(rt, a.token, addVehicle(rt, a.token, addCustomer(rt, a.token)));
  addService(rt, b.token, addVehicle(rt, b.token, addCustomer(rt, b.token)));

  const exported = ok(rt.post("exportTenantData", {}, a.token));
  assert.equal(exported.data.customers.length, 1);

  fails(rt.post("closeTenant", { password: PASSWORD, confirmName: "Yanlış Ad" }, a.token), "VALIDATION");
  fails(rt.post("closeTenant", { password: "Yanlis1234", confirmName: "A Oto" }, a.token), "INVALID_CREDENTIALS");
  const closed = ok(rt.post("closeTenant", { password: PASSWORD, confirmName: "A Oto" }, a.token));
  assert.ok(closed.deleteAfter);
  fails(rt.post("getData", {}, a.token), "AUTH_REQUIRED");
  fails(rt.post("login", { email: "a@ornek.com", password: PASSWORD }), "FORBIDDEN");

  // Saklama süresi dolmadan bakım hiçbir şey silmez
  assert.deepEqual(rt.run("dailyMaintenance").purgedTenants.length, 0);
  assert.equal(sheetRows(rt, "Customers").filter((r) => r.tenantId === a.tenantId).length, 1);

  // Süreyi geçmişe çek ve bakımı çalıştır
  const tenants = rt.spreadsheet.getSheetByName("Tenants");
  const idx = tenants.data[0].indexOf("deleteAfter");
  tenants.data.find((row) => row[0] === a.tenantId)[idx] = "2000-01-01T00:00:00.000Z";
  assert.deepEqual([...rt.run("dailyMaintenance").purgedTenants], [a.tenantId]);

  for (const name of ["Customers", "Vehicles", "ServiceRecords"]) {
    assert.equal(sheetRows(rt, name).filter((r) => r.tenantId === a.tenantId).length, 0, `${name}: A verisi kalmamalı`);
    assert.equal(sheetRows(rt, name).filter((r) => r.tenantId === b.tenantId).length, 1, `${name}: B verisi korunmalı`);
  }
  const purged = sheetRows(rt, "Tenants").find((r) => r.id === a.tenantId);
  assert.equal(purged.status, "purged");
  assert.equal(purged.name, "");
  assert.equal(ok(rt.post("getData", {}, b.token)).serviceRecords.length, 1);
});

test("beklenmeyen hatalarda istek içeriği loglanmaz", () => {
  const rt = newRuntime();
  const a = registerTenant(rt, { name: "A Oto", email: "a@ornek.com" });
  rt.spreadsheet.sheets = rt.spreadsheet.sheets.filter((s) => s.name !== "Customers"); // altyapı hatası taklidi
  const res = fails(rt.post("addCustomer", { firstName: "GizliAd", lastName: "GizliSoyad", phone: "05329998877" }, a.token), "INTERNAL");
  assert.doesNotMatch(res.error, /Gizli|0532/);
  const logText = JSON.stringify(rt.logs);
  assert.doesNotMatch(logText, /GizliAd|05329998877|Guvenli123/);
  assert.match(logText, /islem=addCustomer/);
});
