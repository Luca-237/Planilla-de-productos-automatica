-- =====================================================================
--  Permisos de las funciones "security definer" (pedido por el Security
--  Advisor de Supabase). Se puede volver a correr.
--
--  Postgres da EXECUTE a "public" por defecto en toda función nueva.
--  - Funciones de trigger: nadie las llama directo; los triggers siguen
--    andando sin este permiso (se controla al crear el trigger).
--  - es_admin / es_usuario_activo / puede_cargar: las usan las reglas
--    RLS, que se evalúan con el usuario logueado, así que "authenticated"
--    las necesita. Solo responden sí/no sobre el propio usuario.
--    El aviso "Signed-In Users Can Execute" de estas tres es esperado.
-- =====================================================================

revoke execute on function public.controlar_recepcion()        from public, anon, authenticated;
revoke execute on function public.crear_perfil_nuevo_usuario() from public, anon, authenticated;
revoke execute on function public.proteger_ultimo_admin()      from public, anon, authenticated;

revoke execute on function public.es_admin()          from public, anon;
revoke execute on function public.es_usuario_activo() from public, anon;
revoke execute on function public.puede_cargar()      from public, anon;
grant  execute on function public.es_admin()          to authenticated;
grant  execute on function public.es_usuario_activo() to authenticated;
grant  execute on function public.puede_cargar()      to authenticated;
