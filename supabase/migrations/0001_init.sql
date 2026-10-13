-- =============================================================================
-- OSION — Supabase şeması (0001)
--
-- Supabase panelinde SQL Editor'e yapıştırılıp bir kez çalıştırılır.
-- Hem ortak (abonelik) projede hem de lisanslı müşterinin kendi projesinde aynıdır.
--
-- GÜVENLİK MODELİ (ÖZET)
-- - Her işletme verisi satırı tenant_id taşır; satır düzeyi güvenlik (RLS) yalnızca
--   kullanıcının aktif üyesi olduğu işletmelerin satırlarına izin verir.
-- - Araç → müşteri, servis kaydı → araç ilişkileri (tenant_id, id) bileşik yabancı
--   anahtarıyla kurulur; başka işletmenin kaydına bağlanmak veritabanı düzeyinde imkânsızdır.
-- - Plan / abonelik sütunlarını kullanıcılar değiştiremez (sütun yetkileri).
-- - Abonelik veya deneme süresi bitmiş işletme verileri okuyabilir ama yazamaz.
-- - Davet kodları yalnızca SHA-256 özetiyle saklanır.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- PLANLAR
-- -----------------------------------------------------------------------------
create table public.plans (
  id text primary key,
  name text not null,
  max_users int not null check (max_users > 0),
  sort int not null default 0
);

insert into public.plans (id, name, max_users, sort) values
  ('trial', 'Deneme', 3, 0),
  ('basic', 'Temel', 3, 1),
  ('pro', 'Profesyonel', 15, 2),
  ('lifetime', 'Ömür Boyu Lisans', 15, 3);

-- -----------------------------------------------------------------------------
-- İŞLETMELER
-- -----------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  phone text not null default '' check (phone = '' or phone ~ '^[0-9+()[:space:]-]{7,25}$'),
  address text not null default '' check (char_length(address) <= 300),
  logo_data_url text not null default '' check (
    logo_data_url = '' or (char_length(logo_data_url) <= 45000
      and logo_data_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$')),
  currency text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD', 'GBP')),
  locale text not null default 'tr-TR' check (locale in ('tr-TR', 'en-US', 'en-GB', 'de-DE')),
  date_format text not null default 'DD.MM.YYYY' check (date_format in ('DD.MM.YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY')),
  legal_name text not null default '' check (char_length(legal_name) <= 150),
  tax_office text not null default '' check (char_length(tax_office) <= 80),
  tax_number text not null default '' check (tax_number = '' or tax_number ~ '^[0-9]{10,11}$'),
  setup_completed boolean not null default false,
  status text not null default 'active' check (status in ('active', 'closed')),
  plan_id text not null default 'trial' references public.plans (id),
  subscription_status text not null default 'trialing'
    check (subscription_status in ('trialing', 'active', 'past_due', 'canceled')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  billing_provider text,
  billing_customer_id text,
  billing_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  delete_after timestamptz,
  -- Kurulum tamamlanmış işletmenin iletişim bilgileri dolu olmalıdır.
  constraint tenants_setup_requires_contact check (
    not setup_completed or (char_length(phone) > 0 and char_length(address) >= 5))
);

-- -----------------------------------------------------------------------------
-- KULLANICI PROFİLLERİ, ÜYELİKLER, DAVETLER, DENETİM KAYDI
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'staff')),
  status text not null default 'active' check (status in ('active', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'admin', 'staff')),
  code_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz
);
create index invitations_tenant_idx on public.invitations (tenant_id);

-- Yalnızca kimlikler tutulur; müşteri adı, telefon gibi kişisel veriler yazılmaz.
create table public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid,
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  created_at timestamptz not null default now()
);
create index audit_log_tenant_idx on public.audit_log (tenant_id, created_at desc);

-- -----------------------------------------------------------------------------
-- İŞLETME VERİLERİ: MÜŞTERİ / ARAÇ / SERVİS KAYDI
-- -----------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 60),
  last_name text not null check (char_length(last_name) between 1 and 60),
  phone text not null check (phone ~ '^[0-9+()[:space:]-]{7,25}$'),
  reference text not null default '' check (char_length(reference) <= 120),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index customers_tenant_idx on public.customers (tenant_id);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid not null,
  brand text not null check (char_length(brand) between 1 and 40),
  model text not null check (char_length(model) between 1 and 80),
  plate text not null check (char_length(plate) between 1 and 15),
  chassis_no text not null default '' check (char_length(chassis_no) <= 30),
  entry_date date not null default ((now() at time zone 'Europe/Istanbul')::date),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete cascade
);
create index vehicles_tenant_idx on public.vehicles (tenant_id);
create index vehicles_customer_idx on public.vehicles (tenant_id, customer_id);

-- Usta/işçilik kalemleri fees ve notes içinde { "<usta anahtarı>": değer } olarak tutulur.
create table public.service_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  vehicle_id uuid not null,
  entry_km numeric(12, 2) not null check (entry_km between 0 and 10000000),
  record_date date not null,
  fees jsonb not null default '{}'::jsonb,
  notes jsonb not null default '{}'::jsonb,
  general_summary text not null default '' check (char_length(general_summary) <= 4000),
  payment_status text not null default 'Ödenmedi' check (payment_status in
    ('Ödenmedi', 'Kısmi Ödendi', 'Nakit Ödendi', 'Havale Yapıldı', 'Kartla Ödendi', 'Ödendi')),
  total_amount numeric(14, 2) not null default 0,
  paid_amount numeric(14, 2) not null default 0,
  remaining_amount numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, vehicle_id) references public.vehicles (tenant_id, id) on delete cascade
);
create index service_records_tenant_idx on public.service_records (tenant_id, record_date desc);
create index service_records_vehicle_idx on public.service_records (tenant_id, vehicle_id);

-- -----------------------------------------------------------------------------
-- YARDIMCI FONKSİYONLAR
-- -----------------------------------------------------------------------------

-- Hata kodu istemciye PostgREST yanıtındaki "hint" alanıyla iletilir.
create function private.fail(p_code text, p_message text) returns void
language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_message, hint = p_code;
end $$;

-- Oturumdaki kullanıcının aktif üyesi olduğu (isteğe bağlı: belirli rollerle) işletmeler.
-- RLS ilkelerinde "tenant_id in (select ...)" biçiminde kullanılır; sorgu başına bir kez çalışır.
create function public.my_tenant_ids(p_roles text[] default null) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.tenant_id
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and t.status = 'active'
    and (p_roles is null or m.role = any (p_roles));
$$;

create function private.member_role(p_tenant uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active' and t.status = 'active';
$$;

create function private.require_role(p_tenant uuid, p_roles text[]) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.member_role(p_tenant);
begin
  if auth.uid() is null then
    perform private.fail('AUTH_REQUIRED', 'Bu işlem için giriş yapmalısınız.');
  end if;
  if v_role is null then
    perform private.fail('FORBIDDEN', 'Bu işletmeye erişiminiz bulunmuyor.');
  end if;
  if not (v_role = any (p_roles)) then
    perform private.fail('FORBIDDEN', 'Bu işlem için yetkiniz bulunmuyor.');
  end if;
  return v_role;
end $$;

-- Abonelik kuralı: deneme süresi içinde veya aktif/ödeme süresi içinde yazılabilir.
-- current_period_end boş + active = süresiz (ömür boyu lisans).
create function private.tenant_can_write(t public.tenants) returns boolean
language sql stable as $$
  select t.status = 'active' and (
    (t.subscription_status = 'trialing' and t.trial_ends_at > now())
    or (t.subscription_status = 'active' and (t.current_period_end is null or t.current_period_end > now() - interval '3 days'))
    or (t.subscription_status = 'past_due' and t.current_period_end > now() - interval '7 days')
  );
$$;

create function private.assert_tenant_writable(p_tenant uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.tenants;
begin
  select * into t from public.tenants where id = p_tenant;
  if not found or t.status <> 'active' then
    perform private.fail('TENANT_INACTIVE', 'Bu işletme hesabı aktif değil.');
  end if;
  if not t.setup_completed then
    perform private.fail('SETUP_REQUIRED', 'İşletme kurulumu tamamlanmadan bu işlem yapılamaz.');
  end if;
  if not private.tenant_can_write(t) then
    perform private.fail('SUBSCRIPTION_INACTIVE',
      'Deneme süreniz veya aboneliğiniz sona erdi. Kayıtlarınızı görüntüleyebilirsiniz; yeni kayıt ve düzenleme için aboneliğinizi yenileyin.');
  end if;
end $$;

create function private.normalize_phone(p text) returns text
language sql immutable as $$
  select case when btrim(coalesce(p, '')) ~ '^[0-9]{10}$' then '0' || btrim(p) else btrim(coalesce(p, '')) end;
$$;

create function private.technician_keys() returns text[]
language sql immutable as $$
  select array['mechanic', 'electrician', 'boyaci', 'cikmaci', 'egzozcu', 'frenci', 'kapakci', 'kaportaci',
    'kurtarici', 'parcaci', 'pompaci', 'tornaci', 'turbocu', 'tupcu', 'yagci', 'yikamaci'];
$$;

create function private.audit(p_tenant uuid, p_action text, p_entity text, p_entity_id text) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id)
  values (p_tenant, auth.uid(), p_action, p_entity, p_entity_id);
$$;

-- -----------------------------------------------------------------------------
-- TETİKLEYİCİLER
-- -----------------------------------------------------------------------------

-- Kimlik, işletme ve oluşturma zamanı değiştirilemez; updated_at sunucuda belirlenir.
create function private.touch_row() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.id := old.id;
    new.created_at := old.created_at;
    if to_jsonb(new) ? 'tenant_id' then
      new := jsonb_populate_record(new, jsonb_build_object('tenant_id', to_jsonb(old) -> 'tenant_id'));
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Oturumdaki kullanıcı yazarken işletmenin yazılabilir olması gerekir.
-- Bakım işleri (oturumsuz çağrılar ve osion.maintenance bayrağı) bu kuraldan muaftır.
create function private.enforce_writable() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_check boolean := auth.uid() is not null and coalesce(current_setting('osion.maintenance', true), '') <> 'on';
begin
  if tg_op = 'DELETE' then
    if v_check then perform private.assert_tenant_writable(old.tenant_id); end if;
    return old;
  end if;
  if v_check then perform private.assert_tenant_writable(new.tenant_id); end if;
  return new;
end $$;

create function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.audit(old.tenant_id, 'delete', tg_argv[0], old.id::text);
  else
    perform private.audit(new.tenant_id, lower(tg_op), tg_argv[0], new.id::text);
  end if;
  return null;
end $$;

create function private.normalize_customer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.first_name := btrim(new.first_name);
  new.last_name := btrim(new.last_name);
  new.phone := private.normalize_phone(new.phone);
  new.reference := btrim(coalesce(new.reference, ''));
  new.notes := btrim(coalesce(new.notes, ''));
  return new;
end $$;

create function private.normalize_vehicle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.brand := btrim(new.brand);
  new.model := btrim(new.model);
  new.plate := upper(regexp_replace(coalesce(new.plate, ''), '[[:space:]]+', '', 'g'));
  new.chassis_no := upper(btrim(coalesce(new.chassis_no, '')));
  new.notes := btrim(coalesce(new.notes, ''));
  if new.entry_date is null then
    new.entry_date := (now() at time zone 'Europe/Istanbul')::date;
  end if;
  return new;
end $$;

-- İş kuralı: toplam tutar her zaman usta/işçilik ücretlerinin toplamıdır.
create function private.normalize_service_record() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text;
  v numeric;
  n text;
  total numeric := 0;
  clean_fees jsonb := '{}'::jsonb;
  clean_notes jsonb := '{}'::jsonb;
begin
  foreach k in array private.technician_keys() loop
    begin
      v := coalesce(nullif(btrim(coalesce(new.fees ->> k, '')), '')::numeric, 0);
    exception when others then
      perform private.fail('VALIDATION', 'İşçilik ücreti geçerli bir sayı olmalıdır.');
    end;
    if v < 0 then perform private.fail('VALIDATION', 'İşçilik ücreti negatif olamaz.'); end if;
    if v > 1000000000 then perform private.fail('VALIDATION', 'İşçilik ücreti çok büyük.'); end if;
    v := round(v, 2);
    n := btrim(coalesce(new.notes ->> k, ''));
    if char_length(n) > 2000 then perform private.fail('VALIDATION', 'İşlem notu en fazla 2000 karakter olabilir.'); end if;
    clean_fees := clean_fees || jsonb_build_object(k, v);
    clean_notes := clean_notes || jsonb_build_object(k, n);
    total := total + v;
  end loop;

  new.fees := clean_fees;
  new.notes := clean_notes;
  new.general_summary := btrim(coalesce(new.general_summary, ''));
  new.total_amount := round(total, 2);
  if new.payment_status = 'Kısmi Ödendi' then
    new.paid_amount := round(least(greatest(coalesce(new.paid_amount, 0), 0), new.total_amount), 2);
    new.remaining_amount := new.total_amount - new.paid_amount;
  else
    new.paid_amount := 0;
    new.remaining_amount := 0;
  end if;
  return new;
end $$;

create function private.normalize_tenant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.name := btrim(new.name);
  new.phone := private.normalize_phone(new.phone);
  new.address := btrim(coalesce(new.address, ''));
  new.legal_name := btrim(coalesce(new.legal_name, ''));
  new.tax_office := btrim(coalesce(new.tax_office, ''));
  new.tax_number := btrim(coalesce(new.tax_number, ''));
  -- Kullanıcı profil kaydettiğinde kurulum tamamlanmış sayılır (iletişim kısıtı ayrıca denetler).
  if tg_op = 'UPDATE' and auth.uid() is not null and new.status = old.status then
    new.setup_completed := true;
  end if;
  return new;
end $$;

create trigger tenants_normalize before insert or update on public.tenants
  for each row execute function private.normalize_tenant();
create trigger tenants_touch before insert or update on public.tenants
  for each row execute function private.touch_row();

create trigger memberships_touch before insert or update on public.memberships
  for each row execute function private.touch_row();

create trigger customers_normalize before insert or update on public.customers
  for each row execute function private.normalize_customer();
create trigger vehicles_normalize before insert or update on public.vehicles
  for each row execute function private.normalize_vehicle();
create trigger service_records_normalize before insert or update on public.service_records
  for each row execute function private.normalize_service_record();

create trigger customers_touch before insert or update on public.customers
  for each row execute function private.touch_row();
create trigger vehicles_touch before insert or update on public.vehicles
  for each row execute function private.touch_row();
create trigger service_records_touch before insert or update on public.service_records
  for each row execute function private.touch_row();

create trigger customers_writable before insert or update or delete on public.customers
  for each row execute function private.enforce_writable();
create trigger vehicles_writable before insert or update or delete on public.vehicles
  for each row execute function private.enforce_writable();
create trigger service_records_writable before insert or update or delete on public.service_records
  for each row execute function private.enforce_writable();

create trigger customers_audit after insert or update or delete on public.customers
  for each row execute function private.audit_row('customer');
create trigger vehicles_audit after insert or update or delete on public.vehicles
  for each row execute function private.audit_row('vehicle');
create trigger service_records_audit after insert or update or delete on public.service_records
  for each row execute function private.audit_row('service_record');

-- -----------------------------------------------------------------------------
-- SATIR DÜZEYİ GÜVENLİK (RLS) VE YETKİLER
-- -----------------------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_log enable row level security;
alter table public.customers enable row level security;
alter table public.vehicles enable row level security;
alter table public.service_records enable row level security;

-- Varsayılan Supabase yetkilerini daraltıp yalnızca gerekenleri açıyoruz.
revoke all on public.plans, public.tenants, public.profiles, public.memberships, public.invitations,
  public.audit_log, public.customers, public.vehicles, public.service_records from anon, authenticated;

grant select on public.plans to anon, authenticated;
create policy plans_read on public.plans for select using (true);

grant select on public.tenants to authenticated;
grant update (name, phone, address, logo_data_url, currency, locale, date_format, legal_name, tax_office, tax_number)
  on public.tenants to authenticated;
create policy tenants_read on public.tenants for select to authenticated
  using (id in (select public.my_tenant_ids()));
create policy tenants_update on public.tenants for update to authenticated
  using (id in (select public.my_tenant_ids(array['owner', 'admin'])))
  with check (id in (select public.my_tenant_ids(array['owner', 'admin'])));

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
create policy profiles_read_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

grant select on public.memberships to authenticated;
create policy memberships_read_own on public.memberships for select to authenticated using (user_id = auth.uid());

-- invitations ve audit_log: doğrudan erişim yok, yalnızca fonksiyonlar üzerinden.

grant select, insert, update, delete on public.customers, public.vehicles, public.service_records to authenticated;

create policy customers_read on public.customers for select to authenticated
  using (tenant_id in (select public.my_tenant_ids()));
create policy customers_insert on public.customers for insert to authenticated
  with check (tenant_id in (select public.my_tenant_ids()));
create policy customers_update on public.customers for update to authenticated
  using (tenant_id in (select public.my_tenant_ids()))
  with check (tenant_id in (select public.my_tenant_ids()));
create policy customers_delete on public.customers for delete to authenticated
  using (tenant_id in (select public.my_tenant_ids(array['owner', 'admin'])));

create policy vehicles_read on public.vehicles for select to authenticated
  using (tenant_id in (select public.my_tenant_ids()));
create policy vehicles_insert on public.vehicles for insert to authenticated
  with check (tenant_id in (select public.my_tenant_ids()));
create policy vehicles_update on public.vehicles for update to authenticated
  using (tenant_id in (select public.my_tenant_ids()))
  with check (tenant_id in (select public.my_tenant_ids()));
create policy vehicles_delete on public.vehicles for delete to authenticated
  using (tenant_id in (select public.my_tenant_ids(array['owner', 'admin'])));

create policy service_records_read on public.service_records for select to authenticated
  using (tenant_id in (select public.my_tenant_ids()));
create policy service_records_insert on public.service_records for insert to authenticated
  with check (tenant_id in (select public.my_tenant_ids()));
create policy service_records_update on public.service_records for update to authenticated
  using (tenant_id in (select public.my_tenant_ids()))
  with check (tenant_id in (select public.my_tenant_ids()));
create policy service_records_delete on public.service_records for delete to authenticated
  using (tenant_id in (select public.my_tenant_ids(array['owner', 'admin'])));

-- -----------------------------------------------------------------------------
-- YENİ KULLANICI: profil + (kayıt formundan geldiyse) deneme işletmesi
-- -----------------------------------------------------------------------------
create function private.accept_invite_for(p_user uuid, p_email text, p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  inv public.invitations;
  t public.tenants;
  m public.memberships;
  v_used int;
  v_max int;
begin
  if char_length(v_code) < 16 then
    perform private.fail('INVALID_INVITE', 'Davet kodu geçersiz, kullanılmış veya süresi dolmuş.');
  end if;
  select * into inv from public.invitations
    where code_hash = encode(sha256(convert_to(v_code, 'UTF8')), 'hex') for update;
  if not found or inv.accepted_at is not null or inv.revoked_at is not null or inv.expires_at <= now() then
    perform private.fail('INVALID_INVITE', 'Davet kodu geçersiz, kullanılmış veya süresi dolmuş.');
  end if;
  if inv.email <> lower(btrim(p_email)) then
    perform private.fail('INVALID_INVITE', 'Bu davet farklı bir e-posta adresi için oluşturulmuş.');
  end if;
  select * into t from public.tenants where id = inv.tenant_id;
  if not found or t.status <> 'active' then
    perform private.fail('INVALID_INVITE', 'Davet kodu geçersiz, kullanılmış veya süresi dolmuş.');
  end if;

  select * into m from public.memberships where tenant_id = inv.tenant_id and user_id = p_user for update;
  if found and m.status = 'active' then
    perform private.fail('CONFLICT', 'Bu işletmenin zaten üyesisiniz. Giriş yapabilirsiniz.');
  end if;
  if inv.role <> 'owner' then
    select count(*) into v_used from public.memberships where tenant_id = inv.tenant_id and status = 'active';
    select max_users into v_max from public.plans where id = t.plan_id;
    if v_used >= v_max then
      perform private.fail('PLAN_LIMIT', 'İşletmenin kullanıcı sınırı dolu. İşletme yöneticinizle iletişime geçin.');
    end if;
  end if;

  insert into public.memberships (tenant_id, user_id, role, status)
    values (inv.tenant_id, p_user, inv.role, 'active')
    on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active';
  update public.invitations set accepted_at = now() where id = inv.id;
  insert into public.audit_log (tenant_id, user_id, action, entity, entity_id)
    values (inv.tenant_id, p_user, 'accept', 'invitation', inv.id::text);
  return inv.tenant_id;
end $$;

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_business text := btrim(coalesce(meta ->> 'business_name', ''));
  v_tenant uuid;
begin
  insert into public.profiles (id, email, display_name)
    values (new.id, lower(new.email), left(btrim(coalesce(meta ->> 'display_name', '')), 80))
    on conflict (id) do nothing;

  if char_length(v_business) >= 2 then
    insert into public.tenants (name, plan_id, subscription_status, trial_ends_at)
      values (left(v_business, 80), 'trial', 'trialing', now() + interval '30 days')
      returning id into v_tenant;
    insert into public.memberships (tenant_id, user_id, role) values (v_tenant, new.id, 'owner');
    insert into public.audit_log (tenant_id, user_id, action, entity, entity_id)
      values (v_tenant, new.id, 'register', 'tenant', v_tenant::text);
  end if;

  -- Davetle kayıt: kod önceden check_invite ile doğrulanır. Burada oluşacak bir hata
  -- hesabın açılmasını engellememeli; kullanıcı girişten sonra kodu tekrar deneyebilir.
  if coalesce(meta ->> 'invite_code', '') <> '' then
    begin
      perform private.accept_invite_for(new.id, new.email, meta ->> 'invite_code');
    exception when others then
      null;
    end;
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- İSTEMCİNİN ÇAĞIRDIĞI FONKSİYONLAR (RPC)
-- -----------------------------------------------------------------------------

-- Açılışta tek istekte oturum bilgisi + işletme verileri.
create function public.app_bootstrap(p_tenant uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_tenants jsonb;
  v_count int;
  v_tenant_id uuid;
  t public.tenants;
  p public.plans;
  v_role text;
  v_profile public.profiles;
  v_email text;
begin
  if v_uid is null then
    perform private.fail('AUTH_REQUIRED', 'Bu işlem için giriş yapmalısınız.');
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  select email into v_email from auth.users where id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'role', m.role) order by x.created_at), '[]'::jsonb),
         count(*)
    into v_tenants, v_count
    from public.memberships m join public.tenants x on x.id = m.tenant_id
    where m.user_id = v_uid and m.status = 'active' and x.status = 'active';

  if p_tenant is not null and p_tenant in (select public.my_tenant_ids()) then
    v_tenant_id := p_tenant;
  elsif v_count = 1 then
    v_tenant_id := (v_tenants -> 0 ->> 'id')::uuid;
  end if;

  if v_tenant_id is null then
    return jsonb_build_object(
      'user', jsonb_build_object('id', v_uid, 'email', v_email, 'displayName', coalesce(v_profile.display_name, '')),
      'tenants', v_tenants,
      'needsTenantChoice', v_count > 1,
      'noTenant', v_count = 0);
  end if;

  select * into t from public.tenants where id = v_tenant_id;
  select * into p from public.plans where id = t.plan_id;
  v_role := private.member_role(v_tenant_id);

  return jsonb_build_object(
    'user', jsonb_build_object('id', v_uid, 'email', v_email, 'displayName', coalesce(v_profile.display_name, '')),
    'tenants', v_tenants,
    'role', v_role,
    'tenant', to_jsonb(t) - array['billing_customer_id', 'billing_subscription_id'],
    'plan', jsonb_build_object(
      'id', p.id, 'name', p.name, 'maxUsers', p.max_users,
      'subscriptionStatus', t.subscription_status,
      'trialEndsAt', t.trial_ends_at,
      'currentPeriodEnd', t.current_period_end,
      'canWrite', private.tenant_can_write(t),
      'billingEnabled', false,
      'dataRetentionDays', 30),
    'data', case when t.setup_completed then jsonb_build_object(
      'customers', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.customers c where c.tenant_id = v_tenant_id), '[]'::jsonb),
      'vehicles', coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at) from public.vehicles v where v.tenant_id = v_tenant_id), '[]'::jsonb),
      'serviceRecords', coalesce((select jsonb_agg(to_jsonb(s) order by s.record_date, s.created_at) from public.service_records s where s.tenant_id = v_tenant_id), '[]'::jsonb)
    ) else null end);
end $$;

-- Kayıt öncesi davet kodunu doğrular (giriş yapmamış kullanıcı da çağırabilir).
-- Kod 96 bit rastgeledir; deneme yanılma ile bulunamaz.
create function public.check_invite(p_code text, p_email text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  inv public.invitations;
  v_name text;
begin
  select * into inv from public.invitations
    where code_hash = encode(sha256(convert_to(v_code, 'UTF8')), 'hex');
  if not found or inv.accepted_at is not null or inv.revoked_at is not null or inv.expires_at <= now() then
    perform private.fail('INVALID_INVITE', 'Davet kodu geçersiz, kullanılmış veya süresi dolmuş.');
  end if;
  if inv.email <> lower(btrim(coalesce(p_email, ''))) then
    perform private.fail('INVALID_INVITE', 'Bu davet farklı bir e-posta adresi için oluşturulmuş.');
  end if;
  select name into v_name from public.tenants where id = inv.tenant_id and status = 'active';
  if v_name is null then
    perform private.fail('INVALID_INVITE', 'Davet kodu geçersiz, kullanılmış veya süresi dolmuş.');
  end if;
  return jsonb_build_object('tenantName', v_name, 'role', inv.role);
end $$;

create function public.accept_invite(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
begin
  if auth.uid() is null then
    perform private.fail('AUTH_REQUIRED', 'Bu işlem için giriş yapmalısınız.');
  end if;
  select email into v_email from auth.users where id = auth.uid();
  return private.accept_invite_for(auth.uid(), v_email, p_code);
end $$;

create function private.public_invite(r public.invitations) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', r.id, 'email', r.email, 'role', r.role,
    'createdAt', r.created_at, 'expiresAt', r.expires_at);
$$;

create function public.list_members(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_members jsonb;
  v_invites jsonb;
  v_max int;
begin
  perform private.require_role(p_tenant, array['owner', 'admin']);
  select coalesce(jsonb_agg(jsonb_build_object(
      'membershipId', m.id, 'userId', m.user_id,
      'displayName', coalesce(pr.display_name, ''), 'email', coalesce(pr.email, ''),
      'role', m.role, 'createdAt', m.created_at, 'isCurrentUser', m.user_id = auth.uid())
      order by m.created_at), '[]'::jsonb)
    into v_members
    from public.memberships m left join public.profiles pr on pr.id = m.user_id
    where m.tenant_id = p_tenant and m.status = 'active';
  select coalesce(jsonb_agg(private.public_invite(i) order by i.created_at), '[]'::jsonb)
    into v_invites
    from public.invitations i
    where i.tenant_id = p_tenant and i.role <> 'owner'
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now();
  select pl.max_users into v_max from public.tenants t join public.plans pl on pl.id = t.plan_id where t.id = p_tenant;
  return jsonb_build_object('members', v_members, 'invitations', v_invites,
    'seats', jsonb_build_object('used', jsonb_array_length(v_members) + jsonb_array_length(v_invites), 'max', v_max));
end $$;

create function public.create_invite(p_tenant uuid, p_email text, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.require_role(p_tenant, array['owner', 'admin']);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_code text;
  v_used int;
  v_max int;
  inv public.invitations;
begin
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' or char_length(v_email) > 120 then
    perform private.fail('VALIDATION', 'Geçerli bir e-posta adresi girin.');
  end if;
  if p_role not in ('admin', 'staff') then
    perform private.fail('VALIDATION', 'Geçerli bir rol seçin.');
  end if;
  if p_role = 'admin' and v_role <> 'owner' then
    perform private.fail('FORBIDDEN', 'Yönetici davet etme yetkisi yalnızca işletme sahibindedir.');
  end if;
  if exists (select 1 from public.memberships m join public.profiles pr on pr.id = m.user_id
             where m.tenant_id = p_tenant and m.status = 'active' and pr.email = v_email) then
    perform private.fail('CONFLICT', 'Bu kullanıcı zaten işletmenizin üyesi.');
  end if;

  -- Aynı e-postaya bekleyen eski davetler geçersiz olur.
  update public.invitations set revoked_at = now()
    where tenant_id = p_tenant and email = v_email and accepted_at is null and revoked_at is null;

  select count(*) into v_used from (
    select 1 from public.memberships where tenant_id = p_tenant and status = 'active'
    union all
    select 1 from public.invitations where tenant_id = p_tenant and role <> 'owner'
      and accepted_at is null and revoked_at is null and expires_at > now()) s;
  select pl.max_users into v_max from public.tenants t join public.plans pl on pl.id = t.plan_id where t.id = p_tenant;
  if v_used >= v_max then
    perform private.fail('PLAN_LIMIT', 'Planınızın kullanıcı sınırına ulaşıldı (' || v_max ||
      ' kullanıcı). Bekleyen bir daveti iptal edin veya planınızı yükseltin.');
  end if;

  -- 24 rastgele onaltılık karakter (96 bit), 4'lü gruplar halinde.
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) ||
                  substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into public.invitations (tenant_id, email, role, code_hash, invited_by, expires_at)
    values (p_tenant, v_email, p_role, encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), auth.uid(), now() + interval '7 days')
    returning * into inv;
  perform private.audit(p_tenant, 'create', 'invitation', inv.id::text);
  return jsonb_build_object('invitation', private.public_invite(inv),
    'code', regexp_replace(v_code, '(.{4})(?!$)', '\1-', 'g'));
end $$;

create function public.revoke_invite(p_tenant uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_role(p_tenant, array['owner', 'admin']);
  update public.invitations set revoked_at = now()
    where id = p_id and tenant_id = p_tenant and role <> 'owner' and accepted_at is null and revoked_at is null;
  perform private.audit(p_tenant, 'revoke', 'invitation', p_id::text);
end $$;

create function public.update_member_role(p_tenant uuid, p_membership uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships;
begin
  perform private.require_role(p_tenant, array['owner']);
  if p_role not in ('admin', 'staff') then
    perform private.fail('VALIDATION', 'Geçerli bir rol seçin.');
  end if;
  select * into m from public.memberships where id = p_membership and tenant_id = p_tenant and status = 'active';
  if not found then perform private.fail('NOT_FOUND', 'Kullanıcı bulunamadı.'); end if;
  if m.role = 'owner' then perform private.fail('FORBIDDEN', 'İşletme sahibinin rolü değiştirilemez.'); end if;
  update public.memberships set role = p_role where id = m.id;
  perform private.audit(p_tenant, 'change_role', 'membership', m.id::text);
end $$;

create function public.remove_member(p_tenant uuid, p_membership uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.require_role(p_tenant, array['owner', 'admin']);
  m public.memberships;
begin
  select * into m from public.memberships where id = p_membership and tenant_id = p_tenant and status = 'active';
  if not found then perform private.fail('NOT_FOUND', 'Kullanıcı bulunamadı.'); end if;
  if m.role = 'owner' then perform private.fail('FORBIDDEN', 'İşletme sahibi işletmeden çıkarılamaz.'); end if;
  if v_role <> 'owner' and m.role <> 'staff' then
    perform private.fail('FORBIDDEN', 'Yöneticileri yalnızca işletme sahibi çıkarabilir.');
  end if;
  if m.user_id = auth.uid() then perform private.fail('FORBIDDEN', 'Kendinizi işletmeden çıkaramazsınız.'); end if;
  -- RLS üyeliği her istekte denetlediği için erişim anında kesilir.
  update public.memberships set status = 'removed' where id = m.id;
  perform private.audit(p_tenant, 'remove', 'membership', m.id::text);
end $$;

create function public.close_tenant(p_tenant uuid, p_confirm_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
begin
  perform private.require_role(p_tenant, array['owner']);
  select * into t from public.tenants where id = p_tenant for update;
  if btrim(coalesce(p_confirm_name, '')) <> btrim(t.name) then
    perform private.fail('VALIDATION', 'Onay için işletme adını birebir yazın.');
  end if;
  update public.tenants
    set status = 'closed', closed_at = now(), delete_after = now() + interval '30 days'
    where id = p_tenant
    returning * into t;
  update public.invitations set revoked_at = now()
    where tenant_id = p_tenant and accepted_at is null and revoked_at is null;
  perform private.audit(p_tenant, 'close', 'tenant', p_tenant::text);
  return jsonb_build_object('closed', true, 'deleteAfter', t.delete_after);
end $$;

-- Fonksiyon yetkileri: varsayılan PUBLIC çalıştırma iznini kaldırıp açıkça veriyoruz.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function public.my_tenant_ids(text[]) to authenticated;
grant execute on function public.app_bootstrap(uuid) to authenticated;
grant execute on function public.check_invite(text, text) to anon, authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.list_members(uuid) to authenticated;
grant execute on function public.create_invite(uuid, text, text) to authenticated;
grant execute on function public.revoke_invite(uuid, uuid) to authenticated;
grant execute on function public.update_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.close_tenant(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- OPERATÖR İŞLEMLERİ (yalnızca SQL Editor'den, hizmeti işleten taraf çalıştırır)
-- -----------------------------------------------------------------------------

-- Örnekler:
--   select private.set_tenant_plan('<işletme-id>', 'pro', 'active', now() + interval '1 month');
--   select private.set_tenant_plan('<işletme-id>', 'lifetime', 'active', null);   -- tek seferlik lisans
create function private.set_tenant_plan(p_tenant uuid, p_plan text, p_status text, p_period_end timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.plans where id = p_plan) then
    raise exception 'Bilinmeyen plan: %', p_plan;
  end if;
  update public.tenants
    set plan_id = p_plan, subscription_status = p_status, current_period_end = p_period_end
    where id = p_tenant;
  if not found then raise exception 'İşletme bulunamadı: %', p_tenant; end if;
  insert into public.audit_log (tenant_id, action, entity, entity_id)
    values (p_tenant, 'plan_changed', 'tenant', p_tenant::text);
end $$;

-- Kapatılmış (henüz silinmemiş) bir işletmeyi yeniden etkinleştirir.
create function private.restore_tenant(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.tenants set status = 'active', closed_at = null, delete_after = null
    where id = p_tenant and status = 'closed';
  if not found then raise exception 'Geri alınabilir kapalı işletme bulunamadı.'; end if;
end $$;

-- Saklama süresi dolan kapalı işletmeleri tüm verileriyle kalıcı olarak siler.
create function private.purge_closed_tenants() returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  perform set_config('osion.maintenance', 'on', true);
  delete from public.tenants where status = 'closed' and delete_after <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Günlük silme işi (pg_cron etkinse). Etkin değilse Database > Extensions'tan açıp bu bloğu tekrar çalıştırın.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('osion-purge-closed-tenants', '0 3 * * *', 'select private.purge_closed_tenants()');
exception when others then
  raise notice 'pg_cron zamanlaması kurulamadı: %', sqlerrm;
end $$;
