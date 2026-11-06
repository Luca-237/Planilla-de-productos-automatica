// =====================================================================
//  Lógica de la restauración desde el Excel del backup, sin red: leer el
//  libro, comparar con lo que ya hay en la base y armar los lotes. Así se
//  prueba igual en Node que contra una base de prueba (ver pruebas/).
// =====================================================================

// En el orden en que se pueden cargar (primero lo que no depende de otra tabla)
export const TABLAS_RESTAURABLES = ["proveedores", "colores", "articulos", "ordenes_compra", "oc_lineas", "remitos", "remito_lineas", "recepciones"];
export const CLAVES = {
  proveedores: "id", colores: "id", articulos: "codigo", ordenes_compra: "id", oc_lineas: "id",
  remitos: "id", remito_lineas: "id", recepciones: "id",
};
// Columna -> tabla a la que apunta (para avisar de filas "huérfanas" antes de cargar)
const REFERENCIAS = {
  articulos: [["padre_codigo", "articulos"], ["proveedor_id", "proveedores"], ["color_id", "colores"]],
  ordenes_compra: [["proveedor_id", "proveedores"]],
  oc_lineas: [["orden_id", "ordenes_compra"], ["codigo", "articulos"]],
  remitos: [["proveedor_id", "proveedores"]],
  remito_lineas: [["remito_id", "remitos"]],
  recepciones: [["remito_linea_id", "remito_lineas"], ["oc_linea_id", "oc_lineas"]],
};
// Tablas que se salvan en el Excel pero no se restauran desde acá (viven en Supabase Auth)
export const NO_RESTAURABLES = { perfiles: "los usuarios se vuelven a crear desde la pantalla Usuarios", preferencias: "las preferencias de columnas son de cada usuario" };

// Valor de una celda de ExcelJS -> valor simple (o undefined si está vacía)
function valorCelda(v) {
  if (v === null || v === undefined || v === "") return undefined;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join("") || undefined;
    if ("result" in v) return valorCelda(v.result);
    if ("text" in v) return valorCelda(v.text);
    if ("error" in v) return undefined;
    return JSON.stringify(v);
  }
  return v;
}

// Lee el libro y devuelve { tablas: { nombre: [fila, ...] }, resumen: { hoja: filas } }
export async function leerLibro(ExcelJS, origen) {
  const wb = new ExcelJS.Workbook();
  if (Buffer.isBuffer(origen)) await wb.xlsx.load(origen); else await wb.xlsx.readFile(origen);
  if (!wb.getWorksheet("LÉEME") || !wb.getWorksheet("articulos")) {
    throw new Error('Este archivo no parece un backup de Compras · Cindy: faltan las hojas "LÉEME" y "articulos".');
  }
  const tablas = {}, resumen = {};
  for (const hoja of wb.worksheets) {
    if (hoja.name === "LÉEME" || hoja.name === "Planilla") continue;
    const cab = hoja.getRow(1).values.slice(1).map(v => (v == null ? "" : String(v)));
    const filas = [];
    if (!(cab.length === 1 && cab[0] === "(sin filas)")) {
      hoja.eachRow((row, n) => {
        if (n === 1) return;
        const f = {};
        cab.forEach((c, i) => { const v = valorCelda(row.getCell(i + 1).value); if (c && v !== undefined) f[c] = v; });
        if (Object.keys(f).length) filas.push(f);
      });
    }
    tablas[hoja.name] = filas;
    resumen[hoja.name] = filas.length;
  }
  return { tablas, resumen };
}

// existentes: { tabla: Set de claves (texto) que ya están en la base }
export function planDeRestauracion(libro, existentes) {
  const claveDe = (t, f) => String(f[CLAVES[t]]);
  // Qué claves van a existir al terminar: las de la base más las que se van a cargar
  const estaran = {};
  for (const t of TABLAS_RESTAURABLES) estaran[t] = new Set([...(existentes[t] || [])].map(String));
  const plan = [];
  for (const t of TABLAS_RESTAURABLES) {
    const filas = libro.tablas[t];
    if (!filas) { plan.push({ tabla: t, enExcel: 0, yaEstan: 0, faltan: [], sinHoja: true, huerfanas: [] }); continue; }
    const yaEstan = filas.filter(f => estaran[t].has(claveDe(t, f))).length;
    const faltan = filas.filter(f => f[CLAVES[t]] !== undefined && !estaran[t].has(claveDe(t, f)));
    // Los artículos principales antes que sus variantes: el principal tiene que existir al cargar la variante
    if (t === "articulos") faltan.sort((a, b) => (a.padre_codigo ? 1 : 0) - (b.padre_codigo ? 1 : 0));
    faltan.forEach(f => estaran[t].add(claveDe(t, f)));
    plan.push({ tabla: t, enExcel: filas.length, yaEstan, faltan, sinHoja: false, huerfanas: [] });
  }
  // Filas que apuntan a algo que no va a existir (se avisa; la base las rechazaría)
  for (const p of plan) {
    for (const [col, destino] of REFERENCIAS[p.tabla] || []) {
      const rotas = p.faltan.filter(f => f[col] !== undefined && !estaran[destino].has(String(f[col])));
      if (rotas.length) p.huerfanas.push({ columna: col, destino, cuantas: rotas.length, ejemplo: String(rotas[0][col]) });
    }
  }
  return plan;
}

export function lotes(filas, tamano) {
  const r = [];
  for (let i = 0; i < filas.length; i += tamano) r.push(filas.slice(i, i + tamano));
  return r;
}
