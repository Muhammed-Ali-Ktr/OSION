"use strict";

const assert = require("node:assert/strict");
const { createGasRuntime } = require("../tools/gas-runtime");

const PASSWORD = "Guvenli123";

function ok(response, message) {
  assert.equal(response.success, true, `${message || "İstek başarısız"}: ${response.code} ${response.error}`);
  return response.data;
}

function fails(response, code) {
  assert.equal(response.success, false, "İsteğin başarısız olması bekleniyordu");
  if (code) assert.equal(response.code, code, `Beklenen hata kodu ${code}, gelen ${response.code}: ${response.error}`);
  return response;
}

const PROFILE = {
  name: "Usta Oto Servis",
  phone: "0212 555 44 33",
  address: "Sanayi Sitesi 4. Blok No: 12, İstanbul",
  currency: "TRY",
  locale: "tr-TR",
  dateFormat: "DD.MM.YYYY",
  legalName: "",
  taxOffice: "",
  taxNumber: ""
};

/** Yeni işletme kaydeder ve (isteğe bağlı) kurulumunu tamamlar. */
function registerTenant(rt, { name, email, setup = true }) {
  const reg = ok(rt.post("register", { businessName: name, displayName: `${name} Sahibi`, email, password: PASSWORD }), "Kayıt");
  if (setup) ok(rt.post("saveBusinessProfile", { ...PROFILE, name }, reg.token), "Kurulum");
  return { token: reg.token, tenantId: reg.tenant.id, userId: reg.user.id };
}

function addCustomer(rt, token, extra = {}) {
  return ok(rt.post("addCustomer", { firstName: "Ahmet", lastName: "Yılmaz", phone: "05321112233", ...extra }, token), "Müşteri ekleme").id;
}

function addVehicle(rt, token, customerId, extra = {}) {
  return ok(rt.post("addVehicle", { customerId, brand: "Ford", model: "Focus", plate: "34 abc 123", entryDate: "2026-10-01", ...extra }, token), "Araç ekleme").id;
}

function addService(rt, token, vehicleId, extra = {}) {
  return ok(rt.post("addServiceRecord", {
    vehicleId, entryKm: "120500", recordDate: "2026-10-02", mechanicFee: 1500, electricianFee: 500,
    paymentStatus: "Ödenmedi", ...extra
  }, token), "Servis ekleme").id;
}

function sheetRows(rt, name) {
  const sheet = rt.spreadsheet.getSheetByName(name);
  const [headers, ...rows] = sheet.data;
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] === undefined ? "" : r[i]])));
}

function newRuntime(properties) {
  return createGasRuntime({ properties });
}

module.exports = { PASSWORD, PROFILE, ok, fails, registerTenant, addCustomer, addVehicle, addService, sheetRows, newRuntime };
