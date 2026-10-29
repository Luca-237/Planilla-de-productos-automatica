// =====================================================================
//  Vista: Planilla. Reemplaza a la planilla "Proceso Ecommerce": una
//  fila por artículo de cada OC, con lo que llegó y los datos de la web.
//  Cada usuario elige qué columnas ve (se guarda en "preferencias").
//  Las casillas (Foto, Descripción OK, Sin stock…) se tildan en la misma
//  tabla, una por una o a varios artículos juntos (columna de selección,
//  con Shift + clic para elegir un rango como en Excel).
// =====================================================================
(function (R) {
  const { $, esc, norm, fmtFecha, fmtNum, fmtPesos, chipEstado, descargarCSV, hoy, toast, ESTADOS, etiquetaProveedor, plural } = R.util;
  const app = () => R.app;
  const MAX_FILAS = 1000; // más que esto se pide filtrar (la tabla se pone lenta)

  // Casillas que se tildan desde la tabla. Los datos web son del artículo:
  // tildar en una fila tilda todas las filas del mismo código.
  const TILDES = {
    foto: "Foto", descripcion_ok: "Descripción OK", sin_stock: "Sin stock",
    cargado_web: "Cargado web", catalogo: "Catálogo", ya_no_esta: "Ya no está en la página",
  };
  const editable = () => app().puedeCargar();
  const si = v => v ? `<span class="si">Sí</span>` : `<span class="no">No</span>`;
  const casilla = campo => f => editable()
    ? `<input type="checkbox" class="tilde" data-campo="${campo}" ${f[campo] ? "checked" : ""} aria-label="${esc(TILDES[campo])} · ${esc(f.codigo)}">`
    : si(f[campo]);

  // Descripción web: vista de las primeras líneas; clic en la celda abre la ventanita rápida
  const vistaDesc = f => f.descripcion_web
    ? `<span class="desc-vista">${esc(f.descripcion_web)}</span>`
    : (editable() ? `<span class="desc-vacia">+ Agregar descripción</span>` : "—");

  // [clave, título, grupo, cómo se muestra, clase de la celda]
  const COLUMNAS = [
    // El código va siempre con el nombre corto del proveedor al lado (Target, Bagcherry…)
    ["codigo", "Código", "Compra", f => `<strong>${esc(f.codigo)}</strong>${etiquetaProveedor(f.proveedor, f.razon_social)}`],
    ["nombre", "Nombre", "Compra"],
    // Descripción y casillas al lado del nombre, para no tener que desplazarse
    ["descripcion_web", "Descripción web", "Casillas", vistaDesc, "celda-desc"],
    ...Object.keys(TILDES).map(k => [k, TILDES[k], "Casillas", casilla(k), "num celda-tilde"]),
    ["orden", "Orden de compra", "Compra"],
    ["fecha_orden", "Fecha OC", "Compra", f => fmtFecha(f.fecha_orden)],
    ["proveedor", "Proveedor", "Compra"],
    ["razon_social", "Razón social", "Compra"],
    ["cantidad", "Cantidad", "Compra", f => fmtNum(f.cantidad), "num"],
    ["precio_unitario", "Precio unit.", "Compra", f => fmtPesos(f.precio_unitario), "num"],
    ["estado", "Estado", "Compra", f => chipEstado(f.estado)],
    ["recibido", "Llegó", "Compra", f => fmtNum(f.recibido), "num"],
    ["pendiente", "Falta", "Compra", f => fmtNum(f.pendiente), "num"],
    ["dias_desde_orden", "Días", "Compra", f => fmtNum(f.dias_desde_orden), "num"],
    ["ultima_recepcion", "Última llegada", "Compra", f => fmtFecha(f.ultima_recepcion)],
    ["tipo", "Tipo", "Web"],
    ["variantes", "Variantes", "Web"],
    ["cod_barra", "Cód. barra", "Web"],
    ["fecha_alta_web", "Fecha alta web", "Web", f => fmtFecha(f.fecha_alta_web)],
    ["observaciones", "Observaciones", "Web", null, "texto-largo"],
    ["titulo_web", "Título web", "Web"],
    ["estado_descripcion", "Estado descripción", "Web"],
  ].map(([clave, titulo, grupo, ver, clase]) => ({ clave, titulo, grupo, ver: ver || (f => esc(f[clave] ?? "")), clase: clase || "" }));
  const GRUPOS = { Compra: "Compra y llegada", Casillas: "Carga rápida (se completa en la tabla)", Web: "Datos de la web" };
  const SIEMPRE = ["codigo"]; // no se puede ocultar
  // Ocultas si el usuario todavía no eligió: el proveedor ya va al lado del código
  const OCULTAS_DE_ENTRADA = ["proveedor", "razon_social"];

  let filas = [];
  let ocultas = new Set();
  let editando = null;
  const seleccion = new Set(); // códigos elegidos para marcar varios juntos
  let ultimoClic = null;       // índice de la última fila tildada en la selección (para Shift + clic)

  const visibles = () => COLUMNAS.filter(c => SIEMPRE.includes(c.clave) || !ocultas.has(c.clave));
  const mostradas = () => $("planilla-tabla")._filas || [];

  function filtradas() {
    const q = norm($("planilla-buscar").value), prov = $("planilla-proveedor").value, est = $("planilla-estado").value;
    const falta = $("planilla-falta").value;
    // "sin_stock" y "ya_no_esta" muestran los marcados; el resto, los que faltan
    const pasa = f => !falta || (["sin_stock", "ya_no_esta"].includes(falta) ? !!f[falta] : !f[falta]);
    return filas.filter(f => (!prov || f.proveedor === prov) && (!est || f.estado === est) && pasa(f)
      && (!q || norm(`${f.codigo} ${f.nombre} ${f.orden} ${f.proveedor} ${f.razon_social || ""}`).includes(q)));
  }

  function pintar() {
    const lista = filtradas(), cols = visibles(), filasTabla = lista.slice(0, MAX_FILAS);
    const puede = editable();
    const todasElegidas = puede && filasTabla.length && filasTabla.every(f => seleccion.has(f.codigo));
    $("planilla-tabla").innerHTML = `<thead><tr>
        ${puede ? `<th class="col-sel"><input type="checkbox" class="sel" id="sel-todas" ${todasElegidas ? "checked" : ""} aria-label="Elegir todas las filas que se ven"></th>` : ""}
        ${cols.map(c => `<th class="${c.clase.includes("num") ? "num" : ""}">${esc(c.titulo)}</th>`).join("")}</tr></thead>
      <tbody>${filasTabla.map((f, i) => `<tr class="${puede ? "clic" : ""} ${seleccion.has(f.codigo) ? "seleccionada" : ""}" data-i="${i}">
        ${puede ? `<td class="col-sel"><input type="checkbox" class="sel" ${seleccion.has(f.codigo) ? "checked" : ""} aria-label="Elegir ${esc(f.codigo)}"></td>` : ""}
        ${cols.map(c => `<td class="${c.clase}">${c.ver(f)}</td>`).join("")}</tr>`).join("")
        || `<tr><td colspan="${cols.length + (puede ? 1 : 0)}" class="vacio">${filas.length ? "Nada coincide con el filtro." : "Todavía no hay órdenes de compra cargadas."}</td></tr>`}</tbody>`;
    $("planilla-tabla")._filas = filasTabla;
    $("planilla-pie").textContent = [
      lista.length > MAX_FILAS ? `Se muestran las primeras ${fmtNum(MAX_FILAS)} de ${fmtNum(lista.length)} filas: usá el buscador o los filtros.` :
        lista.length !== filas.length ? `Mostrando ${fmtNum(lista.length)} de ${fmtNum(filas.length)} filas.` : `${fmtNum(filas.length)} filas.`,
      puede ? "Las casillas se guardan al tildarlas. Clic en la descripción para escribirla ahí mismo (Ctrl+Enter guarda y pasa al siguiente). Para marcar varios juntos, elegilos en la primera columna (Shift + clic elige un rango). Clic en el resto de la fila: todos los datos." : "",
    ].filter(Boolean).join(" ");
    pintarBarraSeleccion();
  }

  function pintarBarraSeleccion() {
    $("planilla-seleccion").hidden = !seleccion.size;
    $("seleccion-cuantos").textContent = `${plural(seleccion.size, "artículo elegido", "artículos elegidos")}:`;
  }

  async function mostrar() {
    $("planilla-tabla").innerHTML = `<tbody><tr><td class="cargando">Cargando…</td></tr></tbody>`;
    try {
      const [datos, pref] = await Promise.all([R.api.vistas.planilla(), R.api.preferencias.obtener()]);
      filas = datos;
      ocultas = new Set(pref || OCULTAS_DE_ENTRADA);
    } catch (e) {
      $("planilla-tabla").innerHTML = `<tbody><tr><td>${esc(e.message)}</td></tr></tbody>`;
      return;
    }
    // Lo elegido que ya no existe se descarta
    const codigos = new Set(filas.map(f => f.codigo));
    [...seleccion].forEach(c => { if (!codigos.has(c)) seleccion.delete(c); });
    $("planilla-proveedor").innerHTML = app().opcionesProveedor(filas, $("planilla-proveedor").value);
    const est = $("planilla-estado").value;
    $("planilla-estado").innerHTML = `<option value="">Todos</option>` +
      Object.entries(ESTADOS).map(([v, t]) => `<option value="${v}" ${v === est ? "selected" : ""}>${t}</option>`).join("");
    pintar();
  }

  // ---------- Casillas ----------
  // Cambia el dato en todas las filas del mismo código (es del artículo, no de la OC)
  function aplicarLocal(codigos, campo, valor) {
    const set = new Set(codigos);
    filas.forEach(f => { if (set.has(f.codigo)) f[campo] = valor; });
  }

  async function tildar(input) {
    const f = mostradas()[Number(input.closest("tr").dataset.i)];
    const campo = input.dataset.campo, valor = input.checked, antes = !!f[campo];
    aplicarLocal([f.codigo], campo, valor);
    // Otras filas del mismo código que estén a la vista
    document.querySelectorAll("#planilla-tabla tbody tr").forEach(tr => {
      const g = mostradas()[Number(tr.dataset.i)];
      const otra = tr.querySelector(`input.tilde[data-campo="${campo}"]`);
      if (g && otra && g.codigo === f.codigo) otra.checked = valor;
    });
    try {
      await R.api.articulos.actualizar(f.codigo, { [campo]: valor });
      // Si hay un filtro "Mostrar", la fila puede dejar de corresponder: se redibuja
      if ($("planilla-falta").value === campo) pintar();
    } catch (e) {
      aplicarLocal([f.codigo], campo, antes);
      pintar();
      toast(e.message, "error", 6000);
    }
  }

  async function marcarElegidos(valor) {
    const campo = $("seleccion-campo").value, codigos = [...seleccion];
    if (!codigos.length) return;
    const nombre = TILDES[campo];
    ["seleccion-marcar", "seleccion-desmarcar"].forEach(id => { $(id).disabled = true; });
    try {
      await R.api.articulos.actualizarVarios(codigos, { [campo]: valor });
      aplicarLocal(codigos, campo, valor);
      toast(`${nombre}: ${valor ? "marcado" : "desmarcado"} en ${plural(codigos.length, "artículo", "artículos")}.`);
      pintar();
    } catch (e) { toast(e.message, "error", 6000); }
    finally { ["seleccion-marcar", "seleccion-desmarcar"].forEach(id => { $(id).disabled = false; }); }
  }

  function elegir(input, conShift) {
    const i = Number(input.closest("tr").dataset.i), lista = mostradas();
    // Shift + clic: elige (o saca) todo el rango desde la última fila tocada
    const desde = conShift && ultimoClic != null ? Math.min(ultimoClic, i) : i;
    const hasta = conShift && ultimoClic != null ? Math.max(ultimoClic, i) : i;
    for (let k = desde; k <= hasta; k++) {
      if (input.checked) seleccion.add(lista[k].codigo); else seleccion.delete(lista[k].codigo);
    }
    ultimoClic = i;
    pintar();
  }

  // ---------- Descripción web rápida (ventanita sobre la celda) ----------
  let popIndice = null;       // fila de la tabla que se está editando
  let popTextoOriginal = "";

  const celdaDesc = i => document.querySelector(`#planilla-tabla tbody tr[data-i="${i}"] td.celda-desc`);

  function ubicarPop() {
    const td = popIndice != null && celdaDesc(popIndice), pop = $("pop-desc");
    if (!td) return cerrarPop(true);
    const c = td.getBoundingClientRect(), m = 8;
    pop.style.left = "0px"; pop.style.top = "0px";
    const p = pop.getBoundingClientRect();
    let left = Math.max(m, Math.min(c.left, window.innerWidth - p.width - m));
    // Abajo de la celda; si no entra, arriba
    let top = c.bottom + 4;
    if (top + p.height > window.innerHeight - m) top = Math.max(m, c.top - p.height - 4);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  function abrirPop(i) {
    const f = mostradas()[i];
    if (!f) return;
    popIndice = i;
    popTextoOriginal = f.descripcion_web || "";
    $("pop-desc-titulo").innerHTML = `${esc(f.codigo)} · ${esc(f.nombre)}<small>${esc(f.proveedor)} · OC ${esc(f.orden)}</small>`;
    $("pop-desc-texto").value = popTextoOriginal;
    $("pop-desc-ok").checked = true; // escribir la descripción casi siempre es dejarla lista
    document.querySelectorAll("#planilla-tabla tr.editando-desc").forEach(tr => tr.classList.remove("editando-desc"));
    $("pop-desc").hidden = false;
    ubicarPop();
    const t = $("pop-desc-texto");
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  }

  function cerrarPop(sinPreguntar) {
    if (popIndice == null) return true;
    if (!sinPreguntar && $("pop-desc-texto").value !== popTextoOriginal && !confirm("Hay cambios sin guardar en la descripción. ¿Descartarlos?")) return false;
    popIndice = null;
    $("pop-desc").hidden = true;
    return true;
  }

  async function guardarPop(seguir) {
    const lista = mostradas(), f = lista[popIndice];
    if (!f) return cerrarPop(true);
    const texto = $("pop-desc-texto").value.trim();
    const d = { descripcion_web: texto, descripcion_ok: $("pop-desc-ok").checked && texto !== "" };
    // El siguiente artículo de la lista (otro código), anotado antes de redibujar
    const siguiente = lista.slice(popIndice + 1).find(x => x.codigo !== f.codigo);
    ["pop-desc-guardar", "pop-desc-seguir"].forEach(id => { $(id).disabled = true; });
    try {
      await R.api.articulos.actualizar(f.codigo, d);
      Object.entries(d).forEach(([k, v]) => aplicarLocal([f.codigo], k, v));
      cerrarPop(true);
      pintar();
      if (seguir && siguiente) {
        const j = mostradas().findIndex(x => x.codigo === siguiente.codigo);
        if (j >= 0) { celdaDesc(j).scrollIntoView({ block: "nearest" }); abrirPop(j); }
      } else if (seguir) toast("Descripción guardada. No hay más artículos en la lista.");
      else toast("Descripción guardada.");
    } catch (e) { toast(e.message, "error", 6000); }
    finally { ["pop-desc-guardar", "pop-desc-seguir"].forEach(id => { $(id).disabled = false; }); }
  }

  // ---------- Columnas ----------
  function abrirColumnas() {
    const grupos = [...new Set(COLUMNAS.map(c => c.grupo))];
    $("columnas-lista").innerHTML = grupos.map(g => `<div class="grupo-columnas">${GRUPOS[g] || g}</div>
      <div class="lista-columnas">${COLUMNAS.filter(c => c.grupo === g).map(c => `<label>
        <input type="checkbox" value="${c.clave}" ${!ocultas.has(c.clave) || SIEMPRE.includes(c.clave) ? "checked" : ""} ${SIEMPRE.includes(c.clave) ? "disabled" : ""}> ${esc(c.titulo)}</label>`).join("")}</div>`).join("");
    $("dlg-columnas").showModal();
  }

  async function guardarColumnas() {
    const nuevas = [...$("columnas-lista").querySelectorAll("input:not(:checked)")].map(i => i.value).filter(k => !SIEMPRE.includes(k));
    try {
      await R.api.preferencias.guardar(nuevas);
      ocultas = new Set(nuevas);
      $("dlg-columnas").close();
      pintar();
      toast("Columnas guardadas.");
    } catch (e) { toast(e.message, "error", 6000); }
  }

  // ---------- Datos web del artículo (diálogo) ----------
  const CAMPOS_TEXTO = ["titulo_web", "descripcion_web", "tipo", "variantes", "cod_barra", "fecha_alta_web", "observaciones"];
  const CAMPOS_SI_NO = Object.keys(TILDES);

  function abrirArticulo(f) {
    editando = f;
    $("articulo-titulo").textContent = `${f.codigo} · ${f.nombre}`;
    CAMPOS_TEXTO.forEach(k => { $("ar-" + k).value = f[k] ?? ""; });
    CAMPOS_SI_NO.forEach(k => { $("ar-" + k).checked = !!f[k]; });
    $("dlg-articulo").showModal();
  }

  async function guardarArticulo(e) {
    e.preventDefault();
    const d = {};
    CAMPOS_TEXTO.forEach(k => { d[k] = $("ar-" + k).value; });
    CAMPOS_SI_NO.forEach(k => { d[k] = $("ar-" + k).checked; });
    $("articulo-guardar").disabled = true;
    try {
      await R.api.articulos.actualizar(editando.codigo, d);
      $("dlg-articulo").close();
      toast("Artículo actualizado.");
      await mostrar();
    } catch (err) { toast(err.message, "error", 6000); }
    finally { $("articulo-guardar").disabled = false; }
  }

  function exportar() {
    const lista = filtradas(), cols = visibles();
    if (!lista.length) return toast("No hay filas para exportar.", "error");
    const texto = (c, f) => {
      const v = f[c.clave];
      if (typeof v === "boolean") return v ? "Sí" : "No";
      if (c.clave === "estado") return ESTADOS[v] || v;
      if (/fecha|recepcion/.test(c.clave)) return v ? fmtFecha(v) : "";
      return v ?? "";
    };
    descargarCSV(`planilla-${hoy()}.csv`, [cols.map(c => c.titulo), ...lista.map(f => cols.map(c => texto(c, f)))]);
  }

  function iniciar() {
    $("planilla-buscar").addEventListener("input", pintar);
    $("planilla-proveedor").addEventListener("change", pintar);
    $("planilla-estado").addEventListener("change", pintar);
    $("planilla-falta").addEventListener("change", pintar);
    $("planilla-csv").addEventListener("click", exportar);
    $("planilla-columnas").addEventListener("click", abrirColumnas);
    $("columnas-guardar").addEventListener("click", guardarColumnas);
    $("columnas-todas").addEventListener("click", () => $("columnas-lista").querySelectorAll("input").forEach(i => { i.checked = true; }));
    $("form-articulo").addEventListener("submit", guardarArticulo);
    $("seleccion-marcar").addEventListener("click", () => marcarElegidos(true));
    $("seleccion-desmarcar").addEventListener("click", () => marcarElegidos(false));
    $("seleccion-limpiar").addEventListener("click", () => { seleccion.clear(); ultimoClic = null; pintar(); });

    // Ventanita de descripción
    $("pop-desc-guardar").addEventListener("click", () => guardarPop(false));
    $("pop-desc-seguir").addEventListener("click", () => guardarPop(true));
    $("pop-desc").addEventListener("keydown", e => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); guardarPop(true); }
      else if (e.key === "Escape") { e.preventDefault(); cerrarPop(); }
    });
    // Clic afuera cierra (pregunta si hay cambios); la tabla se puede mover y la ventanita la acompaña
    document.addEventListener("mousedown", e => {
      if (popIndice != null && !e.target.closest("#pop-desc") && !e.target.closest("td.celda-desc")) cerrarPop();
    });
    document.addEventListener("scroll", () => { if (popIndice != null) ubicarPop(); }, true);
    window.addEventListener("resize", () => { if (popIndice != null) ubicarPop(); });
    window.addEventListener("hashchange", () => cerrarPop(true));

    const tabla = $("planilla-tabla");
    tabla.addEventListener("change", e => {
      if (e.target.matches("input.tilde")) tildar(e.target);
      else if (e.target.id === "sel-todas") {
        mostradas().forEach(f => { if (e.target.checked) seleccion.add(f.codigo); else seleccion.delete(f.codigo); });
        ultimoClic = null;
        pintar();
      }
    });
    tabla.addEventListener("click", e => {
      if (!editable()) return;
      const sel = e.target.closest("input.sel:not(#sel-todas)");
      if (sel) return elegir(sel, e.shiftKey);
      const desc = e.target.closest("td.celda-desc");
      if (desc) { if (cerrarPop()) abrirPop(Number(desc.closest("tr").dataset.i)); return; }
      if (e.target.closest("input")) return; // las casillas se manejan en "change"
      // Clic en la celda de una casilla (no justo en el cuadradito): la tilda igual
      const celda = e.target.closest("td.celda-tilde");
      if (celda) { const c = celda.querySelector("input.tilde"); c.checked = !c.checked; return tildar(c); }
      if (e.target.closest("td.col-sel")) { const c = e.target.closest("td").querySelector("input.sel"); c.checked = !c.checked; return elegir(c, e.shiftKey); }
      const tr = e.target.closest("tr[data-i]");
      if (tr) abrirArticulo(mostradas()[Number(tr.dataset.i)]);
    });
  }

  R.vistaPlanilla = { iniciar, mostrar };
})(window.COMPRAS);
