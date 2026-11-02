// Pruebas del color de fondo a gusto (js/color.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/color');

test('hex <-> hsl se mantiene (ida y vuelta)', () => {
  for (const hex of ['#c8f0d6', '#d3e8f8', '#f8dce5', '#e2e6e3', '#fbe3d2']) {
    const { h, s, l } = C.hexAHsl(hex);
    const vuelta = C.hexAHsl(C.hslAHex(h, s, l));
    assert.ok(Math.abs(vuelta.h - h) < 1.5 && Math.abs(vuelta.s - s) < 2 && Math.abs(vuelta.l - l) < 1, hex);
  }
  assert.equal(C.hslAHex(0, 0, 100), '#ffffff');
  assert.equal(C.hslAHex(0, 0, 0), '#000000');
});

test('el verde de siempre es el que se acepta como "sin cambios"', () => {
  assert.equal(C.DEFECTO, '#C8F0D6');
  assert.ok(C.esDefecto('#c8f0d6') && C.esDefecto(null) && !C.esDefecto('#d3e8f8'));
  // el fondo calculado a partir del verde de siempre es el mismo verde (con una tolerancia de redondeo)
  const f = C.paleta(C.DEFECTO).claro['--fondo'], a = C.hexAHsl(f), b = C.hexAHsl(C.DEFECTO);
  assert.ok(Math.abs(a.h - b.h) < 2 && Math.abs(a.l - b.l) < 1.5);
});

test('un color muy oscuro o muy claro se lleva a un pastel que se lee', () => {
  assert.ok(C.pastel('#102030').l >= 78);   // casi negro
  assert.ok(C.pastel('#ffffff').l <= 93);   // blanco
  assert.equal(Math.round(C.pastel('#ff0000').h), 0); // el matiz se respeta
  for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#808080']) {
    const p = C.paleta(hex);
    // en claro, el texto es mucho más oscuro que el fondo; en oscuro, mucho más claro
    assert.ok(C.hexAHsl(p.claro['--fondo']).l - C.hexAHsl(p.claro['--negro']).l > 60, hex);
    assert.ok(C.hexAHsl(p.oscuro['--negro']).l - C.hexAHsl(p.oscuro['--fondo']).l > 60, hex);
    // el encabezado de tabla y el hover quedan más claros que el fondo
    assert.ok(C.hexAHsl(p.claro['--encabezado']).l >= C.hexAHsl(p.claro['--fondo']).l, hex);
  }
});

test('la hoja de estilos pisa el modo claro y los dos modos oscuros', () => {
  const css = C.css('#d3e8f8');
  assert.match(css, /^:root\{--fondo:#/);
  assert.match(css, /:root\[data-tema="oscuro"\]\{/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-tema="claro"\]\)\{/);
  // los dos bloques oscuros tienen los mismos valores
  const oscuros = [...css.matchAll(/\{((?:--[a-z-]+:#[0-9a-f]{6};)+)\}/g)].map(m => m[1]);
  assert.equal(oscuros.length, 3);
  assert.equal(oscuros[1], oscuros[2]);
  assert.notEqual(oscuros[0], oscuros[1]);
});

test('solo acepta colores #rrggbb', () => {
  assert.ok(C.RE_HEX.test('#C8F0D6') && !C.RE_HEX.test('C8F0D6') && !C.RE_HEX.test('#fff') && !C.RE_HEX.test('red'));
});
