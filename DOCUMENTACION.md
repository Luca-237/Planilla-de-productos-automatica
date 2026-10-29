# Carga de artículos por remito y órdenes de compra — Cindy Mayorista

Reemplaza la carga a mano de la planilla "Proceso Ecommerce". Antonella sube la **orden de compra** (OC) y el **remito de ingreso** que exporta Manager. El sistema cruza lo que llegó contra lo pedido y muestra qué falta, de qué proveedor y hace cuántos días.

## Estado (29/10/2026)
- Hecho y probado: lector de los `.xls` de Manager, esquema de la base con el cruce OC ↔ remito y los permisos (28 pruebas, todas OK).
- **Supabase configurado:** proyecto `compras-cindy` (`bghjltwkkxnxjypuuvnu`), 2 migraciones aplicadas, registro apagado, función `admin-usuarios` publicada y Luca como admin. El cruce se probó en la base real (con `rollback`). Detalle en `SUPABASE-SETUP.md`.
- **Página hecha** (29/10): login, Pendientes, Cargar documentos, Planilla, Órdenes y remitos, Usuarios. Probada entera en modo demo (`?demo`, `?demo=carga`, `?demo=consulta`) con las OC y el remito reales, en compu y celular. **Falta probarla con la base real** (ingresar con el usuario de Luca).
- **Lista para publicar** en Ferozo (`compras.bagsstore.com.ar`): paso a paso en `GUIA-DESPLIEGUE.md`. Primer commit hecho; falta el repo privado en GitHub, el subdominio y Desplegar.
- Falta después: importar la planilla actual, avisos diarios, facturas de proveedor (PDF) y endpoints para las descripciones web.

## Secciones
- **Pendientes** (inicio): lo que se pidió y no llegó, por artículo, OC y proveedor, con los días sin llegar (en rojo desde `diasAlerta` días, 15 por defecto, en `js/config.js`). Indicadores, buscador, filtro por proveedor y "solo atrasados", exportar a CSV. Abajo, lo que llegó sin orden de compra.
- **Cargar documentos** (admin y carga): se arrastran uno o varios `.xls`. Cada uno se lee en el navegador, la base **simula** la carga y muestra cómo queda (artículos nuevos; en un remito, a qué OC va cada línea y qué queda sin orden). Recién con **Guardar** se graba. Las OC se ordenan antes que los remitos, y al guardar una OC se recalculan los remitos que esperan. Una OC o un remito repetido se rechaza.
- **Planilla**: reemplazo de la planilla "Proceso Ecommerce". Una fila por línea de OC con lo que llegó y los datos web del artículo. **Columnas** configurables (se guardan por usuario en `preferencias`; el código no se oculta). Exportar a CSV con las columnas visibles. Muestra hasta 1.000 filas: más que eso pide filtrar.
  - **Casillas en la tabla** (admin y carga): Foto, Descripción OK, Sin stock, Cargado web, Catálogo y Ya no está van al lado del nombre como casillas reales; se guardan al tildarlas (también se puede hacer clic en la celda). Son datos del artículo: tildar en una fila tilda todas las filas del mismo código.
  - **Marcar varios juntos**: se eligen artículos en la primera columna (**Shift + clic** elige un rango, como en Excel; la casilla del encabezado elige todo lo que se ve), y en la barra naranja se elige la casilla y **Marcar** o **Desmarcar**.
  - **Mostrar**: filtro rápido de lo que falta (sin foto, sin descripción OK, no cargados en la web, sin catálogo) o de lo marcado (sin stock, ya no están).
  - **Descripción web rápida**: la columna "Descripción web" va al lado del nombre (muestra las primeras líneas o "+ Agregar descripción"). Clic en esa celda abre una ventanita ahí mismo con el texto y "Marcar Descripción OK" (tildado de entrada). **Ctrl+Enter** guarda y pasa al artículo siguiente de la lista (otro código), **Esc** cierra (pregunta si hay cambios sin guardar), clic afuera también. Con el filtro "Sin descripción OK" se recorre todo lo que falta de corrido: cada artículo guardado sale de la lista.
  - Clic en el resto de la fila: diálogo con todos los datos web (título, tipo, variantes, código de barras, observaciones…).
  - Si una casilla no se pudo guardar (sin permiso), vuelve atrás y avisa: la página cuenta cuántos artículos cambió la base, porque un update sin permiso no da error en Supabase.
- **Órdenes y remitos**: OC con pedido/llegó/falta y estado; en el detalle, modalidad de facturación, observaciones, **cancelar unidades** que no van a venir, **cerrar/reabrir** la OC y (admin) **borrar** la OC. Remitos cargados; (admin) borrar uno devuelve sus unidades a pendientes.
- **Proveedores**: lista de proveedores con el nombre con el que se muestran, razón social, CUIT, cantidad de órdenes, última orden y unidades que faltan llegar. Ver "Nombre corto del proveedor".
- **Usuarios** (admin): ver sección de abajo.

### Modo oscuro
Botón redondo en la barra de arriba (y en la pantalla de ingreso) que pasa por **automático (como el sistema) → claro → oscuro**. La elección es de cada persona en su navegador (`localStorage`, clave `compras-tema`) y se aplica en el `<head>` antes de dibujar, así no parpadea. El oscuro es la versión negativa del manual de marca: fondo negro, naranja de marca, letras blancas.
- En `css/app.css` los colores salen de tokens en `:root`; el modo oscuro los redefine en `:root[data-tema="oscuro"]` y, para el automático, dentro de `@media (prefers-color-scheme: dark)` (los dos bloques tienen los mismos valores).
- Tokens que importan al agregar estilos: `--blanco` es el **fondo de las cajas** y `--negro` el **texto fuerte** (en oscuro se invierten); para letras sobre naranja usar `--sobre-naranja` (siempre blanco); para letras naranjas, `--naranja-texto`; verdes, grises y selección: `--verde`, `--verde-suave`, `--tenue`, `--linea-suave`, `--seleccion`. No usar colores fijos.

### Nombre corto del proveedor
Al lado de cada código se muestra el nombre con el que se conoce al proveedor en Cindy (Target, Bagcherry, Lesedife), no la razón social de Manager (Bagcherry figura como "ZUKI S.R.L."). No se puede sacar solo de la razón social, así que se carga **una vez por proveedor**:
- al guardar el primer documento de un proveedor nuevo, la tarjeta lo pide ("¿Cómo le dicen a este proveedor?");
- o en la sección **Proveedores** del menú (admin y carga): botón **Ponerle nombre / Renombrar** → ventana con vista previa de cómo queda al lado del código, aviso si otro proveedor ya se muestra con ese nombre, y **Volver a la razón social** para deshacerlo. Se puede cambiar cuantas veces se quiera: la base lo muestra con el nombre nuevo en todas las vistas, también en lo ya cargado.
- Los que todavía no tienen nombre aparecen primero, con un aviso arriba ("Ver solo esos") y un **contador naranja en el menú**.

Mientras no tenga, se muestra la razón social. La razón social queda en el globo del mouse, en la búsqueda y en el CSV. En la base: `proveedores.nombre_corto`; las vistas devuelven `proveedor` (nombre corto o razón social) y `razon_social`. En la Planilla, las columnas "Proveedor" y "Razón social" arrancan ocultas porque el proveedor ya va al lado del código.

### Probar en la PC
```
npx --yes http-server@14.1.1 -p 5530 -c-1
```
- `http://localhost:5530/?demo` → admin, `?demo=carga`, `?demo=consulta`. Base falsa en memoria (`pruebas/api-falsa.js`) con proveedores y artículos inventados, que imita el cruce de la base.
- `http://localhost:5530/` → contra la base real (pide usuario y contraseña).

## Usuarios
Un admin los crea desde la página (**Configuración → Usuarios**), sin entrar al panel de Supabase. La página llama a la Edge Function `admin-usuarios` (`supabase/functions/admin-usuarios/index.ts`), que solo atiende a un **admin activo** y es la única que tiene la clave de servicio.
- Acciones: `listar`, `crear` (usuario, nombre, contraseña, rol), `cambiar_rol`, `activar` / `desactivar` (además bloquea el login) y `resetear_password`.
- Usuario: el email completo o solo el nombre (`antonella` → `antonella@compras.cindymayorista.com.ar`, no hace falta que exista).
- Un admin no puede cambiarse el rol ni desactivarse a sí mismo, y nunca queda el sistema sin admin activo.
- Solo el primer admin se crea desde el panel de Supabase.

## Stack
- **Front:** HTML + CSS + JavaScript sin frameworks, estilo Cindy (como rótulos y RRHH).
- **Lectura de los `.xls`:** en el navegador, con SheetJS (`xlsx` 0.18.5, desde cdnjs). No hace falta servidor.
- **Back:** Supabase (Postgres + login + permisos RLS). Proyecto propio, separado de rótulos y RRHH.
- **Hosting:** Ferozo, archivos estáticos.
- **Node.js** solo en la PC, para las pruebas.

## Roles
| Rol | Puede |
|---|---|
| **admin** | Todo, incluidos usuarios y borrar un documento cargado por error |
| **carga** | Subir OC y remitos, cerrar OC, cancelar unidades, editar los datos web de los artículos (Antonella) |
| **consulta** | Solo mirar |

Los permisos los aplica la base (RLS). Las cuentas nacen desactivadas y siempre queda un admin activo.

## Cómo funciona
1. **OC:** `js/lector-manager.js` lee el `.xls` y arma un JSON. `cargar_orden_compra(doc, false)` muestra cómo va a quedar sin guardar; con `true` lo guarda. Crea el proveedor (por CUIT) y los artículos nuevos. Una OC no se puede cargar dos veces.
2. **Remito:** `cargar_remito(doc, confirmar)`. Cada línea se reparte entre las OC **abiertas** del mismo proveedor y código, de la más vieja a la más nueva. Lo que no tiene OC queda como "sin orden" (`v_sobrantes`). El remito **no trae el n.º de OC**: por eso se cruza por proveedor + código.
3. **Pendientes:** `v_pendientes` = líneas con estado `pendiente` o `parcial`, con `dias_desde_orden` y `dias_atraso` (contra el "Plan de Entrega" de Manager). Las fechas se calculan con la hora de Argentina (`hoy()`).
4. **Cerrar o cancelar:** `ordenes_compra.cerrada` (no se espera nada más) o `oc_lineas.cancelada` (unidades que ya no vienen). Ninguna de las dos recibe mercadería.

El cruce lo hace la base en una sola operación. Un trigger (`controlar_recepcion`) impide recibir más de lo pendiente aunque alguien inserte a mano.

### Estados de una línea de OC
`pendiente` (no llegó nada) · `parcial` · `completa` · `cerrada` (la OC se cerró con faltante) · `cancelada` (se canceló sin recibir nada).

## Base de datos
| Tabla / vista | Qué guarda |
|---|---|
| `proveedores` | CUIT (único) y nombre |
| `articulos` | Un registro por código de Cindy + los datos de la web (antes columnas L en adelante de la planilla) |
| `ordenes_compra`, `oc_lineas` | La OC de Manager; modalidad de facturación, cierre y cancelaciones |
| `remitos`, `remito_lineas` | El remito de ingreso de Manager |
| `recepciones` | Cuánto de cada línea de remito se asignó a cada línea de OC |
| `preferencias` | Columnas que cada usuario oculta |
| `v_oc_lineas`, `v_pendientes`, `v_planilla`, `v_sobrantes` | Vistas para la página (respetan los permisos de quien consulta) |

## El formato de Manager (lo que espera el lector)
Exportación de Crystal Reports, `.xls` con celdas combinadas. El lector busca los encabezados por su texto, no por posición.
- **OC:** título `ORDEN DE COMPRA`, número `3333-0000XXXX`, Proveedor, C.U.I.T., Comprador, Vencimiento. Por artículo, tres filas: código + descripción; bonificación, cantidad, P.U. y total; `Plan de Entrega` con fecha y cantidad. Pie: SubTotal 1, Desc/Rec, SubTotal 2, Impuesto, Total.
- **Remito de ingreso:** título `REMITO DE INGRESO`, número, Fecha, Cuit. Una fila por artículo: código, descripción, cantidad, costo, importe.
- Códigos de todo tipo (`855338`, `362.261051R`, `967.X1819`, `817210TAR`): se guardan siempre como texto.
- El P.U. es **antes** del descuento general de la OC, que va del 0 % al 52 % según el proveedor.

## Pruebas
```
npm install
npm test
```
- `pruebas/lector.test.js`: las 6 OC y el remito reales, más documentos armados para probar los controles.
- `pruebas/base.test.mjs`: corre la migración en un Postgres en memoria (PGlite) e imita los usuarios de Supabase. Cubre la simulación, el reparto entre OC, las entregas parciales, los sobrantes, las OC cerradas, los días, los permisos de cada rol y volver a correr la migración.
- Los documentos reales están en `datos-privados/muestras/`, que **no va al repo**. Sin esa carpeta, las pruebas que los usan se saltean.

## Estructura
```
index.html                                          pantallas y diálogos
css/app.css                                         estilos (tokens de Cindy, como rótulos y RRHH)
js/config.js                                        URL y clave publishable de Supabase, dominio de usuarios, diasAlerta
js/utils.js                                         ayudas comunes (fechas, CSV, toast, íconos, estados)
js/lector-manager.js                                lector de OC y remitos (navegador y Node)
js/api.js                                           única capa de datos (Supabase)
js/main.js                                          arranque, sesión y navegación
js/vistas/*.js                                      una por sección (acceso, pendientes, cargar, planilla, documentos, usuarios)
supabase/migrations/*.sql                           esquema y permisos (correr en orden)
supabase/functions/admin-usuarios/index.ts          Edge Function de usuarios
pruebas/                                            pruebas y api-falsa.js del modo demo (no se publican)
datos-privados/                                     documentos reales (no van al repo ni al servidor)
.htaccess                                           HTTPS y bloquea carpetas internas, .xls, .pdf, .sql y .md
```

## Repositorio y publicación
Repo git **propio y privado** (`Luca-237/ComprasCindy`, a crear). La carpeta está excluida del repo **público** de rótulos (`Desktop/Proyectos/.git/info/exclude`). Nunca subir `datos-privados/`: tiene OC con precios de proveedores (está en `.gitignore`).

Publicación en Ferozo con GIT → Desplegar y clave de despliegue de solo lectura: ver `GUIA-DESPLIEGUE.md`. Antes de cada despliegue, subir el `?v=` de `index.html` y correr `npm test`.
