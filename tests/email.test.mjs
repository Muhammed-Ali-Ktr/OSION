// send-mail Edge Function'ının e-posta içeriklerini doğrular. Çalıştırma: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEmail, smtpErrorMessage } from "../supabase/functions/send-mail/email.ts";

const tenant = { name: "Yıldız <Oto>", phone: "05321112233", address: "Sanayi Sitesi", currency: "TRY", locale: "tr-TR", dateFormat: "DD.MM.YYYY" };
const base = {
  to: "ahmet@ornek.com",
  subject: null,
  message: null,
  tenant,
  customer: { firstName: "Ahmet<script>", lastName: "Yılmaz" },
  vehicle: { brand: "Fiat", model: "Egea", plate: "34ABC123" },
  record: {
    entry_km: 120000, record_date: "2026-10-13",
    fees: { mechanic: 1500.5, frenci: 500, boyaci: 0 }, notes: { mechanic: "Yağ & filtre", boyaci: "" },
    general_summary: "Periyodik bakım", payment_status: "Kısmi Ödendi",
    total_amount: 2000.5, paid_amount: 1000, remaining_amount: 1000.5
  }
};

test("servis fişi: kalemler, toplamlar ve kaçışlama", () => {
  const e = renderEmail({ ...base, kind: "receipt" });
  assert.match(e.subject, /^Servis fişi — 34ABC123 \(13\.10\.2026\)/);
  assert.ok(e.html.includes("Tamirci İşçiliği") && e.html.includes("Frenci"));
  assert.ok(!e.html.includes("Boyacı"), "ücreti ve notu olmayan kalem gösterilmez");
  assert.ok(e.html.includes("Yağ &amp; filtre"));
  assert.ok(!e.html.includes("<script>") && e.html.includes("Ahmet&lt;script&gt;"), "müşteri adı kaçışlanır");
  assert.ok(e.html.includes("Yıldız &lt;Oto&gt;"), "işletme adı kaçışlanır");
  assert.ok(e.text.includes("Ödenen: ₺1.000,00") && e.text.includes("Kalan: ₺1.000,50"), e.text);
});

test("servis fişi: tam ödenmiş kayıtta kalan sıfır", () => {
  const e = renderEmail({ ...base, kind: "receipt", record: { ...base.record, payment_status: "Nakit Ödendi", paid_amount: 0, remaining_amount: 0 } });
  assert.ok(e.text.includes("Ödenen: ₺2.000,50") && e.text.includes("Kalan: ₺0,00"), e.text);
});

test("mesaj: konu satırındaki satır sonları temizlenir", () => {
  const e = renderEmail({ ...base, kind: "message", subject: "Aracınız hazır\r\nBcc: kotu@ornek.com", message: "Merhaba,\n<b>teslim</b> alabilirsiniz." });
  assert.equal(e.subject, "Aracınız hazır Bcc: kotu@ornek.com");
  assert.ok(e.html.includes("&lt;b&gt;teslim&lt;/b&gt;"));
});

test("SMTP hata mesajları", () => {
  assert.match(smtpErrorMessage({ code: "EAUTH", responseCode: 535 }), /uygulama şifresi/);
  assert.match(smtpErrorMessage({ code: "ETIMEDOUT" }), /bağlanılamadı/);
  assert.match(smtpErrorMessage({ responseCode: 550 }), /reddedildi/);
});
