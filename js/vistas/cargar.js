// =====================================================================
//  Vista: Cargar documentos. Cada .xls de Manager se lee en el
//  navegador (js/lector-manager.js), la base simula la carga y muestra
//  cómo va a quedar, y recién con "Guardar" se graba.
//  Antes de guardar se puede cambiar el número del documento (se sugiere el
//  que trae) y, en un remito, elegir a qué orden de compra va (o dejar que se
//  reparta solo). Lo guardado se puede deshacer. No deja repetir un documento
//  que ya está en la lista.
// =====================================================================
(function (R) {
  const { $, esc, toast, fmtFecha, fmtNum, fmtPesos, plural, ICONOS, etiquetaProveedor } = R.util;
  // Un documento por tarjeta: { id, archivo, doc, error, simulacion, estado: "previa" | "guardado" | "error" }
  let tarjetas = [];
  let sec = 0;
  // Proveedores ya cargados, para mostrar el nombre corto (Target, Bagcherry…) y pedirlo si falta
  let proveedores = [];
  const soloDigitos = s => String(s || "").replace(/\D/g, "");
  const claveNombre = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, ""); // igual que clave_nombre de la base
  const cuitValido = c => /^\d{11}$/.test(String(c || ""));
  // El proveedor de un documento, como lo resuelve la base: por CUIT; sin CUIT (o si ese CUIT todavía no está), por nombre
  const proveedorDe = d => {
    if (!d) return null;
    const c = soloDigitos(d.cuit), k = claveNombre(d.proveedor);
    return (c && proveedores.find(p => p.cuit === c)) || (k && proveedores.find(p => (!c || !p.cuit) && claveNombre(p.nombre) === k)) || null;
  };
  async function recargarProveedores() {
    try { proveedores = await R.api.proveedores.listar(); R.vistaProveedores.pintarContador(proveedores); }
    catch (e) { /* sin nombres cortos se muestra la razón social */ }
  }

  async function leerArchivo(archivo) {
    const datos = await archivo.arrayBuffer();
    const libro = XLSX.read(datos, { type: "array" });
    const doc = LectorManager.leerDocumento(XLSX, libro);
    doc.archivo = archivo.name;
    return doc;
  }

  // Un documento es "el mismo" si coinciden tipo, proveedor y número
  const claveDoc = d => (d ? [d.tipo, soloDigitos(d.cuit) || "N:" + claveNombre(d.proveedor), String(d.numero || "").trim()].join("|") : "");
  const repetida = t => !!(t.doc && t.doc.numero && tarjetas.some(o => o !== t && o.estado !== "error" && o.doc && claveDoc(o.doc) === claveDoc(t.doc)));
  const RE_OC = /^\d{4}-\d{8}$/;

  async function agregarArchivos(lista) {
    await recargarProveedores();
    const nuevas = [], repetidos = [];
    for (const archivo of lista) {
      const t = { id: ++sec, archivo: archivo.name, doc: null, error: "", simulacion: null, estado: "previa", numeroOriginal: "", ordenesOpc: [], modoManual: false };
      try { t.doc = await leerArchivo(archivo); t.numeroOriginal = t.doc.numero || ""; }
      catch (e) { t.error = e.message; t.estado = "error"; }
      // Si ese mismo documento ya está en la lista (o venía dos veces en la selección), no se agrega de nuevo
      const igual = t.doc && [...tarjetas, ...nuevas].find(o => o.doc && claveDoc(o.doc) === claveDoc(t.doc));
      if (igual) { repetidos.push(`"${archivo.name}" (${t.doc.tipo === "orden_compra" ? "orden" : "remito"} ${t.doc.numero}) repite a "${igual.archivo}"`); continue; }
      nuevas.push(t);
    }
    if (repetidos.length) toast(`No se agregó: ${repetidos.join("; ")}.`, "error", 8000);
    if (!nuevas.length) return;
    // Primero las órdenes de compra, después los remitos (el remito se cruza con las OC)
    nuevas.sort((a, b) => orden(a) - orden(b));
    tarjetas = [...nuevas, ...tarjetas];
    pintar();
    for (const t of nuevas) { cargarOrdenesAbiertas(t); await simular(t); }
  }

  // Órdenes abiertas del proveedor (para elegir a cuál va un remito)
  async function cargarOrdenesAbiertas(t) {
    const p = proveedorDe(t.doc);
    if (!t.doc || t.doc.tipo !== "remito_ingreso" || !p) return;
    try {
      const lineas = await R.api.asignaciones.lineasAbiertas(p.id), por = new Map();
      for (const l of lineas) {
        const o = por.get(l.orden) || por.set(l.orden, { orden: l.orden, fecha: l.fecha_orden, pendiente: 0, articulos: 0, coincide: 0 }).get(l.orden);
        o.pendiente += l.pendiente; o.articulos++;
        if (t.doc.lineas.some(x => x.codigo === l.codigo)) o.coincide++;
      }
      // Primero las que tienen artículos de este remito
      t.ordenesOpc = [...por.values()].sort((a, b) => b.coincide - a.coincide || a.orden.localeCompare(b.orden));
      pintarTarjeta(t);
    } catch (e) { /* sin sugerencias: se puede escribir el número igual */ }
  }

  // Número del documento: se sugiere el que trae y se puede cambiar
  function cambiarNumero(t, valor) {
    valor = String(valor).trim();
    t.errorNumero = "";
    if (!valor) t.errorNumero = "Escribí el número.";
    else if (t.doc.tipo === "orden_compra" && !RE_OC.test(valor)) t.errorNumero = "El número de una orden tiene que tener el formato 0000-00000000.";
    if (t.errorNumero) return pintarTarjeta(t);
    t.doc.numero = valor;
    if (repetida(t)) { t.errorNumero = "Ya hay otro documento igual en la lista (mismo número y proveedor)."; t.simulacion = null; return pintarTarjeta(t); }
    simular(t);
  }

  // Remito: asignar solo o a una orden elegida
  function elegirOrden(t, valor) {
    valor = String(valor).trim();
    t.errorOrden = "";
    if (!valor) { delete t.doc.orden; return simular(t); }
    if (!t.ordenesOpc.some(o => o.orden === valor)) {
      t.errorOrden = "No hay una orden abierta de este proveedor con ese número: elegí una de la lista.";
      return pintarTarjeta(t);
    }
    t.doc.orden = valor;
    simular(t);
  }
  const orden = t => (t.doc && t.doc.tipo === "orden_compra" ? 0 : 1);

  async function simular(t) {
    if (!t.doc || t.estado === "guardado") return;
    if (repetida(t)) { t.simulacion = null; t.error = "Ya hay otro documento igual en la lista (mismo número y proveedor)."; t.estado = "error"; return pintarTarjeta(t); }
    t.error = "";
    t.estado = "previa";
    pintarTarjeta(t, true);
    try { t.simulacion = await R.api.documentos.cargar(t.doc, false); }
    catch (e) { t.simulacion = null; t.error = e.message; t.estado = "error"; }
    pintarTarjeta(t);
  }

  async function guardar(t, boton) {
    boton.disabled = true;
    try {
      t.simulacion = await R.api.documentos.cargar(t.doc, true);
      t.estado = "guardado";
      await recargarProveedores();
      const tipoTexto = t.doc.tipo === "orden_compra" ? "Orden de compra" : "Remito";
      // Deshacer: se borra lo recién cargado y la tarjeta vuelve a quedar para guardar
      t.deshacerId = R.deshacer.registrarConAviso(`${tipoTexto} ${t.doc.numero} guardado.`, {
        texto: `carga del ${tipoTexto.toLowerCase()} ${t.doc.numero}`,
        deshacer: async () => {
          await R.api.documentos.deshacer(t.doc.tipo, t.doc.tipo === "orden_compra" ? t.simulacion.orden_id : t.simulacion.remito_id);
          t.estado = "previa"; t.deshacerId = null;
          await recargarProveedores();
          await simular(t);
          for (const otra of tarjetas) if (otra !== t && otra.doc && otra.estado !== "guardado") await simular(otra);
        },
      });
      pintarTarjeta(t);
      // Lo que quedó sin guardar puede cambiar (ej. un remito que ahora encuentra su OC)
      for (const otra of tarjetas) if (otra !== t && otra.doc && otra.estado !== "guardado") await simular(otra);
    } catch (e) {
      toast(e.message, "error", 6000);
      boton.disabled = false;
    }
  }

  async function guardarNombreCorto(t, boton) {
    const p = proveedorDe(t.doc), valor = $("corto-" + t.id).value.trim();
    if (!p || !valor) return toast("Escribí el nombre corto.", "error");
    boton.disabled = true;
    try {
      await R.api.proveedores.actualizar(p.id, { nombre_corto: valor });
      await recargarProveedores();
      toast(`"${p.nombre}" ahora se muestra como "${valor}".`);
      tarjetas.forEach(x => pintarTarjeta(x)); // otras tarjetas del mismo proveedor también
    } catch (e) { toast(e.message, "error", 6000); boton.disabled = false; }
  }

  // ---------- Dibujo ----------
  function pintar() {
    $("cargar-lista").innerHTML = tarjetas.map(t => `<div class="caja doc-previa" id="tarjeta-${t.id}"></div>`).join("");
    tarjetas.forEach(t => pintarTarjeta(t));
  }

  function pintarTarjeta(t, simulando) {
    const el = $("tarjeta-" + t.id);
    if (!el) return;
    el.className = "caja doc-previa " + (t.estado === "error" ? "error" : t.estado === "guardado" ? "guardado" : "");
    const d = t.doc;
    const titulo = !d ? esc(t.archivo)
      : `${d.tipo === "orden_compra" ? "Orden de compra" : "Remito de ingreso"} ${esc(d.numero || "(sin número)")}`;
    const p = proveedorDe(d), corto = p && p.nombre_corto;
    const sub = d ? `${corto ? `<strong>${esc(p.nombre_corto)}</strong> · ` : ""}${esc(d.proveedor || "Proveedor sin nombre")} · CUIT ${esc(d.cuit || "—")}${cuitValido(d.cuit) ? "" : ` <span class="texto-alerta" title="Se guarda igual: al proveedor se lo identifica por ${d.cuit ? "ese número" : "su nombre"}">(CUIT no válido)</span>`} · ${fmtFecha(d.fecha)} · ${esc(t.archivo)}` : "";
    const acciones = t.estado === "guardado"
      ? `<span class="estado completa">Guardado</span>${t.deshacerId ? ` <button type="button" class="link peligro" data-deshacer-carga="${t.id}">Deshacer carga</button>` : ""}`
      : `<button type="button" class="link" data-quitar="${t.id}">Descartar</button>
         ${t.estado === "previa" && t.simulacion ? `<button type="button" class="btn-sec primario" data-guardar="${t.id}">${ICONOS.check} Guardar</button>` : ""}`;

    let cuerpo = "";
    // El proveedor ya existe en la base pero no tiene nombre corto: se pide acá mismo
    if (p && !corto && R.app.puedeCargar()) {
      cuerpo += `<div class="filtros" style="margin:4px 0 10px; padding:10px; background:var(--naranja-suave); border-radius:3px">
        <div style="flex:1; min-width:200px"><label for="corto-${t.id}">¿Cómo le dicen a este proveedor? (ej. Target, Bagcherry). Se puede cambiar después en Proveedores.</label>
          <input id="corto-${t.id}" maxlength="40" placeholder="Nombre corto"></div>
        <button type="button" class="btn-sec" data-nombre-corto="${t.id}">Guardar nombre</button></div>`;
    }
    if (d && d.avisos && d.avisos.length) {
      cuerpo += `<ul class="lista-avisos">${d.avisos.map(a => `<li>${esc(a)}</li>`).join("")}</ul>
        <p class="hint">Revisá el archivo: el lector encontró cosas que no cierran. Se puede guardar igual.</p>`;
    }
    if (t.error) cuerpo += `<ul class="lista-avisos"><li>${esc(t.error)}</li></ul>`;
    if (simulando) cuerpo += `<p class="cargando">Calculando cómo queda…</p>`;
    else if (d && t.simulacion) cuerpo += d.tipo === "orden_compra" ? cuerpoOC(d, t.simulacion, corto) : cuerpoRemito(d, t.simulacion, t.estado === "guardado", corto);

    // Número editable mientras no se guardó (se sugiere el del documento)
    let numero = "";
    if (d && t.estado !== "guardado" && R.app.puedeCargar()) {
      const cambiado = t.numeroOriginal && d.numero !== t.numeroOriginal;
      numero = `<div class="num-doc"><label for="num-${t.id}">Número</label>
        <input id="num-${t.id}" data-numero="${t.id}" value="${esc(d.numero || "")}" maxlength="40" placeholder="${d.tipo === "orden_compra" ? "0000-00000000" : "Número del remito"}">
        ${cambiado ? `<button type="button" class="link" data-numero-original="${t.id}">Usar el del documento (${esc(t.numeroOriginal)})</button>` : `<small>Sugerido: el que trae el documento</small>`}</div>
        ${t.errorNumero ? `<ul class="lista-avisos"><li>${esc(t.errorNumero)}</li></ul>` : ""}`;
    }
    // Remito: se reparte solo entre las órdenes abiertas o se elige a cuál va
    let asignar = "";
    if (d && d.tipo === "remito_ingreso" && t.estado !== "guardado" && R.app.puedeCargar()) {
      const manual = !!d.orden || t.modoManual;
      asignar = `<div class="asig-remito"><span class="asig-titulo">Asignar a</span>
          <label class="cat-check"><input type="radio" name="asig-${t.id}" value="auto" data-asig="${t.id}" ${manual ? "" : "checked"}> Automático (las órdenes abiertas, de la más vieja a la más nueva)</label>
          <label class="cat-check"><input type="radio" name="asig-${t.id}" value="manual" data-asig="${t.id}" ${manual ? "checked" : ""}> Elegir la orden</label>
          <input id="orden-${t.id}" data-orden="${t.id}" list="dl-${t.id}" value="${esc(d.orden || "")}" placeholder="Buscar por número de orden…" autocomplete="off" ${manual ? "" : "disabled"}>
          <datalist id="dl-${t.id}">${(t.ordenesOpc || []).map(o => `<option value="${esc(o.orden)}">${fmtFecha(o.fecha)} · ${fmtNum(o.pendiente)} unidades pendientes${o.coincide ? ` · ${o.coincide} de este remito` : ""}</option>`).join("")}</datalist>
          ${t.errorOrden ? `<span class="texto-alerta">${esc(t.errorOrden)}</span>` : (t.ordenesOpc || []).length ? "" : `<small class="hint">No hay órdenes abiertas de este proveedor: lo que llegue queda "sin orden" y se asigna después desde Pendientes.</small>`}</div>`;
    }
    el.innerHTML = `<div class="doc-cabecera"><div><h3>${titulo}</h3><p class="sub">${sub}</p>${numero}</div>
      <div class="acciones-fila">${acciones}</div></div>${asignar}${cuerpo}`;
  }

  function cuerpoOC(d, s, corto) {
    const unidades = d.lineas.reduce((a, l) => a + (l.cantidad || 0), 0);
    return `<div class="resumen-doc">
        <span><strong>${fmtNum(d.lineas.length)}</strong> artículos</span>
        <span><strong>${fmtNum(unidades)}</strong> unidades</span>
        <span><strong>${fmtNum(s.articulos_nuevos)}</strong> códigos nuevos en el sistema</span>
        <span>Descuento <strong>${fmtNum(d.descuento_porcentaje, 2)} %</strong></span>
        <span>Total <strong>${fmtPesos(d.totales && d.totales.Total)}</strong></span>
      </div>
      <div class="tabla-wrap" style="max-height:340px"><table class="tabla grilla">
        <thead><tr><th>Código</th><th>Descripción</th><th class="num">Cantidad</th><th class="num">P.U.</th><th class="num">Entrega</th></tr></thead>
        <tbody>${d.lineas.map(l => `<tr><td><strong>${esc(l.codigo)}</strong>${etiquetaProveedor(corto, d.proveedor)}</td><td>${esc(l.descripcion)}</td>
          <td class="num">${fmtNum(l.cantidad)}</td><td class="num">${fmtPesos(l.precio_unitario)}</td>
          <td class="num">${fmtFecha((l.plan_entrega[0] || {}).fecha || d.fecha)}</td></tr>`).join("")}</tbody>
      </table></div>`;
  }

  function cuerpoRemito(d, s, guardado, corto) {
    const asignadas = s.lineas.reduce((a, l) => a + l.asignado.reduce((b, x) => b + Number(x.cantidad), 0), 0);
    const sinOrden = s.lineas.reduce((a, l) => a + Number(l.sin_orden), 0);
    const ordenes = s.ordenes || [];
    return `<div class="resumen-doc">
        <span><strong>${fmtNum(asignadas)}</strong> unidades contra órdenes de compra</span>
        <span><strong class="${sinOrden ? "atrasado" : ""}">${fmtNum(sinOrden)}</strong> unidades sin orden</span>
        <span>${ordenes.length ? ordenes.map(o => `OC ${esc(o.orden)}: ${Number(o.pendiente) ? `<strong>${plural(Number(o.pendiente), "unidad pendiente", "unidades pendientes")}</strong>` : "<strong>completa</strong>"}`).join(" · ") : "No toca ninguna orden de compra"}</span>
      </div>
      ${sinOrden ? `<ul class="lista-avisos"><li>${guardado ? "Quedaron" : "Van a quedar"} ${plural(sinOrden, "unidad", "unidades")} sin orden de compra: no había una OC abierta de este proveedor con ese código, o llegó más de lo pedido. Se ven en Pendientes → "Llegó sin orden de compra".</li></ul>` : ""}
      <div class="tabla-wrap" style="max-height:340px"><table class="tabla grilla">
        <thead><tr><th>Código</th><th>Descripción</th><th class="num">Llegó</th><th>Se asigna a</th><th class="num">Sin orden</th></tr></thead>
        <tbody>${s.lineas.map((l, i) => `<tr><td><strong>${esc(l.codigo)}</strong>${etiquetaProveedor(corto, d.proveedor)}</td><td>${esc((d.lineas[i] || {}).descripcion)}</td>
          <td class="num">${fmtNum(l.cantidad)}</td>
          <td>${l.asignado.length ? l.asignado.map(x => `OC ${esc(x.orden)} · ${fmtNum(x.cantidad)}`).join("<br>") : "—"}</td>
          <td class="num ${Number(l.sin_orden) ? "atrasado" : "cero"}">${fmtNum(l.sin_orden)}</td></tr>`).join("")}</tbody>
      </table></div>`;
  }

  function iniciar() {
    const zona = $("zona-carga");
    $("cargar-archivos").addEventListener("change", e => {
      const lista = [...e.target.files];
      e.target.value = "";
      if (lista.length) agregarArchivos(lista);
    });
    ["dragenter", "dragover"].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add("encima"); }));
    ["dragleave", "drop"].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove("encima"); }));
    zona.addEventListener("drop", e => {
      const lista = [...e.dataTransfer.files].filter(f => /\.xlsx?$/i.test(f.name));
      if (!lista.length) return toast("Solo se pueden subir archivos .xls de Manager.", "error");
      agregarArchivos(lista);
    });
    $("cargar-lista").addEventListener("change", e => {
      const num = e.target.closest("[data-numero]"), ord = e.target.closest("[data-orden]"), asig = e.target.closest("[data-asig]");
      if (num) cambiarNumero(tarjetas.find(t => t.id === Number(num.dataset.numero)), num.value);
      if (ord) elegirOrden(tarjetas.find(t => t.id === Number(ord.dataset.orden)), ord.value);
      if (asig) {
        const t = tarjetas.find(x => x.id === Number(asig.dataset.asig));
        t.modoManual = asig.value === "manual";
        if (!t.modoManual && t.doc.orden) { delete t.doc.orden; t.errorOrden = ""; simular(t); }
        else { pintarTarjeta(t); if (t.modoManual) { const i = $("orden-" + t.id); if (i) i.focus(); } }
      }
    });
    $("cargar-lista").addEventListener("click", e => {
      const orig = e.target.closest("[data-numero-original]"), des = e.target.closest("[data-deshacer-carga]");
      if (orig) { const t = tarjetas.find(x => x.id === Number(orig.dataset.numeroOriginal)); return cambiarNumero(t, t.numeroOriginal); }
      if (des) { const t = tarjetas.find(x => x.id === Number(des.dataset.deshacerCarga)); if (t && t.deshacerId) R.deshacer.ejecutar(t.deshacerId); return; }
      const g = e.target.closest("[data-guardar]"), q = e.target.closest("[data-quitar]"), n = e.target.closest("[data-nombre-corto]");
      if (n) guardarNombreCorto(tarjetas.find(t => t.id === Number(n.dataset.nombreCorto)), n);
      if (g) guardar(tarjetas.find(t => t.id === Number(g.dataset.guardar)), g);
      if (q) { tarjetas = tarjetas.filter(t => t.id !== Number(q.dataset.quitar)); pintar(); }
    });
  }

  async function mostrar() {
    await recargarProveedores();
    // Al volver a la sección, se recalcula lo que no se guardó (pudo cambiar la base)
    tarjetas.filter(t => t.doc && t.estado !== "guardado").forEach(t => simular(t));
    if (!tarjetas.length) $("cargar-lista").innerHTML = "";
  }

  R.vistaCargar = { iniciar, mostrar };
})(window.COMPRAS);
