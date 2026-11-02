// =====================================================================
//  Vista: Pendientes. Lo que se pidió en una OC y todavía no llegó,
//  con los días que lleva esperando, y lo que llegó sin orden.
// =====================================================================
(function (R) {
  const { $, esc, norm, fmtFecha, fmtNum, plural, chipEstado, descargarCSV, hoy, info, etiquetaProveedor, toast } = R.util;
  const app = () => R.app;
  let filas = [], sobrantes = [];

  function filtradas() {
    const q = norm($("pendientes-buscar").value), prov = $("pendientes-proveedor").value;
    const soloAtrasados = $("pendientes-atrasados").checked, alerta = app().diasAlerta();
    return filas.filter(f => (!prov || f.proveedor === prov)
      && (!soloAtrasados || f.dias_atraso >= alerta)
      && (!q || norm(`${f.codigo} ${f.descripcion} ${f.orden} ${f.proveedor} ${f.razon_social || ""}`).includes(q)));
  }

  function pintarKpis() {
    const alerta = app().diasAlerta();
    const ordenes = new Set(filas.map(f => f.orden)).size;
    const proveedores = new Set(filas.map(f => f.proveedor)).size;
    const unidades = filas.reduce((a, f) => a + f.pendiente, 0);
    const atrasadas = filas.filter(f => f.dias_atraso >= alerta);
    const masVieja = filas.reduce((m, f) => Math.max(m, f.dias_desde_orden), 0);
    const kpi = (etiqueta, valor, detalle, destacado) =>
      `<div class="kpi ${destacado ? "destacado" : ""}"><div class="etiqueta">${etiqueta}</div><div class="valor">${valor}</div><div class="detalle">${detalle}</div></div>`;
    $("pendientes-kpis").innerHTML =
      kpi("Unidades pendientes", fmtNum(unidades), `${plural(filas.length, "artículo", "artículos")}`, true) +
      kpi("Órdenes con pendientes", fmtNum(ordenes), plural(proveedores, "proveedor", "proveedores")) +
      kpi(`Atrasados (${alerta}+ días)${info(`Artículos que llevan ${alerta} días o más sin llegar desde la fecha de entrega de la orden de compra. El límite se cambia en js/config.js (diasAlerta).`)}`,
        fmtNum(atrasadas.length), plural(atrasadas.reduce((a, f) => a + f.pendiente, 0), "unidad", "unidades")) +
      kpi("El más viejo", `${fmtNum(masVieja)}<small>días</small>`, "desde la orden de compra");
  }

  function pintarTabla() {
    const lista = filtradas(), alerta = app().diasAlerta();
    $("pendientes-tabla").innerHTML = `<thead><tr>
        <th>Artículo y proveedor</th><th>Orden de compra</th>
        <th class="num">Pedido</th><th class="num">Llegó</th><th class="num">Falta</th><th>Estado</th>
        <th class="num">Días sin llegar${info("Días desde la fecha de la orden de compra. En rojo, cuando pasaron " + alerta + " días o más desde la fecha de entrega.")}</th>
        <th>Última llegada</th></tr></thead>
      <tbody>${lista.map(f => `<tr>
        <td><strong>${esc(f.codigo)}</strong>${etiquetaProveedor(f.proveedor, f.razon_social)}<small>${esc(f.descripcion)}</small></td>
        <td>${esc(f.orden)}<small>${fmtFecha(f.fecha_orden)}</small></td>
        <td class="num">${fmtNum(f.cantidad)}</td>
        <td class="num ${f.recibido ? "" : "cero"}">${fmtNum(f.recibido)}</td>
        <td class="num"><strong>${fmtNum(f.pendiente)}</strong></td>
        <td>${chipEstado(f.estado)}</td>
        <td class="num ${f.dias_atraso >= alerta ? "atrasado" : ""}">${fmtNum(f.dias_desde_orden)}</td>
        <td>${fmtFecha(f.ultima_recepcion)}</td></tr>`).join("")
        || `<tr><td colspan="8" class="vacio">${filas.length ? "Nada coincide con el filtro." : "No hay nada pendiente. Todo lo pedido llegó."}</td></tr>`}</tbody>`;
    $("pendientes-pie").textContent = lista.length !== filas.length ? `Mostrando ${fmtNum(lista.length)} de ${fmtNum(filas.length)}.` : "";
  }

  function pintarSobrantes() {
    const puede = app().puedeCargar();
    $("sobrantes-caja").hidden = !sobrantes.length;
    $("sobrantes-tabla").innerHTML = `<thead><tr><th>Remito</th><th>Artículo y proveedor</th><th>Descripción</th><th class="num">Llegó</th><th class="num">Sin orden</th>${puede ? "<th></th>" : ""}</tr></thead>
      <tbody>${sobrantes.map(s => `<tr><td>${esc(s.remito)}<small>${fmtFecha(s.fecha)}</small></td><td><strong>${esc(s.codigo)}</strong>${etiquetaProveedor(s.proveedor, s.razon_social)}</td><td>${esc(s.descripcion)}</td><td class="num">${fmtNum(s.cantidad)}</td>
        <td class="num atrasado">${fmtNum(s.sin_orden)}</td>
        ${puede ? `<td><button type="button" class="link" data-asignar="${s.remito_linea_id}">Asignar a una orden</button></td>` : ""}</tr>`).join("")}</tbody>`;
  }

  // ---------- Asignar a mano lo que llegó sin orden (o con otro código) ----------
  let asignando = null, lineasAbiertas = [];

  async function abrirAsignar(remitoLineaId) {
    asignando = sobrantes.find(s => s.remito_linea_id === remitoLineaId);
    if (!asignando) return;
    $("asignar-ficha").innerHTML = `<div><dt>Remito</dt><dd>${esc(asignando.remito)}<br><small>${fmtFecha(asignando.fecha)}</small></dd></div>
      <div><dt>Artículo</dt><dd><strong>${esc(asignando.codigo)}</strong>${etiquetaProveedor(asignando.proveedor, asignando.razon_social)}<br><small>${esc(asignando.descripcion)}</small></dd></div>
      <div><dt>Sin orden</dt><dd><strong>${fmtNum(asignando.sin_orden)}</strong> de ${fmtNum(asignando.cantidad)} unidades</dd></div>`;
    $("asignar-buscar").value = "";
    $("asignar-tabla").innerHTML = R.util.esqueleto.tabla(6, 4);
    $("dlg-asignar").showModal();
    try { lineasAbiertas = await R.api.asignaciones.lineasAbiertas(asignando.proveedor_id); pintarAsignar(); }
    catch (e) { $("asignar-tabla").innerHTML = `<tbody><tr><td>${esc(e.message)}</td></tr></tbody>`; }
  }

  function pintarAsignar() {
    if (!asignando) return;
    const q = norm($("asignar-buscar").value);
    // Primero las líneas con el mismo código, después las demás
    const lista = lineasAbiertas.filter(l => !q || norm(`${l.orden} ${l.codigo} ${l.descripcion}`).includes(q))
      .sort((a, b) => (b.codigo === asignando.codigo) - (a.codigo === asignando.codigo) || a.fecha_orden.localeCompare(b.fecha_orden) || a.orden.localeCompare(b.orden))
      .slice(0, 80);
    $("asignar-tabla").innerHTML = `<thead><tr><th>Orden</th><th>Código</th><th>Descripción</th><th class="num">Pendiente</th><th class="num">Cantidad a asignar</th><th></th></tr></thead>
      <tbody>${lista.map(l => `<tr><td><strong>${esc(l.orden)}</strong><small>${fmtFecha(l.fecha_orden)}</small></td>
        <td><strong>${esc(l.codigo)}</strong>${l.codigo === asignando.codigo ? '<span class="tag-mismo">mismo código</span>' : ""}</td><td>${esc(l.descripcion)}</td>
        <td class="num">${fmtNum(l.pendiente)}</td>
        <td class="num"><input type="number" min="1" max="${Math.min(asignando.sin_orden, l.pendiente)}" step="1" value="${Math.min(asignando.sin_orden, l.pendiente)}" id="cant-${l.id}" aria-label="Cantidad para ${esc(l.orden)} ${esc(l.codigo)}"></td>
        <td><button type="button" class="btn-sec primario" data-linea="${l.id}">Asignar</button></td></tr>`).join("")
        || `<tr><td colspan="6" class="vacio">${lineasAbiertas.length ? "Nada coincide con la búsqueda." : "Este proveedor no tiene órdenes abiertas con unidades pendientes."}</td></tr>`}</tbody>`;
  }

  async function asignar(lineaId) {
    const l = lineasAbiertas.find(x => x.id === lineaId), s = asignando;
    const cantidad = Number($("cant-" + lineaId).value);
    if (!l || !s) return;
    if (!(cantidad > 0) || cantidad > Math.min(s.sin_orden, l.pendiente)) return toast(`La cantidad tiene que estar entre 1 y ${fmtNum(Math.min(s.sin_orden, l.pendiente))}.`, "error");
    try {
      await R.api.asignaciones.asignar(s.remito_linea_id, l.id, cantidad);
      $("dlg-asignar").close();
      R.deshacer.registrarConAviso(`${fmtNum(cantidad)} de ${s.codigo} asignadas a la orden ${l.orden} (${l.codigo}).`, {
        texto: `asignación de ${fmtNum(cantidad)} ${s.codigo} a la orden ${l.orden}`,
        deshacer: async () => { await R.api.asignaciones.quitar(s.remito_linea_id, l.id, cantidad); await mostrar(); },
      });
      await mostrar();
    } catch (e) { toast(e.message, "error", 6000); }
  }

  async function mostrar() {
    $("pendientes-kpis").innerHTML = R.util.esqueleto.kpis(4);
    $("pendientes-tabla").innerHTML = R.util.esqueleto.tabla(7, 6);
    try {
      // Con datos guardados se muestra enseguida; si después llegan más nuevos, se vuelve a dibujar
      [filas, sobrantes] = await Promise.all([
        R.api.vistas.pendientes({ alActualizar: d => { filas = d; repintar(); } }),
        R.api.vistas.sobrantes({ alActualizar: d => { sobrantes = d; pintarSobrantes(); } }),
      ]);
    } catch (e) {
      $("pendientes-tabla").innerHTML = `<tbody><tr><td>${esc(e.message)}</td></tr></tbody>`;
      return;
    }
    repintar();
  }

  function repintar() {
    $("pendientes-proveedor").innerHTML = app().opcionesProveedor(filas, $("pendientes-proveedor").value);
    pintarKpis();
    pintarTabla();
    pintarSobrantes();
  }

  function exportar() {
    const lista = filtradas();
    if (!lista.length) return R.util.toast("No hay filas para exportar.", "error");
    descargarCSV(`pendientes-${hoy()}.csv`, [
      ["Orden de compra", "Fecha OC", "Proveedor", "Razón social", "Código", "Descripción", "Pedido", "Llegó", "Falta", "Estado", "Días sin llegar", "Última llegada"],
      ...lista.map(f => [f.orden, fmtFecha(f.fecha_orden), f.proveedor, f.razon_social || f.proveedor, f.codigo, f.descripcion, f.cantidad, f.recibido, f.pendiente,
        R.util.ESTADOS[f.estado] || f.estado, f.dias_desde_orden, f.ultima_recepcion ? fmtFecha(f.ultima_recepcion) : ""]),
    ]);
  }

  function iniciar() {
    $("pendientes-buscar").addEventListener("input", pintarTabla);
    $("pendientes-proveedor").addEventListener("change", pintarTabla);
    $("pendientes-atrasados").addEventListener("change", pintarTabla);
    $("pendientes-csv").addEventListener("click", exportar);
    $("sobrantes-tabla").addEventListener("click", e => { const b = e.target.closest("[data-asignar]"); if (b) abrirAsignar(Number(b.dataset.asignar)); });
    $("asignar-buscar").addEventListener("input", pintarAsignar);
    $("asignar-tabla").addEventListener("click", e => { const b = e.target.closest("[data-linea]"); if (b) asignar(Number(b.dataset.linea)); });
  }

  R.vistaPendientes = { iniciar, mostrar };
})(window.COMPRAS);
