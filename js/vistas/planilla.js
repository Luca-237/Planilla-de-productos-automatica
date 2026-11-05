// =====================================================================
//  Vista: Planilla. Reemplaza a la planilla "Proceso Ecommerce": una
//  fila por artículo de cada OC, con lo que llegó y los datos de la web.
//  Cada usuario elige qué columnas ve (se guarda en "preferencias").
//  Las casillas (Foto, Descripción OK, Sin stock…) se tildan en la misma
//  tabla, una por una o a varios artículos juntos (columna de selección,
//  con Shift + clic para elegir un rango como en Excel). Clic en una fila
//  la elige; "Editar producto" (arriba) abre los datos del artículo elegido.
// =====================================================================
(function (R) {
  const { $, esc, norm, fmtFecha, fmtNum, fmtPesos, chipEstado, descargarCSV, hoy, toast, ESTADOS, etiquetaProveedor, plural } = R.util;
  const app = () => R.app;
  const MAX_FILAS = 20000; // las filas se dibujan a pedido: ya no hace falta limitarlas

  // Casillas que se tildan desde la tabla. Los datos web son del artículo:
  // tildar en una fila tilda todas las filas del mismo código.
  // "Llegó" queda marcado solo cuando entra mercadería y no se desmarca nunca solo: si el artículo estuvo
  // en la web y después deja de estar, sigue marcado y así se nota que lo tuvimos y nos quedamos sin stock.
  const TILDES = {
    llego: "Llegó", foto: "Foto", descripcion_ok: "Descripción OK", sin_stock: "Sin stock",
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
    // Las variantes (colores) no llevan casilla propia: es del artículo padre
    ...Object.keys(TILDES).map(k => [k, TILDES[k], "Casillas", k === "llego" ? (f => f.es_variante ? "" : casilla(k)(f)) : casilla(k), "num celda-tilde"]),
    ["orden", "Orden de compra", "Compra"],
    ["fecha_orden", "Fecha OC", "Compra", f => fmtFecha(f.fecha_orden)],
    ["proveedor", "Proveedor", "Compra"],
    ["razon_social", "Razón social", "Compra"],
    ["cantidad", "Cantidad", "Compra", f => f.es_variante ? "" : fmtNum(f.cantidad), "num"],
    ["precio_unitario", "Precio unit.", "Compra", f => f.es_variante ? "" : fmtPesos(f.precio_unitario), "num"],
    ["estado", "Estado", "Compra", f => f.estado ? chipEstado(f.estado) : ""],
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
  let conOrden = true; // interruptor "Con orden de compra": activado al abrir; apagado muestra los artículos sin orden
  let ocultas = new Set();
  let editando = null;
  const seleccion = new Set(); // códigos elegidos para marcar varios juntos
  let ultimoClic = null;       // índice de la última fila tildada en la selección (para Shift + clic)

  // Orden de las columnas y orden de las filas: cada persona lo arma a su gusto y queda en este navegador
  const CLAVE_VISTA = "compras.planilla.vista";
  const ORDENABLES = ["fecha_alta_web", "fecha_orden", "ultima_recepcion"]; // clic en el encabezado: más recientes / más antiguas
  let ordenCols = [];                    // claves en el orden elegido (las que falten van al final, como vienen)
  let ordenFilas = null;                 // { clave, dir: "desc" | "asc" } o null
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE_VISTA) || "null") || {};
    if (Array.isArray(g.columnas)) ordenCols = g.columnas.filter(k => COLUMNAS.some(c => c.clave === k));
    if (g.filas && ORDENABLES.includes(g.filas.clave) && ["asc", "desc"].includes(g.filas.dir)) ordenFilas = g.filas;
  } catch (e) { /* sin lo guardado queda el orden de siempre */ }
  const guardarVista = () => { try { localStorage.setItem(CLAVE_VISTA, JSON.stringify({ columnas: ordenCols, filas: ordenFilas })); } catch (e) { /* no pasa nada */ } };

  const posicion = c => { const i = ordenCols.indexOf(c.clave); return i < 0 ? 1e6 + COLUMNAS.indexOf(c) : i; };
  const columnasEnOrden = () => [...COLUMNAS].sort((a, b) => posicion(a) - posicion(b));
  const visibles = () => columnasEnOrden().filter(c => SIEMPRE.includes(c.clave) || !ocultas.has(c.clave));

  // Mueve una columna a la posición de otra (entre todas, también las ocultas)
  function moverColumna(desde, hasta) {
    if (desde === hasta) return;
    const claves = columnasEnOrden().map(c => c.clave), i = claves.indexOf(desde), j = claves.indexOf(hasta);
    if (i < 0 || j < 0) return;
    claves.splice(i, 1); claves.splice(j, 0, desde);
    ordenCols = claves; guardarVista(); pintar();
  }

  // Encabezado de fecha: 1.º clic más recientes, 2.º más antiguas, 3.º vuelve al orden de siempre
  function ordenarPor(clave) {
    ordenFilas = !ordenFilas || ordenFilas.clave !== clave ? { clave, dir: "desc" } : ordenFilas.dir === "desc" ? { clave, dir: "asc" } : null;
    guardarVista(); pintar();
  }
  const aplicarOrden = lista => {
    if (!ordenFilas) return lista;
    const { clave, dir } = ordenFilas, k = dir === "desc" ? -1 : 1;
    // Las filas sin fecha van siempre al final
    return [...lista].sort((a, b) => {
      const x = a[clave] || "", y = b[clave] || "";
      if (!x || !y) return x === y ? 0 : x ? -1 : 1;
      return x < y ? -k : x > y ? k : 0;
    });
  };
  const ICO_ORDEN = {
    desc: `<path d="m6 9 6 6 6-6"/>`, asc: `<path d="m18 15-6-6-6 6"/>`, sin: `<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>`,
  };
  const flechaOrden = clave => {
    const e = ordenFilas && ordenFilas.clave === clave ? ordenFilas.dir : "sin";
    return `<svg class="orden-ico ${e === "sin" ? "sin" : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO_ORDEN[e]}</svg>`;
  };
  const titulosOrden = clave => !ordenFilas || ordenFilas.clave !== clave ? "Tocá para ordenar: más recientes primero" : ordenFilas.dir === "desc" ? "Más recientes primero · tocá para ver las más antiguas" : "Más antiguas primero · tocá para quitar el orden";
  const mostradas = () => $("planilla-tabla")._filas || [];

  // Lo que piden los filtros de arriba (buscador, proveedor, estado y "Mostrar"), como una función por fila
  function criterioFiltros() {
    const q = norm($("planilla-buscar").value), prov = $("planilla-proveedor").value, est = $("planilla-estado").value;
    const falta = $("planilla-falta").value;
    // "sin_stock" y "ya_no_esta" muestran los marcados; el resto, los que faltan
    const pasa = f => {
      if (!falta) return true;
      // Como el filtro "SUBIR PAGINA" de la planilla anterior: mercadería que llegó, todavía no cargada en la web y con stock
      if (falta === "subir_web") return f.llego && !f.cargado_web && !f.sin_stock;
      if (falta === "web_sin") return !f.web_estado;
      if (falta === "web_si") return ["publicado", "solo_variantes"].includes(f.web_estado);
      if (falta === "web_no") return f.web_estado === "no_esta";
      return ["sin_stock", "ya_no_esta"].includes(falta) ? !!f[falta] : !f[falta];
    };
    return f => (!prov || f.proveedor === prov) && (!est || f.estado === est) && pasa(f)
      && (!q || norm(`${f.codigo} ${f.nombre} ${f.orden} ${f.proveedor} ${f.razon_social || ""}`).includes(q));
  }

  function filtradas() {
    const lista = filas.filter(criterioFiltros());
    // "Subir a la página" es una lista de trabajo: cada artículo una sola vez, aunque esté en varias órdenes (queda la más nueva)
    if ($("planilla-falta").value === "subir_web") { const vistos = new Set(); return aplicarOrden(lista.filter(f => !vistos.has(f.codigo) && vistos.add(f.codigo))); }
    return aplicarOrden(lista);
  }

  // ---------- Filas a pedido (la tabla tiene miles de filas: solo se dibujan las que se ven) ----------
  // Con todas las filas dibujadas había más de 30.000 elementos y el desplazamiento se cortaba. Ahora se
  // dibuja lo que se ve más unas filas de margen; arriba y abajo hay dos filas vacías ("espaciadores") que
  // dan la altura del resto, así la barra de desplazamiento se comporta como si estuvieran todas.
  const ALTO_ESTIMADO = 74, MARGEN_FILAS = 12;
  const ANCHOS_COL = { codigo: 190, nombre: 230, web_estado: 130, descripcion_web: 300, orden: 150, fecha_orden: 110, proveedor: 170,
    razon_social: 200, estado: 120, observaciones: 260, titulo_web: 230, estado_descripcion: 160, variantes: 140, ultima_recepcion: 120, fecha_alta_web: 120 };
  const anchoCol = c => ANCHOS_COL[c.clave] || (c.clase.includes("celda-tilde") ? 96 : c.clase.includes("num") ? 100 : 120);
  let alturas = [], acum = [0], ventana = { a: -1, b: -1 }, esperaDesplazar = 0;

  function recalcularAcum() {
    acum = new Array(alturas.length + 1);
    acum[0] = 0;
    for (let i = 0; i < alturas.length; i++) acum[i + 1] = acum[i] + alturas[i];
  }
  // Primera fila que termina después de la posición y
  function filaEn(y) {
    let lo = 0, hi = alturas.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (acum[m + 1] <= y) lo = m + 1; else hi = m; }
    return lo;
  }
  const filaHtml = (f, i, cols, puede, ok) => `<tr class="${puede ? "clic" : ""} ${seleccion.has(f.codigo) ? "seleccionada" : ""} ${f.es_variante ? "fila-variante" : ""} ${ok(f) ? "" : "fuera-filtro"}" data-i="${i}">
        ${puede ? `<td class="col-sel"><input type="checkbox" class="sel" ${seleccion.has(f.codigo) ? "checked" : ""} aria-label="Elegir ${esc(f.codigo)}"></td>` : ""}
        ${cols.map(c => `<td class="${c.clase}" data-c="${c.clave}">${c.ver(f)}</td>`).join("")}</tr>`;

  function renderVentana(forzar) {
    const tabla = $("planilla-tabla"), lista = mostradas();
    if (!lista.length || !tabla.tBodies[0]) return;
    const w = tabla.closest(".tabla-wrap"), cols = visibles(), puede = editable();
    const cab = tabla.tHead ? tabla.tHead.offsetHeight : 0;           // el encabezado ocupa lugar dentro del desplazamiento
    const arriba = Math.max(0, w.scrollTop - cab), alto = w.clientHeight || 600;
    const va = filaEn(arriba), vb = filaEn(arriba + alto) + 1;         // filas que se ven
    // Fila de referencia y dónde está en pantalla: si al medir las filas nuevas cambian las alturas estimadas,
    // se corrige el desplazamiento para que lo que se ve no se mueva (antes saltaba y "comía" el scroll hacia arriba)
    const anclaI = va, anclaPos = acum[anclaI] + cab - w.scrollTop;
    // Mientras lo que se ve siga bien adentro de lo dibujado no se toca nada: se redibuja en tandas, no en cada fila
    if (!forzar && ventana.a >= 0 && (va - ventana.a >= 4 || ventana.a === 0) && (ventana.b - vb >= 4 || ventana.b === lista.length)) return;
    const a = Math.max(0, va - MARGEN_FILAS), b = Math.min(lista.length, vb + MARGEN_FILAS);
    const tbody = tabla.tBodies[0], ncol = cols.length + (puede ? 1 : 0);
    const espaciador = alto => `<tr class="esp" aria-hidden="true"><td colspan="${ncol}" style="height:${alto}px"></td></tr>`;
    const ok = criterioFiltros();
    const html = (desde, hasta) => lista.slice(desde, hasta).map((fila, k) => filaHtml(fila, desde + k, cols, puede, ok)).join("");
    const solapa = !forzar && ventana.a >= 0 && a < ventana.b && b > ventana.a;
    let nuevas = [];
    if (!solapa) {
      // Los espaciadores nacen con su altura estimada: con altura 0 la tabla se achicaba de golpe al medir las filas
      // y el navegador acomodaba el desplazamiento cerca del principio (la barra "saltaba" o no dejaba subir desde el final)
      tbody.innerHTML = espaciador(acum[a]) + html(a, b) + espaciador(acum[lista.length] - acum[b]);
      nuevas = [...tbody.querySelectorAll("tr[data-i]")];
    } else {
      // Se conservan las filas que siguen a la vista: solo se sacan las que quedaron lejos y se agregan las que entran
      const arribaEsp = tbody.firstElementChild, abajoEsp = tbody.lastElementChild;
      while (arribaEsp.nextElementSibling !== abajoEsp && Number(arribaEsp.nextElementSibling.dataset.i) < a) arribaEsp.nextElementSibling.remove();
      while (abajoEsp.previousElementSibling !== arribaEsp && Number(abajoEsp.previousElementSibling.dataset.i) >= b) abajoEsp.previousElementSibling.remove();
      if (a < ventana.a) { arribaEsp.insertAdjacentHTML("afterend", html(a, Math.min(ventana.a, b))); }
      if (b > ventana.b) { abajoEsp.insertAdjacentHTML("beforebegin", html(Math.max(ventana.b, a), b)); }
      // Los espaciadores se ajustan antes de medir, para que la altura total no cambie mientras se miden las filas nuevas
      arribaEsp.firstElementChild.style.height = acum[a] + "px";
      abajoEsp.firstElementChild.style.height = (acum[lista.length] - acum[b]) + "px";
      nuevas = [...tbody.querySelectorAll("tr[data-i]")].filter(tr => { const i = Number(tr.dataset.i); return i < ventana.a || i >= ventana.b; });
    }
    ventana = { a, b };
    // Se miden las filas nuevas para que las alturas estimadas se vayan corrigiendo
    let cambio = false;
    nuevas.forEach(tr => {
      const i = Number(tr.dataset.i), h = tr.offsetHeight;
      if (h && Math.abs(h - alturas[i]) > 1) { alturas[i] = h; cambio = true; }
    });
    if (cambio) recalcularAcum();
    const esp = tbody.querySelectorAll("tr.esp td");
    esp[0].style.height = acum[a] + "px";
    esp[1].style.height = (acum[lista.length] - acum[b]) + "px";
    if (cambio) {
      const dif = (acum[anclaI] + cab - w.scrollTop) - anclaPos;
      if (Math.abs(dif) > 1) w.scrollTop += dif;
    }
    marcarRango();
  }

  // Lleva una fila a la vista aunque no esté dibujada (ej. al pasar a la descripción siguiente)
  function asegurarFila(i) {
    if (i >= ventana.a + 2 && i < ventana.b - 2) return;
    const w = $("planilla-tabla").closest(".tabla-wrap");
    w.scrollTop = Math.max(0, acum[i] - w.clientHeight / 3);
    renderVentana(true);
  }

  function pintar() {
    rango = null; // las filas pueden ser otras
    const lista = filtradas(), cols = visibles(), filasTabla = lista.slice(0, MAX_FILAS);
    const puede = editable();
    const todasElegidas = puede && filasTabla.length && filasTabla.every(f => seleccion.has(f.codigo));
    const tabla = $("planilla-tabla"), ancho = cols.reduce((n, c) => n + anchoCol(c), puede ? 38 : 0);
    // Columnas de ancho fijo: las filas se dibujan de a pocas al desplazarse y, con ancho automático, las columnas saltarían
    tabla.style.tableLayout = "fixed"; tabla.style.width = ancho + "px"; tabla.style.minWidth = "100%";
    tabla.innerHTML = `<colgroup>${puede ? '<col style="width:38px">' : ""}${cols.map(c => `<col style="width:${anchoCol(c)}px">`).join("")}</colgroup><thead><tr>
        ${puede ? `<th class="col-sel"><input type="checkbox" class="sel" id="sel-todas" ${todasElegidas ? "checked" : ""} aria-label="Elegir todas las filas que se ven"></th>` : ""}
        ${cols.map(c => ORDENABLES.includes(c.clave)
          ? `<th class="${c.clase.includes("num") ? "num" : ""} th-orden" data-c="${c.clave}" draggable="true" title="${titulosOrden(c.clave)} (arrastrá el encabezado para mover la columna)"><span class="th-txt">${esc(c.titulo)}${flechaOrden(c.clave)}</span></th>`
          : `<th class="${c.clase.includes("num") ? "num" : ""}" data-c="${c.clave}" draggable="true" title="Arrastrá el encabezado para mover la columna">${esc(c.titulo)}</th>`).join("")}</tr></thead>
      <tbody>${filasTabla.length ? "" : `<tr><td colspan="${cols.length + (puede ? 1 : 0)}" class="vacio">${filas.length ? "Nada coincide con el filtro." : (conOrden ? "Todavía no hay órdenes de compra cargadas." : "No hay artículos sin orden de compra.")}</td></tr>`}</tbody>`;
    $("planilla-tabla")._filas = filasTabla;
    // Altura de cada fila: se estima y se corrige al medir lo dibujado
    alturas = new Array(filasTabla.length).fill(ALTO_ESTIMADO);
    recalcularAcum();
    ventana = { a: -1, b: -1 };
    renderVentana(true);
    $("planilla-pie").textContent = [
      lista.length > MAX_FILAS ? `Se muestran las primeras ${fmtNum(MAX_FILAS)} de ${fmtNum(lista.length)} filas: usá el buscador o los filtros.` :
        lista.length !== filas.length ? `Mostrando ${fmtNum(lista.length)} de ${fmtNum(filas.length)} filas.` : `${fmtNum(filas.length)} filas.`,
      puede ? "Las casillas se guardan al tildarlas. Clic en la descripción para escribirla ahí mismo (Ctrl+Enter guarda y pasa al siguiente). Clic en el código, el nombre o el resto de la fila: la elige (Shift + clic elige un rango); con un solo artículo elegido, \"Editar producto\" (arriba) abre todos sus datos." : "",
    ].filter(Boolean).join(" ");
    pintarBarraSeleccion();
    marcarFueraDeFiltro();
  }

  // Redibuja solo esas celdas de las filas de esos códigos (rehacer las ~1000 filas de la tabla
  // en cada cambio la ponía lenta). Aunque la fila deje de coincidir con los filtros (por ejemplo,
  // se desmarca "Llegó" con "Mostrar" en "Sin marcar como llegados"), queda a la vista, atenuada:
  // la lista se vuelve a filtrar recién cuando se toca "Actualizar lista" o se cambia un filtro.
  function refrescarCeldas(codigos, claves) {
    const set = new Set(codigos), lista = mostradas(), cols = visibles().filter(c => claves.includes(c.clave));
    if (cols.length) {
      document.querySelectorAll("#planilla-tabla tbody tr[data-i]").forEach(tr => {
        const fila = lista[Number(tr.dataset.i)];
        if (!fila || !set.has(fila.codigo)) return;
        cols.forEach(c => { const td = tr.querySelector(`td[data-c="${c.clave}"]`); if (td) td.innerHTML = c.ver(fila); });
      });
    }
    marcarFueraDeFiltro();
  }

  // Atenúa las filas a la vista que ya no coinciden con los filtros y avisa cuántas son
  function marcarFueraDeFiltro() {
    const ok = criterioFiltros(), lista = mostradas();
    document.querySelectorAll("#planilla-tabla tbody tr[data-i]").forEach(tr => {
      const fila = lista[Number(tr.dataset.i)];
      if (fila) tr.classList.toggle("fuera-filtro", !ok(fila));
    });
    const n = lista.filter(f => !ok(f)).length;
    $("planilla-fuera").hidden = !n;
    $("fuera-cuantas").textContent = !n ? "" : n === 1 ? "1 fila ya no coincide con el filtro (se ve atenuada)."
      : `${fmtNum(n)} filas ya no coinciden con el filtro (se ven atenuadas).`;
  }

  // Marca lo elegido en las filas a la vista, sin rehacer la tabla
  function pintarSeleccion() {
    const lista = mostradas();
    document.querySelectorAll("#planilla-tabla tbody tr[data-i]").forEach(tr => {
      const si = seleccion.has(lista[Number(tr.dataset.i)].codigo);
      tr.classList.toggle("seleccionada", si);
      const c = tr.querySelector("input.sel");
      if (c) c.checked = si;
    });
    const todas = $("sel-todas");
    if (todas) todas.checked = lista.length > 0 && lista.every(x => seleccion.has(x.codigo));
    pintarBarraSeleccion();
    marcarRango();
  }

  function pintarBarraSeleccion() {
    // "Editar producto" abre los datos de un artículo: hace falta uno solo elegido
    const editar = $("planilla-editar");
    editar.disabled = seleccion.size !== 1;
    editar.title = seleccion.size === 1 ? `Editar todos los datos de ${[...seleccion][0]}`
      : seleccion.size ? "Para editar, dejá elegido un solo artículo" : "Elegí un artículo (clic en su código o su nombre) para editar todos sus datos";
    $("planilla-seleccion").hidden = !seleccion.size;
    $("seleccion-cuantos").textContent = `${plural(seleccion.size, "artículo elegido", "artículos elegidos")}:`;
  }

  async function mostrar() {
    $("planilla-tabla").innerHTML = R.util.esqueleto.tabla(9, 9);
    const conOrdenAlPedir = conOrden;
    try {
      // "Con orden de compra" (siempre al abrir): una fila por artículo de cada orden. Apagado: los artículos que todavía no tienen orden.
      const fuente = conOrden ? R.api.vistas.planilla : R.api.vistas.articulosSinOrden;
      const [datos, pref] = await Promise.all([
        fuente({ alActualizar: d => { if (conOrden === conOrdenAlPedir) actualizadas(d); } }), R.api.preferencias.obtener()]);
      if (conOrden !== conOrdenAlPedir) return; // se cambió el interruptor mientras cargaba: ya se pidió el otro conjunto
      filas = datos;
      ocultas = new Set(pref || OCULTAS_DE_ENTRADA);
    } catch (e) {
      $("planilla-tabla").innerHTML = `<tbody><tr><td>${esc(e.message)}</td></tr></tbody>`;
      return;
    }
    repintarTodo();
  }

  function repintarTodo() {
    // Lo elegido que ya no existe se descarta
    const codigos = new Set(filas.map(f => f.codigo));
    [...seleccion].forEach(c => { if (!codigos.has(c)) seleccion.delete(c); });
    $("planilla-proveedor").innerHTML = app().opcionesProveedor(filas, $("planilla-proveedor").value);
    const est = $("planilla-estado").value;
    $("planilla-estado").innerHTML = `<option value="">Todos</option>` +
      Object.entries(ESTADOS).map(([v, t]) => `<option value="${v}" ${v === est ? "selected" : ""}>${t}</option>`).join("");
    pintar();
  }

  // La planilla se abrió con lo guardado en el navegador y llegaron datos más nuevos de la base:
  // se cambian sin cortar lo que se está haciendo (escribiendo una descripción o revisando en la web)
  function actualizadas(datos) {
    if (popIndice != null || revisionWeb) return;
    filas = datos;
    repintarTodo();
  }

  // ---------- Selección de celdas por arrastre (como en Sheets) y copiar ----------
  // Se arrastra con el mouse sobre la tabla y se copia con Ctrl+C (o el botón Copiar): sale como texto con
  // tabuladores, listo para pegar en una planilla u otro programa. Un clic suelto sigue abriendo lo de siempre.
  let rango = null;                   // { i1, i2, c1, c2 }: filas de la tabla y columnas visibles
  let codigoACopiar = null;           // código de la última celda "Código" tocada: Ctrl+C copia solo eso
  let ancla = null, arrastrando = false, huboArrastre = false, ultimoPunto = null, autoScroll = null;

  const celdaDe = el => {
    const td = el && el.closest && el.closest("#planilla-tabla td[data-c]");
    if (!td) return null;
    const c = visibles().findIndex(x => x.clave === td.dataset.c);
    return c < 0 ? null : { i: Number(td.parentElement.dataset.i), c };
  };

  function marcarRango() {
    document.querySelectorAll("#planilla-tabla td.rg").forEach(td => td.classList.remove("rg", "rg-t", "rg-b", "rg-l", "rg-r"));
    if (rango) {
      const cols = visibles();
      document.querySelectorAll("#planilla-tabla tbody tr[data-i]").forEach(tr => {
        const i = Number(tr.dataset.i);
        if (i < rango.i1 || i > rango.i2) return;
        tr.querySelectorAll("td[data-c]").forEach(td => {
          const c = cols.findIndex(x => x.clave === td.dataset.c);
          if (c < rango.c1 || c > rango.c2) return;
          td.classList.add("rg");
          if (i === rango.i1) td.classList.add("rg-t");
          if (i === rango.i2) td.classList.add("rg-b");
          if (c === rango.c1) td.classList.add("rg-l");
          if (c === rango.c2) td.classList.add("rg-r");
        });
      });
      const f = rango.i2 - rango.i1 + 1, c = rango.c2 - rango.c1 + 1;
      $("rango-cuantas").textContent = `${plural(f, "fila", "filas")} × ${plural(c, "columna", "columnas")} elegidas:`;
    }
    $("planilla-rango").hidden = !rango;
  }

  function quitarRango() { if (!rango) return; rango = null; marcarRango(); }

  function extenderRango(x, y) {
    const cel = celdaDe(document.elementFromPoint(x, y));
    if (!cel) return;
    if (!huboArrastre && cel.i === ancla.i && cel.c === ancla.c) return;
    huboArrastre = true;
    rango = { i1: Math.min(ancla.i, cel.i), i2: Math.max(ancla.i, cel.i), c1: Math.min(ancla.c, cel.c), c2: Math.max(ancla.c, cel.c) };
    marcarRango();
    const s = window.getSelection(); if (s) s.removeAllRanges();
  }

  // Lo que se ve en cada celda, como texto: casillas TRUE/FALSE (como en Sheets), fechas dd/mm/aaaa
  function valorCopia(c, f) {
    const k = c.clave, v = f[k];
    if (k === "web_estado") return v ? ({ publicado: "En la web", solo_variantes: "Por variantes", no_esta: "No está" })[v] : "Sin revisar";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (k === "estado") return ESTADOS[v] || v || "";
    if (/fecha|recepcion/.test(k)) return v ? fmtFecha(v) : "";
    return v == null ? "" : String(v);
  }
  const celdaTSV = t => /[\t\n\r"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;

  function textoDelRango() {
    const cols = visibles().slice(rango.c1, rango.c2 + 1);
    return mostradas().slice(rango.i1, rango.i2 + 1).map(f => cols.map(c => celdaTSV(valorCopia(c, f))).join("\t")).join("\n");
  }
  const codigosDelRango = () => [...new Set(mostradas().slice(rango.i1, rango.i2 + 1).map(f => f.codigo))].join("\n");

  async function copiarTexto(texto, mensaje) {
    try { await navigator.clipboard.writeText(texto); }
    catch (e) { // sin permiso del portapapeles: método clásico
      const t = document.createElement("textarea");
      t.value = texto; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      const ok = document.execCommand("copy");
      t.remove();
      if (!ok) return toast("No se pudo copiar.", "error");
    }
    toast(mensaje);
  }

  function copiarRango(soloCodigos) {
    if (!rango) return;
    if (soloCodigos) { const n = new Set(mostradas().slice(rango.i1, rango.i2 + 1).map(f => f.codigo)).size; return copiarTexto(codigosDelRango(), `Copiados ${plural(n, "código", "códigos")}.`); }
    const f = rango.i2 - rango.i1 + 1, c = rango.c2 - rango.c1 + 1;
    copiarTexto(textoDelRango(), `Copiado: ${plural(f, "fila", "filas")} × ${plural(c, "columna", "columnas")}.`);
  }

  function copiarElegidos() {
    const codigos = [...new Set(filas.filter(f => seleccion.has(f.codigo)).map(f => f.codigo))];
    if (codigos.length) copiarTexto(codigos.join("\n"), `Copiados ${plural(codigos.length, "código", "códigos")}.`);
  }

  // Catálogo con lo elegido: las casillas de la primera columna o, si no hay, lo arrastrado
  function armarCatalogo() {
    let elegidas;
    if (seleccion.size) elegidas = filas.filter(f => seleccion.has(f.codigo));
    else if (rango) elegidas = mostradas().slice(rango.i1, rango.i2 + 1);
    else return toast("Elegí artículos: tildalos en la primera columna o arrastrá el mouse sobre la tabla.", "error", 6000);
    R.vistaCatalogo.abrir(elegidas);
  }

  function iniciarRango() {
    const tabla = $("planilla-tabla");
    tabla.addEventListener("mousedown", e => {
      if (e.button !== 0 || e.target.closest("a, input, button, label") || popIndice != null) return;
      const cel = celdaDe(e.target);
      if (!cel) return;
      ancla = cel; arrastrando = true; huboArrastre = false; ultimoPunto = { x: e.clientX, y: e.clientY };
    });
    document.addEventListener("mousemove", e => {
      if (!arrastrando) return;
      ultimoPunto = { x: e.clientX, y: e.clientY };
      extenderRango(e.clientX, e.clientY);
      // Cerca del borde de la tabla, sigue de largo (como al arrastrar en una planilla)
      if (huboArrastre && !autoScroll) {
        autoScroll = setInterval(() => {
          const w = tabla.closest(".tabla-wrap"), r = w.getBoundingClientRect(), p = ultimoPunto;
          const dy = p.y < r.top + 50 ? -22 : p.y > r.bottom - 50 ? 22 : 0, dx = p.x < r.left + 50 ? -22 : p.x > r.right - 50 ? 22 : 0;
          if (dy || dx) { w.scrollTop += dy; w.scrollLeft += dx; extenderRango(Math.max(r.left + 2, Math.min(p.x, r.right - 22)), Math.max(r.top + 70, Math.min(p.y, r.bottom - 22))); }
        }, 40);
      }
    });
    document.addEventListener("mouseup", () => {
      if (!arrastrando) return;
      arrastrando = false; clearInterval(autoScroll); autoScroll = null;
      // el clic que viene justo después del arrastre no tiene que abrir nada
      if (huboArrastre) setTimeout(() => { huboArrastre = false; }, 0);
    });
    // Ctrl+C con celdas elegidas o después de un clic en un código (si no se está escribiendo en otro lado).
    // Del código se copia solo el código, sin el nombre del proveedor que se ve al lado.
    document.addEventListener("copy", e => {
      const a = document.activeElement;
      if (!(rango || codigoACopiar) || $("vista-planilla").hidden || document.querySelector("dialog[open]") || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      e.clipboardData.setData("text/plain", rango ? textoDelRango() : codigoACopiar);
      e.preventDefault();
      toast(rango ? `Copiado: ${plural(rango.i2 - rango.i1 + 1, "fila", "filas")} × ${plural(rango.c2 - rango.c1 + 1, "columna", "columnas")}.` : `Copiado: ${codigoACopiar}`);
    });
    // Un clic afuera de la tabla (y de las barras) o Escape sacan la selección
    document.addEventListener("mousedown", e => {
      if (!e.target.closest('#planilla-tabla td[data-c="codigo"]')) codigoACopiar = null; // el clic en un código lo vuelve a anotar
      if (rango && !e.target.closest("#planilla-tabla, #planilla-rango, .toast, dialog")) quitarRango();
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") codigoACopiar = null;
      if (e.key === "Escape" && rango && !document.querySelector("dialog[open]") && popIndice == null) quitarRango();
    });
    $("rango-copiar").addEventListener("click", () => copiarRango(false));
    $("rango-codigos").addEventListener("click", () => copiarRango(true));
    $("rango-catalogo").addEventListener("click", armarCatalogo);
    $("rango-quitar").addEventListener("click", quitarRango);
    $("seleccion-copiar").addEventListener("click", copiarElegidos);
    $("seleccion-catalogo").addEventListener("click", armarCatalogo);
    $("planilla-catalogo").addEventListener("click", armarCatalogo);
    R.vistaCatalogo.iniciar();
  }

  // ---------- Deshacer ----------
  // lista: [{ codigo, antes: { campo: valorAnterior, … } }]. Al deshacer se vuelven a guardar esos valores.
  function registrarDeshacer(texto, lista) {
    const campos = [...new Set(lista.flatMap(x => Object.keys(x.antes)))];
    R.deshacer.registrar({ texto, deshacer: async () => {
      const grupos = new Map();
      lista.forEach(x => { const k = JSON.stringify(x.antes); (grupos.get(k) || grupos.set(k, { antes: x.antes, codigos: [] }).get(k)).codigos.push(x.codigo); });
      for (const g of grupos.values()) {
        await R.api.articulos.actualizarVarios(g.codigos, g.antes);
        Object.entries(g.antes).forEach(([k, v]) => aplicarLocal(g.codigos, k, v));
      }
      refrescarCeldas(lista.map(x => x.codigo), campos);
    } });
  }

  // ---------- Casillas ----------
  // Cambia el dato en todas las filas del mismo código (es del artículo, no de la OC)
  function aplicarLocal(codigos, campo, valor) {
    const set = new Set(codigos);
    filas.forEach(f => { if (set.has(f.codigo) || (campo === "llego" && f.es_variante && set.has(f.padre))) f[campo] = valor; });
  }

  async function tildar(input) {
    const f = mostradas()[Number(input.closest("tr").dataset.i)];
    const campo = input.dataset.campo, valor = input.checked, antes = !!f[campo], fechaAntes = f.fecha_alta_web ?? null;
    aplicarLocal([f.codigo], campo, valor);
    // Otras filas del mismo código que estén a la vista
    document.querySelectorAll("#planilla-tabla tbody tr").forEach(tr => {
      const g = mostradas()[Number(tr.dataset.i)];
      const otra = tr.querySelector(`input.tilde[data-campo="${campo}"]`);
      if (g && otra && g.codigo === f.codigo) otra.checked = valor;
    });
    try {
      const guardado = await R.api.articulos.actualizar(f.codigo, { [campo]: valor });
      registrarDeshacer(`${TILDES[campo]} ${valor ? "marcado" : "desmarcado"} en ${f.codigo}`,
        [{ codigo: f.codigo, antes: campo === "cargado_web" ? { cargado_web: antes, fecha_alta_web: fechaAntes } : { [campo]: antes } }]);
      // Al marcar "Cargado web" la base completa sola la fecha de alta: se muestra enseguida
      // (y el aviso "No está (estaba cargado)" depende de esta casilla)
      if (campo === "cargado_web" && guardado) aplicarLocal([f.codigo], "fecha_alta_web", guardado.fecha_alta_web);
      // Si hay un filtro "Mostrar", la fila puede dejar de corresponder: refrescarCeldas redibuja todo
      refrescarCeldas([f.codigo], campo === "cargado_web" ? ["fecha_alta_web", "web_estado", campo] : [campo]);
    } catch (e) {
      aplicarLocal([f.codigo], campo, antes);
      refrescarCeldas([f.codigo], [campo]);
      toast(e.message, "error", 6000);
    }
  }

  async function marcarElegidos(valor) {
    const campo = $("seleccion-campo").value, codigos = [...seleccion];
    if (!codigos.length) return;
    const nombre = TILDES[campo];
    ["seleccion-marcar", "seleccion-desmarcar"].forEach(id => { $(id).disabled = true; });
    try {
      const previos = codigos.map(c => { const g = filas.find(x => x.codigo === c) || {}; return { codigo: c, antes: campo === "cargado_web" ? { cargado_web: !!g[campo], fecha_alta_web: g.fecha_alta_web ?? null } : { [campo]: !!g[campo] } }; });
      const hechas = await R.api.articulos.actualizarVarios(codigos, { [campo]: valor });
      registrarDeshacer(`${nombre} ${valor ? "marcado" : "desmarcado"} en ${plural(codigos.length, "artículo", "artículos")}`, previos);
      aplicarLocal(codigos, campo, valor);
      (hechas || []).forEach(h => aplicarLocal([h.codigo], "fecha_alta_web", h.fecha_alta_web));
      toast(`${nombre}: ${valor ? "marcado" : "desmarcado"} en ${plural(codigos.length, "artículo", "artículos")}.`);
      refrescarCeldas(codigos, [campo, "fecha_alta_web", "web_estado"]);
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
    pintarSeleccion();
  }

  // "Editar producto" del encabezado: abre el diálogo del único artículo elegido
  function editarElegido() {
    if (seleccion.size !== 1) return;
    const codigo = [...seleccion][0];
    const f = mostradas().find(x => x.codigo === codigo) || filas.find(x => x.codigo === codigo);
    if (f) abrirArticulo(f);
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
      refrescarCeldas([f.codigo], ["web_estado"]);
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
  // Los elegidos; si no hay elegidos, todos los que se ven con los filtros. Los resultados llegan
  // de a uno (SSE) y cada fila se actualiza apenas está. De a 100 por pedido. Otro clic: detener.
  // De a LOTE artículos y una pausa entre lotes, para no cargar la tienda ni la función (js/config.js → revisionWeb)
  const cfgWeb = () => Object.assign({ lote: 10, esperaSegundos: 5 }, (window.COMPRAS_CONFIG || {}).revisionWeb);
  let revisionWeb = null; // AbortController de la revisión en curso
  const pausa = (ms, senal) => new Promise(ok => {
    const t = setTimeout(ok, ms);
    senal.addEventListener("abort", () => { clearTimeout(t); ok(); }, { once: true });
  });
  async function revisarEnWeb() {
    if (revisionWeb) return revisionWeb.abort();
    const codigos = seleccion.size ? [...seleccion] : [...new Set(filtradas().map(f => f.codigo))];
    if (!codigos.length) return toast("No hay artículos para revisar.", "error");
    const { lote, esperaSegundos } = cfgWeb();
    const minutos = Math.ceil((Math.ceil(codigos.length / lote) * (esperaSegundos + 3)) / 60);
    if (codigos.length > 50 && !confirm(`Se van a revisar ${fmtNum(codigos.length)} artículos en la web, de a ${lote} con ${esperaSegundos} segundos entre lotes. Tarda unos ${minutos} minuto(s); se puede detener cuando quieras. ¿Seguir?`)) return;
    const control = revisionWeb = new AbortController();
    const boton = $("planilla-revisar-web"), texto = $("planilla-revisar-texto");
    boton.classList.add("detener");
    boton.title = "Detener la revisión (lo ya revisado queda guardado)";
    const cuenta = { publicado: 0, solo_variantes: 0, no_esta: 0, error: 0 };
    let hechos = 0;
    const total = codigos.length, lotes = Math.ceil(total / lote);
    const caja = $("planilla-progreso"), pista = $("progreso-pista"), barra = $("progreso-barra");
    caja.hidden = false; caja.classList.remove("termino");
    $("progreso-titulo").textContent = "Revisando en la web";
    const avance = detalle => {
      const pct = Math.round((hechos / total) * 100);
      barra.style.width = pct + "%";
      pista.setAttribute("aria-valuenow", String(pct));
      $("progreso-cifras").textContent = `${fmtNum(hechos)} de ${fmtNum(total)} · ${pct}%`;
      if (detalle != null) $("progreso-detalle").textContent = detalle;
      texto.textContent = `Revisando ${fmtNum(hechos)} de ${fmtNum(total)} · Detener`;
    };
    avance("Empezando…");
    try {
      for (let i = 0, n = 1; i < total && !control.signal.aborted; i += lote, n++) {
        avance(`Lote ${n} de ${lotes}`);
        await R.api.web.revisar(codigos.slice(i, i + lote), {
          senal: control.signal,
          alResultado: r => {
            hechos++;
            cuenta[r.estado] = (cuenta[r.estado] || 0) + 1;
            if (r.estado !== "error") { aplicarWeb([r]); refrescarCeldas([r.codigo], ["web_estado"]); }
            avance();
          },
        });
        // Pausa entre lotes (con cuenta regresiva); no hay después del último
        for (let s = esperaSegundos; s > 0 && i + lote < total && !control.signal.aborted; s--) {
          avance(`Lote ${n} de ${lotes} listo. Siguiente en ${s} s…`);
          await pausa(1000, control.signal);
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") toast(e.message, "error", 7000);
    } finally {
      revisionWeb = null;
      boton.classList.remove("detener");
      boton.title = "Revisa si los artículos elegidos (o, si no hay elegidos, todos los que se ven) ya están publicados en la web de Cindy";
      texto.textContent = "Revisar en la web";
      const completa = hechos >= total;
      caja.classList.toggle("termino", completa);
      $("progreso-titulo").textContent = completa ? "Revisión terminada" : "Revisión detenida";
      $("progreso-detalle").textContent = completa ? "Listo: los resultados ya están en la columna \"En la web\"." : "Lo ya revisado quedó guardado.";
      setTimeout(() => { if (!revisionWeb) caja.hidden = true; }, completa ? 6000 : 4000);
    }
    if (!hechos) return;
    const partes = [`${fmtNum(cuenta.publicado)} en la web`, `${fmtNum(cuenta.solo_variantes)} por variantes`, `${fmtNum(cuenta.no_esta)} no están`];
    if (cuenta.error) partes.push(`${fmtNum(cuenta.error)} sin respuesta de la tienda (quedan como estaban)`);
    const cortada = hechos < codigos.length ? `Revisión detenida: ${fmtNum(hechos)} de ${fmtNum(codigos.length)}` : `Revisados ${fmtNum(hechos)}`;
    toast(`${cortada}: ${partes.join(", ")}.`, cuenta.error ? "error" : "ok", 8000);
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
      const antesDesc = { descripcion_web: f.descripcion_web || "", descripcion_ok: !!f.descripcion_ok };
      await R.api.articulos.actualizar(f.codigo, d);
      registrarDeshacer(`descripción de ${f.codigo}`, [{ codigo: f.codigo, antes: antesDesc }]);
      Object.entries(d).forEach(([k, v]) => aplicarLocal([f.codigo], k, v));
      cerrarPop(true);
      refrescarCeldas([f.codigo], Object.keys(d));
      if (seguir && siguiente) {
        const j = mostradas().findIndex(x => x.codigo === siguiente.codigo);
        if (j >= 0) { asegurarFila(j); const td = celdaDesc(j); if (td) { td.scrollIntoView({ block: "nearest" }); abrirPop(j); } }
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
    setTimeout(() => renderVentana(true), 60);
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
    fotoFormulario = estadoFormulario();
    pintarVariantes();
  }

  // Lo que se puede cambiar en el diálogo, para saber si al cerrarlo con un clic afuera se pierde algo
  let fotoFormulario = "";
  const estadoFormulario = () => JSON.stringify([
    ...CAMPOS_TEXTO.map(k => $("ar-" + k).value), ...CAMPOS_SI_NO.map(k => $("ar-" + k).checked),
    $("ar-colores").querySelectorAll("input:checked").length, $("ar-nc-codigo").value, $("ar-nc-nombre").value,
  ]);

  // Clic afuera del diálogo (en el fondo oscuro) lo cierra; si hay cambios sin guardar, pregunta antes.
  // Se exige que el clic empiece y termine afuera: arrastrar para elegir texto y soltar afuera no lo cierra.
  function iniciarCierreAfuera() {
    const dlg = $("dlg-articulo");
    const afuera = e => { const r = dlg.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
    let empezoAfuera = false;
    dlg.addEventListener("pointerdown", e => { empezoAfuera = e.target === dlg && afuera(e); });
    dlg.addEventListener("click", e => {
      if (!empezoAfuera || e.target !== dlg || !afuera(e)) return;
      empezoAfuera = false;
      if (estadoFormulario() !== fotoFormulario && !confirm("Hay cambios sin guardar en este artículo. ¿Cerrar igual?")) return;
      dlg.close();
    });
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
      const codigo = editando.codigo, guardado = await R.api.articulos.actualizar(codigo, d);
      $("dlg-articulo").close();
      toast("Artículo actualizado.");
      // Se cambia en el lugar, sin volver a filtrar: si deja de coincidir con el filtro queda a la vista, atenuada
      Object.entries(d).forEach(([k, v]) => aplicarLocal([codigo], k, typeof v === "string" ? (v.trim() === "" && /fecha/.test(k) ? null : v.trim()) : v));
      if (guardado) aplicarLocal([codigo], "fecha_alta_web", guardado.fecha_alta_web);
      refrescarCeldas([codigo], [...Object.keys(d), "web_estado"]);
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
    // Espera a que se deje de escribir: redibujar en cada tecla trababa la escritura
    let esperaBuscar = 0;
    $("planilla-buscar").addEventListener("input", () => { clearTimeout(esperaBuscar); esperaBuscar = setTimeout(pintar, 180); });
    $("planilla-proveedor").addEventListener("change", pintar);
    $("planilla-estado").addEventListener("change", pintar);
    $("planilla-falta").addEventListener("change", pintar);
    $("planilla-con-orden").addEventListener("change", e => {
      conOrden = e.target.checked;
      seleccion.clear(); ultimoClic = null;
      mostrar();
    });
    $("planilla-csv").addEventListener("click", exportar);
    $("planilla-columnas").addEventListener("click", abrirColumnas);
    $("columnas-guardar").addEventListener("click", guardarColumnas);
    $("columnas-orden").addEventListener("click", () => { ordenCols = []; guardarVista(); $("dlg-columnas").close(); pintar(); toast("Columnas en el orden original."); });
    $("columnas-todas").addEventListener("click", () => $("columnas-lista").querySelectorAll("input").forEach(i => { i.checked = true; }));
    $("form-articulo").addEventListener("submit", guardarArticulo);
    iniciarCierreAfuera();
    $("ar-crear-variantes").addEventListener("click", crearVariantes);
    $("ar-nc-agregar").addEventListener("click", colorNuevo);
    $("planilla-completa").addEventListener("click", () => pantallaCompleta());
    $("planilla-revisar-web").addEventListener("click", revisarEnWeb);
    iniciarRango();
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !e.defaultPrevented && $("vista-planilla").classList.contains("pantalla-completa") && !document.querySelector("dialog[open]")) pantallaCompleta(false);
    });
    document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) pantallaCompleta(false); });
    window.addEventListener("hashchange", () => pantallaCompleta(false));
    $("seleccion-marcar").addEventListener("click", () => marcarElegidos(true));
    $("seleccion-desmarcar").addEventListener("click", () => marcarElegidos(false));
    $("seleccion-limpiar").addEventListener("click", () => { seleccion.clear(); ultimoClic = null; pintarSeleccion(); });
    $("planilla-editar").addEventListener("click", editarElegido);
    $("fuera-actualizar").addEventListener("click", pintar);

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
    window.addEventListener("resize", () => { if (popIndice != null) ubicarPop(); renderVentana(true); });
    // Al desplazar se dibujan las filas que entran (una vez por cuadro, no por cada evento)
    $("planilla-tabla").closest(".tabla-wrap").addEventListener("scroll", () => {
      if (esperaDesplazar) return;
      esperaDesplazar = requestAnimationFrame(() => { esperaDesplazar = 0; renderVentana(); });
    }, { passive: true });
    window.addEventListener("hashchange", () => cerrarPop(true));

    const tabla = $("planilla-tabla");
    tabla.addEventListener("change", e => {
      if (e.target.matches("input.tilde")) tildar(e.target);
      else if (e.target.id === "sel-todas") {
        mostradas().forEach(f => { if (e.target.checked) seleccion.add(f.codigo); else seleccion.delete(f.codigo); });
        ultimoClic = null;
        pintarSeleccion();
      }
    });
    // Mover columnas: se arrastra el encabezado y se suelta sobre otra columna
    let colArrastrada = null;
    const thDe = e => e.target.closest && e.target.closest("#planilla-tabla th[data-c]");
    tabla.addEventListener("dragstart", e => {
      const th = thDe(e);
      if (!th) return;
      colArrastrada = th.dataset.c;
      th.classList.add("arrastrando");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", colArrastrada);
    });
    tabla.addEventListener("dragover", e => {
      const th = thDe(e);
      if (!colArrastrada || !th) return;
      e.preventDefault();
      tabla.querySelectorAll("th.soltar-aca").forEach(x => { if (x !== th) x.classList.remove("soltar-aca"); });
      if (th.dataset.c !== colArrastrada) th.classList.add("soltar-aca");
    });
    tabla.addEventListener("drop", e => {
      const th = thDe(e);
      if (!colArrastrada || !th) return;
      e.preventDefault();
      const desde = colArrastrada; colArrastrada = null;
      moverColumna(desde, th.dataset.c);
    });
    tabla.addEventListener("dragend", () => {
      colArrastrada = null;
      tabla.querySelectorAll("th.arrastrando, th.soltar-aca").forEach(x => x.classList.remove("arrastrando", "soltar-aca"));
    });
    tabla.addEventListener("click", e => {
      if (huboArrastre) return; // terminó un arrastre de celdas: no es un clic
      const th = thDe(e);
      if (th) { if (ORDENABLES.includes(th.dataset.c)) ordenarPor(th.dataset.c); return; }
      quitarRango();
      // Clic en el código: Ctrl+C copia solo ese código (también para quien solo consulta)
      const tdCodigo = e.target.closest('td[data-c="codigo"]');
      codigoACopiar = tdCodigo && !e.target.closest("a") ? mostradas()[Number(tdCodigo.parentElement.dataset.i)]?.codigo ?? null : null;
      if (!editable() || e.target.closest("a")) return; // los enlaces (buscar en la web) hacen lo suyo
      const sel = e.target.closest("input.sel:not(#sel-todas)");
      if (sel) return elegir(sel, e.shiftKey);
      const desc = e.target.closest("td.celda-desc");
      if (desc) { if (cerrarPop()) abrirPop(Number(desc.closest("tr").dataset.i)); return; }
      if (e.target.closest("input")) return; // las casillas se manejan en "change"
      // Clic en la celda de una casilla (no justo en el cuadradito): la tilda igual
      const celda = e.target.closest("td.celda-tilde");
      if (celda) { const c = celda.querySelector("input.tilde"); if (!c) return; c.checked = !c.checked; return tildar(c); }
      // Clic en el código, el nombre o cualquier otra parte de la fila: la elige (o la saca), igual que la
      // primera columna. Los datos completos se abren con "Editar producto", arriba.
      const tr = e.target.closest("tr[data-i]");
      const c = tr && tr.querySelector("input.sel");
      if (c) { c.checked = !c.checked; elegir(c, e.shiftKey); }
    });
  }

  R.vistaPlanilla = { iniciar, mostrar, _renderVentana: renderVentana };
})(window.COMPRAS);
