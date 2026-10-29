// =====================================================================
//  Base FALSA en memoria para probar la pantalla sin Supabase.
//  Solo se carga en la PC (localhost o archivo) abriendo index.html?demo
//  (admin), ?demo=carga o ?demo=consulta. Proveedores y artículos
//  INVENTADOS. Imita lo que hace la base: el cruce OC ↔ remito (de la OC
//  más vieja a la más nueva), las OC cerradas y las unidades canceladas.
//  En el servidor esta carpeta está bloqueada por .htaccess.
// =====================================================================
(function (R) {
  const rol = (location.search.match(/[?&]demo=(carga|consulta)\b/) || [])[1] || "admin";
  const copia = x => JSON.parse(JSON.stringify(x));
  const espera = v => new Promise(ok => setTimeout(() => ok(copia(v)), 120));
  let sec = 100;
  const nuevoId = () => ++sec;
  const hoyISO = R.util.hoy;
  const restarDias = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const dias = iso => Math.round((new Date(hoyISO() + "T00:00:00Z") - new Date(iso + "T00:00:00Z")) / 86400000);
  const sinPermiso = () => { throw new Error("No tenés permiso para hacer esto."); };
  // Mientras se arman los datos iniciales no se controla el rol (si no, ?demo=consulta no tendría datos)
  let sembrando = true;
  const puedeCargar = () => sembrando || rol !== "consulta";

  const perfil = { id: "u1", email: "demo@compras.cindymayorista.com.ar", nombre: "Usuario demo", rol, activo: true };
  const proveedores = [];
  const articulos = new Map();
  const ordenes = [], lineas = [], remitos = [], remLineas = [], recepciones = [];
  let ocultas = null;
  // Catálogo de colores (como el de la base)
  const colores = [["WHI", "Blanco"], ["GRE", "Verde"], ["BLU", "Azul"], ["NUD", "Nude"], ["NEG", "Negro"], ["BEI", "Beige"], ["SUE", "Suela"], ["ROJ", "Rojo"]]
    .map(([codigo, nombre], i) => ({ id: i + 1, codigo, nombre, activo: true }));
  const hijos = codigo => [...articulos.values()].filter(a => a.padre_codigo === codigo).sort((a, b) => a.codigo.localeCompare(b.codigo));
  const colorDe = a => colores.find(c => c.id === a.color_id) || {};
  // Como el trigger de la base: al marcar "Cargado web" se completa la fecha de alta (solo si estaba vacía)
  function guardarArticulo(codigo, d) {
    const a = articulos.get(codigo), antes = a.cargado_web;
    Object.assign(a, d);
    if (a.cargado_web && !antes && !a.fecha_alta_web) a.fecha_alta_web = hoyISO();
    return { codigo, fecha_alta_web: a.fecha_alta_web };
  }

  function proveedor(cuit, nombre) {
    let p = proveedores.find(x => x.cuit === cuit);
    if (!p) { p = { id: nuevoId(), cuit, nombre: nombre || cuit, nombre_corto: "" }; proveedores.push(p); }
    return p;
  }
  // Como en las vistas: el nombre corto o, si no tiene, la razón social
  const alias = p => (p.nombre_corto || "").trim() || p.nombre;
  const recibido = l => recepciones.filter(r => r.oc_linea_id === l.id).reduce((a, r) => a + r.cantidad, 0);

  // ---------- Lo mismo que aplicar_orden_compra / aplicar_remito ----------
  function aplicarOC(doc) {
    if (!puedeCargar()) throw new Error("No tenés permiso para cargar documentos");
    if (ordenes.some(o => o.numero === doc.numero)) throw new Error(`La orden de compra ${doc.numero} ya está cargada`);
    const p = proveedor(doc.cuit, doc.proveedor), t = doc.totales || {};
    const o = { id: nuevoId(), numero: doc.numero, proveedor_id: p.id, fecha: doc.fecha, vencimiento: doc.vencimiento || null,
      comprador: doc.comprador || "", descuento_porcentaje: doc.descuento_porcentaje, total: t.Total ?? null,
      modalidad_facturacion: null, cerrada: false, motivo_cierre: "", observaciones: "", creado_en: new Date().toISOString() };
    ordenes.push(o);
    let nuevos = 0;
    doc.lineas.forEach((l, i) => {
      if (!articulos.has(l.codigo)) {
        nuevos++;
        articulos.set(l.codigo, { codigo: l.codigo, descripcion: l.descripcion || "", proveedor_id: p.id, tipo: "PADRE", padre_codigo: null,
          variantes: "", cod_barra: "", foto: false, descripcion_ok: false, cargado_web: false, catalogo: false, fecha_alta_web: null,
          sin_stock: false, observaciones: "", titulo_web: "", descripcion_web: "", estado_descripcion: "", ya_no_esta: false });
      }
      lineas.push({ id: nuevoId(), orden_id: o.id, renglon: i + 1, codigo: l.codigo, descripcion: l.descripcion || "", cantidad: l.cantidad,
        precio_unitario: l.precio_unitario ?? null, total: l.total ?? null,
        fecha_entrega: ((l.plan_entrega || [])[0] || {}).fecha || doc.fecha, cancelada: 0 });
    });
    return { tipo: "orden_compra", orden_id: o.id, numero: doc.numero, proveedor_id: p.id, lineas: doc.lineas.length, articulos_nuevos: nuevos };
  }

  function aplicarRemito(doc) {
    if (!puedeCargar()) throw new Error("No tenés permiso para cargar documentos");
    const p = proveedor(doc.cuit, doc.proveedor);
    if (remitos.some(r => r.proveedor_id === p.id && r.numero === doc.numero)) throw new Error(`El remito ${doc.numero} de este proveedor ya está cargado`);
    const rem = { id: nuevoId(), numero: doc.numero, proveedor_id: p.id, fecha: doc.fecha, total: doc.total ?? null, creado_en: new Date().toISOString() };
    remitos.push(rem);
    const salida = [], tocadas = new Set();
    doc.lineas.forEach((l, i) => {
      const rl = { id: nuevoId(), remito_id: rem.id, renglon: i + 1, codigo: l.codigo, descripcion: l.descripcion || "", cantidad: l.cantidad };
      remLineas.push(rl);
      let resto = l.cantidad;
      const asignado = [];
      lineas.filter(x => x.codigo === l.codigo).map(x => ({ x, o: ordenes.find(o => o.id === x.orden_id) }))
        .filter(({ o }) => o.proveedor_id === p.id && !o.cerrada)
        .sort((a, b) => a.o.fecha.localeCompare(b.o.fecha) || a.o.numero.localeCompare(b.o.numero) || a.x.renglon - b.x.renglon)
        .forEach(({ x, o }) => {
          const pendiente = x.cantidad - x.cancelada - recibido(x);
          if (resto <= 0 || pendiente <= 0) return;
          const toma = Math.min(resto, pendiente);
          recepciones.push({ id: nuevoId(), remito_linea_id: rl.id, oc_linea_id: x.id, cantidad: toma });
          asignado.push({ orden: o.numero, cantidad: toma });
          tocadas.add(o.id);
          resto -= toma;
        });
      salida.push({ codigo: l.codigo, cantidad: l.cantidad, asignado, sin_orden: resto });
    });
    const ocs = [...tocadas].map(id => ordenes.find(o => o.id === id)).sort((a, b) => a.numero.localeCompare(b.numero))
      .map(o => ({ orden: o.numero, pendiente: vLineas().filter(v => v.orden_id === o.id).reduce((a, v) => a + v.pendiente, 0) }));
    return { tipo: "remito_ingreso", remito_id: rem.id, numero: doc.numero, proveedor_id: p.id, lineas: salida,
      sin_orden: salida.filter(s => s.sin_orden > 0), ordenes: ocs };
  }

  // Simulación: se guarda una foto de todo, se aplica y se vuelve atrás
  function cargar(doc, confirmar) {
    const foto = copia({ proveedores, ordenes, lineas, remitos, remLineas, recepciones, articulos: [...articulos.entries()], sec });
    const r = doc.tipo === "orden_compra" ? aplicarOC(doc) : aplicarRemito(doc);
    if (!confirmar) {
      [proveedores, ordenes, lineas, remitos, remLineas, recepciones].forEach((arr, i) => {
        arr.splice(0, arr.length, ...foto[["proveedores", "ordenes", "lineas", "remitos", "remLineas", "recepciones"][i]]);
      });
      articulos.clear(); foto.articulos.forEach(([k, v]) => articulos.set(k, v));
      sec = foto.sec;
    }
    return { ...r, confirmado: !!confirmar };
  }

  // ---------- Lo mismo que las vistas v_oc_lineas / v_planilla / v_sobrantes ----------
  function vLineas() {
    return lineas.map(l => {
      const o = ordenes.find(x => x.id === l.orden_id), p = proveedores.find(x => x.id === o.proveedor_id);
      const rec = recibido(l), falta = Math.max(l.cantidad - l.cancelada - rec, 0);
      const recs = recepciones.filter(r => r.oc_linea_id === l.id).map(r => remitos.find(m => m.id === remLineas.find(x => x.id === r.remito_linea_id).remito_id).fecha);
      const estado = falta <= 0 ? (rec ? "completa" : "cancelada") : o.cerrada ? "cerrada" : rec ? "parcial" : "pendiente";
      return { ...l, orden: o.numero, fecha_orden: o.fecha, proveedor_id: p.id, proveedor: alias(p), razon_social: p.nombre, cuit: p.cuit,
        recibido: rec, pendiente: falta, ultima_recepcion: recs.sort().pop() || null, estado,
        dias_desde_orden: dias(o.fecha), dias_atraso: Math.max(dias(l.fecha_entrega || o.fecha), 0), cerrada: o.cerrada };
    }).sort((a, b) => b.fecha_orden.localeCompare(a.fecha_orden) || a.orden.localeCompare(b.orden) || a.renglon - b.renglon);
  }

  // ---------- Datos iniciales (inventados) ----------
  const docOC = (numero, fecha, cuit, nombre, items) => ({ tipo: "orden_compra", numero, fecha, cuit, proveedor: nombre, comprador: "Compras",
    descuento_porcentaje: 50, totales: { Total: items.reduce((a, [, , c, pu]) => a + c * pu, 0) / 2 },
    lineas: items.map(([codigo, descripcion, cantidad, precio_unitario]) => ({ codigo, descripcion, cantidad, precio_unitario, total: cantidad * precio_unitario, plan_entrega: [{ fecha, cantidad }] })) });
  const docRem = (numero, fecha, cuit, nombre, items) => ({ tipo: "remito_ingreso", numero, fecha, cuit, proveedor: nombre, total: null,
    lineas: items.map(([codigo, cantidad]) => ({ codigo, descripcion: "", cantidad, costo: null })) });
  const P1 = ["30000000011", "PROVEEDOR DEMO UNO S.A."], P2 = ["30000000022", "DISTRIBUIDORA EJEMPLO SRL"];
  cargar(docOC("3333-00009001", restarDias(32), ...P1, [["DEMO101", "MOCHILA DE PRUEBA AZUL", 48, 12000], ["DEMO102", "MOCHILA DE PRUEBA ROJA", 48, 12000], ["DEMO103", "CARTUCHERA EJEMPLO", 120, 3500]]), true);
  cargar(docOC("3333-00009002", restarDias(9), ...P2, [["EJ-501", "TERMO INVENTADO 1L", 36, 15000], ["EJ-502", "BOTELLA DEMO 600ML", 60, 8000]]), true);
  cargar(docOC("3333-00009003", restarDias(4), ...P1, [["DEMO101", "MOCHILA DE PRUEBA AZUL", 24, 12500]]), true);
  cargar(docRem("0001-00000101", restarDias(20), ...P1, [["DEMO101", 60], ["DEMO103", 120], ["DEMO999", 6]]), true);
  cargar(docRem("0002-00000202", restarDias(2), ...P2, [["EJ-501", 36], ["EJ-502", 20]]), true);
  sembrando = false;
  proveedores.find(p => p.cuit === P1[0]).nombre_corto = "Demo Uno"; // el otro queda sin nombre corto, para ver el aviso
  Object.assign(articulos.get("DEMO103"), { foto: true, descripcion_ok: true, cargado_web: true, titulo_web: "Cartuchera de ejemplo por mayor", descripcion_web: "Texto de prueba de la descripción web." });

  const usuarios = [
    { id: "u1", email: perfil.email, nombre: perfil.nombre, rol, activo: true, soy_yo: true, ultimo_ingreso: new Date().toISOString() },
    { id: "u2", email: "carga.demo@compras.cindymayorista.com.ar", nombre: "Carga de prueba", rol: "carga", activo: true, soy_yo: false, ultimo_ingreso: null },
  ];

  R.api = {
    configurado: () => true,
    iniciar: () => {},
    auth: {
      ingresar: async () => {}, salir: async () => {}, sesion: async () => ({ user: { id: perfil.id } }),
      alCambiar: () => {}, miPerfil: () => espera(perfil),
    },
    documentos: { cargar: async (doc, confirmar) => { await espera(null); return copia(cargar(copia(doc), confirmar)); } },
    vistas: {
      pendientes: () => espera(vLineas().filter(v => ["pendiente", "parcial"].includes(v.estado)).sort((a, b) => a.fecha_orden.localeCompare(b.fecha_orden))),
      lineas: () => espera(vLineas()),
      // Cada artículo seguido de sus variantes (que no traen cantidades), como v_planilla
      planilla: () => espera(vLineas().flatMap(v => {
        const a = articulos.get(v.codigo), c = colorDe(a);
        const fila = { ...a, ...v, nombre: a.descripcion || v.descripcion, oc_linea_id: v.id, padre: a.padre_codigo || a.codigo,
          es_variante: a.tipo === "VARIANTE", n_variantes: hijos(a.codigo).length, color: c.nombre || null, color_codigo: c.codigo || null };
        const hijas = hijos(a.codigo).map(x => ({ ...x, orden: v.orden, fecha_orden: v.fecha_orden, proveedor: v.proveedor, razon_social: v.razon_social,
          estado: v.estado, ultima_recepcion: v.ultima_recepcion, dias_desde_orden: v.dias_desde_orden, dias_atraso: v.dias_atraso,
          cantidad: null, precio_unitario: null, recibido: null, pendiente: null, oc_linea_id: v.id, orden_id: v.orden_id,
          nombre: x.descripcion, padre: a.codigo, es_variante: true, n_variantes: 0, color: colorDe(x).nombre, color_codigo: colorDe(x).codigo }));
        return [fila, ...hijas];
      })),
      sobrantes: () => espera(remLineas.map(rl => {
        const m = remitos.find(x => x.id === rl.remito_id);
        const sin = rl.cantidad - recepciones.filter(r => r.remito_linea_id === rl.id).reduce((a, r) => a + r.cantidad, 0);
        const pv = proveedores.find(p => p.id === m.proveedor_id);
        return { remito_id: m.id, remito: m.numero, fecha: m.fecha, proveedor: alias(pv), razon_social: pv.nombre,
          codigo: rl.codigo, descripcion: rl.descripcion, cantidad: rl.cantidad, sin_orden: sin };
      }).filter(s => s.sin_orden > 0)),
    },
    ordenes: {
      listar: () => espera(ordenes.map(o => ({ ...o, proveedores: proveedores.find(p => p.id === o.proveedor_id) }))
        .sort((a, b) => b.fecha.localeCompare(a.fecha))),
      actualizar: async (id, d) => { if (!puedeCargar()) sinPermiso(); Object.assign(ordenes.find(o => o.id === id), d); },
      eliminar: async id => {
        if (rol !== "admin") sinPermiso();
        const ids = lineas.filter(l => l.orden_id === id).map(l => l.id);
        recepciones.splice(0, recepciones.length, ...recepciones.filter(r => !ids.includes(r.oc_linea_id)));
        lineas.splice(0, lineas.length, ...lineas.filter(l => l.orden_id !== id));
        ordenes.splice(ordenes.findIndex(o => o.id === id), 1);
      },
      cancelarUnidades: async (id, n) => { if (!puedeCargar()) sinPermiso(); lineas.find(l => l.id === id).cancelada = n; },
    },
    remitos: {
      listar: () => espera(remitos.map(r => ({ ...r, proveedores: proveedores.find(p => p.id === r.proveedor_id),
        remito_lineas: remLineas.filter(l => l.remito_id === r.id).map(l => ({ cantidad: l.cantidad })) })).sort((a, b) => b.fecha.localeCompare(a.fecha))),
      eliminar: async id => {
        if (rol !== "admin") sinPermiso();
        const ids = remLineas.filter(l => l.remito_id === id).map(l => l.id);
        recepciones.splice(0, recepciones.length, ...recepciones.filter(r => !ids.includes(r.remito_linea_id)));
        remLineas.splice(0, remLineas.length, ...remLineas.filter(l => l.remito_id !== id));
        remitos.splice(remitos.findIndex(r => r.id === id), 1);
      },
    },
    proveedores: {
      listar: () => espera([...proveedores].sort((a, b) => a.nombre.localeCompare(b.nombre))),
      actualizar: async (id, d) => { if (!puedeCargar()) sinPermiso(); proveedores.find(p => p.id === id).nombre_corto = String(d.nombre_corto || "").trim(); },
    },
    articulos: {
      actualizar: async (codigo, d) => { if (!puedeCargar()) sinPermiso(); return guardarArticulo(codigo, d); },
      actualizarVarios: async (codigos, d) => { if (!puedeCargar()) sinPermiso(); await espera(null); return codigos.map(c => guardarArticulo(c, d)); },
      crearVariantes: async (padre, ids) => {
        if (!puedeCargar()) throw new Error("No tenés permiso para crear variantes");
        const p = articulos.get(padre);
        if (!p) throw new Error("El artículo " + padre + " no existe");
        if (p.tipo === "VARIANTE") throw new Error("Una variante no puede tener variantes: elegí el artículo principal (" + p.padre_codigo + ")");
        if (!ids.length) throw new Error("Elegí al menos un color");
        const creadas = [], existentes = [], omitidas = [];
        colores.filter(c => ids.includes(c.id)).sort((a, b) => a.codigo.localeCompare(b.codigo)).forEach(c => {
          const codigo = padre + "-" + c.codigo, ya = articulos.get(codigo);
          if (ya && ya.padre_codigo === padre && ya.color_id === c.id) existentes.push(codigo);
          else if (ya) omitidas.push(codigo);
          else {
            articulos.set(codigo, { ...p, codigo, descripcion: (p.descripcion + " " + c.nombre.toUpperCase()).trim(), tipo: "VARIANTE", padre_codigo: padre, color_id: c.id,
              variantes: "", foto: false, descripcion_ok: false, cargado_web: false, catalogo: false, fecha_alta_web: null, sin_stock: false,
              observaciones: "", titulo_web: "", descripcion_web: "", estado_descripcion: "", ya_no_esta: false });
            creadas.push(codigo);
          }
        });
        p.tipo = "PADRE";
        p.variantes = hijos(padre).map(h => colorDe(h).codigo).filter(Boolean).sort().join(", ");
        await espera(null);
        return { creadas, existentes, omitidas };
      },
    },
    colores: {
      listar: () => espera([...colores].sort((a, b) => a.nombre.localeCompare(b.nombre))),
      crear: async (codigo, nombre) => {
        if (!puedeCargar()) sinPermiso();
        codigo = String(codigo).trim().toUpperCase();
        if (!/^[A-Z0-9]{2,5}$/.test(codigo)) throw new Error("El sufijo tiene que ser de 2 a 5 letras o números, sin espacios (ej. WHI).");
        if (colores.some(c => c.codigo === codigo)) throw new Error("Ya hay un color con ese sufijo.");
        const c = { id: nuevoId(), codigo, nombre: String(nombre).trim(), activo: true }; colores.push(c); return copia(c);
      },
      actualizar: async (id, d) => { if (!puedeCargar()) sinPermiso(); Object.assign(colores.find(c => c.id === id), d); },
    },
    preferencias: { obtener: () => espera(ocultas), guardar: async c => { ocultas = c; } },
    usuarios: {
      listar: () => espera(usuarios),
      crear: async d => { usuarios.push({ id: "u" + nuevoId(), email: d.usuario, nombre: d.nombre, rol: d.rol, activo: true, soy_yo: false, ultimo_ingreso: null }); },
      cambiarRol: async (id, r) => { usuarios.find(u => u.id === id).rol = r; },
      activar: async id => { usuarios.find(u => u.id === id).activo = true; },
      desactivar: async id => { usuarios.find(u => u.id === id).activo = false; },
      resetearPassword: async () => {},
    },
  };
  console.info("Compras: modo DEMO con datos inventados (" + rol + ").");
})(window.COMPRAS);
