-- Punto · paso 2: guardar el estado (letra ISO 3166-2:VE) de cada lugar.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede ejecutar más de una vez.
-- No borra datos: los lugares existentes quedan con estado vacío y la app lo completa.

alter table public.places add column if not exists state text not null default '';
alter table public.places drop constraint if exists places_state_check;
alter table public.places add constraint places_state_check check (state ~ '^[A-Z]?$');

drop function if exists public.punto_save(text, text, text, text, text, text, text);
drop function if exists public.punto_save(text, text, text, text, text, text, text, text);
create function public.punto_save(
  p_secret text, p_code text, p_name text, p_type text,
  p_unit text default '', p_ref text default '', p_area text default '', p_state text default ''
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

  insert into public.places (code, name, type, unit, ref, area, state, owner_hash)
  values (upper(p_code), btrim(p_name), p_type, btrim(coalesce(p_unit, '')),
          btrim(coalesce(p_ref, '')), btrim(coalesce(p_area, '')), upper(coalesce(p_state, '')), v_owner)
  on conflict (owner_hash, code, lower(unit)) do update
    set name = excluded.name, type = excluded.type, ref = excluded.ref, area = excluded.area,
        state = case when excluded.state <> '' then excluded.state else public.places.state end,
        updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.punto_lookup(text);
create function public.punto_lookup(p_code text)
returns table (code text, name text, type text, unit text, ref text, area text, state text)
language sql stable security definer
set search_path = ''
as $$
  select p.code, p.name, p.type, p.unit, p.ref, p.area, p.state
  from public.places p
  where p.code = upper(p_code)
  order by p.created_at
  limit 20;
$$;

drop function if exists public.punto_mine(text);
create function public.punto_mine(p_secret text)
returns table (code text, name text, type text, unit text, ref text, area text, state text, created_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select p.code, p.name, p.type, p.unit, p.ref, p.area, p.state, p.created_at
  from public.places p
  where p.owner_hash = public.punto_owner(p_secret)
  order by p.created_at desc;
$$;

revoke all on function public.punto_save(text, text, text, text, text, text, text, text) from public;
revoke all on function public.punto_lookup(text) from public;
revoke all on function public.punto_mine(text) from public;
grant execute on function public.punto_save(text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.punto_lookup(text) to anon, authenticated;
grant execute on function public.punto_mine(text) to anon, authenticated;
