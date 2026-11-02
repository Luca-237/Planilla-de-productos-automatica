// =====================================================================
//  Catálogo de ingresos: se arma con los artículos elegidos en la
//  planilla, pero SOLO con los que están publicados en la web de Cindy.
//  Al abrirlo se comprueba cada artículo en la página (la función
//  buscar-en-web; el navegador no puede leer la tienda) y de ahí salen
//  el precio y la foto. Los que no están no entran al catálogo. El precio
//  de la página se puede corregir a mano y se descarga en PDF (igual al
//  catálogo de Manager) o en PowerPoint (formas y textos editables).
//  El dibujo de las hojas está en js/catalogo-formato.js.
// =====================================================================
(function (R) {
  const { $, esc, fmtNum, plural, toast } = R.util;

  const LIBS = {
    pdf: { url: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", listo: () => window.jspdf && window.jspdf.jsPDF },
    pptx: { url: "https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js", listo: () => window.PptxGenJS },
  };
  const FOTO_MAX = 900; // px del lado mayor: alcanza para imprimir y mantiene livianos el PDF y el PowerPoint

  // estado: "" (sin comprobar) | "publicado" | "solo_variantes" | "no_esta" | "error"
  let items = [];          // [{ codigo, nombre, precio, precioWeb, url, foto, fotoAncho, fotoAlto, fotoFormato, estado }]
  let busqueda = null;     // AbortController de la comprobación en curso
  let urlVista = null;     // vista previa (PDF en memoria)
  let esperaVista = 0;
  const cfgWeb = () => Object.assign({ lote: 10, esperaSegundos: 5 }, (window.COMPRAS_CONFIG || {}).revisionWeb);
  const enPagina = it => it.estado === "publicado" || it.estado === "solo_variantes";

  // ---------- Preferencias (por navegador) ----------
  const PREF = "compras-catalogo";
  function leerPref() {
    try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch (e) { return {}; }
  }
  function guardarPref() {
    try { localStorage.setItem(PREF, JSON.stringify({ mostrarPrecio: $("cat-precio").checked, mostrarIva: $("cat-iva").checked })); } catch (e) {}
  }

  // ---------- Librerías (se bajan solo al armar un catálogo) ----------
  const cargando = {};
  function cargarLib(clave) {
    const l = LIBS[clave];
    if (l.listo()) return Promise.resolve();
    if (cargando[clave]) return cargando[clave];
    return (cargando[clave] = new Promise((ok, no) => {
      const s = document.createElement("script");
      s.src = l.url; s.onload = ok;
      s.onerror = () => { delete cargando[clave]; no(new Error("No se pudo bajar la librería para armar el archivo. Revisá la conexión a internet.")); };
      document.head.appendChild(s);
    }));
  }

  // ---------- Fotos ----------
  // Cualquier imagen (jpg, png, webp, svg) -> JPEG de hasta FOTO_MAX px
  function procesarImagen(dataUrl) {
    return new Promise((ok, no) => {
      const img = new Image();
      img.onload = () => {
        const r = Math.min(1, FOTO_MAX / Math.max(img.naturalWidth, img.naturalHeight)) || 1;
        const w = Math.max(1, Math.round(img.naturalWidth * r)), h = Math.max(1, Math.round(img.naturalHeight * r));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const g = c.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); // los PNG con transparencia quedan sobre blanco
        g.drawImage(img, 0, 0, w, h);
        ok({ foto: c.toDataURL("image/jpeg", 0.85), fotoAncho: w, fotoAlto: h, fotoFormato: "JPEG" });
      };
      img.onerror = () => no(new Error("No se pudo leer la imagen."));
      img.src = dataUrl;
    });
  }
  const leerArchivo = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(new Error("No se pudo leer el archivo.")); r.readAsDataURL(f); });

  // ---------- Comprobar en la página ----------
  // Busca cada artículo sin comprobar (o que falló) en la web: de ahí salen el precio y la foto.
  async function comprobar() {
    if (busqueda) return busqueda.abort();
    const faltan = items.filter(i => !i.estado || i.estado === "error");
    if (!faltan.length) return toast("Ya se comprobaron todos.");
    const { esperaSegundos } = cfgWeb(), lote = Math.min(cfgWeb().lote, 12);
    const control = busqueda = new AbortController();
    const boton = $("cat-comprobar");
    boton.classList.add("detener"); $("cat-comprobar-texto").textContent = "Detener";
    pintarLista();
    const caja = $("cat-progreso"), barra = $("cat-barra"), pista = $("cat-pista");
    caja.hidden = false; caja.classList.remove("termino");
    let hechos = 0, publicados = 0, ausentes = 0, fallas = 0;
    const lotes = Math.ceil(faltan.length / lote);
    const avance = detalle => {
      const pct = Math.round((hechos / faltan.length) * 100);
      barra.style.width = pct + "%"; pista.setAttribute("aria-valuenow", String(pct));
      $("cat-cifras").textContent = `${fmtNum(hechos)} de ${fmtNum(faltan.length)} · ${pct}%`;
      if (detalle != null) $("cat-detalle").textContent = detalle;
    };
    $("cat-progreso-titulo").textContent = "Comprobando que estén en la página";
    avance("Empezando…");
    try {
      for (let i = 0, n = 1; i < faltan.length && !control.signal.aborted; i += lote, n++) {
        avance(`Lote ${n} de ${lotes}`);
        const pendientes = [];
        await R.api.web.revisar(faltan.slice(i, i + lote).map(x => x.codigo), {
          imagenes: true, senal: control.signal,
          alResultado: r => {
            hechos++;
            const it = items.find(x => x.codigo === r.codigo);
            if (!it) return;
            it.estado = r.estado;
            if (r.estado === "error") fallas++;
            else if (r.estado === "no_esta") ausentes++;
            else {
              publicados++;
              it.url = r.url; it.precioWeb = r.precio ?? null;
              if (it.precio == null) it.precio = it.precioWeb; // el precio de la página, salvo que ya se haya corregido
              // la foto se procesa aparte: decodificarla no frena la llegada de las demás
              if (r.foto && r.foto.base64) pendientes.push(procesarImagen(`data:${r.foto.tipo};base64,${r.foto.base64}`).then(p => { Object.assign(it, p); pintarLista(); }).catch(() => {}));
            }
            avance();
            pintarLista();
          },
        });
        await Promise.all(pendientes);
        for (let s = esperaSegundos; s > 0 && i + lote < faltan.length && !control.signal.aborted; s--) {
          avance(`Lote ${n} de ${lotes} listo. Siguiente en ${s} s…`);
          await new Promise(ok => { const t = setTimeout(ok, 1000); control.signal.addEventListener("abort", () => { clearTimeout(t); ok(); }, { once: true }); });
        }
      }
    } catch (e) { if (e.name !== "AbortError") toast(e.message, "error", 7000); }
    finally {
      busqueda = null;
      boton.classList.remove("detener");
    }
    const completa = hechos >= faltan.length;
    caja.classList.toggle("termino", completa);
    $("cat-progreso-titulo").textContent = completa ? "Comprobación terminada" : "Comprobación detenida";
    $("cat-detalle").textContent = `${fmtNum(publicados)} en la página · ${fmtNum(ausentes)} no están${fallas ? ` · ${fmtNum(fallas)} sin respuesta de la tienda (se pueden volver a comprobar)` : ""}.`;
    pintarLista();
  }

  // ---------- Lista ----------
  const CHIP = { publicado: ["ok", "En la página"], solo_variantes: ["var", "Por variantes"], no_esta: ["no", "No está"], error: ["alerta", "Sin respuesta"] };
  function pintarLista() {
    const dentro = items.filter(enPagina), fuera = items.filter(i => i.estado === "no_esta");
    const sin = items.filter(i => !i.estado || i.estado === "error").length;
    const hojas = Math.max(1, Math.ceil(dentro.length / 4));
    $("cat-resumen").textContent = busqueda
      ? "Comprobando…"
      : `${plural(dentro.length, "artículo en el catálogo", "artículos en el catálogo")} (${hojas} ${hojas === 1 ? "hoja" : "hojas"})` +
        (fuera.length ? ` · ${fuera.length} no ${fuera.length === 1 ? "está" : "están"} en la página y no ${fuera.length === 1 ? "entra" : "entran"}` : "") +
        (sin ? ` · ${sin} sin comprobar` : "");
    $("cat-tabla").innerHTML = `<thead><tr><th>Foto</th><th>Nombre</th><th>Código</th><th>En la página</th><th class="num">Precio</th><th></th></tr></thead>
      <tbody>${items.map((it, i) => {
        const chip = it.estado ? CHIP[it.estado] : null;
        const ok = enPagina(it);
        return `<tr data-i="${i}" class="${it.estado === "no_esta" ? "cat-fuera" : ""}">
        <td class="cat-foto">${it.foto ? `<img src="${it.foto}" alt="" width="46" height="46">` : `<span class="cat-sin">${ok ? "Sin foto" : "—"}</span>`}
          ${ok ? `<label class="link cat-subir">${it.foto ? "Cambiar" : "Subir foto"}<input type="file" accept="image/*" data-subir="${i}" hidden></label>` : ""}</td>
        <td><input value="${esc(it.nombre)}" data-campo="nombre" aria-label="Nombre de ${esc(it.codigo)}"></td>
        <td><strong>${esc(it.codigo)}</strong></td>
        <td>${chip ? (it.url && ok ? `<a class="web-chip ${chip[0]}" href="${esc(it.url)}" target="_blank" rel="noopener">${chip[1]}</a>` : `<span class="web-chip ${chip[0]}">${chip[1]}</span>`) : `<span class="web-chip sin">${busqueda ? "Esperando…" : "Sin comprobar"}</span>`}</td>
        <td class="num">${ok ? `<input type="number" min="0" step="1" value="${it.precio ?? ""}" data-campo="precio" aria-label="Precio de ${esc(it.codigo)}" placeholder="—" title="${it.precioWeb != null ? `Precio en la página: $ ${fmtNum(it.precioWeb)}` : "La página no muestra precio: se puede escribir a mano"}">` : "—"}</td>
        <td><button type="button" class="link peligro" data-quitar="${i}" aria-label="Quitar ${esc(it.codigo)}">Quitar</button></td>
      </tr>`;
      }).join("") || `<tr><td colspan="6" class="vacio">No quedó ningún artículo.</td></tr>`}</tbody>`;
    const listo = dentro.length > 0 && !busqueda;
    ["cat-pdf", "cat-pptx"].forEach(id => { $(id).disabled = !listo; });
    $("cat-comprobar").hidden = false;
    $("cat-comprobar-texto").textContent = busqueda ? "Detener" : (sin ? "Comprobar en la página" : "Volver a comprobar");
    $("cat-aviso").hidden = !(dentro.length === 0 && !busqueda && items.length && !sin);
    pintarProblemas();
    programarVista();
  }

  // ---------- Qué podría salir mal (se avisa antes de descargar) ----------
  const NOMBRE_LARGO = 56; // más que esto ocupa tres renglones y pisa la foto
  function problemas() {
    const dentro = items.filter(enPagina), conPrecio = $("cat-precio").checked, lista = [];
    const con = (cond, texto) => { const c = dentro.filter(cond).map(i => i.codigo); if (c.length) lista.push(`${texto}: ${c.join(", ")}`); };
    con(i => !i.foto, "Sin foto (sale el recuadro vacío)");
    if (conPrecio) con(i => i.precio == null, "Sin precio (la tarjeta sale sin la píldora negra)");
    con(i => !String(i.nombre).trim(), "Sin nombre");
    con(i => String(i.nombre).length > NOMBRE_LARGO, "Nombre muy largo (se corta o pisa la foto)");
    return lista;
  }
  function pintarProblemas() {
    const p = items.some(enPagina) && !busqueda ? problemas() : [];
    $("cat-problemas").hidden = !p.length;
    $("cat-problemas").innerHTML = p.map(x => `<li>${esc(x)}</li>`).join("");
  }

  // ---------- Vista previa: el mismo PDF que se descarga ----------
  function programarVista() {
    clearTimeout(esperaVista);
    esperaVista = setTimeout(actualizarVista, 600);
  }
  function soltarVista() {
    if (urlVista) URL.revokeObjectURL(urlVista);
    urlVista = null;
    $("cat-frame").removeAttribute("src");
  }
  async function actualizarVista() {
    const dentro = items.filter(enPagina), caja = $("cat-vista");
    if (!$("dlg-catalogo").open || !dentro.length) { caja.hidden = true; return; }
    if (busqueda) return; // se actualiza al terminar de comprobar
    try {
      await cargarLib("pdf");
      const blob = window.CatalogoFormato.crearPDF(window.jspdf.jsPDF, dentro, opciones()).output("blob");
      const anterior = urlVista;
      urlVista = URL.createObjectURL(blob);
      $("cat-frame").src = urlVista + "#toolbar=0&navpanes=0&view=FitH";
      $("cat-abrir-vista").href = urlVista;
      caja.hidden = false;
      if (anterior) setTimeout(() => URL.revokeObjectURL(anterior), 2000);
    } catch (e) { $("cat-vista").hidden = true; }
  }

  // ---------- Descargas ----------
  const nombreArchivo = ext => {
    const base = ($("cat-titulo").value || "Catálogo de ingresos").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `${base || "catalogo"}-${R.util.hoy()}.${ext}`;
  };
  const opciones = () => ({ mostrarPrecio: $("cat-precio").checked, mostrarIva: $("cat-iva").checked });

  async function descargar(tipo) {
    const boton = $(tipo === "pdf" ? "cat-pdf" : "cat-pptx"), dentro = items.filter(enPagina);
    if (!dentro.length) return;
    const p = problemas();
    if (p.length && !confirm(`Antes de descargar, ojo:\n\n- ${p.join("\n- ")}\n\nRevisá la vista previa. ¿Descargar igual?`)) return;
    boton.disabled = true;
    try {
      await cargarLib(tipo);
      if (tipo === "pdf") window.CatalogoFormato.crearPDF(window.jspdf.jsPDF, dentro, opciones()).save(nombreArchivo("pdf"));
      else await window.CatalogoFormato.crearPPTX(window.PptxGenJS, dentro, opciones()).writeFile({ fileName: nombreArchivo("pptx") });
      toast(`${tipo === "pdf" ? "PDF" : "PowerPoint"} descargado con ${plural(dentro.length, "artículo", "artículos")}.`);
    } catch (e) { toast(e.message || "No se pudo armar el archivo.", "error", 7000); }
    finally { pintarLista(); }
  }

  // ---------- Abrir ----------
  // filas: filas de la planilla elegidas. Una por código (las variantes no van: el catálogo muestra el artículo).
  function abrir(filas) {
    if (!R.app.puedeCargar()) return toast("Armar catálogos es para usuarios admin o carga: hay que comprobar la web.", "error", 6000);
    const vistos = new Set();
    items = [];
    for (const f of filas) {
      if (f.es_variante || vistos.has(f.codigo)) continue;
      vistos.add(f.codigo);
      items.push({ codigo: f.codigo, nombre: f.nombre || "", precio: null, precioWeb: null, url: "", foto: null, fotoAncho: 0, fotoAlto: 0, fotoFormato: "JPEG", estado: "" });
    }
    if (!items.length) return toast("Elegí al menos un artículo (no vale solo variantes).", "error");
    const p = leerPref();
    $("cat-precio").checked = p.mostrarPrecio !== false;
    $("cat-iva").checked = p.mostrarIva !== false;
    $("cat-titulo").value = $("cat-titulo").value || "Catálogo de ingresos";
    $("cat-progreso").hidden = true;
    $("cat-vista").hidden = true;
    soltarVista();
    pintarLista();
    $("dlg-catalogo").showModal();
    // Las librerías se bajan de fondo; la comprobación en la página empieza sola
    cargarLib("pdf").catch(() => {}); cargarLib("pptx").catch(() => {});
    comprobar();
  }

  function iniciar() {
    $("cat-comprobar").addEventListener("click", () => {
      // "Volver a comprobar": se vuelve a consultar todo lo que ya estaba comprobado
      if (!busqueda && !items.some(i => !i.estado || i.estado === "error")) items.forEach(i => { i.estado = ""; });
      comprobar();
    });
    $("cat-precio").addEventListener("change", () => { guardarPref(); pintarProblemas(); programarVista(); });
    $("cat-iva").addEventListener("change", () => { guardarPref(); programarVista(); });
    $("cat-pdf").addEventListener("click", () => descargar("pdf"));
    $("cat-pptx").addEventListener("click", () => descargar("pptx"));
    $("dlg-catalogo").addEventListener("close", () => { if (busqueda) busqueda.abort(); clearTimeout(esperaVista); soltarVista(); });
    const tabla = $("cat-tabla");
    tabla.addEventListener("input", e => {
      const tr = e.target.closest("tr[data-i]");
      if (!tr || !e.target.dataset.campo) return;
      const it = items[Number(tr.dataset.i)];
      if (e.target.dataset.campo === "precio") it.precio = e.target.value === "" ? null : Number(e.target.value);
      else it.nombre = e.target.value;
      pintarProblemas();
      programarVista();
    });
    tabla.addEventListener("change", async e => {
      const i = e.target.dataset.subir;
      if (i == null || !e.target.files[0]) return;
      try { Object.assign(items[Number(i)], await procesarImagen(await leerArchivo(e.target.files[0]))); pintarLista(); }
      catch (err) { toast(err.message, "error"); }
    });
    tabla.addEventListener("click", e => {
      const q = e.target.closest("[data-quitar]");
      if (q) { items.splice(Number(q.dataset.quitar), 1); pintarLista(); }
    });
  }

  R.vistaCatalogo = { iniciar, mostrar() {}, abrir };
})(window.COMPRAS);
