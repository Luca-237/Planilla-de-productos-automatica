// =====================================================================
//  Backup diario de Compras · Cindy.
//  1) Pide los datos a la función backup-datos (solo lectura, con token).
//  2) Arma un Excel con formato (backup/armar-xlsx.mjs).
//  3) Lo sube a una carpeta de Google Drive y borra los de más de N días.
//  4) Anota en la base cómo salió (se ve en Configuración).
//
//  Lo corre GitHub Actions todos los días (ver .github/workflows/backup-diario.yml)
//  y también se puede correr a mano. Variables de entorno:
//    BACKUP_URL            https://<proyecto>.supabase.co/functions/v1/backup-datos
//    BACKUP_TOKEN          el mismo que tiene la función (secreto)
//    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN   (secretos; ver GUIA-BACKUP.md)
//    BACKUP_DIAS           cuántos días se guardan (por defecto 30)
//    BACKUP_ORIGEN         "programado" (por defecto) o "manual"
//  Opciones:
//    --solo-archivo [ruta]  arma el Excel en esta PC y no toca Drive ni el registro.
//    --a-carpeta <carpeta>  lo deja en esa carpeta (por ejemplo la de Google Drive para escritorio),
//                           borra de ahí los de más de BACKUP_DIAS días y lo anota en el registro.
//    --env <archivo>        lee las variables de un archivo CLAVE=valor (fuera del repo).
// =====================================================================
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { armarLibro, nombreArchivo, resumenFilas, TABLAS } from "./armar-xlsx.mjs";

const NOMBRE_CARPETA = "Backups Compras Cindy";
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
import { env, exigir, pedirFuncion, traerTabla } from "./comun.mjs";

async function traerDatos() {
  const datos = { planilla: await traerTabla("planilla"), tablas: {} };
  for (const t of TABLAS) datos.tablas[t] = await traerTabla(t);
  return datos;
}

// ---------- Google Drive ----------
async function tokenGoogle() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: exigir("GOOGLE_CLIENT_ID"), client_secret: exigir("GOOGLE_CLIENT_SECRET"),
      refresh_token: exigir("GOOGLE_REFRESH_TOKEN"), grant_type: "refresh_token",
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`Google no dio el acceso (${r.status}): ${d.error_description || d.error || "sin detalle"}. Si dice invalid_grant hay que generar de nuevo GOOGLE_REFRESH_TOKEN.`);
  return d.access_token;
}

async function drive(token, ruta, opciones = {}, base = "https://www.googleapis.com/drive/v3/") {
  const r = await fetch(base + ruta, { ...opciones, headers: { Authorization: `Bearer ${token}`, ...(opciones.headers || {}) } });
  if (r.status === 204) return null;
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Drive respondió ${r.status}: ${(d.error && d.error.message) || JSON.stringify(d).slice(0, 200)}`);
  return d;
}
const comilla = s => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

// La carpeta la crea este mismo script (con el permiso "drive.file" solo se ve lo que la app creó)
async function carpeta(token) {
  const q = `name='${comilla(NOMBRE_CARPETA)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const { files } = await drive(token, `files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10`);
  if (files.length) return files[0].id;
  const c = await drive(token, "files?fields=id", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: NOMBRE_CARPETA, mimeType: "application/vnd.google-apps.folder" }),
  });
  return c.id;
}

async function subir(token, carpetaId, nombre, buffer) {
  const q = `'${carpetaId}' in parents and name='${comilla(nombre)}' and trashed=false`;
  const { files } = await drive(token, `files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`);
  if (files.length) { // ya había uno de hoy: se reemplaza el contenido
    return drive(token, `files/${files[0].id}?uploadType=media&fields=id,webViewLink`, { method: "PATCH", headers: { "Content-Type": MIME_XLSX }, body: buffer }, "https://www.googleapis.com/upload/drive/v3/");
  }
  const limite = "backup" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: nombre, parents: [carpetaId] });
  const cuerpo = Buffer.concat([
    Buffer.from(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${limite}\r\nContent-Type: ${MIME_XLSX}\r\n\r\n`),
    buffer, Buffer.from(`\r\n--${limite}--`),
  ]);
  return drive(token, "files?uploadType=multipart&fields=id,webViewLink", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${limite}` }, body: cuerpo }, "https://www.googleapis.com/upload/drive/v3/");
}

// Borra los backups de más de N días (por la fecha que lleva el nombre). Devuelve cuántos borró.
async function limpiar(token, carpetaId, dias, hoy = new Date()) {
  const q = `'${carpetaId}' in parents and trashed=false and name contains 'backup-compras-cindy-'`;
  const { files } = await drive(token, `files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1000`);
  const limite = new Date(hoy.getTime() - dias * 86400000).toISOString().slice(0, 10);
  let borrados = 0;
  for (const f of files) {
    const m = f.name.match(/^backup-compras-cindy-(\d{4}-\d{2}-\d{2})\.xlsx$/);
    if (m && m[1] < limite) { await drive(token, `files/${f.id}`, { method: "DELETE" }); borrados++; }
  }
  return borrados;
}

// ---------- Principal ----------
async function principal() {
  const args = process.argv.slice(2), soloArchivo = args.includes("--solo-archivo");
  const ahora = new Date(), nombre = nombreArchivo(ahora);
  const t0 = Date.now();
  console.log("Pidiendo los datos…");
  const datos = await traerDatos();
  const filas = resumenFilas(datos);
  console.log("Filas:", JSON.stringify(filas));
  if (!datos.planilla.length && !datos.tablas.articulos.length) throw new Error("No llegaron datos: no se guarda un backup vacío.");

  console.log("Armando el Excel…");
  const buffer = Buffer.from(await armarLibro(ExcelJS, datos, ahora).xlsx.writeBuffer());
  console.log(`Excel listo: ${(buffer.length / 1048576).toFixed(1)} MB`);

  if (soloArchivo) {
    const i = args.indexOf("--solo-archivo"), ruta = args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : nombre;
    fs.writeFileSync(ruta, buffer);
    console.log("Guardado en", ruta);
    return;
  }

  const carpetaLocal = args.includes("--a-carpeta") ? args[args.indexOf("--a-carpeta") + 1] : "";
  if (carpetaLocal) {
    fs.mkdirSync(carpetaLocal, { recursive: true });
    fs.writeFileSync(path.join(carpetaLocal, nombre), buffer);
    const limite = new Date(ahora.getTime() - (Number(env("BACKUP_DIAS")) || 30) * 86400000).toISOString().slice(0, 10);
    let borrados = 0;
    for (const f of fs.readdirSync(carpetaLocal)) {
      const m = f.match(/^backup-compras-cindy-(\d{4}-\d{2}-\d{2})\.xlsx$/);
      if (m && m[1] < limite) { fs.unlinkSync(path.join(carpetaLocal, f)); borrados++; }
    }
    console.log(`Guardado en ${path.join(carpetaLocal, nombre)}; se borraron ${borrados} backups viejos.`);
    await pedirFuncion({ accion: "registrar", estado: "ok", archivo: nombre, filas, bytes: buffer.length, origen: env("BACKUP_ORIGEN") || "programado" });
    return;
  }

  const token = await tokenGoogle();
  const carpetaId = await carpeta(token);
  const archivo = await subir(token, carpetaId, nombre, buffer);
  const borrados = await limpiar(token, carpetaId, Number(env("BACKUP_DIAS")) || 30, ahora);
  console.log(`Subido a Drive (${nombre}); se borraron ${borrados} backups viejos. Tardó ${Math.round((Date.now() - t0) / 1000)} s.`);
  await pedirFuncion({ accion: "registrar", estado: "ok", archivo: nombre, drive_url: archivo.webViewLink || "", filas, bytes: buffer.length, origen: env("BACKUP_ORIGEN") || "programado" });
}

{
  principal().catch(async e => {
    console.error("El backup falló:", e.message);
    // Se intenta dejar el error anotado para que se vea en Configuración (si la función responde)
    try { if (!process.argv.includes("--solo-archivo")) await pedirFuncion({ accion: "registrar", estado: "error", error: e.message, origen: env("BACKUP_ORIGEN") || "programado" }); } catch { /* sin registro */ }
    process.exit(1);
  });
}
