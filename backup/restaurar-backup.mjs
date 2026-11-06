// =====================================================================
//  Restaurar Compras · Cindy desde el Excel del backup.
//
//    node backup/restaurar-backup.mjs <archivo.xlsx> --env <archivo .env>             (simulación)
//    node backup/restaurar-backup.mjs <archivo.xlsx> --env <archivo .env> --aplicar   (carga de verdad)
//
//  Lo hace de forma segura:
//    - Solo AGREGA lo que falta (compara con lo que hay en la base). No borra
//      ni pisa nada de lo que ya existe.
//    - Se puede repetir: lo que ya se cargó no se duplica.
//    - Sin --aplicar solo muestra qué cargaría.
//  Qué restaura: proveedores, colores, artículos, órdenes de compra y sus líneas,
//  remitos y sus líneas, y las asignaciones de remitos a órdenes.
//  Qué no: los usuarios (se vuelven a crear desde la pantalla Usuarios) y sus
//  preferencias.
//  Opción --tablas a,b: restaurar solo esas tablas.
//  Usa las mismas variables que el backup: BACKUP_URL y BACKUP_TOKEN.
// =====================================================================
import ExcelJS from "exceljs";
import { pedirFuncion, traerTabla } from "./comun.mjs";
import { leerLibro, planDeRestauracion, lotes, TABLAS_RESTAURABLES, CLAVES, NO_RESTAURABLES } from "./restaurar-lib.mjs";

const POR_LOTE = 250;
const fmt = n => n.toLocaleString("es-AR");

async function principal() {
  const args = process.argv.slice(2);
  const archivo = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--env" && args[i - 1] !== "--tablas");
  if (!archivo) throw new Error("Falta el archivo. Uso: node backup/restaurar-backup.mjs <archivo.xlsx> --env <archivo .env> [--aplicar]");
  const aplicar = args.includes("--aplicar");
  const iT = args.indexOf("--tablas"), solo = iT >= 0 ? String(args[iT + 1] || "").split(",").map(s => s.trim()).filter(Boolean) : null;
  if (solo) for (const t of solo) if (!TABLAS_RESTAURABLES.includes(t)) throw new Error(`"${t}" no se puede restaurar. Opciones: ${TABLAS_RESTAURABLES.join(", ")}`);

  console.log(`Leyendo ${archivo}…`);
  const libro = await leerLibro(ExcelJS, archivo);
  console.log("Comparando con lo que hay hoy en la base…");
  const existentes = {};
  for (const t of TABLAS_RESTAURABLES) existentes[t] = new Set((await traerTabla(t)).map(f => String(f[CLAVES[t]])));

  const plan = planDeRestauracion(libro, existentes).filter(p => !solo || solo.includes(p.tabla));
  console.log("\nTabla              En el Excel   Ya están   Faltan");
  for (const p of plan) console.log(`${p.tabla.padEnd(18)} ${fmt(p.enExcel).padStart(11)} ${fmt(p.yaEstan).padStart(10)} ${fmt(p.faltan.length).padStart(8)}${p.sinHoja ? "  (el archivo no tiene esta hoja)" : ""}`);
  for (const [t, motivo] of Object.entries(NO_RESTAURABLES)) if (libro.tablas[t]) console.log(`No se restaura "${t}": ${motivo}.`);

  const huerfanas = plan.flatMap(p => p.huerfanas.map(h => ({ tabla: p.tabla, ...h })));
  for (const h of huerfanas) console.log(`AVISO: ${fmt(h.cuantas)} filas de ${h.tabla} apuntan (${h.columna}) a ${h.destino} que no está ni en la base ni en el Excel (ej. ${h.ejemplo}).`);

  const total = plan.reduce((n, p) => n + p.faltan.length, 0);
  if (!total) { console.log("\nNo falta nada: la base ya tiene todo lo del Excel."); return; }
  if (!aplicar) { console.log(`\nSimulación: se cargarían ${fmt(total)} filas. No se cambió nada. Para cargarlas, repetí el comando con --aplicar.`); return; }
  if (huerfanas.length) throw new Error("Hay filas que apuntan a datos que no existen: no se carga nada. Revisá los avisos (suele pasar si se restaura una sola tabla).");

  console.log(`\nCargando ${fmt(total)} filas…`);
  const hecho = {};
  for (const p of plan) {
    if (!p.faltan.length) continue;
    let insertadas = 0;
    for (const lote of lotes(p.faltan, POR_LOTE)) {
      const r = await pedirFuncion({ accion: "restaurar", tabla: p.tabla, filas: lote });
      insertadas += r.insertadas;
    }
    hecho[p.tabla] = insertadas;
    console.log(`  ${p.tabla}: ${fmt(insertadas)} de ${fmt(p.faltan.length)} cargadas${insertadas < p.faltan.length ? " (el resto ya existía o chocaba con un dato igual, p. ej. un número de orden repetido)" : ""}`);
  }
  await pedirFuncion({ accion: "registrar", estado: "ok", archivo: String(archivo).split(/[\\/]/).pop(), filas: hecho, origen: "restauración" }).catch(() => {});
  console.log("\nListo. Revisá la Planilla y Pendientes. Los usuarios se crean desde la pantalla Usuarios.");
}

principal().catch(e => { console.error("La restauración falló:", e.message); process.exit(1); });
