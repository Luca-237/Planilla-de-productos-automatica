-- =====================================================================
--  Políticas rápidas: "¿quién soy?" una vez por consulta, no por fila.
--
--  Con la cuenta Cindy, es_usuario_activo(), es_admin(), puede_cargar() y
--  mi_perfil_id() leen el token (auth.jwt()) en cada llamada. Dentro de una
--  política se llamaban una vez POR FILA: v_pendientes pasó de 42 ms a más
--  de 4 s y la página cortaba por "statement timeout".
--  Envueltas en (select ...) Postgres las calcula una sola vez por consulta
--  (lo que recomienda Supabase para auth.uid()). El resultado es el mismo.
--  Se puede correr dos veces (no vuelve a envolver lo ya envuelto).
-- =====================================================================
do $$
declare
  r record;
  v_roles text;
  v_qual text;
  v_check text;
  v_patron constant text := '(?<!SELECT )\m(public\.)?(es_usuario_activo|es_admin|puede_cargar|mi_perfil_id)\(\)';
  v_reemplazo constant text := '(select public.\2())';
begin
  for r in select * from pg_policies
           where schemaname = 'public'
             and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ v_patron
  loop
    select string_agg(case when x = 'public' then 'public' else quote_ident(x) end, ', ')
      into v_roles from unnest(r.roles) x;
    v_qual  := regexp_replace(r.qual, v_patron, v_reemplazo, 'g');
    v_check := regexp_replace(r.with_check, v_patron, v_reemplazo, 'g');
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    execute format('create policy %I on public.%I as %s for %s to %s%s%s',
      r.policyname, r.tablename, r.permissive, r.cmd, v_roles,
      case when v_qual is not null then ' using (' || v_qual || ')' else '' end,
      case when v_check is not null then ' with check (' || v_check || ')' else '' end);
  end loop;
end $$;
