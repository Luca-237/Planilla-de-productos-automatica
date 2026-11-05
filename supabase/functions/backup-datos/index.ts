// =====================================================================
//  Edge Function: entrega los datos para el backup diario (solo lectura)
//  y anota en "backups_registro" cómo salió. La llama el script
//  backup/hacer-backup.mjs (GitHub Actions, todos los días 13:00) con un
//  token propio (BACKUP_TOKEN, secreto de esta función): ese token solo
//  sirve para leer estos datos; la clave de servicio nunca sale de acá.
//  El Excel NO se arma acá porque las funciones tienen 2 segundos de CPU.
//
//  POST con JSON:
//    { accion: "pagina", tabla, desde }   -> { filas, hay_mas }  (hasta 1000 por pedido)
//    { accion: "registrar", estado, archivo, drive_url, filas, bytes, error, origen }
// =====================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const POR_PAGINA = 1000; // el tope de filas por pedido de la API
// tabla -> [vista o tabla, columnas de orden (únicas, para que las páginas no se repitan ni salteen)]
const FUENTES: Record<string, [string, string[]]> = {
  planilla: ["v_planilla", ["orden", "codigo", "oc_linea_id"]],
  perfiles: ["perfiles", ["id"]],
  proveedores: ["proveedores", ["id"]],
  colores: ["colores", ["id"]],
  articulos: ["articulos", ["codigo"]],
  ordenes_compra: ["ordenes_compra", ["id"]],
  oc_lineas: ["oc_lineas", ["id"]],
  remitos: ["remitos", ["id"]],
  remito_lineas: ["remito_lineas", ["id"]],
  recepciones: ["recepciones", ["id"]],
  preferencias: ["preferencias", ["usuario_id"]],
};

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

// Comparación que tarda lo mismo aunque difiera el primer carácter
function iguales(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const esperado = Deno.env.get("BACKUP_TOKEN") ?? "";
    if (esperado.length < 32) return json({ error: "La función no tiene BACKUP_TOKEN (de 32 caracteres o más) configurado" }, 500);
    if (!iguales(req.headers.get("x-backup-token") ?? "", esperado)) return json({ error: "Token inválido" }, 401);

    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
      || JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
    if (!service) throw new Error("La función no tiene la clave de servicio configurada");
    const db = createClient(Deno.env.get("SUPABASE_URL")!, service, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({}));

    if (body.accion === "pagina") {
      const fuente = FUENTES[String(body.tabla)];
      if (!fuente) return json({ error: "Tabla desconocida" }, 400);
      const desde = Math.max(0, Number(body.desde) || 0);
      let q = db.from(fuente[0]).select("*");
      for (const c of fuente[1]) q = q.order(c);
      const { data, error } = await q.range(desde, desde + POR_PAGINA - 1);
      if (error) throw error;
      return json({ filas: data ?? [], hay_mas: (data ?? []).length === POR_PAGINA });
    }

    if (body.accion === "registrar") {
      const estado = body.estado === "ok" ? "ok" : "error";
      const { error } = await db.from("backups_registro").insert({
        estado,
        archivo: String(body.archivo ?? "").slice(0, 200),
        drive_url: String(body.drive_url ?? "").slice(0, 500),
        filas: body.filas ?? null,
        bytes: Number.isFinite(Number(body.bytes)) ? Number(body.bytes) : null,
        error: String(body.error ?? "").slice(0, 1000),
        origen: String(body.origen ?? "programado").slice(0, 40),
      });
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    return json({ error: (e as { message?: string })?.message ?? String(e) }, 500);
  }
});
