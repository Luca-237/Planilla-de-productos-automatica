// =====================================================================
//  Vista: Pendientes. Lo que se pidió en una OC y todavía no llegó,
//  con los días que lleva esperando, y lo que llegó sin orden.
// =====================================================================
(function (R) {
  const { $, esc, norm, fmtFecha, fmtNum, plural, chipEstado, descargarCSV, hoy, info, etiquetaProveedor } = R.util;
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
    $("sobrantes-caja").hidden = !sobrantes.length;
    $("sobrantes-tabla").innerHTML = `<thead><tr><th>Remito</th><th>Artículo y proveedor</th><th>Descripción</th><th class="num">Llegó</th><th class="num">Sin orden</th></tr></thead>
      <tbody>${sobrantes.map(s => `<tr><td>${esc(s.remito)}<small>${fmtFecha(s.fecha)}</small></td><td><strong>${esc(s.codigo)}</strong>${etiquetaProveedor(s.proveedor, s.razon_social)}</td><td>${esc(s.descripcion)}</td><td class="num">${fmtNum(s.cantidad)}</td>
        <td class="num atrasado">${fmtNum(s.sin_orden)}</td></tr>`).join("")}</tbody>`;
  }

  async function mostrar() {
    $("pendientes-tabla").innerHTML = `<tbody><tr><td class="cargando">Cargando…</td></tr></tbody>`;
    try {
      [filas, sobrantes] = await Promise.all([R.api.vistas.pendientes(), R.api.vistas.sobrantes()]);
    } catch (e) {
      $("pendientes-tabla").innerHTML = `<tbody><tr><td>${esc(e.message)}</td></tr></tbody>`;
      return;
    }
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
  }

  R.vistaPendientes = { iniciar, mostrar };
})(window.COMPRAS);
