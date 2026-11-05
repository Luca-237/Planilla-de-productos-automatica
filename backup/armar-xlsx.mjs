// =====================================================================
//  Arma el libro de Excel del backup diario. Sin dependencias propias:
//  recibe la librería ExcelJS (la función la trae de npm; las pruebas,
//  de node_modules), así se prueba igual en Node que en Deno.
//
//  Hojas:
//    LÉEME     qué es el archivo, cuándo se hizo y cuántas filas tiene cada hoja
//    Planilla  lo mismo que la pantalla Planilla, legible (Sí/No, fechas, precios)
//    (resto)   una hoja por tabla de la base, con los nombres reales de las
//              columnas: con esas hojas se puede reconstruir todo
// =====================================================================

const VERDE = "FF2F7D5B";
const VERDE_SUAVE = "FFC8F0D6";
const LIMITE_CELDA = 32000; // Excel no admite más de 32.767 caracteres por celda

// Tablas que se vuelcan completas, en el orden en que se restauran (primero las que no dependen de otras)
export const TABLAS = [
  "perfiles", "proveedores", "colores", "articulos", "ordenes_compra", "oc_lineas",
  "remitos", "remito_lineas", "recepciones", "preferencias",
];

const sino = v => (v === null || v === undefined ? "" : v ? "Sí" : "No");
const num = v => (v === null || v === undefined || v === "" ? null : Number(v));
const fecha = v => (v ? String(v).slice(0, 10) : "");
const fechaHora = v => (v ? String(v).replace("T", " ").slice(0, 16) : "");
const ESTADOS = { pendiente: "Pendiente", parcial: "Parcial", completa: "Completa", cancelada: "Cancelada" };
const WEB = { publicado: "En la web", solo_variantes: "Por variantes", no_esta: "No está" };

// [título, cómo sale de la fila de v_planilla, formato de número opcional]
const COLUMNAS_PLANILLA = [
  ["Orden de compra", f => f.orden], ["Fecha OC", f => fecha(f.fecha_orden)], ["Proveedor", f => f.proveedor],
  ["Razón social", f => f.razon_social], ["Código", f => f.codigo], ["Nombre", f => f.nombre],
  ["Cantidad", f => num(f.cantidad), "#,##0.##"], ["Precio unit.", f => num(f.precio_unitario), "#,##0.00"],
  ["Estado", f => ESTADOS[f.estado] || f.estado || ""], ["Unidades llegadas", f => num(f.recibido), "#,##0.##"],
  ["Falta", f => num(f.pendiente), "#,##0.##"], ["Última llegada", f => fecha(f.ultima_recepcion)],
  ["Tipo", f => f.tipo], ["Variantes", f => f.variantes], ["Color", f => f.color], ["Cód. barra", f => f.cod_barra],
  ["Llegó", f => sino(f.llego)], ["Foto", f => sino(f.foto)], ["Descripción OK", f => sino(f.descripcion_ok)],
  ["Cargado web", f => sino(f.cargado_web)], ["Catálogo", f => sino(f.catalogo)], ["Sin stock", f => sino(f.sin_stock)],
  ["Ya no está en la página", f => sino(f.ya_no_esta)], ["Fecha alta web", f => fecha(f.fecha_alta_web)],
  ["En la web (última revisión)", f => WEB[f.web_estado] || ""], ["Revisado en", f => fechaHora(f.web_revisado_en)],
  ["Link en la web", f => f.web_url], ["Observaciones", f => f.observaciones], ["Título web", f => f.titulo_web],
  ["Descripción web", f => f.descripcion_web], ["Estado descripción", f => f.estado_descripcion],
];

// Valor de una celda de las hojas de datos: sin objetos ni textos que Excel no aguante
function celda(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") v = JSON.stringify(v);
  if (typeof v === "string" && v.length > LIMITE_CELDA) return v.slice(0, LIMITE_CELDA);
  return v;
}

function darFormato(hoja, anchoMax = 60) {
  const cab = hoja.getRow(1);
  cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cab.alignment = { vertical: "middle", wrapText: true };
  cab.height = 30;
  cab.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } }; });
  hoja.views = [{ state: "frozen", ySplit: 1 }];
  if (hoja.columnCount && hoja.rowCount) {
    hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hoja.columnCount } };
  }
  // Ancho según lo más largo de las primeras filas (medir todas sería lento)
  hoja.columns.forEach(col => {
    let max = String(col.header ?? "").length;
    col.eachCell({ includeEmpty: false }, (c, n) => { if (n > 1 && n <= 300) max = Math.max(max, String(c.value ?? "").split("\n")[0].length); });
    col.width = Math.min(anchoMax, Math.max(10, max + 2));
  });
}

// datos = { planilla: [filas de v_planilla], tablas: { articulos: [...], ... } }
export function armarLibro(ExcelJS, datos, ahora = new Date()) {
  const libro = new ExcelJS.Workbook();
  libro.creator = "Compras · Cindy";
  libro.created = ahora;

  const leeme = libro.addWorksheet("LÉEME");
  const hojas = [];

  // Planilla legible
  const planilla = libro.addWorksheet("Planilla");
  planilla.columns = COLUMNAS_PLANILLA.map(([header]) => ({ header }));
  for (const f of datos.planilla || []) planilla.addRow(COLUMNAS_PLANILLA.map(([, de]) => celda(de(f))));
  COLUMNAS_PLANILLA.forEach(([, , formato], i) => { if (formato) planilla.getColumn(i + 1).numFmt = formato; });
  planilla.getColumn(COLUMNAS_PLANILLA.findIndex(c => c[0] === "Descripción web") + 1).alignment = { wrapText: false };
  darFormato(planilla);
  hojas.push(["Planilla", (datos.planilla || []).length, "Lo que se ve en la pantalla Planilla, una fila por artículo de cada orden."]);

  // Una hoja por tabla, con los nombres reales de las columnas
  for (const nombre of TABLAS) {
    const filas = (datos.tablas || {})[nombre] || [];
    const hoja = libro.addWorksheet(nombre);
    const claves = [...new Set(filas.flatMap(f => Object.keys(f)))];
    hoja.columns = (claves.length ? claves : ["(sin filas)"]).map(header => ({ header }));
    for (const f of filas) hoja.addRow(claves.map(k => celda(f[k])));
    darFormato(hoja);
    hojas.push([nombre, filas.length, "Datos tal cual están en la base."]);
  }

  // LÉEME
  const lineas = [
    ["Backup de Compras · Cindy", ""],
    ["Hecho el", ahora.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "full", timeStyle: "short" })],
    ["", ""],
    ["Cómo recuperar", "Las hojas con nombre de tabla (articulos, ordenes_compra, oc_lineas, remitos, remito_lineas, recepciones…) tienen los datos exactos de la base, con las mismas columnas. Se vuelven a cargar en ese orden. La hoja Planilla es solo para leer."],
    ["Los usuarios", "La hoja perfiles tiene nombre, rol y estado. Las contraseñas no se guardan acá: se vuelven a crear desde Usuarios."],
    ["", ""],
    ["Hoja", "Filas"],
    ...hojas.map(([n, c]) => [n, c]),
  ];
  leeme.columns = [{ width: 28 }, { width: 110 }];
  lineas.forEach(l => leeme.addRow(l));
  leeme.getRow(1).font = { bold: true, size: 14 };
  leeme.getRow(7).font = { bold: true };
  leeme.getRow(7).eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE_SUAVE } }; });
  leeme.eachRow(r => { r.alignment = { vertical: "top", wrapText: true }; });
  return libro;
}

// Cuenta lo que quedó en cada hoja (para el registro y para las pruebas)
export const resumenFilas = datos => ({
  Planilla: (datos.planilla || []).length,
  ...Object.fromEntries(TABLAS.map(t => [t, ((datos.tablas || {})[t] || []).length])),
});

// Nombre del archivo: un backup por día (si se corre dos veces el mismo día, queda el último)
export const nombreArchivo = (ahora = new Date()) => {
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
  return `backup-compras-cindy-${f}.xlsx`;
};
