-- Punto · base de datos en Supabase
-- Pegar completo en: Supabase → SQL Editor → New query → Run.
-- Se puede ejecutar más de una vez sin romper nada.
--
-- Diseño:
-- - La tabla no es accesible directamente desde la app (RLS sin políticas).
-- - La app solo usa 4 funciones: guardar, buscar por código, mis lugares y eliminar.
-- - Cada teléfono tiene una clave secreta propia (nunca se guarda: solo su hash).
--   Solo con esa clave se pueden ver "mis lugares", editarlos o borrarlos.
-- - Buscar exige el código exacto: no se pueden listar lugares por zona.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.places (
  id          uuid primary key default gen_random_uuid(),
  code        text not null check (code ~ '^[0-9A-HJKMNP-TV-Z]{9}$'),
  name        text not null check (char_length(name) between 1 and 48),
  type        text not null check (type in ('casa', 'edificio', 'negocio')),
  unit        text not null default '' check (char_length(unit) <= 30),
  ref         text not null default '' check (char_length(ref) <= 100),
  area        text not null default '' check (char_length(area) <= 80),
  owner_hash  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists places_code_idx on public.places (code);
create unique index if not exists places_owner_code_unit_uq on public.places (owner_hash, code, lower(unit));

alter table public.places enable row level security;
revoke all on public.places from anon, authenticated;

-- Hash de la clave del teléfono.
create or replace function public.punto_owner(p_secret text)
returns text
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_secret is null or char_length(p_secret) < 32 then
    raise exception 'clave inválida';
  end if;
  return encode(extensions.digest(p_secret, 'sha256'), 'hex');
end;
$$;

-- Guardar (crea o actualiza el lugar de ese teléfono en esa entrada y unidad).
create or replace function public.punto_save(
  p_secret text, p_code text, p_name text, p_type text,
  p_unit text default '', p_ref text default '', p_area text default ''
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner text := public.punto_owner(p_secret);
  v_id uuid;
begin
  if (select count(*) from public.places where owner_hash = v_owner) >= 100 then
    raise exception 'límite de lugares alcanzado';
  end if;

  insert into public.places (code, name, type, unit, ref, area, owner_hash)
  values (upper(p_code), btrim(p_name), p_type, btrim(coalesce(p_unit, '')),
          btrim(coalesce(p_ref, '')), btrim(coalesce(p_area, '')), v_owner)
  on conflict (owner_hash, code, lower(unit)) do update
    set name = excluded.name, type = excluded.type, ref = excluded.ref,
        area = excluded.area, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- Buscar por código exacto (lo que ve quien recibe un código dictado).
create or replace function public.punto_lookup(p_code text)
returns table (code text, name text, type text, unit text, ref text, area text)
language sql stable security definer
set search_path = ''
as $$
  select p.code, p.name, p.type, p.unit, p.ref, p.area
  from public.places p
  where p.code = upper(p_code)
  order by p.created_at
  limit 20;
$$;

-- Los lugares registrados desde este teléfono.
create or replace function public.punto_mine(p_secret text)
returns table (code text, name text, type text, unit text, ref text, area text, created_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select p.code, p.name, p.type, p.unit, p.ref, p.area, p.created_at
  from public.places p
  where p.owner_hash = public.punto_owner(p_secret)
  order by p.created_at desc;
$$;

-- Eliminar un lugar propio.
create or replace function public.punto_delete(p_secret text, p_code text, p_unit text default '')
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.places
  where owner_hash = public.punto_owner(p_secret)
    and code = upper(p_code)
    and lower(unit) = lower(btrim(coalesce(p_unit, '')));
  return found;
end;
$$;

revoke all on function public.punto_owner(text) from public, anon, authenticated;
revoke all on function public.punto_save(text, text, text, text, text, text, text) from public;
revoke all on function public.punto_lookup(text) from public;
revoke all on function public.punto_mine(text) from public;
revoke all on function public.punto_delete(text, text, text) from public;
grant execute on function public.punto_save(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.punto_lookup(text) to anon, authenticated;
grant execute on function public.punto_mine(text) to anon, authenticated;
grant execute on function public.punto_delete(text, text, text) to anon, authenticated;
