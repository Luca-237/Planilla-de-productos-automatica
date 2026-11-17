// =====================================================================
//  Edge Function: administración de usuarios de "Carga de artículos
//  por remito y órdenes de compra". Solo la puede usar un admin activo.
//  Crear cuentas y cambiar contraseñas necesita la clave de servicio,
//  que vive SOLO acá (Supabase la inyecta sola; nunca va en el
//  navegador ni en el repo).
//
//  Acciones (POST con JSON { accion, ... }):
//    listar
//    crear              { usuario, nombre, password, rol }
//    cambiar_rol        { id, rol }
//    activar / desactivar { id }
//    resetear_password  { id, password }
//    desvincular_clerk  { id }                 (la cuenta Cindy se separa)
//    unir_cuentas       { origen, destino }    (cuenta Cindy suelta -> usuario de siempre)
// =====================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ROLES = ["admin", "carga", "consulta"];
// "antonella" -> "antonella@compras.cindymayorista.com.ar" (no hace falta que el email exista)
const DOMINIO_USUARIOS = "compras.cindymayorista.com.ar";
const BLOQUEO = "876000h"; // ~100 años = cuenta desactivada

function respuesta(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

class ErrorUsuario extends Error {
  constructor(mensaje: string, public status = 400) { super(mensaje); }
}

function exigir(condicion: unknown, mensaje: string): asserts condicion {
  if (!condicion) throw new ErrorUsuario(mensaje);
}

// Acepta un nombre de usuario ("antonella") o un email completo
function validarEmail(usuario: unknown): string {
  let e = String(usuario ?? "").trim().toLowerCase();
  if (e && !e.includes("@")) e = e + "@" + DOMINIO_USUARIOS;
  exigir(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e), "El usuario o email no es válido");
  return e;
}

function validarPassword(password: unknown): string {
  const p = String(password ?? "");
  exigir(p.length >= 8, "La contraseña tiene que tener al menos 8 caracteres");
  return p;
}

function validarRol(rol: unknown): string {
  exigir(ROLES.includes(String(rol)), "Rol inválido (admin, carga o consulta)");
  return String(rol);
}

// Traduce errores de Postgres/Auth a algo entendible
function traducir(mensaje: string): string {
  if (/último admin/i.test(mensaje)) return "No se puede quitar el último admin activo";
  if (/already been registered|already exists/i.test(mensaje)) return "Ya existe un usuario con ese nombre de usuario o email";
  if (/password/i.test(mensaje) && /weak|short|characters/i.test(mensaje)) return "La contraseña es demasiado débil";
  return mensaje;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return respuesta({ error: "Método no permitido" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    // Clave de servicio: la clásica (service_role) o, en proyectos nuevos, la "secret" por defecto
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
      || JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
    if (!service) throw new Error("La función no tiene la clave de servicio configurada");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    // 1) ¿Quién llama? Sirve para el login propio y para la cuenta Cindy (Clerk):
    //    la base valida el token y mi_perfil() devuelve su perfil.
    const autorizacion = req.headers.get("Authorization") ?? "";
    if (!/^Bearer\s+\S+/.test(autorizacion)) return respuesta({ error: "Falta iniciar sesión" }, 401);
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}").default;
    const comoUsuario = createClient(url, anon, {
      global: { headers: { Authorization: autorizacion } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: filas, error: errSesion } = await comoUsuario.rpc("mi_perfil");
    const yo = Array.isArray(filas) ? filas[0] : null;
    if (errSesion || !yo) return respuesta({ error: "Sesión inválida o vencida. Volvé a ingresar." }, 401);

    // 2) ¿Es admin activo?
    if (yo.rol !== "admin" || !yo.activo) {
      return respuesta({ error: "Solo un admin puede administrar usuarios" }, 403);
    }

    // Logins de un perfil: auth_id (usuario de siempre) y clerk_id (cuenta Cindy)
    async function perfilDe(idPerfil: string) {
      const { data, error } = await admin.from("perfiles").select("id, auth_id, clerk_id").eq("id", idPerfil).maybeSingle();
      if (error) throw error;
      exigir(data, "No existe ese usuario");
      return data;
    }

    // 3) Acción
    const body = await req.json().catch(() => ({}));
    const id = body.id ? String(body.id) : "";

    switch (body.accion) {
      case "listar": {
        const { data: perfiles, error } = await admin
          .from("perfiles").select("id, auth_id, clerk_id, email, nombre, rol, activo, creado_en").order("nombre");
        if (error) throw error;
        // Último ingreso (viene de Auth, no de perfiles)
        const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
        const ultimo = new Map((lista?.users ?? []).map((u) => [u.id, u.last_sign_in_at]));
        return respuesta({
          usuarios: (perfiles ?? []).map(({ auth_id, clerk_id, ...p }) => ({
            ...p,
            login_propio: !!auth_id,
            cuenta_cindy: !!clerk_id,
            ultimo_ingreso: (auth_id && ultimo.get(auth_id)) || null, // solo del login propio
            soy_yo: p.id === yo.id,
          })),
        });
      }

      case "crear": {
        const email = validarEmail(body.usuario ?? body.email);
        const password = validarPassword(body.password);
        const rol = validarRol(body.rol ?? "carga");
        const nombre = String(body.nombre ?? "").trim();
        exigir(nombre, "Falta el nombre");

        const { data, error } = await admin.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { nombre },
        });
        if (error) throw error;
        // El trigger ya creó el perfil desactivado; le ponemos rol y lo activamos
        const { error: errPerfil } = await admin.from("perfiles")
          .upsert({ id: data.user.id, auth_id: data.user.id, email, nombre, rol, activo: true });
        if (errPerfil) {
          await admin.auth.admin.deleteUser(data.user.id); // no dejar usuarios a medias
          throw errPerfil;
        }
        return respuesta({ ok: true, id: data.user.id, email });
      }

      case "cambiar_rol": {
        exigir(id, "Falta el usuario");
        exigir(id !== yo.id, "No podés cambiar tu propio rol");
        const rol = validarRol(body.rol);
        const { error } = await admin.from("perfiles").update({ rol }).eq("id", id);
        if (error) throw error;
        return respuesta({ ok: true });
      }

      case "activar":
      case "desactivar": {
        exigir(id, "Falta el usuario");
        const activo = body.accion === "activar";
        exigir(activo || id !== yo.id, "No podés desactivar tu propia cuenta");
        const p = await perfilDe(id);
        const { error } = await admin.from("perfiles").update({ activo }).eq("id", id);
        if (error) throw error;
        // Además se bloquea el login propio en Auth (y se corta al renovar la sesión).
        // Con la cuenta Cindy no entra porque el perfil queda desactivado.
        if (p.auth_id) {
          const { error: errAuth } = await admin.auth.admin.updateUserById(p.auth_id, { ban_duration: activo ? "none" : BLOQUEO });
          if (errAuth) throw errAuth;
        }
        return respuesta({ ok: true });
      }

      case "resetear_password": {
        exigir(id, "Falta el usuario");
        const password = validarPassword(body.password);
        const p = await perfilDe(id);
        exigir(p.auth_id, "Esta persona entra solo con la cuenta Cindy: la contraseña se cambia en Clerk");
        const { error } = await admin.auth.admin.updateUserById(p.auth_id, { password });
        if (error) throw error;
        return respuesta({ ok: true });
      }

      // La cuenta Cindy se separa; sigue entrando con su usuario de siempre
      case "desvincular_clerk": {
        exigir(id, "Falta el usuario");
        const p = await perfilDe(id);
        exigir(p.clerk_id, "No tiene cuenta Cindy vinculada");
        exigir(p.auth_id, "Solo entra con la cuenta Cindy: para sacarle el acceso, desactivalo");
        const { error } = await admin.from("perfiles").update({ clerk_id: null }).eq("id", id);
        if (error) throw error;
        return respuesta({ ok: true });
      }

      // Una cuenta Cindy suelta pasa a un usuario de siempre (con su rol y estado).
      // Lo que cargó la cuenta suelta (órdenes, remitos) pasa a quedar a nombre del destino.
      // (articulos.actualizado_por no se toca: su disparador cambiaría la fecha de modificación.)
      case "unir_cuentas": {
        const origen = await perfilDe(String(body.origen ?? ""));
        const destino = await perfilDe(String(body.destino ?? ""));
        exigir(origen.id !== destino.id, "Elegí dos usuarios distintos");
        exigir(origen.clerk_id && !origen.auth_id, "El origen tiene que ser una cuenta Cindy sin usuario propio");
        exigir(destino.auth_id && !destino.clerk_id, "El destino tiene que ser un usuario propio sin cuenta Cindy");
        exigir(origen.id !== yo.id, "No podés unir la cuenta con la que estás adentro; hacelo desde otra cuenta de admin");
        const { error: e1 } = await admin.from("perfiles").update({ clerk_id: null }).eq("id", origen.id);
        if (e1) throw e1;
        const { error: e2 } = await admin.from("perfiles").update({ clerk_id: origen.clerk_id }).eq("id", destino.id);
        if (e2) {
          await admin.from("perfiles").update({ clerk_id: origen.clerk_id }).eq("id", origen.id);
          throw e2;
        }
        for (const [tabla, col] of [["ordenes_compra", "cargado_por"], ["remitos", "cargado_por"]]) {
          const { error } = await admin.from(tabla).update({ [col]: destino.id }).eq(col, origen.id);
          if (error) throw error;
        }
        await admin.from("preferencias").delete().eq("usuario_id", origen.id);
        const { error: e3 } = await admin.from("perfiles").delete().eq("id", origen.id);
        if (e3) throw e3;
        return respuesta({ ok: true });
      }

      default:
        return respuesta({ error: "Acción desconocida" }, 400);
    }
  } catch (e) {
    const status = e instanceof ErrorUsuario ? e.status : 400;
    const mensaje = traducir(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    return respuesta({ error: mensaje }, status);
  }
});
