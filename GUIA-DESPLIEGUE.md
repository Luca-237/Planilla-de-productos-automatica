# Despliegue en Ferozo — `compras.bagsstore.com.ar`

La página es estática (HTML, CSS y JS): Ferozo solo sirve archivos. Todo lo dinámico (login, datos, permisos, el cruce OC ↔ remito y la administración de usuarios) lo hace **Supabase**, que ya está configurado (ver `SUPABASE-SETUP.md`). **No hay servidor Node ni `.env`.**

Mismo circuito que rótulos y RRHH: el código va a **GitHub** y Ferozo lo descarga con **GIT → Desplegar**. No se sube nada a mano por FTP.

> **Es el hosting de producción** donde corren el catálogo, rótulos y otros sitios. Este despliegue solo **agrega** un subdominio y una carpeta nueva (`public_html/compras`), no toca nada existente. Igual conviene avisarle a Mauricio antes.

## Resumen

| # | Paso | Dónde | Tiempo |
|---|---|---|---|
| 1 | Repo **privado** en GitHub y `git push` | GitHub + PC | 5 min |
| 2 | Crear el subdominio | Ferozo | 5 min |
| 3 | Certificado SSL (HTTPS) | Ferozo | 5–30 min |
| 4 | Clave de despliegue y **Desplegar** | Ferozo + GitHub | 10 min |
| 5 | Site URL en Supabase | Supabase | 2 min |
| 6 | Probar | Navegador | 10 min |

---

## 1. Repo privado en GitHub
El repo tiene que ser **privado**. No tiene datos reales: `datos-privados/` está en `.gitignore`. Pero las pruebas usan totales y CUIT de órdenes de compra reales, y la base de código describe el circuito de compras. El repo de rótulos es **público**, por eso esta carpeta está excluida de él (`Desktop/Proyectos/.git/info/exclude`).

1. En GitHub: **New repository** → nombre sugerido `ComprasCindy` → **Private** → **sin** README, `.gitignore` ni licencia (ya están acá).
2. En esta carpeta (el primer commit ya está hecho):
   ```bash
   git remote add origin https://github.com/Luca-237/ComprasCindy.git
   git push -u origin main
   ```

## 2. Subdominio
Panel de Ferozo → **Dominios → Subdominios** → crear **`compras`** en `bagsstore.com.ar`, con la carpeta **`public_html/compras`**.
- `compras.` no choca con lo que ya existe: `rotulos.` y `rrhh.` son otras carpetas, y `bajas.` está reservado para el bot.
- Si el panel pide el nombre completo, es `compras.bagsstore.com.ar`.

## 3. Certificado SSL
Ferozo → **SSL** (Let's Encrypt) → activarlo para `compras.bagsstore.com.ar`. Puede tardar unos minutos en emitirse.
- El `.htaccess` ya fuerza HTTPS. Si al abrir la página el navegador dice **"demasiados redireccionamientos"**, borrar el bloque 1 del `.htaccess` (las 4 líneas de "Forzar HTTPS") y usar la opción "Forzar HTTPS" del panel.

## 4. Desplegar desde GitHub (repo privado)
Como el repo es privado, Ferozo necesita una **clave de despliegue**:
1. Ferozo → **GIT** → copiar la **clave SSH pública** que muestra.
2. GitHub → el repo → **Settings → Deploy keys → Add deploy key** → pegarla. Título: `Ferozo`. **Sin** "Allow write access": solo lectura.
3. Ferozo → **GIT** → nuevo repositorio:
   - URL: `git@github.com:Luca-237/ComprasCindy.git`
   - Rama: `main`
   - Ruta: `/public_html/compras/`
   - → **Desplegar**.

Ferozo copia el repo entero, incluida la carpeta `.git`, la documentación y las pruebas. El `.htaccess` hace que nada de eso se pueda abrir desde la web (ver paso 6).

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
1. Subir el número `?v=` en **todas** las líneas de `index.html` (si no, el navegador usa la versión vieja guardada). Hoy es `20261029.6`.
2. `npm test` (tienen que pasar todas).
3. Si hay una migración nueva en `supabase/migrations/`, correrla en Supabase **antes** de desplegar (SQL Editor, en orden).
4. `git commit` + `git push`.
5. Ferozo → **GIT** → **Desplegar**.

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
