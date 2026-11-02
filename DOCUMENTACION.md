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
- **Estilo (2/11/2026): el del Gestor de RRHH, con fondo verde pastel.** Fondo verde pastel `#c8f0d6` (`--fondo`) con aire a planilla de Excel: encabezados y filas bajo el mouse en verde clarito (`--encabezado`, `--hover`), y el rango que se arrastra y las filas elegidas con el verde de Excel (`--rango`, `#217346`); el naranja queda para la marca y las acciones. Superficies blancas, formas y tipografías como el RRHH. Formas: superficies redondeadas con sombras suaves (`--r`, `--sombra`), botones de 8 px con brillo interno, tipografías **Google Sans** (títulos, números, botones, menú) y **Karla** (texto), chips y etiquetas en píldora, menú lateral que se recoge a solo íconos (cada opción lleva su texto en un `<span class="lateral-txt">` que arma `js/main.js`), diálogos y secciones con una animación corta que se apaga con "reducir movimiento". El modo oscuro es la versión cálida del mismo estilo (marrón muy oscuro, no negro puro). Si se cambia algo de la forma, conviene hacerlo en los dos proyectos.
- En `css/app.css` los colores salen de tokens en `:root`; el modo oscuro los redefine en `:root[data-tema="oscuro"]` y, para el automático, dentro de `@media (prefers-color-scheme: dark)` (los dos bloques tienen los mismos valores).
- Tokens que importan al agregar estilos: `--blanco` es el **fondo de las cajas** y `--negro` el **texto fuerte** (en oscuro se invierten); para letras sobre naranja usar `--sobre-naranja` (siempre blanco); para letras naranjas, `--naranja-texto`; verdes, grises y selección: `--verde`, `--verde-suave`, `--tenue`, `--linea-suave`, `--seleccion`. No usar colores fijos.

### Variantes por color
Un artículo (`123445`) puede tener variantes por color: `123445-WHI`, `123445-GRE`, `123445-BLU`, `123445-NUD`. Cada variante es **un artículo propio** (sus casillas, su descripción, su fecha de alta) que apunta a su principal (`padre_codigo`) y a un color del catálogo.
- **Crear:** en la Planilla, clic en el artículo → bloque **Variantes por color** → se tildan los colores y **Crear variantes elegidas**. Ahí mismo se puede **agregar un color nuevo** al catálogo (sufijo + nombre) y queda tildado. Si el código ya existe como otro artículo, no lo pisa y avisa.
- **Colores:** sección **Colores** del menú. Se cargan una vez y sirven para cualquier producto. El **sufijo** (2 a 5 letras o números) no se puede cambiar porque ya forma parte del código de las variantes; el nombre sí, y se puede desactivar un color sin tocar las variantes ya creadas. Vienen cargados WHI Blanco, GRE Verde, BLU Azul, NUD Nude, NEG Negro, BEI Beige, SUE Suela y ROJ Rojo (los últimos cuatro salen de la planilla vieja; si GRE era gris, se renombra).
- **En la planilla** cada variante sale **debajo de su artículo**, sangrada, con su color y sin cantidades (se piden y llegan por el principal). El principal muestra "N variantes". Una variante no puede tener variantes.
- En la base: tabla `colores`, `articulos.color_id`, función `crear_variantes(padre, colores)` y `v_planilla` con `padre`, `es_variante`, `n_variantes`, `color`.

### Fecha de alta automática
Al tildar **Cargado web** (en la tabla, en bloque o en el diálogo) la base completa sola la fecha de alta con el día de hoy (hora de Argentina). Solo si estaba vacía: una fecha puesta a mano no se pisa, y destildar y volver a tildar tampoco la cambia. Sigue siendo editable en el diálogo por si hay que corregirla.

### Menú replegable y pantalla completa
- El botón de las tres rayas de la barra **repliega el menú** en compu (queda guardado en el navegador, clave `compras-lateral`); en celular lo abre encima, como antes.
- En la Planilla, **Pantalla completa** tapa menú y barra con la tabla y, si el navegador lo permite, pasa también a pantalla completa de verdad. **Esc** sale.

### Revisar si ya está en la web (antes de cargar o describir)
Para no cargar algo dos veces, la planilla revisa si cada artículo **ya está publicado en la web de Cindy**. La página no puede leer otro sitio (el navegador lo bloquea), así que lo hace la Edge Function **`buscar-en-web`**: busca el código en la tienda y guarda el resultado en el artículo.
- **Resultado** (columna **"En la web"**, al lado de la descripción, con enlace al producto):
  - **En la web**: aparece un producto con ese **código idéntico**. Ojo: la búsqueda de la tienda trae parecidos (buscar `8216` trae `148216`), por eso se compara el código exacto.
  - **Por variantes**: no está el código, pero sí sus variantes (`3M201-GRE`…).
  - **No está**. Si además estaba tildado "Cargado web", dice **"No está (estaba cargado)"**: se bajó de la página.
  - **Sin revisar**: todavía no se revisó.
- **Cómo se revisa:**
  - Botón **Revisar en la web** (admin y carga): revisa los artículos **elegidos** o, si no hay elegidos, **todos los que se ven** con los filtros. Se revisa **de a 10 artículos, con 5 segundos de pausa entre lotes** (para no cargar la tienda ni la función; se cambia en `js/config.js` → `revisionWeb: { lote, esperaSegundos }`). Una **barra de progreso** muestra el avance, el lote en curso y la cuenta regresiva de la pausa. Dentro de cada lote la función manda los resultados de a uno por **SSE** y la fila se actualiza apenas se revisa. Mientras revisa, el mismo botón dice **Detener**: corta y lo ya revisado queda guardado. Con más de 50 artículos pide confirmación y avisa cuánto tarda. Al final, un resumen.
  - **Solo, al abrir la descripción rápida** de un artículo que nunca se revisó. Si ya está publicado, la ventanita lo avisa en verde antes de que escribas nada.
  - Filtros de **Mostrar**: "Sin revisar en la web", "Ya están en la web", "No están en la web".
- **Si la tienda no responde**, ese código queda como estaba (no se marca "No está" por error) y el resumen lo cuenta aparte.
- **Fecha de alta:** si al tildar "Cargado web" el artículo ya figuraba publicado, la fecha real es anterior y no se sabe: **no se pone la de hoy** (queda vacía para completarla a mano).
- **Seguridad:** el resultado (`web_estado`, `web_revisado_en`, `web_url`, `web_nombre`) lo escribe **solo la función**, con la clave de servicio: los usuarios tienen permiso de editar únicamente sus columnas de trabajo, así nadie puede marcar "publicado" a mano. La función solo atiende a usuarios activos admin o carga.
- **Tienda:** hoy consulta TiendaQuick (`https://www.cindymayorista.com.ar`). Se cambia con el secreto `TIENDA_URL` de la función. **Cuando la tienda pase a Tiendanube hay que adaptar la lectura** (otra página de búsqueda, y hoy pide contraseña de acceso).
- **Permisos de la clave de servicio** (migración 6): el proyecto se creó con "Automatically expose new tables" apagado, así que `service_role` no tenía permisos en ninguna tabla y las funciones (`buscar-en-web` y `admin-usuarios`) respondían **403** al leer `perfiles`. Ahora la función devuelve el error real de la base en vez de un 403 engañoso.
- Pruebas: `pruebas/web.test.mjs` (lectura de la búsqueda; con `PROBAR_TIENDA=1` consulta la tienda real).

### Importar la planilla anterior (carga masiva, solo admin)
Sección **Importar planilla** del menú. Sube el **.xlsx** de la planilla "Proceso Ecommerce" (en Google Sheets: Archivo → Descargar → Microsoft Excel). Lee las hojas **"Hoja 1"** y **"Historial"** (`js/importador-planilla.js`; ubica las columnas por el texto del encabezado), muestra un resumen de lo que va a cargar y, al confirmar, lo manda a la base por lotes con **barra de progreso** (la función `importar_planilla`, migración 7). Se puede **detener y repetir**: lo que ya está cargado (artículo, color, orden) no se duplica ni se pisa.
- **Qué se importa:**
  - **Artículos** (uno por código): nombre, tipo, variante/color, casillas (foto, descripción OK, cargado web, catálogo, sin stock, ya no está), fecha de alta, observaciones, título, descripción web y estado de la descripción. Si un código está en varias filas, se juntan: las casillas se suman (basta que una fila diga "sí"), y sin stock / ya no está salen de la fila más nueva.
  - **Variantes**: cuelgan de su principal (el código sin el sufijo, `131022-NEG` → `131022`), con su color si el sufijo está en el catálogo, y no llevan línea de orden (la cantidad es del principal). Las que no tienen principal en la planilla quedan como artículos sueltos con su cantidad. El principal recibe la lista de sufijos.
  - **Colores nuevos** para el catálogo: solo los sufijos donde la planilla es clara (mismo nombre en casi todas las variantes). Los dudosos no se crean: se agregan a mano en **Colores**.
  - **Órdenes de compra**: número, fecha, proveedor y, por línea, cantidad y precio. Las líneas con **Llegó = sí** quedan **recibidas completas**, con un remito `PLANILLA-<orden>` a la fecha de la orden (la planilla no guarda cuándo llegó). Las demás quedan pendientes y entran en Pendientes con sus días de espera.
  - **Proveedores**: la planilla trae el nombre pero no el CUIT, así que se crean **sin CUIT** (el nombre se reconoce sin importar mayúsculas ni puntos: "S.R.L." = "SRL"). Cuando llega una OC o un remito de Manager de ese proveedor, **se le completa el CUIT solo** en vez de duplicarlo.
- **Qué no se importa:** la columna "Variantes" de los principales (PENDIENTE FOTO, GENERADAS…), la columna "Estado" (se deduce de "Llegó"), las filas con cantidad 0 como líneas (el artículo sí entra) y los códigos de barra (la planilla no los tenía).
- **Textos corridos:** en la planilla vieja observaciones, título, descripción y estado están a veces corridos una columna. Se clasifican por lo que son (los estados "PUBLICADA" / "LISTA - PENDIENTE PUBLICAR" van a "Estado descripción"; el texto largo o con viñetas es la descripción; el último texto corto es el título y los anteriores, observaciones).
- **La fecha de alta no se inventa:** durante la importación el trigger de fecha automática no actúa; si la planilla no tenía fecha, queda vacía.
- **Después de importar:** usar **Revisar en la web** en la Planilla para comprobar qué está publicado de verdad (la planilla tenía muchos "Ya no está en la página" marcados).
- **Fuera del repo:** la planilla descargada va a `datos-privados/` (no se sube a GitHub).
- Pruebas: `pruebas/importador.test.js` (lector) y la prueba de `importar_planilla` en `pruebas/base.test.mjs`.

### Actualizar lo importado con una planilla más nueva
La importación (arriba) no pisa lo que ya existe. Para ponerse al día con una versión más nueva de la planilla hay una función aparte, `sincronizar_planilla` (migración 8, solo admin, con modo simulación), y un armado del plan en `js/importador-planilla.js` (`planActualizacion(anterior, nueva)`): compara la planilla que ya se importó con la nueva y calcula **solo lo que cambió**, para no pisar lo que se trabajó en el sistema:
- **Artículos y órdenes nuevos** (se cargan con `importar_planilla`).
- **Renombres de código:** la primera importación leyó los códigos numéricos con el formato de la celda (`4.730.400.006`) en vez del valor real (`4730400006`). Un código que ya no está pero que sin puntos sí está, es el mismo: se renombra (las líneas y variantes lo siguen solas) y, si el código nuevo ya existía (el mismo artículo cargado dos veces), se **fusionan**.
- **Campos de artículo que cambiaron** en la planilla (casillas, textos, fecha de alta, proveedor, principal y color de las variantes). Lo que no cambió en la planilla no se toca.
- **Órdenes que ya estaban:** líneas nuevas, precios corregidos, **lo que llegó** (se da por recibido lo que falta, con el remito `PLANILLA-<orden>`) y las líneas que ya no van (solo si no recibieron nada de un remito real de Manager). Una línea que figuraba llegada y ahora no, no se toca: se avisa.
- Es repetible. Se corre con la planilla anterior y la nueva descargadas como `.xlsx` (en `datos-privados/`): primero se simula (`R.api.importacion.sincronizar(plan.doc, true)`) y después se aplica en el orden renombres → nuevos → campos → líneas. Por ahora lo corre quien mantiene el sistema; no tiene pantalla.
- **Segunda actualización (2/11/2026, planilla de las 15:19):** 20 llegadas y 20 artículos con cambios (17 cargados a la web con su fecha de alta y 11 con foto); sin renombres ni líneas nuevas. La base quedó en 3.096 líneas recibidas y 500 pendientes.
- **Primera actualización (2/11/2026):** 380 códigos corregidos (31 fusionados), 3 artículos y 2 órdenes nuevos, 167 artículos con cambios, 64 llegadas, 34 líneas de variantes que ya no van, 1 precio. Quedó igual a la planilla: 4.099 artículos, 357 órdenes, 3.596 líneas (3.076 recibidas y 520 pendientes, 33.706 unidades).
- Pruebas: `pruebas/importador.test.js` (el plan) y la prueba de `sincronizar_planilla` en `pruebas/base.test.mjs`.

### Filtro "Subir a la página" (Planilla → Mostrar)
Es el filtro **SUBIR PAGINA** de la planilla anterior: la mercadería que **ya llegó** (la orden está completa), **todavía no está cargada en la web** y **tiene stock** (no está marcada "sin stock"). Sirve para ver qué hay que subir. Con la planilla del 2/11 (15:19) da exactamente las mismas 3 filas que el filtro de Google Sheets (817989, 848828 y 848829). Si en la Planilla se tilda "Cargado web" o "Sin stock", la fila sale de la lista sola.

### Seleccionar y copiar celdas (como en Sheets)
En la Planilla se **arrastra con el mouse** sobre las celdas para marcar un rango (filas × columnas). Se ve un borde naranja y una barra con "N filas × M columnas elegidas".
- **Ctrl+C** (o el botón **Copiar**) copia el rango como texto con tabuladores y saltos de línea: se pega directo en una planilla u otro programa. Las casillas salen TRUE/FALSE, las fechas dd/mm/aaaa y los textos con tabuladores o saltos se entrecomillan.
- **Copiar solo códigos**: una línea por código (sin repetir), para pasarlos a otro programa.
- Cerca del borde de la tabla, al arrastrar sigue de largo. **Escape**, un clic suelto o "Quitar selección" sacan la selección.
- Un clic suelto sigue abriendo lo de siempre (descripción rápida, ficha del artículo, tildar casillas); el arrastre no abre nada.
- Las filas elegidas con las casillas de la primera columna también tienen **Copiar códigos**.

### Catálogos de ingresos (PDF y PowerPoint)
Botón **Armar catálogo** (barra de la Planilla y barras de selección; **solo admin y carga**, porque hay que comprobar la web): usa los artículos elegidos con las casillas de la primera columna o, si no hay, los que se arrastraron. Las variantes no van (el catálogo muestra el artículo).
- **Solo entran los artículos publicados en la página.** Al abrir el catálogo se comprueba cada uno en la web de Cindy (`buscar-en-web` con `imagenes: true`), de a 10 con 5 s de pausa y barra de progreso, como "Revisar en la web" (y de paso queda guardado si está publicado). Cada artículo queda **En la página** (o **Por variantes**), **No está** o **Sin respuesta** (se puede volver a comprobar). Los que no están se ven apagados y **no entran** al PDF ni al PowerPoint; si no hay ninguno publicado, no se puede descargar. Un artículo que está en la página por sus variantes (3M201-GRE…) entra con el precio y la foto de la primera variante.
- **El precio sale de la página:** la función lee el precio de la tarjeta de la tienda (`$ 1.200` → 1200; hoy TiendaQuick). Se comprobó contra los catálogos de Manager de ejemplo (Bagcherry y Target): los 8 precios coinciden exactamente. Se puede corregir a mano en la lista; si la página no muestra precio, la tarjeta sale sin él. Se puede sacar el precio y el "+IVA".
- **Fotos:** también de la página (la función baja la foto original, o la miniatura grande si no está; el navegador no puede leerlas directo porque la tienda no lo permite). Si falta, se puede **subir a mano** por artículo ("Subir foto" / "Cambiar").
- **Vista previa:** debajo de la lista se ve el **mismo PDF que se descarga** (el PowerPoint tiene el mismo diseño) y se regenera sola al corregir nombres, precios o las opciones. Con **Abrir en otra pestaña** se ve más grande (en algunos celulares el visor no muestra PDF dentro de la página).
- **Avisos antes de descargar:** se listan los artículos sin foto, sin precio, sin nombre o con nombre muy largo (más de 56 caracteres: ocupa tres renglones y pisa la foto). Si hay avisos, al descargar pide confirmación.
- **Formato:** copia el "Catálogo de ingresos" que sale de Manager: hoja **A4 vertical, 4 tarjetas por hoja (2 × 2)**; cada tarjeta, fondo gris con borde negro, **nombre** arriba y centrado, **foto** cuadrada sobre blanco, **"CÓD. 123456"** abajo a la izquierda y una **píldora negra con el precio** ("$ 1,200 +IVA") a la derecha. Dibujo en `js/catalogo-formato.js`.
- **Descargas:** **PDF** (jsPDF) y **PowerPoint** (PptxGenJS): una diapositiva A4 vertical por hoja, con formas y textos **editables** (nombre, código, precio) y la foto como imagen. Las librerías se bajan de internet recién al armar un catálogo. El nombre del archivo sale del campo "Nombre del archivo" más la fecha. Las opciones de precio se acuerdan en el navegador.
- **Cuando la tienda pase a Tiendanube** hay que adaptar la lectura del precio y la foto en `buscar-en-web` (junto con la del estado de publicación).
- **Publicar la función:** `buscar-en-web` cambió (precio e imágenes): hay que volver a pegar `supabase/functions/buscar-en-web/index.ts` en Supabase → Edge Functions → buscar-en-web → Code → Deploy updates (Verify JWT sigue apagado).
- Pruebas: `pruebas/catalogo.test.js` (formato, hojas, PDF y PowerPoint) y `pruebas/web.test.mjs` (lectura del precio y de la foto).

### Configuración: elegir el color de fondo
Sección **Configuración** del menú (la ven todos los usuarios). En **Apariencia** se elige el color de fondo entre 8 sugeridos (verde pastel de siempre, menta, celeste, lila, rosa, durazno, amarillo, gris) o con el selector de **Otro color**; se ve en vivo y **Volver al verde pastel** deja el de siempre.
- **Es personal:** se guarda en el navegador (`localStorage`, clave `compras-color`) y no cambia lo que ven los demás. En otra PC o navegador hay que elegirlo de nuevo.
- **Todo se calcula de un solo color** (`js/color.js`): desde el matiz y la intensidad se derivan los bordes, los encabezados de tabla, las filas bajo el mouse, los esqueletos de carga, los textos y el **modo oscuro** (en el mismo matiz). Para que siempre se lea bien, la luminosidad se limita a un pastel (78 %–93 % en claro) y se avisa si se ajustó. El naranja de la marca y los verdes de estados y selección no cambian.
- Se aplica con una hoja de estilos (`#color-usuario`) que va después de `css/app.css` y **antes de dibujar**, así no parpadea al cargar. Si es el verde de siempre, no se agrega nada.
- Pruebas: `pruebas/color.test.js`.

### Esqueletos de carga (en vez de "Cargando…")
Mientras llegan los datos se ve la **forma de lo que va a aparecer** (barras con un brillo suave), como en el Gestor de RRHH. Al arrancar, `index.html` trae un esqueleto de toda la app (barra, menú, indicadores y tabla) que se ve **antes** de que cargue el JavaScript; después, cada pantalla (Pendientes, Planilla, Órdenes y remitos, Proveedores, Colores, Usuarios) muestra el esqueleto de sus indicadores y tablas hasta tener los datos. Las ayudas están en `R.util.esqueleto` (`kpis`, `filas`, `tabla`) y los colores en los tokens `--esq-*`. Con datos en la caché (ver abajo) la pantalla sale directo y no se ve el esqueleto.

### Caché en el navegador (para no consultar lo mismo a cada rato)
`js/cache.js`, usado solo desde `js/api.js` (las pantallas no saben que existe, salvo que pasan `alActualizar`). Estrategia **stale-while-revalidate**:
- **Dónde se guarda:** memoria (la pestaña), **localStorage** para lo chico (proveedores, colores, preferencias de columnas) e **IndexedDB** para lo grande (planilla, pendientes, órdenes, remitos…): localStorage tiene ~5 MB y la planilla con miles de filas no entra. Si el navegador no deja guardar (ventana privada, sin espacio), sigue solo con la memoria.
- **Tiempo fresco (60 s):** si lo guardado tiene menos de 60 segundos, no se consulta nada. Se cambia en `js/config.js` → `cache.frescoSegundos`.
- **Pasado ese tiempo:** Pendientes y Planilla muestran **al instante** lo guardado y lo **renuevan por atrás**; si llegó algo distinto, se redibujan (la planilla no se toca mientras se escribe una descripción o se revisa en la web). El resto de las pantallas vuelve a consultar. Lo guardado vale hasta 7 días (`cache.maxHoras`); más viejo no se muestra.
- **Por usuario:** cada usuario tiene su propia caché y **al salir se borra todo**. Las preferencias de columnas no vencen (solo las cambia el usuario y se actualizan al guardar).
- **Al guardar un cambio:** las casillas, descripciones, variantes y resultados de "Revisar en la web" **parchan la planilla guardada en el lugar** (no hace falta pedirla entera de nuevo). Cambios en órdenes, remitos, proveedores, colores, carga de documentos e importación **descartan** lo guardado que depende de ellos. Una lectura que arrancó antes de un cambio no pisa lo guardado con datos viejos.
- **Botón "Actualizar"** (flechas circulares, en la barra de arriba): descarta todo lo guardado y vuelve a pedir lo de la pantalla abierta.
- **Qué no se guarda:** el perfil/rol del usuario, la lista de artículos y órdenes para importar (tiene que ser siempre la real) y nada de la revisión web en curso.
- **Medido (4.043 filas de la planilla):** primera carga ~7 s; con la caché, ~0,4 s y sin pedidos a la base.
- **Caché del navegador para los archivos** (`.htaccess`): los `.js` y `.css` se guardan 30 días (llevan `?v=` en `index.html`, así que al subir otra versión se bajan solos; **hay que subir el `?v=` en cada cambio**) y el `index.html` se revalida siempre.
- Pruebas: `pruebas/cache.test.js` (lógica, sobre memoria).

### Planilla: desplazamiento fluido (filas a pedido)
Con las ~4.000 filas dibujadas había **más de 33.000 elementos** en pantalla y al desplazar rápido, vertical u horizontal, se cortaba. Ahora la tabla dibuja **solo las filas que se ven más unas de margen** (unas 20 a 30, ~1.000 elementos) y, arriba y abajo, dos filas vacías ("espaciadores") dan la altura del resto, así la barra de desplazamiento se comporta como si estuvieran todas (`renderVentana` en `js/vistas/planilla.js`).
- **Columnas de ancho fijo** (`ANCHOS_COL`): con ancho automático las columnas se reacomodarían cada vez que entran filas nuevas; con ancho fijo el desplazamiento horizontal no cuesta nada.
- **Se redibuja en tandas, no en cada fila**, y solo se agregan y sacan las filas que entran y salen (las demás no se tocan). Una fila dibujada se mide y la estimación de altura (74 px) se va corrigiendo.
- **Todo lo demás sigue igual** porque trabaja con la lista de datos y no con lo dibujado: elegir filas, rango arrastrado (también cuando sale de lo dibujado), copiar, filtros, buscador, descripción rápida y catálogo. Ya no hay tope de 1.000 filas (`MAX_FILAS` pasó a 20.000).
- La descripción rápida se cierra si se desplaza tanto que su fila sale de lo dibujado; al guardar y pasar a la siguiente se lleva la tabla hasta esa fila (`asegurarFila`).
- **Medido con los datos reales (4.050 filas):** de 33.037 a ~1.000 elementos; 300 pasos de desplazamiento en las dos direcciones sin una sola vez que faltara una fila en pantalla; un redibujo cuesta 11–17 ms y ocurre cada varias filas.

### Fluidez de la planilla
- Tildar casillas, elegir filas, guardar la descripción y revisar en la web **redibujan solo las celdas que cambian**, no la tabla entera (hasta 1000 filas). Cada celda lleva `data-c` con su columna; lo hace `refrescarCeldas(codigos, claves)` en `js/vistas/planilla.js`.
- Si el filtro **Mostrar** depende del dato que cambió, ahí sí se redibuja todo (la fila puede tener que salir). Durante la revisión en la web no: las filas no saltan mientras llegan resultados, y se reacomodan al terminar.
- El buscador espera a que se deje de escribir (180 ms) antes de filtrar.

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
- **Front:** HTML + CSS + JavaScript sin frameworks, estilo Cindy (el mismo del Gestor de RRHH).
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
css/app.css                                         estilos (tokens de Cindy, los mismos del RRHH)
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
Repo git **propio y privado** (`Luca-237/Planilla-de-productos-automatica`). La carpeta está excluida del repo **público** de rótulos (`Desktop/Proyectos/.git/info/exclude`). Nunca subir `datos-privados/`: tiene OC con precios de proveedores (está en `.gitignore`).

Publicación en Ferozo con GIT → Desplegar por HTTPS con un token de GitHub de solo lectura (la clave SSH de Ferozo ya está usada en otro repo privado): ver `GUIA-DESPLIEGUE.md`. Antes de cada despliegue, subir el `?v=` de `index.html` y correr `npm test`.
