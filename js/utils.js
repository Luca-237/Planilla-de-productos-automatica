window.COMPRAS = window.COMPRAS || {};

(function (R) {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // Para comparar/buscar: sin tildes, mayúsculas, sin espacios extremos
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

  // Usuario <-> email de login. "Antonella" -> "antonella@compras.cindymayorista.com.ar";
  // si ya escribieron un email completo, se respeta.
  const dominioUsuarios = () => ((window.COMPRAS_CONFIG || {}).dominioUsuarios || "compras.local").toLowerCase();
  const aEmail = u => {
    const s = String(u || "").trim().toLowerCase();
    return s.includes("@") ? s : `${s}@${dominioUsuarios()}`;
  };
  const aUsuario = email => {
    const s = String(email || "").toLowerCase(), sufijo = "@" + dominioUsuarios();
    return s.endsWith(sufijo) ? s.slice(0, -sufijo.length) : s;
  };

  // ---------- Fechas y números ----------
  const hoy = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const fmtFecha = iso => iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—";
  const fmtNum = (n, dec = 0) => Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: dec });
  const fmtPesos = n => n == null ? "—" : "$ " + Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fechaHora = iso => iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "nunca";
  const plural = (n, uno, varios) => `${fmtNum(n)} ${n === 1 ? uno : varios}`;

  let timerToast;
  function toast(mensaje, tipo = "ok", ms = 3500) {
    const el = $("toast");
    el.textContent = mensaje;
    el.classList.toggle("error", tipo === "error");
    el.hidden = false;
    clearTimeout(timerToast);
    timerToast = setTimeout(() => { el.hidden = true; }, ms);
  }

  // CSV para Excel en español: separador ";" y BOM para que respete las tildes
  function descargarCSV(nombreArchivo, filas) {
    const celda = v => {
      const s = String(v ?? "");
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const texto = "﻿" + filas.map(f => f.map(celda).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
    a.download = nombreArchivo;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Cierra cualquier diálogo con los botones [data-cerrar]
  function iniciarDialogos() {
    document.addEventListener("click", e => {
      const b = e.target.closest("[data-cerrar]");
      if (b) b.closest("dialog").close();
    });
  }

  // Íconos de interfaz (Lucide, SVG en línea; nunca emojis)
  const svg = cuerpo => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cuerpo}</svg>`;
  const ICONOS = {
    alerta: svg(`<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>`),
    check: svg(`<path d="M20 6 9 17l-5-5"/>`),
    archivo: svg(`<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>`),
    descarga: svg(`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>`),
  };

  // ---------- Ayudas "i" ----------
  // Ícono que muestra una explicación mientras el mouse está encima (o tiene el foco con el teclado).
  // En el HTML fijo se escribe a mano: <span class="info" tabindex="0" data-info="…"></span>
  const info = texto => `<span class="info" tabindex="0" role="img" aria-label="${esc(texto)}" data-info="${esc(texto)}"></span>`;

  function iniciarAyudas() {
    const globo = document.createElement("div");
    globo.className = "globo-info";
    globo.setAttribute("role", "tooltip");
    globo.hidden = true;
    let actual = null;

    function mostrar(el) {
      actual = el;
      // Dentro de un diálogo abierto el globo tiene que ir adentro, si no queda tapado
      (el.closest("dialog[open]") || document.body).appendChild(globo);
      globo.textContent = el.dataset.info;
      globo.hidden = false;
      const r = el.getBoundingClientRect(), g = globo.getBoundingClientRect(), m = 8;
      let left = r.left + r.width / 2 - g.width / 2;
      left = Math.max(m, Math.min(left, window.innerWidth - g.width - m));
      let top = r.top - g.height - 8;
      if (top < m) top = r.bottom + 8; // sin lugar arriba: va abajo
      globo.style.left = `${left}px`;
      globo.style.top = `${top}px`;
    }
    function ocultar() { actual = null; globo.hidden = true; }

    document.addEventListener("mouseover", e => {
      const el = e.target.closest(".info[data-info]");
      if (el && el !== actual) mostrar(el);
    });
    document.addEventListener("mouseout", e => {
      const el = e.target.closest(".info[data-info]");
      if (el && el === actual && !el.contains(e.relatedTarget)) ocultar();
    });
    document.addEventListener("focusin", e => { if (e.target.matches(".info[data-info]:focus-visible")) mostrar(e.target); });
    document.addEventListener("focusout", e => { if (e.target === actual) ocultar(); });
    document.addEventListener("scroll", () => { if (actual) ocultar(); }, true);
    document.addEventListener("click", e => { if (e.target.closest(".info[data-info]")) e.stopPropagation(); }, true);
  }

  // ---------- Tema: automático (como el sistema) → claro → oscuro ----------
  // Es una preferencia de cada persona en su navegador (no un dato del equipo): va en localStorage.
  // El <head> de index.html ya lo aplica antes de dibujar la página.
  const TEMAS = {
    auto: { siguiente: "claro", texto: "automático (como el sistema)", icono: svg(`<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>`) },
    claro: { siguiente: "oscuro", texto: "claro", icono: svg(`<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>`) },
    oscuro: { siguiente: "auto", texto: "oscuro", icono: svg(`<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>`) },
  };
  const temaActual = () => document.documentElement.dataset.tema || "auto";

  function pintarBotonesTema() {
    const t = TEMAS[temaActual()];
    document.querySelectorAll("[data-tema-boton]").forEach(b => {
      b.innerHTML = t.icono;
      const texto = `Tema: ${t.texto}. Clic para cambiar a ${TEMAS[t.siguiente].texto}.`;
      b.title = texto;
      b.setAttribute("aria-label", texto);
    });
  }

  function iniciarTema() {
    pintarBotonesTema();
    document.addEventListener("click", e => {
      if (!e.target.closest("[data-tema-boton]")) return;
      const nuevo = TEMAS[temaActual()].siguiente;
      if (nuevo === "auto") delete document.documentElement.dataset.tema;
      else document.documentElement.dataset.tema = nuevo;
      try { if (nuevo === "auto") localStorage.removeItem("compras-tema"); else localStorage.setItem("compras-tema", nuevo); } catch (err) {}
      pintarBotonesTema();
    });
  }

  // Estado de una línea de OC (como lo calcula la base en v_oc_lineas)
  const ESTADOS = {
    pendiente: "Pendiente", parcial: "Parcial", completa: "Completa", cerrada: "Cerrada", cancelada: "Cancelada",
  };
  const chipEstado = e => `<span class="estado ${esc(e)}">${esc(ESTADOS[e] || e)}</span>`;

  // Proveedor: el nombre corto (Target, Bagcherry…) o, si no tiene, la razón social de Manager
  const nombreProveedor = p => p ? (String(p.nombre_corto || "").trim() || p.nombre || "") : "";
  // Etiqueta para poner al lado del código del artículo; la razón social queda en el globo del mouse
  const etiquetaProveedor = (nombre, razonSocial) => nombre
    ? `<span class="prov"${razonSocial && razonSocial !== nombre ? ` title="${esc(razonSocial)}"` : ""}>${esc(nombre)}</span>` : "";

  R.util = {
    $, esc, norm, aEmail, aUsuario, hoy, fmtFecha, fmtNum, fmtPesos, fechaHora, plural, toast, descargarCSV,
    iniciarDialogos, info, iniciarAyudas, iniciarTema, ICONOS, ESTADOS, chipEstado, nombreProveedor, etiquetaProveedor,
  };
})(window.COMPRAS);
