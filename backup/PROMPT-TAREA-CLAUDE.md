# Tarea programada de Claude: backup diario a Google Drive

Alternativa a GitHub Actions (ver `GUIA-BACKUP.md`). Corre en tu PC con la app de Claude abierta; si la app está cerrada a la hora de la tarea, se hace cuando se abre.

Carpeta de destino en Drive: **Backups** (<https://drive.google.com/drive/folders/1hICbY2j38uxI4mw70oISJHV-inkT221x>), de la cuenta cindy.lucam@gmail.com.

## Qué hace falta antes

1. **Supabase** (una sola vez): migración `20261104100000_backups_registro.sql`, función `backup-datos` con Verify JWT apagado y el secreto `BACKUP_TOKEN` (pasos 1.1 a 1.3 de `GUIA-BACKUP.md`).
2. **Google Drive para escritorio** instalado y con tu sesión, para que una carpeta de tu PC sea la carpeta **Backups** de tu Drive (normalmente `G:\Mi unidad\Backups`). El conector de Drive de Claude no sirve para esto: no puede pasar un Excel de este tamaño.
3. **Un archivo con los datos de conexión, fuera del proyecto y del vault**: `C:\Users\Usuario\.claude\backup-compras.env`, con este contenido (lo creás vos; el token es el mismo que cargaste en Supabase):
   ```
   BACKUP_URL=https://bghjltwkkxnxjypuuvnu.supabase.co/functions/v1/backup-datos
   BACKUP_TOKEN=<el token>
   BACKUP_DIAS=30
   BACKUP_ORIGEN=claude
   ```
4. `npm install --no-save exceljs@4.4.0` una vez en la carpeta del proyecto (si ya corriste `npm install` no hace falta).

## Prompt para la tarea (cron `0 13 * * *`, hora local)

```
Hacé el backup diario de datos de "Compras · Cindy" (proyecto en C:\Users\Usuario\Desktop\Proyectos\Carga de articulos por remito y ordenes de compra).

1. En PowerShell, dentro de esa carpeta, ejecutá:
   node backup/hacer-backup.mjs --env "C:\Users\Usuario\.claude\backup-compras.env" --a-carpeta "G:\Mi unidad\Backups"
   Si dice que falta exceljs, corré antes: npm install --no-save exceljs@4.4.0
2. El script pide los datos a Supabase, arma un Excel con formato, lo deja en la carpeta Backups de Google Drive con el nombre backup-compras-cindy-AAAA-MM-DD.xlsx, borra los de más de 30 días y lo anota en el registro del sistema.
3. Comprobá que la salida diga "Guardado en G:\Mi unidad\Backups\backup-compras-cindy-..." y que el archivo exista y pese más de 100 KB.
4. Si falla, reintentá una sola vez. Si vuelve a fallar, no insistas: mostrá el mensaje de error completo.
5. Nunca leas, imprimas ni copies el contenido del archivo backup-compras.env ni el token, ni en la respuesta ni en ningún archivo.
6. Respondé en 2 líneas: nombre del archivo, tamaño y cantidad de filas de las hojas Planilla y articulos.
```

Cambiá `G:\Mi unidad\Backups` si Drive para escritorio usa otra letra o nombre en tu PC.
