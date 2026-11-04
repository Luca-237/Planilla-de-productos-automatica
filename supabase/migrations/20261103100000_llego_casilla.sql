-- =====================================================================
--  "Llegó" como casilla: queda marcado el artículo que alguna vez llegó.
--  Se marca solo cuando entra mercadería (un remito, o lo que trae la
--  planilla) y también se puede tildar o destildar a mano desde la
--  planilla. Nunca se desmarca solo: si un artículo estuvo en la web y
--  después deja de estar, "Llegó" sigue marcado, así se nota que lo
--  tuvimos y nos quedamos sin stock.
-- =====================================================================

-- 1) La casilla (es del artículo, igual que Foto, Cargado web, etc.)
alter table public.articulos add column if not exists llego boolean not null default false;

-- 2) Lo que ya llegó antes de esta migración queda marcado
update public.articulos a set llego = true
 where not a.llego
   and exists (select 1 from public.oc_lineas l join public.recepciones r on r.oc_linea_id = l.id where l.codigo = a.codigo);

-- 3) Cada vez que entra mercadería se marca (solo marca, nunca desmarca)
create or replace function public.marcar_llego()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.articulos a set llego = true
   from public.oc_lineas l
   where l.id = new.oc_linea_id and a.codigo = l.codigo and not a.llego;
  return new;
end;
$$;
revoke execute on function public.marcar_llego() from public, anon, authenticated;

drop trigger if exists recepciones_marcar_llego on public.recepciones;
create trigger recepciones_marcar_llego
  after insert on public.recepciones
  for each row execute function public.marcar_llego();

-- 4) La planilla, con la casilla (las variantes muestran la del artículo padre)
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
  a.web_estado, a.web_revisado_en, a.web_url, a.web_nombre,
  a.llego
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
  x.web_estado, x.web_revisado_en, x.web_url, x.web_nombre,
  a.llego
from public.v_oc_lineas v
join public.articulos a on a.codigo = v.codigo
join public.articulos x on x.padre_codigo = a.codigo
left join public.colores c on c.id = x.color_id;

grant select on public.v_planilla to authenticated;

-- 5) Se puede tildar a mano (con el resto de las columnas de trabajo)
grant update (llego) on public.articulos to authenticated;
