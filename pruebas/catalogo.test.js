// Pruebas del formato del catálogo de ingresos (js/catalogo-formato.js): PDF y PowerPoint.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { jsPDF } = require('jspdf');
const PptxGenJS = require('pptxgenjs');
const JSZip = require('jszip');
const F = require('../js/catalogo-formato');

// PNG de 1×1 píxel (rojo), para no depender de fotos reales
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const articulo = (n, extra = {}) => ({ codigo: String(855000 + n), nombre: 'BROCHE TRENDY ' + n, precio: 1200 + n, foto: PNG, fotoAncho: 400, fotoAlto: 300, fotoFormato: 'PNG', ...extra });
const lista = n => Array.from({ length: n }, (_, i) => articulo(i + 1));

test('precio: "$ 1,200" con coma de miles, como el catálogo de Manager', () => {
  assert.equal(F.textoPrecio(1200), '$ 1,200');
  assert.equal(F.textoPrecio(16999), '$ 16,999');
  assert.equal(F.textoPrecio(1250.4), '$ 1,250');
});

test('4 tarjetas por hoja: la cantidad de hojas', () => {
  assert.deepEqual([0, 1, 4, 5, 8, 9].map(F.hojasDe), [1, 1, 1, 2, 2, 3]);
});

test('PDF: A4 vertical, una hoja cada 4 artículos', () => {
  for (const [n, hojas] of [[1, 1], [4, 1], [5, 2], [12, 3]]) {
    const doc = F.crearPDF(jsPDF, lista(n));
    assert.equal(doc.getNumberOfPages(), hojas, `${n} artículos`);
  }
  const doc = F.crearPDF(jsPDF, lista(2));
  const { width, height } = doc.internal.pageSize;
  assert.deepEqual([Math.round(width), Math.round(height)], [210, 297]);
  const bytes = Buffer.from(doc.output('arraybuffer'));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
});

test('PDF: sin foto, sin precio y con nombres largos no falla', () => {
  const items = [articulo(1, { foto: null, fotoAncho: 0, fotoAlto: 0 }), articulo(2, { precio: null }), articulo(3, { nombre: 'MOCHILA DE VIAJE CON RUEDAS Y CANDADO INCLUIDO EDICION LIMITADA BAGCHERRY' })];
  assert.equal(F.crearPDF(jsPDF, items).getNumberOfPages(), 1);
  assert.equal(F.crearPDF(jsPDF, items, { mostrarPrecio: false, mostrarIva: false }).getNumberOfPages(), 1);
});

async function diapositivas(items, opciones) {
  const buf = await F.crearPPTX(PptxGenJS, items, opciones).write({ outputType: 'nodebuffer' });
  const zip = await JSZip.loadAsync(buf);
  const nombres = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
  const xml = await Promise.all(nombres.map(n => zip.files[n].async('string')));
  return { xml, presentacion: await zip.files['ppt/presentation.xml'].async('string') };
}

test('PowerPoint: una diapositiva A4 vertical por hoja, con textos editables', async () => {
  const { xml, presentacion } = await diapositivas(lista(5));
  assert.equal(xml.length, 2);
  // 210 × 297 mm en EMU (1 mm = 36000)
  assert.match(presentacion, /<p:sldSz cx="7560000" cy="10692000"/);
  assert.match(xml[0], /CÓD\. 855001/);
  assert.match(xml[0], /BROCHE TRENDY 1/);
  assert.match(xml[0], /\$ 1,201/);
  assert.match(xml[0], /\+IVA/);
  assert.match(xml[1], /CÓD\. 855005/);
  assert.equal((xml[0].match(/<p:pic>/g) || []).length, 4, 'una foto por tarjeta');
});

test('PowerPoint: sin precio no pone píldora ni "+IVA", y sin foto avisa', async () => {
  const { xml } = await diapositivas([articulo(1, { foto: null, fotoAncho: 0, fotoAlto: 0 })], { mostrarPrecio: false });
  assert.doesNotMatch(xml[0], /\+IVA/);
  assert.doesNotMatch(xml[0], /\$ 1,/);
  assert.match(xml[0], /Sin foto/);
  assert.equal((xml[0].match(/<p:pic>/g) || []).length, 0);
});

test('PowerPoint: sin "+IVA" cuando se desactiva', async () => {
  const { xml } = await diapositivas(lista(1), { mostrarIva: false });
  assert.match(xml[0], /\$ 1,201/);
  assert.doesNotMatch(xml[0], /\+IVA/);
});
