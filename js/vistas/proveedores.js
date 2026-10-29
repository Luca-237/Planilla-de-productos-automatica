// =====================================================================
//  Vista: Proveedores. Cada proveedor se registra solo (por CUIT) al
//  cargar su primera OC o remito, con la razón social de Manager. Acá se
//  le pone el nombre con el que se lo conoce en Cindy (Target,
//  Bagcherry…) y se puede cambiar cuando se quiera: la base lo muestra
//  así en todas las vistas, también en lo ya cargado.
// =====================================================================
(function (R) {
  const { $, esc, norm, fmtFecha, fmtNum, toast, plural, nombreProveedor, etiquetaProveedor } = R.util;
  const app = () => R.app;
  let proveedores = [], ordenes = [], pendientes = [];
  let editando = null;

  const sinNombre = p => !String(p.nombre_corto || "").trim();

  // Contador del menú: cuántos proveedores todavía se muestran con la razón social
  function pintarContador(lista = proveedores) {
    const n = app() && app().puedeCargar() ? lista.filter(sinNombre).length : 0;
    $("contador-proveedores").hidden = !n;
    $("contador-proveedores").textContent = n;
    $("contador-proveedores").title = n ? `${plural(n, "proveedor", "proveedores")} sin nombre` : "";
  }
  async function actualizarContador() {
    try { pintarContador(await R.api.proveedores.listar()); } catch (e) { /* el contador es solo una ayuda */ }
  }

  function filas() {
    const q = norm($("proveedores-buscar").value), soloSin = $("proveedores-sin-nombre").checked;
    return proveedores
      .map(p => {
        const os = ordenes.filter(o => o.proveedor_id === p.id);
        return {
          p, ordenes: os.length,
          ultima: os.reduce((m, o) => (!m || o.fecha > m ? o.fecha : m), null),
          falta: pendientes.filter(x => x.proveedor_id === p.id).reduce((a, x) => a + x.pendiente, 0),
        };
      })
      .filter(({ p }) => (!soloSin || sinNombre(p)) && (!q || norm(`${p.nombre_corto} ${p.nombre} ${p.cuit}`).includes(q)))
      // Primero los que no tienen nombre; después por nombre
      .sort((a, b) => (sinNombre(b.p) - sinNombre(a.p)) || nombreProveedor(a.p).localeCompare(nombreProveedor(b.p), "es"));
  }

  function pintar() {
    const puede = app().puedeCargar(), lista = filas();
    const faltan = proveedores.filter(sinNombre).length;
    $("proveedores-aviso").hidden = !faltan || !puede;
    $("proveedores-aviso").innerHTML = `${R.util.ICONOS.alerta}<span>${faltan === 1 ? "Hay 1 proveedor" : `Hay ${fmtNum(faltan)} proveedores`} sin nombre: se ${faltan === 1 ? "muestra" : "muestran"} con la razón social de Manager.</span>
      <button type="button" class="link" id="proveedores-ver-sin">Ver solo esos</button>`;
    $("proveedores-tabla").innerHTML = `<thead><tr><th>Se muestra como</th><th>Razón social (Manager)</th><th>CUIT</th>
        <th class="num">Órdenes</th><th>Última orden</th><th class="num">Falta llegar</th>${puede ? "<th></th>" : ""}</tr></thead>
      <tbody>${lista.map(({ p, ordenes: n, ultima, falta }) => `<tr class="${sinNombre(p) ? "sin-nombre" : ""}" data-id="${p.id}">
        <td>${sinNombre(p) ? `<span class="nombre-prov">${esc(p.nombre)}</span><small class="aviso">Sin nombre</small>` : `<span class="nombre-prov">${esc(p.nombre_corto)}</span>`}</td>
        <td>${esc(p.nombre)}</td><td>${esc(p.cuit)}</td>
        <td class="num ${n ? "" : "cero"}">${fmtNum(n)}</td><td>${fmtFecha(ultima)}</td>
        <td class="num ${falta ? "" : "cero"}">${fmtNum(falta)}</td>
        ${puede ? `<td><div class="acciones-fila"><button type="button" class="btn-sec ${sinNombre(p) ? "primario" : ""}" data-renombrar="${p.id}">${sinNombre(p) ? "Ponerle nombre" : "Renombrar"}</button></div></td>` : ""}
      </tr>`).join("")
        || `<tr><td colspan="7" class="vacio">${proveedores.length ? "Nada coincide con el filtro." : "Todavía no hay proveedores: se registran solos al cargar la primera orden de compra o remito."}</td></tr>`}</tbody>`;
    pintarContador();
  }

  async function mostrar() {
    $("proveedores-tabla").innerHTML = `<tbody><tr><td class="cargando">Cargando…</td></tr></tbody>`;
    try {
      [proveedores, ordenes, pendientes] = await Promise.all([R.api.proveedores.listar(), R.api.ordenes.listar(), R.api.vistas.pendientes()]);
    } catch (e) {
      $("proveedores-tabla").innerHTML = `<tbody><tr><td>${esc(e.message)}</td></tr></tbody>`;
      return;
    }
    pintar();
  }

  // ---------- Renombrar ----------
  function vistaPrevia() {
    const nombre = $("prov-nombre").value.trim() || editando.nombre;
    $("prov-vista").innerHTML = `<strong>855338</strong>${etiquetaProveedor(nombre, editando.nombre)}`;
    // Otro proveedor (otro CUIT) que ya se muestra igual
    const igual = $("prov-nombre").value.trim() && proveedores.find(p => p.id !== editando.id && norm(nombreProveedor(p)) === norm(nombre));
    $("prov-aviso").textContent = igual ? `Ojo: "${nombreProveedor(igual)}" ya es el nombre de ${igual.nombre} (CUIT ${igual.cuit}). Se van a ver igual en la página.` : "";
  }

  function abrir(id) {
    editando = proveedores.find(p => p.id === id);
    if (!editando) return;
    $("prov-razon").textContent = editando.nombre;
    $("prov-cuit").textContent = editando.cuit;
    $("prov-nombre").value = editando.nombre_corto || "";
    vistaPrevia();
    $("dlg-proveedor").showModal();
    $("prov-nombre").focus();
  }

  async function guardar(e) {
    e.preventDefault();
    const valor = $("prov-nombre").value.trim();
    if (valor === (editando.nombre_corto || "")) return $("dlg-proveedor").close();
    $("prov-guardar").disabled = true;
    try {
      await R.api.proveedores.actualizar(editando.id, { nombre_corto: valor });
      $("dlg-proveedor").close();
      toast(valor ? `"${editando.nombre}" ahora se muestra como "${valor}".` : `"${editando.nombre}" vuelve a mostrarse con la razón social.`);
      await mostrar();
    } catch (err) { $("prov-aviso").textContent = err.message; }
    finally { $("prov-guardar").disabled = false; }
  }

  function iniciar() {
    $("proveedores-buscar").addEventListener("input", pintar);
    $("proveedores-sin-nombre").addEventListener("change", pintar);
    $("proveedores-aviso").addEventListener("click", e => {
      if (e.target.id !== "proveedores-ver-sin") return;
      $("proveedores-sin-nombre").checked = true;
      pintar();
    });
    $("proveedores-tabla").addEventListener("click", e => {
      const b = e.target.closest("[data-renombrar]");
      if (b) abrir(Number(b.dataset.renombrar));
    });
    $("prov-nombre").addEventListener("input", vistaPrevia);
    $("prov-original").addEventListener("click", () => { $("prov-nombre").value = ""; vistaPrevia(); $("prov-nombre").focus(); });
    $("form-proveedor").addEventListener("submit", guardar);
  }

  R.vistaProveedores = { iniciar, mostrar, actualizarContador, pintarContador };
})(window.COMPRAS);
