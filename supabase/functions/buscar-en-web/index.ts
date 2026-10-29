// =====================================================================
//  Edge Function: revisa si los artículos ya están publicados en la web
//  de Cindy, para no cargarlos (ni escribir su descripción) dos veces.
//  La página no puede leer otro sitio (el navegador lo bloquea): lo hace
//  esta función, que además guarda el resultado en "articulos" (web_*),
//  columnas que los usuarios no pueden escribir.
//
//  POST { codigos: ["855338", "3M201", ...] }  (hasta 100 por pedido)
//  Solo para usuarios activos con rol admin o carga.
//  Con "Accept: text/event-stream" responde por SSE: un evento por código
//  apenas se revisa (la planilla los va mostrando); sin eso, JSON al final.
//
//  Criterio (el mismo que la skill descripciones-web-cindy):
//    publicado       → en la búsqueda aparece un producto con ese código idéntico
//    solo_variantes  → no está el código, pero sí sus variantes (3M201-GRE…)
//    no_esta         → ninguna de las dos
//  La búsqueda de la tienda también trae parecidos (buscar 8216 trae 148216):
//  por eso se compara el código exacto, nunca "hubo resultados".
// =====================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_CODIGOS = 100;
const EN_PARALELO = 4;          // para no cargar la tienda
const ESPERA_MAX_MS = 12000;
const CODIGO_VALIDO = /^[A-Za-z0-9.\-]{1,40}$/;

// ---------- Lectura de la tienda (TiendaQuick) ----------
const ENTIDADES: Record<string, string> = {
  amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü", deg: "°",
};
export function decodificar(texto: string): string {
  return texto
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, e) => ENTIDADES[e] ?? m);
}

export type Producto = { codigo: string; nombre: string; url: string };

// Cada resultado de la búsqueda es un "product-listing-item" con
// meta itemprop="name", link itemprop="url" y el texto "Código XXXX".
export function leerResultados(html: string): Producto[] {
  return html.split("product-listing-item").slice(1).map((p) => {
    const texto = decodificar(p.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    return {
      codigo: (texto.match(/Código\s+([A-Za-z0-9.\-]+)/) || [])[1] || "",
      nombre: decodificar((p.match(/itemprop="name" content="([^"]*)"/) || [])[1] || ""),
      url: (p.match(/itemprop="url" href="([^"]*)"/) || [])[1] || "",
    };
  }).filter((x) => x.codigo);
}

export type Resultado = { codigo: string; estado: "publicado" | "solo_variantes" | "no_esta"; url: string; nombre: string };

export function clasificar(codigo: string, productos: Producto[]): Resultado {
  const buscado = codigo.toUpperCase();
  const exacto = productos.find((p) => p.codigo.toUpperCase() === buscado);
  if (exacto) return { codigo, estado: "publicado", url: exacto.url, nombre: exacto.nombre };
  const variante = productos.find((p) => p.codigo.toUpperCase().startsWith(buscado + "-"));
  if (variante) return { codigo, estado: "solo_variantes", url: variante.url, nombre: variante.nombre };
  return { codigo, estado: "no_esta", url: "", nombre: "" };
}

export async function revisarCodigo(codigo: string, base: string): Promise<Resultado> {
  const ctrl = new AbortController();
  const corte = setTimeout(() => ctrl.abort(), ESPERA_MAX_MS);
  try {
    const r = await fetch(base + "/resultado-busqueda.htm?keywords=" + encodeURIComponent(codigo), {
      signal: ctrl.signal, headers: { "User-Agent": "Cindy-Compras/1.0 (revision de catalogo)" },
    });
    if (!r.ok) throw new Error("la tienda respondió " + r.status);
    // La tienda manda ISO-8859-1
    const html = new TextDecoder("iso-8859-1").decode(await r.arrayBuffer());
    if (!html.includes("Resultado B")) throw new Error("la página de búsqueda cambió o no cargó bien");
    return clasificar(codigo, leerResultados(html));
  } finally { clearTimeout(corte); }
}

// De a pocos en paralelo
async function enTandas<T, R>(lista: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = new Array(lista.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, async () => {
    while (i < lista.length) { const k = i++; salida[k] = await fn(lista[k]); }
  }));
  return salida;
}

// ---------- Servidor (solo en Supabase; en la PC se importan las funciones de arriba para probarlas) ----------
function respuesta(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D && D.serve) {
  D.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return respuesta({ error: "Método no permitido" }, 405);
    try {
      const { createClient } = await import("jsr:@supabase/supabase-js@2");
      const url = D.env.get("SUPABASE_URL");
      const service = D.env.get("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(D.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
      if (!service) throw new Error("La función no tiene la clave de servicio configurada");
      const tienda = (D.env.get("TIENDA_URL") || "https://www.cindymayorista.com.ar").replace(/\/+$/, "");
      const admin = createClient(url, service, { auth: { persistSession: false } });

      // ¿Quién llama? Admin o carga, activo
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!token) return respuesta({ error: "Falta iniciar sesión" }, 401);
      const { data: { user }, error: errSesion } = await admin.auth.getUser(token);
      if (errSesion || !user) return respuesta({ error: "Sesión inválida o vencida. Volvé a ingresar." }, 401);
      const { data: yo, error: errPerfil } = await admin.from("perfiles").select("rol, activo").eq("id", user.id).maybeSingle();
      // Un error acá es de la base (ej. permisos de la clave de servicio), no del usuario: se muestra tal cual
      if (errPerfil) return respuesta({ error: "La función no pudo leer los perfiles: " + errPerfil.message }, 500);
      if (!yo || !yo.activo || !["admin", "carga"].includes(yo.rol)) return respuesta({ error: "No tenés permiso para revisar en la web" }, 403);

      const body = await req.json().catch(() => ({}));
      const codigos = [...new Set((Array.isArray(body.codigos) ? body.codigos : []).map((c: unknown) => String(c ?? "").trim()))]
        .filter((c) => CODIGO_VALIDO.test(c as string)) as string[];
      if (!codigos.length) return respuesta({ error: "No hay códigos para revisar" }, 400);
      if (codigos.length > MAX_CODIGOS) return respuesta({ error: "Como mucho " + MAX_CODIGOS + " códigos por pedido" }, 400);

      const revisar = async (codigo: string) => {
        try {
          const r = await revisarCodigo(codigo, tienda);
          const { error } = await admin.from("articulos").update({
            web_estado: r.estado, web_revisado_en: new Date().toISOString(), web_url: r.url, web_nombre: r.nombre,
          }).eq("codigo", codigo);
          if (error) throw error;
          return r;
        } catch (e) {
          // Si la tienda no responde no se guarda nada: vale el resultado anterior
          return { codigo, estado: "error", url: "", nombre: "", error: e instanceof Error ? e.message : String(e) };
        }
      };

      if (!(req.headers.get("Accept") ?? "").includes("text/event-stream")) {
        return respuesta({ resultados: await enTandas(codigos, EN_PARALELO, revisar) });
      }
      // SSE: cada resultado sale apenas está; si la página corta (botón Detener), no se revisa el resto
      const enc = new TextEncoder();
      let cortado = false;
      const cuerpo = new ReadableStream({
        async start(ctrl) {
          const enviar = (texto: string) => { if (!cortado) try { ctrl.enqueue(enc.encode(texto)); } catch { cortado = true; } };
          enviar(": revisando\n\n");
          await enTandas(codigos, EN_PARALELO, async (codigo) => {
            if (cortado) return null;
            const r = await revisar(codigo);
            enviar("data: " + JSON.stringify(r) + "\n\n");
            return r;
          });
          enviar("event: fin\ndata: {}\n\n");
          if (!cortado) ctrl.close();
        },
        cancel() { cortado = true; },
      });
      return new Response(cuerpo, { headers: { ...CORS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" } });
    } catch (e) {
      return respuesta({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });
}
