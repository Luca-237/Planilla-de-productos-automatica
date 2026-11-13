// =====================================================================
//  Edge Function: buscador de productos "mientras se escribe" (autocompletar).
//  Consulta el catálogo de Tiendanube por API (clave de SOLO LECTURA, secretos
//  TIENDANUBE_TOKEN y TIENDANUBE_STORE_ID) y devuelve UN resultado por nombre
//  + categoría: si hay 42 "Cartuchera Trendy" en la misma categoría, sale una.
//  No hace falta el código exacto: la venta guarda nombre y categoría.
//
//  POST { q: "cartuch", limite: 8 }   (q desde 2 letras; limite 1 a 20, por defecto 8)
//  Para cualquier usuario activo (admin, carga o consulta).
//  Responde { resultados: [{ clave, nombre, categoria, ruta, categoria_id, cantidad, publicado, imagen }] }
//    clave        nombre normalizado + categoría (identifica al grupo, sirve para estadísticas)
//    categoria    la categoría más profunda del producto ("Infantiles")
//    ruta         "Marroquinería > Mochilas > Infantiles"
//    cantidad     cuántos productos del catálogo se juntaron en ese resultado
//    publicado    true si al menos uno está publicado en la tienda
//  Incluye TODOS los productos (publicados o no). Orden: primero los que empiezan con lo escrito, después los
//  publicados, y dentro de eso el orden de relevancia de la API.
//  La API busca por partes de palabra ("mochi" encuentra "mochila") pero no corrige errores de tipeo.
//
//  Este archivo es independiente (no importa nada de otras funciones) para poder pegarlo tal cual en el
//  editor de Supabase de cualquier proyecto que tenga esos dos secretos.
// =====================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const POR_PAGINA = 30;      // productos que se piden por consulta a la API
const MAX_PAGINAS = 2;      // si con una no alcanza para juntar los resultados únicos pedidos
const LIMITE_DEFECTO = 8;
const LIMITE_MAX = 20;
const MIN_LETRAS = 2;
const MAX_LETRAS = 60;
const ESPERA_MAX_MS = 8000;
const CACHE_SEGUNDOS = 60;  // la misma búsqueda no vuelve a la API durante este tiempo
const CACHE_MAX = 300;

// ---------- Lógica pura (se prueba sin internet) ----------
export type CategoriaTN = { id: number; name?: unknown; parent?: number | null };
export type ProductoTN = {
  id: number; name?: unknown; published?: boolean; categories?: CategoriaTN[];
  images?: { src: string; position?: number }[];
};
export type Resultado = {
  clave: string; nombre: string; categoria: string; ruta: string; categoria_id: number | null;
  cantidad: number; publicado: boolean; imagen: string;
};

// Los textos de Tiendanube vienen por idioma: { es: "…" }
export const textoTN = (v: unknown): string =>
  typeof v === "string" ? v : v && typeof v === "object" ? String((v as Record<string, unknown>).es ?? Object.values(v)[0] ?? "") : "";

// "Mochila  NBA" y "MOCHILA NBA" son el mismo nombre; sin tildes, sin signos, sin espacios de más
export const normalizar = (s: unknown): string =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// La categoría más profunda de un producto y su ruta. Tiendanube trae todas las categorías del camino
// (Marroquinería, Mochilas, Infantiles) con su "parent": se arma el camino siguiendo los padres.
export function categoriaHoja(p: ProductoTN): { id: number | null; nombre: string; ruta: string } {
  const cats = p.categories ?? [];
  if (!cats.length) return { id: null, nombre: "Sin categoría", ruta: "Sin categoría" };
  const porId = new Map(cats.map((c) => [c.id, c]));
  const camino = (c: CategoriaTN): CategoriaTN[] => {
    const salida = [c];
    const vistos = new Set([c.id]);
    for (let a = c.parent ? porId.get(c.parent) : undefined; a && !vistos.has(a.id); a = a.parent ? porId.get(a.parent) : undefined) {
      salida.unshift(a); vistos.add(a.id);
    }
    return salida;
  };
  const esPadre = new Set(cats.map((c) => c.parent).filter(Boolean) as number[]);
  const hojas = cats.filter((c) => !esPadre.has(c.id));
  // la más profunda; si empatan, la primera
  const mejor = (hojas.length ? hojas : cats).map((c) => ({ c, ruta: camino(c) })).reduce((a, b) => (b.ruta.length > a.ruta.length ? b : a));
  return { id: mejor.c.id, nombre: textoTN(mejor.c.name) || "Sin categoría", ruta: mejor.ruta.map((x) => textoTN(x.name)).filter(Boolean).join(" > ") };
}

// Junta los productos en un resultado por nombre + categoría y los ordena para el autocompletar
export function agrupar(productos: ProductoTN[], q: string, limite = LIMITE_DEFECTO): Resultado[] {
  const grupos = new Map<string, Resultado & { orden: number }>();
  productos.forEach((p, i) => {
    const nombre = textoTN(p.name).replace(/\s+/g, " ").trim();
    if (!nombre) return;
    const cat = categoriaHoja(p);
    const clave = normalizar(nombre) + "|" + (cat.id ?? "sin");
    const foto = [...(p.images ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]?.src ?? "";
    const g = grupos.get(clave);
    if (g) {
      g.cantidad++;
      g.publicado = g.publicado || p.published !== false;
      if (!g.imagen && foto) g.imagen = foto;
    } else {
      grupos.set(clave, { clave, nombre, categoria: cat.nombre, ruta: cat.ruta, categoria_id: cat.id, cantidad: 1, publicado: p.published !== false, imagen: foto, orden: i });
    }
  });
  const buscado = normalizar(q);
  const empieza = (g: Resultado) => (normalizar(g.nombre).startsWith(buscado) ? 0 : 1);
  return [...grupos.values()]
    .sort((a, b) => empieza(a) - empieza(b) || Number(b.publicado) - Number(a.publicado) || a.orden - b.orden)
    .slice(0, limite)
    .map(({ orden: _o, ...r }) => r);
}

export type ConfigTN = { token: string; tiendaId: string };
const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

// Una página de la búsqueda; ante el límite de pedidos (429) espera lo que indica la API y reintenta
export async function pedirPagina(q: string, pagina: number, cfg: ConfigTN, pedir: typeof fetch = fetch): Promise<ProductoTN[]> {
  const url = `https://api.tiendanube.com/v1/${encodeURIComponent(cfg.tiendaId)}/products?q=${encodeURIComponent(q)}&per_page=${POR_PAGINA}&page=${pagina}&fields=id,name,published,categories,images`;
  for (let intento = 0; ; intento++) {
    const ctrl = new AbortController();
    const corte = setTimeout(() => ctrl.abort(), ESPERA_MAX_MS);
    try {
      const r = await pedir(url, { signal: ctrl.signal, headers: { Authentication: "bearer " + cfg.token, "User-Agent": "Cindy-Compras (buscador de productos)" } });
      if (r.status === 429 && intento < 3) { await esperar(Math.min(Number(r.headers.get("x-rate-limit-reset")) || 1000, 4000)); continue; }
      // La API contesta 404 cuando la búsqueda no tiene resultados en esa página
      if (r.status === 404) return [];
      if (r.status === 401 || r.status === 403) throw new Error("Tiendanube rechazó la clave (revisá el secreto TIENDANUBE_TOKEN y el permiso Leer productos)");
      if (!r.ok) throw new Error("Tiendanube respondió " + r.status);
      const lista = await r.json();
      if (!Array.isArray(lista)) throw new Error("Tiendanube devolvió algo inesperado");
      return lista as ProductoTN[];
    } finally { clearTimeout(corte); }
  }
}

export async function buscarProductos(q: string, limite: number, cfg: ConfigTN, pedir: typeof fetch = fetch): Promise<Resultado[]> {
  const todos: ProductoTN[] = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const lote = await pedirPagina(q, pagina, cfg, pedir);
    todos.push(...lote);
    // alcanzan los únicos pedidos, o ya no hay más páginas
    if (lote.length < POR_PAGINA || agrupar(todos, q, limite).length >= limite) break;
  }
  return agrupar(todos, q, limite);
}

// ---------- Servidor (solo en Supabase; en la PC se importan las funciones de arriba para probarlas) ----------
const respuesta = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D && D.serve) {
  const cache = new Map<string, { hasta: number; datos: Resultado[] }>();
  D.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return respuesta({ error: "Método no permitido" }, 405);
    try {
      const { createClient } = await import("jsr:@supabase/supabase-js@2");
      const url = D.env.get("SUPABASE_URL");
      const service = D.env.get("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(D.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
      if (!service) throw new Error("La función no tiene la clave de servicio configurada");
      const token = D.env.get("TIENDANUBE_TOKEN")?.trim(), tiendaId = D.env.get("TIENDANUBE_STORE_ID")?.trim();
      if (!token || !tiendaId) return respuesta({ error: "Faltan los secretos TIENDANUBE_TOKEN y TIENDANUBE_STORE_ID en esta función" }, 500);
      const admin = createClient(url, service, { auth: { persistSession: false } });

      // ¿Quién llama? Cualquier usuario activo
      const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!jwt) return respuesta({ error: "Falta iniciar sesión" }, 401);
      const { data: { user }, error: errSesion } = await admin.auth.getUser(jwt);
      if (errSesion || !user) return respuesta({ error: "Sesión inválida o vencida. Volvé a ingresar." }, 401);
      const { data: yo, error: errPerfil } = await admin.from("perfiles").select("activo").eq("id", user.id).maybeSingle();
      if (errPerfil) return respuesta({ error: "La función no pudo leer los perfiles: " + errPerfil.message }, 500);
      if (!yo || !yo.activo) return respuesta({ error: "No tenés permiso para buscar productos" }, 403);

      const body = await req.json().catch(() => ({}));
      const q = String(body.q ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LETRAS);
      const limite = Math.min(Math.max(Math.floor(Number(body.limite)) || LIMITE_DEFECTO, 1), LIMITE_MAX);
      if (q.length < MIN_LETRAS) return respuesta({ resultados: [] });

      const clave = normalizar(q) + "|" + limite;
      const guardado = cache.get(clave);
      if (guardado && guardado.hasta > Date.now()) return respuesta({ resultados: guardado.datos, cache: true });
      const datos = await buscarProductos(q, limite, { token, tiendaId });
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(clave, { hasta: Date.now() + CACHE_SEGUNDOS * 1000, datos });
      return respuesta({ resultados: datos });
    } catch (e) {
      return respuesta({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });
}
