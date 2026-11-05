// Prueba del armado del Excel del backup: hojas, filas, formato y lectura de vuelta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { armarLibro, nombreArchivo, resumenFilas, TABLAS } from '../backup/armar-xlsx.mjs';

const datos = {
  planilla: [
    { orden: '3333-00002151', fecha_orden: '2026-10-01', proveedor: 'Target', razon_social: 'TARGET SRL', codigo: '855338', nombre: 'BROCHE', cantidad: '12.00', precio_unitario: '1500.5',
      estado: 'completa', recibido: '12.00', pendiente: '0', llego: true, foto: false, cargado_web: true, fecha_alta_web: '2026-11-04', web_estado: 'publicado', web_revisado_en: '2026-11-04T15:30:00Z',
      descripcion_web: 'Línea 1\nLínea 2', observaciones: null },
    { orden: '3333-00002151', fecha_orden: '2026-10-01', proveedor: 'Target', codigo: '855339', nombre: 'SIN DATOS', estado: 'pendiente', llego: false },
  ],
  tablas: {
    articulos: [{ codigo: '855338', descripcion: 'BROCHE', foto: false, extra: { a: 1 } }, { codigo: '855339', descripcion: 'X'.repeat(40000) }],
    ordenes_compra: [{ id: 1, numero: '3333-00002151' }],
  },
};

test('el libro tiene LÉEME, Planilla y una hoja por tabla, con los datos y el formato', async () => {
  const buf = await armarLibro(ExcelJS, datos, new Date('2026-11-04T16:00:00Z')).xlsx.writeBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  assert.deepEqual(wb.worksheets.map(h => h.name), ['LÉEME', 'Planilla', ...TABLAS]);

  const pl = wb.getWorksheet('Planilla');
  assert.equal(pl.rowCount, 3);
  const cab = pl.getRow(1).values.slice(1);
  const fila = pl.getRow(2).values.slice(1);
  const v = t => fila[cab.indexOf(t)];
  assert.equal(v('Código'), '855338');
  assert.equal(v('Llegó'), 'Sí');
  assert.equal(v('Foto'), 'No');
  assert.equal(v('Estado'), 'Completa');
  assert.equal(v('Cantidad'), 12);
  assert.equal(v('Precio unit.'), 1500.5);
  assert.equal(v('En la web (última revisión)'), 'En la web');
  assert.equal(v('Fecha alta web'), '2026-11-04');
  assert.equal(v('Descripción web'), 'Línea 1\nLínea 2');
  assert.equal(pl.getRow(1).font.bold, true);
  assert.equal(pl.views[0].state, 'frozen');
  assert.ok(pl.autoFilter);

  // Datos tal cual: columnas con el nombre de la base, objetos como texto y celdas largas recortadas
  const ar = wb.getWorksheet('articulos');
  assert.deepEqual(ar.getRow(1).values.slice(1), ['codigo', 'descripcion', 'foto', 'extra']);
  assert.equal(ar.getRow(2).getCell(4).value, '{"a":1}');
  assert.ok(String(ar.getRow(3).getCell(2).value).length <= 32000);
  assert.equal(wb.getWorksheet('remitos').rowCount, 1); // tabla vacía: solo el encabezado
});

test('el LÉEME cuenta las filas de cada hoja', async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await armarLibro(ExcelJS, datos).xlsx.writeBuffer());
  const textos = [];
  wb.getWorksheet('LÉEME').eachRow(r => textos.push(r.values.slice(1).join('|')));
  assert.ok(textos.includes('Planilla|2'));
  assert.ok(textos.includes('articulos|2'));
  assert.ok(textos.includes('remitos|0'));
  assert.deepEqual(resumenFilas(datos).ordenes_compra, 1);
});

test('el nombre del archivo lleva la fecha de Argentina', () => {
  assert.equal(nombreArchivo(new Date('2026-11-04T16:00:00Z')), 'backup-compras-cindy-2026-11-04.xlsx');
  assert.equal(nombreArchivo(new Date('2026-11-05T01:30:00Z')), 'backup-compras-cindy-2026-11-04.xlsx'); // 22:30 del 4 en Buenos Aires
});
