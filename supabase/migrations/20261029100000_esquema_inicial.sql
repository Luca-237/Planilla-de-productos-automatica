-- =====================================================================
--  Carga de artículos por remito y órdenes de compra — Cindy Mayorista.
--  Esquema inicial. Se corre UNA vez en Supabase → SQL Editor.
--
--  Qué resuelve: se suben la orden de compra (OC) y el remito de ingreso
--  que exporta Manager; la base cruza lo que llegó contra lo pedido y
--  muestra qué falta y hace cuántos días.
--
--  Roles:
--    admin     → todo, incluidos usuarios y borrar documentos cargados por error.
--    carga     → sube OC y remitos, edita artículos (Antonella).
--    consulta  → solo mira.
--  Los permisos los controla la base (RLS), no la página.
--
--  El cruce OC ↔ remito lo hace la base (cargar_remito), no el navegador:
--  así es una sola operación y dos cargas al mismo tiempo no pueden
--  asignar dos veces las mismas unidades.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Perfiles de usuario (uno por cuenta de Supabase Auth)
-- ---------------------------------------------------------------------
create table if not exists public.perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  nombre     text not null default '',
  rol        text not null default 'consulta' check (rol in ('admin', 'carga', 'consulta')),
  -- Las cuentas nacen desactivadas: si alguien se registra por su cuenta, no entra.
  activo     boolean not null default false,
  creado_en  timestamptz not null default now()
);

create or replace function public.es_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin' and activo);
$$;

create or replace function public.es_usuario_activo()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and activo);
$$;

create or replace function public.puede_cargar()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol in ('admin', 'carga') and activo);
$$;

create or replace function public.crear_perfil_nuevo_usuario()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.perfiles (id, email, nombre, activo)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'nombre', ''), false)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil_nuevo_usuario();

-- Usuarios que ya existieran antes de correr este script
insert into public.perfiles (id, email, nombre)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'nombre', '')
from auth.users u
on conflict (id) do nothing;

-- Nunca puede quedar el sistema sin un admin activo
create or replace function public.proteger_ultimo_admin()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.rol = 'admin' and old.activo
     and (tg_op = 'DELETE' or new.rol <> 'admin' or not new.activo)
     and not exists (select 1 from public.perfiles
                     where rol = 'admin' and activo and id <> old.id) then
    raise exception 'No se puede quitar el último admin activo';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists proteger_admin on public.perfiles;
create trigger proteger_admin
  before update or delete on public.perfiles
  for each row execute function public.proteger_ultimo_admin();

-- Marca de última modificación (quién y cuándo)
create or replace function public.marcar_actualizacion()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  return new;
end;
$$;

-- Fecha de hoy en Argentina (Supabase corre en UTC)
create or replace function public.hoy()
returns date
language sql stable set search_path = public
as $$
  select (now() at time zone 'America/Argentina/Cordoba')::date;
$$;

-- ---------------------------------------------------------------------
-- 2) Proveedores (se identifican por CUIT: el nombre cambia entre documentos)
-- ---------------------------------------------------------------------
create table if not exists public.proveedores (
  id         bigint generated always as identity primary key,
  cuit       text not null unique check (cuit ~ '^\d{11}$'),
  nombre     text not null check (length(trim(nombre)) > 0),
  creado_en  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3) Artículos: un registro por código de Cindy.
--    Acá viven los datos de la web (antes, columnas L en adelante de la
--    planilla "Proceso Ecommerce"): son del artículo, no de cada compra.
-- ---------------------------------------------------------------------
create table if not exists public.articulos (
  codigo              text primary key check (length(trim(codigo)) > 0),
  descripcion         text not null default '',
  proveedor_id        bigint references public.proveedores(id) on delete set null,
  tipo                text not null default 'PADRE' check (tipo in ('PADRE', 'VARIANTE', 'INDIVIDUAL')),
  padre_codigo        text references public.articulos(codigo) on update cascade on delete set null,
  variantes           text not null default '',
  cod_barra           text not null default '',
  foto                boolean not null default false,
  descripcion_ok      boolean not null default false,
  cargado_web         boolean not null default false,
  catalogo            boolean not null default false,
  fecha_alta_web      date,
  sin_stock           boolean not null default false,
  observaciones       text not null default '',
  titulo_web          text not null default '',
  descripcion_web     text not null default '',
  estado_descripcion  text not null default '',
  ya_no_esta          boolean not null default false,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  actualizado_por     uuid references auth.users(id) on delete set null
);
create index if not exists articulos_proveedor_idx on public.articulos (proveedor_id);
create index if not exists articulos_padre_idx on public.articulos (padre_codigo);

drop trigger if exists articulos_actualizado on public.articulos;
create trigger articulos_actualizado
  before update on public.articulos
  for each row execute function public.marcar_actualizacion();

-- ---------------------------------------------------------------------
-- 4) Órdenes de compra (exportadas de Manager) y sus líneas
-- ---------------------------------------------------------------------
create table if not exists public.ordenes_compra (
  id                     bigint generated always as identity primary key,
  numero                 text not null unique check (numero ~ '^\d{4}-\d{8}$'),
  proveedor_id           bigint not null references public.proveedores(id),
  fecha                  date not null,
  vencimiento            date,
  comprador              text not null default '',
  subtotal               numeric(14,2),
  desc_rec               numeric(14,2),
  descuento_porcentaje   numeric(6,2),
  impuesto               numeric(14,2),
  total                  numeric(14,2),
  -- Acuerdo comercial (lo cierran Pablo/Mariela con el proveedor). Con "mitad
  -- factura / mitad presupuesto" la factura trae menos unidades de las que llegan.
  modalidad_facturacion  text check (modalidad_facturacion in ('100% facturada', 'medio IVA', 'mitad factura / mitad presupuesto', 'sin facturar')),
  -- Cerrada = no se espera nada más aunque falten unidades (ej. el proveedor no tiene)
  cerrada                boolean not null default false,
  motivo_cierre          text not null default '',
  observaciones          text not null default '',
  archivo                text not null default '',
  cargado_por            uuid default auth.uid() references auth.users(id) on delete set null,
  creado_en              timestamptz not null default now()
);
create index if not exists ordenes_proveedor_idx on public.ordenes_compra (proveedor_id, fecha);

create table if not exists public.oc_lineas (
  id               bigint generated always as identity primary key,
  orden_id         bigint not null references public.ordenes_compra(id) on delete cascade,
  renglon          int not null check (renglon > 0),
  codigo           text not null references public.articulos(codigo) on update cascade,
  descripcion      text not null default '',
  cantidad         numeric(12,2) not null check (cantidad > 0),
  precio_unitario  numeric(14,2),
  bonificacion     numeric(6,2),
  total            numeric(14,2),
  -- Fecha del "Plan de Entrega" de Manager (si no trae, la de la OC)
  fecha_entrega    date,
  -- Unidades que ya no se esperan (se cancelaron con el proveedor)
  cancelada        numeric(12,2) not null default 0 check (cancelada >= 0),
  unique (orden_id, renglon),
  check (cancelada <= cantidad)
);
create index if not exists oc_lineas_codigo_idx on public.oc_lineas (codigo);

-- ---------------------------------------------------------------------
-- 5) Remitos de ingreso (exportados de Manager), sus líneas y la
--    asignación de lo recibido a cada línea de OC
-- ---------------------------------------------------------------------
create table if not exists public.remitos (
  id            bigint generated always as identity primary key,
  numero        text not null check (length(trim(numero)) > 0),
  proveedor_id  bigint not null references public.proveedores(id),
  fecha         date not null,
  total         numeric(14,2),
  archivo       text not null default '',
  cargado_por   uuid default auth.uid() references auth.users(id) on delete set null,
  creado_en     timestamptz not null default now(),
  unique (proveedor_id, numero)
);

create table if not exists public.remito_lineas (
  id           bigint generated always as identity primary key,
  remito_id    bigint not null references public.remitos(id) on delete cascade,
  renglon      int not null check (renglon > 0),
  codigo       text not null,
  descripcion  text not null default '',
  cantidad     numeric(12,2) not null check (cantidad > 0),
  costo        numeric(14,2),
  unique (remito_id, renglon)
);
create index if not exists remito_lineas_codigo_idx on public.remito_lineas (codigo);

create table if not exists public.recepciones (
  id               bigint generated always as identity primary key,
  remito_linea_id  bigint not null references public.remito_lineas(id) on delete cascade,
  oc_linea_id      bigint not null references public.oc_lineas(id) on delete cascade,
  cantidad         numeric(12,2) not null check (cantidad > 0),
  unique (remito_linea_id, oc_linea_id)
);
create index if not exists recepciones_oc_linea_idx on public.recepciones (oc_linea_id);

-- Red de seguridad: nunca se recibe más de lo que queda pendiente en una línea
-- ni se asigna más de lo que trae la línea del remito.
create or replace function public.controlar_recepcion()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_pedido numeric; v_cancelada numeric; v_recibido numeric; v_remito numeric; v_asignado numeric;
begin
  select cantidad, cancelada into v_pedido, v_cancelada from public.oc_lineas where id = new.oc_linea_id for update;
  select coalesce(sum(cantidad), 0) into v_recibido from public.recepciones
    where oc_linea_id = new.oc_linea_id and id is distinct from new.id;
  if v_recibido + new.cantidad > v_pedido - v_cancelada then
    raise exception 'La línea de OC % recibiría % y solo quedan % pendientes',
      new.oc_linea_id, trim_scale(new.cantidad), trim_scale(v_pedido - v_cancelada - v_recibido);
  end if;
  select cantidad into v_remito from public.remito_lineas where id = new.remito_linea_id;
  select coalesce(sum(cantidad), 0) into v_asignado from public.recepciones
    where remito_linea_id = new.remito_linea_id and id is distinct from new.id;
  if v_asignado + new.cantidad > v_remito then
    raise exception 'La línea de remito % trae % y se asignarían %',
      new.remito_linea_id, trim_scale(v_remito), trim_scale(v_asignado + new.cantidad);
  end if;
  return new;
end;
$$;

drop trigger if exists controlar_recepcion on public.recepciones;
create trigger controlar_recepcion
  before insert or update on public.recepciones
  for each row execute function public.controlar_recepcion();

-- ---------------------------------------------------------------------
-- 6) Preferencias de cada usuario (columnas que oculta en la tabla)
-- ---------------------------------------------------------------------
create table if not exists public.preferencias (
  usuario_id        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  columnas_ocultas  text[] not null default '{}',
  actualizado_en    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7) Vistas. security_invoker: respetan los permisos de quien consulta.
--    Se borran y se crean de nuevo: las migraciones siguientes les agregan
--    columnas, y "create or replace" no puede sacarlas si se vuelve a
--    correr este script. Las vistas no guardan datos; los permisos se
--    vuelven a dar en la sección 9.
-- ---------------------------------------------------------------------
drop view if exists public.v_planilla;
drop view if exists public.v_pendientes;
drop view if exists public.v_sobrantes;
drop view if exists public.v_oc_lineas;

-- Cada línea de OC con lo recibido, lo pendiente y los días
create or replace view public.v_oc_lineas
with (security_invoker = true) as
select
  l.id, l.orden_id, o.numero as orden, o.fecha as fecha_orden, o.proveedor_id, p.nombre as proveedor, p.cuit,
  l.renglon, l.codigo, l.descripcion, l.cantidad, l.precio_unitario, l.total, l.fecha_entrega, l.cancelada,
  coalesce(r.recibido, 0) as recibido,
  greatest(l.cantidad - l.cancelada - coalesce(r.recibido, 0), 0) as pendiente,
  r.ultima_recepcion,
  case
    when l.cantidad - l.cancelada - coalesce(r.recibido, 0) <= 0 then
      case when coalesce(r.recibido, 0) = 0 then 'cancelada' else 'completa' end
    when o.cerrada then 'cerrada'
    when coalesce(r.recibido, 0) > 0 then 'parcial'
    else 'pendiente'
  end as estado,
  public.hoy() - o.fecha as dias_desde_orden,
  greatest(public.hoy() - coalesce(l.fecha_entrega, o.fecha), 0) as dias_atraso,
  o.cerrada
from public.oc_lineas l
join public.ordenes_compra o on o.id = l.orden_id
join public.proveedores p on p.id = o.proveedor_id
left join lateral (
  select sum(rc.cantidad) as recibido, max(rm.fecha) as ultima_recepcion
  from public.recepciones rc
  join public.remito_lineas rl on rl.id = rc.remito_linea_id
  join public.remitos rm on rm.id = rl.remito_id
  where rc.oc_linea_id = l.id
) r on true;

-- Lo que falta llegar (para el tablero de pendientes y los avisos)
create or replace view public.v_pendientes
with (security_invoker = true) as
select * from public.v_oc_lineas
where estado in ('pendiente', 'parcial');

-- La "planilla": una fila por línea de OC con los datos web del artículo
create or replace view public.v_planilla
with (security_invoker = true) as
select
  v.orden, v.fecha_orden, v.proveedor, v.codigo, coalesce(nullif(a.descripcion, ''), v.descripcion) as nombre,
  v.cantidad, v.precio_unitario, v.estado, v.recibido, v.pendiente, v.ultima_recepcion,
  v.dias_desde_orden, v.dias_atraso,
  a.tipo, a.padre_codigo, a.variantes, a.cod_barra, a.foto, a.descripcion_ok, a.cargado_web, a.catalogo,
  a.fecha_alta_web, a.sin_stock, a.observaciones, a.titulo_web, a.descripcion_web, a.estado_descripcion, a.ya_no_esta,
  v.id as oc_linea_id, v.orden_id
from public.v_oc_lineas v
join public.articulos a on a.codigo = v.codigo;

-- Lo que llegó en un remito y no estaba pedido (o llegó de más)
create or replace view public.v_sobrantes
with (security_invoker = true) as
select rm.id as remito_id, rm.numero as remito, rm.fecha, p.nombre as proveedor, rl.codigo, rl.descripcion,
       rl.cantidad, rl.cantidad - coalesce(sum(rc.cantidad), 0) as sin_orden
from public.remito_lineas rl
join public.remitos rm on rm.id = rl.remito_id
join public.proveedores p on p.id = rm.proveedor_id
left join public.recepciones rc on rc.remito_linea_id = rl.id
group by rm.id, rm.numero, rm.fecha, p.nombre, rl.id, rl.codigo, rl.descripcion, rl.cantidad
having rl.cantidad - coalesce(sum(rc.cantidad), 0) > 0;

-- ---------------------------------------------------------------------
-- 8) Carga de documentos. Reciben el JSON que arma js/lector-manager.js.
--    Con p_confirmar = false hacen todo, devuelven el resultado y lo
--    deshacen: sirve para mostrar "así va a quedar" antes de guardar.
-- ---------------------------------------------------------------------
create or replace function public.proveedor_por_cuit(p_cuit text, p_nombre text)
returns bigint
language plpgsql security invoker set search_path = public
as $$
declare v_id bigint;
begin
  if coalesce(p_cuit, '') !~ '^\d{11}$' then raise exception 'CUIT inválido: %', p_cuit; end if;
  select id into v_id from public.proveedores where cuit = p_cuit;
  if v_id is null then
    insert into public.proveedores (cuit, nombre) values (p_cuit, coalesce(nullif(trim(p_nombre), ''), p_cuit))
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.aplicar_orden_compra(p_doc jsonb)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_prov bigint; v_orden bigint; v_linea jsonb; v_renglon int := 0; v_nuevos int := 0; v_fecha date;
begin
  if not public.puede_cargar() then raise exception 'No tenés permiso para cargar documentos'; end if;
  if p_doc ->> 'tipo' is distinct from 'orden_compra' then raise exception 'El documento no es una orden de compra'; end if;
  if jsonb_array_length(coalesce(p_doc -> 'lineas', '[]')) = 0 then raise exception 'La orden de compra no tiene artículos'; end if;
  if exists (select 1 from public.ordenes_compra where numero = p_doc ->> 'numero') then
    raise exception 'La orden de compra % ya está cargada', p_doc ->> 'numero';
  end if;
  v_fecha := (p_doc ->> 'fecha')::date;
  if v_fecha is null then raise exception 'La orden de compra no tiene fecha'; end if;

  v_prov := public.proveedor_por_cuit(p_doc ->> 'cuit', p_doc ->> 'proveedor');
  insert into public.ordenes_compra (numero, proveedor_id, fecha, vencimiento, comprador, subtotal, desc_rec,
                                     descuento_porcentaje, impuesto, total, archivo)
  values (p_doc ->> 'numero', v_prov, v_fecha, (p_doc ->> 'vencimiento')::date, coalesce(p_doc ->> 'comprador', ''),
          (p_doc -> 'totales' ->> 'SubTotal 1')::numeric, (p_doc -> 'totales' ->> 'Desc/Rec')::numeric,
          (p_doc ->> 'descuento_porcentaje')::numeric, (p_doc -> 'totales' ->> 'Impuesto')::numeric,
          (p_doc -> 'totales' ->> 'Total')::numeric, coalesce(p_doc ->> 'archivo', ''))
  returning id into v_orden;

  for v_linea in select * from jsonb_array_elements(p_doc -> 'lineas') loop
    v_renglon := v_renglon + 1;
    -- El artículo se crea la primera vez que aparece; si ya existe no se toca
    insert into public.articulos (codigo, descripcion, proveedor_id)
    values (v_linea ->> 'codigo', coalesce(v_linea ->> 'descripcion', ''), v_prov)
    on conflict (codigo) do nothing;
    if found then v_nuevos := v_nuevos + 1; end if;
    insert into public.oc_lineas (orden_id, renglon, codigo, descripcion, cantidad, precio_unitario, bonificacion, total, fecha_entrega)
    values (v_orden, v_renglon, v_linea ->> 'codigo', coalesce(v_linea ->> 'descripcion', ''),
            (v_linea ->> 'cantidad')::numeric, (v_linea ->> 'precio_unitario')::numeric,
            (v_linea ->> 'bonificacion')::numeric, (v_linea ->> 'total')::numeric,
            coalesce((select max((pe ->> 'fecha')::date) from jsonb_array_elements(coalesce(v_linea -> 'plan_entrega', '[]')) pe), v_fecha));
  end loop;

  return jsonb_build_object('tipo', 'orden_compra', 'orden_id', v_orden, 'numero', p_doc ->> 'numero',
                            'proveedor_id', v_prov, 'lineas', v_renglon, 'articulos_nuevos', v_nuevos);
end;
$$;

create or replace function public.aplicar_remito(p_doc jsonb)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_prov bigint; v_remito bigint; v_linea jsonb; v_rl bigint; v_renglon int := 0;
  v_resto numeric; v_toma numeric; v_oc record; v_asig jsonb; v_lineas jsonb := '[]';
begin
  if not public.puede_cargar() then raise exception 'No tenés permiso para cargar documentos'; end if;
  if p_doc ->> 'tipo' is distinct from 'remito_ingreso' then raise exception 'El documento no es un remito de ingreso'; end if;
  if jsonb_array_length(coalesce(p_doc -> 'lineas', '[]')) = 0 then raise exception 'El remito no tiene artículos'; end if;
  if (p_doc ->> 'fecha') is null then raise exception 'El remito no tiene fecha'; end if;

  v_prov := public.proveedor_por_cuit(p_doc ->> 'cuit', p_doc ->> 'proveedor');
  if exists (select 1 from public.remitos where proveedor_id = v_prov and numero = p_doc ->> 'numero') then
    raise exception 'El remito % de este proveedor ya está cargado', p_doc ->> 'numero';
  end if;
  insert into public.remitos (numero, proveedor_id, fecha, total, archivo)
  values (p_doc ->> 'numero', v_prov, (p_doc ->> 'fecha')::date, (p_doc ->> 'total')::numeric, coalesce(p_doc ->> 'archivo', ''))
  returning id into v_remito;

  for v_linea in select * from jsonb_array_elements(p_doc -> 'lineas') loop
    v_renglon := v_renglon + 1;
    insert into public.remito_lineas (remito_id, renglon, codigo, descripcion, cantidad, costo)
    values (v_remito, v_renglon, v_linea ->> 'codigo', coalesce(v_linea ->> 'descripcion', ''),
            (v_linea ->> 'cantidad')::numeric, (v_linea ->> 'costo')::numeric)
    returning id into v_rl;

    -- Se reparte entre las OC abiertas del mismo proveedor y código, de la más vieja a la más nueva
    v_resto := (v_linea ->> 'cantidad')::numeric;
    v_asig := '[]';
    for v_oc in
      select l.id, o.numero,
             l.cantidad - l.cancelada - coalesce((select sum(rc.cantidad) from public.recepciones rc where rc.oc_linea_id = l.id), 0) as pendiente
      from public.oc_lineas l
      join public.ordenes_compra o on o.id = l.orden_id
      where o.proveedor_id = v_prov and l.codigo = v_linea ->> 'codigo' and not o.cerrada
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
    'tipo', 'remito_ingreso', 'remito_id', v_remito, 'numero', p_doc ->> 'numero', 'proveedor_id', v_prov,
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

-- Puntos de entrada que usa la página. 'CS001' es un código propio para deshacer la simulación.
create or replace function public.cargar_orden_compra(p_doc jsonb, p_confirmar boolean default false)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare v jsonb;
begin
  begin
    v := public.aplicar_orden_compra(p_doc);
    if not p_confirmar then raise exception using errcode = 'CS001', message = 'simulación'; end if;
  exception when sqlstate 'CS001' then
    return v || jsonb_build_object('confirmado', false);
  end;
  return v || jsonb_build_object('confirmado', true);
end;
$$;

create or replace function public.cargar_remito(p_doc jsonb, p_confirmar boolean default false)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare v jsonb;
begin
  begin
    v := public.aplicar_remito(p_doc);
    if not p_confirmar then raise exception using errcode = 'CS001', message = 'simulación'; end if;
  exception when sqlstate 'CS001' then
    return v || jsonb_build_object('confirmado', false);
  end;
  return v || jsonb_build_object('confirmado', true);
end;
$$;

-- ---------------------------------------------------------------------
-- 9) Acceso por la API. El proyecto se crea con "Automatically expose new
--    tables" APAGADO: los permisos sobre las tablas se dan acá, a mano.
--    Sin sesión (anon) no se da nada. Después, la RLS decide qué filas.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
grant select                         on public.perfiles       to authenticated;
grant select, insert, update         on public.proveedores    to authenticated;
grant select, insert, update         on public.articulos      to authenticated;
grant select, insert, update, delete on public.ordenes_compra to authenticated;
grant select, insert, update         on public.oc_lineas      to authenticated;
grant select, insert, delete         on public.remitos        to authenticated;
grant select, insert                 on public.remito_lineas  to authenticated;
grant select, insert                 on public.recepciones    to authenticated;
grant select, insert, update, delete on public.preferencias   to authenticated;
grant select on public.v_oc_lineas, public.v_pendientes, public.v_planilla, public.v_sobrantes to authenticated;

-- ---------------------------------------------------------------------
-- 10) Permisos por fila (RLS)
-- ---------------------------------------------------------------------
alter table public.perfiles        enable row level security;
alter table public.proveedores     enable row level security;
alter table public.articulos       enable row level security;
alter table public.ordenes_compra  enable row level security;
alter table public.oc_lineas       enable row level security;
alter table public.remitos         enable row level security;
alter table public.remito_lineas   enable row level security;
alter table public.recepciones     enable row level security;
alter table public.preferencias    enable row level security;

drop policy if exists perfiles_select on public.perfiles;
drop policy if exists proveedores_select on public.proveedores;
drop policy if exists proveedores_insert on public.proveedores;
drop policy if exists proveedores_update on public.proveedores;
drop policy if exists articulos_select on public.articulos;
drop policy if exists articulos_insert on public.articulos;
drop policy if exists articulos_update on public.articulos;
drop policy if exists ordenes_select on public.ordenes_compra;
drop policy if exists ordenes_insert on public.ordenes_compra;
drop policy if exists ordenes_update on public.ordenes_compra;
drop policy if exists ordenes_delete on public.ordenes_compra;
drop policy if exists oc_lineas_select on public.oc_lineas;
drop policy if exists oc_lineas_insert on public.oc_lineas;
drop policy if exists oc_lineas_update on public.oc_lineas;
drop policy if exists remitos_select on public.remitos;
drop policy if exists remitos_insert on public.remitos;
drop policy if exists remitos_delete on public.remitos;
drop policy if exists remito_lineas_select on public.remito_lineas;
drop policy if exists remito_lineas_insert on public.remito_lineas;
drop policy if exists recepciones_select on public.recepciones;
drop policy if exists recepciones_insert on public.recepciones;
drop policy if exists preferencias_propias on public.preferencias;

-- Perfiles: cada uno ve el suyo; el admin ve todos. Los cambios los hace la Edge Function (admin).
create policy perfiles_select on public.perfiles for select to authenticated using (id = auth.uid() or public.es_admin());

-- Todo usuario activo consulta; solo admin y carga escriben
create policy proveedores_select on public.proveedores for select to authenticated using (public.es_usuario_activo());
create policy proveedores_insert on public.proveedores for insert to authenticated with check (public.puede_cargar());
create policy proveedores_update on public.proveedores for update to authenticated using (public.puede_cargar()) with check (public.puede_cargar());

create policy articulos_select on public.articulos for select to authenticated using (public.es_usuario_activo());
create policy articulos_insert on public.articulos for insert to authenticated with check (public.puede_cargar());
create policy articulos_update on public.articulos for update to authenticated using (public.puede_cargar()) with check (public.puede_cargar());

create policy ordenes_select on public.ordenes_compra for select to authenticated using (public.es_usuario_activo());
create policy ordenes_insert on public.ordenes_compra for insert to authenticated with check (public.puede_cargar());
create policy ordenes_update on public.ordenes_compra for update to authenticated using (public.puede_cargar()) with check (public.puede_cargar());
-- Borrar un documento cargado por error: solo admin (se borran también sus líneas y recepciones)
create policy ordenes_delete on public.ordenes_compra for delete to authenticated using (public.es_admin());

create policy oc_lineas_select on public.oc_lineas for select to authenticated using (public.es_usuario_activo());
create policy oc_lineas_insert on public.oc_lineas for insert to authenticated with check (public.puede_cargar());
-- Para marcar unidades canceladas
create policy oc_lineas_update on public.oc_lineas for update to authenticated using (public.puede_cargar()) with check (public.puede_cargar());

create policy remitos_select on public.remitos for select to authenticated using (public.es_usuario_activo());
create policy remitos_insert on public.remitos for insert to authenticated with check (public.puede_cargar());
create policy remitos_delete on public.remitos for delete to authenticated using (public.es_admin());

create policy remito_lineas_select on public.remito_lineas for select to authenticated using (public.es_usuario_activo());
create policy remito_lineas_insert on public.remito_lineas for insert to authenticated with check (public.puede_cargar());

create policy recepciones_select on public.recepciones for select to authenticated using (public.es_usuario_activo());
create policy recepciones_insert on public.recepciones for insert to authenticated with check (public.puede_cargar());

create policy preferencias_propias on public.preferencias for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid() and public.es_usuario_activo());

-- Sin sesión no se carga nada (igual las funciones exigen puede_cargar()).
-- Postgres da EXECUTE a "public" por defecto: hay que sacárselo a public, no solo a anon.
-- La página usa cargar_*; aplicar_* son internas (las llaman cargar_* con el mismo usuario).
revoke execute on function public.aplicar_orden_compra(jsonb) from public, anon;
revoke execute on function public.aplicar_remito(jsonb) from public, anon;
revoke execute on function public.cargar_orden_compra(jsonb, boolean) from public, anon;
revoke execute on function public.cargar_remito(jsonb, boolean) from public, anon;
grant execute on function public.aplicar_orden_compra(jsonb) to authenticated;
grant execute on function public.aplicar_remito(jsonb) to authenticated;
grant execute on function public.cargar_orden_compra(jsonb, boolean) to authenticated;
grant execute on function public.cargar_remito(jsonb, boolean) to authenticated;
