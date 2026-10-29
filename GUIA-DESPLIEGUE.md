# Despliegue en Ferozo — `compras.bagsstore.com.ar`

La página es estática (HTML, CSS y JS): Ferozo solo sirve archivos. Todo lo dinámico (login, datos, permisos, el cruce OC ↔ remito y la administración de usuarios) lo hace **Supabase**, que ya está configurado (ver `SUPABASE-SETUP.md`). **No hay servidor Node ni `.env`.**

Mismo circuito que rótulos y RRHH: el código va a **GitHub** y Ferozo lo descarga con **GIT → Desplegar**. No se sube nada a mano por FTP.

> **Es el hosting de producción** donde corren el catálogo, rótulos y otros sitios. Este despliegue solo **agrega** un subdominio y una carpeta nueva (`public_html/compras`), no toca nada existente. Igual conviene avisarle a Mauricio antes.

## Resumen

| # | Paso | Dónde | Tiempo |
|---|---|---|---|
| 1 | Repo **privado** en GitHub y `git push` (hecho) | GitHub + PC | 5 min |
| 2 | Crear el subdominio | Ferozo | 5 min |
| 3 | Certificado SSL (HTTPS) | Ferozo | 5–30 min |
| 4 | Token de solo lectura y **Desplegar** (por HTTPS) | Ferozo + GitHub | 10 min |
| 5 | Site URL en Supabase | Supabase | 2 min |
| 6 | Probar | Navegador | 10 min |

---

## 1. Repo privado en GitHub
Repo: **`Luca-237/Planilla-de-productos-automatica`** (push hecho el 29/10/2026).

Tiene que ser **privado**: no tiene documentos ni secretos (`datos-privados/` está en `.gitignore`), pero las pruebas usan totales y CUIT de órdenes de compra reales. Para comprobarlo: GitHub → el repo → arriba, al lado del nombre, tiene que decir **Private**. Si dice *Public*: **Settings → General → Danger Zone → Change repository visibility → Make private**.

El repo de rótulos es **público**, por eso esta carpeta está excluida de él (`Desktop/Proyectos/.git/info/exclude`).

## 2. Subdominio
Panel de Ferozo → **Dominios → Subdominios** → crear **`compras`** en `bagsstore.com.ar`, con la carpeta **`public_html/compras`**.
- `compras.` no choca con lo que ya existe: `rotulos.` y `rrhh.` son otras carpetas, y `bajas.` está reservado para el bot.
- Si el panel pide el nombre completo, es `compras.bagsstore.com.ar`.

## 3. Certificado SSL
Ferozo → **SSL** (Let's Encrypt) → activarlo para `compras.bagsstore.com.ar`. Puede tardar unos minutos en emitirse.
- El `.htaccess` ya fuerza HTTPS. Si al abrir la página el navegador dice **"demasiados redireccionamientos"**, borrar el bloque 1 del `.htaccess` (las 4 líneas de "Forzar HTTPS") y usar la opción "Forzar HTTPS" del panel.

## 4. Desplegar desde GitHub (repo privado, por HTTPS con token)
**Por qué no con "deploy key":** la clave SSH de Ferozo es una sola por cuenta, no se puede cambiar, y ya está usada como deploy key en otro repo privado de Cindy (`devoluciones_cindy`). GitHub no deja usar la misma clave en dos repos ("Key is already in use"). Les pasó igual a Preventa y al Panel, que terminaron públicos. Para que este quede **privado**, Ferozo se conecta por **HTTPS con un token de GitHub de solo lectura y solo para este repo**.

### 4.1 Crear el token (GitHub)
1. Foto de perfil → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Token name:** `Ferozo compras`. **Expiration:** 1 año (anotá la fecha: cuando vence, el despliegue deja de andar; ver 4.4).
3. **Repository access → Only select repositories →** `Planilla-de-productos-automatica`.
4. **Permissions → Repository permissions → Contents → Read-only** (Metadata queda en Read-only sola). Nada más.
5. **Generate token** y copiarlo: GitHub lo muestra **una sola vez**. Guardalo en el gestor de contraseñas. **No lo pegues en el chat, en el vault ni en el código.**

### 4.2 Dejar la carpeta vacía (Ferozo)
Ferozo exige que la carpeta de destino esté **vacía**, y al crear el subdominio a veces pone un `cgi-bin` vacío adentro (pasó con el Panel). **Administrador de archivos →** `public_html/compras/` → si hay un `cgi-bin` vacío, borrarlo.

### 4.3 Conectar y desplegar (Ferozo → Mi Sitio Web → GIT)
Nuevo repositorio:
- **URL:** `https://Luca-237:EL_TOKEN@github.com/Luca-237/Planilla-de-productos-automatica.git` (reemplazar `EL_TOKEN` por el token, sin espacios). Si el panel tiene campos aparte de **usuario** y **contraseña**, usar la URL sin `Luca-237:EL_TOKEN@` y poner `Luca-237` como usuario y el token como contraseña.
- **Rama:** `main`
- **Directorio:** `/public_html/compras/`
- → **Desplegar**.

**Dónde queda el token:** en `public_html/compras/.git/config`, dentro del servidor. El `.htaccess` bloquea `.git` (el paso 6.4 lo comprueba con `.git/config` → tiene que dar 404). Aunque se filtrara, solo sirve para **leer** este repo.

### 4.4 Cuando venza el token
GitHub avisa por mail unos días antes. Generar uno nuevo (4.1) y actualizar la URL en Ferozo → GIT (editar el repositorio, o borrarlo y volver a conectarlo con la carpeta vacía). Borrar el token viejo en GitHub.

### 4.5 (Opcional) Despliegue automático en cada push
Como el Panel y Travel Blue: Ferozo → **GIT** → copiar la URL de **"Implementación automática"** → GitHub → el repo → **Settings → Webhooks → Add webhook** → *Payload URL* = esa URL, *Content type* `application/json`, evento **Just the push event**. Esa URL funciona como una contraseña: no compartirla. Si algún día no actualiza, botón **Desplegar** en Ferozo.

## 5. Site URL en Supabase
Supabase → **Authentication → URL Configuration → Site URL** → `https://compras.bagsstore.com.ar` → **Save**.
(El ingreso es con usuario y contraseña, sin links por mail, así que no hace falta agregar "Redirect URLs".)

## 6. Probar
1. Abrir `https://compras.bagsstore.com.ar` → tiene que aparecer el login, con el candado de HTTPS.
2. Ingresar con tu usuario → Pendientes tiene que mostrar la OC 2151 de Target.
3. **Usuarios** → tiene que listar tu usuario. Es la primera prueba real de la función `admin-usuarios` con sesión de admin.
4. Comprobar que lo interno **no** se puede abrir. Cada uno tiene que dar **403** o **404**, nunca 200:
   ```bash
   for u in .git/config DOCUMENTACION.md SUPABASE-SETUP.md package.json pruebas/api-falsa.js supabase/migrations/20261029100000_esquema_inicial.sql supabase/functions/admin-usuarios/index.ts datos-privados/; do echo "$(curl -s -o /dev/null -w '%{http_code}' https://compras.bagsstore.com.ar/$u)  $u"; done
   ```
   Y estos **sí** tienen que dar 200: `index.html`, `js/config.js`, `css/app.css`, `robots.txt`.
5. `https://compras.bagsstore.com.ar/?demo` **no** tiene que entrar en modo demo: el modo demo solo funciona en la PC (`localhost`), y en el servidor `pruebas/` está bloqueada.

---

## Cada vez que se cambie algo
1. Subir el número `?v=` en **todas** las líneas de `index.html` (si no, el navegador usa la versión vieja guardada). Hoy es `20261029.9`.
2. `npm test` (tienen que pasar todas).
3. Si hay una migración nueva en `supabase/migrations/`, correrla en Supabase **antes** de desplegar (SQL Editor, en orden).
4. `git commit` + `git push`.
5. Ferozo → **GIT** → **Desplegar** (no hace falta si está el webhook de 4.5).

## Volver atrás
Si una versión publicada anda mal:
```bash
git revert HEAD
git push
```
y **Desplegar** en Ferozo. Los datos están en Supabase, así que volver atrás la página no los toca. Si el cambio incluía una migración, hay que revisar con cuidado antes de deshacerla.

## Qué protege `.htaccess`
- Fuerza HTTPS.
- 404 para `.git/`, `supabase/`, `pruebas/`, `datos-privados/` y `node_modules/`.
- Bloquea `.md`, `.json`, `.sql`, `.csv`, `.xls`, `.xlsx`, `.pdf`, `.txt` (menos `robots.txt`) y `.gitignore`.
- Pide a los buscadores que no la indexen (`robots.txt` + `X-Robots-Tag`), no deja embeberla en otra página (`X-Frame-Options`) y no manda la dirección a otros sitios (`Referrer-Policy`).

Lo que **sí** queda público, a propósito: `js/config.js`, con la URL de Supabase y la clave **publishable**. Están pensadas para ir en el navegador; los datos los protegen el login y los permisos de la base. La clave `secret` no está en el repo.

## Riesgos y cómo se cubren
| Riesgo | Cómo se cubre |
|---|---|
| Que se vean documentos internos o el historial | `.htaccess` (paso 6.4 lo comprueba) |
| Que alguien sin usuario lea o cargue datos | RLS y permisos de la base; sin sesión no hay acceso a ninguna tabla ni función |
| Que alguien se registre solo | Registro público apagado en Supabase |
| Romper otros sitios del hosting | Solo se agrega un subdominio y una carpeta nueva |
| Supabase pausa el proyecto tras 1 semana sin uso (plan gratis) | Con uso diario no pasa; si pasa, **Restore project** en el panel |
