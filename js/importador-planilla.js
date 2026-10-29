// Lector de la planilla anterior "Proceso Ecommerce" (Google Sheets exportada a .xlsx):
// hoja "Hoja 1" (+ "Historial", opcional). Devuelve lo que encaja en el sistema nuevo:
// artículos con sus datos web, órdenes de compra con sus líneas (y si llegaron) y colores.
// Funciona igual en el navegador (window.ImportadorPlanilla) y en Node (require).
// Ubica las columnas por el texto del encabezado, no por la posición.
(function (global) {
  'use strict';

  const RE_NUMERO = /^\d{4}-\d{8}$/;
  const ESTADOS_TEXTO = /^(publicada|lista\b.*|pendiente\b.*|sin descripcion.*|ok)$/i;

  const sinTildes = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const clave = t => sinTildes(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // Encabezados que se reconocen (el primero que aparezca)
  const COLUMNAS = {
    orden: ['d', 'nro orden', 'numero orden', 'orden'],
    fecha: ['fecha orden', 'fecha'],
    proveedor: ['proveedor'],
    codigo: ['codigo'],
    nombre: ['nombre', 'descripcion articulo'],
    cantidad: ['cantidad'],
    precio: ['precio unit', 'precio unitario', 'precio'],
    estado: ['estado'],
    tipo: ['tipo'],
    variantes: ['variantes'],
    llego: ['llego'],
    cod_barra: ['cod barra', 'codigo de barra', 'codigo barra'],
    foto: ['foto'],
    descripcion_ok: ['descripcion ok'],
    cargado_web: ['cargado web'],
    catalogo: ['catalogo'],
    fecha_alta_web: ['fecha alta web'],
    sin_stock: ['sin stock'],
    observaciones: ['observaciones'],
    titulo_web: ['titulo web'],
    descripcion_web: ['descripcion web'],
    estado_descripcion: ['estado descripcion'],
    ya_no_esta: ['ya no esta en la pagina', 'ya no esta'],
  };

  // ---------- Conversión de celdas ----------
  const vacio = v => v === undefined || v === null || String(v).trim() === '';

  function aBool(v) {
    if (typeof v === 'boolean') return v;
    return ['true', 'verdadero', 'si', 'sí', '1'].includes(String(v ?? '').trim().toLowerCase());
  }
  const esBool = v => typeof v === 'boolean' || /^(true|false)$/i.test(String(v ?? '').trim());

  // "21660,1" -> 21660.1 ; "1.234,5" -> 1234.5 ; números tal cual. Redondea a 2 decimales.
  function aNumero(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
    let t = String(v ?? '').trim().replace(/[$\s]/g, '');
    if (!t) return null;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  const iso = (a, m, d) => {
    const f = new Date(Date.UTC(a, m - 1, d));
    return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d
      ? `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
  };
  // Date (xlsx con cellDates), número de serie de Excel, o texto d/m/aaaa
  function aFecha(v) {
    if (vacio(v)) return null;
    if (v instanceof Date) { // +12 h: aguanta el corrimiento de zona horaria de la librería
      const f = new Date(v.getTime() + 12 * 3600 * 1000);
      return iso(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate());
    }
    if (typeof v === 'number') { const f = new Date(Math.round((v - 25569) * 86400000) + 12 * 3600 * 1000); return iso(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate()); }
    const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? iso(Number(m[3]), Number(m[2]), Number(m[1])) : null;
  }

  const texto = v => (vacio(v) ? '' : String(v).replace(/\r\n/g, '\n').trim());
  const codigoDe = v => (typeof v === 'number' ? String(v) : texto(v));

  // ---------- Hoja -> filas con nombre ----------
  function filasDeHoja(XLSX, hoja) {
    const m = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: '' });
    // La fila de encabezados es la primera que trae "código" y "proveedor"
    const iEnc = m.findIndex(f => { const k = f.map(clave); return k.includes('codigo') && k.includes('proveedor'); });
    if (iEnc < 0) return null;
    const claves = m[iEnc].map(clave);
    const col = {};
    for (const [campo, alias] of Object.entries(COLUMNAS)) {
      const i = claves.findIndex(k => alias.includes(k));
      if (i >= 0) col[campo] = i;
    }
    if (col.codigo === undefined) return null;
    if (col.orden === undefined) col.orden = 0;
    return m.slice(iEnc + 1).map((f, i) => ({ fila: iEnc + 2 + i, f, col }));
  }

  // Textos largos: en la planilla vieja observaciones / título / descripción / estado están corridos de lugar
  // según la fila (el script que los cargaba escribía una columna antes). Se clasifican por lo que son.
  function clasificarTextos(f, col) {
    const celdas = ['observaciones', 'titulo_web', 'descripcion_web', 'estado_descripcion']
      .filter(c => col[c] !== undefined).map(c => ({ pos: col[c], t: texto(f[col[c]]) }))
      .filter(x => x.t && !esBool(x.t));
    const r = { observaciones: '', titulo_web: '', descripcion_web: '', estado_descripcion: '' };
    r.estado_descripcion = (celdas.filter(x => ESTADOS_TEXTO.test(x.t)).pop() || { t: '' }).t;
    let textos = celdas.filter(x => !ESTADOS_TEXTO.test(x.t)).sort((a, b) => a.pos - b.pos);
    if (!textos.length) return r;
    const larga = x => x.t.length >= 100 || x.t.includes('\n');
    let desc = textos.filter(larga).sort((a, b) => b.t.length - a.t.length)[0]
      || textos.find(x => /^[•✦*\-]/.test(x.t)); // descripciones cortas en viñetas
    if (desc) { r.descripcion_web = desc.t; textos = textos.filter(x => x !== desc); }
    if (textos.length) { // el último texto corto es el título; los anteriores, observaciones
      r.titulo_web = textos[textos.length - 1].t;
      r.observaciones = textos.slice(0, -1).map(x => x.t).join(' · ');
    }
    return r;
  }

  const sufijoDe = codigo => { const i = codigo.lastIndexOf('-'); return i > 0 ? codigo.slice(i + 1).toUpperCase() : ''; };
  const padreDe = codigo => { const i = codigo.lastIndexOf('-'); return i > 0 ? codigo.slice(0, i) : ''; };
  const capitalizar = t => t.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());

  // ---------- Lectura completa ----------
  // libro: workbook de SheetJS leído con { cellDates: true }
  function leerPlanilla(XLSX, libro) {
    const avisos = [];
    const nombres = libro.SheetNames;
    const buscar = re => nombres.find(n => re.test(clave(n)));
    const nombreHoja = buscar(/^hoja 1$|^proceso/) || nombres[0];
    const nombreHist = buscar(/^historial/);

    const fuentes = [];
    const principal = filasDeHoja(XLSX, libro.Sheets[nombreHoja]);
    if (!principal) throw new Error(`No encontré los encabezados ("Código", "Proveedor"…) en la hoja "${nombreHoja}". ¿Es la planilla Proceso Ecommerce?`);
    fuentes.push({ hoja: nombreHoja, filas: principal });
    if (nombreHist && nombreHist !== nombreHoja) {
      const h = filasDeHoja(XLSX, libro.Sheets[nombreHist]);
      if (h) fuentes.push({ hoja: nombreHist, filas: h });
      else avisos.push(`La hoja "${nombreHist}" no tiene los encabezados esperados: se ignora.`);
    }

    // 1) Filas normalizadas
    const filas = [];
    const ordenesDePrincipal = new Set(), paresDePrincipal = new Set();
    fuentes.forEach(({ hoja, filas: rs }, idx) => {
      for (const { fila, f, col } of rs) {
        const g = c => (col[c] === undefined ? '' : f[col[c]]);
        const codigo = codigoDe(g('codigo'));
        if (!codigo) continue;
        const orden = texto(g('orden'));
        const par = orden + '|' + codigo;
        // Las órdenes que están en las dos hojas se toman de "Hoja 1"; del Historial solo lo que falte
        if (idx === 0) { if (orden) { ordenesDePrincipal.add(orden); paresDePrincipal.add(par); } }
        else if (ordenesDePrincipal.has(orden) && paresDePrincipal.has(par)) continue;
        const llegoTexto = g('llego');
        filas.push({
          hoja, fila, orden, fecha: aFecha(g('fecha')), proveedor: texto(g('proveedor')), codigo,
          nombre: texto(g('nombre')), cantidad: aNumero(g('cantidad')), precio: aNumero(g('precio')),
          llego: vacio(llegoTexto) ? /llegada/i.test(texto(g('estado'))) : aBool(llegoTexto),
          tipo: texto(g('tipo')).toUpperCase(), variantes: texto(g('variantes')),
          cod_barra: texto(g('cod_barra')),
          foto: aBool(g('foto')), descripcion_ok: aBool(g('descripcion_ok')), cargado_web: aBool(g('cargado_web')),
          catalogo: aBool(g('catalogo')), sin_stock: aBool(g('sin_stock')), ya_no_esta: aBool(g('ya_no_esta')),
          fecha_alta_web: aFecha(g('fecha_alta_web')), ...clasificarTextos(f, col),
        });
      }
    });
    if (!filas.length) throw new Error('La planilla no tiene artículos.');

    const codigos = new Set(filas.map(x => x.codigo));

    // 2) Artículos: uno por código, juntando lo que digan todas sus filas (más nuevas primero)
    const porCodigo = new Map();
    for (const x of filas) { if (!porCodigo.has(x.codigo)) porCodigo.set(x.codigo, []); porCodigo.get(x.codigo).push(x); }
    const recientes = rs => [...rs].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || b.fila - a.fila);
    const articulos = [];
    const coloresVistos = new Map(); // sufijo -> { nombre -> veces }
    let variantesSinPadre = 0;
    for (const [codigo, rs0] of porCodigo) {
      const rs = recientes(rs0), ult = rs[0];
      const primero = campo => (rs.find(x => x[campo]) || {})[campo] || '';
      const ors = campo => rs.some(x => x[campo]);
      const esVariante = rs.some(x => x.tipo === 'VARIANTE');
      const padre = esVariante ? padreDe(codigo) : '';
      const tienePadre = !!padre && codigos.has(padre);
      if (esVariante && !tienePadre) variantesSinPadre++;
      const suf = esVariante ? sufijoDe(codigo) : '';
      if (esVariante && suf) {
        const nombreColor = capitalizar(primero('variantes'));
        const m = coloresVistos.get(suf) || new Map();
        if (nombreColor) m.set(nombreColor, (m.get(nombreColor) || 0) + 1);
        coloresVistos.set(suf, m);
      }
      const fechas = rs.map(x => x.fecha_alta_web).filter(Boolean).sort();
      articulos.push({
        codigo, descripcion: primero('nombre'), proveedor: primero('proveedor'),
        tipo: esVariante ? 'VARIANTE' : (rs.some(x => x.tipo === 'INDIVIDUAL') ? 'INDIVIDUAL' : 'PADRE'),
        padre: tienePadre ? padre : null, color: esVariante && tienePadre ? suf : null, variantes: '',
        cod_barra: primero('cod_barra'),
        foto: ors('foto'), descripcion_ok: ors('descripcion_ok'), cargado_web: ors('cargado_web'), catalogo: ors('catalogo'),
        sin_stock: ult.sin_stock, ya_no_esta: ult.ya_no_esta,
        fecha_alta_web: fechas[0] || null,
        observaciones: primero('observaciones'), titulo_web: primero('titulo_web'),
        descripcion_web: primero('descripcion_web'), estado_descripcion: primero('estado_descripcion'),
      });
    }
    // Lista de sufijos de cada artículo principal (como la deja "Crear variantes")
    const hijos = new Map();
    for (const a of articulos) if (a.padre) (hijos.get(a.padre) || hijos.set(a.padre, []).get(a.padre)).push(a.color);
    for (const a of articulos) if (hijos.has(a.codigo)) a.variantes = [...new Set(hijos.get(a.codigo).filter(Boolean))].sort().join(', ');
    // Primero los principales y después las variantes (la variante apunta a su principal)
    articulos.sort((a, b) => (a.tipo === 'VARIANTE') - (b.tipo === 'VARIANTE'));

    // Colores nuevos para el catálogo: solo los sufijos en los que la planilla es clara (el mismo nombre en
    // casi todas las variantes). Los dudosos no se crean: se agregan a mano en la sección Colores.
    const colores = [...coloresVistos.entries()]
      .filter(([suf]) => /^[A-Z0-9]{2,5}$/.test(suf))
      .map(([suf, nombres]) => {
        const lista = [...nombres.entries()].sort((x, y) => y[1] - x[1]);
        const total = lista.reduce((n, [, v]) => n + v, 0);
        return lista.length && total >= 2 && lista[0][1] / total >= 0.7 ? { codigo: suf, nombre: lista[0][0] } : null;
      }).filter(Boolean);

    // 3) Órdenes de compra. Las variantes con su principal no llevan línea (la cantidad es del principal)
    const hijaDeOtro = new Set(articulos.filter(a => a.padre).map(a => a.codigo));
    const porOrden = new Map();
    let sinOrden = 0, sinCantidad = 0, numeroInvalido = 0, mezclas = 0;
    for (const x of filas) {
      if (hijaDeOtro.has(x.codigo)) continue;
      if (!x.orden) { sinOrden++; continue; }
      if (!RE_NUMERO.test(x.orden)) { numeroInvalido++; continue; }
      if (!(x.cantidad > 0)) { sinCantidad++; continue; }
      let o = porOrden.get(x.orden);
      if (!o) porOrden.set(x.orden, o = { numero: x.orden, fecha: x.fecha, proveedor: x.proveedor, lineas: [] });
      if ((x.proveedor && o.proveedor && x.proveedor !== o.proveedor) || (x.fecha && o.fecha && x.fecha !== o.fecha)) mezclas++;
      if (!o.fecha) o.fecha = x.fecha;
      if (!o.proveedor) o.proveedor = x.proveedor;
      o.lineas.push({ codigo: x.codigo, descripcion: x.nombre, cantidad: x.cantidad, precio_unitario: x.precio, llego: x.llego });
    }
    const ordenes = [...porOrden.values()].filter(o => {
      if (!o.fecha) { avisos.push(`La orden ${o.numero} no tiene fecha: no se importa.`); return false; }
      if (!o.proveedor) { avisos.push(`La orden ${o.numero} no tiene proveedor: no se importa.`); return false; }
      return true;
    }).sort((a, b) => a.numero.localeCompare(b.numero));

    if (variantesSinPadre) avisos.push(`${variantesSinPadre} variantes no tienen su artículo principal en la planilla: se cargan como artículos sueltos, con su propia cantidad.`);
    if (sinOrden) avisos.push(`${sinOrden} filas no tienen orden de compra: se cargan solo como artículos.`);
    if (sinCantidad) avisos.push(`${sinCantidad} filas con cantidad 0 o vacía: se cargan como artículos pero sin línea de orden.`);
    if (numeroInvalido) avisos.push(`${numeroInvalido} filas con un número de orden que no tiene el formato 0000-00000000: solo artículos.`);
    if (mezclas) avisos.push(`${mezclas} filas de una misma orden tienen otro proveedor u otra fecha: se usó el de la primera fila.`);

    const lineas = ordenes.reduce((n, o) => n + o.lineas.length, 0);
    const resumen = {
      filas: filas.length, articulos: articulos.length,
      variantes: articulos.filter(a => a.padre).length,
      ordenes: ordenes.length, lineas, llegaron: ordenes.reduce((n, o) => n + o.lineas.filter(l => l.llego).length, 0),
      proveedores: [...new Set([...ordenes.map(o => o.proveedor), ...articulos.map(a => a.proveedor)].filter(Boolean))].sort(),
      colores: colores.length, hojas: fuentes.map(s => s.hoja),
    };
    return { articulos, ordenes, colores, resumen, avisos };
  }

  const api = { leerPlanilla, _interno: { aNumero, aFecha, aBool, clasificarTextos, clave } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ImportadorPlanilla = api;
})(typeof window !== 'undefined' ? window : globalThis);
