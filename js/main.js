// =====================================================================
//  Arranque: verifica la sesión y maneja la navegación entre secciones
//  (#pendientes, #cargar, #planilla, #documentos, #usuarios).
// =====================================================================
(function (R) {
  const { $ } = R.util;
  const A = R.vistaAcceso;
  const VISTAS = {
    pendientes: () => R.vistaPendientes,
    cargar: () => R.vistaCargar,
    planilla: () => R.vistaPlanilla,
    documentos: () => R.vistaDocumentos,
    proveedores: () => R.vistaProveedores,
    usuarios: () => R.vistaUsuarios,
  };
  let vistaActual = null;

  // ---------- Ayudas compartidas por las vistas ----------
  const app = {
    esAdmin: () => !!R.estado.perfil && R.estado.perfil.rol === "admin",
    puedeCargar: () => !!R.estado.perfil && ["admin", "carga"].includes(R.estado.perfil.rol),
    diasAlerta: () => Number((window.COMPRAS_CONFIG || {}).diasAlerta) || 15,
    // <option> con los proveedores de una lista de filas
    opcionesProveedor(filas, seleccionado) {
      const nombres = [...new Set(filas.map(f => f.proveedor).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
      return `<option value="">Todos</option>` + nombres.map(n =>
        `<option value="${R.util.esc(n)}" ${n === seleccionado ? "selected" : ""}>${R.util.esc(n)}</option>`).join("");
    },
    // Vuelve a dibujar la sección abierta (después de guardar algo)
    refrescar() { if (vistaActual) VISTAS[vistaActual]().mostrar(); },
  };
  R.app = app;

  function ir() {
    let nombre = location.hash.replace("#", "") || "pendientes";
    if (!VISTAS[nombre] || (nombre === "usuarios" && !app.esAdmin()) || (nombre === "cargar" && !app.puedeCargar())) nombre = "pendientes";
    vistaActual = nombre;
    document.querySelectorAll("[data-seccion]").forEach(s => { s.hidden = s.id !== "vista-" + nombre; });
    document.querySelectorAll(".lateral a").forEach(a => a.classList.toggle("activo", a.dataset.vista === nombre));
    $("lateral").classList.remove("abierto");
    VISTAS[nombre]().mostrar();
  }

  // Después de un login válido (o de una sesión guardada)
  async function entrar() {
    A.mostrar("pantalla-carga");
    let perfil;
    try { perfil = await R.api.auth.miPerfil(); }
    catch (e) { A.mostrar("pantalla-login"); return A.errorLogin(e.message); }

    if (!perfil || !perfil.activo) {
      await R.api.auth.salir();
      A.mostrar("pantalla-login");
      return A.errorLogin("Tu usuario no está habilitado. Hablá con un admin.");
    }
    R.estado.perfil = perfil;
    A.mostrarUsuario(perfil);
    A.mostrar("app");
    ir();
    R.vistaProveedores.actualizarContador(); // cuántos proveedores faltan nombrar (en el menú)
  }

  function salir() {
    R.estado = estadoInicial();
    vistaActual = null;
  }

  const estadoInicial = () => ({ perfil: null });

  async function arrancar() {
    R.estado = estadoInicial();
    R.util.iniciarTema(); // también en las pantallas de configuración y login
    if (!R.api.configurado()) return A.mostrar("pantalla-config");

    try { R.api.iniciar(); }
    catch (e) { A.mostrar("pantalla-login"); return A.errorLogin(e.message); }

    R.util.iniciarDialogos();
    R.util.iniciarAyudas();
    A.iniciar({ alIngresar: entrar, alSalir: salir });
    Object.values(VISTAS).forEach(v => v().iniciar());

    window.addEventListener("hashchange", () => { if (R.estado.perfil) ir(); });
    $("btn-menu").addEventListener("click", () => $("lateral").classList.toggle("abierto"));

    // Si la sesión se cierra o vence (en esta pestaña o en otra), volver al login
    R.api.auth.alCambiar(evento => {
      if (evento === "SIGNED_OUT") { salir(); A.mostrar("pantalla-login"); }
    });

    if (await R.api.auth.sesion()) await entrar();
    else A.mostrar("pantalla-login");
  }

  // Modo de prueba sin base de datos: solo en la PC (abrir con ?demo)
  const local = location.protocol === "file:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  function cargarDemo() {
    return new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = "pruebas/api-falsa.js?v=" + Date.now();
      s.onload = ok; s.onerror = () => mal(new Error("No se encontró pruebas/api-falsa.js"));
      document.head.appendChild(s);
    });
  }

  (document.fonts ? document.fonts.ready : Promise.resolve())
    .then(() => (local && /[?&]demo\b/.test(location.search) ? cargarDemo() : null))
    .then(arrancar)
    .catch(e => { A.mostrar("pantalla-login"); A.errorLogin(e.message); });
})(window.COMPRAS);
