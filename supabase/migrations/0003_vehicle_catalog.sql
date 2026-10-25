-- =============================================================================
-- OSION — Araç model yılı ve işletmeye özel marka/model kataloğu
--
-- * vehicles.model_year : aracın çıkış (model) yılı, isteğe bağlı.
-- * vehicle_catalog     : uygulamadaki hazır marka/model listesine ek olarak işletmenin
--                         kendi eklediği markalar ve modeller. model = '' satırı yalnızca
--                         marka kaydıdır. Tüm ekip üyeleri görür ve ekleyebilir; silme
--                         yalnızca sahip/yöneticiye açıktır.
-- =============================================================================

alter table public.vehicles
  add column if not exists model_year smallint
  check (model_year is null or model_year between 1950 and 2100);

create table if not exists public.vehicle_catalog (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  brand text not null check (char_length(brand) between 1 and 40),
  model text not null default '' check (char_length(model) <= 80),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists vehicle_catalog_unique_idx
  on public.vehicle_catalog (tenant_id, lower(brand), lower(model));

create or replace function private.normalize_vehicle_catalog() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.brand := regexp_replace(btrim(new.brand), '[[:space:]]+', ' ', 'g');
  new.model := regexp_replace(btrim(coalesce(new.model, '')), '[[:space:]]+', ' ', 'g');
  if new.brand = '' then perform private.fail('VALIDATION', 'Marka adı boş olamaz.'); end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  return new;
end $$;

drop trigger if exists vehicle_catalog_normalize on public.vehicle_catalog;
create trigger vehicle_catalog_normalize before insert or update on public.vehicle_catalog
  for each row execute function private.normalize_vehicle_catalog();
drop trigger if exists vehicle_catalog_writable on public.vehicle_catalog;
create trigger vehicle_catalog_writable before insert or update or delete on public.vehicle_catalog
  for each row execute function private.enforce_writable();

alter table public.vehicle_catalog enable row level security;
revoke all on public.vehicle_catalog from anon, authenticated;
grant select, insert, delete on public.vehicle_catalog to authenticated;

drop policy if exists vehicle_catalog_read on public.vehicle_catalog;
create policy vehicle_catalog_read on public.vehicle_catalog for select to authenticated
  using (tenant_id in (select public.my_tenant_ids()));
drop policy if exists vehicle_catalog_insert on public.vehicle_catalog;
create policy vehicle_catalog_insert on public.vehicle_catalog for insert to authenticated
  with check (tenant_id in (select public.my_tenant_ids()));
drop policy if exists vehicle_catalog_delete on public.vehicle_catalog;
create policy vehicle_catalog_delete on public.vehicle_catalog for delete to authenticated
  using (tenant_id in (select public.my_tenant_ids(array['owner', 'admin'])));

revoke execute on all functions in schema private from public, anon, authenticated;
