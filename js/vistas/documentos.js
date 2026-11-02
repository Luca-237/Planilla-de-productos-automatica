// =====================================================================
//  Vista: Órdenes y remitos. Lista lo cargado; desde el detalle de una
//  OC se cierra, se elige la modalidad de facturación y se cancelan
//  unidades que ya no vienen. Borrar un documento: solo admin.
// =====================================================================
(function (R) {
  const { $, esc, norm, fmtFecha, fmtNum, fmtPesos, chipEstado, toast, nombreProveedor } = R.util;
  const app = () => R.app;
  const MODALIDADES = ["100% facturada", "medio IVA", "mitad factura / mitad presupuesto", "sin facturar"];
  let ordenes = [], lineas = [], remitos = [];
  // Nombre corto con la razón social en el globo del mouse
  const celdaProveedor = p => `<td${p && nombreProveedor(p) !== p.nombre ? ` title="${esc(p.nombre)}"` : ""}>${esc(nombreProveedor(p))}</td>`;
  let abierta = null; // id de la OC del diálogo

  // Totales de cada OC a partir de sus líneas
  function resumen(o) {
    const ls = lineas.filter(l => l.orden_id === o.id);
    const pedido = ls.reduce((a, l) => a + l.cantidad - l.cancelada, 0);
    const recibido = ls.reduce((a, l) => a + l.recibido, 0);
    const falta = ls.reduce((a, l) => a + l.pendiente, 0);
    const estado = o.cerrada && falta ? "cerrada" : !falta ? (recibido ? "completa" : "cancelada") : recibido ? "parcial" : "pendiente";
    return { ls, pedido, recibido, falta, estado };
  }

  function pintarOrdenes() {
    const q = norm($("ordenes-buscar").value), filtro = $("ordenes-estado").value;
    const lista = ordenes.map(o => ({ o, r: resumen(o) })).filter(({ o, r }) =>
      (!q || norm(`${o.numero} ${nombreProveedor(o.proveedores)} ${o.proveedores ? o.proveedores.nombre : ""}`).includes(q))
      && (!filtro || (filtro === "abiertas" ? ["pendiente", "parcial"].includes(r.estado) : !["pendiente", "parcial"].includes(r.estado))));
    $("ordenes-tabla").innerHTML = `<thead><tr><th>Orden</th><th>Proveedor</th><th class="num">Artículos</th><th class="num">Pedido</th>
        <th class="num">Llegó</th><th class="num">Falta</th><th>Estado</th><th>Facturación</th></tr></thead>
      <tbody>${lista.map(({ o, r }) => `<tr class="clic" data-orden="${o.id}">
        <td><strong>${esc(o.numero)}</strong><small>${fmtFecha(o.fecha)}</small></td>
        ${celdaProveedor(o.proveedores)}
        <td class="num">${fmtNum(r.ls.length)}</td><td class="num">${fmtNum(r.pedido)}</td>
        <td class="num">${fmtNum(r.recibido)}</td><td class="num ${r.falta ? "" : "cero"}">${fmtNum(r.falta)}</td>
        <td>${chipEstado(r.estado)}</td><td>${esc(o.modalidad_facturacion || "—")}</td></tr>`).join("")
        || `<tr><td colspan="8" class="vacio">${ordenes.length ? "Nada coincide con el filtro." : "Todavía no hay órdenes de compra cargadas."}</td></tr>`}</tbody>`;
  }

  function pintarRemitos() {
    const admin = app().esAdmin(), puede = app().puedeCargar();
    $("remitos-tabla").innerHTML = `<thead><tr><th>Remito</th><th>Fecha</th><th>Proveedor</th><th class="num">Artículos</th><th class="num">Unidades</th>${puede || admin ? "<th></th>" : ""}</tr></thead>
      <tbody>${remitos.map(r => `<tr><td><strong>${esc(r.numero)}</strong></td><td>${fmtFecha(r.fecha)}</td>
        ${celdaProveedor(r.proveedores)}
        <td class="num">${fmtNum((r.remito_lineas || []).length)}</td>
        <td class="num">${fmtNum((r.remito_lineas || []).reduce((a, l) => a + Number(l.cantidad), 0))}</td>
        ${puede || admin ? `<td><div class="acciones-fila">${puede ? `<button type="button" class="link" data-renumerar-remito="${r.id}">Cambiar número</button>` : ""}${admin ? `<button type="button" class="link peligro" data-borrar-remito="${r.id}">Borrar</button>` : ""}</div></td>` : ""}</tr>`).join("")
        || `<tr><td colspan="6" class="vacio">Todavía no hay remitos cargados.</td></tr>`}</tbody>`;
  }

  async function mostrar() {
    $("ordenes-tabla").innerHTML = R.util.esqueleto.tabla(6, 6);
    $("remitos-tabla").innerHTML = R.util.esqueleto.tabla(5, 4);
    try {
      [ordenes, lineas, remitos] = await Promise.all([R.api.ordenes.listar(), R.api.vistas.lineas(), R.api.remitos.listar()]);
    } catch (e) {
      $("ordenes-tabla").innerHTML = `<tbody><tr><td>${esc(e.message)}</td></tr></tbody>`;
      return;
    }
    pintarOrdenes();
    pintarRemitos();
    if (abierta && $("dlg-orden").open) pintarDetalle();
  }

  // ---------- Detalle de una OC ----------
  function pintarDetalle() {
    const o = ordenes.find(x => x.id === abierta);
    if (!o) return $("dlg-orden").close();
    const r = resumen(o), puede = app().puedeCargar(), admin = app().esAdmin();
    $("orden-titulo").textContent = `Orden de compra ${o.numero}`;
    $("orden-cuerpo").innerHTML = `
      <dl class="ficha-datos">
        <div><dt>Proveedor</dt><dd><strong>${esc(nombreProveedor(o.proveedores))}</strong><br><small>${esc(o.proveedores ? o.proveedores.nombre : "")} · CUIT ${esc(o.proveedores ? o.proveedores.cuit : "")}</small></dd></div>
        <div><dt>Número</dt><dd>${puede ? `<input id="orden-numero" value="${esc(o.numero)}" maxlength="20" aria-label="Número de la orden" style="width:150px; padding:5px 8px; font-weight:600">
          <button type="button" class="link" id="orden-renumerar">Cambiar número</button>` : `<strong>${esc(o.numero)}</strong>`}</dd></div>
        <div><dt>Fecha</dt><dd>${fmtFecha(o.fecha)}</dd></div>
        <div><dt>Comprador</dt><dd>${esc(o.comprador || "—")}</dd></div>
        <div><dt>Total</dt><dd>${fmtPesos(o.total)}<br><small>Descuento ${fmtNum(o.descuento_porcentaje, 2)} %</small></dd></div>
        <div><dt>Estado</dt><dd>${chipEstado(r.estado)}${o.cerrada && o.motivo_cierre ? `<br><small>${esc(o.motivo_cierre)}</small>` : ""}</dd></div>
      </dl>
      ${puede ? `<div class="form-grid">
        <div><label for="orden-modalidad">Modalidad de facturación</label>
          <select id="orden-modalidad"><option value="">Sin indicar</option>${MODALIDADES.map(m => `<option ${m === o.modalidad_facturacion ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></div>
        <div><label for="orden-observaciones">Observaciones</label><input id="orden-observaciones" value="${esc(o.observaciones || "")}"></div>
      </div>` : ""}
      <div class="tabla-wrap" style="margin-top:14px"><table class="tabla grilla">
        <thead><tr><th>Código</th><th>Descripción</th><th class="num">Pedido</th><th class="num">Cancelado</th><th class="num">Llegó</th><th class="num">Falta</th><th>Estado</th>${puede ? "<th></th>" : ""}</tr></thead>
        <tbody>${r.ls.map(l => `<tr><td><strong>${esc(l.codigo)}</strong>${R.util.etiquetaProveedor(l.proveedor, l.razon_social)}</td><td>${esc(l.descripcion)}</td>
          <td class="num">${fmtNum(l.cantidad)}</td><td class="num ${l.cancelada ? "" : "cero"}">${fmtNum(l.cancelada)}</td>
          <td class="num">${fmtNum(l.recibido)}</td><td class="num">${fmtNum(l.pendiente)}</td><td>${chipEstado(l.estado)}</td>
          ${puede ? `<td>${l.pendiente || l.cancelada ? `<button type="button" class="link" data-cancelar="${l.id}">Cancelar unidades</button>` : ""}</td>` : ""}</tr>`).join("")}</tbody>
      </table></div>
      <div class="dlg-pie">
        ${admin ? `<button type="button" class="link peligro" id="orden-borrar" style="margin-right:auto">Borrar orden</button>` : ""}
        ${puede ? `<button type="button" class="btn-sec" id="orden-cerrar">${o.cerrada ? "Reabrir orden" : "Cerrar orden"}</button>
          <button type="button" class="btn-sec primario" id="orden-guardar">Guardar</button>` : ""}
      </div>`;
  }

  async function accion(promesa, ok) {
    try { await promesa; toast(ok); await mostrar(); }
    catch (e) { toast(e.message, "error", 6000); }
  }

  function clicDetalle(e) {
    const o = ordenes.find(x => x.id === abierta);
    if (!o) return;
    // Cambia campos de la orden y anota cómo volver atrás
    const cambiar = (nuevos, previos, ok, texto) => R.api.ordenes.actualizar(o.id, nuevos)
      .then(() => { R.deshacer.registrarConAviso(ok, { texto, deshacer: async () => { await R.api.ordenes.actualizar(o.id, previos); await mostrar(); } }); return mostrar(); })
      .catch(err => toast(err.message, "error", 6000));
    if (e.target.id === "orden-renumerar") {
      const nuevo = $("orden-numero").value.trim();
      if (nuevo === o.numero) return toast("Ese ya es el número de la orden.");
      if (!/^\d{4}-\d{8}$/.test(nuevo)) return toast("El número tiene que tener el formato 0000-00000000.", "error");
      cambiar({ numero: nuevo }, { numero: o.numero }, `Orden ${o.numero}: ahora es la ${nuevo}.`, `cambio de número de la orden ${o.numero} a ${nuevo}`);
    } else if (e.target.id === "orden-guardar") {
      cambiar({ modalidad_facturacion: $("orden-modalidad").value || null, observaciones: $("orden-observaciones").value.trim() },
        { modalidad_facturacion: o.modalidad_facturacion || null, observaciones: o.observaciones || "" },
        "Orden actualizada.", `datos de la orden ${o.numero}`);
    } else if (e.target.id === "orden-cerrar") {
      if (o.cerrada) return cambiar({ cerrada: false, motivo_cierre: "" }, { cerrada: true, motivo_cierre: o.motivo_cierre || "" }, "Orden reabierta.", `reabrir la orden ${o.numero}`);
      const motivo = prompt("¿Por qué se cierra? (ej. el proveedor no tiene más). Lo que falta deja de figurar como pendiente.");
      if (motivo == null) return;
      cambiar({ cerrada: true, motivo_cierre: motivo.trim() }, { cerrada: false, motivo_cierre: "" }, "Orden cerrada.", `cerrar la orden ${o.numero}`);
    } else if (e.target.id === "orden-borrar") {
      if (!confirm(`¿Borrar la orden ${o.numero}? Se borran sus artículos y lo que se le había asignado de los remitos (esas unidades pasan a "sin orden"). No se puede deshacer.`)) return;
      R.api.ordenes.eliminar(o.id).then(() => { $("dlg-orden").close(); toast("Orden borrada."); mostrar(); })
        .catch(err => toast(err.message, "error", 6000));
    } else if (e.target.dataset.cancelar) {
      const l = lineas.find(x => x.id === Number(e.target.dataset.cancelar));
      const maximo = l.cantidad - l.recibido;
      const v = prompt(`${l.codigo}: ¿cuántas unidades ya no van a venir? (0 a ${fmtNum(maximo)}; hoy hay ${fmtNum(l.cancelada)} canceladas)`, String(l.cancelada));
      if (v == null) return;
      const n = Number(String(v).replace(",", "."));
      if (!Number.isFinite(n) || n < 0 || n > maximo) return toast(`Tiene que ser un número entre 0 y ${fmtNum(maximo)}.`, "error");
      R.api.ordenes.cancelarUnidades(l.id, n).then(() => {
        R.deshacer.registrarConAviso("Unidades actualizadas.", { texto: `unidades canceladas de ${l.codigo} en la orden ${o.numero}`,
          deshacer: async () => { await R.api.ordenes.cancelarUnidades(l.id, l.cancelada); await mostrar(); } });
        return mostrar();
      }).catch(err => toast(err.message, "error", 6000));
    }
  }

  function iniciar() {
    $("ordenes-buscar").addEventListener("input", pintarOrdenes);
    $("ordenes-estado").addEventListener("change", pintarOrdenes);
    $("ordenes-tabla").addEventListener("click", e => {
      const tr = e.target.closest("tr[data-orden]");
      if (!tr) return;
      abierta = Number(tr.dataset.orden);
      pintarDetalle();
      $("dlg-orden").showModal();
    });
    $("orden-cuerpo").addEventListener("click", clicDetalle);
    $("remitos-tabla").addEventListener("click", e => {
      const rn = e.target.closest("[data-renumerar-remito]");
      if (rn) {
        const r = remitos.find(x => x.id === Number(rn.dataset.renumerarRemito));
        const nuevo = prompt(`Número del remito (hoy: ${r.numero}):`, r.numero);
        if (nuevo == null || !nuevo.trim() || nuevo.trim() === r.numero) return;
        R.api.remitos.renumerar(r.id, nuevo).then(() => {
          R.deshacer.registrarConAviso(`Remito ${r.numero}: ahora es ${nuevo.trim()}.`, { texto: `cambio de número del remito ${r.numero}`, deshacer: async () => { await R.api.remitos.renumerar(r.id, r.numero); await mostrar(); } });
          return mostrar();
        }).catch(err => toast(err.message, "error", 6000));
        return;
      }
      const b = e.target.closest("[data-borrar-remito]");
      if (!b) return;
      const r = remitos.find(x => x.id === Number(b.dataset.borrarRemito));
      if (!confirm(`¿Borrar el remito ${r.numero}? Lo que había llegado con él vuelve a figurar como pendiente en sus órdenes. No se puede deshacer.`)) return;
      accion(R.api.remitos.eliminar(r.id), "Remito borrado.");
    });
  }

  R.vistaDocumentos = { iniciar, mostrar };
})(window.COMPRAS);
