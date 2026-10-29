// Pruebas de la caché del navegador (js/cache.js). Corren sin navegador: no hay IndexedDB ni
// localStorage, así que prueban la lógica sobre la memoria (el guardado persistente falla en
// silencio y sigue, que es justo lo que pasa en una ventana privada).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

globalThis.window = { COMPRAS: {}, COMPRAS_CONFIG: { cache: { frescoSegundos: 60, maxHoras: 168 } } };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'cache.js'), 'utf8'), { filename: 'cache.js' });
const C = globalThis.window.COMPRAS.cache;

const ahoraReal = Date.now;
let ahora;
beforeEach(async () => { await C.limpiarTodo(); ahora = ahoraReal(); Date.now = () => ahora; });
const pasar = segundos => { ahora += segundos * 1000; };
const esperar = () => new Promise(ok => setTimeout(ok, 5));
// una "base" que cuenta cuántas veces se la consulta
const base = valor => { const b = { n: 0, valor, cargar: async () => { b.n++; return JSON.parse(JSON.stringify(b.valor)); } }; return b; };

test('dentro del tiempo fresco no se consulta de nuevo', async () => {
  const b = base([{ id: 1 }]);
  assert.deepEqual(await C.conCache('u1', 'planilla', b.cargar), [{ id: 1 }]);
  pasar(30);
  assert.deepEqual(await C.conCache('u1', 'planilla', b.cargar), [{ id: 1 }]);
  assert.equal(b.n, 1);
});

test('vencido y sin alActualizar: vuelve a consultar y trae lo nuevo', async () => {
  const b = base([{ id: 1 }]);
  await C.conCache('u1', 'ordenes', b.cargar);
  pasar(61); b.valor = [{ id: 1 }, { id: 2 }];
  assert.equal((await C.conCache('u1', 'ordenes', b.cargar)).length, 2);
  assert.equal(b.n, 2);
});

test('vencido con alActualizar: devuelve lo guardado enseguida y avisa cuando llega lo nuevo', async () => {
  const b = base([{ id: 1 }]);
  await C.conCache('u1', 'planilla', b.cargar);
  pasar(120); b.valor = [{ id: 1 }, { id: 2 }];
  let aviso = null;
  const r = await C.conCache('u1', 'planilla', b.cargar, { alActualizar: d => { aviso = d; } });
  assert.deepEqual(r, [{ id: 1 }], 'primero lo viejo');
  await esperar();
  assert.deepEqual(aviso, [{ id: 1 }, { id: 2 }], 'después lo nuevo');
  // y lo nuevo quedó guardado: ahora está fresco
  assert.equal((await C.conCache('u1', 'planilla', b.cargar)).length, 2);
  assert.equal(b.n, 2);
});

test('si lo nuevo es igual a lo guardado, no se avisa (no se redibuja la pantalla)', async () => {
  const b = base([{ id: 1 }]);
  await C.conCache('u1', 'planilla', b.cargar);
  pasar(120);
  let avisos = 0;
  await C.conCache('u1', 'planilla', b.cargar, { alActualizar: () => { avisos++; } });
  await esperar();
  assert.equal(avisos, 0);
});

test('más viejo que maxHoras no se muestra: se consulta y se espera', async () => {
  const b = base([{ id: 1 }]);
  await C.conCache('u1', 'planilla', b.cargar);
  pasar(8 * 24 * 3600); b.valor = [{ id: 9 }];
  assert.deepEqual(await C.conCache('u1', 'planilla', b.cargar, { alActualizar: () => {} }), [{ id: 9 }]);
});

test('siempreFresco (preferencias): no vence y al guardar se actualiza sin consultar', async () => {
  const b = base(['foto']);
  await C.conCache('u1', 'preferencias', b.cargar, { siempreFresco: true });
  pasar(10 * 24 * 3600);
  await C.conCache('u1', 'preferencias', b.cargar, { siempreFresco: true });
  assert.equal(b.n, 1);
  C.poner('u1', 'preferencias', ['catalogo']);
  assert.deepEqual(await C.conCache('u1', 'preferencias', b.cargar, { siempreFresco: true }), ['catalogo']);
  assert.equal(b.n, 1);
});

test('cada usuario tiene su caché', async () => {
  const b1 = base(['de u1']), b2 = base(['de u2']);
  await C.conCache('u1', 'planilla', b1.cargar);
  assert.deepEqual(await C.conCache('u2', 'planilla', b2.cargar), ['de u2']);
  assert.deepEqual(await C.conCache('u1', 'planilla', b1.cargar), ['de u1']);
});

test('dos pantallas que piden lo mismo a la vez consultan una sola vez', async () => {
  const b = base([{ id: 1 }]);
  await Promise.all([C.conCache('u1', 'pendientes', b.cargar), C.conCache('u1', 'pendientes', b.cargar)]);
  assert.equal(b.n, 1);
});

test('invalidar: después de un cambio se vuelve a consultar (todo, o solo las claves dadas)', async () => {
  const a = base(['a']), c = base(['c']);
  await C.conCache('u1', 'planilla', a.cargar); await C.conCache('u1', 'colores', c.cargar);
  C.invalidar('u1', ['planilla']);
  await C.conCache('u1', 'planilla', a.cargar); await C.conCache('u1', 'colores', c.cargar);
  assert.deepEqual([a.n, c.n], [2, 1]);
  C.invalidar('u1');
  await C.conCache('u1', 'planilla', a.cargar); await C.conCache('u1', 'colores', c.cargar);
  assert.deepEqual([a.n, c.n], [3, 2]);
});

test('una lectura iniciada antes de un cambio no pisa lo cacheado con datos viejos', async () => {
  let suelta; const lenta = () => new Promise(ok => { suelta = ok; });
  const p = C.conCache('u1', 'planilla', lenta);
  await esperar();
  C.invalidar('u1', ['planilla']); // alguien guardó un cambio mientras se leía
  suelta(['viejo']);
  assert.deepEqual(await p, ['viejo']); // a quien pidió se le devuelve
  const b = base(['nuevo']);
  assert.deepEqual(await C.conCache('u1', 'planilla', b.cargar), ['nuevo'], 'pero no quedó guardado');
});

test('parchar: se cambia una fila guardada sin volver a pedir todo', async () => {
  const b = base([{ codigo: 'A', foto: false }, { codigo: 'B', foto: false }]);
  await C.conCache('u1', 'planilla', b.cargar);
  await C.parchar('u1', 'planilla', filas => filas.forEach(f => { if (f.codigo === 'A') f.foto = true; }));
  const r = await C.conCache('u1', 'planilla', b.cargar);
  assert.deepEqual(r.map(f => f.foto), [true, false]);
  assert.equal(b.n, 1);
});

test('limpiarTodo (al salir): no queda nada de nadie', async () => {
  const b = base(['x']);
  await C.conCache('u1', 'planilla', b.cargar); await C.conCache('u2', 'planilla', b.cargar);
  await C.limpiarTodo();
  await C.conCache('u1', 'planilla', b.cargar);
  assert.equal(b.n, 3);
});

test('si falla la consulta con datos guardados y vencidos, la pantalla sigue con lo guardado', async () => {
  const b = base(['guardado']);
  await C.conCache('u1', 'planilla', b.cargar);
  pasar(120);
  const r = await C.conCache('u1', 'planilla', async () => { throw new Error('sin conexión'); }, { alActualizar: () => {} });
  assert.deepEqual(r, ['guardado']);
  await esperar(); // el error de atrás no tira nada
});
