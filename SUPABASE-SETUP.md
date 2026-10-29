# Configurar Supabase (una sola vez)

Proyecto **nuevo y separado** de rótulos y de RRHH: las cuentas y los datos de compras no se mezclan con nada más.

> **Estado (29/10/2026): hecho.** Proyecto `compras-cindy` (`bghjltwkkxnxjypuuvnu`, us-west-2), las 3 migraciones aplicadas, registro apagado, función `admin-usuarios` publicada y Luca como admin. Esta guía queda para rehacerlo o para un proyecto nuevo.

> **Nunca pegues en el chat, en el vault ni en el código** la contraseña de la base ni la clave `secret` / `service_role`. Van al gestor de contraseñas.

---

## 1. Crear el proyecto
1. https://supabase.com/dashboard → organización **cindy** → **New project**.
2. **Name:** `compras-cindy`. **Region:** Americas (o la que se elija; el proyecto actual quedó en us-west-2).
3. **Database password:** **Generate a password** y guardarla en el gestor de contraseñas.
4. **Security:**
   - **Enable Data API** → prendido.
   - **Automatically expose new tables** → **apagado** (lo recomienda Supabase). La migración da a mano solo los permisos que usa la página, y ninguno a quien no tiene sesión.
   - **Enable automatic RLS** → da igual: la migración prende la RLS en todas las tablas.
5. **Create new project** y esperar 1 o 2 minutos.

## 2. Correr las migraciones (en orden)
**SQL Editor → New query**. Por cada archivo de `supabase/migrations/`, en orden de nombre (empiezan con la fecha):
1. `20261029100000_esquema_inicial.sql`
2. `20261029120000_permisos_funciones.sql`
3. `20261029140000_nombre_corto_proveedor.sql` (nombre corto del proveedor: Target, Bagcherry…)

Pegar el contenido **completo** → **Run**. Supabase avisa "Potential issue detected… destructive operations": es por los `drop … if exists` y `revoke`, que hacen que el script se pueda volver a correr. Confirmar con **Run query**. Tiene que decir **Success. No rows returned**.

> Las migraciones se pueden volver a correr sin perder datos (está probado), siempre **todas y en orden**: la primera borra y vuelve a crear las vistas, y las siguientes les agregan columnas. Las futuras se corren igual, en orden.

## 3. Comprobar que quedó bien
```sql
select
  (select count(*) from pg_tables where schemaname = 'public'
     and tablename in ('perfiles','proveedores','articulos','ordenes_compra','oc_lineas',
                       'remitos','remito_lineas','recepciones','preferencias'))           as tablas,      -- 9
  (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity)        as sin_rls,     -- 0
  (select count(*) from pg_views  where schemaname = 'public'
     and viewname in ('v_oc_lineas','v_pendientes','v_planilla','v_sobrantes'))           as vistas,      -- 4
  has_function_privilege('anon', 'public.cargar_remito(jsonb, boolean)', 'execute')        as anon_carga,  -- false
  has_table_privilege('anon', 'public.ordenes_compra', 'select')                      as anon_tablas, -- false
  has_function_privilege('authenticated', 'public.cargar_remito(jsonb, boolean)', 'execute') as user_carga; -- true
```
Tiene que dar: `tablas` 9, `sin_rls` 0, `vistas` 4, `anon_carga` **false**, `anon_tablas` **false** y `user_carga` **true**.

**Advisors → Security Advisor → Rerun linter:** 0 errores y estos 4 avisos, que son esperados:
- *Signed-In Users Can Execute SECURITY DEFINER Function* en `es_admin`, `es_usuario_activo` y `puede_cargar`: las usan las reglas de permisos (RLS) y solo responden sí/no sobre el propio usuario.
- *Leaked Password Protection Disabled*: es una función del plan pago.

## 4. Apagar el registro público
**Authentication → Sign In / Providers**, sección **User Signups**:
- **Allow new users to sign up** → **apagado**. Las cuentas las crea un admin desde la página.
- **Confirm email** → **apagado** (los usuarios no tienen un email real).
- **Save changes**.

Más abajo, en **Auth Providers**, **Email** tiene que decir **ENABLED**.
⚠ No apagar el proveedor Email: en RRHH pasó y nadie podía ingresar. Lo que se apaga es el **registro**, no el proveedor.

Para comprobarlo desde afuera: un registro responde `signup_disabled`; un login con datos falsos, `invalid_credentials`; leer una tabla sin sesión, `401`.

## 5. Publicar la función de usuarios
Es la que usa la sección **Usuarios** de la página para crear cuentas, cambiar el rol, activar/desactivar y cambiar contraseñas. Necesita la clave de servicio, que Supabase le inyecta sola: **nunca va en el código**.

1. **Edge Functions → Deploy a new function → Via Editor (Open Editor)**.
2. Reemplazar el ejemplo por todo el contenido de `supabase/functions/admin-usuarios/index.ts`.
3. **Function name:** `admin-usuarios` → **Deploy function**.
4. En **Settings** de la función: **Verify JWT with legacy secret** → **apagado** → **Save changes**.
   Con las claves nuevas de Supabase, las sesiones no están firmadas con el "legacy secret" y la puerta de entrada rechazaría al admin. La función controla sola que haya una sesión válida y que sea de un **admin activo** (lo recomienda el propio panel).

Comprobarlo sin sesión: un `POST` a `https://<proyecto>.supabase.co/functions/v1/admin-usuarios` tiene que responder `401` ("Falta iniciar sesión"), y con un token inventado, `401` ("Sesión inválida o vencida").

## 6. Crear el primer admin
Solo el primero se crea desde el panel. Los demás, desde la página (**Configuración → Usuarios**).
1. **Authentication → Users → Add user → Create new user**: email y contraseña (al gestor), marcar **Auto Confirm User**.
2. **SQL Editor** (cambiando el email):
   ```sql
   update public.perfiles set rol = 'admin', activo = true, nombre = 'Luca' where email = 'cindy.lucam@gmail.com';
   select email, nombre, rol, activo from public.perfiles order by email;
   ```

> Roles: **admin** puede todo, incluidos usuarios y borrar un documento cargado por error. **carga** sube OC y remitos, cierra OC, cancela unidades y edita los datos web. **consulta** solo mira. Siempre queda un admin activo: la base no deja desactivar al último.
>
> Usuario para ingresar: el email completo, o solo el nombre (`antonella`), que se completa como `antonella@compras.cindymayorista.com.ar`.

## 7. Probar permisos y el cruce sin la página
Terminan en `rollback`: **no guardan nada**.

**7.1 — Con el admin: OC de 10 y remito de 4 + un código que nadie pidió.**
```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub',
  (select id from auth.users where email = 'cindy.lucam@gmail.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.cargar_orden_compra('{"tipo":"orden_compra","numero":"9999-00000001","fecha":"2026-10-20","cuit":"30999999991","proveedor":"PROVEEDOR DE PRUEBA","lineas":[{"codigo":"PRUEBA1","descripcion":"ARTICULO DE PRUEBA","cantidad":10,"precio_unitario":100,"total":1000}]}'::jsonb, true);
select public.cargar_remito('{"tipo":"remito_ingreso","numero":"0001-00000001","fecha":"2026-10-29","cuit":"30999999991","proveedor":"PROVEEDOR DE PRUEBA","lineas":[{"codigo":"PRUEBA1","cantidad":4,"costo":100},{"codigo":"NOPEDIDO","cantidad":2,"costo":50}]}'::jsonb, true);
select orden, codigo, cantidad, recibido, pendiente, estado, dias_desde_orden, (select count(*) from public.v_sobrantes) as sobrantes from public.v_oc_lineas;
rollback;
```
Esperado: `recibido` 4, `pendiente` 6, `estado` parcial, `dias_desde_orden` = días desde el 20/10 (9 el 29/10) y `sobrantes` 1.

**7.2 — Un usuario sin perfil no puede cargar.**
```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.cargar_orden_compra('{"tipo":"orden_compra","numero":"9999-00000001","fecha":"2026-10-29","cuit":"30999999991","proveedor":"PROVEEDOR DE PRUEBA","lineas":[{"codigo":"PRUEBA1","cantidad":10}]}'::jsonb, false);
rollback;
```
Esperado: **error** `No tenés permiso para cargar documentos`.

**7.3 — No quedó nada guardado.**
```sql
select (select count(*) from public.ordenes_compra) as ordenes, (select count(*) from public.articulos) as articulos,
       (select count(*) from public.proveedores) as proveedores, (select count(*) from public.remitos) as remitos;
```
Esperado: todo en `0`.

## 8. Datos para conectar la página
**Project Settings → API Keys**: la **Project URL** y la **Publishable key** van en `js/config.js`. Son públicas: lo que protege los datos son los permisos de la base. **La clave `secret` no va nunca en la página.**
- URL: `https://bghjltwkkxnxjypuuvnu.supabase.co`
- Publishable: `sb_publishable_m1ynuJ4ZVIvsYf5fpl0aMw_800yQi8i`

## 9. Cuando la página esté publicada
**Authentication → URL Configuration → Site URL**: `https://compras.bagsstore.com.ar` (paso 5 de `GUIA-DESPLIEGUE.md`).

---

## Más adelante
- **Avisos diarios de pendientes:** extensión `pg_cron` (**Database → Extensions**) + una migración nueva.
- **Facturas de proveedor (PDF):** una Edge Function que llama a la API de Claude. Su clave va en **Edge Functions → Secrets** (`ANTHROPIC_API_KEY`), nunca en el código.

## Tené en cuenta
- **Plan gratis:** Supabase **pausa** el proyecto si pasa 1 semana sin uso. Se reactiva desde el panel (**Restore project**) sin perder datos, pero mientras tanto la página no anda.
- **Copias de seguridad:** el plan gratis no permite volver a un momento anterior. Si se carga algo mal, se borra el documento (solo admin) y se vuelve a subir.
- **El SQL Editor guarda las consultas** como "Untitled query" en *Private*: se pueden borrar, no tienen datos sensibles.
