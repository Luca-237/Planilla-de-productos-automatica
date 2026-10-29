// =====================================================================
//  Vista: Usuarios (solo admin). Crear cuentas, cambiar el rol,
//  activar/desactivar y poner una contraseña nueva. Todo pasa por la
//  Edge Function admin-usuarios, la única que tiene la clave de servicio.
// =====================================================================
(function (R) {
  const { $, esc, toast, aEmail, aUsuario, fechaHora } = R.util;
  const ROLES = [["carga", "Carga"], ["consulta", "Consulta"], ["admin", "Admin"]];
  let usuarios = [];

  function pintar() {
    $("tabla-usuarios").innerHTML = usuarios.map(u => `
      <tr class="${u.activo ? "" : "inactivo"}" data-id="${esc(u.id)}">
        <td>${esc(u.nombre || "(sin nombre)")}${u.soy_yo ? " <small>(vos)</small>" : ""}<small>Usuario: ${esc(aUsuario(u.email))}</small></td>
        <td>
          <select data-accion="rol" ${u.soy_yo ? "disabled title=\"No podés cambiar tu propio rol\"" : ""}>
            ${ROLES.map(([v, t]) => `<option value="${v}" ${u.rol === v ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </td>
        <td>${u.activo ? "Activo" : "Desactivado"}<small>Último ingreso: ${fechaHora(u.ultimo_ingreso)}</small></td>
        <td><div class="acciones-fila">
          <button type="button" class="link" data-accion="password">Nueva contraseña</button>
          ${u.soy_yo ? "" : `<button type="button" class="link ${u.activo ? "peligro" : ""}" data-accion="${u.activo ? "desactivar" : "activar"}">${u.activo ? "Desactivar" : "Activar"}</button>`}
        </div></td>
      </tr>`).join("") || `<tr><td colspan="4">No hay usuarios.</td></tr>`;
  }

  async function cargar() {
    $("tabla-usuarios").innerHTML = `<tr><td colspan="4" class="cargando">Cargando usuarios…</td></tr>`;
    try { usuarios = await R.api.usuarios.listar(); pintar(); }
    catch (e) { $("tabla-usuarios").innerHTML = `<tr><td colspan="4">${esc(e.message)}</td></tr>`; }
  }

  async function ejecutar(promesa, ok) {
    try { await promesa; toast(ok); }
    catch (e) { toast(e.message, "error", 6000); }
    await cargar();
  }

  async function crear(e) {
    e.preventDefault();
    $("usuario-error").textContent = "";
    const d = {
      nombre: $("nu-nombre").value.trim(), usuario: aEmail($("nu-usuario").value),
      password: $("nu-password").value, rol: $("nu-rol").value,
    };
    if (d.password.length < 8) return ($("usuario-error").textContent = "La contraseña tiene que tener al menos 8 caracteres.");
    if (d.rol === "admin" && !confirm(`${d.nombre} va a poder administrar usuarios y borrar documentos. ¿Continuar?`)) return;
    $("nu-crear").disabled = true;
    try {
      await R.api.usuarios.crear(d);
      toast(`Usuario "${aUsuario(d.usuario)}" creado. Pasale la contraseña en persona o por un medio privado.`, "ok", 6000);
      $("form-usuario").reset();
      await cargar();
    } catch (err) {
      $("usuario-error").textContent = err.message;
    } finally { $("nu-crear").disabled = false; }
  }

  function iniciar() {
    $("form-usuario").addEventListener("submit", crear);
    $("tabla-usuarios").addEventListener("change", e => {
      const sel = e.target.closest("select[data-accion=rol]");
      if (!sel) return;
      const u = usuarios.find(x => x.id === sel.closest("tr").dataset.id);
      if (sel.value === "admin" && !confirm(`${u.nombre} va a poder administrar usuarios y borrar documentos. ¿Continuar?`)) { sel.value = u.rol; return; }
      ejecutar(R.api.usuarios.cambiarRol(u.id, sel.value), "Rol actualizado.");
    });
    $("tabla-usuarios").addEventListener("click", e => {
      const b = e.target.closest("button[data-accion]");
      if (!b) return;
      const u = usuarios.find(x => x.id === b.closest("tr").dataset.id);
      if (b.dataset.accion === "password") {
        const p = prompt(`Nueva contraseña para ${u.nombre || aUsuario(u.email)} (mínimo 8 caracteres):`);
        if (p == null) return;
        if (p.length < 8) return toast("La contraseña tiene que tener al menos 8 caracteres.", "error");
        ejecutar(R.api.usuarios.resetearPassword(u.id, p), "Contraseña cambiada. Pasásela por un medio privado.");
      } else if (b.dataset.accion === "desactivar") {
        if (!confirm(`¿Desactivar a ${u.nombre}? No va a poder ingresar hasta que lo vuelvas a activar.`)) return;
        ejecutar(R.api.usuarios.desactivar(u.id), "Usuario desactivado.");
      } else if (b.dataset.accion === "activar") {
        ejecutar(R.api.usuarios.activar(u.id), "Usuario activado.");
      }
    });
  }

  R.vistaUsuarios = { iniciar, mostrar: cargar };
})(window.COMPRAS);
