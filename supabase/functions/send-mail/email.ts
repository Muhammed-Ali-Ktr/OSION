// E-posta içerikleri (servis fişi, müşteri mesajı, test). Dış bağımlılığı yoktur;
// hem Edge Function'da (Deno) hem testlerde (Node) kullanılır.

export interface Prepared {
  kind: "test" | "receipt" | "message";
  to: string;
  subject: string | null;
  message: string | null;
  tenant: { name: string; phone: string; address: string; currency: string; locale: string; dateFormat: string };
  customer: { firstName: string; lastName: string } | null;
  vehicle: { brand: string; model: string; plate: string } | null;
  record: {
    entry_km: number; record_date: string; fees: Record<string, number>; notes: Record<string, string>;
    general_summary: string; payment_status: string; total_amount: number; paid_amount: number; remaining_amount: number;
  } | null;
}

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

// app.js içindeki TECHNICIANS listesiyle aynı sıra ve adlar.
const TECHNICIAN_LABELS: [string, string][] = [
  ["mechanic", "Tamirci İşçiliği"], ["electrician", "Elektrikçi"], ["boyaci", "Boyacı"], ["cikmaci", "Çıkma Parçacı"],
  ["egzozcu", "Egzozcu"], ["frenci", "Frenci"], ["kapakci", "Kapakçı"], ["kaportaci", "Kaportacı"],
  ["kurtarici", "Kurtarıcı"], ["parcaci", "Parçacı"], ["pompaci", "Pompacı"], ["tornaci", "Tornacı"],
  ["turbocu", "Turbocu"], ["tupcu", "Tüpçü"], ["yagci", "Yağcı"], ["yikamaci", "Yıkamacı"]
];

const PAID_STATUSES = ["Nakit Ödendi", "Havale Yapıldı", "Kartla Ödendi", "Ödendi"];

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Konu satırına satır sonu girmesi başlık enjeksiyonuna yol açabileceği için temizlenir.
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function money(value: number, t: Prepared["tenant"]): string {
  try {
    return new Intl.NumberFormat(t.locale || "tr-TR", { style: "currency", currency: t.currency || "TRY" }).format(Number(value) || 0);
  } catch {
    return `${(Number(value) || 0).toFixed(2)} ${t.currency}`;
  }
}

function date(value: string, format: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "");
  if (!m) return value || "";
  return (format || "DD.MM.YYYY").replace("YYYY", m[1]).replace("MM", m[2]).replace("DD", m[3]);
}

function layout(t: Prepared["tenant"], title: string, body: string): string {
  const contact = [t.phone, t.address].filter(Boolean).map(escapeHtml).join(" · ");
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e1e4e8;border-radius:8px">
<tr><td style="padding:20px 24px;border-bottom:1px solid #e1e4e8">
<div style="font-size:18px;font-weight:bold">${escapeHtml(t.name)}</div>
${contact ? `<div style="font-size:13px;color:#616e7c;margin-top:4px">${contact}</div>` : ""}
</td></tr>
<tr><td style="padding:20px 24px">
<h1 style="font-size:17px;margin:0 0 16px">${escapeHtml(title)}</h1>
${body}
</td></tr>
</table>
<p style="text-align:center;font-size:11px;color:#9aa5b1;margin-top:16px">Bu e-posta ${escapeHtml(t.name)} tarafından OSION servis takip sistemi ile gönderilmiştir.</p>
</body></html>`;
}

function row(label: string, value: string, bold = false): string {
  return `<tr><td style="padding:6px 0;color:#616e7c;font-size:14px">${escapeHtml(label)}</td>
<td style="padding:6px 0;text-align:right;font-size:14px${bold ? ";font-weight:bold" : ""}">${escapeHtml(value)}</td></tr>`;
}

function renderReceipt(p: Prepared): Rendered {
  const t = p.tenant;
  const r = p.record!;
  const v = p.vehicle!;
  const c = p.customer!;
  const items = TECHNICIAN_LABELS
    .filter(([k]) => Number(r.fees?.[k]) > 0 || (r.notes?.[k] || "").trim())
    .map(([k, label]) => ({ label, fee: Number(r.fees?.[k]) || 0, note: (r.notes?.[k] || "").trim() }));
  const itemsHtml = items.map((i) => `<tr><td style="padding:8px 0;border-bottom:1px solid #f0f2f4;font-size:14px">
<strong>${escapeHtml(i.label)}</strong>${i.note ? `<div style="color:#616e7c;font-size:13px;margin-top:2px">${escapeHtml(i.note)}</div>` : ""}</td>
<td style="padding:8px 0;border-bottom:1px solid #f0f2f4;text-align:right;font-size:14px;white-space:nowrap">${escapeHtml(money(i.fee, t))}</td></tr>`).join("");

  const paid = PAID_STATUSES.includes(r.payment_status) ? r.total_amount : r.payment_status === "Kısmi Ödendi" ? r.paid_amount : 0;
  const remaining = Math.max(0, r.total_amount - paid);
  const vehicleText = `${v.plate} — ${v.brand} ${v.model}`;
  const recordDate = date(r.record_date, t.dateFormat);

  const body = `<p style="font-size:14px;margin:0 0 16px">Sayın ${escapeHtml(`${c.firstName} ${c.lastName}`)}, aracınıza yapılan işlemlerin özeti aşağıdadır.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${row("Araç", vehicleText)}${row("Servis tarihi", recordDate)}${row("Giriş kilometresi", `${Number(r.entry_km).toLocaleString(t.locale || "tr-TR")} km`)}
</table>
${items.length ? `<h2 style="font-size:15px;margin:20px 0 4px">Yapılan işlemler</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml}</table>` : ""}
${r.general_summary ? `<h2 style="font-size:15px;margin:20px 0 4px">Genel açıklama</h2><p style="font-size:14px;margin:0;white-space:pre-line">${escapeHtml(r.general_summary)}</p>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:2px solid #1f2933">
${row("Toplam", money(r.total_amount, t), true)}${row("Ödenen", money(paid, t))}${row("Kalan", money(remaining, t), remaining > 0)}${row("Ödeme durumu", r.payment_status)}
</table>`;

  const textLines = [
    t.name, [t.phone, t.address].filter(Boolean).join(" · "), "",
    `Sayın ${c.firstName} ${c.lastName}, aracınıza yapılan işlemlerin özeti:`, "",
    `Araç: ${vehicleText}`, `Servis tarihi: ${recordDate}`, `Giriş kilometresi: ${r.entry_km} km`, "",
    ...items.map((i) => `- ${i.label}: ${money(i.fee, t)}${i.note ? ` (${i.note})` : ""}`),
    ...(r.general_summary ? ["", `Açıklama: ${r.general_summary}`] : []), "",
    `Toplam: ${money(r.total_amount, t)}`, `Ödenen: ${money(paid, t)}`, `Kalan: ${money(remaining, t)}`, `Ödeme durumu: ${r.payment_status}`
  ];
  return {
    subject: oneLine(`Servis fişi — ${v.plate} (${recordDate}) · ${t.name}`),
    html: layout(t, "Servis Fişi", body),
    text: textLines.join("\n")
  };
}

function renderMessage(p: Prepared): Rendered {
  const c = p.customer!;
  const message = p.message || "";
  const body = `<p style="font-size:14px;margin:0 0 12px">Sayın ${escapeHtml(`${c.firstName} ${c.lastName}`)},</p>
<p style="font-size:14px;margin:0;white-space:pre-line">${escapeHtml(message)}</p>`;
  return {
    subject: oneLine(p.subject || ""),
    html: layout(p.tenant, oneLine(p.subject || ""), body),
    text: `Sayın ${c.firstName} ${c.lastName},\n\n${message}\n\n${p.tenant.name}`
  };
}

function renderTest(p: Prepared): Rendered {
  const body = `<p style="font-size:14px;margin:0">E-posta hesabınız OSION'a başarıyla bağlandı. Artık araç sahiplerine servis fişi ve mesajları bu adresten gönderebilirsiniz.</p>`;
  return {
    subject: oneLine(`OSION e-posta bağlantısı başarılı · ${p.tenant.name}`),
    html: layout(p.tenant, "E-posta bağlantısı başarılı", body),
    text: "E-posta hesabınız OSION'a başarıyla bağlandı. Artık araç sahiplerine servis fişi ve mesajları bu adresten gönderebilirsiniz."
  };
}

export function renderEmail(p: Prepared): Rendered {
  if (p.kind === "receipt") return renderReceipt(p);
  if (p.kind === "message") return renderMessage(p);
  return renderTest(p);
}

/** SMTP hatasını işletme sahibinin anlayacağı Türkçe mesaja çevirir. */
export function smtpErrorMessage(err: { code?: string; responseCode?: number; message?: string }): string {
  const code = err?.code || "";
  const msg = String(err?.message || "");
  if (code === "EAUTH" || err?.responseCode === 535 || /auth|credentials|password/i.test(msg)) {
    return "E-posta adresi veya uygulama şifresi hatalı. Normal şifreniz değil, e-posta sağlayıcınızdan aldığınız uygulama şifresini girin.";
  }
  if (["ETIMEDOUT", "ECONNECTION", "ESOCKET", "ECONNREFUSED", "EDNS"].includes(code) || /timeout|connect/i.test(msg)) {
    return "E-posta sunucusuna bağlanılamadı. Sağlayıcı ve sunucu bilgilerini kontrol edin.";
  }
  if (code === "EENVELOPE" || err?.responseCode === 550 || err?.responseCode === 553) {
    return "Alıcı adresi e-posta sunucusu tarafından reddedildi. Müşterinin e-posta adresini kontrol edin.";
  }
  if (err?.responseCode === 454 || err?.responseCode === 421 || /limit|quota/i.test(msg)) {
    return "E-posta sağlayıcınız şu anda gönderime izin vermiyor (gönderim sınırı). Bir süre sonra tekrar deneyin.";
  }
  return "E-posta gönderilemedi. Lütfen tekrar deneyin.";
}
