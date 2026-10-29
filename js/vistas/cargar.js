// =====================================================================
//  Vista: Cargar documentos. Cada .xls de Manager se lee en el
//  navegador (js/lector-manager.js), la base simula la carga y muestra
//  cómo va a quedar, y recién con "Guardar" se graba.
// =====================================================================
(function (R) {
  const { $, esc, toast, fmtFecha, fmtNum, fmtPesos, plural, ICONOS, etiquetaProveedor } = R.util;
  // Un documento por tarjeta: { id, archivo, doc, error, simulacion, estado: "previa" | "guardado" | "error" }
  let tarjetas = [];
  let sec = 0;
  // Proveedores ya cargados, para mostrar el nombre corto (Target, Bagcherry…) y pedirlo si falta
  let proveedores = [];
  const proveedorDe = d => d && proveedores.find(p => p.cuit === d.cuit);
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

  async function agregarArchivos(lista) {
    await recargarProveedores();
    const nuevas = [];
    for (const archivo of lista) {
      const t = { id: ++sec, archivo: archivo.name, doc: null, error: "", simulacion: null, estado: "previa" };
      try { t.doc = await leerArchivo(archivo); }
      catch (e) { t.error = e.message; t.estado = "error"; }
      nuevas.push(t);
    }
    // Primero las órdenes de compra, después los remitos (el remito se cruza con las OC)
    nuevas.sort((a, b) => orden(a) - orden(b));
    tarjetas = [...nuevas, ...tarjetas];
    pintar();
    for (const t of nuevas) await simular(t);
  }
  const orden = t => (t.doc && t.doc.tipo === "orden_compra" ? 0 : 1);

  async function simular(t) {
    if (!t.doc || t.estado === "guardado") return;
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
      toast(`${t.doc.tipo === "orden_compra" ? "Orden de compra" : "Remito"} ${t.doc.numero} guardado.`);
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
    const sub = d ? `${corto ? `<strong>${esc(p.nombre_corto)}</strong> · ` : ""}${esc(d.proveedor || "Proveedor sin nombre")} · CUIT ${esc(d.cuit || "—")} · ${fmtFecha(d.fecha)} · ${esc(t.archivo)}` : "";
    const acciones = t.estado === "guardado"
      ? `<span class="estado completa">Guardado</span>`
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

    el.innerHTML = `<div class="doc-cabecera"><div><h3>${titulo}</h3><p class="sub">${sub}</p></div>
      <div class="acciones-fila">${acciones}</div></div>${cuerpo}`;
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
    $("cargar-lista").addEventListener("click", e => {
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
