-- =====================================================================
--  Variantes por color, catálogo de colores y fecha de alta automática.
--  Se puede volver a correr.
--
--  - Un artículo (123445) puede tener variantes por color: 123445-WHI,
--    123445-GRE, 123445-BLU… Cada variante es un artículo propio (con sus
--    casillas y su descripción) que apunta a su padre (padre_codigo) y a
--    un color del catálogo.
--  - Los colores se cargan una vez (sufijo + nombre) y se reutilizan en
--    las variantes de cualquier producto.
--  - Al tildar "Cargado web" se completa sola la fecha de alta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Catálogo de colores
-- ---------------------------------------------------------------------
create table if not exists public.colores (
  id         bigint generated always as identity primary key,
  -- Sufijo que se agrega al código del artículo: 123445 + WHI = 123445-WHI
  codigo     text not null unique check (codigo ~ '^[A-Z0-9]{2,5}$'),
  nombre     text not null check (length(trim(nombre)) > 0),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

-- Los que ya se usan en la planilla y los del ejemplo de Luca (se pueden renombrar desde la página)
insert into public.colores (codigo, nombre) values
  ('WHI', 'Blanco'), ('GRE', 'Verde'), ('BLU', 'Azul'), ('NUD', 'Nude'),
  ('NEG', 'Negro'), ('BEI', 'Beige'), ('SUE', 'Suela'), ('ROJ', 'Rojo')
on conflict (codigo) do nothing;

alter table public.articulos add column if not exists color_id bigint references public.colores(id) on delete set null;
create index if not exists articulos_color_idx on public.articulos (color_id);

-- ---------------------------------------------------------------------
-- 2) Fecha de alta en la web: se completa sola al marcar "Cargado web"
--    (solo si estaba vacía; destildar no la borra, para no perderla por error)
-- ---------------------------------------------------------------------
create or replace function public.fecha_alta_automatica()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.cargado_web and new.fecha_alta_web is null
     and (tg_op = 'INSERT' or not old.cargado_web) then
    new.fecha_alta_web := public.hoy();
  end if;
  return new;
end;
$$;

drop trigger if exists articulos_fecha_alta on public.articulos;
create trigger articulos_fecha_alta
  before insert or update on public.articulos
  for each row execute function public.fecha_alta_automatica();

-- ---------------------------------------------------------------------
-- 3) Crear variantes de un artículo con los colores elegidos
-- ---------------------------------------------------------------------
create or replace function public.crear_variantes(p_padre text, p_colores bigint[])
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_padre public.articulos%rowtype; v_color public.colores%rowtype;
  v_codigo text; v_creadas text[] := '{}'; v_existentes text[] := '{}'; v_omitidas text[] := '{}';
begin
  if not public.puede_cargar() then raise exception 'No tenés permiso para crear variantes'; end if;
  select * into v_padre from public.articulos where codigo = p_padre;
  if not found then raise exception 'El artículo % no existe', p_padre; end if;
  if v_padre.tipo = 'VARIANTE' then raise exception 'Una variante no puede tener variantes: elegí el artículo principal (%)', v_padre.padre_codigo; end if;
  if coalesce(array_length(p_colores, 1), 0) = 0 then raise exception 'Elegí al menos un color'; end if;

  for v_color in select * from public.colores where id = any (p_colores) order by codigo loop
    v_codigo := v_padre.codigo || '-' || v_color.codigo;
    if exists (select 1 from public.articulos where codigo = v_codigo and padre_codigo = v_padre.codigo and color_id = v_color.id) then
      v_existentes := v_existentes || v_codigo;
    elsif exists (select 1 from public.articulos where codigo = v_codigo) then
      -- Ese código ya existe como otro artículo: no se pisa
      v_omitidas := v_omitidas || v_codigo;
    else
      insert into public.articulos (codigo, descripcion, proveedor_id, tipo, padre_codigo, color_id)
      values (v_codigo, trim(v_padre.descripcion || ' ' || upper(v_color.nombre)), v_padre.proveedor_id, 'VARIANTE', v_padre.codigo, v_color.id);
      v_creadas := v_creadas || v_codigo;
    end if;
  end loop;

  update public.articulos set
    tipo = 'PADRE',
    variantes = coalesce((select string_agg(c.codigo, ', ' order by c.codigo)
                          from public.articulos x join public.colores c on c.id = x.color_id
                          where x.padre_codigo = p_padre), '')
  where codigo = p_padre;

  return jsonb_build_object('creadas', to_jsonb(v_creadas), 'existentes', to_jsonb(v_existentes), 'omitidas', to_jsonb(v_omitidas));
end;
$$;

-- ---------------------------------------------------------------------
-- 4) La planilla: cada artículo de una OC va seguido de sus variantes
--    (que no traen cantidades: se piden y llegan por el artículo principal)
-- ---------------------------------------------------------------------
drop view if exists public.v_planilla;
create view public.v_planilla
with (security_invoker = true) as
select
  v.orden, v.fecha_orden, v.proveedor, v.codigo, coalesce(nullif(a.descripcion, ''), v.descripcion) as nombre,
  v.cantidad, v.precio_unitario, v.estado, v.recibido, v.pendiente, v.ultima_recepcion,
  v.dias_desde_orden, v.dias_atraso,
  a.tipo, a.padre_codigo, a.variantes, a.cod_barra, a.foto, a.descripcion_ok, a.cargado_web, a.catalogo,
  a.fecha_alta_web, a.sin_stock, a.observaciones, a.titulo_web, a.descripcion_web, a.estado_descripcion, a.ya_no_esta,
  v.id as oc_linea_id, v.orden_id, v.razon_social,
  coalesce(a.padre_codigo, a.codigo) as padre,
  (a.tipo = 'VARIANTE') as es_variante,
  (select count(*) from public.articulos h where h.padre_codigo = a.codigo)::int as n_variantes,
  c.nombre as color, c.codigo as color_codigo
from public.v_oc_lineas v
join public.articulos a on a.codigo = v.codigo
left join public.colores c on c.id = a.color_id
union all
select
  v.orden, v.fecha_orden, v.proveedor, x.codigo, coalesce(nullif(x.descripcion, ''), trim(v.descripcion || ' ' || upper(c.nombre))),
  null::numeric, null::numeric, v.estado, null::numeric, null::numeric, v.ultima_recepcion,
  v.dias_desde_orden, v.dias_atraso,
  x.tipo, x.padre_codigo, x.variantes, x.cod_barra, x.foto, x.descripcion_ok, x.cargado_web, x.catalogo,
  x.fecha_alta_web, x.sin_stock, x.observaciones, x.titulo_web, x.descripcion_web, x.estado_descripcion, x.ya_no_esta,
  v.id, v.orden_id, v.razon_social,
  a.codigo,
  true,
  0,
  c.nombre, c.codigo
from public.v_oc_lineas v
join public.articulos a on a.codigo = v.codigo
join public.articulos x on x.padre_codigo = a.codigo
left join public.colores c on c.id = x.color_id;

-- ---------------------------------------------------------------------
-- 5) Permisos
-- ---------------------------------------------------------------------
revoke all on public.colores from anon;
grant select, insert, update on public.colores to authenticated;
grant select on public.v_planilla to authenticated;
revoke execute on function public.crear_variantes(text, bigint[]) from public, anon;
grant execute on function public.crear_variantes(text, bigint[]) to authenticated;
revoke execute on function public.fecha_alta_automatica() from public, anon, authenticated;

alter table public.colores enable row level security;
drop policy if exists colores_select on public.colores;
drop policy if exists colores_insert on public.colores;
drop policy if exists colores_update on public.colores;
create policy colores_select on public.colores for select to authenticated using (public.es_usuario_activo());
create policy colores_insert on public.colores for insert to authenticated with check (public.puede_cargar());
create policy colores_update on public.colores for update to authenticated using (public.puede_cargar()) with check (public.puede_cargar());
