// Pruebas del lector de la planilla anterior "Proceso Ecommerce".
// La planilla real está en datos-privados (no va al repo): si falta, esa prueba se saltea.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const { leerPlanilla, planActualizacion, _interno: I } = require('../js/importador-planilla');

const ENC1 = ['d', 'Fecha Orden', 'Proveedor', 'Código', 'Nombre', 'Cantidad', 'Precio Unit.', 'Estado', 'Tipo', 'Variantes', 'Llego', 'Cód. Barra',
  'Foto', 'Descripción OK', 'Cargado Web', 'Catálogo', 'Fecha Alta Web', 'Sin Stock', 'Observaciones', 'Título Web', 'Descripción Web', 'Estado Descripción', 'Ya no está en la página'];
const ENC2 = ENC1.filter(c => c !== 'Sin Stock' && c !== 'Ya no está en la página'); // el Historial no los tiene

// Una fila por nombre de columna; lo que no se nombra queda vacío
const fila = (enc, v) => enc.map(c => (v[c] === undefined ? '' : v[c]));
const libro = (hoja1, historial) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ENC1, ...hoja1.map(v => fila(ENC1, v))], { cellDates: true }), 'Hoja 1');
  if (historial) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ENC2, ...historial.map(v => fila(ENC2, v))], { cellDates: true }), 'Historial');
  return wb;
};
const base = { d: '3333-00001797', 'Fecha Orden': '04/05/2026', Proveedor: 'ALL BRANDS S.R.L.', Estado: 'MERCADERÍA LLEGADA', Tipo: 'PADRE', Llego: 'TRUE', Foto: 'TRUE', 'Descripción OK': 'TRUE', 'Cargado Web': 'TRUE', 'Catálogo': 'TRUE' };
const DESC = 'Incorporá esta cartera práctica y versátil que combina funcionalidad y estilo moderno, perfecta para tu negocio.\n✦ Material: Nylon';

test('conversiones: números con coma, fechas de varias formas, booleanos', () => {
  assert.equal(I.aNumero('21660,1'), 21660.1);
  assert.equal(I.aNumero('1.234,5'), 1234.5);
  assert.equal(I.aNumero(14000), 14000);
  assert.equal(I.aNumero(''), null);
  assert.equal(I.aFecha('05/05/2026'), '2026-05-05');
  assert.equal(I.aFecha('4/07/2026'), '2026-07-04');
  assert.equal(I.aFecha('31/02/2026'), null);
  assert.equal(I.aFecha(new Date(Date.UTC(2026, 4, 5))), '2026-05-05');
  assert.equal(I.aFecha(new Date(Date.UTC(2026, 4, 4, 23, 59))), '2026-05-05'); // corrimiento de zona horaria
  assert.equal(I.aFecha(46147), '2026-05-05'); // número de serie de Excel
  assert.equal(I.aBool('TRUE'), true); assert.equal(I.aBool(false), false); assert.equal(I.aBool(''), false);
});

test('textos corridos de lugar: se clasifican por lo que son', () => {
  const col = { observaciones: 0, titulo_web: 1, descripcion_web: 2, estado_descripcion: 3 };
  const c = f => I.clasificarTextos(f, col);
  // lo normal
  assert.deepEqual(c(['', 'Cartera Oreiro por Mayor', DESC, 'PUBLICADA']), { observaciones: '', titulo_web: 'Cartera Oreiro por Mayor', descripcion_web: DESC, estado_descripcion: 'PUBLICADA' });
  // corrido una columna: el título en observaciones, la descripción en "título" y el estado en "descripción"
  assert.deepEqual(c(['Brillo Labial x24u por Mayor', DESC, 'PUBLICADA', 'FALSE']), { observaciones: '', titulo_web: 'Brillo Labial x24u por Mayor', descripcion_web: DESC, estado_descripcion: 'PUBLICADA' });
  // una observación de verdad (tres textos)
  assert.deepEqual(c(['Pedir otro color', 'Título corto', DESC, '']), { observaciones: 'Pedir otro color', titulo_web: 'Título corto', descripcion_web: DESC, estado_descripcion: '' });
  // solo un estado, y descripciones cortas en viñetas
  assert.deepEqual(c(['', 'Termo Minnie 750ml', 'LISTA - PENDIENTE PUBLICAR', '']), { observaciones: '', titulo_web: 'Termo Minnie 750ml', descripcion_web: '', estado_descripcion: 'LISTA - PENDIENTE PUBLICAR' });
  assert.equal(c(['', '', '• Marca y Modelo: Everlast, Gorra Cap.', 'FALSE']).descripcion_web, '• Marca y Modelo: Everlast, Gorra Cap.');
});

test('artículos y órdenes: variantes, cantidades, lo que llegó, valores y tipos de celda', () => {
  const r = leerPlanilla(XLSX, libro([
    { ...base, 'Código': '131022', Nombre: 'CARTERA OREIRO', Cantidad: 72, 'Precio Unit.': '21660,1', Variantes: 'GENERADAS', 'Fecha Alta Web': new Date(Date.UTC(2026, 4, 15)), 'Título Web': 'Cartera Oreiro', 'Descripción Web': DESC, 'Estado Descripción': 'PUBLICADA', 'Ya no está en la página': 'FALSE' },
    { ...base, 'Código': '131022-NEG', Nombre: 'CARTERA OREIRO NEGRO', Cantidad: 72, 'Precio Unit.': '21660,1', Tipo: 'VARIANTE', Variantes: 'NEGRO', 'Ya no está en la página': 'TRUE' },
    { ...base, 'Código': '131022-BEI', Nombre: 'CARTERA OREIRO BEIGE', Cantidad: 72, Tipo: 'VARIANTE', Variantes: 'BEIGE' },
    { ...base, 'Código': '3440006-NEG', Nombre: 'SIN PADRE NEGRO', Cantidad: 10, 'Precio Unit.': 5, Tipo: 'VARIANTE', Variantes: 'NEGRO' },
    { ...base, d: '3333-00001798', 'Código': '8283', Nombre: 'SIN CANTIDAD', Cantidad: 0, Llego: 'FALSE', Estado: 'EN PREPARACIÓN', Foto: 'FALSE' },
    { ...base, d: '', 'Fecha Orden': '', 'Código': '43327', Nombre: 'SIN ORDEN', Cantidad: '', Llego: 'FALSE' },
    { ...base, d: '3333-00001798', 'Código': '9DMI8335', Nombre: 'TERMO', Cantidad: 18, 'Precio Unit.': 14000, Llego: false, 'Sin Stock': true },
  ]));
  const art = c => r.articulos.find(a => a.codigo === c);
  // variantes con su principal: sin línea de orden; el principal lista sus sufijos
  assert.equal(art('131022').variantes, 'BEI, NEG');
  assert.deepEqual([art('131022-NEG').tipo, art('131022-NEG').padre, art('131022-NEG').color, art('131022-NEG').ya_no_esta], ['VARIANTE', '131022', 'NEG', true]);
  // sin principal: artículo suelto con su propia cantidad
  assert.deepEqual([art('3440006-NEG').tipo, art('3440006-NEG').padre, art('3440006-NEG').color], ['VARIANTE', null, null]);
  assert.equal(art('131022').fecha_alta_web, '2026-05-15');
  assert.equal(art('131022').descripcion_web, DESC);
  assert.equal(art('131022').estado_descripcion, 'PUBLICADA');
  assert.equal(art('9DMI8335').sin_stock, true);
  // principales antes que variantes
  assert.ok(r.articulos.findIndex(a => a.codigo === '131022') < r.articulos.findIndex(a => a.codigo === '131022-NEG'));
  // órdenes: 1797 con el principal y la variante huérfana; 1798 solo con el termo; "sin orden" y cantidad 0 no tienen línea
  assert.deepEqual(r.ordenes.map(o => [o.numero, o.fecha, o.proveedor, o.lineas.map(l => l.codigo)]),
    [['3333-00001797', '2026-05-04', 'ALL BRANDS S.R.L.', ['131022', '3440006-NEG']], ['3333-00001798', '2026-05-04', 'ALL BRANDS S.R.L.', ['9DMI8335']]]);
  const l = r.ordenes[0].lineas[0];
  assert.deepEqual([l.cantidad, l.precio_unitario, l.llego], [72, 21660.1, true]);
  assert.equal(r.ordenes[1].lineas[0].llego, false);
  assert.ok(art('43327') && art('8283'), 'los artículos sin orden o sin cantidad igual se cargan');
  assert.equal(r.resumen.ordenes, 2); assert.equal(r.resumen.lineas, 3); assert.equal(r.resumen.llegaron, 2); assert.equal(r.resumen.variantes, 2);
  assert.ok(r.avisos.some(a => /no tienen su artículo principal/.test(a)));
  assert.ok(r.avisos.some(a => /no tienen orden de compra/.test(a)));
  assert.ok(r.avisos.some(a => /cantidad 0/.test(a)));
  // colores: NEG se repite con el mismo nombre; BEI aparece una sola vez (no alcanza para crearlo)
  assert.deepEqual(r.colores, [{ codigo: 'NEG', nombre: 'Negro' }]);
});

test('el mismo artículo en varias órdenes junta lo trabajado; el Historial solo aporta lo que falta', () => {
  const r = leerPlanilla(XLSX, libro([
    { ...base, d: '3333-00001900', 'Fecha Orden': '01/06/2026', 'Código': '8212', Nombre: 'ART', Cantidad: 10, 'Precio Unit.': 100, Foto: 'FALSE', 'Cargado Web': 'FALSE', Llego: 'FALSE', Estado: 'EN PREPARACIÓN' },
    { ...base, d: '3333-00001839', 'Fecha Orden': '01/05/2026', 'Código': '8212', Nombre: 'ART', Cantidad: 5, 'Precio Unit.': 90, 'Fecha Alta Web': '10/05/2026', 'Título Web': 'Título viejo' },
  ], [
    { d: '3333-00001839', 'Fecha Orden': '01/05/2026', Proveedor: 'ALL BRANDS S.R.L.', 'Código': '8212', Nombre: 'ART', Cantidad: 5, Llego: 'TRUE' }, // ya está en Hoja 1
    { d: '3333-00001839', 'Fecha Orden': '01/05/2026', Proveedor: 'ALL BRANDS S.R.L.', 'Código': '8300', Nombre: 'OTRO', Cantidad: 7, Llego: 'TRUE' }, // solo en el Historial
    { d: '3333-00001700', 'Fecha Orden': '2/04/2026', Proveedor: 'MODAX SRL', 'Código': '844256', Nombre: 'SET', Cantidad: 288, 'Precio Unit.': '1949,36', Llego: 'TRUE', Foto: 'TRUE' },
  ]));
  const a = r.articulos.find(x => x.codigo === '8212');
  assert.deepEqual([a.foto, a.cargado_web, a.fecha_alta_web, a.titulo_web], [true, true, '2026-05-10', 'Título viejo']); // se junta lo marcado en cualquier fila
  assert.equal(r.articulos.length, 3);
  const o = n => r.ordenes.find(x => x.numero === n);
  assert.deepEqual(o('3333-00001839').lineas.map(l => l.codigo), ['8212', '8300']); // 8212 una sola vez
  assert.equal(o('3333-00001700').fecha, '2026-04-02');
  assert.equal(o('3333-00001700').lineas[0].precio_unitario, 1949.36);
  assert.equal(o('3333-00001900').lineas[0].llego, false);
});

test('si no es la planilla esperada, avisa', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 'b'], [1, 2]]), 'Otra');
  assert.throws(() => leerPlanilla(XLSX, wb), /encabezados/);
});

const REAL = path.join(__dirname, '..', 'datos-privados', 'planilla-proceso-ecommerce.xlsx');
test('planilla real (si está en datos-privados)', { skip: !fs.existsSync(REAL) && 'falta la planilla' }, () => {
  const r = leerPlanilla(XLSX, XLSX.readFile(REAL, { cellDates: true }));
  assert.ok(r.resumen.ordenes > 300 && r.resumen.articulos > 4000);
  // todo lo que va a la base cumple las reglas de la base
  for (const a of r.articulos) {
    assert.ok(a.codigo.trim().length > 0);
    assert.ok(['PADRE', 'VARIANTE', 'INDIVIDUAL'].includes(a.tipo));
    if (a.padre) assert.ok(r.articulos.some(x => x.codigo === a.padre), 'padre inexistente ' + a.codigo);
  }
  for (const o of r.ordenes) {
    assert.match(o.numero, /^\d{4}-\d{8}$/);
    assert.match(o.fecha, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(o.proveedor && o.lineas.length);
    for (const l of o.lineas) { assert.ok(l.cantidad > 0); assert.ok(r.articulos.some(a => a.codigo === l.codigo)); }
  }
  assert.equal(new Set(r.articulos.map(a => a.codigo)).size, r.articulos.length, 'códigos repetidos');
});

test('actualizar con una planilla más nueva: renombres de códigos, campos que cambiaron, llegadas y líneas que ya no van', () => {
  // La primera importación leyó "4.730.400.006" (formato de la celda); la planilla nueva trae el valor real
  const anterior = leerPlanilla(XLSX, libro([
    { ...base, 'Código': '4.730.400.006', Nombre: 'BOLSO', Cantidad: 10, 'Precio Unit.': 100, Llego: 'FALSE', 'Cargado Web': 'FALSE', Foto: 'FALSE' },
    { ...base, 'Código': '3440006-NEG', Nombre: 'SUELTA', Cantidad: 4, 'Precio Unit.': 5, Tipo: 'VARIANTE', Variantes: 'NEGRO', Llego: 'TRUE' },
    { ...base, 'Código': '9.999', Nombre: 'DUP', Cantidad: 2, Llego: 'FALSE' },
    { ...base, 'Código': '9999', Nombre: 'DUP', Cantidad: 3, Llego: 'FALSE' },
    { ...base, 'Código': '8000', Nombre: 'IGUAL', Cantidad: 1, Llego: 'FALSE' },
  ]));
  const nueva = leerPlanilla(XLSX, libro([
    { ...base, 'Código': 4730400006, Nombre: 'BOLSO', Cantidad: 10, 'Precio Unit.': 100, Llego: 'TRUE', 'Cargado Web': 'TRUE', Foto: 'TRUE', 'Título Web': 'Bolso lindo' },
    { ...base, 'Código': '3440006', Nombre: 'PADRE NUEVO', Cantidad: 4, 'Precio Unit.': 5 },
    { ...base, 'Código': '3440006-NEG', Nombre: 'SUELTA', Cantidad: 4, 'Precio Unit.': 5, Tipo: 'VARIANTE', Variantes: 'NEGRO', Llego: 'TRUE' },
    { ...base, 'Código': 9999, Nombre: 'DUP', Cantidad: 2, Llego: 'FALSE' },
    { ...base, 'Código': '9999', Nombre: 'DUP', Cantidad: 3, Llego: 'FALSE' },
    { ...base, 'Código': '8000', Nombre: 'IGUAL', Cantidad: 1, 'Precio Unit.': 9, Llego: 'FALSE' },
    { ...base, d: '3333-00001900', 'Fecha Orden': '01/06/2026', 'Código': 'NUEVO1', Nombre: 'ARTICULO NUEVO', Cantidad: 5 },
  ]));
  const p = planActualizacion(anterior, nueva);
  assert.deepEqual(p.renombres, [{ de: '4.730.400.006', a: '4730400006' }, { de: '9.999', a: '9999' }]);
  assert.deepEqual(p.articulosNuevos.map(a => a.codigo).sort(), ['3440006', 'NUEVO1']);
  assert.deepEqual(p.ordenesNuevas.map(o => o.numero), ['3333-00001900']);
  // solo los campos que cambiaron en la planilla; lo demás no se toca
  const bolso = p.doc.articulos.find(a => a.codigo === '4730400006');
  assert.deepEqual(Object.keys(bolso.campos).sort(), ['cargado_web', 'foto', 'titulo_web']);
  // la variante suelta ahora cuelga de su principal
  assert.deepEqual(p.doc.articulos.find(a => a.codigo === '3440006-NEG').campos, { padre: '3440006', color: 'NEG' });
  assert.ok(!p.doc.articulos.some(a => a.codigo === '8000'), 'sin cambios en el artículo');
  // órdenes que ya estaban
  assert.deepEqual(p.doc.llegadas, [{ orden: '3333-00001797', codigo: '4730400006', indice: 0 }]);
  assert.deepEqual(p.doc.lineas_precio, [{ orden: '3333-00001797', codigo: '8000', indice: 0, precio_unitario: 9 }]);
  assert.deepEqual(p.doc.lineas_quitadas, [{ orden: '3333-00001797', codigo: '3440006-NEG', indice: 0 }]); // ahora es variante: sin línea propia
  assert.deepEqual(p.doc.lineas_nuevas.map(l => [l.orden, l.codigo, l.cantidad, l.indice]), [['3333-00001797', '3440006', 4, 0]]); // el principal nuevo trae su línea
  assert.deepEqual([p.resumen.renombres, p.resumen.llegadas, p.resumen.lineasQuitadas, p.resumen.desllegadas], [2, 1, 1, 0]);
  // una línea que figuraba llegada y ahora no: no se toca, se avisa
  const llego = leerPlanilla(XLSX, libro([{ ...base, 'Código': '8000', Nombre: 'X', Cantidad: 1, Llego: 'TRUE' }]));
  const noLlego = leerPlanilla(XLSX, libro([{ ...base, 'Código': '8000', Nombre: 'X', Cantidad: 1, Llego: 'FALSE' }]));
  const atras = planActualizacion(llego, noLlego);
  assert.deepEqual([atras.resumen.desllegadas, atras.doc.llegadas.length, atras.avisos.length], [1, 0, 1]);
});
