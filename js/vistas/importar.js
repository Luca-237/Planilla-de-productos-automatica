// =====================================================================
//  Vista: Importar planilla anterior (solo admin). Sube el .xlsx de la
//  planilla "Proceso Ecommerce" (Archivo → Descargar → .xlsx), muestra qué
//  encaja y lo carga por lotes con barra de progreso. Se puede repetir:
//  lo que ya está cargado no se duplica ni se pisa.
// =====================================================================
(function (R) {
  const { $, esc, fmtNum, plural, toast } = R.util;

  // Tamaño de cada pedido a la base (la base corta lo que tarda más de unos 8 segundos)
  const ARTICULOS_POR_LOTE = 120;
  const LINEAS_POR_LOTE = 120;
  const PAUSA_MS = 250;

  let leida = null;        // lo que devolvió el lector
  let existentes = null;   // { codigos, ordenes } de la base
  let nombreArchivo = "";
  let corte = null;        // AbortController de la importación en curso

  const kpi = (etiqueta, valor, detalle, destacado) =>
    `<div class="kpi ${destacado ? "destacado" : ""}"><div class="etiqueta">${etiqueta}</div><div class="valor">${valor}</div><div class="detalle">${detalle}</div></div>`;

  function pintarResumen() {
    const r = leida.resumen;
    const artYa = leida.articulos.filter(a => existentes.codigos.has(a.codigo)).length;
    const ordYa = leida.ordenes.filter(o => existentes.ordenes.has(o.numero)).length;
    const nuevos = r.articulos - artYa, ordNuevas = r.ordenes - ordYa;
    $("importar-resumen").innerHTML =
      `<div class="kpis">
        ${kpi("Artículos", fmtNum(r.articulos), `${fmtNum(nuevos)} nuevos · ${fmtNum(artYa)} ya cargados (no se tocan)`, true)}
        ${kpi("Variantes", fmtNum(r.variantes), "cuelgan de su artículo principal")}
        ${kpi("Órdenes de compra", fmtNum(r.ordenes), `${fmtNum(ordNuevas)} nuevas · ${fmtNum(ordYa)} ya cargadas`)}
        ${kpi("Líneas de orden", fmtNum(r.lineas), `${fmtNum(r.llegaron)} ya llegaron · ${fmtNum(r.lineas - r.llegaron)} pendientes`)}
        ${kpi("Proveedores", fmtNum(r.proveedores.length), "los nuevos quedan sin CUIT hasta su primer documento de Manager")}
      </div>
      <p class="hint">Hojas leídas: ${r.hojas.map(h => `<strong>${esc(h)}</strong>`).join(" y ")} · ${fmtNum(r.filas)} filas de ${esc(nombreArchivo)}.</p>
      ${leida.avisos.length ? `<ul class="lista-avisos">${leida.avisos.map(a => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
      <details class="detalle-importar"><summary>Proveedores que se van a usar (${r.proveedores.length})</summary>
        <p>${r.proveedores.map(p => `<span class="tag-var">${esc(p)}</span>`).join(" ")}</p>
        <p class="hint">Si uno aparece dos veces con distinto nombre (ej. "CHARKO S.A." y "Charko"), se carga como dos proveedores: después se pueden renombrar en la sección Proveedores.</p></details>
      <details class="detalle-importar"><summary>Qué se importa y qué no</summary>
        <ul>
          <li><strong>Artículos:</strong> código, nombre, tipo, variante/color, casillas (foto, descripción OK, cargado web, catálogo, sin stock, ya no está), fecha de alta, observaciones, título, descripción web y estado de la descripción.</li>
          <li><strong>Órdenes de compra:</strong> número, fecha, proveedor, y por línea cantidad y precio. Las líneas marcadas "Llegó" quedan como recibidas completas (con un remito "PLANILLA-…" a la fecha de la orden, porque la planilla no guarda cuándo llegó).</li>
          <li><strong>No se importa:</strong> el estado de la columna "Variantes" de los principales (PENDIENTE FOTO, GENERADAS…), la columna "Estado" (se deduce de si llegó) y las filas de variantes como líneas de orden (la cantidad es del principal).</li>
          <li>Lo que ya existe en el sistema no se pisa: se sigue usando lo que ya se trabajó acá.</li>
        </ul></details>`;
    $("importar-vista-previa").hidden = false;
    $("importar-boton").disabled = !(nuevos || ordNuevas);
    $("importar-boton-texto").textContent = nuevos || ordNuevas ? "Importar a la base" : "No hay nada nuevo para importar";
    $("importar-final").innerHTML = "";
  }

  async function leerArchivo(archivo) {
    nombreArchivo = archivo.name;
    $("importar-vista-previa").hidden = true;
    $("importar-estado").textContent = "Leyendo la planilla…";
    try {
      const libro = XLSX.read(await archivo.arrayBuffer(), { type: "array", cellDates: true });
      leida = window.ImportadorPlanilla.leerPlanilla(XLSX, libro);
      $("importar-estado").textContent = "Comparando con lo que ya está cargado…";
      existentes = await R.api.importacion.existentes();
      $("importar-estado").textContent = "";
      pintarResumen();
    } catch (e) {
      leida = null;
      $("importar-estado").textContent = "";
      toast(e.message, "error", 8000);
    }
  }

  // Lotes: colores + artículos (principales antes que variantes), después órdenes
  function armarLotes() {
    const lotes = [];
    const arts = leida.articulos.filter(a => !existentes.codigos.has(a.codigo));
    for (let i = 0; i < arts.length; i += ARTICULOS_POR_LOTE) {
      lotes.push({ tipo: "artículos", n: Math.min(ARTICULOS_POR_LOTE, arts.length - i),
        doc: { colores: i === 0 ? leida.colores : [], articulos: arts.slice(i, i + ARTICULOS_POR_LOTE) } });
    }
    if (!arts.length && leida.colores.length) lotes.unshift({ tipo: "colores", n: 0, doc: { colores: leida.colores } });
    let actual = [], lineas = 0;
    const cerrar = () => { if (actual.length) lotes.push({ tipo: "órdenes", n: actual.length, doc: { ordenes: actual } }); actual = []; lineas = 0; };
    for (const o of leida.ordenes.filter(o => !existentes.ordenes.has(o.numero))) {
      if (actual.length && lineas + o.lineas.length > LINEAS_POR_LOTE) cerrar();
      actual.push(o); lineas += o.lineas.length;
    }
    cerrar();
    return lotes;
  }

  async function importar() {
    if (corte) return corte.abort();
    const lotes = armarLotes();
    if (!lotes.length) return;
    const nArt = leida.articulos.filter(a => !existentes.codigos.has(a.codigo)).length;
    const nOrd = leida.ordenes.filter(o => !existentes.ordenes.has(o.numero)).length;
    if (!confirm(`Se van a cargar ${fmtNum(nArt)} artículos nuevos y ${fmtNum(nOrd)} órdenes de compra en la base real. Se puede detener cuando quieras y repetir después: lo ya cargado no se duplica. ¿Seguir?`)) return;

    const control = corte = new AbortController();
    const boton = $("importar-boton");
    boton.classList.add("detener");
    $("importar-boton-texto").textContent = "Detener";
    $("importar-final").innerHTML = "";
    const caja = $("importar-progreso"), barra = $("importar-barra"), pista = $("importar-pista");
    caja.hidden = false; caja.classList.remove("termino");
    $("importar-titulo").textContent = "Importando";
    const total = { colores: 0, articulos: 0, articulos_existentes: 0, ordenes: 0, ordenes_existentes: 0, lineas: 0, recibidas: 0, proveedores_nuevos: 0 };
    let hecho = 0, fallo = null;
    const avance = detalle => {
      const pct = Math.round((hecho / lotes.length) * 100);
      barra.style.width = pct + "%";
      pista.setAttribute("aria-valuenow", String(pct));
      $("importar-cifras").textContent = `Lote ${Math.min(hecho + 1, lotes.length)} de ${lotes.length} · ${pct}%`;
      $("importar-detalle").textContent = detalle;
    };
    avance("Empezando…");
    try {
      for (const lote of lotes) {
        if (control.signal.aborted) break;
        avance(`Cargando ${lote.n ? fmtNum(lote.n) + " " : ""}${lote.tipo}…`);
        const r = await R.api.importacion.enviar(lote.doc);
        Object.keys(total).forEach(k => { total[k] += Number(r[k]) || 0; });
        hecho++;
        avance(`${fmtNum(total.articulos)} artículos y ${fmtNum(total.ordenes)} órdenes cargados…`);
        await new Promise(ok => setTimeout(ok, PAUSA_MS));
      }
    } catch (e) { fallo = e; }
    finally {
      corte = null;
      boton.classList.remove("detener");
    }
    const completa = !fallo && hecho >= lotes.length;
    caja.classList.toggle("termino", completa);
    $("importar-titulo").textContent = completa ? "Importación terminada" : fallo ? "Importación interrumpida" : "Importación detenida";
    $("importar-cifras").textContent = `${hecho} de ${lotes.length} lotes`;
    $("importar-detalle").textContent = completa ? "Listo." : "Lo ya cargado quedó guardado. Volvé a subir la planilla y apretá Importar para seguir donde quedó.";
    const resultado = `
      ${fallo ? `<ul class="lista-avisos"><li>${esc(fallo.message)}</li></ul>` : ""}
      <div class="kpis">
        ${kpi("Artículos cargados", fmtNum(total.articulos), `${fmtNum(total.articulos_existentes)} ya estaban`, true)}
        ${kpi("Órdenes cargadas", fmtNum(total.ordenes), `${plural(total.lineas, "línea", "líneas")} · ${fmtNum(total.recibidas)} recibidas`)}
        ${kpi("Proveedores nuevos", fmtNum(total.proveedores_nuevos), "sin CUIT todavía")}
        ${kpi("Colores nuevos", fmtNum(total.colores), "en el catálogo")}
      </div>
      ${completa ? `<p class="hint">Ya se puede ver en <a href="#planilla">Planilla</a> y <a href="#pendientes">Pendientes</a>. Después de importar conviene usar <strong>Revisar en la web</strong> en la Planilla para comprobar qué artículos están publicados de verdad.</p>` : ""}`;
    $("importar-final").innerHTML = resultado;
    if (completa) toast(`Importación terminada: ${fmtNum(total.articulos)} artículos y ${fmtNum(total.ordenes)} órdenes.`);
    else if (fallo) toast(fallo.message, "error", 8000);
    // Lo importado cambia lo que hay en la base: se vuelve a comparar
    try { existentes = await R.api.importacion.existentes(); pintarResumen(); $("importar-final").innerHTML = resultado; } catch (e) { /* queda lo anterior */ }
  }

  function mostrar() { /* la pantalla se arma al elegir el archivo */ }

  function iniciar() {
    const zona = $("zona-importar");
    $("importar-archivo").addEventListener("change", e => {
      const f = e.target.files[0];
      e.target.value = "";
      if (f) leerArchivo(f);
    });
    ["dragenter", "dragover"].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add("encima"); }));
    ["dragleave", "drop"].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove("encima"); }));
    zona.addEventListener("drop", e => {
      const f = [...e.dataTransfer.files].find(x => /\.xlsx?$/i.test(x.name));
      if (!f) return toast("Subí la planilla descargada como .xlsx.", "error");
      leerArchivo(f);
    });
    $("importar-boton").addEventListener("click", importar);
  }

  R.vistaImportar = { iniciar, mostrar };
})(window.COMPRAS);
