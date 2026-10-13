// Supabase şemasını (supabase/migrations) gömülü bir Postgres'te (PGlite) çalıştırıp
// işletme izolasyonunu, rolleri ve iş kurallarını doğrular. Çalıştırma: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase", "migrations");

test("veritabanı güvenlik kuralları ve iş kuralları", { timeout: 120000 }, async () => {
const migration = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), "utf8")).join(";\n");
const db = new PGlite();

// Supabase ortamının asgari taklidi: roller, auth şeması, auth.uid().
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  -- Supabase Vault taklidi (gerçekte şifreli saklar; testte yalnızca arayüzü önemlidir).
  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text, name text unique, description text);
  create function vault.create_secret(new_secret text, new_name text default null, new_description text default null) returns uuid
    language sql as $$ insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id $$;
  create function vault.update_secret(secret_id uuid, new_secret text default null) returns void
    language sql as $$ update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id $$;
  create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`);
await db.exec(migration);

let failures = 0;
const ok = (cond, name) => { console.log(`${cond ? "✓" : "✗"} ${name}`); if (!cond) failures++; };

async function as(uid, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ""}', false);`);
  await db.exec(uid ? "set role authenticated" : "set role anon");
  try { return await db.query(sql, params); }
  finally { await db.exec("reset role"); }
}
async function expectError(uid, sql, params, match) {
  try { await as(uid, sql, params); return `hata bekleniyordu ama başarılı: ${sql}`; }
  catch (e) { return match && !String(e.message + " " + (e.hint || "")).includes(match) ? `beklenmeyen hata: ${e.message} / ${e.hint}` : null; }
}
async function signup(email, meta) {
  const r = await db.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, meta]);
  return r.rows[0].id;
}

// 1) Kayıt → deneme işletmesi + sahip üyeliği
const A = await signup("a@test.com", { display_name: "Ali", business_name: "A Oto" });
const B = await signup("b@test.com", { display_name: "Bora", business_name: "B Oto" });
let boot = (await as(A, "select public.app_bootstrap() as j")).rows[0].j;
ok(boot.role === "owner" && boot.tenant.name === "A Oto" && boot.data === null, "kayıt: işletme ve sahip rolü oluştu, kurulum bekliyor");
ok(boot.plan.canWrite === true && boot.plan.id === "trial", "deneme planı yazılabilir");
const TA = boot.tenant.id;
const TB = (await as(B, "select public.app_bootstrap() as j")).rows[0].j.tenant.id;

// 2) Kurulum tamamlanmadan veri yazılamaz
ok(!(await expectError(A, "insert into customers (tenant_id, first_name, last_name, phone) values ($1,'X','Y','05321112233')", [TA], "SETUP_REQUIRED")), "kurulum öncesi kayıt engelleniyor");

// 3) Profil kaydı kurulumu tamamlar
await as(A, "update tenants set phone='5321112233', address='Sanayi Sitesi No 1' where id=$1", [TA]);
await as(B, "update tenants set phone='05329998877', address='Başka Sanayi 2' where id=$1", [TB]);
boot = (await as(A, "select public.app_bootstrap() as j")).rows[0].j;
ok(boot.tenant.setup_completed === true && boot.tenant.phone === "05321112233", "profil kaydı kurulumu tamamladı, telefon normalize edildi");
ok(!(await expectError(A, "update tenants set plan_id='pro' where id=$1", [TA], "permission denied")), "kullanıcı planını değiştiremiyor");
ok(!(await expectError(A, "update tenants set subscription_status='active' where id=$1", [TA], "permission denied")), "kullanıcı abonelik durumunu değiştiremiyor");

// 4) Veri girişi ve iş kuralları
const cust = (await as(A, "insert into customers (tenant_id, first_name, last_name, phone) values ($1,' Ahmet ','Yılmaz','5551234567') returning *", [TA])).rows[0];
ok(cust.first_name === "Ahmet" && cust.phone === "05551234567", "müşteri eklendi, alanlar temizlendi");
const veh = (await as(A, "insert into vehicles (tenant_id, customer_id, brand, model, plate) values ($1,$2,'Fiat','Egea','34 abc 123') returning *", [TA, cust.id])).rows[0];
ok(veh.plate === "34ABC123", "plaka büyük harfe çevrildi ve boşluklar kaldırıldı");
const srv = (await as(A, `insert into service_records (tenant_id, vehicle_id, entry_km, record_date, fees, notes, payment_status, paid_amount, total_amount)
  values ($1,$2,120000,'2026-10-13','{"mechanic":"1500.5","frenci":500,"hacker":999}','{"mechanic":"Yağ değişimi"}','Kısmi Ödendi',5000, 1) returning *`, [TA, veh.id])).rows[0];
ok(Number(srv.total_amount) === 2000.5 && Number(srv.paid_amount) === 2000.5 && Number(srv.remaining_amount) === 0, "toplam sunucuda hesaplandı, ödeme toplamla sınırlandı");
ok(!("hacker" in srv.fees) && srv.fees.mechanic === 1500.5, "bilinmeyen usta anahtarları atıldı");
ok(!(await expectError(A, "insert into service_records (tenant_id, vehicle_id, entry_km, record_date, fees) values ($1,$2,1,'2026-01-01','{\"mechanic\":-5}')", [TA, veh.id], "negatif")), "negatif ücret reddedildi");
const upd = (await as(A, "update customers set tenant_id=$2, created_at='2000-01-01' where id=$1 returning tenant_id, created_at", [cust.id, TB])).rows[0];
ok(upd.tenant_id === TA, "güncellemeyle kayıt başka işletmeye taşınamıyor");

// 5) İşletmeler arası izolasyon
ok((await as(B, "select * from customers")).rows.length === 0, "B, A'nın müşterilerini göremiyor");
ok((await as(B, "select * from tenants")).rows.length === 1, "B yalnızca kendi işletmesini görüyor");
ok(!(await expectError(B, "insert into customers (tenant_id, first_name, last_name, phone) values ($1,'X','Y','05321112233')", [TA], "row-level security")), "B, A'nın işletmesine kayıt ekleyemiyor");
const bCust = (await as(B, "insert into customers (tenant_id, first_name, last_name, phone) values ($1,'Can','Demir','05321112233') returning id", [TB])).rows[0];
ok(!(await expectError(B, "insert into vehicles (tenant_id, customer_id, brand, model, plate) values ($1,$2,'Fiat','X','1')", [TB, cust.id], "foreign key")), "B, A'nın müşterisine araç bağlayamıyor");
ok((await as(B, "update customers set notes='x' where id=$1 returning id", [cust.id])).rows.length === 0, "B, A'nın müşterisini güncelleyemiyor");
ok((await as(B, "delete from customers where id=$1 returning id", [cust.id])).rows.length === 0, "B, A'nın müşterisini silemiyor");
const bBoot = (await as(B, "select public.app_bootstrap($1) as j", [TA])).rows[0].j;
ok(bBoot.tenant.id === TB && bBoot.data.customers.length === 1, "B, bootstrap ile A'nın işletmesini açamıyor");
ok(!(await expectError(B, "select public.list_members($1)", [TA], "erişiminiz")), "B, A'nın ekibini listeleyemiyor");
ok(!(await expectError(null, "select * from customers", [], "permission denied")), "giriş yapmamış kullanıcı veri okuyamıyor");
ok(!(await expectError(null, "select public.app_bootstrap()", [], "permission denied")), "giriş yapmamış kullanıcı bootstrap çağıramıyor");
ok(!(await expectError(A, "select * from invitations", [], "permission denied")), "davet tablosuna doğrudan erişim yok");
ok(!(await expectError(A, "select private.set_tenant_plan($1,'pro','active',null)", [TA], "permission denied")), "kullanıcı operatör fonksiyonunu çağıramıyor");

// 6) Davet akışı ve roller
const inv = (await as(A, "select public.create_invite($1,'C@Test.com','staff') as j", [TA])).rows[0].j;
ok(/^[0-9A-F]{4}(-[0-9A-F]{4}){5}$/.test(inv.code), `davet kodu biçimi doğru (${inv.code})`);
ok(!(await expectError(null, "select public.check_invite($1,'baska@test.com')", [inv.code], "farklı bir e-posta")), "davet başka e-postayla kullanılamıyor");
ok((await as(null, "select public.check_invite($1,'c@test.com') as j", [inv.code])).rows[0].j.tenantName === "A Oto", "giriş yapmamış kullanıcı daveti doğrulayabiliyor");
const C = await signup("c@test.com", { display_name: "Cem", invite_code: inv.code.toLowerCase() });
let cBoot = (await as(C, "select public.app_bootstrap() as j")).rows[0].j;
ok(cBoot.role === "staff" && cBoot.tenant.id === TA && cBoot.data.customers.length === 1, "davetle kayıt olan çalışan işletmeye katıldı");
ok(!(await expectError(A, "select public.accept_invite($1)", [inv.code], "geçersiz")), "kullanılmış davet tekrar kullanılamıyor");
ok((await as(C, "delete from customers where id=$1 returning id", [cust.id])).rows.length === 0, "çalışan kayıt silemiyor");
ok((await as(C, "update tenants set name='Ele geçirildi' where id=$1 returning id", [TA])).rows.length === 0, "çalışan işletme bilgilerini değiştiremiyor");
ok(!(await expectError(C, "select public.create_invite($1,'d@test.com','staff')", [TA], "yetkiniz")), "çalışan davet oluşturamıyor");
ok(!(await expectError(A, "select public.create_invite($1,'d@test.com','owner')", [TA], "rol")), "sahip rolüyle davet oluşturulamıyor");
const D = await signup("d@test.com", { display_name: "Deniz", business_name: "D Oto" });
const invD = (await as(A, "select public.create_invite($1,'d@test.com','admin') as j", [TA])).rows[0].j;
await as(D, "select public.accept_invite($1)", [invD.code]);
const dBoot = (await as(D, "select public.app_bootstrap() as j")).rows[0].j;
ok(dBoot.needsTenantChoice === true && dBoot.tenants.length === 2, "iki işletmeye üye kullanıcıdan seçim isteniyor");
ok(!(await expectError(A, "select public.create_invite($1,'e@test.com','staff')", [TA], "sınırına")), "plan kullanıcı sınırı uygulanıyor (deneme: 3)");
const members = (await as(A, "select public.list_members($1) as j", [TA])).rows[0].j;
ok(members.members.length === 3 && members.seats.max === 3, "ekip listesi doğru");
const cMem = members.members.find((m) => m.email === "c@test.com");
await as(A, "select public.remove_member($1,$2)", [TA, cMem.membershipId]);
ok((await as(C, "select * from customers")).rows.length === 0, "çıkarılan çalışanın erişimi anında kesildi");

// 6b) İşletme e-postası ve araç sahibine e-posta
const invE = (await as(A, "select public.create_invite($1,'e@test.com','staff') as j", [TA])).rows[0].j;
const E = await signup("e@test.com", { display_name: "Ece", invite_code: invE.code });
ok(!(await expectError(A, "update customers set email='Gecersiz' where tenant_id=$1", [TA], "check")), "geçersiz müşteri e-postası reddedildi");
ok((await as(A, "update customers set email=' Ahmet@Ornek.COM ' where id=$1 returning email", [cust.id])).rows[0].email === "ahmet@ornek.com", "müşteri e-postası küçük harfe çevrildi");
ok((await as(A, "select public.mail_status($1) as j", [TA])).rows[0].j.configured === false, "başlangıçta e-posta ayarı yok");
ok(!(await expectError(A, "select public.mail_prepare($1,'receipt',null,$2)", [TA, srv.id], "MAIL_NOT_CONFIGURED")), "ayar yokken gönderim engelleniyor");
ok(!(await expectError(A, "select public.save_mail_settings($1,'gmail',null,'dukkan@gmail.com','',null)", [TA], "Uygulama şifresini")), "ilk kayıtta uygulama şifresi zorunlu");
let ms = (await as(A, "select public.save_mail_settings($1,'gmail',null,' Dukkan@Gmail.com ','abcd efgh ijkl mnop','Yıldız Oto') as j", [TA])).rows[0].j;
ok(ms.configured && ms.address === "dukkan@gmail.com" && ms.host === "smtp.gmail.com" && ms.verified === false && !("password" in ms), "e-posta ayarı kaydedildi, şifre dönmüyor");
ok((await db.query("select secret from vault.secrets")).rows[0].secret === "abcdefghijklmnop", "uygulama şifresi boşluksuz olarak Vault'ta");
ok(!(await expectError(A, "select * from tenant_mail_settings", [], "permission denied")), "ayar tablosuna doğrudan erişim yok");
ok(!(await expectError(A, "select public.mail_credentials($1)", [TA], "permission denied")), "kullanıcı şifreyi çözemiyor");
ok(!(await expectError(E, "select public.save_mail_settings($1,'gmail',null,'x@gmail.com','pw',null)", [TA], "yetkiniz")), "çalışan e-posta ayarını değiştiremiyor");
ok((await as(E, "select public.mail_status($1) as j", [TA])).rows[0].j.host === null, "çalışan sunucu ayrıntılarını görmüyor");
ok(!(await expectError(B, "select public.mail_status($1)", [TA], "erişiminiz")), "başka işletme e-posta durumunu göremiyor");
const prep = (await as(E, "select public.mail_prepare($1,'receipt',null,$2) as j", [TA, srv.id])).rows[0].j;
ok(prep.to === "ahmet@ornek.com" && prep.vehicle.plate === "34ABC123" && Number(prep.record.total_amount) === 2000.5, "servis fişi verisi hazırlandı, alıcı müşterinin e-postası");
ok(!(await expectError(B, "select public.mail_prepare($1,'receipt',null,$2)", [TA, srv.id], "erişiminiz")), "başka işletme adına e-posta gönderilemiyor");
ok(!(await expectError(E, "select public.mail_prepare($1,'test')", [TA], "yetkiniz")), "çalışan test e-postası gönderemiyor");
ok((await as(A, "select public.mail_prepare($1,'test') as j", [TA])).rows[0].j.to === "dukkan@gmail.com", "test e-postası işletmenin kendi adresine gidiyor");
ok(!(await expectError(A, "select public.mail_prepare($1,'message',$2,null,'x','Merhaba')", [TA, cust.id], "Konu")), "mesaj konusu doğrulanıyor");
const credRow = (await db.query("select public.mail_credentials($1) as j", [TA])).rows[0].j;
ok(credRow.password === "abcdefghijklmnop" && credRow.port === 465, "Edge Function şifreyi çözebiliyor");
await db.query("select public.mail_finish($1, true)", [(await db.query("select max(id) id from mail_log where kind='test'")).rows[0].id]);
ok((await as(A, "select public.mail_status($1) as j", [TA])).rows[0].j.verified === true, "başarılı test e-postası hesabı doğruladı");
ms = (await as(A, "select public.save_mail_settings($1,'gmail',null,'dukkan@gmail.com','','Yıldız Oto Servis') as j", [TA])).rows[0].j;
ok(ms.verified === true && (await db.query("select secret from vault.secrets")).rows[0].secret === "abcdefghijklmnop", "şifre boş bırakılınca mevcut şifre ve doğrulama korunuyor");
await db.query("insert into mail_log (tenant_id, kind, recipient) select $1, 'receipt', 'x@y.com' from generate_series(1, 200)", [TA]);
ok(!(await expectError(A, "select public.mail_prepare($1,'receipt',null,$2)", [TA, srv.id], "sınırına")), "günlük gönderim sınırı uygulanıyor");
await as(A, "select public.delete_mail_settings($1)", [TA]);
ok((await db.query("select count(*)::int n from vault.secrets")).rows[0].n === 0, "ayar silinince Vault'taki şifre de silindi");
ok((await as(null, "select public.check_invite($1,'c@test.com')", ["AAAA-BBBB-CCCC-DDDD-EEEE"]).catch((e) => e)).hint === "INVALID_INVITE", "giriş yapmamış kullanıcı hâlâ davet doğrulayabiliyor");

// 7) Abonelik süresi dolunca: okuma serbest, yazma kapalı
await db.query("update tenants set trial_ends_at = now() - interval '1 day' where id=$1", [TA]);
ok(!(await expectError(A, "insert into customers (tenant_id, first_name, last_name, phone) values ($1,'X','Y','05321112233')", [TA], "SUBSCRIPTION_INACTIVE")), "deneme bitince yeni kayıt engelleniyor");
ok((await as(A, "select * from customers")).rows.length === 1, "deneme bitince kayıtlar okunabiliyor");
boot = (await as(A, "select public.app_bootstrap() as j")).rows[0].j;
ok(boot.plan.canWrite === false, "istemciye yazma kapalı bilgisi gidiyor");
await db.query("select private.set_tenant_plan($1,'lifetime','active',null)", [TA]);
ok((await as(A, "insert into customers (tenant_id, first_name, last_name, phone) values ($1,'Lisans','Test','05321112233') returning id", [TA])).rows.length === 1, "ömür boyu lisansla yazma açıldı");

// 8) Silme zinciri ve işletme kapatma
await as(A, "delete from customers where id=$1", [cust.id]);
ok((await as(A, "select count(*)::int n from service_records")).rows[0].n === 0, "müşteri silinince araç ve servis kayıtları da silindi");
ok(!(await expectError(A, "select public.close_tenant($1,'yanlis')", [TA], "birebir")), "kapatma için işletme adı doğrulanıyor");
await as(A, "select public.close_tenant($1,'A Oto')", [TA]);
ok((await as(A, "select * from customers")).rows.length === 0, "kapatılan işletmenin verisine erişim kesildi");
await db.query("update tenants set delete_after = now() - interval '1 second' where id=$1", [TA]);
const purged = (await db.query("select private.purge_closed_tenants() n")).rows[0].n;
ok(purged === 1 && (await db.query("select count(*)::int n from customers where tenant_id=$1", [TA])).rows[0].n === 0, "saklama süresi dolan işletme tüm verisiyle silindi");

assert.equal(failures, 0, `${failures} kontrol başarısız`);
});
