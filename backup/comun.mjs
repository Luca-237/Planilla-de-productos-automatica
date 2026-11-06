// Lo que comparten los scripts de backup y de restauración: variables de entorno
// (también desde un archivo con --env) y el pedido a la función backup-datos.
import fs from "node:fs";

// --env: variables desde un archivo local (así los secretos no van en el comando ni en el repo)
{
  const i = process.argv.indexOf("--env");
  if (i > 0 && process.argv[i + 1]) {
    for (const l of fs.readFileSync(process.argv[i + 1], "utf8").split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !l.trim().startsWith("#") && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
export const env = k => process.env[k] || "";
export const exigir = k => { if (!env(k)) throw new Error(`Falta la variable ${k}`); return env(k); };

export async function pedirFuncion(cuerpo) {
  const r = await fetch(exigir("BACKUP_URL"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-backup-token": exigir("BACKUP_TOKEN") },
    body: JSON.stringify(cuerpo),
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = null; }
  if (!r.ok) throw new Error(`La función respondió ${r.status}: ${(d && d.error) || t.slice(0, 200)}`);
  return d;
}

export async function traerTabla(tabla) {
  const filas = [];
  for (let desde = 0; ; ) {
    const { filas: pag, hay_mas } = await pedirFuncion({ accion: "pagina", tabla, desde });
    filas.push(...pag);
    if (!hay_mas) break;
    desde += pag.length;
  }
  return filas;
}

