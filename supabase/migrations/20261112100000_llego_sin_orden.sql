-- =====================================================================
--  Lo que llega por remito sin orden de compra también se trabaja en la
--  Planilla (pedido de Luca, 12/11/2026).
--    Antes: una línea de remito que no encontraba orden quedaba solo en
--    Pendientes ("llegó sin orden"). No se creaba el artículo, no se
--    marcaba "Llegó" y la Planilla no la mostraba, así que tampoco salía
--    en "Subir a la página".
--    Ahora:
--      1) Cada línea de remito crea el artículo si no existe y lo marca
--         como llegado (con o sin orden). Solo marca, nunca desmarca.
--      2) Se corrige lo ya cargado: los artículos de lo que hoy figura
--         como "llegó sin orden" se crean y se marcan.
--      3) La Planilla suma una fila por artículo que llegó sin orden
--         (estado "sin_orden"), con sus variantes, igual que las de una
--         orden. Si después se asigna a una orden, la fila se va y queda
--         la de la orden.
--  Se puede volver a correr.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Cada línea de remito: crear el artículo si falta y marcar "Llegó"
-- ---------------------------------------------------------------------
create or replace function public.articulo_desde_remito()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_prov bigint;
begin
  if nullif(trim(coalesce(new.codigo, '')), '') is null then return new; end if;
  select proveedor_id into v_prov from public.remitos where id = new.remito_id;
  insert into public.articulos (codigo, descripcion, proveedor_id)
  values (new.codigo, coalesce(new.descripcion, ''), v_prov)
  on conflict (codigo) do nothing;
  -- El artículo, y si es una variante también su artículo principal (la Planilla muestra la casilla del principal)
  update public.articulos a set llego = true
   where not a.llego
     and (a.codigo = new.codigo or a.codigo = (select x.padre_codigo from public.articulos x where x.codigo = new.codigo));
  return new;
end;
$$;
revoke execute on function public.articulo_desde_remito() from public, anon, authenticated;

drop trigger if exists remito_lineas_articulo on public.remito_lineas;
create trigger remito_lineas_articulo
  after insert on public.remito_lineas
  for each row execute function public.articulo_desde_remito();

-- ---------------------------------------------------------------------
-- 2) Lo ya cargado que llegó sin orden
-- ---------------------------------------------------------------------
insert into public.articulos (codigo, descripcion, proveedor_id)
select distinct on (rl.codigo) rl.codigo, coalesce(rl.descripcion, ''), rm.proveedor_id
from public.remito_lineas rl
join public.remitos rm on rm.id = rl.remito_id
where nullif(trim(coalesce(rl.codigo, '')), '') is not null
  and rl.cantidad > coalesce((select sum(rc.cantidad) from public.recepciones rc where rc.remito_linea_id = rl.id), 0)
order by rl.codigo, rm.fecha desc, rl.id desc
on conflict (codigo) do nothing;

with llegados as (
  select distinct rl.codigo
  from public.remito_lineas rl
  where rl.cantidad > coalesce((select sum(rc.cantidad) from public.recepciones rc where rc.remito_linea_id = rl.id), 0)
)
update public.articulos a set llego = true
 where not a.llego
   and (a.codigo in (select codigo from llegados)
        or a.codigo in (select x.padre_codigo from public.articulos x join llegados g on g.codigo = x.codigo where x.padre_codigo is not null));

-- ---------------------------------------------------------------------
-- 3) La Planilla con las filas de lo que llegó sin orden
-- ---------------------------------------------------------------------
drop view if exists public.v_planilla;
create view public.v_planilla
with (security_invoker = true) as
with sin_orden as (
  -- Una fila por código: unidades que llegaron sin orden, última llegada y los remitos
  select s.codigo,
         sum(s.sin_orden) as unidades,
         max(s.fecha) as ultima,
         (array_agg(s.descripcion order by s.fecha desc, s.remito_linea_id desc))[1] as descripcion,
         (array_agg(s.proveedor order by s.fecha desc, s.remito_linea_id desc))[1] as proveedor,
         (array_agg(s.razon_social order by s.fecha desc, s.remito_linea_id desc))[1] as razon_social,
         string_agg(distinct s.remito, ', ') as remitos
  from public.v_sobrantes s
  group by s.codigo
),
base as (
  select v.orden, v.fecha_orden, v.proveedor, v.codigo, v.descripcion, v.cantidad, v.precio_unitario, v.estado,
         v.recibido, v.pendiente, v.ultima_recepcion, v.dias_desde_orden, v.dias_atraso,
         v.id as oc_linea_id, v.orden_id, v.razon_social, null::text as remitos
  from public.v_oc_lineas v
  union all
  -- Solo si el artículo no aparece ya por una orden (ni él ni su artículo principal)
  -- y, si es una variante, si su principal no tiene también su propia fila "sin orden"
  select null, null, so.proveedor, so.codigo, so.descripcion, so.unidades, null, 'sin_orden',
         so.unidades, null, so.ultima, null, null,
         null, null, so.razon_social, so.remitos
  from sin_orden so
  join public.articulos a on a.codigo = so.codigo
  where not exists (select 1 from public.oc_lineas l where l.codigo = a.codigo)
    and (a.padre_codigo is null or (not exists (select 1 from public.oc_lineas l where l.codigo = a.padre_codigo)
                                     and not exists (select 1 from sin_orden p where p.codigo = a.padre_codigo)))
)
select
  v.orden, v.fecha_orden, v.proveedor, v.codigo, coalesce(nullif(a.descripcion, ''), v.descripcion) as nombre,
  v.cantidad, v.precio_unitario, v.estado, v.recibido, v.pendiente, v.ultima_recepcion,
  v.dias_desde_orden, v.dias_atraso,
  a.tipo, a.padre_codigo, a.variantes, a.cod_barra, a.foto, a.descripcion_ok, a.cargado_web, a.catalogo,
  a.fecha_alta_web, a.sin_stock, a.observaciones, a.titulo_web, a.descripcion_web, a.estado_descripcion, a.ya_no_esta,
  v.oc_linea_id, v.orden_id, v.razon_social,
  coalesce(a.padre_codigo, a.codigo) as padre,
  (a.tipo = 'VARIANTE') as es_variante,
  (select count(*) from public.articulos h where h.padre_codigo = a.codigo)::int as n_variantes,
  c.nombre as color, c.codigo as color_codigo,
  a.web_estado, a.web_revisado_en, a.web_url, a.web_nombre,
  a.llego,
  v.remitos
from base v
join public.articulos a on a.codigo = v.codigo
left join public.colores c on c.id = a.color_id
union all
select
  v.orden, v.fecha_orden, v.proveedor, x.codigo, coalesce(nullif(x.descripcion, ''), trim(v.descripcion || ' ' || upper(c.nombre))),
  null::numeric, null::numeric, v.estado, null::numeric, null::numeric, v.ultima_recepcion,
  v.dias_desde_orden, v.dias_atraso,
  x.tipo, x.padre_codigo, x.variantes, x.cod_barra, x.foto, x.descripcion_ok, x.cargado_web, x.catalogo,
  x.fecha_alta_web, x.sin_stock, x.observaciones, x.titulo_web, x.descripcion_web, x.estado_descripcion, x.ya_no_esta,
  v.oc_linea_id, v.orden_id, v.razon_social,
  a.codigo,
  true,
  0,
  c.nombre, c.codigo,
  x.web_estado, x.web_revisado_en, x.web_url, x.web_nombre,
  a.llego,
  v.remitos
from base v
join public.articulos a on a.codigo = v.codigo
join public.articulos x on x.padre_codigo = a.codigo
left join public.colores c on c.id = x.color_id;

grant select on public.v_planilla to authenticated;
