-- =====================================================================
--  Un CUIT inválido (o ausente) ya no impide cargar un documento.
--  Antes, una orden o un remito de Manager con un CUIT que no tuviera 11
--  dígitos (mal cargado en Manager, vacío, con letras) se rechazaba con
--  "CUIT inválido" y no se podían guardar sus productos. Ahora:
--    - CUIT con dígitos (de cualquier largo): el proveedor se identifica por ese
--      número, tal cual vino (el mismo CUIT mal cargado en una orden y en su
--      remito es el mismo proveedor).
--    - Sin CUIT: el proveedor se identifica por su nombre (si ya existe uno con
--      ese nombre, con o sin CUIT, se usa; si no, se crea sin CUIT). Si el
--      documento tampoco trae nombre, queda como "Proveedor sin identificar".
--  Cuando después llega un documento con el CUIT correcto del mismo nombre, el
--  proveedor sin CUIT lo toma en vez de duplicarse (como con la planilla vieja).
--  Se puede volver a correr.
-- =====================================================================

-- El CUIT guardado puede no ser válido: solo se exige que sean dígitos
alter table public.proveedores drop constraint if exists proveedores_cuit_check;
alter table public.proveedores add constraint proveedores_cuit_check check (cuit is null or cuit ~ '^\d{1,20}$');

create or replace function public.proveedor_por_cuit(p_cuit text, p_nombre text)
returns bigint
language plpgsql security invoker set search_path = public
as $$
declare
  v_cuit text := regexp_replace(coalesce(p_cuit, ''), '\D', '', 'g');
  v_id   bigint;
begin
  -- Sin CUIT: por nombre (reusa el proveedor de ese nombre, con o sin CUIT)
  if v_cuit = '' or length(v_cuit) > 20 then
    return public.proveedor_por_nombre(coalesce(nullif(trim(p_nombre), ''), 'Proveedor sin identificar'));
  end if;

  select id into v_id from public.proveedores where cuit = v_cuit;
  if v_id is null and nullif(trim(p_nombre), '') is not null then
    select id into v_id from public.proveedores
      where cuit is null and public.clave_nombre(nombre) = public.clave_nombre(p_nombre)
      order by id limit 1;
    if v_id is not null then update public.proveedores set cuit = v_cuit where id = v_id; end if;
  end if;
  if v_id is null then
    insert into public.proveedores (cuit, nombre) values (v_cuit, coalesce(nullif(trim(p_nombre), ''), v_cuit))
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
