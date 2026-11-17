-- =====================================================================
--  Cuenta Cindy (Clerk) junto al login propio - migración genérica.
--  Carga de artículos por remito y órdenes de compra (copia del kit kit-cuenta-cindy).
--  Cuentas Cindy nuevas: consulta, desactivadas hasta que un admin las habilite.
--
--  Qué hace (sirve igual para rótulos, Compras, Minorista, Panel IT, RRHH):
--   1. perfiles suma auth_id (login propio) y clerk_id (cuenta Cindy). El id no cambia.
--   2. mi_perfil_id(): "quién soy" para los dos tipos de token. Reemplaza a auth.uid(),
--      que convierte el sub a uuid y con el token de Clerk ("user_...") falla.
--   3. Reescribe SOLO las políticas, funciones y valores por defecto que usan auth.uid()
--      (antes, correr 1-relevamiento.sql para ver la lista).
--   4. Las FK a auth.users pasan a apuntar a perfiles(id).
--   5. mi_perfil(): la página lo llama al entrar. Con cuenta Cindy vincula por el
--      claim "usuario" (public_metadata.usuario) o crea un perfil nuevo con el nombre de Clerk.
--  Requiere: Authentication -> Third Party Auth -> Clerk.
--  Se puede correr dos veces.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) perfiles: auth_id y clerk_id
-- ---------------------------------------------------------------------
alter table public.perfiles add column if not exists auth_id uuid;
alter table public.perfiles add column if not exists clerk_id text;

update public.perfiles p set auth_id = p.id
where p.auth_id is null and p.clerk_id is null
  and exists (select 1 from auth.users u where u.id = p.id);

do $$
declare r record;
begin
  -- FK de perfiles.id a auth.users (el nombre puede variar): se saca
  for r in select conname from pg_constraint
           where conrelid = 'public.perfiles'::regclass and contype = 'f'
             and confrelid = 'auth.users'::regclass
             and conkey = array[(select attnum from pg_attribute
                                 where attrelid = 'public.perfiles'::regclass and attname = 'id')]::int2[]
  loop
    execute format('alter table public.perfiles drop constraint %I', r.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'perfiles_auth_id_fkey') then
    alter table public.perfiles add constraint perfiles_auth_id_fkey
      foreign key (auth_id) references auth.users(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'perfiles_auth_id_key') then
    alter table public.perfiles add constraint perfiles_auth_id_key unique (auth_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'perfiles_clerk_id_key') then
    alter table public.perfiles add constraint perfiles_clerk_id_key unique (clerk_id);
  end if;
end $$;

alter table public.perfiles alter column id set default gen_random_uuid();

-- Altas del login propio (trigger de auth.users o función de usuarios con
-- id = id del usuario): el perfil completa auth_id solo.
create or replace function public.perfil_completar_auth_id()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.auth_id is null and new.clerk_id is null
     and exists (select 1 from auth.users u where u.id = new.id) then
    new.auth_id := new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists perfil_completar_auth_id on public.perfiles;
create trigger perfil_completar_auth_id
  before insert on public.perfiles
  for each row execute function public.perfil_completar_auth_id();

-- ---------------------------------------------------------------------
-- 2) ¿Quién soy?
-- ---------------------------------------------------------------------
create or replace function public.mi_perfil_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select p.id from public.perfiles p
  where (auth.jwt() ->> 'sub') is not null
    and (p.auth_id::text = auth.jwt() ->> 'sub' or p.clerk_id = auth.jwt() ->> 'sub')
  limit 1;
$$;

create or replace function public.es_token_clerk()
returns boolean
language sql stable
as $$
  select coalesce(auth.jwt() ->> 'sub', '') like 'user\_%'
     and coalesce(auth.jwt() ->> 'iss', '') !~ '/auth/v1$';
$$;

-- ---------------------------------------------------------------------
-- 3) Reescribir lo que usa auth.uid()
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  v_sql text;
  v_roles text;
begin
  -- Funciones de public
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and p.prosrc ~ 'auth\.uid\(\)'
  loop
    v_sql := replace(pg_get_functiondef(r.oid), 'auth.uid()', 'public.mi_perfil_id()');
    execute v_sql;
  end loop;

  -- Valores por defecto
  for r in select c.table_name, c.column_name, c.column_default from information_schema.columns c
           where c.table_schema = 'public' and c.column_default ~ 'auth\.uid\(\)'
  loop
    execute format('alter table public.%I alter column %I set default %s',
                   r.table_name, r.column_name, replace(r.column_default, 'auth.uid()', 'public.mi_perfil_id()'));
  end loop;

  -- Políticas
  for r in select * from pg_policies
           where schemaname = 'public' and coalesce(qual, '') || coalesce(with_check, '') ~ 'auth\.uid\(\)'
  loop
    select string_agg(case when x = 'public' then 'public' else quote_ident(x) end, ', ')
      into v_roles from unnest(r.roles) x;
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    execute format('create policy %I on public.%I as %s for %s to %s%s%s',
      r.policyname, r.tablename, r.permissive, r.cmd, v_roles,
      case when r.qual is not null then ' using (' || replace(r.qual, 'auth.uid()', 'public.mi_perfil_id()') || ')' else '' end,
      case when r.with_check is not null then ' with check (' || replace(r.with_check, 'auth.uid()', 'public.mi_perfil_id()') || ')' else '' end);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4) FK a auth.users -> perfiles(id)  ("creado por", "cargado por", etc.)
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select c.conname, c.conrelid::regclass as tabla, a.attname as columna,
                  case c.confdeltype when 'c' then 'cascade' when 'n' then 'set null'
                                     when 'r' then 'restrict' when 'd' then 'set default'
                                     else 'no action' end as al_borrar
           from pg_constraint c
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
           where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
             and c.connamespace = 'public'::regnamespace
             and c.conname <> 'perfiles_auth_id_fkey' and array_length(c.conkey, 1) = 1
  loop
    execute format('alter table %s drop constraint %I', r.tabla, r.conname);
    execute format('alter table %s add constraint %I foreign key (%I) references public.perfiles(id) on delete %s not valid',
                   r.tabla, r.conname, r.columna, r.al_borrar);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5) mi_perfil()
-- ---------------------------------------------------------------------
create or replace function public.mi_perfil()
returns table (id uuid, email text, nombre text, rol text, activo boolean, via text, tiene_login_propio boolean)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_sub      text := auth.jwt() ->> 'sub';
  v_id       uuid;
  v_usuario  text := lower(trim(coalesce(auth.jwt() ->> 'usuario', '')));
  v_username text := lower(trim(coalesce(auth.jwt() ->> 'username', '')));
  v_nombre   text := trim(concat_ws(' ', nullif(trim(auth.jwt() ->> 'nombre'), ''), nullif(trim(auth.jwt() ->> 'apellido'), '')));
  v_dominio  constant text    := 'compras.cindymayorista.com.ar';  -- antonella -> antonella@compras.cindymayorista.com.ar
  v_rol      constant text    := 'consulta';  -- solo lectura; el admin le cambia el rol
  v_activa   constant boolean := false;    -- un admin la activa
begin
  if v_sub is null then return; end if;
  v_id := public.mi_perfil_id();

  if v_id is null and public.es_token_clerk() then
    -- "usuario" puede ser el usuario corto (luca -> luca@dominio) o el mail completo
    if v_usuario ~ '^[a-z0-9._+-]+(@[a-z0-9.-]+)?$' then
      update public.perfiles p set clerk_id = v_sub
      where p.id = (select q.id from public.perfiles q
                    where q.clerk_id is null
                      and lower(q.email) = case when v_usuario like '%@%' then v_usuario else v_usuario || '@' || v_dominio end
                    limit 1)
      returning p.id into v_id;
    end if;
    if v_id is null then
      insert into public.perfiles (email, nombre, rol, activo, clerk_id)
      values (coalesce(nullif(v_username, ''), nullif(v_usuario, ''), v_sub),
              coalesce(nullif(v_nombre, ''), nullif(v_username, ''), nullif(v_usuario, ''), ''),
              v_rol, v_activa, v_sub)
      on conflict (clerk_id) do nothing;
      v_id := public.mi_perfil_id();
    end if;
  end if;

  -- Cuenta solo Cindy: nombre y usuario al día con Clerk (rol y estado no se tocan)
  if v_id is not null and public.es_token_clerk() then
    update public.perfiles p
       set nombre = coalesce(nullif(v_nombre, ''), nullif(v_username, ''), p.nombre),
           email  = coalesce(nullif(v_username, ''), p.email)
     where p.id = v_id and p.auth_id is null
       and (p.nombre is distinct from coalesce(nullif(v_nombre, ''), nullif(v_username, ''), p.nombre)
            or p.email is distinct from coalesce(nullif(v_username, ''), p.email));
  end if;

  return query
    select p.id, p.email, p.nombre, p.rol, p.activo,
           case when public.es_token_clerk() then 'clerk' else 'propio' end,
           p.auth_id is not null
    from public.perfiles p where p.id = v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 6) Permisos
-- ---------------------------------------------------------------------
revoke execute on function public.mi_perfil_id(), public.es_token_clerk(), public.mi_perfil(),
  public.perfil_completar_auth_id() from anon, public;
grant execute on function public.mi_perfil_id(), public.es_token_clerk(), public.mi_perfil() to authenticated;

-- ---------------------------------------------------------------------
-- 7) restaurar_tabla(): "usuarios que ya no existen" se busca en perfiles
--    (cargado_por / actualizado_por ahora apuntan a perfiles, y una cuenta
--    solo Cindy no está en auth.users)
-- ---------------------------------------------------------------------
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.restaurar_tabla(text, jsonb)'::regprocedure) into v_def;
  if v_def ~ 'from auth\.users u where u\.id::text' then
    execute replace(v_def, 'from auth.users u where u.id::text', 'from public.perfiles u where u.id::text');
  end if;
end $$;
