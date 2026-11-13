// Pruebas del buscador de productos (función buscar-productos). Sin internet: respuestas armadas con la misma
// forma que la API de Tiendanube. Con PROBAR_TN=<archivo .env con la clave> además consulta la API real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizar, categoriaHoja, agrupar, pedirPagina, buscarProductos } from '../supabase/functions/buscar-productos/index.ts';

const MARRO = { id: 1, name: { es: 'Marroquinería' }, parent: null };
const MOCHILAS = { id: 2, name: { es: 'Mochilas' }, parent: 1 };
const INFANTILES = { id: 3, name: { es: 'Infantiles' }, parent: 2 };
const URBANAS = { id: 4, name: { es: 'Urbanas' }, parent: 2 };
const ESCOLAR = { id: 5, name: { es: 'Escolar' }, parent: null };
const CARTUCHERAS = { id: 6, name: { es: 'Cartucheras' }, parent: 5 };
let n = 0;
const prod = (nombre, cats, extra = {}) => ({ id: ++n, name: { es: nombre }, published: true, categories: cats, images: [{ src: `https://dcdn-us.mitiendanube.com/stores/1/products/${n}.jpg`, position: 1 }], ...extra });

test('normaliza: mayúsculas, tildes, espacios y signos no cuentan', () => {
  assert.equal(normalizar('  Mochila   NBA  Lakers '), 'mochila nba lakers');
  assert.equal(normalizar('CARTUCHERA 1 DIVISIÓN "Disney"'), 'cartuchera 1 division disney');
  assert.equal(normalizar(null), '');
});

test('categoría: la más profunda y su ruta completa', () => {
  const h = categoriaHoja(prod('X', [MARRO, MOCHILAS, INFANTILES]));
  assert.deepEqual(h, { id: 3, nombre: 'Infantiles', ruta: 'Marroquinería > Mochilas > Infantiles' });
  assert.deepEqual(categoriaHoja(prod('X', [])), { id: null, nombre: 'Sin categoría', ruta: 'Sin categoría' });
  // dos ramas: gana la más profunda; si empatan, la primera
  assert.equal(categoriaHoja(prod('X', [ESCOLAR, CARTUCHERAS, MARRO, MOCHILAS, URBANAS])).nombre, 'Urbanas');
  assert.equal(categoriaHoja(prod('X', [MARRO, MOCHILAS, INFANTILES, URBANAS])).nombre, 'Infantiles');
  // un padre que no viene en la lista no rompe nada
  assert.equal(categoriaHoja(prod('X', [{ id: 9, name: { es: 'Suelta' }, parent: 777 }])).ruta, 'Suelta');
});

test('junta los repetidos: el mismo nombre en la misma categoría es un solo resultado', () => {
  const r = agrupar([
    prod('CARTUCHERA TRENDY', [ESCOLAR, CARTUCHERAS]), prod('Cartuchera  Trendy', [ESCOLAR, CARTUCHERAS]), prod('cartuchera trendy', [ESCOLAR, CARTUCHERAS], { published: false }),
  ], 'cartuch');
  assert.equal(r.length, 1);
  assert.equal(r[0].cantidad, 3);
  assert.equal(r[0].nombre, 'CARTUCHERA TRENDY'); // se muestra el primero
  assert.equal(r[0].categoria, 'Cartucheras');
  assert.equal(r[0].ruta, 'Escolar > Cartucheras');
  assert.equal(r[0].publicado, true);
  assert.match(r[0].imagen, /\.jpg$/);
});

test('el mismo nombre en categorías distintas sale por separado', () => {
  const r = agrupar([prod('Mochila Trendy', [MARRO, MOCHILAS, URBANAS]), prod('Mochila Trendy', [MARRO, MOCHILAS, INFANTILES])], 'mochila');
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((x) => x.categoria).sort(), ['Infantiles', 'Urbanas']);
  assert.notEqual(r[0].clave, r[1].clave);
});

test('incluye los no publicados y los marca; sin publicar solo si ninguno está publicado', () => {
  const r = agrupar([prod('Mochila Vieja', [MARRO, MOCHILAS], { published: false })], 'mochila');
  assert.equal(r.length, 1);
  assert.equal(r[0].publicado, false);
});

test('orden: primero los que empiezan con lo escrito, después los publicados, después la relevancia de la API', () => {
  const r = agrupar([
    prod('Funda de mochila', [MARRO]),                           // contiene, publicada
    prod('Mochila sin publicar', [MARRO], { published: false }),  // empieza, sin publicar
    prod('Mochila publicada', [MARRO]),                          // empieza, publicada
    prod('Otra mochila', [MARRO]),
  ], 'mochila');
  assert.deepEqual(r.map((x) => x.nombre), ['Mochila publicada', 'Mochila sin publicar', 'Funda de mochila', 'Otra mochila']);
});

test('respeta el límite y un producto sin nombre no cuenta', () => {
  const lista = Array.from({ length: 12 }, (_, i) => prod('Bolso ' + i, [MARRO]));
  assert.equal(agrupar(lista, 'bolso', 8).length, 8);
  assert.equal(agrupar([prod('   ', [MARRO])], 'x').length, 0);
});

const respuestaFalsa = (status, cuerpo, cab = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => cab[k.toLowerCase()] ?? null }, json: async () => cuerpo });
const CFG = { token: 'T0K3N', tiendaId: '123' };

test('API: pide por q= con la clave en el encabezado, solo lectura y solo los campos necesarios', async () => {
  let visto;
  const r = await pedirPagina('cartuch', 1, CFG, async (url, init) => { visto = { url, init }; return respuestaFalsa(200, [prod('A', [ESCOLAR])]); });
  assert.equal(r.length, 1);
  assert.match(visto.url, /^https:\/\/api\.tiendanube\.com\/v1\/123\/products\?q=cartuch&per_page=30&page=1&fields=id,name,published,categories,images$/);
  assert.equal(visto.init.headers.Authentication, 'bearer T0K3N');
  assert.equal(visto.init.method, undefined); // GET
});

test('API: 429 espera y reintenta; 404 es "sin resultados"; 401 y 500 explican el problema', async () => {
  let k = 0;
  const ok = await pedirPagina('a', 1, CFG, async () => (++k === 1 ? respuestaFalsa(429, null, { 'x-rate-limit-reset': '5' }) : respuestaFalsa(200, [prod('A', [])])));
  assert.equal(k, 2);
  assert.equal(ok.length, 1);
  assert.deepEqual(await pedirPagina('a', 2, CFG, async () => respuestaFalsa(404, {})), []);
  await assert.rejects(pedirPagina('a', 1, CFG, async () => respuestaFalsa(401, {})), /rechazó la clave/);
  await assert.rejects(pedirPagina('a', 1, CFG, async () => respuestaFalsa(500, {})), /respondió 500/);
  await assert.rejects(pedirPagina('a', 1, CFG, async () => respuestaFalsa(200, { x: 1 })), /inesperado/);
});

test('busca en una segunda página solo si la primera no alcanza para juntar los únicos pedidos', async () => {
  // página 1: 30 productos que son todos el mismo nombre (1 único); página 2: 10 nombres distintos
  const pag1 = Array.from({ length: 30 }, () => prod('Broche Trendy', [ESCOLAR]));
  const pag2 = Array.from({ length: 10 }, (_, i) => prod('Broche Distinto ' + i, [ESCOLAR]));
  const paginas = [];
  const r = await buscarProductos('broche', 8, CFG, async (url) => {
    const p = Number(new URL(url).searchParams.get('page')); paginas.push(p);
    return respuestaFalsa(200, p === 1 ? pag1 : pag2);
  });
  assert.deepEqual(paginas, [1, 2]);
  assert.equal(r.length, 8);
  assert.equal(r[0].nombre, 'Broche Trendy');
  assert.equal(r[0].cantidad, 30);
  // si la primera ya alcanza, no pide la segunda
  const solo1 = [];
  await buscarProductos('bolso', 3, CFG, async (url) => { solo1.push(Number(new URL(url).searchParams.get('page'))); return respuestaFalsa(200, Array.from({ length: 30 }, (_, i) => prod('Bolso ' + i, [MARRO]))); });
  assert.deepEqual(solo1, [1]);
  // una página incompleta (menos de 30) tampoco pide más
  const corta = [];
  await buscarProductos('bolso', 8, CFG, async (url) => { corta.push(1); return respuestaFalsa(200, [prod('Bolso', [MARRO])]); });
  assert.equal(corta.length, 1);
});

test('API real (solo con PROBAR_TN=<archivo .env>)', { skip: !process.env.PROBAR_TN && 'sin PROBAR_TN' }, async () => {
  const fs = await import('node:fs');
  const env = Object.fromEntries(fs.readFileSync(process.env.PROBAR_TN, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
  const cfg = { token: env.TIENDANUBE_TOKEN, tiendaId: env.TIENDANUBE_STORE_ID };
  for (const q of ['cartuch', 'mochila nba', 'broche', 'neceser disney']) {
    const t0 = Date.now();
    const r = await buscarProductos(q, 8, cfg);
    console.log(JSON.stringify(q), Date.now() - t0 + 'ms', r.map((x) => `${x.nombre} [${x.categoria}] x${x.cantidad}${x.publicado ? '' : ' (sin publicar)'}`));
    assert.ok(r.length > 0);
    assert.equal(new Set(r.map((x) => x.clave)).size, r.length, 'sin repetidos');
  }
});
