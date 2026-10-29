-- =====================================================================
--  Carga masiva desde la planilla anterior "Proceso Ecommerce".
--  La planilla trae el NOMBRE del proveedor pero no el CUIT, así que los
--  proveedores importados quedan sin CUIT hasta que llegue una OC o un
--  remito de Manager de ese proveedor: ahí se completa solo (se reconoce
--  por el nombre). Se puede volver a correr.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Proveedor sin CUIT (provisorio)
-- ---------------------------------------------------------------------
alter table public.proveedores alter column cuit drop not null;
alter table public.proveedores drop constraint if exists proveedores_cuit_check;
alter table public.proveedores add constraint proveedores_cuit_check check (cuit is null or cuit ~ '^\d{11}$');

-- "ALL BRANDS S.R.L." y "All Brands SRL" son el mismo proveedor
create or replace function public.clave_nombre(p_nombre text)
returns text
language sql immutable set search_path = public
as $$ select upper(regexp_replace(coalesce(p_nombre, ''), '[^A-Za-z0-9]+', '', 'g')) $$;

-- Al llegar un documento de Manager con CUIT: si ese CUIT no existe pero hay un proveedor importado
-- (sin CUIT) con el mismo nombre, es el mismo: se le completa el CUIT en vez de duplicarlo.
create or replace function public.proveedor_por_cuit(p_cuit text, p_nombre text)
returns bigint
language plpgsql security invoker set search_path = public
as $$
declare v_id bigint;
begin
  if coalesce(p_cuit, '') !~ '^\d{11}$' then raise exception 'CUIT inválido: %', p_cuit; end if;
  select id into v_id from public.proveedores where cuit = p_cuit;
  if v_id is null and nullif(trim(p_nombre), '') is not null then
    select id into v_id from public.proveedores
      where cuit is null and public.clave_nombre(nombre) = public.clave_nombre(p_nombre)
      order by id limit 1;
    if v_id is not null then update public.proveedores set cuit = p_cuit where id = v_id; end if;
  end if;
  if v_id is null then
    insert into public.proveedores (cuit, nombre) values (p_cuit, coalesce(nullif(trim(p_nombre), ''), p_cuit))
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Proveedor por nombre (importación): el que ya existe con ese nombre, o uno nuevo sin CUIT
create or replace function public.proveedor_por_nombre(p_nombre text)
returns bigint
language plpgsql security invoker set search_path = public
as $$
declare v_id bigint;
begin
  if nullif(trim(p_nombre), '') is null then return null; end if;
  select id into v_id from public.proveedores
    where public.clave_nombre(nombre) = public.clave_nombre(p_nombre)
    order by (cuit is not null) desc, id limit 1;
  if v_id is null then
    insert into public.proveedores (cuit, nombre) values (null, trim(p_nombre)) returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 2) La fecha de alta automática no se pone durante la importación
--    (la planilla ya trae la real; si está vacía, queda vacía)
-- ---------------------------------------------------------------------
create or replace function public.fecha_alta_automatica()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.cargado_web and new.fecha_alta_web is null
     and (tg_op = 'INSERT' or not old.cargado_web)
     and coalesce(new.web_estado, '') not in ('publicado', 'solo_variantes')
     and coalesce(current_setting('compras.importando', true), '') <> 'si' then
    new.fecha_alta_web := public.hoy();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Importar un lote. El documento trae (todo opcional):
--    colores:   [{codigo, nombre}]
--    articulos: [{codigo, descripcion, proveedor, tipo, padre, color, variantes, foto, ... }]
--    ordenes:   [{numero, fecha, proveedor, lineas: [{codigo, descripcion, cantidad, precio_unitario, llego}]}]
--    Es idempotente: lo que ya existe (artículo, color, orden) no se toca ni se duplica.
--    De cada línea que "llegó" se deja un remito "PLANILLA-<orden>" con la fecha de la orden
--    (la planilla no guarda la fecha de llegada), así el cruce la muestra como recibida.
--    Solo admin.
-- ---------------------------------------------------------------------
create or replace function public.importar_planilla(p_doc jsonb)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_c jsonb; v_a jsonb; v_o jsonb; v_l jsonb; v_prov bigint; v_orden bigint; v_ol bigint; v_rem bigint; v_rl bigint;
  v_fecha date; v_ren int; v_rren int; v_cant numeric; v_precio numeric;
  n_col int := 0; n_art int := 0; n_art_ya int := 0; n_ord int := 0; n_ord_ya int := 0; n_lin int := 0; n_rec int := 0;
  n_prov_antes int; n_prov_despues int;
begin
  if not public.es_admin() then raise exception 'Solo un admin puede importar la planilla'; end if;
  perform set_config('compras.importando', 'si', true);
  select count(*) into n_prov_antes from public.proveedores;

  for v_c in select * from jsonb_array_elements(coalesce(p_doc -> 'colores', '[]')) loop
    insert into public.colores (codigo, nombre) values (upper(v_c ->> 'codigo'), trim(v_c ->> 'nombre'))
    on conflict (codigo) do nothing;
    if found then n_col := n_col + 1; end if;
  end loop;

  for v_a in select * from jsonb_array_elements(coalesce(p_doc -> 'articulos', '[]')) loop
    insert into public.articulos (codigo, descripcion, proveedor_id, tipo, padre_codigo, color_id, variantes, cod_barra,
                                  foto, descripcion_ok, cargado_web, catalogo, fecha_alta_web, sin_stock, observaciones,
                                  titulo_web, descripcion_web, estado_descripcion, ya_no_esta)
    values (v_a ->> 'codigo', coalesce(v_a ->> 'descripcion', ''), public.proveedor_por_nombre(v_a ->> 'proveedor'),
            coalesce(nullif(v_a ->> 'tipo', ''), 'PADRE'),
            -- el principal tiene que existir (se importan antes que sus variantes)
            (select a.codigo from public.articulos a where a.codigo = v_a ->> 'padre'),
            (select c.id from public.colores c where c.codigo = upper(v_a ->> 'color')),
            coalesce(v_a ->> 'variantes', ''), coalesce(v_a ->> 'cod_barra', ''),
            coalesce((v_a ->> 'foto')::boolean, false), coalesce((v_a ->> 'descripcion_ok')::boolean, false),
            coalesce((v_a ->> 'cargado_web')::boolean, false), coalesce((v_a ->> 'catalogo')::boolean, false),
            (v_a ->> 'fecha_alta_web')::date, coalesce((v_a ->> 'sin_stock')::boolean, false),
            coalesce(v_a ->> 'observaciones', ''), coalesce(v_a ->> 'titulo_web', ''),
            coalesce(v_a ->> 'descripcion_web', ''), coalesce(v_a ->> 'estado_descripcion', ''),
            coalesce((v_a ->> 'ya_no_esta')::boolean, false))
    on conflict (codigo) do nothing;
    if found then n_art := n_art + 1; else n_art_ya := n_art_ya + 1; end if;
  end loop;

  for v_o in select * from jsonb_array_elements(coalesce(p_doc -> 'ordenes', '[]')) loop
    if exists (select 1 from public.ordenes_compra where numero = v_o ->> 'numero') then
      n_ord_ya := n_ord_ya + 1;
      continue;
    end if;
    v_prov := public.proveedor_por_nombre(v_o ->> 'proveedor');
    if v_prov is null then raise exception 'La orden % no tiene proveedor', v_o ->> 'numero'; end if;
    v_fecha := (v_o ->> 'fecha')::date;
    insert into public.ordenes_compra (numero, proveedor_id, fecha, observaciones)
    values (v_o ->> 'numero', v_prov, v_fecha, 'Importada de la planilla Proceso Ecommerce')
    returning id into v_orden;
    n_ord := n_ord + 1;
    v_ren := 0; v_rren := 0; v_rem := null;

    for v_l in select * from jsonb_array_elements(coalesce(v_o -> 'lineas', '[]')) loop
      v_ren := v_ren + 1;
      v_cant := (v_l ->> 'cantidad')::numeric;
      v_precio := (v_l ->> 'precio_unitario')::numeric;
      insert into public.articulos (codigo, descripcion, proveedor_id)
      values (v_l ->> 'codigo', coalesce(v_l ->> 'descripcion', ''), v_prov)
      on conflict (codigo) do nothing;
      insert into public.oc_lineas (orden_id, renglon, codigo, descripcion, cantidad, precio_unitario, total, fecha_entrega)
      values (v_orden, v_ren, v_l ->> 'codigo', coalesce(v_l ->> 'descripcion', ''), v_cant, v_precio,
              case when v_precio is null then null else round(v_cant * v_precio, 2) end, v_fecha)
      returning id into v_ol;
      n_lin := n_lin + 1;

      if coalesce((v_l ->> 'llego')::boolean, false) then
        if v_rem is null then
          insert into public.remitos (numero, proveedor_id, fecha, archivo)
          values ('PLANILLA-' || (v_o ->> 'numero'), v_prov, v_fecha, 'Importado de la planilla Proceso Ecommerce')
          returning id into v_rem;
        end if;
        v_rren := v_rren + 1;
        insert into public.remito_lineas (remito_id, renglon, codigo, descripcion, cantidad, costo)
        values (v_rem, v_rren, v_l ->> 'codigo', coalesce(v_l ->> 'descripcion', ''), v_cant, v_precio)
        returning id into v_rl;
        insert into public.recepciones (remito_linea_id, oc_linea_id, cantidad) values (v_rl, v_ol, v_cant);
        n_rec := n_rec + 1;
      end if;
    end loop;
  end loop;

  select count(*) into n_prov_despues from public.proveedores;
  return jsonb_build_object('colores', n_col, 'articulos', n_art, 'articulos_existentes', n_art_ya,
                            'ordenes', n_ord, 'ordenes_existentes', n_ord_ya, 'lineas', n_lin, 'recibidas', n_rec,
                            'proveedores_nuevos', n_prov_despues - n_prov_antes);
end;
$$;

revoke execute on function public.importar_planilla(jsonb) from public, anon;
grant execute on function public.importar_planilla(jsonb) to authenticated;
grant execute on function public.clave_nombre(text) to authenticated;
revoke execute on function public.proveedor_por_nombre(text) from public, anon;
grant execute on function public.proveedor_por_nombre(text) to authenticated;
