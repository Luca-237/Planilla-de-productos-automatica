// Pruebas de la lectura de la búsqueda de la tienda (función buscar-en-web).
// Node 24 lee el .ts directo (le saca los tipos). Sin internet: HTML armado
// con la misma forma que la búsqueda real de cindymayorista.com.ar.
// Con PROBAR_TIENDA=1 además consulta la tienda real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerResultados, clasificar, decodificar, revisarCodigo } from '../supabase/functions/buscar-en-web/index.ts';

const tarjeta = (codigo, nombre, url) => `<div class="col-xs-24 product-listing-item"><input type="hidden" value="1" name="products_id">
  <div class="product-box" itemscope itemtype="http://schema.org/Product"><meta itemprop="name" content="${nombre}" />
  <div itemprop="offers"><link itemprop="url" href="${url}" /></div>
  <a href="${url}">${nombre}</a> <span class="product-model">C&oacute;digo ${codigo}</span> <span>$&nbsp;32.999</span>
  <script>enhancedClick({"id":"1"})</script></div></div>`;
const pagina = (...t) => `<h1 class="page-title-home"><span>Resultado B&uacute;squeda</span></h1><div class="row product-listing">${t.join('')}</div>`;

test('lee código, nombre y link de cada resultado', () => {
  const r = leerResultados(pagina(tarjeta('148216', 'CARTERA SOHO SKORA', 'https://t/cartera'), tarjeta('8216', 'ALMOHADA CERVICAL TRAVEL BLUE', 'https://t/almohada')));
  assert.deepEqual(r, [
    { codigo: '148216', nombre: 'CARTERA SOHO SKORA', url: 'https://t/cartera' },
    { codigo: '8216', nombre: 'ALMOHADA CERVICAL TRAVEL BLUE', url: 'https://t/almohada' },
  ]);
});

test('publicado solo con el código idéntico: buscar 8216 trae también 148216', () => {
  const r = leerResultados(pagina(tarjeta('148216', 'CARTERA', 'https://t/a'), tarjeta('8216', 'ALMOHADA', 'https://t/b')));
  assert.deepEqual(clasificar('8216', r), { codigo: '8216', estado: 'publicado', url: 'https://t/b', nombre: 'ALMOHADA' });
  assert.equal(clasificar('821', r).estado, 'no_esta');
});

test('solo variantes: está 3M201-GRE pero no 3M201', () => {
  const r = leerResultados(pagina(tarjeta('3M201-GRE', 'MOCHILA GRIS', 'https://t/g'), tarjeta('3M201-PAL', 'MOCHILA', 'https://t/p')));
  assert.deepEqual(clasificar('3M201', r), { codigo: '3M201', estado: 'solo_variantes', url: 'https://t/g', nombre: 'MOCHILA GRIS' });
  // la variante en sí, sí está publicada
  assert.equal(clasificar('3M201-PAL', r).estado, 'publicado');
  // mayúsculas/minúsculas no importan
  assert.equal(clasificar('3m201-pal', r).estado, 'publicado');
});

test('sin resultados → no está', () => {
  assert.deepEqual(clasificar('NOEXISTE999', leerResultados(pagina())), { codigo: 'NOEXISTE999', estado: 'no_esta', url: '', nombre: '' });
});

test('decodifica las entidades de la tienda', () => {
  assert.equal(decodificar('C&oacute;digo &amp; Ni&ntilde;os &#176;'), 'Código & Niños °');
});

test('tienda real (solo con PROBAR_TIENDA=1)', { skip: !process.env.PROBAR_TIENDA && 'sin PROBAR_TIENDA' }, async () => {
  const base = 'https://www.cindymayorista.com.ar';
  const [a, b, c, d] = await Promise.all(['8216', '3M201', '855338', 'NOEXISTE999'].map(x => revisarCodigo(x, base)));
  assert.equal(a.estado, 'publicado');
  assert.equal(b.estado, 'solo_variantes');
  assert.equal(c.estado, 'publicado');
  assert.equal(d.estado, 'no_esta');
  console.log(JSON.stringify([a, b, c, d], null, 1));
});
