-- =====================================================================
--  Actualizar lo ya importado con una versión más nueva de la planilla
--  "Proceso Ecommerce". Hace falta una función aparte de importar_planilla
--  porque esa no pisa lo que ya existe. Esta:
--    - renombra códigos (la primera importación leyó códigos numéricos con
--      el formato de la planilla, "4.730.400.006", en vez del valor real,
--      "4730400006"); si el código nuevo ya existe, fusiona los dos artículos;
--    - actualiza solo los campos de artículo que le llegan (los que cambiaron
--      en la planilla), sin tocar el resto;
--    - agrega líneas nuevas a órdenes que ya están, corrige precios, marca
--      como recibido lo que llegó (con el remito "PLANILLA-<orden>") y saca las
--      líneas que ya no van.
--  Solo admin. Con p_simular = true hace todo, informa y lo deshace.
--  Se puede volver a correr.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Dar por recibido lo que falta de una línea (remito "PLANILLA-<orden>")
-- ---------------------------------------------------------------------
create or replace function public.recibir_pendiente_planilla(p_linea bigint)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_l record; v_recibido numeric; v_pendiente numeric; v_rem bigint; v_ren int; v_rl bigint;
begin
  select l.id, l.codigo, l.descripcion, l.cantidad, l.cancelada, l.precio_unitario, o.numero, o.fecha, o.proveedor_id
    into v_l from public.oc_lineas l join public.ordenes_compra o on o.id = l.orden_id where l.id = p_linea;
  if not found then return 0; end if;
  select coalesce(sum(cantidad), 0) into v_recibido from public.recepciones where oc_linea_id = p_linea;
  v_pendiente := v_l.cantidad - v_l.cancelada - v_recibido;
  if v_pendiente <= 0 then return 0; end if;
  select id into v_rem from public.remitos where proveedor_id = v_l.proveedor_id and numero = 'PLANILLA-' || v_l.numero;
  if v_rem is null then
    insert into public.remitos (numero, proveedor_id, fecha, archivo)
    values ('PLANILLA-' || v_l.numero, v_l.proveedor_id, v_l.fecha, 'Importado de la planilla Proceso Ecommerce')
    returning id into v_rem;
  end if;
  select coalesce(max(renglon), 0) + 1 into v_ren from public.remito_lineas where remito_id = v_rem;
  insert into public.remito_lineas (remito_id, renglon, codigo, descripcion, cantidad, costo)
  values (v_rem, v_ren, v_l.codigo, v_l.descripcion, v_pendiente, v_l.precio_unitario) returning id into v_rl;
  insert into public.recepciones (remito_linea_id, oc_linea_id, cantidad) values (v_rl, p_linea, v_pendiente);
  return v_pendiente;
end;
$$;

-- La n-ésima línea (indice desde 0) de una orden con ese código
create or replace function public.linea_de_orden(p_orden text, p_codigo text, p_indice int)
returns bigint
language sql stable security definer set search_path = public
as $$
  select l.id from public.oc_lineas l join public.ordenes_compra o on o.id = l.orden_id
  where o.numero = p_orden and l.codigo = p_codigo order by l.renglon offset greatest(coalesce(p_indice, 0), 0) limit 1
$$;

-- ---------------------------------------------------------------------
-- 2) El trabajo (se llama desde sincronizar_planilla)
-- ---------------------------------------------------------------------
create or replace function public.aplicar_sincronizacion(p_doc jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r jsonb; c jsonb; v_de text; v_a text; v_id bigint; v_orden bigint; v_prov bigint; v_ren int; v_recibida numeric;
  n_ren int := 0; n_fus int := 0; n_cam int := 0; n_nuevas int := 0; n_precio int := 0; n_llegadas int := 0;
  n_quitadas int := 0; n_omitidas int := 0; n_sin_orden int := 0;
begin
  perform set_config('compras.importando', 'si', true);

  -- Renombres de código. Si el código nuevo ya existe (el mismo artículo quedó cargado dos veces),
  -- se pasan al que existe sus líneas y variantes y se borra el duplicado.
  for r in select * from jsonb_array_elements(coalesce(p_doc -> 'renombres', '[]')) loop
    v_de := r ->> 'de'; v_a := r ->> 'a';
    if not exists (select 1 from public.articulos where codigo = v_de) then continue; end if;
    if exists (select 1 from public.articulos where codigo = v_a) then
      update public.oc_lineas set codigo = v_a where codigo = v_de;
      update public.remito_lineas set codigo = v_a where codigo = v_de;
      update public.articulos set padre_codigo = v_a where padre_codigo = v_de;
      delete from public.articulos where codigo = v_de;
      n_fus := n_fus + 1;
    else
      update public.articulos set codigo = v_a where codigo = v_de;   -- las líneas y variantes siguen solas (on update cascade)
      update public.remito_lineas set codigo = v_a where codigo = v_de;
      n_ren := n_ren + 1;
    end if;
  end loop;

  -- Campos de artículo que cambiaron (solo los que llegan)
  for r in select * from jsonb_array_elements(coalesce(p_doc -> 'articulos', '[]')) loop
    c := r -> 'campos';
    update public.articulos set
      descripcion        = case when c ? 'descripcion' then coalesce(c ->> 'descripcion', '') else descripcion end,
      proveedor_id       = case when c ? 'proveedor' then coalesce(public.proveedor_por_nombre(c ->> 'proveedor'), proveedor_id) else proveedor_id end,
      tipo               = case when c ? 'tipo' then coalesce(nullif(c ->> 'tipo', ''), 'PADRE') else tipo end,
      padre_codigo       = case when c ? 'padre' then (select a.codigo from public.articulos a where a.codigo = c ->> 'padre') else padre_codigo end,
      color_id           = case when c ? 'color' then (select k.id from public.colores k where k.codigo = upper(c ->> 'color')) else color_id end,
      variantes          = case when c ? 'variantes' then coalesce(c ->> 'variantes', '') else variantes end,
      foto               = case when c ? 'foto' then coalesce((c ->> 'foto')::boolean, false) else foto end,
      descripcion_ok     = case when c ? 'descripcion_ok' then coalesce((c ->> 'descripcion_ok')::boolean, false) else descripcion_ok end,
      cargado_web        = case when c ? 'cargado_web' then coalesce((c ->> 'cargado_web')::boolean, false) else cargado_web end,
      catalogo           = case when c ? 'catalogo' then coalesce((c ->> 'catalogo')::boolean, false) else catalogo end,
      sin_stock          = case when c ? 'sin_stock' then coalesce((c ->> 'sin_stock')::boolean, false) else sin_stock end,
      ya_no_esta         = case when c ? 'ya_no_esta' then coalesce((c ->> 'ya_no_esta')::boolean, false) else ya_no_esta end,
      fecha_alta_web     = case when c ? 'fecha_alta_web' then (c ->> 'fecha_alta_web')::date else fecha_alta_web end,
      observaciones      = case when c ? 'observaciones' then coalesce(c ->> 'observaciones', '') else observaciones end,
      titulo_web         = case when c ? 'titulo_web' then coalesce(c ->> 'titulo_web', '') else titulo_web end,
      descripcion_web    = case when c ? 'descripcion_web' then coalesce(c ->> 'descripcion_web', '') else descripcion_web end,
      estado_descripcion = case when c ? 'estado_descripcion' then coalesce(c ->> 'estado_descripcion', '') else estado_descripcion end
    where codigo = r ->> 'codigo';
    if found then n_cam := n_cam + 1; end if;
  end loop;

  -- Líneas nuevas en órdenes que ya estaban
  for r in select * from jsonb_array_elements(coalesce(p_doc -> 'lineas_nuevas', '[]')) loop
    select id, proveedor_id into v_orden, v_prov from public.ordenes_compra where numero = r ->> 'orden';
    if v_orden is null then n_sin_orden := n_sin_orden + 1; continue; end if;
    -- "indice" = cuántas líneas del mismo código ya tenía que haber antes que esta: si ya están, no se repite
    if r ? 'indice' and (select count(*) from public.oc_lineas where orden_id = v_orden and codigo = r ->> 'codigo') > (r ->> 'indice')::int then continue; end if;
    insert into public.articulos (codigo, descripcion, proveedor_id)
    values (r ->> 'codigo', coalesce(r ->> 'descripcion', ''), v_prov) on conflict (codigo) do nothing;
    select coalesce(max(renglon), 0) + 1 into v_ren from public.oc_lineas where orden_id = v_orden;
    insert into public.oc_lineas (orden_id, renglon, codigo, descripcion, cantidad, precio_unitario, total, fecha_entrega)
    select v_orden, v_ren, r ->> 'codigo', coalesce(r ->> 'descripcion', ''), (r ->> 'cantidad')::numeric, (r ->> 'precio_unitario')::numeric,
           case when r ->> 'precio_unitario' is null then null else round((r ->> 'cantidad')::numeric * (r ->> 'precio_unitario')::numeric, 2) end, o.fecha
      from public.ordenes_compra o where o.id = v_orden
    returning id into v_id;
    n_nuevas := n_nuevas + 1;
    if coalesce((r ->> 'llego')::boolean, false) then perform public.recibir_pendiente_planilla(v_id); n_llegadas := n_llegadas + 1; end if;
  end loop;

  -- Precios corregidos
  for r in select * from jsonb_array_elements(coalesce(p_doc -> 'lineas_precio', '[]')) loop
    v_id := public.linea_de_orden(r ->> 'orden', r ->> 'codigo', (r ->> 'indice')::int);
    if v_id is null then n_omitidas := n_omitidas + 1; continue; end if;
    update public.oc_lineas set precio_unitario = (r ->> 'precio_unitario')::numeric,
           total = round(cantidad * (r ->> 'precio_unitario')::numeric, 2) where id = v_id;
    n_precio := n_precio + 1;
  end loop;

  -- Lo que llegó (se da por recibido lo que falta de la línea)
  for r in select * from jsonb_array_elements(coalesce(p_doc -> 'llegadas', '[]')) loop
    v_id := public.linea_de_orden(r ->> 'orden', r ->> 'codigo', (r ->> 'indice')::int);
    if v_id is null then n_omitidas := n_omitidas + 1; continue; end if;
    v_recibida := public.recibir_pendiente_planilla(v_id);
    if v_recibida > 0 then n_llegadas := n_llegadas + 1; end if;
  end loop;

  -- Líneas que ya no van. Solo si no recibieron nada de un remito real de Manager.
  for r in select * from jsonb_array_elements(coalesce(p_doc -> 'lineas_quitadas', '[]')) loop
    v_id := public.linea_de_orden(r ->> 'orden', r ->> 'codigo', (r ->> 'indice')::int);
    if v_id is null then n_omitidas := n_omitidas + 1; continue; end if;
    if exists (select 1 from public.recepciones rc join public.remito_lineas rl on rl.id = rc.remito_linea_id
                 join public.remitos rm on rm.id = rl.remito_id where rc.oc_linea_id = v_id and rm.numero not like 'PLANILLA-%') then
      n_omitidas := n_omitidas + 1; continue;
    end if;
    -- lo "recibido" de la planilla se va con la línea (si no, quedaría como llegado sin orden)
    delete from public.remito_lineas where id in (select remito_linea_id from public.recepciones where oc_linea_id = v_id);
    delete from public.oc_lineas where id = v_id;
    n_quitadas := n_quitadas + 1;
  end loop;
  delete from public.remitos rm where rm.numero like 'PLANILLA-%' and not exists (select 1 from public.remito_lineas rl where rl.remito_id = rm.id);

  return jsonb_build_object('renombrados', n_ren, 'fusionados', n_fus, 'articulos_actualizados', n_cam, 'lineas_nuevas', n_nuevas,
                            'precios', n_precio, 'llegadas', n_llegadas, 'lineas_quitadas', n_quitadas, 'omitidas', n_omitidas, 'sin_orden', n_sin_orden);
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Punto de entrada (solo admin)
-- ---------------------------------------------------------------------
create or replace function public.sincronizar_planilla(p_doc jsonb, p_simular boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v jsonb;
begin
  if not public.es_admin() then raise exception 'Solo un admin puede actualizar con la planilla'; end if;
  begin
    v := public.aplicar_sincronizacion(p_doc);
    if p_simular then raise exception using errcode = 'CS001', message = 'simulación'; end if;
  exception when sqlstate 'CS001' then
    return v || jsonb_build_object('confirmado', false);
  end;
  return v || jsonb_build_object('confirmado', true);
end;
$$;

revoke execute on function public.recibir_pendiente_planilla(bigint) from public, anon, authenticated;
revoke execute on function public.linea_de_orden(text, text, int) from public, anon, authenticated;
revoke execute on function public.aplicar_sincronizacion(jsonb) from public, anon, authenticated;
revoke execute on function public.sincronizar_planilla(jsonb, boolean) from public, anon;
grant execute on function public.sincronizar_planilla(jsonb, boolean) to authenticated;
