-- =============================================================================
-- OSION — Araç sahiplerine e-posta (0002)
--
-- İşletme kendi e-posta hesabını (ör. Gmail + uygulama şifresi) tanımlar; servis fişi
-- ve mesajlar araç sahibine işletmenin kendi adresinden gönderilir.
--
-- GÜVENLİK
-- - Uygulama şifresi Supabase Vault'ta şifreli saklanır; hiçbir istemci okuyamaz.
--   Şifreyi yalnızca service_role ile çalışan "send-mail" Edge Function'ı çözer.
-- - Alıcı her zaman veritabanındaki müşteri e-postasıdır (test e-postası işletmenin
--   kendi adresine gider); uygulama rastgele adrese e-posta gönderen bir aktarıcı olamaz.
-- - İşletme başına günlük gönderim sınırı vardır; her deneme mail_log'a yazılır.
-- =============================================================================

do $$
begin
  create extension if not exists supabase_vault;
exception when others then
  raise notice 'supabase_vault etkinleştirilemedi: %', sqlerrm;
end $$;

-- -----------------------------------------------------------------------------
-- MÜŞTERİ E-POSTASI
-- -----------------------------------------------------------------------------
alter table public.customers add column email text not null default ''
  check (email = '' or (char_length(email) <= 120 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'));

create or replace function private.normalize_customer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.first_name := btrim(new.first_name);
  new.last_name := btrim(new.last_name);
  new.phone := private.normalize_phone(new.phone);
  new.email := lower(btrim(coalesce(new.email, '')));
  new.reference := btrim(coalesce(new.reference, ''));
  new.notes := btrim(coalesce(new.notes, ''));
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- İŞLETME E-POSTA AYARLARI VE GÖNDERİM GÜNLÜĞÜ
-- -----------------------------------------------------------------------------
-- Supabase Edge Functions 25 ve 587 numaralı portlara bağlanamaz; bu nedenle
-- yalnızca SSL (465) destekleyen sağlayıcılar kullanılır.
create table public.tenant_mail_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  provider text not null check (provider in ('gmail', 'yandex', 'yahoo', 'custom')),
  smtp_host text not null check (smtp_host ~ '^[A-Za-z0-9.-]{3,253}$'),
  smtp_port int not null default 465 check (smtp_port = 465),
  smtp_user text not null check (char_length(smtp_user) <= 120 and smtp_user ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),
  from_name text not null default '' check (char_length(from_name) <= 80),
  secret_id uuid not null,
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.mail_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid,
  kind text not null check (kind in ('test', 'receipt', 'message')),
  customer_id uuid,
  service_record_id uuid,
  recipient text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);
create index mail_log_tenant_idx on public.mail_log (tenant_id, created_at desc);

alter table public.tenant_mail_settings enable row level security;
alter table public.mail_log enable row level security;
revoke all on public.tenant_mail_settings, public.mail_log from anon, authenticated;

create function private.mail_daily_limit() returns int
language sql immutable as $$ select 200 $$;

-- -----------------------------------------------------------------------------
-- İSTEMCİ FONKSİYONLARI
-- -----------------------------------------------------------------------------

-- Tüm üyeler: e-posta gönderimi yapılandırılmış mı? (şifre ve ayrıntılar dönmez)
create function public.mail_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.tenant_mail_settings;
  v_role text := private.require_role(p_tenant, array['owner', 'admin', 'staff']);
begin
  select * into s from public.tenant_mail_settings where tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('configured', false);
  end if;
  return jsonb_build_object(
    'configured', true,
    'verified', s.verified_at is not null,
    'address', s.smtp_user,
    'fromName', s.from_name,
    'provider', case when v_role in ('owner', 'admin') then s.provider end,
    'host', case when v_role in ('owner', 'admin') then s.smtp_host end);
end $$;

-- Sahip/yönetici: ayarları kaydeder. p_password boş bırakılırsa mevcut şifre korunur.
create function public.save_mail_settings(p_tenant uuid, p_provider text, p_host text, p_user text,
  p_password text, p_from_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.tenant_mail_settings;
  v_host text;
  v_user text := lower(btrim(coalesce(p_user, '')));
  v_password text := regexp_replace(coalesce(p_password, ''), '[[:space:]]', '', 'g');
  v_secret uuid;
begin
  perform private.require_role(p_tenant, array['owner', 'admin']);
  v_host := case p_provider
    when 'gmail' then 'smtp.gmail.com'
    when 'yandex' then 'smtp.yandex.com'
    when 'yahoo' then 'smtp.mail.yahoo.com'
    when 'custom' then lower(btrim(coalesce(p_host, '')))
  end;
  if v_host is null then
    perform private.fail('VALIDATION', 'Geçerli bir e-posta sağlayıcısı seçin.');
  end if;
  if v_host !~ '^[a-z0-9.-]{3,253}$' or v_host !~ '\.' then
    perform private.fail('VALIDATION', 'SMTP sunucu adresi geçersiz.');
  end if;
  if v_user !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' or char_length(v_user) > 120 then
    perform private.fail('VALIDATION', 'Geçerli bir e-posta adresi girin.');
  end if;
  if char_length(btrim(coalesce(p_from_name, ''))) > 80 then
    perform private.fail('VALIDATION', 'Gönderen adı en fazla 80 karakter olabilir.');
  end if;
  if char_length(v_password) > 200 then
    perform private.fail('VALIDATION', 'Uygulama şifresi çok uzun.');
  end if;

  select * into s from public.tenant_mail_settings where tenant_id = p_tenant for update;
  if not found and v_password = '' then
    perform private.fail('VALIDATION', 'Uygulama şifresini girin.');
  end if;

  if found then
    v_secret := s.secret_id;
    if v_password <> '' then
      perform vault.update_secret(v_secret, v_password);
    end if;
    update public.tenant_mail_settings
      set provider = p_provider, smtp_host = v_host, smtp_user = v_user,
          from_name = btrim(coalesce(p_from_name, '')), updated_at = now(),
          -- Hesap veya şifre değişince test e-postasıyla yeniden doğrulanmalıdır.
          verified_at = case when v_password = '' and s.smtp_user = v_user and s.smtp_host = v_host then s.verified_at end
      where tenant_id = p_tenant;
  else
    v_secret := vault.create_secret(v_password, 'osion_mail_' || p_tenant::text, 'OSION işletme SMTP uygulama şifresi');
    insert into public.tenant_mail_settings (tenant_id, provider, smtp_host, smtp_user, from_name, secret_id)
      values (p_tenant, p_provider, v_host, v_user, btrim(coalesce(p_from_name, '')), v_secret);
  end if;
  perform private.audit(p_tenant, 'mail_settings_saved', 'tenant', p_tenant::text);
  return public.mail_status(p_tenant);
end $$;

create function public.delete_mail_settings(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_secret uuid;
begin
  perform private.require_role(p_tenant, array['owner', 'admin']);
  delete from public.tenant_mail_settings where tenant_id = p_tenant returning secret_id into v_secret;
  if v_secret is not null then
    begin
      delete from vault.secrets where id = v_secret;
    exception when others then
      raise notice 'Vault kaydı silinemedi: %', sqlerrm;
    end;
  end if;
  perform private.audit(p_tenant, 'mail_settings_deleted', 'tenant', p_tenant::text);
end $$;

-- Edge Function, kullanıcının oturumuyla çağırır: yetki, abonelik, alıcı ve günlük sınır
-- burada denetlenir; gönderilecek içerik için gereken veriler döner ve deneme günlüğe yazılır.
create function public.mail_prepare(p_tenant uuid, p_kind text, p_customer uuid default null,
  p_record uuid default null, p_subject text default null, p_message text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  s public.tenant_mail_settings;
  c public.customers;
  v public.vehicles;
  r public.service_records;
  v_sent_today int;
  v_to text;
  v_log bigint;
  v_subject text := btrim(coalesce(p_subject, ''));
  v_message text := btrim(coalesce(p_message, ''));
begin
  perform private.require_role(p_tenant, case when p_kind = 'test' then array['owner', 'admin'] else array['owner', 'admin', 'staff'] end);
  perform private.assert_tenant_writable(p_tenant);
  select * into t from public.tenants where id = p_tenant;
  select * into s from public.tenant_mail_settings where tenant_id = p_tenant;
  if not found then
    perform private.fail('MAIL_NOT_CONFIGURED', 'E-posta gönderimi ayarlanmamış. İşletme Ayarları > E-posta bölümünden e-posta hesabınızı ekleyin.');
  end if;

  select count(*) into v_sent_today from public.mail_log
    where tenant_id = p_tenant and created_at > now() - interval '24 hours';
  if v_sent_today >= private.mail_daily_limit() then
    perform private.fail('RATE_LIMITED', 'Günlük e-posta gönderim sınırına ulaşıldı. Lütfen yarın tekrar deneyin.');
  end if;

  if p_kind = 'test' then
    v_to := s.smtp_user;
  elsif p_kind = 'receipt' then
    select * into r from public.service_records where id = p_record and tenant_id = p_tenant;
    if not found then perform private.fail('NOT_FOUND', 'Servis kaydı bulunamadı.'); end if;
    select * into v from public.vehicles where id = r.vehicle_id and tenant_id = p_tenant;
    select * into c from public.customers where id = v.customer_id and tenant_id = p_tenant;
  elsif p_kind = 'message' then
    select * into c from public.customers where id = p_customer and tenant_id = p_tenant;
    if not found then perform private.fail('NOT_FOUND', 'Müşteri bulunamadı.'); end if;
    if char_length(v_subject) < 2 or char_length(v_subject) > 150 then
      perform private.fail('VALIDATION', 'Konu 2-150 karakter olmalıdır.');
    end if;
    if char_length(v_message) < 2 or char_length(v_message) > 3000 then
      perform private.fail('VALIDATION', 'Mesaj 2-3000 karakter olmalıdır.');
    end if;
  else
    perform private.fail('VALIDATION', 'Geçersiz e-posta türü.');
  end if;

  if p_kind <> 'test' then
    if coalesce(c.email, '') = '' then
      perform private.fail('VALIDATION', 'Bu müşterinin kayıtlı e-posta adresi yok. Önce müşteri bilgilerine e-posta ekleyin.');
    end if;
    v_to := c.email;
  end if;

  insert into public.mail_log (tenant_id, user_id, kind, customer_id, service_record_id, recipient)
    values (p_tenant, auth.uid(), p_kind, c.id, r.id, v_to)
    returning id into v_log;

  return jsonb_build_object(
    'logId', v_log,
    'kind', p_kind,
    'to', v_to,
    'subject', nullif(v_subject, ''),
    'message', nullif(v_message, ''),
    'tenant', jsonb_build_object('name', t.name, 'phone', t.phone, 'address', t.address,
      'currency', t.currency, 'locale', t.locale, 'dateFormat', t.date_format),
    'customer', case when c.id is null then null else jsonb_build_object('firstName', c.first_name, 'lastName', c.last_name) end,
    'vehicle', case when v.id is null then null else jsonb_build_object('brand', v.brand, 'model', v.model, 'plate', v.plate) end,
    'record', case when r.id is null then null else to_jsonb(r) - array['tenant_id'] end);
end $$;

-- Yalnızca Edge Function (service_role): şifreyi çözer.
create function public.mail_credentials(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('host', s.smtp_host, 'port', s.smtp_port, 'user', s.smtp_user,
    'fromName', s.from_name, 'password', d.decrypted_secret)
  from public.tenant_mail_settings s
  join vault.decrypted_secrets d on d.id = s.secret_id
  where s.tenant_id = p_tenant;
$$;

-- Yalnızca Edge Function (service_role): gönderim sonucunu kaydeder.
create function public.mail_finish(p_log bigint, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l public.mail_log;
begin
  update public.mail_log set status = case when p_ok then 'sent' else 'failed' end, error = left(p_error, 300)
    where id = p_log returning * into l;
  if p_ok and l.kind = 'test' then
    update public.tenant_mail_settings set verified_at = now() where tenant_id = l.tenant_id;
  end if;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.check_invite(text, text) to anon, authenticated;
revoke execute on function public.mail_credentials(uuid), public.mail_finish(bigint, boolean, text) from authenticated;
grant execute on function public.mail_credentials(uuid), public.mail_finish(bigint, boolean, text) to service_role;
grant execute on function public.mail_status(uuid) to authenticated;
grant execute on function public.save_mail_settings(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.delete_mail_settings(uuid) to authenticated;
grant execute on function public.mail_prepare(uuid, text, uuid, uuid, text, text) to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
