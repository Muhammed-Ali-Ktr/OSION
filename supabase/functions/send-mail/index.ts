// OSION — "send-mail" Edge Function
//
// Araç sahibine servis fişi / mesaj ve işletmeye test e-postasını, işletmenin kendi
// e-posta hesabı (SMTP, port 465) üzerinden gönderir.
//
// Akış:
// 1) Kullanıcının oturumuyla mail_prepare çağrılır: yetki, abonelik, alıcı ve günlük sınır
//    veritabanında denetlenir; deneme mail_log'a yazılır.
// 2) service_role ile işletmenin SMTP bilgileri Vault'tan çözülür.
// 3) E-posta gönderilir, sonuç mail_finish ile kaydedilir.
//
// Dağıtım: npx supabase functions deploy send-mail --project-ref <proje-ref>
// SUPABASE_URL, SUPABASE_ANON_KEY ve SUPABASE_SERVICE_ROLE_KEY Supabase tarafından otomatik sağlanır.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.16";
import { renderEmail, smtpErrorMessage, type Prepared } from "./email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optionalUuid = (v: unknown) => (typeof v === "string" && UUID_RE.test(v) ? v : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Geçersiz istek.", code: "BAD_REQUEST" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "İstek gövdesi okunamadı.", code: "BAD_REQUEST" }, 400);
  }
  const tenantId = optionalUuid(body.tenantId);
  if (!tenantId || !["test", "receipt", "message"].includes(String(body.kind))) {
    return json({ error: "Geçersiz istek.", code: "BAD_REQUEST" }, 400);
  }

  // 1) Kullanıcının kendi yetkisiyle hazırlık (RLS ve rol denetimi veritabanında).
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false }
  });
  const { data: prepared, error: prepError } = await userClient.rpc("mail_prepare", {
    p_tenant: tenantId,
    p_kind: body.kind,
    p_customer: optionalUuid(body.customerId),
    p_record: optionalUuid(body.serviceRecordId),
    p_subject: typeof body.subject === "string" ? body.subject : null,
    p_message: typeof body.message === "string" ? body.message : null
  });
  if (prepError) {
    const known = prepError.hint && /^[A-Z_]+$/.test(prepError.hint);
    return json({ error: known ? prepError.message : "İşlem tamamlanamadı.", code: known ? prepError.hint : "ERROR" }, 400);
  }
  const p = prepared as Prepared & { logId: number };

  // 2) SMTP bilgileri yalnızca burada, service_role ile çözülür.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: cred, error: credError } = await admin.rpc("mail_credentials", { p_tenant: tenantId });
  if (credError || !cred) {
    await admin.rpc("mail_finish", { p_log: p.logId, p_ok: false, p_error: "credentials_unavailable" });
    return json({ error: "E-posta ayarları okunamadı. Ayarları yeniden kaydedin.", code: "MAIL_NOT_CONFIGURED" }, 400);
  }

  // 3) Gönderim.
  const email = renderEmail(p);
  const transporter = nodemailer.createTransport({
    host: cred.host,
    port: cred.port,
    secure: true,
    auth: { user: cred.user, pass: cred.password },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000
  });
  try {
    await transporter.sendMail({
      from: { name: cred.fromName || p.tenant.name, address: cred.user },
      to: p.to,
      replyTo: cred.user,
      subject: email.subject,
      html: email.html,
      text: email.text
    });
  } catch (err) {
    const e = err as { code?: string; responseCode?: number; message?: string };
    // Günlüğe yalnızca hata kodu yazılır; sunucu yanıtı kişisel veri içerebilir.
    await admin.rpc("mail_finish", { p_log: p.logId, p_ok: false, p_error: `${e.code ?? ""} ${e.responseCode ?? ""}`.trim() || "send_failed" });
    return json({ error: smtpErrorMessage(e), code: "SEND_FAILED" }, 502);
  } finally {
    transporter.close();
  }

  await admin.rpc("mail_finish", { p_log: p.logId, p_ok: true });
  return json({ sent: true, to: p.to });
});
