-- =====================================================================
--  Restaurar desde el Excel del backup (backup/restaurar-backup.mjs).
--  La llama solo la Edge Function backup-datos, con la clave de servicio:
--  nunca la página. Agrega las filas que faltan de una tabla, conservando
--  sus números (id) originales, y NO pisa ni borra lo que ya existe
--  ("on conflict do nothing"). Se puede repetir sin duplicar.
--
--  Solo restaura datos de trabajo: proveedores, colores, artículos,
--  órdenes de compra, remitos y sus líneas, y las asignaciones
--  (recepciones). Los usuarios y sus preferencias viven en Supabase Auth:
--  se vuelven a crear desde la pantalla Usuarios. Si una fila apunta a un
--  usuario que ya no existe (cargado_por, actualizado_por), queda sin
--  usuario en vez de fallar.
--  Se puede volver a correr.
-- =====================================================================

create or replace function public.restaurar_tabla(p_tabla text, p_filas jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  -- En el orden en que se pueden cargar (primero lo que no depende de otra tabla)
  v_permitidas constant text[] := array['proveedores', 'colores', 'articulos', 'ordenes_compra', 'oc_lineas',
                                        'remitos', 'remito_lineas', 'recepciones'];
  v_cols text; v_sel text; v_filas jsonb; v_enviadas int; v_nuevas int; v_seq text;
begin
  if not (p_tabla = any (v_permitidas)) then raise exception 'Tabla no permitida para restaurar: %', p_tabla; end if;
  if jsonb_typeof(coalesce(p_filas, '[]'::jsonb)) <> 'array' then raise exception 'Las filas tienen que venir como lista'; end if;
  v_enviadas := jsonb_array_length(coalesce(p_filas, '[]'::jsonb));
  if v_enviadas = 0 then return jsonb_build_object('enviadas', 0, 'insertadas', 0); end if;

  -- Como en la importación: que los disparadores no cambien datos al cargar (fechas de alta, etc.)
  perform set_config('compras.importando', 'si', true);

  -- Usuarios que ya no existen: se deja la fila sin usuario
  select coalesce(jsonb_agg(
           f
           || case when f ? 'cargado_por' and f ->> 'cargado_por' is not null
                    and not exists (select 1 from auth.users u where u.id::text = f ->> 'cargado_por')
                   then '{"cargado_por": null}'::jsonb else '{}'::jsonb end
           || case when f ? 'actualizado_por' and f ->> 'actualizado_por' is not null
                    and not exists (select 1 from auth.users u where u.id::text = f ->> 'actualizado_por')
                   then '{"actualizado_por": null}'::jsonb else '{}'::jsonb end
         ), '[]'::jsonb)
    into v_filas
    from jsonb_array_elements(p_filas) f;

  -- Columnas: las vacías (null) de una columna "not null" toman su valor por defecto
  select string_agg(format('%I', a.attname), ', ' order by a.attnum),
         string_agg(case when a.attnotnull and d.adbin is not null and a.attidentity = ''
                         then format('coalesce(r.%I, %s)', a.attname, pg_get_expr(d.adbin, d.adrelid))
                         else format('r.%I', a.attname) end, ', ' order by a.attnum)
    into v_cols, v_sel
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = ('public.' || quote_ident(p_tabla))::regclass and a.attnum > 0 and not a.attisdropped;

  execute format('with ins as (
                    insert into public.%I (%s) overriding system value
                    select %s from jsonb_populate_recordset(null::public.%I, $1) r
                    on conflict do nothing
                    returning 1)
                  select count(*) from ins', p_tabla, v_cols, v_sel, p_tabla)
    into v_nuevas using v_filas;

  -- Los números de identificación siguen desde el más alto
  -- (artículos no tiene "id": solo las tablas que lo tienen)
  if exists (select 1 from pg_attribute where attrelid = ('public.' || quote_ident(p_tabla))::regclass and attname = 'id' and not attisdropped) then
    v_seq := pg_get_serial_sequence('public.' || quote_ident(p_tabla), 'id');
  end if;
  if v_seq is not null then
    execute format('select setval(%L, greatest((select coalesce(max(id), 1) from public.%I), 1))', v_seq, p_tabla);
  end if;

  return jsonb_build_object('enviadas', v_enviadas, 'insertadas', v_nuevas);
end;
$$;

revoke execute on function public.restaurar_tabla(text, jsonb) from public, anon, authenticated;
grant execute on function public.restaurar_tabla(text, jsonb) to service_role;
