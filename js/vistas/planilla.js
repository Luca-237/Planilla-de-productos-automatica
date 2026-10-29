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
  const urlWeb = codigo => String((window.COMPRAS_CONFIG || {}).urlBusquedaWeb || "").replace("{codigo}", encodeURIComponent(codigo));
  const si = v => v ? `<span class="si">Sí</span>` : `<span class="no">No</span>`;
  const casilla = campo => f => editable()
    ? `<input type="checkbox" class="tilde" data-campo="${campo}" ${f[campo] ? "checked" : ""} aria-label="${esc(TILDES[campo])} · ${esc(f.codigo)}">`
    : si(f[campo]);

  // Descripción web: vista de las primeras líneas; clic en la celda abre la ventanita rápida
  const vistaDesc = f => f.descripcion_web
    ? `<span class="desc-vista">${esc(f.descripcion_web)}</span>`
    : (editable() ? `<span class="desc-vacia">+ Agregar descripción</span>` : "—");

  // Resultado de la revisión en la web (lo guarda la función buscar-en-web)
  const WEB = {
    publicado: ["ok", "En la web"], solo_variantes: ["var", "Por variantes"], no_esta: ["no", "No está"],
  };
  const fechaHoraCorta = iso => iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  const chipWeb = f => {
    if (!f.web_estado) return `<span class="web-chip sin">Sin revisar</span>`;
    const [clase, texto] = WEB[f.web_estado];
    const titulo = `Revisado ${fechaHoraCorta(f.web_revisado_en)}${f.web_nombre ? " · " + f.web_nombre : ""}`;
    // Estaba tildado "Cargado web" pero ya no aparece: se bajó de la página
    if (f.web_estado === "no_esta" && f.cargado_web) return `<span class="web-chip alerta" title="${esc(titulo)}">No está (estaba cargado)</span>`;
    return f.web_url
      ? `<a class="web-chip ${clase}" href="${esc(f.web_url)}" target="_blank" rel="noopener" title="${esc(titulo)} · abrir en la web">${texto}</a>`
      : `<span class="web-chip ${clase}" title="${esc(titulo)}">${texto}</span>`;
  };

  // [clave, título, grupo, cómo se muestra, clase de la celda]
  const COLUMNAS = [
    // El código va siempre con el nombre corto del proveedor al lado (Target, Bagcherry…)
    ["codigo", "Código", "Compra", f => f.es_variante
      ? `<span class="variante-cod"><strong>${esc(f.codigo)}</strong>${f.color ? `<span class="tag-color">${esc(f.color)}</span>` : ""}</span>`
      : `<strong>${esc(f.codigo)}</strong>${etiquetaProveedor(f.proveedor, f.razon_social)}${f.n_variantes ? `<span class="tag-var">${f.n_variantes} ${f.n_variantes === 1 ? "variante" : "variantes"}</span>` : ""}`],
    ["nombre", "Nombre", "Compra"],
    // Descripción y casillas al lado del nombre, para no tener que desplazarse
    ["web_estado", "En la web", "Casillas", chipWeb],
    ["descripcion_web", "Descripción web", "Casillas", vistaDesc, "celda-desc"],
    ...Object.keys(TILDES).map(k => [k, TILDES[k], "Casillas", casilla(k), "num celda-tilde"]),
    ["orden", "Orden de compra", "Compra"],
    ["fecha_orden", "Fecha OC", "Compra", f => fmtFecha(f.fecha_orden)],
    ["proveedor", "Proveedor", "Compra"],
    ["razon_social", "Razón social", "Compra"],
    ["cantidad", "Cantidad", "Compra", f => f.es_variante ? "" : fmtNum(f.cantidad), "num"],
    ["precio_unitario", "Precio unit.", "Compra", f => f.es_variante ? "" : fmtPesos(f.precio_unitario), "num"],
    ["estado", "Estado", "Compra", f => chipEstado(f.estado)],
    ["recibido", "Llegó", "Compra", f => f.es_variante ? "" : fmtNum(f.recibido), "num"],
    ["pendiente", "Falta", "Compra", f => f.es_variante ? "" : fmtNum(f.pendiente), "num"],
    ["dias_desde_orden", "Días", "Compra", f => fmtNum(f.dias_desde_orden), "num"],
    ["ultima_recepcion", "Última llegada", "Compra", f => fmtFecha(f.ultima_recepcion)],
    ["tipo", "Tipo", "Web"],
    ["variantes", "Variantes", "Web"],
    ["cod_barra", "Cód. barra", "Web"],
    ["color", "Color", "Web"],
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
    const pasa = f => {
      if (!falta) return true;
      if (falta === "web_sin") return !f.web_estado;
      if (falta === "web_si") return ["publicado", "solo_variantes"].includes(f.web_estado);
      if (falta === "web_no") return f.web_estado === "no_esta";
      return ["sin_stock", "ya_no_esta"].includes(falta) ? !!f[falta] : !f[falta];
    };
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
      <tbody>${filasTabla.map((f, i) => `<tr class="${puede ? "clic" : ""} ${seleccion.has(f.codigo) ? "seleccionada" : ""} ${f.es_variante ? "fila-variante" : ""}" data-i="${i}">
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
      const guardado = await R.api.articulos.actualizar(f.codigo, { [campo]: valor });
      // Al marcar "Cargado web" la base completa sola la fecha de alta: se muestra enseguida
      if (campo === "cargado_web" && guardado && guardado.fecha_alta_web !== f.fecha_alta_web) { aplicarLocal([f.codigo], "fecha_alta_web", guardado.fecha_alta_web); pintar(); }
      // Si hay un filtro "Mostrar", la fila puede dejar de corresponder: se redibuja
      else if ($("planilla-falta").value === campo) pintar();
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
      const hechas = await R.api.articulos.actualizarVarios(codigos, { [campo]: valor });
      aplicarLocal(codigos, campo, valor);
      (hechas || []).forEach(h => aplicarLocal([h.codigo], "fecha_alta_web", h.fecha_alta_web));
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
    $("pop-desc-web").hidden = !(f.web_url || (f.cargado_web && urlWeb(f.codigo)));
    if (!$("pop-desc-web").hidden) $("pop-desc-web").href = f.web_url || urlWeb(f.codigo);
    pintarAvisoWeb(f);
    // Antes de escribir la descripción: si nunca se revisó, se revisa ahora (para no cargarla dos veces)
    if (!f.web_estado && editable()) revisarUno(f);
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

  function pintarAvisoWeb(f, revisando) {
    const el = $("pop-desc-estado");
    el.hidden = false;
    el.className = "pop-desc-web";
    if (revisando) { el.textContent = "Revisando si ya está en la web…"; return; }
    if (!f.web_estado) { el.hidden = true; return; }
    const cuando = `(revisado ${fechaHoraCorta(f.web_revisado_en)})`;
    if (f.web_estado === "publicado") { el.classList.add("ya"); el.textContent = `Ya está en la web ${cuando}: revisá que no sea un artículo ya cargado.`; }
    else if (f.web_estado === "solo_variantes") { el.classList.add("ya"); el.textContent = `En la web están sus variantes ${cuando}, no el código principal.`; }
    else el.textContent = `No está en la web ${cuando}.`;
  }

  async function revisarUno(f) {
    pintarAvisoWeb(f, true);
    try {
      const [r] = await R.api.web.revisar([f.codigo]);
      if (r.estado === "error") throw new Error(r.error);
      aplicarWeb([r]);
      pintar();
    } catch (e) { toast(`No se pudo revisar en la web: ${e.message}`, "error", 6000); }
    // La ventanita puede seguir abierta sobre otra fila: solo se actualiza si es la misma
    const actual = popIndice != null && mostradas()[popIndice];
    if (actual && actual.codigo === f.codigo) {
      pintarAvisoWeb(actual);
      $("pop-desc-web").hidden = !actual.web_url;
      if (actual.web_url) $("pop-desc-web").href = actual.web_url;
    }
  }

  // Pasa los resultados de la función a las filas que se ven (todas las del mismo código)
  function aplicarWeb(resultados) {
    const ahora = new Date().toISOString();
    resultados.filter(r => r.estado !== "error").forEach(r => {
      aplicarLocal([r.codigo], "web_estado", r.estado);
      aplicarLocal([r.codigo], "web_url", r.url);
      aplicarLocal([r.codigo], "web_nombre", r.nombre);
      aplicarLocal([r.codigo], "web_revisado_en", ahora);
    });
  }

  // ---------- Revisar en la web (varios) ----------
  // Los elegidos; si no hay elegidos, todos los que se ven con los filtros. De a 40 por pedido.
  let revisando = false;
  async function revisarEnWeb() {
    if (revisando) return;
    const codigos = seleccion.size ? [...seleccion] : [...new Set(filtradas().map(f => f.codigo))];
    if (!codigos.length) return toast("No hay artículos para revisar.", "error");
    if (codigos.length > 120 && !confirm(`Se van a revisar ${fmtNum(codigos.length)} artículos en la web. Tarda más o menos ${Math.ceil(codigos.length / 120)} minuto(s). ¿Seguir?`)) return;
    revisando = true;
    const boton = $("planilla-revisar-web"), texto = $("planilla-revisar-texto");
    boton.disabled = true;
    const cuenta = { publicado: 0, solo_variantes: 0, no_esta: 0, error: 0 };
    try {
      for (let i = 0; i < codigos.length; i += 40) {
        texto.textContent = `Revisando ${fmtNum(Math.min(i + 40, codigos.length))} de ${fmtNum(codigos.length)}…`;
        const resultados = await R.api.web.revisar(codigos.slice(i, i + 40));
        resultados.forEach(r => { cuenta[r.estado] = (cuenta[r.estado] || 0) + 1; });
        aplicarWeb(resultados);
        pintar();
      }
      const partes = [`${fmtNum(cuenta.publicado)} en la web`, `${fmtNum(cuenta.solo_variantes)} por variantes`, `${fmtNum(cuenta.no_esta)} no están`];
      if (cuenta.error) partes.push(`${fmtNum(cuenta.error)} sin respuesta de la tienda (quedan como estaban)`);
      toast(`Revisados ${fmtNum(codigos.length)}: ${partes.join(", ")}.`, cuenta.error ? "error" : "ok", 8000);
    } catch (e) { toast(e.message, "error", 7000); }
    finally { revisando = false; boton.disabled = false; texto.textContent = "Revisar en la web"; }
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

  // ---------- Pantalla completa (solo la planilla) ----------
  // Tapa menú y barra con la planilla y, si el navegador deja, también pasa a pantalla completa de verdad.
  function pantallaCompleta(activar) {
    const sec = $("vista-planilla"), on = activar === undefined ? !sec.classList.contains("pantalla-completa") : activar;
    if (on === sec.classList.contains("pantalla-completa")) return;
    sec.classList.toggle("pantalla-completa", on);
    document.body.classList.toggle("sin-scroll", on);
    $("planilla-completa-texto").textContent = on ? "Salir de pantalla completa" : "Pantalla completa";
    try {
      if (on && !document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
      else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    } catch (e) { /* sin pantalla completa del navegador queda la del sitio */ }
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
  const CAMPOS_TEXTO = ["titulo_web", "descripcion_web", "tipo", "cod_barra", "fecha_alta_web", "observaciones"];
  const CAMPOS_SI_NO = Object.keys(TILDES);

  function abrirArticulo(f) {
    editando = f;
    $("articulo-titulo").textContent = `${f.codigo} · ${f.nombre}`;
    CAMPOS_TEXTO.forEach(k => { $("ar-" + k).value = f[k] ?? ""; });
    CAMPOS_SI_NO.forEach(k => { $("ar-" + k).checked = !!f[k]; });
    $("ar-color").value = f.color ? `${f.color} (${f.color_codigo})` : "";
    $("ar-colores").innerHTML = "";
    $("dlg-articulo").showModal();
    pintarVariantes();
  }

  // ---------- Variantes por color ----------
  // Cada color del catálogo crea un artículo propio: código del principal + sufijo (123445-WHI)
  let catalogo = [];
  async function pintarVariantes(preelegir = []) {
    const f = editando, caja = $("ar-variantes-caja");
    const esVariante = f.es_variante || f.tipo === "VARIANTE";
    caja.hidden = esVariante;
    if (esVariante) return;
    const hijas = [...new Map(filas.filter(x => x.es_variante && x.padre === f.codigo).map(x => [x.codigo, x])).values()];
    $("ar-variantes-lista").innerHTML = hijas.length
      ? hijas.map(h => `<span class="chip-var">${esc(h.codigo)}${h.color ? ` <small>${esc(h.color)}</small>` : ""}</span>`).join("")
      : `<span class="hint" style="margin:0">Todavía no tiene variantes.</span>`;
    const marcados = new Set([...$("ar-colores").querySelectorAll("input:checked")].map(i => Number(i.value)).concat(preelegir));
    try { catalogo = await R.api.colores.listar(); } catch (e) { toast(e.message, "error"); }
    if (editando !== f) return; // se cerró o se abrió otro mientras cargaba
    const usados = new Set(hijas.map(h => h.color_codigo));
    const libres = catalogo.filter(c => c.activo && !usados.has(c.codigo));
    $("ar-colores").innerHTML = libres.map(c => `<label class="check"><input type="checkbox" value="${c.id}" ${marcados.has(c.id) ? "checked" : ""}> <strong>${esc(c.codigo)}</strong> ${esc(c.nombre)} <small>→ ${esc(f.codigo)}-${esc(c.codigo)}</small></label>`).join("")
      || `<span class="hint" style="margin:0">Ya tiene variantes con todos los colores del catálogo. Agregá un color nuevo abajo.</span>`;
  }

  async function crearVariantes() {
    const ids = [...$("ar-colores").querySelectorAll("input:checked")].map(i => Number(i.value));
    if (!ids.length) return toast("Elegí al menos un color.", "error");
    const codigo = editando.codigo;
    $("ar-crear-variantes").disabled = true;
    try {
      const r = await R.api.articulos.crearVariantes(codigo, ids);
      const partes = [r.creadas.length ? `Se crearon ${plural(r.creadas.length, "variante", "variantes")}: ${r.creadas.join(", ")}.` : "",
        r.existentes.length ? `Ya existían: ${r.existentes.join(", ")}.` : "",
        r.omitidas.length ? `No se crearon (ese código ya es de otro artículo): ${r.omitidas.join(", ")}.` : ""].filter(Boolean);
      toast(partes.join(" "), r.omitidas.length ? "error" : "ok", 7000);
      $("ar-colores").innerHTML = "";
      await mostrar();
      editando = filas.find(x => x.codigo === codigo && !x.es_variante) || editando;
      pintarVariantes();
    } catch (e) { toast(e.message, "error", 6000); }
    finally { $("ar-crear-variantes").disabled = false; }
  }

  async function colorNuevo() {
    const codigo = $("ar-nc-codigo").value.trim(), nombre = $("ar-nc-nombre").value.trim();
    if (!codigo || !nombre) return toast("Escribí el sufijo y el nombre del color.", "error");
    try {
      const c = await R.api.colores.crear(codigo, nombre);
      $("ar-nc-codigo").value = ""; $("ar-nc-nombre").value = "";
      toast(`Color "${nombre}" agregado al catálogo (${c.codigo}). Ya sirve para cualquier producto.`);
      pintarVariantes([c.id]);
    } catch (e) { toast(e.message, "error", 6000); }
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
    $("ar-crear-variantes").addEventListener("click", crearVariantes);
    $("ar-nc-agregar").addEventListener("click", colorNuevo);
    $("planilla-completa").addEventListener("click", () => pantallaCompleta());
    $("planilla-revisar-web").addEventListener("click", revisarEnWeb);
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !e.defaultPrevented && $("vista-planilla").classList.contains("pantalla-completa") && !document.querySelector("dialog[open]")) pantallaCompleta(false);
    });
    document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) pantallaCompleta(false); });
    window.addEventListener("hashchange", () => pantallaCompleta(false));
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
      if (!editable() || e.target.closest("a")) return; // los enlaces (buscar en la web) hacen lo suyo
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
