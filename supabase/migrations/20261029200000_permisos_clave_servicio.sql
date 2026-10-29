-- =====================================================================
--  Permisos de la clave de servicio (la que usan las Edge Functions
--  admin-usuarios y buscar-en-web). El proyecto se creó con
--  "Automatically expose new tables" apagado, así que las tablas solo
--  tenían los permisos que dan las migraciones, y ninguna se los daba a
--  service_role: las funciones no podían leer "perfiles" y respondían 403.
--  service_role nunca llega a la página (solo vive en las funciones).
--  Se puede volver a correr.
-- =====================================================================

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Y para las tablas que se creen más adelante
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
