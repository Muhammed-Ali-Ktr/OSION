/**
 * Eski (v1, tek işletmeli) E-Tablo yapısını örnek verilerle oluşturur.
 * Sütun başlıkları ve satırlar, eski code.gs'in yazdığı biçimin aynısıdır (tenantId sütunu yoktur).
 * Geçiş testleri ve `npm run dev:legacy` tarafından kullanılır.
 */
"use strict";

const TECH = ["mechanic", "electrician", "boyaci", "cikmaci", "egzozcu", "frenci", "kapakci", "kaportaci",
  "kurtarici", "parcaci", "pompaci", "tornaci", "turbocu", "tupcu", "yagci", "yikamaci"];

const LEGACY_HEADERS = {
  Customers: ["id", "firstName", "lastName", "phone", "reference", "notes", "createdAt"],
  Vehicles: ["id", "customerId", "brand", "model", "plate", "chassisNo", "entryDate", "notes", "createdAt"],
  ServiceRecords: ["id", "vehicleId", "entryKm", "recordDate"]
    .concat(TECH.flatMap((t) => [`${t}Fee`, `${t}Note`]))
    .concat(["generalSummary", "paymentStatus", "totalAmount", "paidAmount", "remainingAmount", "createdAt"])
};

const CUSTOMERS = [
  { id: "CST-B981C2", firstName: "Ahmet", lastName: "Yılmaz", phone: "05321112233", reference: "Mehmet Usta", notes: "Sürekli müşterimizdir." },
  // Eski sürümde metin biçimi uygulanmadan yazılmış, baştaki 0'ı düşmüş telefon örneği
  { id: "CST-A721D5", firstName: "Mustafa", lastName: "Kaya", phone: 5442223344, reference: "İnternet Reklamı", notes: "" },
  { id: "CST-E449A8", firstName: "Ayşe", lastName: "Demir", phone: "05053334455", reference: "", notes: "Firma araçları getiriyor." }
];

const VEHICLES = [
  { id: "VHC-092E11", customerId: "CST-B981C2", brand: "Volkswagen", model: "Golf 1.6 TDI", plate: "34ABC123", chassisNo: "WVWZZZAUZHP112233", entryDate: "2026-06-10", notes: "Periyodik bakım." },
  { id: "VHC-773C99", customerId: "CST-B981C2", brand: "Audi", model: "A4 2.0 TDI", plate: "34XYZ789", chassisNo: "", entryDate: "2026-06-20", notes: "" },
  { id: "VHC-551F02", customerId: "CST-A721D5", brand: "Ford", model: "Focus 1.5 TDCi", plate: "06DEF456", chassisNo: "", entryDate: "2026-06-22", notes: "Klima kontrol." },
  { id: "VHC-881A44", customerId: "CST-E449A8", brand: "Renault", model: "Clio 1.5 dCi", plate: "35GHI901", chassisNo: "", entryDate: "2026-06-25", notes: "" }
];

const SERVICES = [
  { id: "SRV-001", vehicleId: "VHC-092E11", entryKm: 120500, recordDate: "2026-05-12", mechanicFee: 3500, mechanicNote: "120 bin bakımı.", electricianFee: 500, electricianNote: "Hata kodları temizlendi.", generalSummary: "Yağ bakımı.", paymentStatus: "Ödendi", totalAmount: 4000 },
  { id: "SRV-002", vehicleId: "VHC-773C99", entryKm: 85200, recordDate: "2026-06-20", mechanicFee: 4500, mechanicNote: "Fren diskleri.", generalSummary: "Fren sistemi yenilendi.", paymentStatus: "Ödenmedi", totalAmount: 4500 },
  { id: "SRV-003", vehicleId: "VHC-551F02", entryKm: 180000, recordDate: "2026-06-23", mechanicFee: 5000, electricianFee: 1500, generalSummary: "Klima elden geçirildi.", paymentStatus: "Kısmi Ödendi", totalAmount: 6500, paidAmount: 3000, remainingAmount: 3500 },
  { id: "SRV-004", vehicleId: "VHC-881A44", entryKm: 42100, recordDate: "2026-06-25", mechanicFee: 1500, generalSummary: "Karter contası.", paymentStatus: "Ödenmedi", totalAmount: 1500 }
];

function appendObjects(sheet, headers, objects) {
  objects.forEach((obj) => {
    sheet.appendRow(headers.map((h) => {
      if (obj[h] !== undefined) return obj[h];
      if (h === "createdAt") return "2026-06-01T09:00:00.000Z";
      if (h.endsWith("Fee")) return 0;
      return "";
    }));
  });
}

function seedLegacySpreadsheet(spreadsheet) {
  const customers = spreadsheet.insertSheet("Customers");
  customers.appendRow(LEGACY_HEADERS.Customers);
  appendObjects(customers, LEGACY_HEADERS.Customers, CUSTOMERS.filter((c) => typeof c.phone === "number"));
  customers.formats[4] = "@"; // eski kod D:D sütununu sonradan metin biçimine almıştı
  appendObjects(customers, LEGACY_HEADERS.Customers, CUSTOMERS.filter((c) => typeof c.phone !== "number"));

  const vehicles = spreadsheet.insertSheet("Vehicles");
  vehicles.appendRow(LEGACY_HEADERS.Vehicles);
  appendObjects(vehicles, LEGACY_HEADERS.Vehicles, VEHICLES);

  const services = spreadsheet.insertSheet("ServiceRecords");
  services.appendRow(LEGACY_HEADERS.ServiceRecords);
  appendObjects(services, LEGACY_HEADERS.ServiceRecords, SERVICES);
  return spreadsheet;
}

module.exports = { seedLegacySpreadsheet, LEGACY_HEADERS };
