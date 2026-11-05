-- =====================================================================
--  Registro de los backups diarios. Lo escribe la función backup-datos
--  (con la clave de servicio) cuando el script termina, bien o mal. Lo ve
--  solo un admin, en Configuración: así se nota si un día no se hizo.
--  Se puede volver a correr.
-- =====================================================================

create table if not exists public.backups_registro (
  id         bigint generated always as identity primary key,
  creado_en  timestamptz not null default now(),
  estado     text not null check (estado in ('ok', 'error')),
  archivo    text not null default '',
  drive_url  text not null default '',
  filas      jsonb,
  bytes      bigint,
  error      text not null default '',
  origen     text not null default 'programado'
);
create index if not exists backups_registro_fecha_idx on public.backups_registro (creado_en desc);

alter table public.backups_registro enable row level security;
drop policy if exists backups_registro_select on public.backups_registro;
create policy backups_registro_select on public.backups_registro for select to authenticated using (public.es_admin());

revoke all on public.backups_registro from public, anon, authenticated;
grant select on public.backups_registro to authenticated;
grant select, insert, update, delete on public.backups_registro to service_role;
grant usage, select on all sequences in schema public to service_role;
