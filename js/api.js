// =====================================================================
//  Única capa de datos: todo lo que habla con Supabase pasa por acá.
//  Las vistas nunca llaman a Supabase directo.
//  (Para probar sin base: pruebas/api-falsa.js reemplaza este objeto.)
// =====================================================================
(function (R) {
  // Datos web del artículo que se pueden editar desde la planilla
  const CAMPOS_ARTICULO = ["tipo", "padre_codigo", "variantes", "cod_barra", "foto", "descripcion_ok", "cargado_web", "catalogo",
    "fecha_alta_web", "sin_stock", "observaciones", "titulo_web", "descripcion_web", "estado_descripcion", "ya_no_esta"];
  let sb = null;

  function configurado() {
    const c = window.COMPRAS_CONFIG || {};
    return /^https:\/\/\S+$/.test(c.supabaseUrl || "") && (c.supabaseKey || "").length > 20;
  }

  function iniciar() {
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("No se pudo cargar la librería de Supabase. Revisá la conexión a internet.");
    }
    const c = window.COMPRAS_CONFIG;
    sb = window.supabase.createClient(c.supabaseUrl.replace(/\/+$/, ""), c.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "compras.sesion" },
    });
  }

  // Errores de Supabase -> mensajes para el usuario
  function mensaje(error) {
    const m = (error && (error.message || error.error_description)) || String(error);
    if (/Invalid login credentials/i.test(m)) return "Usuario o contraseña incorrectos.";
    if (/banned/i.test(m)) return "Tu usuario está desactivado. Hablá con un admin.";
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "No hay conexión con la base de datos. Revisá internet.";
    if (/row-level security|permission denied/i.test(m)) return "No tenés permiso para hacer esto.";
    if (/JWT expired/i.test(m)) return "La sesión venció. Volvé a ingresar.";
    if (/violates foreign key/i.test(m)) return "No se puede: hay datos relacionados que dependen de esto.";
    if (/cancelada_check|cancelada <= cantidad/i.test(m)) return "No se pueden cancelar más unidades de las pedidas.";
    return m;
  }

  function chequear({ data, error }) {
    if (error) throw new Error(mensaje(error));
    return data;
  }

  // Trae todas las filas (Supabase devuelve de a 1000)
  async function todo(consulta) {
    const filas = [], LOTE = 1000;
    for (let desde = 0; ; desde += LOTE) {
      const lote = chequear(await consulta().range(desde, desde + LOTE - 1));
      filas.push(...lote);
      if (lote.length < LOTE) return filas;
    }
  }

  // Los numeric de Postgres llegan como texto en algunos casos: se pasan a número
  const NUMEROS = ["cantidad", "recibido", "pendiente", "cancelada", "precio_unitario", "total", "sin_orden", "dias_desde_orden", "dias_atraso"];
  const numeros = filas => filas.map(f => { NUMEROS.forEach(k => { if (f[k] != null) f[k] = Number(f[k]); }); return f; });

  // ---------- Sesión ----------
  const auth = {
    async ingresar(usuario, password) {
      chequear(await sb.auth.signInWithPassword({ email: R.util.aEmail(usuario), password }));
    },
    async salir() { await sb.auth.signOut(); },
    async sesion() { const { data } = await sb.auth.getSession(); return data.session; },
    alCambiar(cb) { sb.auth.onAuthStateChange((evento, sesion) => cb(evento, sesion)); },
    async miPerfil() {
      const s = await auth.sesion();
      if (!s) return null;
      return chequear(await sb.from("perfiles").select("id, email, nombre, rol, activo").eq("id", s.user.id).maybeSingle());
    },
  };

  // ---------- Carga de documentos (el cruce lo hace la base) ----------
  // confirmar = false: la base hace todo, devuelve cómo quedaría y lo deshace
  const documentos = {
    async cargar(doc, confirmar) {
      const fn = doc.tipo === "orden_compra" ? "cargar_orden_compra" : "cargar_remito";
      return chequear(await sb.rpc(fn, { p_doc: doc, p_confirmar: !!confirmar }));
    },
  };

  // ---------- Consultas ----------
  const vistas = {
    pendientes: () => todo(() => sb.from("v_pendientes").select("*").order("fecha_orden").order("orden").order("renglon")).then(numeros),
    lineas: () => todo(() => sb.from("v_oc_lineas").select("*").order("fecha_orden", { ascending: false }).order("orden").order("renglon")).then(numeros),
    planilla: () => todo(() => sb.from("v_planilla").select("*").order("fecha_orden", { ascending: false }).order("orden").order("codigo")).then(numeros),
    sobrantes: () => todo(() => sb.from("v_sobrantes").select("*").order("fecha", { ascending: false })).then(numeros),
  };

  // ---------- Órdenes de compra y remitos ----------
  const ordenes = {
    listar: () => todo(() => sb.from("ordenes_compra")
      .select("id, numero, fecha, proveedor_id, vencimiento, comprador, descuento_porcentaje, total, modalidad_facturacion, cerrada, motivo_cierre, observaciones, creado_en, proveedores(nombre, nombre_corto, cuit)")
      .order("fecha", { ascending: false }).order("numero", { ascending: false })),
    async actualizar(id, d) { chequear(await sb.from("ordenes_compra").update(d).eq("id", id)); },
    async eliminar(id) { chequear(await sb.from("ordenes_compra").delete().eq("id", id)); },
    async cancelarUnidades(lineaId, cancelada) { chequear(await sb.from("oc_lineas").update({ cancelada }).eq("id", lineaId)); },
  };

  const remitos = {
    listar: () => todo(() => sb.from("remitos")
      .select("id, numero, fecha, proveedor_id, total, creado_en, proveedores(nombre, nombre_corto, cuit), remito_lineas(cantidad)")
      .order("fecha", { ascending: false }).order("numero", { ascending: false })),
    async eliminar(id) { chequear(await sb.from("remitos").delete().eq("id", id)); },
  };

  // ---------- Proveedores (nombre corto: Target, Bagcherry…) ----------
  const proveedores = {
    listar: () => todo(() => sb.from("proveedores").select("id, cuit, nombre, nombre_corto").order("nombre")),
    async actualizar(id, d) { chequear(await sb.from("proveedores").update({ nombre_corto: String(d.nombre_corto || "").trim() }).eq("id", id)); },
  };

  // ---------- Artículos (datos web) ----------
  // Deja solo los campos editables; "" -> null en fechas
  function limpiarArticulo(d) {
    const limpio = {};
    CAMPOS_ARTICULO.forEach(k => {
      if (d[k] === undefined) return;
      let v = d[k];
      if (typeof v === "string") v = v.trim();
      if (v === "" && /fecha|padre/.test(k)) v = null;
      limpio[k] = v;
    });
    return limpio;
  }

  const articulos = {
    // Un update sin permiso no da error en Supabase (RLS): cambia 0 filas. Por eso se cuentan.
    async actualizar(codigo, d) {
      const hechas = chequear(await sb.from("articulos").update(limpiarArticulo(d)).eq("codigo", codigo).select("codigo"));
      if (!hechas.length) throw new Error("No se guardó: no tenés permiso o el artículo ya no existe.");
    },
    // Marcar o desmarcar una casilla en varios artículos juntos (de a 200 códigos por pedido)
    async actualizarVarios(codigos, d) {
      const datos = limpiarArticulo(d);
      for (let i = 0; i < codigos.length; i += 200) {
        const lote = codigos.slice(i, i + 200);
        const hechas = chequear(await sb.from("articulos").update(datos).in("codigo", lote).select("codigo"));
        if (hechas.length < lote.length) throw new Error(`Se guardaron ${i + hechas.length} de ${codigos.length}: no tenés permiso o algún artículo ya no existe.`);
      }
    },
  };

  // ---------- Preferencias del usuario (columnas ocultas) ----------
  const preferencias = {
    async obtener() {
      const f = chequear(await sb.from("preferencias").select("columnas_ocultas").maybeSingle());
      return f ? f.columnas_ocultas : null;
    },
    async guardar(columnasOcultas) {
      const s = await auth.sesion();
      chequear(await sb.from("preferencias").upsert({ usuario_id: s.user.id, columnas_ocultas: columnasOcultas, actualizado_en: new Date().toISOString() }));
    },
  };

  // ---------- Usuarios (Edge Function, solo admin) ----------
  const usuarios = {
    async llamar(accion, datos = {}) {
      const nombre = (window.COMPRAS_CONFIG || {}).funcionUsuarios || "admin-usuarios";
      const { data, error } = await sb.functions.invoke(nombre, { body: { accion, ...datos } });
      if (error) {
        let m = error.message;
        try { const j = await error.context.json(); if (j && j.error) m = j.error; } catch (e) {}
        if (/Failed to send a request/i.test(m)) m = `No se pudo contactar la función "${nombre}". ¿Está publicada con ese nombre? (js/config.js → funcionUsuarios)`;
        if (/Invalid JWT|UNAUTHORIZED/i.test(m)) m = "La función rechazó la sesión. En Supabase → Edge Functions → la función → desactivar \"Verify JWT\" (la función igual verifica la sesión por su cuenta).";
        throw new Error(mensaje({ message: m }));
      }
      if (data && data.error) throw new Error(data.error);
      return data;
    },
    listar: () => usuarios.llamar("listar").then(r => r.usuarios),
    crear: d => usuarios.llamar("crear", d),
    cambiarRol: (id, rol) => usuarios.llamar("cambiar_rol", { id, rol }),
    activar: id => usuarios.llamar("activar", { id }),
    desactivar: id => usuarios.llamar("desactivar", { id }),
    resetearPassword: (id, password) => usuarios.llamar("resetear_password", { id, password }),
  };

  R.api = { configurado, iniciar, auth, documentos, vistas, ordenes, remitos, proveedores, articulos, preferencias, usuarios };
})(window.COMPRAS);
