// =====================================================================
//  Vista: Colores. Catálogo de colores que se reutiliza en las variantes
//  de cualquier producto. El sufijo (WHI) forma parte del código de las
//  variantes (123445-WHI), por eso no se puede cambiar; el nombre sí.
// =====================================================================
(function (R) {
  const { $, esc, toast } = R.util;
  const app = () => R.app;
  let colores = [];

  function pintar() {
    const puede = app().puedeCargar();
    $("colores-tabla").innerHTML = `<thead><tr><th>Sufijo</th><th>Nombre</th><th>Ejemplo</th><th>Estado</th>${puede ? "<th></th>" : ""}</tr></thead>
      <tbody>${colores.map(c => `<tr class="${c.activo ? "" : "inactivo"}" data-id="${c.id}">
        <td><strong>${esc(c.codigo)}</strong></td>
        <td>${puede ? `<input class="nombre-corto" data-color="${c.id}" value="${esc(c.nombre)}" maxlength="40" aria-label="Nombre del color ${esc(c.codigo)}">` : esc(c.nombre)}</td>
        <td>123445-${esc(c.codigo)}</td>
        <td>${c.activo ? "Activo" : "Desactivado"}</td>
        ${puede ? `<td><div class="acciones-fila"><button type="button" class="link ${c.activo ? "peligro" : ""}" data-alternar="${c.id}">${c.activo ? "Desactivar" : "Activar"}</button></div></td>` : ""}
      </tr>`).join("") || `<tr><td colspan="5" class="vacio">Todavía no hay colores.</td></tr>`}</tbody>`;
  }

  async function mostrar() {
    $("colores-tabla").innerHTML = `<tbody><tr><td class="cargando">Cargando…</td></tr></tbody>`;
    try { colores = await R.api.colores.listar(); pintar(); }
    catch (e) { $("colores-tabla").innerHTML = `<tbody><tr><td>${esc(e.message)}</td></tr></tbody>`; }
  }

  async function accion(promesa, ok) {
    try { await promesa; if (ok) toast(ok); }
    catch (e) { toast(e.message, "error", 6000); }
    await mostrar();
  }

  function iniciar() {
    $("form-color").addEventListener("submit", async e => {
      e.preventDefault();
      const codigo = $("nc-codigo").value.trim(), nombre = $("nc-nombre").value.trim();
      try {
        await R.api.colores.crear(codigo, nombre);
        toast(`Color "${nombre}" agregado: ${codigo.toUpperCase()}.`);
        $("form-color").reset();
        await mostrar();
      } catch (err) { toast(err.message, "error", 6000); }
    });
    $("colores-tabla").addEventListener("change", e => {
      const i = e.target.closest("input[data-color]");
      if (!i) return;
      const c = colores.find(x => x.id === Number(i.dataset.color)), nombre = i.value.trim();
      if (!nombre) { i.value = c.nombre; return toast("El nombre no puede quedar vacío.", "error"); }
      if (nombre !== c.nombre) accion(R.api.colores.actualizar(c.id, { nombre }), `Color ${c.codigo}: ahora se llama "${nombre}". Las variantes ya creadas conservan el nombre con el que se crearon.`);
    });
    $("colores-tabla").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches("input[data-color]")) e.target.blur(); });
    $("colores-tabla").addEventListener("click", e => {
      const b = e.target.closest("[data-alternar]");
      if (!b) return;
      const c = colores.find(x => x.id === Number(b.dataset.alternar));
      accion(R.api.colores.actualizar(c.id, { activo: !c.activo }), c.activo ? `Color ${c.codigo} desactivado.` : `Color ${c.codigo} activado.`);
    });
  }

  R.vistaColores = { iniciar, mostrar };
})(window.COMPRAS);
