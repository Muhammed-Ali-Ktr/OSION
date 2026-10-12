"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGasRuntime, FakeSpreadsheet } = require("../tools/gas-runtime");
const { PASSWORD, PROFILE, ok, fails, registerTenant, sheetRows } = require("./helpers");
const { seedLegacySpreadsheet } = require("../tools/legacy-seed");

function legacyRuntime() {
  const spreadsheet = new FakeSpreadsheet("Oto Servis Veritabanı");
  seedLegacySpreadsheet(spreadsheet);
  return createGasRuntime({ spreadsheet, properties: { LEGACY_TENANT_NAME: "Eski Servis" } });
}

test("yeni sürüm yüklendiğinde eski satırlar silinmez ve kimseye görünmez (geçiş öncesi güvenli varsayılan)", () => {
  const rt = legacyRuntime();
  const before = sheetRows(rt, "Customers").length;
  const stranger = registerTenant(rt, { name: "Yabancı", email: "x@ornek.com" });
  assert.equal(sheetRows(rt, "Customers").length, before + 0);
  const data = ok(rt.post("getData", {}, stranger.token));
  assert.equal(data.customers.length, 0);
  assert.equal(data.serviceRecords.length, 0);
});

test("geçiş: veriler yedeklenir, varsayılan işletmeye bağlanır, tekrar çalıştırmak bir şey bozmaz", () => {
  const rt = legacyRuntime();
  const counts = Object.fromEntries(["Customers", "Vehicles", "ServiceRecords"].map((n) => [n, sheetRows(rt, n).length]));
  const legacyHeaders = rt.spreadsheet.getSheetByName("ServiceRecords").data[0].slice();
  const originalFirstRow = rt.spreadsheet.getSheetByName("ServiceRecords").data[1].slice();

  const first = rt.run("migrateLegacyData");
  assert.equal(first.migrated, true);
  assert.equal(first.assigned.Customers, counts.Customers);
  assert.equal(first.assigned.ServiceRecords, counts.ServiceRecords);
  assert.equal(rt.spreadsheet.copies.length, 1, "geçiş öncesi tam yedek alınmalı");
  assert.equal(rt.spreadsheet.copies[0].getSheetByName("Customers").data.length, counts.Customers + 1);

  // Mevcut sütunlar yerinde kalır, değerler değişmez; yeni sütunlar sona eklenir
  const sheet = rt.spreadsheet.getSheetByName("ServiceRecords");
  assert.deepEqual(sheet.data[0].slice(0, legacyHeaders.length), legacyHeaders);
  assert.deepEqual(sheet.data[1].slice(0, originalFirstRow.length), originalFirstRow);

  const tenantId = first.tenantId;
  for (const name of Object.keys(counts)) {
    const rows = sheetRows(rt, name);
    assert.equal(rows.length, counts[name], `${name} satır sayısı korunmalı`);
    assert.ok(rows.every((r) => r.tenantId === tenantId), `${name} tüm satırlar varsayılan işletmeye bağlanmalı`);
  }

  const claimCode = rt.properties.get(`OWNER_CLAIM_${tenantId}`);
  assert.ok(claimCode, "sahip davet kodu Script Properties'e yazılmalı");
  assert.doesNotMatch(JSON.stringify(rt.logs), new RegExp(claimCode), "davet kodu loglanmamalı");

  const second = rt.run("migrateLegacyData");
  assert.equal(second.tenantId, tenantId);
  assert.equal(second.assigned.Customers, 0);
  assert.equal(second.ownerClaimCreated, false);
  assert.equal(rt.properties.get(`OWNER_CLAIM_${tenantId}`), claimCode, "geçerli kod yeniden üretilmemeli");
  assert.equal(rt.spreadsheet.copies.length, 1, "yedek bir kez alınmalı");
  assert.equal(sheetRows(rt, "Tenants").length, 1);
});

test("ilk işletme sahibi davet koduyla hesabını açar, kurulumdan sonra eski verilerini görür", () => {
  const rt = legacyRuntime();
  const { tenantId } = rt.run("migrateLegacyData");
  const code = rt.properties.get(`OWNER_CLAIM_${tenantId}`);
  const other = registerTenant(rt, { name: "Başka Servis", email: "baska@ornek.com" });

  const owner = ok(rt.post("acceptInvite", { code, email: "sahip@ornek.com", displayName: "Servis Sahibi", password: PASSWORD }));
  assert.equal(owner.role, "owner");
  assert.equal(owner.tenant.name, "Eski Servis");
  assert.equal(owner.tenant.setupCompleted, false);
  assert.equal(rt.properties.has(`OWNER_CLAIM_${tenantId}`), false, "kullanılan kod silinmeli");
  fails(rt.post("getData", {}, owner.token), "SETUP_REQUIRED");

  const saved = ok(rt.post("saveBusinessProfile", { ...PROFILE, name: "Eski Servis" }, owner.token));
  const data = saved.data;
  assert.equal(data.customers.length, 3);
  assert.equal(data.vehicles.length, 4);
  assert.equal(data.serviceRecords.length, 4);
  // Telefon baştaki 0 korunarak, tarihler saat dilimi kaymadan döner
  assert.ok(data.customers.every((c) => /^0\d{10}$/.test(c.phone)));
  assert.equal(data.serviceRecords.find((r) => r.id === "SRV-001").recordDate, "2026-05-12");

  // Eski kayıt düzenlenebilir ve diğer işletme göremez
  ok(rt.post("updateServiceRecord", { id: "SRV-002", paymentStatus: "Nakit Ödendi" }, owner.token));
  assert.equal(ok(rt.post("getData", {}, other.token)).serviceRecords.length, 0);
  fails(rt.post("updateServiceRecord", { id: "SRV-001", paymentStatus: "Ödenmedi" }, other.token), "NOT_FOUND");

  // İkinci kez sahip kodu üretilmez (artık sahibi var)
  assert.equal(rt.run("migrateLegacyData").ownerClaimCreated, false);
});

test("taşınacak veri yoksa geçiş hiçbir şey oluşturmaz", () => {
  const rt = createGasRuntime();
  const res = rt.run("migrateLegacyData");
  assert.equal(res.migrated, false);
  assert.equal(rt.spreadsheet.copies.length, 0);
});
