"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ok, fails, registerTenant, addCustomer, addVehicle, addService, sheetRows, newRuntime } = require("./helpers");

function twoTenants() {
  const rt = newRuntime();
  const a = registerTenant(rt, { name: "A Oto", email: "a@ornek.com" });
  const b = registerTenant(rt, { name: "B Oto", email: "b@ornek.com" });
  return { rt, a, b };
}

test("doGet hiçbir işletme verisi döndürmez", () => {
  const { rt, a } = twoTenants();
  addCustomer(rt, a.token);
  const res = rt.get();
  assert.equal(res.success, true);
  assert.equal(res.customers, undefined);
  assert.equal(res.data, undefined);
});

test("oturumsuz veya sahte anahtarla veri okunamaz", () => {
  const { rt, a } = twoTenants();
  addCustomer(rt, a.token);
  fails(rt.post("getData", {}), "AUTH_REQUIRED");
  fails(rt.post("getData", {}, "x".repeat(64)), "AUTH_REQUIRED");
  fails(rt.post("addCustomer", { firstName: "X", lastName: "Y", phone: "05320000000" }), "AUTH_REQUIRED");
});

test("bir işletme diğerinin müşteri, araç ve servis kayıtlarını göremez", () => {
  const { rt, a, b } = twoTenants();
  const cust = addCustomer(rt, a.token);
  const veh = addVehicle(rt, a.token, cust);
  addService(rt, a.token, veh);

  const dataA = ok(rt.post("getData", {}, a.token));
  const dataB = ok(rt.post("getData", {}, b.token));
  assert.equal(dataA.customers.length, 1);
  assert.equal(dataA.vehicles.length, 1);
  assert.equal(dataA.serviceRecords.length, 1);
  assert.deepEqual(dataB, { customers: [], vehicles: [], serviceRecords: [] });
  assert.equal(dataA.customers[0].tenantId, undefined, "tenantId istemciye sızdırılmamalı");
});

test("başka işletmenin kaydı kimliği bilinse bile güncellenemez veya silinemez", () => {
  const { rt, a, b } = twoTenants();
  const cust = addCustomer(rt, a.token);
  const veh = addVehicle(rt, a.token, cust);
  const srv = addService(rt, a.token, veh);

  fails(rt.post("updateCustomer", { id: cust, firstName: "Ele", lastName: "Geçirildi", phone: "05320000000" }, b.token), "NOT_FOUND");
  fails(rt.post("updateVehicle", { id: veh, plate: "06XX00" }, b.token), "NOT_FOUND");
  fails(rt.post("updateServiceRecord", { id: srv, paymentStatus: "Nakit Ödendi" }, b.token), "NOT_FOUND");
  fails(rt.post("deleteServiceRecord", { id: srv }, b.token), "NOT_FOUND");
  fails(rt.post("deleteVehicle", { id: veh }, b.token), "NOT_FOUND");
  fails(rt.post("deleteCustomer", { id: cust }, b.token), "NOT_FOUND");

  const dataA = ok(rt.post("getData", {}, a.token));
  assert.equal(dataA.customers[0].firstName, "Ahmet");
  assert.equal(dataA.vehicles[0].plate, "34ABC123");
  assert.equal(dataA.serviceRecords[0].paymentStatus, "Ödenmedi");
});

test("istemciden gelen tenantId yok sayılır, kayıt oturumdaki işletmeye yazılır", () => {
  const { rt, a, b } = twoTenants();
  const id = addCustomer(rt, b.token, { tenantId: a.tenantId, id: "CST-SAHTE" });
  assert.notEqual(id, "CST-SAHTE");
  const row = sheetRows(rt, "Customers").find((r) => r.id === id);
  assert.equal(row.tenantId, b.tenantId);
  assert.equal(ok(rt.post("getData", {}, a.token)).customers.length, 0);
});

test("başka işletmenin müşterisine araç, aracına servis kaydı bağlanamaz", () => {
  const { rt, a, b } = twoTenants();
  const custA = addCustomer(rt, a.token);
  const vehA = addVehicle(rt, a.token, custA);
  fails(rt.post("addVehicle", { customerId: custA, brand: "Fiat", model: "Egea", plate: "06AB12" }, b.token), "NOT_FOUND");
  fails(rt.post("addServiceRecord", { vehicleId: vehA, entryKm: 10, recordDate: "2026-10-01" }, b.token), "NOT_FOUND");

  // Kendi aracının sahibini başka işletmenin müşterisi yapamaz
  const custB = addCustomer(rt, b.token);
  const vehB = addVehicle(rt, b.token, custB);
  fails(rt.post("updateVehicle", { id: vehB, customerId: custA }, b.token), "NOT_FOUND");
  // Kendi servis kaydını başka işletmenin aracına taşıyamaz
  const srvB = addService(rt, b.token, vehB);
  fails(rt.post("updateServiceRecord", { id: srvB, vehicleId: vehA }, b.token), "NOT_FOUND");
});

test("müşteri silindiğinde yalnızca aynı işletmedeki araçları silinir", () => {
  const { rt, a, b } = twoTenants();
  const custA = addCustomer(rt, a.token);
  addVehicle(rt, a.token, custA);
  const custB = addCustomer(rt, b.token);
  addVehicle(rt, b.token, custB);

  ok(rt.post("deleteCustomer", { id: custA }, a.token));
  assert.equal(ok(rt.post("getData", {}, a.token)).vehicles.length, 0);
  const dataB = ok(rt.post("getData", {}, b.token));
  assert.equal(dataB.customers.length, 1);
  assert.equal(dataB.vehicles.length, 1);
});

test("formül enjeksiyonu: metinler hücreye formül olarak yazılmaz", () => {
  const { rt, a } = twoTenants();
  addCustomer(rt, a.token, { notes: "=JOIN(\",\";Users!B:D)", reference: "+90 tavsiye", firstName: "@kullanici" });
  for (const sheet of rt.spreadsheet.getSheets()) {
    assert.deepEqual(sheet.formulaWrites, [], `${sheet.getName()} sayfasına formül yazıldı`);
  }
  const c = ok(rt.post("getData", {}, a.token)).customers[0];
  assert.equal(c.notes, "=JOIN(\",\";Users!B:D)");
  assert.equal(c.reference, "+90 tavsiye");
});

test("silinmiş bir oturum anahtarı tekrar kullanılamaz", () => {
  const { rt, a } = twoTenants();
  ok(rt.post("logout", {}, a.token));
  fails(rt.post("getData", {}, a.token), "AUTH_REQUIRED");
});

test("süresi dolmuş oturum reddedilir", () => {
  const { rt, a } = twoTenants();
  const sheet = rt.spreadsheet.getSheetByName("Sessions");
  const expIdx = sheet.data[0].indexOf("expiresAt");
  sheet.data.slice(1).forEach((row) => { row[expIdx] = "2000-01-01T00:00:00.000Z"; });
  fails(rt.post("getData", {}, a.token), "AUTH_REQUIRED");
});
