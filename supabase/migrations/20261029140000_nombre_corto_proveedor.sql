-- =====================================================================
--  Nombre corto del proveedor: el nombre con el que se lo conoce en Cindy
--  (Target, Bagcherry, Lesedife…), que no siempre sale de la razón social
--  de Manager (ej. Bagcherry figura como "ZUKI S.R.L."). Se carga una vez
--  por proveedor desde la página (Órdenes y remitos → Proveedores).
--  Mientras no tenga, se muestra la razón social. Se puede volver a correr.
--
--  En las vistas, "proveedor" pasa a ser el nombre corto (o la razón
--  social si no tiene) y se agrega "razon_social" al final.
-- =====================================================================

alter table public.proveedores add column if not exists nombre_corto text not null default '';

create or replace view public.v_oc_lineas
with (security_invoker = true) as
select
  l.id, l.orden_id, o.numero as orden, o.fecha as fecha_orden, o.proveedor_id,
  coalesce(nullif(trim(p.nombre_corto), ''), p.nombre) as proveedor, p.cuit,
  l.renglon, l.codigo, l.descripcion, l.cantidad, l.precio_unitario, l.total, l.fecha_entrega, l.cancelada,
  coalesce(r.recibido, 0) as recibido,
  greatest(l.cantidad - l.cancelada - coalesce(r.recibido, 0), 0) as pendiente,
  r.ultima_recepcion,
  case
    when l.cantidad - l.cancelada - coalesce(r.recibido, 0) <= 0 then
      case when coalesce(r.recibido, 0) = 0 then 'cancelada' else 'completa' end
    when o.cerrada then 'cerrada'
    when coalesce(r.recibido, 0) > 0 then 'parcial'
    else 'pendiente'
  end as estado,
  public.hoy() - o.fecha as dias_desde_orden,
  greatest(public.hoy() - coalesce(l.fecha_entrega, o.fecha), 0) as dias_atraso,
  o.cerrada,
  p.nombre as razon_social
from public.oc_lineas l
join public.ordenes_compra o on o.id = l.orden_id
join public.proveedores p on p.id = o.proveedor_id
left join lateral (
  select sum(rc.cantidad) as recibido, max(rm.fecha) as ultima_recepcion
  from public.recepciones rc
  join public.remito_lineas rl on rl.id = rc.remito_linea_id
  join public.remitos rm on rm.id = rl.remito_id
  where rc.oc_linea_id = l.id
) r on true;

-- "select *" se expande al crear la vista: hay que recrearla para que tome razon_social
create or replace view public.v_pendientes
with (security_invoker = true) as
select * from public.v_oc_lineas
where estado in ('pendiente', 'parcial');

create or replace view public.v_planilla
with (security_invoker = true) as
select
  v.orden, v.fecha_orden, v.proveedor, v.codigo, coalesce(nullif(a.descripcion, ''), v.descripcion) as nombre,
  v.cantidad, v.precio_unitario, v.estado, v.recibido, v.pendiente, v.ultima_recepcion,
  v.dias_desde_orden, v.dias_atraso,
  a.tipo, a.padre_codigo, a.variantes, a.cod_barra, a.foto, a.descripcion_ok, a.cargado_web, a.catalogo,
  a.fecha_alta_web, a.sin_stock, a.observaciones, a.titulo_web, a.descripcion_web, a.estado_descripcion, a.ya_no_esta,
  v.id as oc_linea_id, v.orden_id,
  v.razon_social
from public.v_oc_lineas v
join public.articulos a on a.codigo = v.codigo;

create or replace view public.v_sobrantes
with (security_invoker = true) as
select rm.id as remito_id, rm.numero as remito, rm.fecha, coalesce(nullif(trim(p.nombre_corto), ''), p.nombre) as proveedor,
       rl.codigo, rl.descripcion, rl.cantidad, rl.cantidad - coalesce(sum(rc.cantidad), 0) as sin_orden,
       p.nombre as razon_social
from public.remito_lineas rl
join public.remitos rm on rm.id = rl.remito_id
join public.proveedores p on p.id = rm.proveedor_id
left join public.recepciones rc on rc.remito_linea_id = rl.id
group by rm.id, rm.numero, rm.fecha, p.nombre, p.nombre_corto, rl.id, rl.codigo, rl.descripcion, rl.cantidad
having rl.cantidad - coalesce(sum(rc.cantidad), 0) > 0;

-- Recrear una vista no cambia sus permisos, pero se repiten por si se corre en una base nueva
grant select on public.v_oc_lineas, public.v_pendientes, public.v_planilla, public.v_sobrantes to authenticated;
