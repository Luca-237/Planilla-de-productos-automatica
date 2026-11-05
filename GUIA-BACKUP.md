# Backup diario a Google Drive

Todos los días a las 13:00 (hora de Argentina) se guarda en Google Drive un Excel con todos los datos del sistema. Se conservan los últimos 30 días. En **Configuración → Backup diario** (solo admin) se ve cómo salió cada uno.

## Cómo funciona

1. **GitHub Actions** (`.github/workflows/backup-diario.yml`) corre `backup/hacer-backup.mjs` todos los días a las 16:00 UTC (= 13:00 en Argentina; GitHub puede demorar unos minutos).
2. El script le pide los datos a la función de Supabase **`backup-datos`**, que es solo de lectura y se protege con su propio token (`BACKUP_TOKEN`). La clave de servicio de Supabase nunca sale de Supabase.
3. El script arma el Excel (`backup/armar-xlsx.mjs`) y lo sube a la carpeta **"Backups Compras Cindy"** de tu Drive (la crea solo la primera vez), con el nombre `backup-compras-cindy-AAAA-MM-DD.xlsx`. Si se corre dos veces el mismo día, queda el último.
4. Borra los backups de más de 30 días y anota el resultado en la tabla `backups_registro`.

> El Excel no se arma dentro de Supabase porque las Edge Functions tienen un máximo de 2 segundos de CPU por pedido (documentación de Supabase), y un Excel con formato de este tamaño lo pasaría.

## Qué trae el Excel

- **LÉEME**: fecha, instrucciones y cuántas filas tiene cada hoja.
- **Planilla**: lo mismo que la pantalla Planilla, legible (Sí/No, fechas, precios).
- **Una hoja por tabla** (`perfiles`, `proveedores`, `colores`, `articulos`, `ordenes_compra`, `oc_lineas`, `remitos`, `remito_lineas`, `recepciones`, `preferencias`) con los nombres reales de las columnas: sirven para reconstruir todo, en ese orden. Las contraseñas no se guardan (viven en Supabase Auth): al recuperar, los usuarios se vuelven a crear desde la pantalla Usuarios.

## Puesta en marcha (una sola vez)

### 1. Supabase
1. **SQL Editor**: pegar y correr `supabase/migrations/20261104100000_backups_registro.sql`.
2. **Edge Functions → Deploy a new function** con el nombre `backup-datos` y el contenido de `supabase/functions/backup-datos/index.ts`. Apagar **Verify JWT with legacy secret** (como las otras dos).
3. **Edge Functions → Secrets**: agregar `BACKUP_TOKEN` con un valor largo y al azar (32 caracteres o más). Para generarlo, en PowerShell:
   ```powershell
   -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | % {[char]$_})
   ```
   Guardalo en tu gestor de contraseñas: lo vas a necesitar en GitHub.

### 2. Google (permiso para subir a TU Drive)
1. En <https://console.cloud.google.com> crear un proyecto (ej. "Backups Compras Cindy") y activar **Google Drive API**.
2. **APIs y servicios → Pantalla de consentimiento de OAuth**: tipo **Interno** si la cuenta es de Google Workspace (`@cindymayorista.com.ar`); si es una cuenta común, **Externo** y después **Publicar la app** (en modo "Prueba" Google vence el permiso a los 7 días).
3. **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación de escritorio**. Anotar el ID y el secreto del cliente.
4. En tu PC, en la carpeta del proyecto:
   ```powershell
   $env:GOOGLE_CLIENT_ID="…"; $env:GOOGLE_CLIENT_SECRET="…"; node backup/obtener-token-google.mjs
   ```
   Abrir el link que imprime, iniciar sesión con la cuenta dueña del Drive y aceptar. En la terminal sale el `GOOGLE_REFRESH_TOKEN`. El permiso que se pide es `drive.file`: el script solo ve lo que él mismo crea, no el resto de tu Drive.

### 3. GitHub (el repo tiene que ser privado)
**Settings → Secrets and variables → Actions → New repository secret**, con estos cinco:

| Secreto | Valor |
|---|---|
| `BACKUP_URL` | `https://bghjltwkkxnxjypuuvnu.supabase.co/functions/v1/backup-datos` |
| `BACKUP_TOKEN` | el mismo que cargaste en Supabase |
| `GOOGLE_CLIENT_ID` | el ID del cliente |
| `GOOGLE_CLIENT_SECRET` | el secreto del cliente |
| `GOOGLE_REFRESH_TOKEN` | el que imprimió el paso anterior |

### 4. Probarlo
- **Sin Drive** (solo arma el Excel en tu PC, para ver cómo queda): con `BACKUP_URL` y `BACKUP_TOKEN` en el entorno, `npm install --no-save exceljs@4.4.0` y `node backup/hacer-backup.mjs --solo-archivo`.
- **Completo**: GitHub → pestaña **Actions → Backup diario → Run workflow**. Tiene que quedar en verde, aparecer el archivo en Drive (carpeta "Backups Compras Cindy") y una fila "Hecho" en Configuración.

## Alternativa: tarea programada de Claude en tu PC

En vez de GitHub Actions + OAuth de Google, el mismo script puede correr desde una tarea programada de Claude y dejar el Excel en la carpeta de Google Drive para escritorio (`--a-carpeta`). Hace falta lo mismo en Supabase (migración, función y `BACKUP_TOKEN`), pero no GitHub ni la cuenta de Google Cloud. A cambio, tu PC tiene que estar encendida con la app abierta. Paso a paso y prompt en `backup/PROMPT-TAREA-CLAUDE.md`.

## Si algo falla
- Una fila "Con error" en Configuración dice el motivo. Si GitHub no llegó ni a anotar (por ejemplo, la función no responde), el workflow queda en rojo en la pestaña Actions y GitHub manda un mail al dueño del repo.
- `invalid_grant`: el permiso de Google venció o se revocó. Repetir el paso 2.4 y actualizar `GOOGLE_REFRESH_TOKEN`.
- `Token inválido`: `BACKUP_TOKEN` distinto entre Supabase y GitHub.

## Recuperar
1. Descargar el Excel del día que corresponda desde Drive.
2. Crear el proyecto de Supabase (o limpiar el actual) y correr las migraciones de `supabase/migrations` en orden.
3. Cargar las hojas con nombre de tabla en el orden en que están listadas arriba (cada hoja es la tabla tal cual; en el SQL Editor se puede importar cada una como CSV desde el panel Table Editor).
4. Volver a crear los usuarios desde Usuarios.

> La recuperación completa no se probó todavía contra una base vacía: conviene hacer un simulacro una vez que el backup funcione.
