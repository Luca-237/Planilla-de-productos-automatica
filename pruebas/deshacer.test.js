// Pruebas de la pila de deshacer (js/deshacer.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { crear, MAXIMO } = require('../js/deshacer');

const nuevo = () => { const avisos = []; const d = crear((m, t) => avisos.push([t, m])); return { d, avisos }; };

test('se deshace lo último primero y se avisa', async () => {
  const { d, avisos } = nuevo();
  const hecho = [];
  d.registrar({ texto: 'A', deshacer: async () => { hecho.push('A'); } });
  d.registrar({ texto: 'B', deshacer: async () => { hecho.push('B'); } });
  assert.equal(d.cantidad(), 2);
  assert.equal(d.ultimo().texto, 'B');
  assert.equal(await d.deshacerUltimo(), true);
  assert.equal(await d.deshacerUltimo(), true);
  assert.deepEqual(hecho, ['B', 'A']);
  assert.equal(d.hay(), false);
  assert.deepEqual(avisos, [['ok', 'Deshecho: B'], ['ok', 'Deshecho: A']]);
});

test('sin nada que deshacer avisa y no falla', async () => {
  const { d, avisos } = nuevo();
  assert.equal(await d.deshacerUltimo(), false);
  assert.deepEqual(avisos, [['ok', 'No hay nada para deshacer.']]);
});

test('una acción puntual se deshace aunque no sea la última', async () => {
  const { d } = nuevo();
  const hecho = [];
  const a = d.registrar({ texto: 'A', deshacer: () => { hecho.push('A'); } });
  d.registrar({ texto: 'B', deshacer: () => { hecho.push('B'); } });
  assert.equal(await d.ejecutar(a), true);
  assert.deepEqual(hecho, ['A']);
  assert.equal(d.ultimo().texto, 'B');
  assert.equal(await d.ejecutar(a), false, 'ya no está');
});

test('si no se puede deshacer, queda anotada en su lugar y se avisa el motivo', async () => {
  const { d, avisos } = nuevo();
  let falla = true;
  d.registrar({ texto: 'A', deshacer: () => { /* bien */ } });
  const b = d.registrar({ texto: 'B', deshacer: () => { if (falla) throw new Error('pasaron más de 2 horas'); } });
  assert.equal(await d.ejecutar(b), false);
  assert.deepEqual(avisos.at(-1), ['error', 'No se pudo deshacer: pasaron más de 2 horas']);
  assert.equal(d.cantidad(), 2);
  assert.equal(d.ultimo().texto, 'B');
  falla = false;
  assert.equal(await d.deshacerUltimo(), true);
});

test('guarda solo las últimas, y los oyentes se enteran de cada cambio', () => {
  const { d } = nuevo();
  let cambios = 0;
  d.alCambiar(() => { cambios++; });
  for (let i = 0; i < MAXIMO + 5; i++) d.registrar({ texto: 'n' + i, deshacer: () => {} });
  assert.equal(d.cantidad(), MAXIMO);
  assert.equal(d.ultimo().texto, 'n' + (MAXIMO + 4));
  d.vaciar();
  assert.equal(d.hay(), false);
  assert.equal(cambios, MAXIMO + 5 + 1);
});
