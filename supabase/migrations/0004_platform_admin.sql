-- =============================================================================
-- OSION — Sistem yönetimi (platform yöneticisi), plan fiyatları/limitleri,
-- abonelik ödemeleri ve duyurular
--
-- Sistem yöneticisi eklemek için (SQL Editor, bir kez):
--   insert into public.platform_admins (user_id)
--     select id from auth.users where email = 'yonetici@ornek.com';
--
-- Tüm yönetim işlemleri aşağıdaki admin_* fonksiyonlarıyla yapılır; her biri çağıranın
-- platform_admins tablosunda olduğunu veritabanında denetler. Tablolara doğrudan erişim yoktur.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PLANLAR: fiyat, limit ve tanıtım bilgileri
-- -----------------------------------------------------------------------------
alter table public.plans
  add column if not exists description text not null default '' check (char_length(description) <= 300),
  add column if not exists price_monthly numeric(12, 2) check (price_monthly is null or price_monthly >= 0),
  add column if not exists price_yearly numeric(12, 2) check (price_yearly is null or price_yearly >= 0),
  add column if not exists currency text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD', 'GBP')),
  add column if not exists max_customers int check (max_customers is null or max_customers > 0),
  add column if not exists max_vehicles int check (max_vehicles is null or max_vehicles > 0),
  add column if not exists features text[] not null default '{}',
  add column if not exists is_public boolean not null default true,
  add column if not exists is_featured boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

-- Başlangıç değerleri (Sistem yönetimi > Planlar ve fiyatlar bölümünden değiştirilebilir).
update public.plans set description = '30 gün boyunca tüm özellikler ücretsiz.', price_monthly = 0, price_yearly = 0,
  max_customers = null, max_vehicles = null, is_public = false,
  features = array['Tüm özellikler', '30 gün süre', 'Kredi kartı gerekmez']
  where id = 'trial' and price_monthly is null;
update public.plans set description = 'Tek ustalı veya küçük servisler için.', price_monthly = 599, price_yearly = 5990,
  max_customers = 500, max_vehicles = 750, is_public = true,
  features = array['Müşteri ve araç kartları', 'Servis ve usta işçilik girişi', 'Borç / tahsilat takibi',
    'Şasi numarasını kamerayla okutma', 'E-posta ile servis fişi']
  where id = 'basic' and price_monthly is null;
update public.plans set description = 'Ekibi olan, yoğun çalışan servisler için.', price_monthly = 999, price_yearly = 9990,
  max_customers = null, max_vehicles = null, is_public = true, is_featured = true,
  features = array['Temel paketteki her şey', 'Sınırsız müşteri ve araç', 'QR kodla ekip daveti',
    'Gelir grafikleri ve raporlar', 'Öncelikli destek']
  where id = 'pro' and price_monthly is null;
update public.plans set description = 'Kendi sunucunuzda tek seferlik lisans.', is_public = false
  where id = 'lifetime' and description = '';

-- -----------------------------------------------------------------------------
-- İŞLETME: fatura dönemi; denetim kaydı: ayrıntı
-- -----------------------------------------------------------------------------
alter table public.tenants
  add column if not exists billing_period text not null default 'monthly' check (billing_period in ('monthly', 'yearly'));

alter table public.audit_log add column if not exists detail jsonb;

-- Sistem yöneticisi işletme bilgisini düzenlediğinde "kurulum tamamlandı" sayılmamalı.
create or replace function private.normalize_tenant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.name := btrim(new.name);
  new.phone := private.normalize_phone(new.phone);
  new.address := btrim(coalesce(new.address, ''));
  new.legal_name := btrim(coalesce(new.legal_name, ''));
  new.tax_office := btrim(coalesce(new.tax_office, ''));
  new.tax_number := btrim(coalesce(new.tax_number, ''));
  -- Kullanıcı profil kaydettiğinde kurulum tamamlanmış sayılır (iletişim kısıtı ayrıca denetler).
  if tg_op = 'UPDATE' and auth.uid() is not null and new.status = old.status
     and coalesce(current_setting('osion.platform_admin', true), '') <> 'on' then
    new.setup_completed := true;
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- PLAN LİMİTLERİ (müşteri / araç) — sunucu tarafında uygulanır
-- -----------------------------------------------------------------------------
create or replace function private.enforce_plan_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_max int;
  v_count int;
begin
  if auth.uid() is null or coalesce(current_setting('osion.maintenance', true), '') = 'on' then
    return new;
  end if;
  if tg_table_name = 'customers' then
    select pl.max_customers into v_max from public.tenants t join public.plans pl on pl.id = t.plan_id where t.id = new.tenant_id;
    if v_max is not null then
      select count(*) into v_count from public.customers where tenant_id = new.tenant_id;
      if v_count >= v_max then
        perform private.fail('PLAN_LIMIT', 'Planınızın müşteri sınırına ulaşıldı (' || v_max || ' müşteri). Daha fazlası için planınızı yükseltin.');
      end if;
    end if;
  else
    select pl.max_vehicles into v_max from public.tenants t join public.plans pl on pl.id = t.plan_id where t.id = new.tenant_id;
    if v_max is not null then
      select count(*) into v_count from public.vehicles where tenant_id = new.tenant_id;
      if v_count >= v_max then
        perform private.fail('PLAN_LIMIT', 'Planınızın araç sınırına ulaşıldı (' || v_max || ' araç). Daha fazlası için planınızı yükseltin.');
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists customers_plan_limit on public.customers;
create trigger customers_plan_limit before insert on public.customers
  for each row execute function private.enforce_plan_limits();
drop trigger if exists vehicles_plan_limit on public.vehicles;
create trigger vehicles_plan_limit before insert on public.vehicles
  for each row execute function private.enforce_plan_limits();

-- -----------------------------------------------------------------------------
-- TABLOLAR: sistem yöneticileri, abonelik ödemeleri, duyurular
-- -----------------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  plan_id text references public.plans (id) on delete set null,
  period text not null default 'monthly' check (period in ('monthly', 'yearly', 'custom')),
  amount numeric(12, 2) not null check (amount >= 0 and amount <= 100000000),
  currency text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD', 'GBP')),
  method text not null default '' check (method in ('', 'cash', 'transfer', 'card', 'other')),
  note text not null default '' check (char_length(note) <= 300),
  paid_at timestamptz not null default now(),
  period_end timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists subscription_payments_tenant_idx on public.subscription_payments (tenant_id, paid_at desc);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 120),
  body text not null default '' check (char_length(body) <= 2000),
  level text not null default 'info' check (level in ('info', 'success', 'warning', 'maintenance')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_published boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

alter table public.platform_admins enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.announcements enable row level security;
revoke all on public.platform_admins, public.subscription_payments, public.announcements from anon, authenticated;

-- -----------------------------------------------------------------------------
-- YARDIMCILAR
-- -----------------------------------------------------------------------------
create or replace function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

create or replace function private.require_platform_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform private.fail('AUTH_REQUIRED', 'Bu işlem için giriş yapmalısınız.');
  end if;
  if not private.is_platform_admin() then
    perform private.fail('FORBIDDEN', 'Bu alan yalnızca sistem yöneticilerine açıktır.');
  end if;
  perform set_config('osion.platform_admin', 'on', true);
end $$;

create or replace function private.platform_audit(p_action text, p_entity text, p_entity_id text,
  p_tenant uuid default null, p_detail jsonb default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id, detail)
  values (p_tenant, auth.uid(), p_action, p_entity, p_entity_id, p_detail);
$$;

-- İşletmenin abonelik bitiş tarihi (deneme ise deneme sonu) ve durum etiketi.
create or replace function private.tenant_ends_at(t public.tenants) returns timestamptz
language sql stable as $$
  select case when t.subscription_status = 'trialing' then t.trial_ends_at else t.current_period_end end;
$$;

create or replace function private.tenant_sub_state(t public.tenants) returns text
language sql stable as $$
  select case
    when t.status <> 'active' then 'closed'
    when t.subscription_status = 'canceled' then 'canceled'
    when t.subscription_status = 'trialing' then
      case when t.trial_ends_at is null or t.trial_ends_at > now() then 'trialing' else 'expired' end
    when t.current_period_end is null then 'lifetime'
    when t.current_period_end <= now() then 'expired'
    when t.current_period_end <= now() + interval '7 days' then 'expiring'
    else 'active'
  end;
$$;

create or replace function private.plan_json(p public.plans) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'sort', p.sort,
    'priceMonthly', p.price_monthly, 'priceYearly', p.price_yearly, 'currency', p.currency,
    'maxUsers', p.max_users, 'maxCustomers', p.max_customers, 'maxVehicles', p.max_vehicles,
    'features', to_jsonb(p.features), 'isPublic', p.is_public, 'isFeatured', p.is_featured, 'isActive', p.is_active);
$$;

create or replace function private.tenant_owner(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', pr.id, 'name', pr.display_name, 'email', pr.email)
  from public.memberships m join public.profiles pr on pr.id = m.user_id
  where m.tenant_id = p_tenant and m.role = 'owner' and m.status = 'active'
  order by m.created_at limit 1;
$$;

create or replace function private.tenant_row_json(t public.tenants) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'name', t.name, 'phone', t.phone, 'address', t.address,
    'legalName', t.legal_name, 'taxOffice', t.tax_office, 'taxNumber', t.tax_number,
    'status', t.status, 'setupCompleted', t.setup_completed, 'createdAt', t.created_at, 'closedAt', t.closed_at,
    'planId', t.plan_id, 'planName', (select name from public.plans where id = t.plan_id),
    'subscriptionStatus', t.subscription_status, 'billingPeriod', t.billing_period,
    'trialEndsAt', t.trial_ends_at, 'currentPeriodEnd', t.current_period_end,
    'endsAt', private.tenant_ends_at(t), 'state', private.tenant_sub_state(t),
    'price', (select case when t.billing_period = 'yearly' then price_yearly else price_monthly end from public.plans where id = t.plan_id),
    'owner', private.tenant_owner(t.id),
    'members', (select count(*) from public.memberships where tenant_id = t.id and status = 'active'),
    'customers', (select count(*) from public.customers where tenant_id = t.id),
    'vehicles', (select count(*) from public.vehicles where tenant_id = t.id),
    'services', (select count(*) from public.service_records where tenant_id = t.id));
$$;

-- -----------------------------------------------------------------------------
-- HERKESE AÇIK / OTURUMLU KULLANICI FONKSİYONLARI
-- -----------------------------------------------------------------------------

-- Tanıtım sitesindeki fiyat tablosu.
create or replace function public.public_plans() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.plan_json(p) order by p.sort, p.id), '[]'::jsonb)
  from public.plans p where p.is_public and p.is_active;
$$;

create or replace function public.platform_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and private.is_platform_admin();
$$;

-- İşletme panellerinde gösterilen yayındaki duyurular.
create or replace function public.active_announcements() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'level', a.level,
    'startsAt', a.starts_at, 'endsAt', a.ends_at) order by a.starts_at desc), '[]'::jsonb)
  from public.announcements a
  where auth.uid() is not null and a.is_published and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now());
$$;

-- -----------------------------------------------------------------------------
-- SİSTEM YÖNETİMİ: GENEL BAKIŞ
-- -----------------------------------------------------------------------------
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  perform private.require_platform_admin();
  select jsonb_build_object(
    'tenants', count(*) filter (where t.status = 'active'),
    'tenantsClosed', count(*) filter (where t.status <> 'active'),
    'tenantsLast30', count(*) filter (where t.created_at > now() - interval '30 days'),
    'active', count(*) filter (where private.tenant_sub_state(t) in ('active', 'expiring', 'lifetime')),
    'trialing', count(*) filter (where private.tenant_sub_state(t) = 'trialing'),
    'expiring', count(*) filter (where t.status = 'active' and private.tenant_ends_at(t) between now() and now() + interval '7 days'),
    'expired', count(*) filter (where private.tenant_sub_state(t) in ('expired', 'canceled')),
    'mrr', coalesce(sum(case when private.tenant_sub_state(t) in ('active', 'expiring') then
      case when t.billing_period = 'yearly' then coalesce(p.price_yearly, 0) / 12 else coalesce(p.price_monthly, 0) end end), 0)
  ) into v
  from public.tenants t join public.plans p on p.id = t.plan_id;

  return v || jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'usersLast30', (select count(*) from public.profiles where created_at > now() - interval '30 days'),
    'announcementsLive', (select count(*) from public.announcements a where a.is_published and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())),
    'revenueTotal', (select coalesce(sum(amount), 0) from public.subscription_payments),
    'revenueThisMonth', (select coalesce(sum(amount), 0) from public.subscription_payments
      where paid_at >= date_trunc('month', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul'),
    'upcoming', (select coalesce(jsonb_agg(x order by x ->> 'endsAt'), '[]'::jsonb) from (
      select jsonb_build_object('id', t.id, 'name', t.name, 'planName', p.name, 'state', private.tenant_sub_state(t),
        'endsAt', private.tenant_ends_at(t), 'price', case when t.billing_period = 'yearly' then p.price_yearly else p.price_monthly end) x
      from public.tenants t join public.plans p on p.id = t.plan_id
      where t.status = 'active' and private.tenant_ends_at(t) between now() - interval '7 days' and now() + interval '30 days'
      order by private.tenant_ends_at(t) limit 12) s),
    'recentPayments', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('id', sp.id, 'tenantId', sp.tenant_id, 'tenantName', t.name, 'amount', sp.amount,
        'currency', sp.currency, 'period', sp.period, 'paidAt', sp.paid_at) x
      from public.subscription_payments sp join public.tenants t on t.id = sp.tenant_id
      order by sp.paid_at desc limit 8) s),
    'planDistribution', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name,
        'count', (select count(*) from public.tenants t where t.plan_id = p.id and t.status = 'active')) order by p.sort), '[]'::jsonb)
      from public.plans p));
end $$;

-- -----------------------------------------------------------------------------
-- İŞLETMELER VE ABONELİKLER
-- -----------------------------------------------------------------------------
create or replace function public.admin_tenants() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  return (select coalesce(jsonb_agg(private.tenant_row_json(t) order by t.created_at desc), '[]'::jsonb) from public.tenants t);
end $$;

create or replace function public.admin_tenant_detail(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.tenants;
begin
  perform private.require_platform_admin();
  select * into t from public.tenants where id = p_tenant;
  if not found then perform private.fail('NOT_FOUND', 'İşletme bulunamadı.'); end if;
  return private.tenant_row_json(t) || jsonb_build_object(
    'memberList', (select coalesce(jsonb_agg(jsonb_build_object('name', pr.display_name, 'email', pr.email,
        'role', m.role, 'status', m.status, 'since', m.created_at) order by m.created_at), '[]'::jsonb)
      from public.memberships m join public.profiles pr on pr.id = m.user_id where m.tenant_id = t.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', sp.id, 'amount', sp.amount, 'currency', sp.currency,
        'period', sp.period, 'method', sp.method, 'note', sp.note, 'paidAt', sp.paid_at, 'periodEnd', sp.period_end,
        'planName', (select name from public.plans where id = sp.plan_id)) order by sp.paid_at desc), '[]'::jsonb)
      from public.subscription_payments sp where sp.tenant_id = t.id),
    'pendingInvites', (select count(*) from public.invitations i where i.tenant_id = t.id
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()));
end $$;

create or replace function public.admin_update_tenant(p_tenant uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
begin
  perform private.require_platform_admin();
  update public.tenants set
    name = coalesce(p ->> 'name', name),
    phone = coalesce(p ->> 'phone', phone),
    address = coalesce(p ->> 'address', address),
    legal_name = coalesce(p ->> 'legalName', legal_name),
    tax_office = coalesce(p ->> 'taxOffice', tax_office),
    tax_number = coalesce(p ->> 'taxNumber', tax_number)
  where id = p_tenant returning * into t;
  if not found then perform private.fail('NOT_FOUND', 'İşletme bulunamadı.'); end if;
  perform private.platform_audit('platform.tenant_update', 'tenant', p_tenant::text, p_tenant,
    jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(p) k)));
  return private.tenant_row_json(t);
end $$;

create or replace function public.admin_set_subscription(p_tenant uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
begin
  perform private.require_platform_admin();
  if p ? 'planId' and not exists (select 1 from public.plans where id = p ->> 'planId') then
    perform private.fail('VALIDATION', 'Geçersiz plan.');
  end if;
  update public.tenants set
    plan_id = coalesce(p ->> 'planId', plan_id),
    subscription_status = coalesce(p ->> 'subscriptionStatus', subscription_status),
    billing_period = coalesce(p ->> 'billingPeriod', billing_period),
    trial_ends_at = case when p ? 'trialEndsAt' then nullif(p ->> 'trialEndsAt', '')::timestamptz else trial_ends_at end,
    current_period_end = case when p ? 'currentPeriodEnd' then nullif(p ->> 'currentPeriodEnd', '')::timestamptz else current_period_end end
  where id = p_tenant returning * into t;
  if not found then perform private.fail('NOT_FOUND', 'İşletme bulunamadı.'); end if;
  perform private.platform_audit('platform.subscription_update', 'tenant', p_tenant::text, p_tenant,
    jsonb_build_object('plan', t.plan_id, 'status', t.subscription_status, 'period', t.billing_period));
  return private.tenant_row_json(t);
end $$;

-- Aboneliği bir dönem uzatır (bitiş tarihi geçmişse bugünden itibaren) ve ödemeyi kaydeder.
create or replace function public.admin_renew_subscription(p_tenant uuid, p_period text, p_amount numeric default null,
  p_method text default '', p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  pl public.plans;
  v_end timestamptz;
  v_amount numeric;
begin
  perform private.require_platform_admin();
  if p_period not in ('monthly', 'yearly') then perform private.fail('VALIDATION', 'Geçersiz dönem.'); end if;
  select * into t from public.tenants where id = p_tenant for update;
  if not found then perform private.fail('NOT_FOUND', 'İşletme bulunamadı.'); end if;
  select * into pl from public.plans where id = t.plan_id;
  v_end := greatest(now(), coalesce(case when t.subscription_status = 'trialing' then null else t.current_period_end end, now()))
    + case when p_period = 'yearly' then interval '1 year' else interval '1 month' end;
  v_amount := coalesce(p_amount, case when p_period = 'yearly' then pl.price_yearly else pl.price_monthly end, 0);

  update public.tenants set subscription_status = 'active', billing_period = p_period, current_period_end = v_end
    where id = p_tenant returning * into t;
  insert into public.subscription_payments (tenant_id, plan_id, period, amount, currency, method, note, period_end, created_by)
    values (p_tenant, t.plan_id, p_period, v_amount, pl.currency, coalesce(p_method, ''), left(coalesce(p_note, ''), 300), v_end, auth.uid());
  perform private.platform_audit('platform.subscription_renew', 'tenant', p_tenant::text, p_tenant,
    jsonb_build_object('period', p_period, 'amount', v_amount, 'until', v_end));
  return private.tenant_row_json(t);
end $$;

create or replace function public.admin_add_payment(p_tenant uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  t public.tenants;
begin
  perform private.require_platform_admin();
  select * into t from public.tenants where id = p_tenant;
  if not found then perform private.fail('NOT_FOUND', 'İşletme bulunamadı.'); end if;
  insert into public.subscription_payments (tenant_id, plan_id, period, amount, currency, method, note, paid_at, created_by)
    values (p_tenant, t.plan_id, coalesce(p ->> 'period', 'custom'), (p ->> 'amount')::numeric,
      coalesce(p ->> 'currency', 'TRY'), coalesce(p ->> 'method', ''), left(coalesce(p ->> 'note', ''), 300),
      coalesce(nullif(p ->> 'paidAt', '')::timestamptz, now()), auth.uid())
    returning id into v_id;
  perform private.platform_audit('platform.payment_add', 'payment', v_id::text, p_tenant,
    jsonb_build_object('amount', p ->> 'amount'));
  return v_id;
end $$;

create or replace function public.admin_delete_payment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
begin
  perform private.require_platform_admin();
  delete from public.subscription_payments where id = p_id returning tenant_id into v_tenant;
  if not found then perform private.fail('NOT_FOUND', 'Ödeme kaydı bulunamadı.'); end if;
  perform private.platform_audit('platform.payment_delete', 'payment', p_id::text, v_tenant);
end $$;

-- Yeni işletme açar ve sahibi için davet kodu üretir (sahip kodu kullanarak hesabını oluşturur).
create or replace function public.admin_create_tenant(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p ->> 'ownerEmail', '')));
  v_plan text := coalesce(nullif(p ->> 'planId', ''), 'trial');
  v_days int := least(greatest(coalesce((p ->> 'trialDays')::int, 30), 1), 365);
  v_code text;
  t public.tenants;
  inv public.invitations;
begin
  perform private.require_platform_admin();
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
    perform private.fail('VALIDATION', 'Geçerli bir sahip e-posta adresi girin.');
  end if;
  if not exists (select 1 from public.plans where id = v_plan) then
    perform private.fail('VALIDATION', 'Geçersiz plan.');
  end if;
  insert into public.tenants (name, phone, address, plan_id, subscription_status, trial_ends_at)
    values (btrim(p ->> 'name'), coalesce(p ->> 'phone', ''), coalesce(p ->> 'address', ''),
      v_plan, 'trialing', now() + make_interval(days => v_days))
    returning * into t;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) ||
                  substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into public.invitations (tenant_id, email, role, code_hash, invited_by, expires_at)
    values (t.id, v_email, 'owner', encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), auth.uid(), now() + interval '14 days')
    returning * into inv;
  perform private.platform_audit('platform.tenant_create', 'tenant', t.id::text, t.id, jsonb_build_object('plan', v_plan));
  return jsonb_build_object('tenant', private.tenant_row_json(t), 'ownerEmail', v_email,
    'code', regexp_replace(v_code, '(.{4})(?!$)', '\1-', 'g'), 'expiresAt', inv.expires_at);
end $$;

create or replace function public.admin_set_tenant_status(p_tenant uuid, p_active boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
begin
  perform private.require_platform_admin();
  if p_active then
    update public.tenants set status = 'active', closed_at = null, delete_after = null
      where id = p_tenant returning * into t;
  else
    update public.tenants set status = 'closed', closed_at = now(), delete_after = now() + interval '30 days'
      where id = p_tenant and status = 'active' returning * into t;
  end if;
  if not found then perform private.fail('NOT_FOUND', 'İşletme bulunamadı veya durumu zaten bu şekilde.'); end if;
  perform private.platform_audit(case when p_active then 'platform.tenant_restore' else 'platform.tenant_close' end,
    'tenant', p_tenant::text, p_tenant);
  return private.tenant_row_json(t);
end $$;

-- -----------------------------------------------------------------------------
-- PLANLAR VE FİYATLAR
-- -----------------------------------------------------------------------------
create or replace function public.admin_plans() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  return (select coalesce(jsonb_agg(private.plan_json(p) || jsonb_build_object(
      'tenants', (select count(*) from public.tenants t where t.plan_id = p.id and t.status = 'active'))
    order by p.sort, p.id), '[]'::jsonb) from public.plans p);
end $$;

create or replace function public.admin_save_plan(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id text := lower(btrim(coalesce(p ->> 'id', '')));
  r public.plans;
  v_features text[];
begin
  perform private.require_platform_admin();
  if v_id !~ '^[a-z0-9_]{2,30}$' then
    perform private.fail('VALIDATION', 'Plan kodu 2-30 karakter olmalı; yalnızca küçük harf, rakam ve alt çizgi.');
  end if;
  if char_length(btrim(coalesce(p ->> 'name', ''))) not between 2 and 60 then
    perform private.fail('VALIDATION', 'Plan adı 2-60 karakter olmalıdır.');
  end if;
  select coalesce(array_agg(left(btrim(f), 120)) filter (where btrim(f) <> ''), '{}')
    into v_features from jsonb_array_elements_text(coalesce(p -> 'features', '[]'::jsonb)) f;

  insert into public.plans as x (id, name, description, sort, price_monthly, price_yearly, currency,
      max_users, max_customers, max_vehicles, features, is_public, is_featured, is_active, updated_at)
    values (v_id, btrim(p ->> 'name'), left(coalesce(p ->> 'description', ''), 300), coalesce((p ->> 'sort')::int, 10),
      nullif(p ->> 'priceMonthly', '')::numeric, nullif(p ->> 'priceYearly', '')::numeric, coalesce(p ->> 'currency', 'TRY'),
      coalesce(nullif(p ->> 'maxUsers', '')::int, 3), nullif(p ->> 'maxCustomers', '')::int, nullif(p ->> 'maxVehicles', '')::int,
      v_features, coalesce((p ->> 'isPublic')::boolean, true), coalesce((p ->> 'isFeatured')::boolean, false),
      coalesce((p ->> 'isActive')::boolean, true), now())
    on conflict (id) do update set
      name = excluded.name, description = excluded.description, sort = excluded.sort,
      price_monthly = excluded.price_monthly, price_yearly = excluded.price_yearly, currency = excluded.currency,
      max_users = excluded.max_users, max_customers = excluded.max_customers, max_vehicles = excluded.max_vehicles,
      features = excluded.features, is_public = excluded.is_public, is_featured = excluded.is_featured,
      is_active = excluded.is_active, updated_at = now()
    returning * into r;
  perform private.platform_audit('platform.plan_save', 'plan', v_id, null, jsonb_build_object('name', r.name));
  return private.plan_json(r);
end $$;

create or replace function public.admin_delete_plan(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  if p_id = 'trial' then
    perform private.fail('FORBIDDEN', 'Deneme planı yeni kayıtlarda kullanıldığı için silinemez.');
  end if;
  if exists (select 1 from public.tenants where plan_id = p_id) then
    perform private.fail('CONFLICT', 'Bu planı kullanan işletmeler var. Önce işletmeleri başka plana taşıyın.');
  end if;
  delete from public.plans where id = p_id;
  if not found then perform private.fail('NOT_FOUND', 'Plan bulunamadı.'); end if;
  perform private.platform_audit('platform.plan_delete', 'plan', p_id);
end $$;

-- -----------------------------------------------------------------------------
-- KULLANICILAR
-- -----------------------------------------------------------------------------
create or replace function public.admin_users() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'email', u.email, 'name', coalesce(pr.display_name, ''),
      'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at, 'confirmed', u.email_confirmed_at is not null,
      'suspended', u.banned_until is not null and u.banned_until > now(),
      'isAdmin', exists (select 1 from public.platform_admins a where a.user_id = u.id),
      'isCurrentUser', u.id = auth.uid(),
      'tenants', (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'role', m.role)), '[]'::jsonb)
        from public.memberships m join public.tenants t on t.id = m.tenant_id
        where m.user_id = u.id and m.status = 'active'))
    order by u.created_at desc), '[]'::jsonb)
  from auth.users u left join public.profiles pr on pr.id = u.id);
end $$;

create or replace function public.admin_set_user_suspended(p_user uuid, p_suspended boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  if p_user = auth.uid() then perform private.fail('FORBIDDEN', 'Kendi hesabınızı askıya alamazsınız.'); end if;
  if exists (select 1 from public.platform_admins where user_id = p_user) then
    perform private.fail('FORBIDDEN', 'Sistem yöneticisi hesapları askıya alınamaz.');
  end if;
  update auth.users set banned_until = case when p_suspended then 'infinity'::timestamptz else null end where id = p_user;
  if not found then perform private.fail('NOT_FOUND', 'Kullanıcı bulunamadı.'); end if;
  -- Askıya alınan kullanıcının açık oturumları sonlandırılır.
  if p_suspended then
    delete from auth.refresh_tokens where user_id = p_user::text;
    delete from auth.sessions where user_id = p_user;
  end if;
  perform private.platform_audit(case when p_suspended then 'platform.user_suspend' else 'platform.user_unsuspend' end,
    'user', p_user::text);
end $$;

-- -----------------------------------------------------------------------------
-- İŞLEM KAYITLARI
-- -----------------------------------------------------------------------------
create or replace function public.admin_audit(p_prefix text default null, p_limit int default 300) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  return (select coalesce(jsonb_agg(x order by (x ->> 'id')::bigint desc), '[]'::jsonb) from (
    select jsonb_build_object('id', l.id, 'at', l.created_at, 'action', l.action, 'entity', l.entity, 'entityId', l.entity_id,
      'detail', l.detail, 'userEmail', pr.email, 'tenantName', t.name) x
    from public.audit_log l
    left join public.profiles pr on pr.id = l.user_id
    left join public.tenants t on t.id = l.tenant_id
    where p_prefix is null or p_prefix = '' or l.action like p_prefix || '%'
    order by l.id desc
    limit least(greatest(coalesce(p_limit, 300), 1), 1000)) s);
end $$;

-- -----------------------------------------------------------------------------
-- DUYURULAR
-- -----------------------------------------------------------------------------
create or replace function public.admin_announcements() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'level', a.level,
      'startsAt', a.starts_at, 'endsAt', a.ends_at, 'isPublished', a.is_published, 'createdAt', a.created_at,
      'state', case when not a.is_published then 'draft' when a.starts_at > now() then 'scheduled'
        when a.ends_at is not null and a.ends_at <= now() then 'ended' else 'live' end)
    order by a.starts_at desc), '[]'::jsonb) from public.announcements a);
end $$;

create or replace function public.admin_save_announcement(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform private.require_platform_admin();
  if v_id is null then
    insert into public.announcements (title, body, level, starts_at, ends_at, is_published, created_by)
      values (btrim(p ->> 'title'), btrim(coalesce(p ->> 'body', '')), coalesce(p ->> 'level', 'info'),
        coalesce(nullif(p ->> 'startsAt', '')::timestamptz, now()), nullif(p ->> 'endsAt', '')::timestamptz,
        coalesce((p ->> 'isPublished')::boolean, true), auth.uid())
      returning id into v_id;
  else
    update public.announcements set title = btrim(p ->> 'title'), body = btrim(coalesce(p ->> 'body', '')),
      level = coalesce(p ->> 'level', level), starts_at = coalesce(nullif(p ->> 'startsAt', '')::timestamptz, starts_at),
      ends_at = nullif(p ->> 'endsAt', '')::timestamptz, is_published = coalesce((p ->> 'isPublished')::boolean, is_published),
      updated_at = now()
      where id = v_id;
    if not found then perform private.fail('NOT_FOUND', 'Duyuru bulunamadı.'); end if;
  end if;
  perform private.platform_audit('platform.announcement_save', 'announcement', v_id::text);
  return v_id;
end $$;

create or replace function public.admin_delete_announcement(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  delete from public.announcements where id = p_id;
  if not found then perform private.fail('NOT_FOUND', 'Duyuru bulunamadı.'); end if;
  perform private.platform_audit('platform.announcement_delete', 'announcement', p_id::text);
end $$;

-- -----------------------------------------------------------------------------
-- GİRİŞ BİLGİLERİM (yönetici profil adı)
-- -----------------------------------------------------------------------------
create or replace function public.admin_save_profile(p_display_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  if char_length(btrim(coalesce(p_display_name, ''))) not between 2 and 80 then
    perform private.fail('VALIDATION', 'Ad soyad 2-80 karakter olmalıdır.');
  end if;
  update public.profiles set display_name = btrim(p_display_name) where id = auth.uid();
end $$;

-- -----------------------------------------------------------------------------
-- YETKİLER
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.public_plans(), public.platform_is_admin(), public.active_announcements(),
  public.admin_overview(), public.admin_tenants(), public.admin_tenant_detail(uuid), public.admin_update_tenant(uuid, jsonb),
  public.admin_set_subscription(uuid, jsonb), public.admin_renew_subscription(uuid, text, numeric, text, text),
  public.admin_add_payment(uuid, jsonb), public.admin_delete_payment(uuid), public.admin_create_tenant(jsonb),
  public.admin_set_tenant_status(uuid, boolean), public.admin_plans(), public.admin_save_plan(jsonb),
  public.admin_delete_plan(text), public.admin_users(), public.admin_set_user_suspended(uuid, boolean),
  public.admin_audit(text, int), public.admin_announcements(), public.admin_save_announcement(jsonb),
  public.admin_delete_announcement(uuid), public.admin_save_profile(text) from public, anon;

grant execute on function public.public_plans() to anon, authenticated;
grant execute on function public.platform_is_admin(), public.active_announcements(),
  public.admin_overview(), public.admin_tenants(), public.admin_tenant_detail(uuid), public.admin_update_tenant(uuid, jsonb),
  public.admin_set_subscription(uuid, jsonb), public.admin_renew_subscription(uuid, text, numeric, text, text),
  public.admin_add_payment(uuid, jsonb), public.admin_delete_payment(uuid), public.admin_create_tenant(jsonb),
  public.admin_set_tenant_status(uuid, boolean), public.admin_plans(), public.admin_save_plan(jsonb),
  public.admin_delete_plan(text), public.admin_users(), public.admin_set_user_suspended(uuid, boolean),
  public.admin_audit(text, int), public.admin_announcements(), public.admin_save_announcement(jsonb),
  public.admin_delete_announcement(uuid), public.admin_save_profile(text) to authenticated;
