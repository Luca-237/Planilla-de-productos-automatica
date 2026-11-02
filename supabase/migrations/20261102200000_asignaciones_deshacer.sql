-- =====================================================================
--  Asignar lo que llegó a mano, cambiar números y poder deshacer.
--    - Un remito se puede cargar contra una orden de compra elegida
--      (p_doc.orden) en vez de repartirse solo entre las abiertas.
--    - Lo que llegó "sin orden" (o con otro código) se puede asignar a mano
--      a una línea de una orden del mismo proveedor, y desasignar.
--    - El número de una orden o de un remito se puede cambiar.
--    - Quien cargó un documento lo puede borrar (deshacer) durante las
--      primeras 2 horas; pasado ese tiempo, solo un admin.
--  Se puede volver a correr.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Lo que llegó sin orden, con lo necesario para asignarlo
-- ---------------------------------------------------------------------
drop view if exists public.v_sobrantes;
create view public.v_sobrantes
with (security_invoker = true) as
select rm.id as remito_id, rm.numero as remito, rm.fecha, coalesce(nullif(trim(p.nombre_corto), ''), p.nombre) as proveedor,
       rl.codigo, rl.descripcion, rl.cantidad, rl.cantidad - coalesce(sum(rc.cantidad), 0) as sin_orden,
       p.nombre as razon_social, rl.id as remito_linea_id, rm.proveedor_id
from public.remito_lineas rl
join public.remitos rm on rm.id = rl.remito_id
join public.proveedores p on p.id = rm.proveedor_id
left join public.recepciones rc on rc.remito_linea_id = rl.id
group by rm.id, rm.numero, rm.fecha, p.nombre, p.nombre_corto, rl.id, rl.codigo, rl.descripcion, rl.cantidad, rm.proveedor_id
having rl.cantidad - coalesce(sum(rc.cantidad), 0) > 0;
grant select on public.v_sobrantes to authenticated;

-- ---------------------------------------------------------------------
-- 2) Remito contra una orden elegida (p_doc.orden = número de la OC)
-- ---------------------------------------------------------------------
create or replace function public.aplicar_remito(p_doc jsonb)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_prov bigint; v_remito bigint; v_linea jsonb; v_rl bigint; v_renglon int := 0;
  v_resto numeric; v_toma numeric; v_oc record; v_asig jsonb; v_lineas jsonb := '[]';
  v_orden_pedida text := nullif(trim(coalesce(p_doc ->> 'orden', '')), '');
begin
  if not public.puede_cargar() then raise exception 'No tenés permiso para cargar documentos'; end if;
  if p_doc ->> 'tipo' is distinct from 'remito_ingreso' then raise exception 'El documento no es un remito de ingreso'; end if;
  if jsonb_array_length(coalesce(p_doc -> 'lineas', '[]')) = 0 then raise exception 'El remito no tiene artículos'; end if;
  if (p_doc ->> 'fecha') is null then raise exception 'El remito no tiene fecha'; end if;
  if nullif(trim(coalesce(p_doc ->> 'numero', '')), '') is null then raise exception 'El remito no tiene número'; end if;

  v_prov := public.proveedor_por_cuit(p_doc ->> 'cuit', p_doc ->> 'proveedor');
  if v_orden_pedida is not null and not exists (select 1 from public.ordenes_compra where numero = v_orden_pedida and proveedor_id = v_prov) then
    raise exception 'La orden de compra % no existe o es de otro proveedor', v_orden_pedida;
  end if;
  if exists (select 1 from public.remitos where proveedor_id = v_prov and numero = p_doc ->> 'numero') then
    raise exception 'El remito % de este proveedor ya está cargado', p_doc ->> 'numero';
  end if;
  insert into public.remitos (numero, proveedor_id, fecha, total, archivo)
  values (trim(p_doc ->> 'numero'), v_prov, (p_doc ->> 'fecha')::date, (p_doc ->> 'total')::numeric, coalesce(p_doc ->> 'archivo', ''))
  returning id into v_remito;

  for v_linea in select * from jsonb_array_elements(p_doc -> 'lineas') loop
    v_renglon := v_renglon + 1;
    insert into public.remito_lineas (remito_id, renglon, codigo, descripcion, cantidad, costo)
    values (v_remito, v_renglon, v_linea ->> 'codigo', coalesce(v_linea ->> 'descripcion', ''),
            (v_linea ->> 'cantidad')::numeric, (v_linea ->> 'costo')::numeric)
    returning id into v_rl;

    -- Se reparte entre las OC abiertas del mismo proveedor y código (o solo la elegida), de la más vieja a la más nueva
    v_resto := (v_linea ->> 'cantidad')::numeric;
    v_asig := '[]';
    for v_oc in
      select l.id, o.numero,
             l.cantidad - l.cancelada - coalesce((select sum(rc.cantidad) from public.recepciones rc where rc.oc_linea_id = l.id), 0) as pendiente
      from public.oc_lineas l
      join public.ordenes_compra o on o.id = l.orden_id
      where o.proveedor_id = v_prov and l.codigo = v_linea ->> 'codigo' and not o.cerrada
        and (v_orden_pedida is null or o.numero = v_orden_pedida)
      order by o.fecha, o.numero, l.renglon
      for update of l
    loop
      exit when v_resto <= 0;
      continue when v_oc.pendiente <= 0;
      v_toma := least(v_resto, v_oc.pendiente);
      insert into public.recepciones (remito_linea_id, oc_linea_id, cantidad) values (v_rl, v_oc.id, v_toma);
      v_asig := v_asig || jsonb_build_object('orden', v_oc.numero, 'cantidad', v_toma);
      v_resto := v_resto - v_toma;
    end loop;

    v_lineas := v_lineas || jsonb_build_object('codigo', v_linea ->> 'codigo', 'cantidad', (v_linea ->> 'cantidad')::numeric,
                                               'asignado', v_asig, 'sin_orden', v_resto);
  end loop;

  return jsonb_build_object(
    'tipo', 'remito_ingreso', 'remito_id', v_remito, 'numero', trim(p_doc ->> 'numero'), 'proveedor_id', v_prov,
    'orden_elegida', v_orden_pedida,
    'lineas', v_lineas,
    'sin_orden', (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(v_lineas) x where (x ->> 'sin_orden')::numeric > 0),
    -- Cómo quedan las OC que tocó este remito
    'ordenes', (select coalesce(jsonb_agg(jsonb_build_object('orden', orden, 'pendiente', pendiente) order by orden), '[]')
                from (select v.orden, sum(v.pendiente) as pendiente
                      from public.v_oc_lineas v
                      where v.orden_id in (select l.orden_id from public.recepciones rc
                                           join public.remito_lineas rl on rl.id = rc.remito_linea_id
                                           join public.oc_lineas l on l.id = rc.oc_linea_id
                                           where rl.remito_id = v_remito)
                      group by v.orden) t)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Asignar a mano lo que llegó a una línea de una orden (puede tener otro código) y desasignar
-- ---------------------------------------------------------------------
create or replace function public.asignar_a_orden(p_remito_linea bigint, p_oc_linea bigint, p_cantidad numeric)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_prov_remito bigint; v_prov_orden bigint; v_cant_linea numeric; v_asignado numeric; v_id bigint; v_orden text;
begin
  if not public.puede_cargar() then raise exception 'No tenés permiso para asignar'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad tiene que ser mayor a 0'; end if;
  select rm.proveedor_id, rl.cantidad into v_prov_remito, v_cant_linea
    from public.remito_lineas rl join public.remitos rm on rm.id = rl.remito_id where rl.id = p_remito_linea;
  if not found then raise exception 'La línea del remito ya no existe'; end if;
  select o.proveedor_id, o.numero into v_prov_orden, v_orden
    from public.oc_lineas l join public.ordenes_compra o on o.id = l.orden_id where l.id = p_oc_linea;
  if not found then raise exception 'La línea de la orden de compra ya no existe'; end if;
  if v_prov_remito is distinct from v_prov_orden then raise exception 'La orden de compra es de otro proveedor'; end if;
  select coalesce(sum(cantidad), 0) into v_asignado from public.recepciones where remito_linea_id = p_remito_linea;
  if p_cantidad > v_cant_linea - v_asignado then
    raise exception 'De esa línea del remito solo quedan % unidades sin orden', trim_scale(v_cant_linea - v_asignado);
  end if;
  -- si ya había una asignación de esta línea del remito a esta línea de la orden, se suma (la tabla no repite el par)
  select id into v_id from public.recepciones where remito_linea_id = p_remito_linea and oc_linea_id = p_oc_linea;
  if v_id is null then
    insert into public.recepciones (remito_linea_id, oc_linea_id, cantidad) values (p_remito_linea, p_oc_linea, p_cantidad) returning id into v_id;
  else
    update public.recepciones set cantidad = cantidad + p_cantidad where id = v_id;
  end if;
  return jsonb_build_object('recepcion_id', v_id, 'orden', v_orden, 'cantidad', p_cantidad);
end;
$$;

-- Deshace una asignación (vuelve a "sin orden" y la línea de la orden vuelve a faltar). Si se había sumado, resta.
create or replace function public.desasignar(p_remito_linea bigint, p_oc_linea bigint, p_cantidad numeric default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_id bigint; v_cant numeric;
begin
  if not public.puede_cargar() then raise exception 'No tenés permiso para desasignar'; end if;
  select id, cantidad into v_id, v_cant from public.recepciones where remito_linea_id = p_remito_linea and oc_linea_id = p_oc_linea for update;
  if v_id is null then return jsonb_build_object('quitado', 0); end if;
  if p_cantidad is null or p_cantidad >= v_cant then
    delete from public.recepciones where id = v_id;
    return jsonb_build_object('quitado', v_cant);
  end if;
  update public.recepciones set cantidad = cantidad - p_cantidad where id = v_id;
  return jsonb_build_object('quitado', p_cantidad);
end;
$$;

revoke execute on function public.asignar_a_orden(bigint, bigint, numeric) from public, anon;
grant execute on function public.asignar_a_orden(bigint, bigint, numeric) to authenticated;
revoke execute on function public.desasignar(bigint, bigint, numeric) from public, anon;
grant execute on function public.desasignar(bigint, bigint, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Cambiar el número de un remito (el de una orden ya se podía editar) y deshacer lo propio reciente
-- ---------------------------------------------------------------------
grant update (numero, fecha) on public.remitos to authenticated;
drop policy if exists remitos_update on public.remitos;
create policy remitos_update on public.remitos for update to authenticated using (public.puede_cargar()) with check (public.puede_cargar());

-- Borrar una orden o un remito: un admin siempre; quien lo cargó, durante las primeras 2 horas
drop policy if exists ordenes_delete on public.ordenes_compra;
create policy ordenes_delete on public.ordenes_compra for delete to authenticated
  using (public.es_admin() or (cargado_por = auth.uid() and public.puede_cargar() and creado_en > now() - interval '2 hours'));
drop policy if exists remitos_delete on public.remitos;
create policy remitos_delete on public.remitos for delete to authenticated
  using (public.es_admin() or (cargado_por = auth.uid() and public.puede_cargar() and creado_en > now() - interval '2 hours'));
