// =====================================================================
//  Catálogo de ingresos: se arma con los artículos elegidos en la
//  planilla. Las fotos se traen de la web de Cindy (la función
//  buscar-en-web las baja, el navegador no puede), el precio se sugiere
//  desde el costo y se puede corregir, y se descarga en PDF (igual al
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

  let items = [];          // [{ codigo, nombre, costo, precio, foto, fotoAncho, fotoAlto, fotoFormato, estado }]
  let busqueda = null;     // AbortController de la búsqueda de fotos
  const cfgWeb = () => Object.assign({ lote: 10, esperaSegundos: 5 }, (window.COMPRAS_CONFIG || {}).revisionWeb);
  const cfgCat = () => Object.assign({ recargo: 58 }, (window.COMPRAS_CONFIG || {}).catalogo);

  // ---------- Preferencias (por navegador) ----------
  const PREF = "compras-catalogo";
  function leerPref() {
    try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch (e) { return {}; }
  }
  function guardarPref() {
    try { localStorage.setItem(PREF, JSON.stringify({ recargo: Number($("cat-recargo").value) || 0, mostrarPrecio: $("cat-precio").checked, mostrarIva: $("cat-iva").checked })); } catch (e) {}
  }

  // Precio sugerido (costo + recargo, redondeado): ver CatalogoFormato.sugerirPrecio
  const sugerirPrecio = (costo, recargo) => window.CatalogoFormato.sugerirPrecio(costo, recargo);

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

  async function buscarFotos() {
    if (busqueda) return busqueda.abort();
    const faltan = items.filter(i => !i.foto && i.estado !== "no_esta");
    if (!faltan.length) return toast("No faltan fotos por buscar.");
    const { esperaSegundos } = cfgWeb(), lote = Math.min(cfgWeb().lote, 12);
    const control = busqueda = new AbortController();
    const boton = $("cat-buscar-fotos");
    boton.classList.add("detener"); $("cat-buscar-texto").textContent = "Detener";
    const caja = $("cat-progreso"), barra = $("cat-barra"), pista = $("cat-pista");
    caja.hidden = false; caja.classList.remove("termino");
    let hechos = 0, conFoto = 0, sinFoto = 0;
    const lotes = Math.ceil(faltan.length / lote);
    const avance = detalle => {
      const pct = Math.round((hechos / faltan.length) * 100);
      barra.style.width = pct + "%"; pista.setAttribute("aria-valuenow", String(pct));
      $("cat-cifras").textContent = `${fmtNum(hechos)} de ${fmtNum(faltan.length)} · ${pct}%`;
      if (detalle != null) $("cat-detalle").textContent = detalle;
    };
    $("cat-progreso-titulo").textContent = "Buscando fotos en la web";
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
            if (r.estado === "no_esta") { it.estado = "no_esta"; sinFoto++; }
            else if (r.estado === "error") sinFoto++;
            else if (r.foto && r.foto.base64) {
              // se procesa aparte: decodificar la foto no frena la llegada de las demás
              pendientes.push(procesarImagen(`data:${r.foto.tipo};base64,${r.foto.base64}`).then(p => { Object.assign(it, p); conFoto++; pintarLista(); }).catch(() => { sinFoto++; }));
            } else sinFoto++;
            avance();
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
      boton.classList.remove("detener"); $("cat-buscar-texto").textContent = "Buscar fotos en la web";
    }
    const completa = hechos >= faltan.length;
    caja.classList.toggle("termino", completa);
    $("cat-progreso-titulo").textContent = completa ? "Búsqueda terminada" : "Búsqueda detenida";
    $("cat-detalle").textContent = `${fmtNum(conFoto)} con foto · ${fmtNum(sinFoto)} sin foto: se puede subir a mano con "Subir foto".`;
    pintarLista();
  }

  // ---------- Lista ----------
  function pintarLista() {
    const con = items.filter(i => i.foto).length;
    $("cat-resumen").textContent = `${plural(items.length, "artículo", "artículos")} · ${Math.max(1, Math.ceil(items.length / 4))} ${Math.ceil(items.length / 4) <= 1 ? "hoja" : "hojas"} · ${con} con foto`;
    $("cat-tabla").innerHTML = `<thead><tr><th>Foto</th><th>Nombre</th><th>Código</th><th class="num">Costo</th><th class="num">Precio</th><th></th></tr></thead>
      <tbody>${items.map((it, i) => `<tr data-i="${i}">
        <td class="cat-foto">${it.foto ? `<img src="${it.foto}" alt="" width="46" height="46">` : `<span class="cat-sin">${it.estado === "no_esta" ? "No está en la web" : "Sin foto"}</span>`}
          <label class="link cat-subir">${it.foto ? "Cambiar" : "Subir foto"}<input type="file" accept="image/*" data-subir="${i}" hidden></label></td>
        <td><input value="${esc(it.nombre)}" data-campo="nombre" aria-label="Nombre de ${esc(it.codigo)}"></td>
        <td><strong>${esc(it.codigo)}</strong></td>
        <td class="num">${it.costo ? "$ " + fmtNum(it.costo) : "—"}</td>
        <td class="num"><input type="number" min="0" step="1" value="${it.precio ?? ""}" data-campo="precio" aria-label="Precio de ${esc(it.codigo)}" placeholder="—"></td>
        <td><button type="button" class="link peligro" data-quitar="${i}" aria-label="Quitar ${esc(it.codigo)}">Quitar</button></td>
      </tr>`).join("") || `<tr><td colspan="6" class="vacio">No quedó ningún artículo.</td></tr>`}</tbody>`;
    ["cat-pdf", "cat-pptx"].forEach(id => { $(id).disabled = !items.length; });
  }

  function recalcularPrecios() {
    const r = Number($("cat-recargo").value) || 0;
    items.forEach(it => { it.precio = sugerirPrecio(it.costo, r); });
    pintarLista();
    guardarPref();
  }

  // ---------- Descargas ----------
  const nombreArchivo = ext => {
    const base = ($("cat-titulo").value || "Catálogo de ingresos").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `${base || "catalogo"}-${R.util.hoy()}.${ext}`;
  };
  const opciones = () => ({ mostrarPrecio: $("cat-precio").checked, mostrarIva: $("cat-iva").checked });

  async function descargar(tipo) {
    const boton = $(tipo === "pdf" ? "cat-pdf" : "cat-pptx");
    boton.disabled = true;
    try {
      await cargarLib(tipo);
      if (tipo === "pdf") window.CatalogoFormato.crearPDF(window.jspdf.jsPDF, items, opciones()).save(nombreArchivo("pdf"));
      else await window.CatalogoFormato.crearPPTX(window.PptxGenJS, items, opciones()).writeFile({ fileName: nombreArchivo("pptx") });
      toast(`${tipo === "pdf" ? "PDF" : "PowerPoint"} descargado.`);
    } catch (e) { toast(e.message || "No se pudo armar el archivo.", "error", 7000); }
    finally { boton.disabled = !items.length; }
  }

  // ---------- Abrir ----------
  // filas: filas de la planilla elegidas. Una por código (las variantes no van: el catálogo muestra el artículo).
  function abrir(filas) {
    const vistos = new Set(), recargo = leerPref().recargo ?? cfgCat().recargo;
    items = [];
    for (const f of filas) {
      if (f.es_variante || vistos.has(f.codigo)) continue;
      vistos.add(f.codigo);
      const costo = Number(f.precio_unitario) || 0;
      items.push({ codigo: f.codigo, nombre: f.nombre || "", costo, precio: sugerirPrecio(costo, recargo), foto: null, fotoAncho: 0, fotoAlto: 0, fotoFormato: "JPEG", estado: f.web_estado === "no_esta" ? "no_esta" : "" });
    }
    if (!items.length) return toast("Elegí al menos un artículo (no vale solo variantes).", "error");
    const p = leerPref();
    $("cat-recargo").value = recargo;
    $("cat-precio").checked = p.mostrarPrecio !== false;
    $("cat-iva").checked = p.mostrarIva !== false;
    $("cat-titulo").value = $("cat-titulo").value || "Catálogo de ingresos";
    $("cat-progreso").hidden = true;
    pintarLista();
    $("dlg-catalogo").showModal();
    // Las librerías se bajan de fondo; las fotos se buscan solas
    cargarLib("pdf").catch(() => {}); cargarLib("pptx").catch(() => {});
    if (R.app.puedeCargar()) buscarFotos();
    else $("cat-detalle").textContent = "";
  }

  function iniciar() {
    $("cat-buscar-fotos").addEventListener("click", buscarFotos);
    $("cat-recalcular").addEventListener("click", recalcularPrecios);
    $("cat-precio").addEventListener("change", guardarPref);
    $("cat-iva").addEventListener("change", guardarPref);
    $("cat-pdf").addEventListener("click", () => descargar("pdf"));
    $("cat-pptx").addEventListener("click", () => descargar("pptx"));
    $("dlg-catalogo").addEventListener("close", () => { if (busqueda) busqueda.abort(); });
    const tabla = $("cat-tabla");
    tabla.addEventListener("input", e => {
      const tr = e.target.closest("tr[data-i]");
      if (!tr || !e.target.dataset.campo) return;
      const it = items[Number(tr.dataset.i)];
      if (e.target.dataset.campo === "precio") it.precio = e.target.value === "" ? null : Number(e.target.value);
      else it.nombre = e.target.value;
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

  R.vistaCatalogo = { iniciar, mostrar() {}, abrir, _sugerirPrecio: sugerirPrecio };
})(window.COMPRAS);
