// =====================================================================
//  Caché de lecturas en el navegador, para no pedirle a la base lo mismo
//  una y otra vez.
//   - Memoria: lo ya leído en esta pestaña.
//   - localStorage: lo chico (proveedores, colores, preferencias).
//   - IndexedDB: lo grande (planilla, pendientes, órdenes…): localStorage
//     tiene unos 5 MB y la planilla con miles de filas no entra.
//  Estrategia "stale-while-revalidate":
//   - Dentro del tiempo fresco (js/config.js → cache.frescoSegundos) no se
//     consulta nada.
//   - Pasado ese tiempo, las pantallas que pasan alActualizar muestran lo
//     guardado al instante y lo renuevan por atrás; las demás vuelven a
//     consultar.
//   - Todo se guarda POR USUARIO y se borra al salir.
//   - Al guardar un cambio, lo cacheado que depende de él se descarta (o,
//     en la planilla, se parcha en el lugar para no recargarla entera).
//  Si el navegador no deja guardar (ventana privada, sin espacio), sigue
//  funcionando solo con la memoria.
// =====================================================================
(function (R) {
  const PREFIJO = "compras.cache.v1.";
  const CHICAS = new Set(["proveedores", "colores", "preferencias"]); // el resto va a IndexedDB

  const cfg = () => Object.assign({ frescoSegundos: 60, maxHoras: 168 }, (window.COMPRAS_CONFIG || {}).cache);
  const mem = new Map();      // "uid.clave" -> { t, datos }
  const enVuelo = new Map();  // "uid.clave" -> Promise
  let escrituras = 0;         // sube con cada cambio: una lectura iniciada antes de un cambio no se guarda

  // ---------- Almacenes ----------
  let abierta = null;
  const abrirIDB = () => abierta || (abierta = new Promise((ok, no) => {
    try {
      const r = indexedDB.open("compras-cache", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("datos");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    } catch (e) { no(e); }
  }));
  const idb = (modo, fn) => abrirIDB().then(db => new Promise((ok, no) => {
    const tx = db.transaction("datos", modo), req = fn(tx.objectStore("datos"));
    tx.oncomplete = () => ok(req && req.result);
    tx.onerror = tx.onabort = () => no(tx.error);
  }));

  async function leerAlmacen(k, clave) {
    try {
      if (CHICAS.has(clave)) { const t = localStorage.getItem(PREFIJO + k); return t ? JSON.parse(t) : null; }
      return (await idb("readonly", s => s.get(k))) || null;
    } catch (e) { return null; }
  }
  async function guardarAlmacen(k, clave, entrada) {
    try {
      if (CHICAS.has(clave)) localStorage.setItem(PREFIJO + k, JSON.stringify(entrada));
      else await idb("readwrite", s => s.put(entrada, k));
    } catch (e) { /* sin espacio o bloqueado: queda en memoria */ }
  }
  async function borrarAlmacen(k, clave) {
    try {
      if (CHICAS.has(clave)) localStorage.removeItem(PREFIJO + k);
      else await idb("readwrite", s => s.delete(k));
    } catch (e) {}
  }

  // ---------- Lectura con caché ----------
  async function refrescar(k, clave, cargar) {
    if (enVuelo.has(k)) return enVuelo.get(k);
    const version = escrituras;
    const p = (async () => {
      const datos = await cargar();
      // Si mientras tanto se guardó algo, lo leído puede estar viejo: se devuelve pero no se guarda
      const guardado = version === escrituras;
      if (guardado) { const e = { t: Date.now(), datos }; mem.set(k, e); guardarAlmacen(k, clave, e); }
      return { datos, guardado };
    })().finally(() => enVuelo.delete(k));
    enVuelo.set(k, p);
    return p;
  }

  // opciones: { alActualizar(datos), siempreFresco }
  async function conCache(uid, clave, cargar, opciones = {}) {
    const k = uid + "." + clave, { frescoSegundos, maxHoras } = cfg();
    let e = mem.get(k);
    if (!e) { e = await leerAlmacen(k, clave); if (e) mem.set(k, e); }
    const edad = e ? (Date.now() - e.t) / 1000 : Infinity;
    if (e && (opciones.siempreFresco || edad < frescoSegundos)) return e.datos;
    // Vieja pero útil: se muestra ya y se renueva por atrás (solo si la pantalla sabe actualizarse)
    if (e && opciones.alActualizar && edad < maxHoras * 3600) {
      const antes = JSON.stringify(e.datos);
      refrescar(k, clave, cargar).then(r => {
        if (r.guardado && JSON.stringify(r.datos) !== antes) opciones.alActualizar(r.datos);
      }).catch(() => { /* sin conexión: se sigue con lo guardado */ });
      return e.datos;
    }
    return (await refrescar(k, clave, cargar)).datos;
  }

  // ---------- Cambios ----------
  // Descarta lo cacheado de ese usuario (las claves dadas; sin claves, todas menos las preferencias)
  const TODAS = ["pendientes", "lineas", "planilla", "sobrantes", "ordenes", "remitos", "proveedores", "colores"];
  function invalidar(uid, claves) {
    escrituras++;
    for (const c of claves || TODAS) { mem.delete(uid + "." + c); borrarAlmacen(uid + "." + c, c); }
  }

  // Cambia lo cacheado en el lugar (ej. una casilla de la planilla) sin tener que volver a pedirlo todo
  const pendientesDeGuardar = new Map();
  async function parchar(uid, clave, fn) {
    const k = uid + "." + clave;
    let e = mem.get(k);
    if (!e) { e = await leerAlmacen(k, clave); if (e) mem.set(k, e); }
    if (!e) return;
    escrituras++;
    fn(e.datos);
    clearTimeout(pendientesDeGuardar.get(k)); // se guarda una sola vez cuando se calma
    pendientesDeGuardar.set(k, setTimeout(() => { pendientesDeGuardar.delete(k); guardarAlmacen(k, clave, e); }, 800));
  }

  // Valor puesto a mano (preferencias del usuario)
  function poner(uid, clave, datos) {
    const e = { t: Date.now(), datos };
    mem.set(uid + "." + clave, e);
    guardarAlmacen(uid + "." + clave, clave, e);
  }

  // Al salir: no queda nada de nadie
  async function limpiarTodo() {
    escrituras++;
    mem.clear(); enVuelo.clear();
    pendientesDeGuardar.forEach(t => clearTimeout(t)); pendientesDeGuardar.clear();
    try {
      Object.keys(localStorage).filter(x => x.startsWith(PREFIJO)).forEach(x => localStorage.removeItem(x));
    } catch (e) {}
    try { await idb("readwrite", s => s.clear()); } catch (e) {}
  }

  R.cache = { conCache, invalidar, parchar, poner, limpiarTodo };
})(window.COMPRAS);
