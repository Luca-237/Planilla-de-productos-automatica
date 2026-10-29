// Pruebas del lector de documentos de Manager.
// Los .xls reales están en datos-privados/muestras (no van al repo): si faltan,
// esas pruebas se saltean y quedan solo las de documentos armados acá.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const { leerDocumento } = require('../js/lector-manager');

const MUESTRAS = path.join(__dirname, '..', 'datos-privados', 'muestras');
const leerMuestra = nombre => leerDocumento(XLSX, XLSX.readFile(path.join(MUESTRAS, nombre)));
const hayMuestras = fs.existsSync(path.join(MUESTRAS, 'oc-2151.xls'));

// Lo esperado sale de los propios documentos y coincide con la planilla "Proceso Ecommerce"
const OCS = [
  { archivo: 'oc-2129.xls', numero: '3333-00002129', cuit: '20223812733', lineas: 14, total: 4123215.36, descuento: 50 },
  { archivo: 'oc-2133.xls', numero: '3333-00002133', cuit: '30714574112', lineas: 4, total: 1167480.6, descuento: 52.14 },
  { archivo: 'oc-2140.xls', numero: '3333-00002140', cuit: '30661041486', lineas: 12, total: 4657924.81, descuento: 35 },
  { archivo: 'oc-2142.xls', numero: '3333-00002142', cuit: '30710646550', lineas: 7, total: 2349778.86, descuento: 50 },
  { archivo: 'oc-2145.xls', numero: '3333-00002145', cuit: '30661041486', lineas: 4, total: 7814062.87, descuento: 0 },
  { archivo: 'oc-2151.xls', numero: '3333-00002151', cuit: '20223812733', lineas: 12, total: 688262.37, descuento: 50.07 },
];

for (const e of OCS) {
  test(`OC real ${e.numero}`, { skip: !hayMuestras && 'faltan las muestras' }, () => {
    const oc = leerMuestra(e.archivo);
    assert.equal(oc.tipo, 'orden_compra');
    assert.equal(oc.numero, e.numero);
    assert.equal(oc.cuit, e.cuit);
    assert.equal(oc.lineas.length, e.lineas);
    assert.equal(oc.totales.Total, e.total);
    assert.equal(oc.descuento_porcentaje, e.descuento);
    assert.deepEqual(oc.avisos, []);
    for (const l of oc.lineas) {
      assert.equal(typeof l.codigo, 'string');
      assert.ok(l.cantidad > 0);
      assert.equal(l.plan_entrega.length, 1);
    }
  });
}

test('OC 2140: códigos con punto y letras quedan como texto', { skip: !hayMuestras && 'faltan las muestras' }, () => {
  const oc = leerMuestra('oc-2140.xls');
  assert.deepEqual(oc.lineas.slice(0, 4).map(l => l.codigo), ['362.261051R', '167.8700105', '167.C26311R', '967.X1819']);
  assert.equal(oc.lineas[2].precio_unitario, 13384.8); // sin ruido de coma flotante
  assert.equal(oc.fecha, '2026-10-23');
  assert.equal(oc.proveedor, 'Lesedife S.A.');
});

test('remito de ingreso real', { skip: !hayMuestras && 'faltan las muestras' }, () => {
  const r = leerMuestra('remito-0003-00171575.xls');
  assert.equal(r.tipo, 'remito_ingreso');
  assert.equal(r.numero, '0003-00171575');
  assert.equal(r.fecha, '2026-10-28');
  assert.equal(r.cuit, '20223812733');
  assert.equal(r.lineas.length, 12);
  assert.deepEqual(r.lineas[0], { codigo: '855338', descripcion: 'BROCHE TRENDY', cantidad: 96, costo: 680, importe: 65280, fila: 20 });
  assert.deepEqual(r.avisos, []);
});

test('el remito trae los mismos códigos y cantidades que su OC', { skip: !hayMuestras && 'faltan las muestras' }, () => {
  const porCodigo = doc => Object.fromEntries(doc.lineas.map(l => [l.codigo, l.cantidad]));
  assert.deepEqual(porCodigo(leerMuestra('remito-0003-00171575.xls')), porCodigo(leerMuestra('oc-2151.xls')));
});

// ---- Documentos armados acá, con la misma forma que la exportación de Manager ----
function libroOC(lineas, subtotal) {
  const filas = [
    [], [], ['', '', 'BAGSTORE S.R.L', '', '3333-00009999'], ['', '', '', '', 'ORDEN DE COMPRA'], ['', '', '', '', '01/11/2026'],
    ['', 'Proveedor', 'PROVEEDOR DE PRUEBA', 'Comprador', 'Pablo'], ['', 'C.U.I.T.', '30-11111111-1', 'Vencimiento', '01/11/2026'],
    ['', '', 'Artículo', 'Descripción', 'Cantidad', 'P.U.', 'Total'],
  ];
  for (const [codigo, cant, pu, total, plan] of lineas) {
    filas.push(['', codigo, 'ARTICULO ' + codigo]);
    filas.push(['', '', '', 0, cant, pu, total]);
    filas.push(['', '', 'Plan de Entrega', '05/11/2026', plan ?? cant]);
  }
  filas.push(['', 'Percepción I.V.A.', 0, 'SubTotal 1', subtotal]);
  filas.push(['', '', '', 'Desc/Rec', 0]);
  filas.push(['', '', '', 'Total', '$', subtotal]);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filas), 'Sheet1');
  return libro;
}

test('OC armada: lee cabecera, líneas y plan de entrega', () => {
  const oc = leerDocumento(XLSX, libroOC([['A1', 10, 100, 1000], ['B2', 5, 20, 100]], 1100));
  assert.equal(oc.numero, '3333-00009999');
  assert.equal(oc.cuit, '30111111111');
  assert.equal(oc.vencimiento, '2026-11-01');
  assert.deepEqual(oc.lineas.map(l => [l.codigo, l.cantidad, l.precio_unitario, l.total]), [['A1', 10, 100, 1000], ['B2', 5, 20, 100]]);
  assert.deepEqual(oc.lineas[0].plan_entrega, [{ fecha: '2026-11-05', cantidad: 10 }]);
  assert.deepEqual(oc.avisos, []);
});

test('OC armada: avisa si cantidad × P.U. no da el total, si no cierra el subtotal y si el plan no suma lo pedido', () => {
  const oc = leerDocumento(XLSX, libroOC([['A1', 10, 100, 999, 8]], 5000));
  assert.equal(oc.avisos.length, 3);
  assert.match(oc.avisos.join(' '), /no da el total/);
  assert.match(oc.avisos.join(' '), /SubTotal 1/);
  assert.match(oc.avisos.join(' '), /plan de entrega suma 8/);
});

test('OC armada: avisa códigos repetidos', () => {
  const oc = leerDocumento(XLSX, libroOC([['A1', 1, 10, 10], ['A1', 2, 10, 20]], 30));
  assert.deepEqual(oc.avisos, ['Código repetido en la OC: A1.']);
});

test('rechaza un archivo que no es de Manager', () => {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['hola']]), 'Hoja');
  assert.throws(() => leerDocumento(XLSX, libro), /No es una orden de compra ni un remito/);
});
