// =====================================================================
//  Cuenta Cindy (Clerk) para las páginas estáticas de Cindy. Copiar tal cual a js/.
//  No depende de la app: expone window.CuentaCindy.
//
//    await CuentaCindy.cargar("pk_live_...")   -> instancia de Clerk o null (sin clave / no responde)
//    CuentaCindy.conSesion()                   -> hay cuenta Cindy abierta
//    CuentaCindy.token()                       -> token para Supabase (accessToken)
//    CuentaCindy.abrirIngreso()                -> cuadro "Iniciá sesión en Cindy"
//    CuentaCindy.salir()                       -> cierra la cuenta Cindy EN TODAS LAS APPS
//    CuentaCindy.alCambiar(cb)                 -> avisa cuando se abre o cierra la sesión
//    CuentaCindy.confirmar(texto, {aceptar})   -> confirmación dentro de la página (no usa confirm())
//
//  Si la clave está vacía o Clerk no responde en 6 s, la página sigue solo con su login propio.
// =====================================================================
(function () {
  const ESPERA_MS = 6000;
  const TRADUCCION = "https://cdn.jsdelivr.net/npm/@clerk/localizations@4.24.4/dist/es-UY.mjs";
  let clerk = null;

  function cargarScript(src, atributos = {}) {
    return new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = src; s.async = true; s.crossOrigin = "anonymous";
      Object.entries(atributos).forEach(([k, v]) => s.setAttribute(k, v));
      s.onload = ok;
      s.onerror = () => mal(new Error("No se pudo cargar " + src));
      document.head.appendChild(s);
    });
  }

  function conLimite(promesa) {
    return Promise.race([promesa, new Promise((_, mal) => setTimeout(() => mal(new Error("Clerk no respondió a tiempo")), ESPERA_MS))]);
  }

  async function cargar(clave) {
    if (clerk) return clerk;
    const pk = String(clave || "").trim();
    if (!/^pk_(test|live)_/.test(pk)) return null;
    try {
      const host = atob(pk.split("_")[2]).slice(0, -1); // Frontend API, sale de la clave
      const [traduccion] = await conLimite(Promise.all([
        import(TRADUCCION).then(m => m.esUY).catch(() => undefined),
        cargarScript(`https://${host}/npm/@clerk/ui@1/dist/ui.browser.js`),
        cargarScript(`https://${host}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, { "data-clerk-publishable-key": pk }),
      ]));
      // Textos que la traducción deja en inglés
      const localization = traduccion && {
        ...traduccion,
        formFieldInputPlaceholder__username: "Tu usuario",
        formFieldInputPlaceholder__password: "Tu contraseña",
      };
      await conLimite(window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor }, localization }));
      clerk = window.Clerk;
    } catch (e) {
      console.warn("Cuenta Cindy no disponible:", e);
      clerk = null;
    }
    return clerk;
  }

  const hayClerk = () => !!clerk;
  const conSesion = () => !!(clerk && clerk.session && clerk.user);
  const token = async () => (conSesion() ? await clerk.session.getToken() : null);
  const abrirIngreso = () => clerk.openSignIn({ forceRedirectUrl: location.href, signUpForceRedirectUrl: location.href });
  const salir = async () => { if (conSesion()) await clerk.signOut(); };
  const alCambiar = cb => { if (clerk) clerk.addListener(cb); };

  function confirmar(mensaje, { aceptar = "Aceptar", cancelar = "Cancelar" } = {}) {
    return new Promise(listo => {
      const d = document.createElement("dialog");
      d.className = "cc-confirmar";
      d.innerHTML = `<p></p><div class="cc-botones"><button type="button" data-r="0"></button><button type="button" data-r="1"></button></div>`;
      d.querySelector("p").textContent = mensaje;
      d.querySelector('[data-r="0"]').textContent = cancelar;
      d.querySelector('[data-r="1"]').textContent = aceptar;
      let r = false;
      d.addEventListener("click", e => {
        const b = e.target.closest("button[data-r]");
        if (b) { r = b.dataset.r === "1"; d.close(); }
      });
      d.addEventListener("close", () => { d.remove(); listo(r); }); // Esc = cancelar
      document.body.appendChild(d);
      d.showModal();
      d.querySelector('[data-r="1"]').focus();
    });
  }

  window.CuentaCindy = { cargar, hayClerk, conSesion, token, abrirIngreso, salir, alCambiar, confirmar };
})();
