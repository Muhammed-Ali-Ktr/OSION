// Veritabanı göçlerini gömülü Postgres (PGlite) üzerinde çalıştırır ve temel iş kurallarını dener.
// Supabase'in auth şeması burada küçük bir taslakla taklit edilir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);

const AUTH_STUB = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz default now(), last_sign_in_at timestamptz, email_confirmed_at timestamptz,
    banned_until timestamptz);
  create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid);
  create table auth.refresh_tokens (id bigserial primary key, user_id varchar(255));
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text);
  create view vault.decrypted_secrets as select id, secret as decrypted_secret from vault.secrets;
  create function vault.create_secret(s text, n text, d text) returns uuid language sql as $$
    insert into vault.secrets (secret) values (s) returning id $$;
  create function vault.update_secret(i uuid, s text) returns void language sql as $$
    update vault.secrets set secret = s where id = i $$;
`;

async function setup() {
  const db = new PGlite();
  await db.exec(AUTH_STUB);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(new URL(file, MIGRATIONS_DIR), "utf8"));
  }
  return db;
}

async function createUser(db, email, meta = {}) {
  const { rows } = await db.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [email, meta]);
  return rows[0].id;
}

async function as(db, userId, sql, params = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId || ""]);
  await db.exec(userId ? "set role authenticated" : "set role anon");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

test("göçler, araç kataloğu ve sistem yönetimi", async () => {
  const db = await setup();
  const owner = await createUser(db, "usta@ornek.com", { business_name: "Kıtır Oto", display_name: "Usta" });
  const adminUser = await createUser(db, "yonetici@ornek.com", { display_name: "Yönetici" });
  await db.query("insert into public.platform_admins (user_id) values ($1)", [adminUser]);

  const { rows: [{ id: tenant }] } = await db.query("select tenant_id as id from public.memberships where user_id = $1", [owner]);
  await db.query("update public.tenants set setup_completed = true, phone = '05551112233', address = 'Sanayi Sitesi 1' where id = $1", [tenant]);

  // Herkese açık plan listesi (giriş yapmadan)
  const plans = (await as(db, null, "select public.public_plans() as p")).rows[0].p;
  assert.ok(plans.some((p) => p.id === "pro" && p.priceMonthly > 0));
  assert.ok(!plans.some((p) => p.id === "trial"));

  // Model yılı ve işletme kataloğu
  const { rows: [{ id: customer }] } = await as(db, owner,
    "insert into public.customers (tenant_id, first_name, last_name, phone) values ($1, 'Ali', 'Veli', '05550000000') returning id", [tenant]);
  const { rows: [veh] } = await as(db, owner,
    "insert into public.vehicles (tenant_id, customer_id, brand, model, plate, model_year) values ($1, $2, 'Togg', 'T10X', '06 tg 2025', 2025) returning *",
    [tenant, customer]);
  assert.equal(veh.model_year, 2025);
  assert.equal(veh.plate, "06TG2025");
  await as(db, owner, "insert into public.vehicle_catalog (tenant_id, brand, model) values ($1, ' Togg ', 'T10F  Plus')", [tenant]);
  await assert.rejects(as(db, owner, "insert into public.vehicle_catalog (tenant_id, brand, model) values ($1, 'togg', 't10f plus')", [tenant]));
  const cat = (await as(db, owner, "select brand, model from public.vehicle_catalog")).rows;
  assert.deepEqual(cat, [{ brand: "Togg", model: "T10F Plus" }]);

  // Yönetici olmayan kullanıcı yönetim fonksiyonlarını çağıramaz
  await assert.rejects(as(db, owner, "select public.admin_overview()"), /sistem yöneticilerine/);
  assert.equal((await as(db, owner, "select public.platform_is_admin() as a")).rows[0].a, false);
  assert.equal((await as(db, adminUser, "select public.platform_is_admin() as a")).rows[0].a, true);

  // Genel bakış ve işletme listesi
  const overview = (await as(db, adminUser, "select public.admin_overview() as o")).rows[0].o;
  assert.equal(overview.tenants, 1);
  assert.equal(overview.trialing, 1);
  const tenants = (await as(db, adminUser, "select public.admin_tenants() as t")).rows[0].t;
  assert.equal(tenants[0].owner.email, "usta@ornek.com");
  assert.equal(tenants[0].vehicles, 1);

  // Yönetici düzenlemesi kurulum durumunu değiştirmez; abonelik yenileme ödemeyi kaydeder
  await db.query("update public.tenants set setup_completed = false where id = $1", [tenant]);
  await as(db, adminUser, "select public.admin_update_tenant($1, '{\"name\":\"Kıtır Oto Servis\"}'::jsonb)", [tenant]);
  assert.equal((await db.query("select setup_completed from public.tenants where id = $1", [tenant])).rows[0].setup_completed, false);
  await db.query("update public.tenants set setup_completed = true where id = $1", [tenant]);
  await as(db, adminUser, "select public.admin_set_subscription($1, '{\"planId\":\"basic\"}'::jsonb)", [tenant]);
  const renewed = (await as(db, adminUser, "select public.admin_renew_subscription($1, 'yearly', null, 'transfer', '') as r", [tenant])).rows[0].r;
  assert.equal(renewed.state, "active");
  assert.equal(renewed.billingPeriod, "yearly");
  const after = (await as(db, adminUser, "select public.admin_overview() as o")).rows[0].o;
  assert.equal(Number(after.revenueTotal), 5990);
  assert.ok(Math.abs(Number(after.mrr) - 5990 / 12) < 0.01);

  // Plan limitleri sunucuda uygulanır
  await as(db, adminUser, `select public.admin_save_plan('{"id":"mini","name":"Mini","maxUsers":1,"maxVehicles":1,"priceMonthly":"10","features":["A"," "]}'::jsonb)`);
  await as(db, adminUser, "select public.admin_set_subscription($1, '{\"planId\":\"mini\"}'::jsonb)", [tenant]);
  await assert.rejects(as(db, owner,
    "insert into public.vehicles (tenant_id, customer_id, brand, model, plate) values ($1, $2, 'Fiat', 'Egea Sedan', '42ABC1')", [tenant, customer]),
    /araç sınırına/);
  await assert.rejects(as(db, adminUser, "select public.admin_delete_plan('mini')"), /kullanan işletmeler/);

  // Yeni işletme + sahip daveti, duyurular, kullanıcı askıya alma, işlem kayıtları
  const created = (await as(db, adminUser, `select public.admin_create_tenant('{"name":"Yeni Servis","ownerEmail":"sahip@ornek.com","planId":"pro"}'::jsonb) as c`)).rows[0].c;
  assert.match(created.code, /^[0-9A-F]{4}(-[0-9A-F]{4}){5}$/);
  await as(db, null, "select public.check_invite($1, 'sahip@ornek.com')", [created.code]);

  await as(db, adminUser, `select public.admin_save_announcement('{"title":"Bakım","body":"Pazar 02:00","level":"maintenance"}'::jsonb)`);
  assert.equal((await as(db, owner, "select public.active_announcements() as a")).rows[0].a.length, 1);

  await as(db, adminUser, "select public.admin_set_user_suspended($1, true)", [owner]);
  const users = (await as(db, adminUser, "select public.admin_users() as u")).rows[0].u;
  assert.equal(users.find((u) => u.email === "usta@ornek.com").suspended, true);
  await assert.rejects(as(db, adminUser, "select public.admin_set_user_suspended($1, true)", [adminUser]));

  const audit = (await as(db, adminUser, "select public.admin_audit('platform.') as a")).rows[0].a;
  assert.ok(audit.some((a) => a.action === "platform.subscription_renew" && a.userEmail === "yonetici@ornek.com"));
});
