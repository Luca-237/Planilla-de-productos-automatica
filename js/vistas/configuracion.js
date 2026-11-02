// =====================================================================
//  Vista: Configuración. Por ahora, la apariencia: el color de fondo a
//  gusto (js/color.js calcula el resto de los tonos). Es personal: se
//  guarda en este navegador y no cambia lo que ven los demás.
// =====================================================================
(function (R) {
  const { $, toast } = R.util;
  const C = () => window.ColorFondo;

  // Colores sugeridos (el primero es el de siempre)
  const SUGERIDOS = [
    ["Verde pastel", "#C8F0D6"], ["Menta", "#CDEFE6"], ["Celeste", "#D3E8F8"], ["Lila", "#E3DAF5"],
    ["Rosa", "#F8DCE5"], ["Durazno", "#FBE3D2"], ["Amarillo", "#F4EDC2"], ["Gris", "#E2E6E3"],
  ];

  function actual() { return C().leer() || C().DEFECTO; }

  function pintar() {
    const hex = actual().toLowerCase();
    $("cfg-sugeridos").innerHTML = SUGERIDOS.map(([nombre, v]) =>
      `<button type="button" class="cfg-color" data-color="${v}" style="--c:${v}" aria-label="${nombre}" aria-pressed="${v.toLowerCase() === hex}" title="${nombre}"></button>`).join("");
    $("cfg-color").value = hex;
    $("cfg-hex").textContent = hex.toUpperCase();
    const real = C().pastel(hex), ajustado = C().hslAHex(real.h, real.s, real.l);
    // Si el color elegido era muy oscuro o muy claro, se avisa que se llevó a un pastel
    $("cfg-aviso").hidden = ajustado.toLowerCase() === hex;
    $("cfg-aviso").textContent = ajustado.toLowerCase() === hex ? "" : `Se ajustó a un tono pastel (${ajustado.toUpperCase()}) para que se lea bien.`;
    $("cfg-original").hidden = C().esDefecto(hex);
  }

  function poner(hex) {
    C().aplicar(hex);
    C().guardar(hex);
    pintar();
  }

  function iniciar() {
    $("cfg-sugeridos").addEventListener("click", e => {
      const b = e.target.closest("[data-color]");
      if (b) poner(b.dataset.color);
    });
    // Al mover el selector se ve en vivo
    $("cfg-color").addEventListener("input", e => poner(e.target.value));
    $("cfg-original").addEventListener("click", () => { poner(C().DEFECTO); toast("Volvió el verde pastel de siempre."); });
  }

  R.vistaConfiguracion = { iniciar, mostrar: pintar };
})(window.COMPRAS);
