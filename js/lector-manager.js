// Lector de las exportaciones de Manager (Crystal Reports, .xls):
// "ORDEN DE COMPRA" y "REMITO DE INGRESO".
// Funciona igual en el navegador (window.LectorManager) y en Node (require).
// No depende de columnas fijas: ubica los encabezados por su texto.
(function (global) {
  'use strict';

  const RE_NUMERO = /^\d{4}-\d{8}$/;
  const RE_FECHA = /^(\d{2})\/(\d{2})\/(\d{4})$/;

  // Convierte la hoja en filas de celdas no vacías: [{c, texto, valor}]
  function filasDeHoja(XLSX, hoja) {
    const rango = XLSX.utils.decode_range(hoja['!ref']);
    const filas = [];
    for (let r = rango.s.r; r <= rango.e.r; r++) {
      const celdas = [];
      for (let c = rango.s.c; c <= rango.e.c; c++) {
        const cel = hoja[XLSX.utils.encode_cell({ r, c })];
        if (!cel || cel.v === undefined || cel.v === null) continue;
        const texto = String(cel.w !== undefined ? cel.w : cel.v).trim();
        if (texto === '') continue;
        celdas.push({ c, texto, valor: cel.v, tipo: cel.t });
      }
      filas.push({ r: r + 1, celdas });
    }
    return filas;
  }

  // "1,259,136.00" -> 1259136 ; también acepta números ya numéricos.
  // Se redondea a 2 decimales: Excel guarda ruido de coma flotante (13384.800000000001).
  function numero(celda) {
    if (!celda) return null;
    if (celda.tipo === 'n' && typeof celda.valor === 'number') return Math.round(celda.valor * 100) / 100;
    const limpio = celda.texto.replace(/[$\s]/g, '').replace(/,/g, '');
    const n = Number(limpio);
    return Number.isFinite(n) ? n : null;
  }

  // "23/10/2026" -> "2026-10-23"
  function fechaISO(texto) {
    const m = RE_FECHA.exec(texto || '');
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  }

  // Texto de la celda que sigue a una etiqueta en la misma fila
  function valorDespuesDe(filas, etiqueta) {
    for (const f of filas) {
      const i = f.celdas.findIndex(x => x.texto === etiqueta);
      if (i >= 0 && f.celdas[i + 1]) return f.celdas[i + 1];
    }
    return null;
  }

  function buscarCelda(filas, prueba) {
    for (const f of filas) for (const x of f.celdas) if (prueba(x.texto)) return { fila: f, celda: x };
    return null;
  }

  // Columna (índice) más cercana a "c" entre los encabezados
  function encabezadoMasCercano(columnas, c) {
    let mejor = null;
    for (const [nombre, col] of Object.entries(columnas)) {
      if (mejor === null || Math.abs(col - c) < Math.abs(columnas[mejor] - c)) mejor = nombre;
    }
    return mejor;
  }

  const redondear = n => Math.round(n * 100) / 100;

  function leerOrdenDeCompra(filas, avisos) {
    const numero_ = buscarCelda(filas, t => RE_NUMERO.test(t));
    const titulo = buscarCelda(filas, t => t === 'ORDEN DE COMPRA');
    // La fecha de la OC está en la fila siguiente al título
    let fecha = null;
    if (titulo) {
      const sig = filas.find(f => f.r > titulo.fila.r && f.celdas.some(x => RE_FECHA.test(x.texto)));
      if (sig) fecha = fechaISO(sig.celdas.find(x => RE_FECHA.test(x.texto)).texto);
    }
    const encabezado = filas.find(f => f.celdas.some(x => x.texto === 'Artículo') && f.celdas.some(x => x.texto === 'Cantidad'));
    if (!encabezado) throw new Error('No se encontró la fila de encabezados (Artículo / Cantidad).');
    const colDescripcion = encabezado.celdas.find(x => x.texto === 'Descripción').c;
    const pie = filas.find(f => f.celdas.some(x => x.texto === 'SubTotal 1'));
    const finItems = pie ? pie.r : Infinity;

    const lineas = [];
    let actual = null;
    for (const f of filas) {
      if (f.r <= encabezado.r || f.r >= finItems || f.celdas.length === 0) continue;
      const primera = f.celdas[0];
      if (f.celdas.some(x => x.texto === 'Plan de Entrega')) {
        if (!actual) { avisos.push(`Fila ${f.r}: "Plan de Entrega" sin artículo.`); continue; }
        const fechaPlan = f.celdas.find(x => RE_FECHA.test(x.texto));
        const cant = f.celdas.filter(x => x.texto !== 'Plan de Entrega' && !RE_FECHA.test(x.texto)).map(numero).find(n => n !== null);
        actual.plan_entrega.push({ fecha: fechaPlan ? fechaISO(fechaPlan.texto) : null, cantidad: cant ?? null });
      } else if (actual && actual.cantidad === null && f.celdas.every(x => numero(x) !== null)) {
        // Fila de importes: [bonificación %, cantidad, P.U., total]
        const nums = f.celdas.map(numero);
        if (nums.length >= 4) [actual.bonificacion, actual.cantidad, actual.precio_unitario, actual.total] = nums.slice(-4);
        else if (nums.length === 3) [actual.cantidad, actual.precio_unitario, actual.total] = nums;
        else avisos.push(`Fila ${f.r}: importes incompletos para ${actual.codigo}.`);
      } else if (f.celdas.length >= 2 && primera.c < colDescripcion) {
        // Fila de artículo: código (puede ser numérico) + descripción
        actual = { codigo: primera.texto, descripcion: f.celdas.slice(1).map(x => x.texto).join(' '), bonificacion: null, cantidad: null, precio_unitario: null, total: null, plan_entrega: [], fila: f.r };
        lineas.push(actual);
      } else {
        avisos.push(`Fila ${f.r}: no reconocida (${f.celdas.map(x => x.texto).join(' | ')}).`);
      }
    }

    const totales = {};
    for (const etiqueta of ['SubTotal 1', 'Desc/Rec', 'SubTotal 2', 'Impuesto']) {
      const c = valorDespuesDe(filas, etiqueta); totales[etiqueta] = c ? numero(c) : null;
    }
    const filaTotal = filas.find(f => f.celdas.some(x => x.texto === 'Total') && f.r >= finItems);
    totales.Total = filaTotal ? numero(filaTotal.celdas[filaTotal.celdas.length - 1]) : null;

    // Controles
    for (const l of lineas) {
      if (l.cantidad === null) avisos.push(`${l.codigo}: sin cantidad.`);
      else if (l.precio_unitario !== null && l.total !== null && Math.abs(redondear(l.cantidad * l.precio_unitario) - l.total) > 0.02)
        avisos.push(`${l.codigo}: cantidad × P.U. (${redondear(l.cantidad * l.precio_unitario)}) no da el total (${l.total}).`);
      const plan = l.plan_entrega.reduce((s, p) => s + (p.cantidad || 0), 0);
      if (l.plan_entrega.length && plan !== l.cantidad) avisos.push(`${l.codigo}: el plan de entrega suma ${plan} y se pidieron ${l.cantidad}.`);
    }
    const suma = redondear(lineas.reduce((s, l) => s + (l.total || 0), 0));
    if (totales['SubTotal 1'] !== null && Math.abs(suma - totales['SubTotal 1']) > 0.05)
      avisos.push(`La suma de las líneas (${suma}) no da el SubTotal 1 (${totales['SubTotal 1']}).`);
    const codigos = new Set();
    for (const l of lineas) { if (codigos.has(l.codigo)) avisos.push(`Código repetido en la OC: ${l.codigo}.`); codigos.add(l.codigo); }

    return {
      tipo: 'orden_compra',
      numero: numero_ ? numero_.celda.texto : null,
      fecha,
      proveedor: valorDespuesDe(filas, 'Proveedor')?.texto ?? null,
      cuit: valorDespuesDe(filas, 'C.U.I.T.')?.texto.replace(/\D/g, '') ?? null,
      comprador: valorDespuesDe(filas, 'Comprador')?.texto ?? null,
      vencimiento: fechaISO(valorDespuesDe(filas, 'Vencimiento')?.texto),
      // "|| 0" evita devolver -0 cuando no hay descuento
      descuento_porcentaje: totales['SubTotal 1'] ? (redondear(-100 * (totales['Desc/Rec'] || 0) / totales['SubTotal 1']) || 0) : null,
      totales,
      lineas,
    };
  }

  function leerRemitoDeIngreso(filas, avisos) {
    const titulo = buscarCelda(filas, t => t === 'REMITO DE INGRESO');
    const numero_ = buscarCelda(filas, t => RE_NUMERO.test(t));
    // El proveedor es el primer texto de la fila del título
    const proveedor = titulo ? titulo.fila.celdas[0].texto : null;
    const encabezado = filas.find(f => f.celdas.some(x => x.texto === 'Artículo') && f.celdas.some(x => x.texto === 'Cantidad'));
    if (!encabezado) throw new Error('No se encontró la fila de encabezados (Artículo / Cantidad).');
    const columnas = {};
    for (const x of encabezado.celdas) columnas[x.texto] = x.c;
    const pie = filas.find(f => f.r > encabezado.r && f.celdas.some(x => /^Percep/.test(x.texto)));
    const finItems = pie ? pie.r : Infinity;

    const lineas = [];
    for (const f of filas) {
      if (f.r <= encabezado.r || f.r >= finItems || f.celdas.length === 0) continue;
      const l = { codigo: null, descripcion: null, cantidad: null, costo: null, importe: null, fila: f.r };
      for (const x of f.celdas) {
        const col = encabezadoMasCercano(columnas, x.c);
        if (col === 'Artículo' && l.codigo === null) l.codigo = x.texto;
        else if (col === 'Descripción') l.descripcion = l.descripcion ? `${l.descripcion} ${x.texto}` : x.texto;
        else if (col === 'Cantidad') l.cantidad = numero(x);
        else if (col === 'Costo') l.costo = numero(x);
        else if (col === 'Importe') l.importe = numero(x);
      }
      if (!l.codigo || l.cantidad === null) { avisos.push(`Fila ${f.r}: no reconocida (${f.celdas.map(x => x.texto).join(' | ')}).`); continue; }
      if (l.costo !== null && l.importe !== null && Math.abs(redondear(l.cantidad * l.costo) - l.importe) > 0.02)
        avisos.push(`${l.codigo}: cantidad × costo no da el importe.`);
      lineas.push(l);
    }
    const filaTotal = filas.find(f => f.r >= finItems && f.celdas.some(x => x.texto === 'Total'));
    return {
      tipo: 'remito_ingreso',
      numero: numero_ ? numero_.celda.texto : null,
      fecha: fechaISO(valorDespuesDe(filas, 'Fecha')?.texto),
      proveedor,
      cuit: valorDespuesDe(filas, 'Cuit:')?.texto.replace(/\D/g, '') ?? null,
      total: filaTotal ? numero(filaTotal.celdas[filaTotal.celdas.length - 1]) : null,
      lineas,
    };
  }

  // Punto de entrada: recibe el workbook de SheetJS y la librería XLSX
  function leerDocumento(XLSX, libro) {
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = filasDeHoja(XLSX, hoja);
    const avisos = [];
    const textos = new Set(filas.flatMap(f => f.celdas.map(x => x.texto)));
    let doc;
    if (textos.has('ORDEN DE COMPRA')) doc = leerOrdenDeCompra(filas, avisos);
    else if (textos.has('REMITO DE INGRESO')) doc = leerRemitoDeIngreso(filas, avisos);
    else throw new Error('No es una orden de compra ni un remito de ingreso de Manager.');
    if (!doc.numero) avisos.push('No se encontró el número del comprobante.');
    if (!doc.cuit) avisos.push('No se encontró el CUIT del proveedor.');
    if (!doc.lineas.length) avisos.push('El documento no tiene artículos.');
    doc.avisos = avisos;
    return doc;
  }

  const api = { leerDocumento };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.LectorManager = api;
})(typeof window !== 'undefined' ? window : globalThis);
