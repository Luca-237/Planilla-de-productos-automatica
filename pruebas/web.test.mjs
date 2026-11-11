// Pruebas de la lectura de la búsqueda de la tienda (función buscar-en-web).
// Node 24 lee el .ts directo (le saca los tipos). Sin internet: HTML armado
// con la misma forma que la búsqueda real de cindymayorista.com.ar.
// Con PROBAR_TIENDA=1 además consulta la tienda real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerResultados, clasificar, decodificar, revisarCodigo, urlsDeImagen, leerPrecio, leerDescripcion, tieneFotoReal, limpiarDescripcion, clasificarTN, precioTN, revisarCodigoTN } from '../supabase/functions/buscar-en-web/index.ts';

const tarjeta = (codigo, nombre, url, img = '') => `<div class="col-xs-24 product-listing-item"><input type="hidden" value="1" name="products_id">
  <div class="product-box" itemscope itemtype="http://schema.org/Product"><meta itemprop="name" content="${nombre}" />
  ${img ? `<img loading = "lazy" src="${img}" alt="${nombre}" class="img-contained first-img" itemprop="image">` : ''}<div itemprop="offers"><link itemprop="url" href="${url}" /></div>
  <a href="${url}">${nombre}</a> <span class="product-model">C&oacute;digo ${codigo}</span> <span>$&nbsp;32.999</span>
  <script>enhancedClick({"id":"1"})</script></div></div>`;
const pagina = (...t) => `<h1 class="page-title-home"><span>Resultado B&uacute;squeda</span></h1><div class="row product-listing">${t.join('')}</div>`;

test('lee código, nombre y link de cada resultado', () => {
  const r = leerResultados(pagina(tarjeta('148216', 'CARTERA SOHO SKORA', 'https://t/cartera'), tarjeta('8216', 'ALMOHADA CERVICAL TRAVEL BLUE', 'https://t/almohada')));
  assert.deepEqual(r, [
    { codigo: '148216', nombre: 'CARTERA SOHO SKORA', url: 'https://t/cartera', imagen: '', precio: 32999 },
    { codigo: '8216', nombre: 'ALMOHADA CERVICAL TRAVEL BLUE', url: 'https://t/almohada', imagen: '', precio: 32999 },
  ]);
});

test('publicado solo con el código idéntico: buscar 8216 trae también 148216', () => {
  const r = leerResultados(pagina(tarjeta('148216', 'CARTERA', 'https://t/a'), tarjeta('8216', 'ALMOHADA', 'https://t/b')));
  assert.deepEqual(clasificar('8216', r), { codigo: '8216', estado: 'publicado', url: 'https://t/b', nombre: 'ALMOHADA', imagen: '', precio: 32999 });
  assert.equal(clasificar('821', r).estado, 'no_esta');
});

test('solo variantes: está 3M201-GRE pero no 3M201', () => {
  const r = leerResultados(pagina(tarjeta('3M201-GRE', 'MOCHILA GRIS', 'https://t/g'), tarjeta('3M201-PAL', 'MOCHILA', 'https://t/p')));
  assert.deepEqual(clasificar('3M201', r), { codigo: '3M201', estado: 'solo_variantes', url: 'https://t/g', nombre: 'MOCHILA GRIS', imagen: '', precio: 32999 });
  // la variante en sí, sí está publicada
  assert.equal(clasificar('3M201-PAL', r).estado, 'publicado');
  // mayúsculas/minúsculas no importan
  assert.equal(clasificar('3m201-pal', r).estado, 'publicado');
});

test('sin resultados → no está', () => {
  assert.deepEqual(clasificar('NOEXISTE999', leerResultados(pagina())), { codigo: 'NOEXISTE999', estado: 'no_esta', url: '', nombre: '', imagen: '', precio: null });
});

test('lee la foto del producto y arma las direcciones a probar (original y miniatura grande)', () => {
  const img = 'mods/html/fil/Model/Product/64279/thumb_03_855338-1-1.jpg.webp';
  const r = leerResultados(pagina(tarjeta('855338', 'BROCHE TRENDY', 'https://t/b', img)));
  assert.equal(r[0].imagen, img);
  assert.equal(clasificar('855338', r).imagen, img);
  assert.deepEqual(urlsDeImagen(img, 'https://www.cindymayorista.com.ar'), [
    'https://www.cindymayorista.com.ar/mods/html/fil/Model/Product/64279/855338-1-1.jpg',
    'https://www.cindymayorista.com.ar/mods/html/fil/Model/Product/64279/thumb_01_855338-1-1.jpg.webp']);
  assert.deepEqual(urlsDeImagen('', 'https://x'), []);
});

test('lee el precio de la tarjeta (puntos de miles, coma decimal)', () => {
  assert.equal(leerPrecio('BROCHE TRENDY Código 855338 $ 1.200 Max Vta: 100000'), 1200);
  assert.equal(leerPrecio('BOLSO Código 4266009 $ 16.999 Max Vta'), 16999);
  assert.equal(leerPrecio('X Código A1 $ 1.234,50 Max'), 1234.5);
  assert.equal(leerPrecio('X Código A1 Consultar precio'), null);
  assert.equal(leerPrecio('X Código A1 $ 0 Max'), null);
  // el precio es el de después del código, no uno cualquiera de antes
  assert.equal(leerPrecio('Oferta $ 5 BROCHE Código 855338 $ 1.200'), 1200);
  const r = leerResultados(pagina(tarjeta('855338', 'BROCHE', 'https://t/b')));
  assert.equal(r[0].precio, 32999);
});

test('decodifica las entidades de la tienda', () => {
  assert.equal(decodificar('C&oacute;digo &amp; Ni&ntilde;os &#176;'), 'Código & Niños °');
});

const ficha = (interior) => `<div class="descriptionProd"><div class="tituloDetalleDescrip">Descripci&oacute;n del producto</div>
  <div class="descripDetalle" style="overflow: unset"><div class="descripcionProducto" id="descProd" id="wc-power-page">
  ${interior}
  </div></div></div><script>var x = "<div>";</script>`;

test('descripción de la ficha: viñetas con <br> (como las que cargan ellos)', () => {
  assert.equal(leerDescripcion(ficha('<style type="text/css"><!--td {border: 1px solid #ccc;}-->\n</style>\n&bull; Marca y Modelo: Tascani, Neceser.<br />\n&bull; Medidas: 23 x 13 x 8,5 cm.   ')),
    '• Marca y Modelo: Tascani, Neceser.\n• Medidas: 23 x 13 x 8,5 cm.');
});

test('descripción de la ficha: título y valor en la línea siguiente van juntos; entidades decodificadas', () => {
  assert.equal(leerDescripcion(ficha('MEDIDAS:<br />\n34&nbsp;cm de alto x&nbsp;44&nbsp;cm de ancho x&nbsp;15&nbsp;cm de profundidad       ')),
    '• MEDIDAS: 34 cm de alto x 44 cm de ancho x 15 cm de profundidad');
});

test('descripción de la ficha: párrafos', () => {
  assert.equal(leerDescripcion(ficha('<p>Medidas: 22,5 &times; 31 &times; 9 cm.</p>\n\n<p>Materiales: Exterior: 100% PVC.</p>')),
    '• Medidas: 22,5 × 31 × 9 cm.\n• Materiales: Exterior: 100% PVC.');
});

test('descripción de la ficha: listas con comentarios y atributos raros', () => {
  assert.equal(leerDescripcion(ficha('&nbsp;Incluye un rollo de papel pre-impreso con ilustraciones de tem&aacute;tica "Roar".<!--TgQPHd||[]--><!--TgQPHd||[]-->\n<ul>\n\t<li data-copy-service-computed-style="font-family: " google="" sans="">El set viene acompa&ntilde;ado de 6 marcadores.<!--TgQPHd||[]--></li>\n</ul>\n<ul><li>El rollo mide 30 cm de ancho.</li></ul>')),
    '• Incluye un rollo de papel pre-impreso con ilustraciones de temática "Roar".\n• El set viene acompañado de 6 marcadores.\n• El rollo mide 30 cm de ancho.');
});

test('descripción de la ficha: tabla Etiqueta (negrita) / Valor', () => {
  const tabla = '<table><tbody><tr><td><strong>Color</strong></td></tr><tr><td>Gris/Azul</td></tr><tr><td><STRONG>Capacidad (Litros)</STRONG></td></tr><tr><td>35</td></tr></tbody></table>';
  assert.equal(leerDescripcion(ficha(tabla)), '• Color: Gris/Azul\n• Capacidad (Litros): 35');
});

test('descripción de la ficha: vacía o sin bloque → texto vacío', () => {
  assert.equal(leerDescripcion(ficha('   \n  ')), '');
  assert.equal(leerDescripcion('<html><body>sin descripción</body></html>'), '');
  assert.equal(leerDescripcion(ficha('<style>td{}</style>')), '');
});

test('descripción: no inventa viñetas dobles si ya vienen con "•" o "-"', () => {
  assert.equal(leerDescripcion(ficha('• Uno<br/>- Dos<br/>* Tres')), '• Uno\n• Dos\n• Tres');
});

test('foto real: solo cuenta la imagen subida de producto, no un relleno ni un vacío', () => {
  assert.equal(tieneFotoReal('mods/html/fil/Model/Product/64279/thumb_03_855338-1-1.jpg.webp'), true);
  assert.equal(tieneFotoReal('https://www.cindymayorista.com.ar/mods/html/fil/Model/Product/64279/855338-1-1.jpg'), true);
  assert.equal(tieneFotoReal(''), false);
  assert.equal(tieneFotoReal('images/sin-imagen.png'), false);
  assert.equal(tieneFotoReal('mods/html/fil/Model/Product/sin-foto.png'), false);
});

// ---------- Tiendanube (API de solo lectura) ----------
const prodTN = (extra = {}) => ({
  id: 1, name: { es: 'MOCHILA FLOW CHIMOLA' }, published: true, canonical_url: 'https://tienda.mitiendanube.com/productos/mochila-flow/',
  description: { es: '<ul>\n<li>Marca y Modelo: Chimola, Mochila Flow.</li>\n<li>Medidas: 41 x 32 x 13 cm.</li>\n</ul>' },
  variants: [{ sku: '3M201', price: '57959.00', promotional_price: null, image_id: null }, { sku: '3M201-CAM', price: '57959.00', promotional_price: null, image_id: 22 }],
  images: [{ id: 11, src: 'https://dcdn-us.mitiendanube.com/stores/008/128/903/products/uno-1024-1024.jpg', position: 1 }, { id: 22, src: 'https://dcdn-us.mitiendanube.com/stores/008/128/903/products/camel-1024-1024.jpg', position: 2 }],
  ...extra,
});

test('Tiendanube: SKU idéntico = publicado, con nombre, url, precio, foto y descripción', () => {
  const r = clasificarTN('3M201', [prodTN()]);
  assert.equal(r.estado, 'publicado');
  assert.equal(r.nombre, 'MOCHILA FLOW CHIMOLA');
  assert.equal(r.url, 'https://tienda.mitiendanube.com/productos/mochila-flow/');
  assert.equal(r.precio, 47900); // 57959 con IVA = 47900 + 21 %
  assert.equal(clasificarTN('3M201', [prodTN()], 1).precio, 57959); // TIENDANUBE_IVA=1: tal cual
  assert.match(r.imagen, /uno-1024/);
  assert.match(r.descripcionHtml, /<li>Marca y Modelo/);
});

test('Tiendanube: la variante pedida usa su propia foto; sin SKU idéntico pero con variantes = solo_variantes', () => {
  assert.match(clasificarTN('3M201-CAM', [prodTN()]).imagen, /camel-1024/);
  const soloVar = prodTN({ variants: [{ sku: '8216-ROJ', price: '100' }, { sku: '8216-AZU', price: '100' }] });
  assert.equal(clasificarTN('8216', [soloVar]).estado, 'solo_variantes');
});

test('Tiendanube: no confunde parecidos (q= trae 148216 al buscar 8216) ni cuenta productos ocultos', () => {
  const parecido = prodTN({ variants: [{ sku: '148216', price: '5' }] });
  assert.equal(clasificarTN('8216', [parecido]).estado, 'no_esta');
  assert.equal(clasificarTN('3M201', [prodTN({ published: false })]).estado, 'no_esta');
  assert.equal(clasificarTN('3m201', [prodTN()]).estado, 'publicado'); // mayúsculas no importan
  assert.equal(clasificarTN('X', []).estado, 'no_esta');
});

test('Tiendanube: precio promocional si hay; sin precio válido = null', () => {
  assert.equal(precioTN({ price: '1210', promotional_price: '968' }), 800);
  assert.equal(precioTN({ price: '1210', promotional_price: null }), 1000);
  assert.equal(precioTN({ price: '15728.79' }), 12999);
  assert.equal(precioTN({ price: '1000' }, 1), 1000);
  assert.equal(precioTN({ price: null }), null);
  assert.equal(precioTN({ price: '0' }), null);
  assert.equal(precioTN(undefined), null);
});

test('Tiendanube: la descripción HTML de la API queda como lista con "• "', () => {
  assert.equal(limpiarDescripcion('<ul>\n<li>Marca y Modelo: Chimola, Mochila Flow.</li>\n<li>Medidas: 41 x 32 x 13 cm.</li>\n</ul>'),
    '• Marca y Modelo: Chimola, Mochila Flow.\n• Medidas: 41 x 32 x 13 cm.');
  assert.equal(limpiarDescripcion('<p>Medidas: 22,5 &times; 31 &times; 9 cm.</p><p>Materiales: Exterior: 100% PVC.</p>'), '• Medidas: 22,5 × 31 × 9 cm.\n• Materiales: Exterior: 100% PVC.');
  assert.equal(limpiarDescripcion(''), '');
  assert.equal(limpiarDescripcion('<p> </p>'), '');
});

test('Tiendanube: la foto de la CDN cuenta como foto real y se baja tal cual', () => {
  const f = 'https://dcdn-us.mitiendanube.com/stores/008/128/903/products/35415-bb2d-1024-1024.jpg';
  assert.equal(tieneFotoReal(f), true);
  assert.equal(tieneFotoReal('https://otro-sitio.com/stores/1/products/a.jpg'), false);
  assert.deepEqual(urlsDeImagen(f, 'https://www.cindymayorista.com.ar'), [f]);
});

const respuestaFalsa = (status, cuerpo, cab = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: k => cab[k.toLowerCase()] ?? null }, json: async () => cuerpo });

test('Tiendanube: pide por q=, con la clave en el encabezado y solo los campos necesarios', async () => {
  let visto;
  const r = await revisarCodigoTN('3M201', { token: 'T0K3N', tiendaId: '123' }, async (url, init) => { visto = { url, init }; return respuestaFalsa(200, [prodTN()]); });
  assert.equal(r.estado, 'publicado');
  assert.match(visto.url, /^https:\/\/api\.tiendanube\.com\/v1\/123\/products\?q=3M201&per_page=30&fields=/);
  assert.equal(visto.init.headers.Authentication, 'bearer T0K3N');
  assert.equal(visto.init.method, undefined); // solo lectura: GET
});

test('Tiendanube: ante el límite de pedidos (429) espera y reintenta; con 401 explica el problema', async () => {
  let n = 0;
  const r = await revisarCodigoTN('3M201', { token: 'x', tiendaId: '1' }, async () => (++n === 1 ? respuestaFalsa(429, null, { 'x-rate-limit-reset': '5' }) : respuestaFalsa(200, [prodTN()])));
  assert.equal(n, 2);
  assert.equal(r.estado, 'publicado');
  await assert.rejects(revisarCodigoTN('A', { token: 'x', tiendaId: '1' }, async () => respuestaFalsa(401, {})), /rechazó la clave/);
  await assert.rejects(revisarCodigoTN('A', { token: 'x', tiendaId: '1' }, async () => respuestaFalsa(500, {})), /respondió 500/);
  await assert.rejects(revisarCodigoTN('A', { token: 'x', tiendaId: '1' }, async () => respuestaFalsa(200, { error: 1 })), /inesperado/);
});

test('Tiendanube real (solo con PROBAR_TN=1 y el archivo de la clave)', { skip: !process.env.PROBAR_TN && 'sin PROBAR_TN' }, async () => {
  const fs = await import('node:fs');
  const env = Object.fromEntries(fs.readFileSync(process.env.PROBAR_TN, 'utf8').split(/\r?\n/).filter(Boolean).map(l => l.split(/=(.*)/s).slice(0, 2)));
  const cfg = { token: env.TIENDANUBE_TOKEN, tiendaId: env.TIENDANUBE_STORE_ID };
  const res = await Promise.all(['167.5080.1', '3M267', '6203703', '3M201', 'NOEXISTE999'].map(c => revisarCodigoTN(c, cfg)));
  console.log(res.map(r => ({ c: r.codigo, e: r.estado, precio: r.precio, foto: tieneFotoReal(r.imagen), desc: limpiarDescripcion(r.descripcionHtml).slice(0, 60) })));
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
