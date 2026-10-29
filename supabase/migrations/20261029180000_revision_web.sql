-- =====================================================================
--  Revisión en la web: antes de cargar un artículo (o escribir su
--  descripción) se revisa si ya está publicado en la página de Cindy,
--  para no cargarlo dos veces. La revisión la hace la Edge Function
--  "buscar-en-web" y guarda acá el resultado. Se puede volver a correr.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Resultado de la última revisión (lo escribe la función, no la página)
-- ---------------------------------------------------------------------
alter table public.articulos add column if not exists web_estado text
  check (web_estado in ('publicado', 'solo_variantes', 'no_esta'));
alter table public.articulos add column if not exists web_revisado_en timestamptz;
alter table public.articulos add column if not exists web_url text not null default '';
alter table public.articulos add column if not exists web_nombre text not null default '';

-- ---------------------------------------------------------------------
-- 2) Fecha de alta: si la revisión ya lo encontró publicado, la fecha
--    real es anterior y no se sabe: no se pone la de hoy al tildar
--    "Cargado web" (queda vacía para completarla a mano si hace falta).
-- ---------------------------------------------------------------------
create or replace function public.fecha_alta_automatica()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.cargado_web and new.fecha_alta_web is null
     and (tg_op = 'INSERT' or not old.cargado_web)
     and coalesce(new.web_estado, '') not in ('publicado', 'solo_variantes') then
    new.fecha_alta_web := public.hoy();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) La planilla, con el resultado de la revisión (al final de cada fila)
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
  c.nombre as color, c.codigo as color_codigo,
  a.web_estado, a.web_revisado_en, a.web_url, a.web_nombre
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
  c.nombre, c.codigo,
  x.web_estado, x.web_revisado_en, x.web_url, x.web_nombre
from public.v_oc_lineas v
join public.articulos a on a.codigo = v.codigo
join public.articulos x on x.padre_codigo = a.codigo
left join public.colores c on c.id = x.color_id;

grant select on public.v_planilla to authenticated;

-- ---------------------------------------------------------------------
-- 4) Los usuarios editan solo las columnas de trabajo; el resultado de la
--    revisión (web_*) lo escribe únicamente la función, con la clave de
--    servicio. Así nadie puede marcar a mano "publicado" algo que no está.
-- ---------------------------------------------------------------------
revoke update on public.articulos from authenticated;
grant update (descripcion, proveedor_id, tipo, padre_codigo, variantes, color_id, cod_barra, foto, descripcion_ok,
              cargado_web, catalogo, fecha_alta_web, sin_stock, observaciones, titulo_web, descripcion_web,
              estado_descripcion, ya_no_esta)
  on public.articulos to authenticated;
