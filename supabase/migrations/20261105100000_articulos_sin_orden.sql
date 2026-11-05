-- =====================================================================
--  Artículos sin orden de compra. La Planilla muestra una fila por
--  artículo de cada orden, así que los artículos que están cargados pero
--  todavía no tienen una orden (por ejemplo los que vienen con la
--  descripción ya escrita) no aparecían. Esta vista los lista con las
--  mismas columnas que v_planilla (lo de la orden queda vacío), para que
--  la Planilla los muestre al apagar "Con orden de compra".
--  Una variante (color) se lista solo si ni ella ni su artículo principal
--  tienen orden. Se puede volver a correr.
-- =====================================================================

drop view if exists public.v_articulos_sin_orden;
create view public.v_articulos_sin_orden
with (security_invoker = true) as
select
  null::text as orden, null::date as fecha_orden,
  coalesce(nullif(trim(p.nombre_corto), ''), p.nombre) as proveedor,
  a.codigo, a.descripcion as nombre,
  null::numeric as cantidad, null::numeric as precio_unitario, null::text as estado, null::numeric as recibido, null::numeric as pendiente,
  null::date as ultima_recepcion, null::int as dias_desde_orden, null::int as dias_atraso,
  a.tipo, a.padre_codigo, a.variantes, a.cod_barra, a.foto, a.descripcion_ok, a.cargado_web, a.catalogo,
  a.fecha_alta_web, a.sin_stock, a.observaciones, a.titulo_web, a.descripcion_web, a.estado_descripcion, a.ya_no_esta,
  null::bigint as oc_linea_id, null::bigint as orden_id, p.nombre as razon_social,
  coalesce(a.padre_codigo, a.codigo) as padre,
  (a.tipo = 'VARIANTE') as es_variante,
  (select count(*) from public.articulos h where h.padre_codigo = a.codigo)::int as n_variantes,
  c.nombre as color, c.codigo as color_codigo,
  a.web_estado, a.web_revisado_en, a.web_url, a.web_nombre,
  a.llego
from public.articulos a
left join public.proveedores p on p.id = a.proveedor_id
left join public.colores c on c.id = a.color_id
where not exists (select 1 from public.oc_lineas l where l.codigo = a.codigo)
  and (a.padre_codigo is null or not exists (select 1 from public.oc_lineas l where l.codigo = a.padre_codigo));

grant select on public.v_articulos_sin_orden to authenticated;
