// Pruebas de la base: corre la migración en un Postgres en memoria (PGlite)
// con un esquema "auth" mínimo que imita a Supabase, y prueba el cruce
// OC ↔ remito y los permisos de cada rol.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const { leerDocumento } = require('../js/lector-manager.js');

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MUESTRAS = path.join(RAIZ, 'datos-privados', 'muestras');
const hayMuestras = fs.existsSync(path.join(MUESTRAS, 'oc-2151.xls'));
// Todas las migraciones, en orden de fecha (como se corren en Supabase)
const MIGRACIONES = path.join(RAIZ, 'supabase', 'migrations');
const migraciones = () => fs.readdirSync(MIGRACIONES).filter(n => n.endsWith('.sql')).sort()
  .map(n => fs.readFileSync(path.join(MIGRACIONES, n), 'utf8'));
const leerMuestra = nombre => leerDocumento(XLSX, XLSX.readFile(path.join(MUESTRAS, nombre)));

const U = {
  admin: '00000000-0000-0000-0000-00000000000a',
  carga: '00000000-0000-0000-0000-00000000000c',
  consulta: '00000000-0000-0000-0000-00000000000d',
  inactivo: '00000000-0000-0000-0000-00000000000e',
};
let db;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
  `);
  for (const sql of migraciones()) await db.exec(sql);
  // Sin grants extra: el proyecto se crea con "Automatically expose new tables" apagado,
  // así que la migración tiene que dar sola todos los permisos que usa la página.
  for (const [nombre, id] of Object.entries(U)) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${nombre}@prueba`]);
  }
  await db.exec(`
    update public.perfiles set rol = 'admin', activo = true where id = '${U.admin}';
    update public.perfiles set rol = 'carga', activo = true where id = '${U.carga}';
    update public.perfiles set rol = 'consulta', activo = true where id = '${U.consulta}';
  `);
});

// Corre una consulta como un usuario (o sin sesión, con usuario = null).
// Si falla, la transacción se deshace, igual que un pedido a Supabase.
async function como(usuario, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec(usuario ? `set local role authenticated; set local request.jwt.claim.sub = '${usuario}';` : 'set local role anon;');
    return (await tx.query(sql, params)).rows;
  });
}
const cargarOC = (doc, confirmar = true, usuario = U.carga) =>
  como(usuario, 'select public.cargar_orden_compra($1, $2) as r', [doc, confirmar]).then(f => f[0].r);
const cargarRemito = (doc, confirmar = true, usuario = U.carga) =>
  como(usuario, 'select public.cargar_remito($1, $2) as r', [doc, confirmar]).then(f => f[0].r);

// Documentos armados con la misma forma que devuelve el lector
const CUIT = '30999999991';
const oc = (numero, fecha, lineas) => ({
  tipo: 'orden_compra', numero, fecha, cuit: CUIT, proveedor: 'PROVEEDOR PRUEBA', comprador: 'Pablo',
  totales: { 'SubTotal 1': 0, 'Desc/Rec': 0, Impuesto: 0, Total: 0 }, descuento_porcentaje: 0,
  lineas: lineas.map(([codigo, cantidad, fechaPlan]) => ({ codigo, descripcion: 'ART ' + codigo, cantidad, precio_unitario: 100, total: 100 * cantidad,
    plan_entrega: fechaPlan ? [{ fecha: fechaPlan, cantidad }] : [] })),
});
const remito = (numero, fecha, lineas) => ({
  tipo: 'remito_ingreso', numero, fecha, cuit: CUIT, proveedor: 'PROVEEDOR PRUEBA', total: 0,
  lineas: lineas.map(([codigo, cantidad]) => ({ codigo, descripcion: 'ART ' + codigo, cantidad, costo: 100, importe: 100 * cantidad })),
});
const estadoLineas = orden => como(U.consulta,
  'select codigo, cantidad::float8 as cantidad, recibido::float8 as recibido, pendiente::float8 as pendiente, estado from public.v_oc_lineas where orden = $1 order by renglon', [orden]);

test('OC real 2151: la simulación no guarda nada', { skip: !hayMuestras && 'faltan las muestras' }, async () => {
  const r = await cargarOC(leerMuestra('oc-2151.xls'), false);
  assert.equal(r.confirmado, false);
  assert.equal(r.lineas, 12);
  assert.equal(r.articulos_nuevos, 12);
  assert.equal((await como(U.admin, 'select count(*)::int as n from public.ordenes_compra'))[0].n, 0);
  assert.equal((await como(U.admin, 'select count(*)::int as n from public.articulos'))[0].n, 0);
});

test('OC real 2151 + su remito: llega todo y la OC queda completa', { skip: !hayMuestras && 'faltan las muestras' }, async () => {
  const r = await cargarOC(leerMuestra('oc-2151.xls'));
  assert.equal(r.confirmado, true);
  const antes = await estadoLineas('3333-00002151');
  assert.equal(antes.length, 12);
  assert.ok(antes.every(l => l.estado === 'pendiente' && l.recibido === 0));

  await assert.rejects(cargarOC(leerMuestra('oc-2151.xls')), /ya está cargada/);

  const sim = await cargarRemito(leerMuestra('remito-0003-00171575.xls'), false);
  assert.equal(sim.confirmado, false);
  assert.deepEqual(sim.ordenes, [{ orden: '3333-00002151', pendiente: 0 }]);
  assert.ok((await estadoLineas('3333-00002151')).every(l => l.estado === 'pendiente'), 'la simulación no tiene que asignar nada');

  const rem = await cargarRemito(leerMuestra('remito-0003-00171575.xls'));
  assert.equal(rem.lineas.length, 12);
  assert.deepEqual(rem.sin_orden, []);
  assert.ok((await estadoLineas('3333-00002151')).every(l => l.estado === 'completa' && l.pendiente === 0));
  assert.equal((await como(U.consulta, "select count(*)::int as n from public.v_pendientes where orden = '3333-00002151'"))[0].n, 0);

  await assert.rejects(cargarRemito(leerMuestra('remito-0003-00171575.xls')), /ya está cargado/);
});

test('las 5 OC reales restantes se cargan y quedan pendientes', { skip: !hayMuestras && 'faltan las muestras' }, async () => {
  for (const n of ['2129', '2133', '2140', '2142', '2145']) await cargarOC(leerMuestra(`oc-${n}.xls`));
  const f = await como(U.consulta, `select count(*)::int as lineas, count(distinct orden)::int as ordenes, sum(pendiente)::float8 as unidades
                                    from public.v_pendientes where orden <> '3333-00002151'`);
  assert.deepEqual(f[0], { lineas: 41, ordenes: 5, unidades: 2197 });
  // Lesedife tiene dos OC (2140 y 2145): el proveedor se crea una sola vez, por CUIT
  assert.equal((await como(U.consulta, "select count(*)::int as n from public.proveedores where cuit = '30661041486'"))[0].n, 1);
});

test('entregas parciales: se reparte de la OC más vieja a la más nueva y lo que sobra queda sin orden', async () => {
  await cargarOC(oc('0001-00000001', '2026-10-10', [['X1', 10], ['Y1', 5]]));
  await cargarOC(oc('0001-00000002', '2026-10-20', [['X1', 10]]));

  const r1 = await cargarRemito(remito('0009-00000001', '2026-10-25', [['X1', 15]]));
  assert.deepEqual(r1.lineas[0].asignado, [{ orden: '0001-00000001', cantidad: 10 }, { orden: '0001-00000002', cantidad: 5 }]);
  assert.equal(r1.lineas[0].sin_orden, 0);
  assert.deepEqual(await estadoLineas('0001-00000001'), [
    { codigo: 'X1', cantidad: 10, recibido: 10, pendiente: 0, estado: 'completa' },
    { codigo: 'Y1', cantidad: 5, recibido: 0, pendiente: 5, estado: 'pendiente' },
  ]);
  assert.deepEqual(await estadoLineas('0001-00000002'), [{ codigo: 'X1', cantidad: 10, recibido: 5, pendiente: 5, estado: 'parcial' }]);

  // Llegan 8 X1 (quedaban 5) y un código que nadie pidió
  const r2 = await cargarRemito(remito('0009-00000002', '2026-10-28', [['X1', 8], ['Z9', 2]]));
  assert.deepEqual(r2.sin_orden.map(x => [x.codigo, x.sin_orden]), [['X1', 3], ['Z9', 2]]);
  const sobrantes = await como(U.consulta, "select codigo, sin_orden::float8 as n from public.v_sobrantes where remito = '0009-00000002' order by codigo");
  assert.deepEqual(sobrantes, [{ codigo: 'X1', n: 3 }, { codigo: 'Z9', n: 2 }]);
});

test('días sin llegar y atraso contra el plan de entrega', async () => {
  await cargarOC(oc('0001-00000003', '2026-09-01', [['D1', 4, '2026-09-15']]));
  const [f] = await como(U.consulta, `select dias_desde_orden, dias_atraso, public.hoy() - date '2026-09-01' as esperado_orden,
                                             public.hoy() - date '2026-09-15' as esperado_atraso
                                      from public.v_pendientes where orden = '0001-00000003'`);
  assert.equal(f.dias_desde_orden, f.esperado_orden);
  assert.equal(f.dias_atraso, f.esperado_atraso);
});

test('OC cerrada y unidades canceladas no reciben mercadería', async () => {
  await cargarOC(oc('0001-00000004', '2026-10-01', [['C1', 6]]));
  await cargarOC(oc('0001-00000005', '2026-10-02', [['C1', 6], ['C2', 10]]));
  await como(U.carga, "update public.ordenes_compra set cerrada = true, motivo_cierre = 'sin stock' where numero = '0001-00000004'");
  await como(U.carga, "update public.oc_lineas set cancelada = 4 where codigo = 'C2'");
  assert.equal((await estadoLineas('0001-00000004'))[0].estado, 'cerrada');

  const r = await cargarRemito(remito('0009-00000003', '2026-10-28', [['C1', 6], ['C2', 10]]));
  assert.deepEqual(r.lineas.map(l => [l.codigo, l.asignado, l.sin_orden]), [
    ['C1', [{ orden: '0001-00000005', cantidad: 6 }], 0],
    ['C2', [{ orden: '0001-00000005', cantidad: 6 }], 4],
  ]);
  assert.equal((await como(U.consulta, "select count(*)::int as n from public.v_pendientes where orden in ('0001-00000004', '0001-00000005')"))[0].n, 0);
});

test('la base no deja recibir más de lo pendiente aunque se inserte a mano', async () => {
  await cargarOC(oc('0001-00000006', '2026-10-05', [['M1', 2]]));
  await cargarRemito(remito('0009-00000004', '2026-10-06', [['OTRO', 5]]));
  await assert.rejects(como(U.carga, `insert into public.recepciones (remito_linea_id, oc_linea_id, cantidad)
    select rl.id, l.id, 3 from public.remito_lineas rl, public.oc_lineas l
    where rl.codigo = 'OTRO' and l.codigo = 'M1'`), /solo quedan 2 pendientes/);
});

test('permisos: consulta mira, no carga; inactivo y sin sesión no ven nada', async () => {
  assert.ok((await como(U.consulta, 'select count(*)::int as n from public.ordenes_compra'))[0].n > 0);
  await assert.rejects(cargarOC(oc('0001-00000007', '2026-10-05', [['P1', 1]]), true, U.consulta), /No tenés permiso/);
  await assert.rejects(como(U.consulta, "insert into public.proveedores (cuit, nombre) values ('30111111112', 'X')"), /row-level security/);
  // La RLS no da error en un update sin permiso: simplemente no toca ninguna fila
  assert.equal((await como(U.consulta, "update public.articulos set descripcion_web = 'x' returning codigo")).length, 0);
  assert.equal((await como(U.inactivo, 'select count(*)::int as n from public.ordenes_compra'))[0].n, 0);
  assert.equal((await como(U.inactivo, 'select count(*)::int as n from public.v_planilla'))[0].n, 0);
  await assert.rejects(como(null, 'select * from public.ordenes_compra'), /permission denied/);
  await assert.rejects(como(null, `select public.cargar_remito('{}'::jsonb, false)`), /permission denied/);
});

test('permisos: carga edita los datos web del artículo; solo admin borra documentos', async () => {
  const f = await como(U.carga, "update public.articulos set descripcion_web = 'Texto web' where codigo = 'X1' returning descripcion_web, actualizado_por");
  assert.deepEqual(f, [{ descripcion_web: 'Texto web', actualizado_por: U.carga }]);
  // quien cargó un documento lo puede borrar durante 2 horas (deshacer); pasado ese tiempo, solo un admin
  await db.query("update public.remitos set creado_en = now() - interval '3 hours' where numero = '0009-00000004'");
  assert.equal((await como(U.carga, "delete from public.remitos where numero = '0009-00000004' returning id")).length, 0);
  assert.equal((await como(U.admin, "delete from public.remitos where numero = '0009-00000004' returning id")).length, 1);
});

test('borrar documentos (admin): un remito devuelve sus unidades a pendientes; una OC deja lo recibido como "sin orden"', async () => {
  await cargarOC(oc('0001-00000020', '2026-10-01', [['B1', 10]]));
  await cargarRemito(remito('0009-00000020', '2026-10-05', [['B1', 7]]));
  assert.equal((await estadoLineas('0001-00000020'))[0].pendiente, 3);
  // pasadas 2 horas, carga no puede borrar; admin sí
  await db.query("update public.remitos set creado_en = now() - interval '3 hours' where numero = '0009-00000020'");
  assert.equal((await como(U.carga, "delete from public.remitos where numero = '0009-00000020' returning id")).length, 0);
  assert.equal((await como(U.admin, "delete from public.remitos where numero = '0009-00000020' returning id")).length, 1);
  assert.deepEqual(await estadoLineas('0001-00000020'), [{ codigo: 'B1', cantidad: 10, recibido: 0, pendiente: 10, estado: 'pendiente' }]);
  // Al borrar la OC, lo que había llegado contra ella queda "sin orden"
  await cargarRemito(remito('0009-00000021', '2026-10-06', [['B1', 4]]));
  await db.query("update public.ordenes_compra set creado_en = now() - interval '3 hours' where numero = '0001-00000020'");
  assert.equal((await como(U.carga, "delete from public.ordenes_compra where numero = '0001-00000020' returning id")).length, 0);
  assert.equal((await como(U.admin, "delete from public.ordenes_compra where numero = '0001-00000020' returning id")).length, 1);
  assert.deepEqual(await como(U.consulta, "select codigo, sin_orden::float8 as n from public.v_sobrantes where remito = '0009-00000021'"), [{ codigo: 'B1', n: 4 }]);
  assert.equal((await como(U.admin, "select count(*)::int as n from public.oc_lineas where codigo = 'B1'"))[0].n, 0);
});

test('nombre corto del proveedor: se muestra en vez de la razón social; lo cambia carga, no consulta', async () => {
  await cargarOC({ ...oc('0001-00000030', '2026-10-01', [['N1', 5]]), cuit: '30777777771', proveedor: 'ZUKI S.R.L.' });
  await cargarRemito({ ...remito('0009-00000030', '2026-10-02', [['N9', 1]]), cuit: '30777777771', proveedor: 'ZUKI S.R.L.' });
  const ver = async () => (await como(U.consulta, "select proveedor, razon_social from public.v_planilla where orden = '0001-00000030'"))[0];
  // Sin nombre corto: la razón social
  assert.deepEqual(await ver(), { proveedor: 'ZUKI S.R.L.', razon_social: 'ZUKI S.R.L.' });
  assert.equal((await como(U.consulta, "update public.proveedores set nombre_corto = 'X' where cuit = '30777777771' returning id")).length, 0);
  await como(U.carga, "update public.proveedores set nombre_corto = 'Bagcherry' where cuit = '30777777771'");
  assert.deepEqual(await ver(), { proveedor: 'Bagcherry', razon_social: 'ZUKI S.R.L.' });
  assert.deepEqual((await como(U.consulta, "select proveedor, razon_social from public.v_pendientes where orden = '0001-00000030'"))[0], { proveedor: 'Bagcherry', razon_social: 'ZUKI S.R.L.' });
  assert.deepEqual((await como(U.consulta, "select proveedor, razon_social from public.v_sobrantes where remito = '0009-00000030'"))[0], { proveedor: 'Bagcherry', razon_social: 'ZUKI S.R.L.' });
  // Un remito nuevo del mismo CUIT con otra razón social no pisa el nombre corto
  await cargarRemito({ ...remito('0009-00000031', '2026-10-03', [['N1', 5]]), cuit: '30777777771', proveedor: 'ZUKI SRL (otro texto)' });
  assert.equal((await ver()).proveedor, 'Bagcherry');
});

test('casillas en varios artículos juntos: carga las cambia y la base devuelve cuántas; consulta cambia 0', async () => {
  await cargarOC(oc('0001-00000040', '2026-10-01', [['T1', 1], ['T2', 1], ['T3', 1]]));
  const sql = "update public.articulos set foto = true where codigo in ('T1', 'T2', 'T3') returning codigo";
  assert.equal((await como(U.consulta, sql)).length, 0);
  assert.equal((await como(U.carga, sql)).length, 3);
  assert.deepEqual(await como(U.consulta, "select distinct foto from public.v_planilla where orden = '0001-00000040'"), [{ foto: true }]);
});

test('"Llegó": se marca solo al entrar mercadería, se puede tildar a mano y nunca se desmarca solo', async () => {
  await cargarOC(oc('0001-00000077', '2026-10-01', [['LL1', 5], ['LL2', 5]]));
  const llego = () => como(U.consulta, "select codigo, llego from public.v_planilla where orden = '0001-00000077' order by codigo");
  assert.deepEqual(await llego(), [{ codigo: 'LL1', llego: false }, { codigo: 'LL2', llego: false }]);

  await cargarRemito(remito('0009-00000077', '2026-10-05', [['LL1', 2]]));
  assert.deepEqual(await llego(), [{ codigo: 'LL1', llego: true }, { codigo: 'LL2', llego: false }]);

  // A mano: carga tilda y destilda; consulta no cambia nada
  assert.equal((await como(U.consulta, "update public.articulos set llego = true where codigo = 'LL2' returning codigo")).length, 0);
  assert.equal((await como(U.carga, "update public.articulos set llego = true where codigo = 'LL2' returning codigo")).length, 1);
  assert.equal((await como(U.carga, "update public.articulos set llego = false where codigo = 'LL2' returning codigo")).length, 1);

  // Que el artículo se publique, se marque "ya no está" o se revise en la web no toca "Llegó"
  await como(U.carga, "update public.articulos set cargado_web = true where codigo = 'LL1'");
  await como(U.carga, "update public.articulos set ya_no_esta = true where codigo = 'LL1'");
  assert.deepEqual(await llego(), [{ codigo: 'LL1', llego: true }, { codigo: 'LL2', llego: false }]);
});

test('variantes por color: se crean con el sufijo, salen debajo del padre y no se repiten', async () => {
  await cargarOC(oc('0001-00000050', '2026-10-01', [['V100', 10], ['V200', 4]]));
  const ids = cods => `array(select id from public.colores where codigo in (${cods.map(c => "'" + c + "'").join(",")}))`;
  const crear = (usuario, padre, cods) => como(usuario, `select public.crear_variantes('${padre}', ${ids(cods)}) as r`).then(f => f[0].r);
  // catálogo cargado y protegido
  assert.equal((await como(U.consulta, "select count(*)::int as n from public.colores"))[0].n, 8);
  await assert.rejects(como(U.consulta, "insert into public.colores (codigo, nombre) values ('AZU', 'Azul')"), /row-level security/);
  await assert.rejects(como(U.carga, "insert into public.colores (codigo, nombre) values ('x', 'malo')"), /check/);
  await como(U.carga, "insert into public.colores (codigo, nombre) values ('CEL', 'Celeste')");
  // crear
  await assert.rejects(crear(U.consulta, 'V100', ['WHI']), /No tenés permiso/);
  const r1 = await crear(U.carga, 'V100', ['WHI', 'GRE', 'CEL']);
  assert.deepEqual(r1, { creadas: ['V100-CEL', 'V100-GRE', 'V100-WHI'], existentes: [], omitidas: [] });
  const r2 = await crear(U.carga, 'V100', ['WHI', 'BLU']);
  assert.deepEqual([r2.creadas, r2.existentes], [['V100-BLU'], ['V100-WHI']]);
  await assert.rejects(crear(U.carga, 'V100-WHI', ['BLU']), /no puede tener variantes/);
  await assert.rejects(crear(U.carga, 'NOEXISTE', ['BLU']), /no existe/);
  // un código que ya existe como otro artículo no se pisa
  await como(U.carga, "insert into public.articulos (codigo, descripcion) values ('V200-NEG', 'otro')");
  assert.deepEqual((await crear(U.carga, 'V200', ['NEG'])).omitidas, ['V200-NEG']);
  // la planilla: padre, sus variantes, y después el otro artículo
  const filas = await como(U.consulta, "select codigo, es_variante, color, cantidad::float8 as cantidad, n_variantes, padre, descripcion_web from public.v_planilla where orden = '0001-00000050' order by padre, es_variante, codigo");
  assert.deepEqual(filas.map(f => f.codigo), ['V100', 'V100-BLU', 'V100-CEL', 'V100-GRE', 'V100-WHI', 'V200']);
  assert.deepEqual(filas[0], { codigo: 'V100', es_variante: false, color: null, cantidad: 10, n_variantes: 4, padre: 'V100', descripcion_web: '' });
  assert.deepEqual(filas[4], { codigo: 'V100-WHI', es_variante: true, color: 'Blanco', cantidad: null, n_variantes: 0, padre: 'V100', descripcion_web: '' });
  const padre = (await como(U.consulta, "select tipo, variantes from public.articulos where codigo = 'V100'"))[0];
  assert.deepEqual(padre, { tipo: 'PADRE', variantes: 'BLU, CEL, GRE, WHI' });
  assert.equal((await como(U.consulta, "select descripcion from public.articulos where codigo = 'V100-GRE'"))[0].descripcion, 'ART V100 VERDE');
  // cada variante tiene sus propias casillas
  await como(U.carga, "update public.articulos set foto = true where codigo = 'V100-WHI'");
  assert.deepEqual(await como(U.consulta, "select codigo, foto from public.v_planilla where codigo in ('V100', 'V100-WHI') order by codigo"), [{ codigo: 'V100', foto: false }, { codigo: 'V100-WHI', foto: true }]);
});

test('fecha de alta en la web: se completa sola al tildar "Cargado web" y no se pisa', async () => {
  await cargarOC(oc('0001-00000051', '2026-10-01', [['F1', 1], ['F2', 1]]));
  const fecha = codigo => como(U.consulta, `select fecha_alta_web::text as f, public.hoy()::text as hoy from public.articulos where codigo = '${codigo}'`).then(f => f[0]);
  assert.equal((await fecha('F1')).f, null);
  await como(U.carga, "update public.articulos set cargado_web = true where codigo = 'F1'");
  const a = await fecha('F1');
  assert.equal(a.f, a.hoy);
  // una fecha puesta a mano no se pisa; destildar y volver a tildar tampoco
  await como(U.carga, "update public.articulos set cargado_web = true, fecha_alta_web = '2026-05-02' where codigo = 'F2'");
  assert.equal((await fecha('F2')).f, '2026-05-02');
  await como(U.carga, "update public.articulos set cargado_web = false where codigo = 'F1'");
  await como(U.carga, "update public.articulos set cargado_web = true where codigo = 'F1'");
  assert.equal((await fecha('F1')).f, a.hoy);
  // otros cambios no tocan la fecha
  await como(U.carga, "update public.articulos set foto = true where codigo = 'F2'");
  assert.equal((await fecha('F2')).f, '2026-05-02');
});

test('revisión web: solo la función escribe el resultado; si ya estaba publicado no se inventa la fecha de alta', async () => {
  await cargarOC(oc('0001-00000060', '2026-10-01', [['W1', 1], ['W2', 1]]));
  // un usuario no puede escribir el resultado de la revisión
  await assert.rejects(como(U.carga, "update public.articulos set web_estado = 'publicado' where codigo = 'W1'"), /permission denied/);
  await assert.rejects(como(U.admin, "update public.articulos set web_url = 'x' where codigo = 'W1'"), /permission denied/);
  // sí sus columnas de trabajo
  assert.equal((await como(U.carga, "update public.articulos set foto = true, descripcion_web = 'x' where codigo = 'W1' returning codigo")).length, 1);
  // lo que escribe la función, con la clave de servicio
  await db.transaction(async tx => {
    await tx.exec('set local role service_role;');
    // la función primero lee el perfil de quien la llama (sin este permiso respondía 403)
    assert.equal((await tx.query("select rol, activo from public.perfiles where id = '" + U.carga + "'")).rows[0].rol, 'carga');
    await tx.query("update public.articulos set web_estado = 'publicado', web_revisado_en = now(), web_url = 'https://tienda/w1', web_nombre = 'W1 WEB' where codigo = 'W1'");
    await tx.query("update public.articulos set web_estado = 'no_esta', web_revisado_en = now() where codigo = 'W2'");
  });
  assert.deepEqual(await como(U.consulta, "select codigo, web_estado, web_url from public.v_planilla where orden = '0001-00000060' order by codigo"),
    [{ codigo: 'W1', web_estado: 'publicado', web_url: 'https://tienda/w1' }, { codigo: 'W2', web_estado: 'no_esta', web_url: '' }]);
  // tildar "Cargado web": W1 ya estaba publicado (fecha real desconocida) -> queda vacía; W2 -> hoy
  await como(U.carga, "update public.articulos set cargado_web = true where codigo in ('W1', 'W2')");
  assert.deepEqual(await como(U.consulta, "select codigo, fecha_alta_web is null as sin_fecha from public.articulos where codigo in ('W1', 'W2') order by codigo"),
    [{ codigo: 'W1', sin_fecha: true }, { codigo: 'W2', sin_fecha: false }]);
});

test('preferencias: cada uno guarda y ve solo las suyas', async () => {
  await como(U.carga, "insert into public.preferencias (columnas_ocultas) values ('{foto,catalogo}')");
  await como(U.consulta, "insert into public.preferencias (columnas_ocultas) values ('{precio_unitario}')");
  assert.deepEqual(await como(U.carga, 'select columnas_ocultas from public.preferencias'), [{ columnas_ocultas: ['foto', 'catalogo'] }]);
  await assert.rejects(como(U.carga, `insert into public.preferencias (usuario_id) values ('${U.consulta}')`), /row-level security|duplicate key/);
});

test('funciones de trigger y de permisos: nadie las llama directo; sin sesión, tampoco las de permisos', async () => {
  await assert.rejects(como(U.carga, 'select public.controlar_recepcion()'), /permission denied|trigger/);
  await assert.rejects(como(null, 'select public.puede_cargar()'), /permission denied/);
  assert.deepEqual(await como(U.carga, 'select public.puede_cargar() as p'), [{ p: true }]);
  assert.deepEqual(await como(U.consulta, 'select public.puede_cargar() as p'), [{ p: false }]);
});

test('sin sesión no hay acceso a ninguna tabla ni vista', async () => {
  for (const t of ['perfiles', 'articulos', 'ordenes_compra', 'recepciones', 'v_planilla', 'v_pendientes']) {
    await assert.rejects(como(null, `select 1 from public.${t} limit 1`), /permission denied/, t);
  }
});

test('no se puede quitar el último admin activo', async () => {
  await assert.rejects(db.query(`update public.perfiles set activo = false where id = '${U.admin}'`), /último admin/);
});

test('importar la planilla anterior: solo admin, proveedor sin CUIT, lo que llegó queda recibido, se puede repetir', async () => {
  const doc = {
    colores: [{ codigo: 'CAM', nombre: 'Camel' }, { codigo: 'NEG', nombre: 'Otro nombre' }],
    articulos: [
      { codigo: 'IMP1', descripcion: 'ART IMP1', proveedor: 'Importado S.R.L.', tipo: 'PADRE', variantes: 'CAM', cargado_web: true, fecha_alta_web: null,
        titulo_web: 'Título', descripcion_web: 'Descripción larga', estado_descripcion: 'PUBLICADA', foto: true },
      { codigo: 'IMP2', descripcion: 'ART IMP2', proveedor: 'Importado S.R.L.', tipo: 'PADRE', cargado_web: true, fecha_alta_web: '2026-05-15' },
      { codigo: 'IMP1-CAM', descripcion: 'ART IMP1 CAMEL', proveedor: 'Importado S.R.L.', tipo: 'VARIANTE', padre: 'IMP1', color: 'CAM' },
      { codigo: 'IMP1-ZZZ', descripcion: 'sin padre ni color', proveedor: 'Importado S.R.L.', tipo: 'VARIANTE', padre: 'NOEXISTE', color: 'ZZZ' },
    ],
    ordenes: [{ numero: '0002-00000001', fecha: '2026-05-04', proveedor: 'IMPORTADO SRL', lineas: [
      { codigo: 'IMP1', descripcion: 'ART IMP1', cantidad: 10, precio_unitario: 150.5, llego: true },
      { codigo: 'IMP2', descripcion: 'ART IMP2', cantidad: 5, precio_unitario: 20, llego: false }] }],
  };
  const importar = (usuario, d = doc) => como(usuario, 'select public.importar_planilla($1) as r', [d]).then(f => f[0].r);
  await assert.rejects(importar(U.carga), /Solo un admin/);
  await assert.rejects(importar(U.consulta), /Solo un admin/);
  await assert.rejects(como(null, "select public.importar_planilla('{}'::jsonb)"), /permission denied/);

  const provAntes = (await como(U.admin, 'select count(*)::int as n from public.proveedores'))[0].n;
  assert.deepEqual(await importar(U.admin), { colores: 1, articulos: 4, articulos_existentes: 0, ordenes: 1, ordenes_existentes: 0, lineas: 2, recibidas: 1, proveedores_nuevos: 1 });
  // "Importado S.R.L." y "IMPORTADO SRL" son el mismo proveedor, sin CUIT
  assert.deepEqual(await como(U.admin, "select cuit, nombre from public.proveedores where nombre = 'Importado S.R.L.'"), [{ cuit: null, nombre: 'Importado S.R.L.' }]);
  // La fecha de alta no se inventa: la planilla no la traía y queda vacía (no "hoy")
  const arts = await como(U.consulta, "select codigo, cargado_web, fecha_alta_web::text as f, padre_codigo, color_id from public.articulos where codigo like 'IMP%' order by codigo");
  assert.deepEqual(arts.map(a => [a.codigo, a.cargado_web, a.f, a.padre_codigo, a.color_id != null]),
    [['IMP1', true, null, null, false], ['IMP1-CAM', false, null, 'IMP1', true], ['IMP1-ZZZ', false, null, null, false], ['IMP2', true, '2026-05-15', null, false]]);
  // Lo que llegó queda recibido (remito PLANILLA-…); lo demás, pendiente
  assert.deepEqual((await estadoLineas('0002-00000001')).map(l => [l.codigo, l.recibido, l.pendiente, l.estado]),
    [['IMP1', 10, 0, 'completa'], ['IMP2', 0, 5, 'pendiente']]);
  assert.equal((await como(U.consulta, "select count(*)::int as n from public.remitos where numero = 'PLANILLA-0002-00000001'"))[0].n, 1);
  assert.equal((await como(U.consulta, "select precio_unitario::float8 as p from public.v_oc_lineas where orden = '0002-00000001' and codigo = 'IMP1'"))[0].p, 150.5);

  // Repetirla no duplica nada ni pisa lo que ya se trabajó
  await como(U.carga, "update public.articulos set foto = false where codigo = 'IMP1'");
  assert.deepEqual(await importar(U.admin), { colores: 0, articulos: 0, articulos_existentes: 4, ordenes: 0, ordenes_existentes: 1, lineas: 0, recibidas: 0, proveedores_nuevos: 0 });
  assert.equal((await como(U.consulta, "select foto from public.articulos where codigo = 'IMP1'"))[0].foto, false);

  // Cuando llega una OC de Manager de ese proveedor, se completa el CUIT en vez de duplicarlo
  const orden = { ...oc('0002-00000002', '2026-06-01', [['IMP2', 3]]), cuit: '30888888880', proveedor: 'Importado SRL' };
  await cargarOC(orden);
  assert.deepEqual(await como(U.admin, "select cuit from public.proveedores where nombre = 'Importado S.R.L.'"), [{ cuit: '30888888880' }]);
  assert.equal((await como(U.admin, 'select count(*)::int as n from public.proveedores'))[0].n, provAntes + 1);
});

test('actualizar con la planilla nueva: renombres, fusión, campos, llegadas, precios y líneas que ya no van', async () => {
  const orden = '0002-00000010';
  const lin = (codigo, cantidad, llego, precio = 10) => ({ codigo, descripcion: 'ART ' + codigo, cantidad, precio_unitario: precio, llego });
  await como(U.admin, 'select public.importar_planilla($1)', [{
    articulos: [
      { codigo: '1.234.567', descripcion: 'PADRE', proveedor: 'Sync SA', tipo: 'PADRE' },
      { codigo: '1.234.567-NEG', descripcion: 'VAR', proveedor: 'Sync SA', tipo: 'VARIANTE' },
      { codigo: '9.999', descripcion: 'DUP1', proveedor: 'Sync SA' }, { codigo: '9999', descripcion: 'DUP2', proveedor: 'Sync SA' },
      { codigo: 'X1', descripcion: 'X', proveedor: 'Sync SA' },
    ],
    ordenes: [{ numero: orden, fecha: '2026-06-01', proveedor: 'Sync SA',
      lineas: [lin('1.234.567', 10, false), lin('1.234.567-NEG', 10, true), lin('9.999', 5, true), lin('9999', 3, false), lin('X1', 4, false)] }],
  }]);
  const doc = {
    renombres: [{ de: '1.234.567', a: '1234567' }, { de: '1.234.567-NEG', a: '1234567-NEG' }, { de: '9.999', a: '9999' }, { de: 'NOEXISTE', a: 'NOEXISTE2' }],
    articulos: [
      { codigo: '1234567-NEG', campos: { padre: '1234567', color: 'NEG', foto: true } },
      { codigo: 'X1', campos: { cargado_web: true, fecha_alta_web: '2026-05-01', proveedor: 'Otro Prov SA', descripcion_web: 'Texto nuevo' } },
    ],
    lineas_nuevas: [{ orden, ...lin('N1', 2, true, 7), indice: 0 }],
    lineas_precio: [{ orden, codigo: 'X1', indice: 0, precio_unitario: 55.5 }],
    llegadas: [{ orden, codigo: '1234567', indice: 0 }, { orden, codigo: '9999', indice: 1 }],
    lineas_quitadas: [{ orden, codigo: '1234567-NEG', indice: 0 }],
  };
  const sinc = (usuario, simular) => como(usuario, 'select public.sincronizar_planilla($1, $2) as r', [doc, simular]).then(f => f[0].r);
  await assert.rejects(sinc(U.carga, false), /Solo un admin/);
  await assert.rejects(sinc(U.consulta, true), /Solo un admin/);
  await assert.rejects(como(null, "select public.sincronizar_planilla('{}'::jsonb, true)"), /permission denied/);
  // las funciones de adentro no se llaman directo
  await assert.rejects(como(U.admin, "select public.aplicar_sincronizacion('{}'::jsonb)"), /permission denied/);
  await assert.rejects(como(U.admin, 'select public.recibir_pendiente_planilla(1)'), /permission denied/);

  const antes = await estadoLineas(orden);
  // simulación: informa y no guarda
  const sim = await sinc(U.admin, true);
  assert.equal(sim.confirmado, false);
  assert.deepEqual([sim.renombrados, sim.fusionados, sim.articulos_actualizados, sim.lineas_nuevas, sim.precios, sim.llegadas, sim.lineas_quitadas],
    [2, 1, 2, 1, 1, 3, 1]);
  assert.deepEqual(await estadoLineas(orden), antes);
  assert.equal((await como(U.admin, "select count(*)::int as n from public.articulos where codigo = '1.234.567'"))[0].n, 1);

  const r = await sinc(U.admin, false);
  assert.equal(r.confirmado, true);
  // los códigos quedaron sin puntos; el duplicado se fusionó; la variante quedó colgada de su principal
  assert.deepEqual((await como(U.admin, "select codigo from public.articulos where codigo in ('1.234.567','1.234.567-NEG','9.999','1234567','1234567-NEG','9999') order by codigo")).map(x => x.codigo),
    ['1234567', '1234567-NEG', '9999']);
  const v = await como(U.admin, "select padre_codigo, foto, color_id is not null as color from public.articulos where codigo = '1234567-NEG'");
  assert.deepEqual(v, [{ padre_codigo: '1234567', foto: true, color: true }]);
  const x = await como(U.admin, "select a.cargado_web, a.fecha_alta_web::text as f, a.descripcion_web, p.nombre from public.articulos a join public.proveedores p on p.id = a.proveedor_id where a.codigo = 'X1'");
  assert.deepEqual(x, [{ cargado_web: true, f: '2026-05-01', descripcion_web: 'Texto nuevo', nombre: 'Otro Prov SA' }]);
  // líneas: la del padre llegó, la de la variante se fue, los dos "9999" (uno recibido y otro pendiente), X1 con su precio, N1 nueva y recibida
  assert.deepEqual((await estadoLineas(orden)).map(l => [l.codigo, l.cantidad, l.recibido, l.estado]), [
    ['1234567', 10, 10, 'completa'], ['9999', 5, 5, 'completa'], ['9999', 3, 3, 'completa'], ['X1', 4, 0, 'pendiente'], ['N1', 2, 2, 'completa']]);
  assert.equal((await como(U.admin, "select precio_unitario::float8 as p from public.v_oc_lineas where orden = '0002-00000010' and codigo = 'X1'"))[0].p, 55.5);
  // lo recibido de la línea que se fue no queda como "llegó sin orden de compra"
  assert.equal((await como(U.admin, "select count(*)::int as n from public.v_sobrantes where codigo like '1234567%'"))[0].n, 0);
  // repetirla no rompe nada (ya no hay nada que renombrar ni recibir)
  const otra = await sinc(U.admin, false);
  assert.deepEqual([otra.renombrados, otra.fusionados, otra.llegadas, otra.lineas_quitadas], [0, 0, 0, 0]);
});

test('remito contra una orden elegida, asignar a mano lo que llegó sin orden, desasignar y deshacer lo propio', async () => {
  // dos órdenes abiertas del mismo proveedor con el mismo código
  await cargarOC(oc('0003-00000001', '2026-07-01', [['AS1', 10], ['AS2', 5]]));
  await cargarOC(oc('0003-00000002', '2026-07-02', [['AS1', 10]]));
  const rem = (numero, lineas, orden) => ({ ...remito(numero, '2026-07-10', lineas), ...(orden ? { orden } : {}) });

  // sin elegir: va a la más vieja; con una orden elegida: solo a esa
  const auto = await cargarRemito(rem('R-AUTO', [['AS1', 4]]), false);
  assert.deepEqual(auto.lineas[0].asignado, [{ orden: '0003-00000001', cantidad: 4 }]);
  const elegida = await cargarRemito(rem('R-ELEGIDA', [['AS1', 4], ['ZZ9', 3]], '0003-00000002'));
  assert.deepEqual(elegida.lineas[0].asignado, [{ orden: '0003-00000002', cantidad: 4 }]);
  assert.equal(elegida.orden_elegida, '0003-00000002');
  assert.equal(Number(elegida.lineas[1].sin_orden), 3, 'ZZ9 no está en ninguna orden: queda sin orden');
  await assert.rejects(cargarRemito(rem('R-MALA', [['AS1', 1]], '0003-00099999')), /no existe o es de otro proveedor/);
  await assert.rejects(cargarRemito(rem('', [['AS1', 1]])), /no tiene número/);

  // lo que llegó sin orden se ve con lo necesario para asignarlo
  const sob = (await como(U.carga, "select remito_linea_id, proveedor_id, codigo, sin_orden::float8 as sin from public.v_sobrantes where remito = 'R-ELEGIDA'"))[0];
  assert.equal(sob.codigo, 'ZZ9'); assert.equal(sob.sin, 3);
  const lineaAS2 = (await como(U.carga, "select id from public.v_oc_lineas where orden = '0003-00000001' and codigo = 'AS2'"))[0].id;

  // asignar a mano a una línea con OTRO código
  const asig = (f, o, c, u = U.carga) => como(u, 'select public.asignar_a_orden($1, $2, $3) as r', [f, o, c]).then(x => x[0].r);
  await assert.rejects(asig(sob.remito_linea_id, lineaAS2, 4), /solo quedan 3 unidades sin orden/);
  await assert.rejects(asig(sob.remito_linea_id, lineaAS2, 0), /mayor a 0/);
  await assert.rejects(asig(sob.remito_linea_id, lineaAS2, 3, U.consulta), /permiso/);
  const r1 = await asig(sob.remito_linea_id, lineaAS2, 2);
  assert.equal(r1.orden, '0003-00000001');
  assert.equal((await como(U.carga, "select pendiente::float8 as p from public.v_oc_lineas where id = $1", [lineaAS2]))[0].p, 3);
  assert.equal((await como(U.carga, "select sin_orden::float8 as s from public.v_sobrantes where remito_linea_id = $1", [sob.remito_linea_id]))[0].s, 1);
  // una orden de otro proveedor no vale
  await cargarOC({ ...oc('0003-00000003', '2026-07-03', [['OT1', 5]]), cuit: '30777777770', proveedor: 'OTRO PROVEEDOR' });
  const lineaOtro = (await como(U.carga, "select id from public.v_oc_lineas where orden = '0003-00000003'"))[0].id;
  await assert.rejects(asig(sob.remito_linea_id, lineaOtro, 1), /otro proveedor/);
  // sumar de nuevo al mismo par no rompe la restricción
  await asig(sob.remito_linea_id, lineaAS2, 1);
  assert.equal((await como(U.carga, "select count(*)::int as n from public.v_sobrantes where remito_linea_id = $1", [sob.remito_linea_id]))[0].n, 0);
  // desasignar: vuelve a quedar sin orden y la orden vuelve a faltar
  const d = await como(U.carga, 'select public.desasignar($1, $2, 1) as r', [sob.remito_linea_id, lineaAS2]).then(x => x[0].r);
  assert.equal(d.quitado, 1);
  assert.equal((await como(U.carga, "select sin_orden::float8 as s from public.v_sobrantes where remito_linea_id = $1", [sob.remito_linea_id]))[0].s, 1);
  await como(U.carga, 'select public.desasignar($1, $2) as r', [sob.remito_linea_id, lineaAS2]);
  assert.equal((await como(U.carga, "select sin_orden::float8 as s from public.v_sobrantes where remito_linea_id = $1", [sob.remito_linea_id]))[0].s, 3);
  await assert.rejects(como(U.consulta, 'select public.desasignar($1, $2)', [sob.remito_linea_id, lineaAS2]), /permiso/);

  // cambiar el número de un remito: carga sí, consulta no
  assert.equal((await como(U.carga, "update public.remitos set numero = 'R-ELEGIDA-2' where numero = 'R-ELEGIDA' returning id")).length, 1);
  assert.equal((await como(U.consulta, "update public.remitos set numero = 'X' where numero = 'R-ELEGIDA-2' returning id")).length, 0);

  // deshacer lo propio: borrar un documento que cargó uno mismo, durante 2 horas
  const propio = await cargarOC(oc('0003-00000004', '2026-07-04', [['UN1', 1]]));
  assert.equal((await como(U.consulta, 'delete from public.ordenes_compra where id = $1 returning id', [propio.orden_id])).length, 0);
  assert.equal((await como(U.carga, 'delete from public.ordenes_compra where id = $1 returning id', [propio.orden_id])).length, 1);
  const viejo = await cargarOC(oc('0003-00000005', '2026-07-05', [['UN2', 1]]));
  await db.query("update public.ordenes_compra set creado_en = now() - interval '3 hours' where id = $1", [viejo.orden_id]);
  assert.equal((await como(U.carga, 'delete from public.ordenes_compra where id = $1 returning id', [viejo.orden_id])).length, 0, 'pasadas 2 horas, solo un admin');
  assert.equal((await como(U.admin, 'delete from public.ordenes_compra where id = $1 returning id', [viejo.orden_id])).length, 1);
  const remP = await cargarRemito(rem('R-PROPIO', [['AS1', 1]]));
  assert.equal((await como(U.carga, 'delete from public.remitos where id = $1 returning id', [remP.remito_id])).length, 1);
});

test('las migraciones se pueden volver a correr sin perder datos', async () => {
  const contar = () => db.query('select (select count(*) from public.ordenes_compra)::int as oc, (select count(*) from public.recepciones)::int as rec').then(r => r.rows[0]);
  const antes = await contar();
  for (const sql of migraciones()) await db.exec(sql);
  assert.deepEqual(await contar(), antes);
  // Y sigue sin poder ejecutarse sin sesión
  await assert.rejects(como(null, `select public.cargar_remito('{}'::jsonb, false)`), /permission denied/);
});

test('registro de backups: solo el admin lo ve y nadie lo escribe desde la página', async () => {
  await db.exec("insert into public.backups_registro (estado, archivo) values ('ok', 'backup-compras-cindy-2026-11-04.xlsx')");
  assert.equal((await como(U.admin, 'select count(*)::int as n from public.backups_registro'))[0].n, 1);
  for (const u of [U.carga, U.consulta]) assert.equal((await como(u, 'select count(*)::int as n from public.backups_registro'))[0].n, 0);
  await assert.rejects(como(U.admin, "insert into public.backups_registro (estado) values ('ok')"), /permission denied/);
  await assert.rejects(como(null, 'select * from public.backups_registro'), /permission denied/);
});

test('artículos sin orden: la vista lista los que no tienen orden (ni su principal) y los ve cualquier usuario con sesión', async () => {
  await cargarOC(oc('0001-00000088', '2026-10-01', [['CO1', 1]]));
  await db.exec(`insert into public.articulos (codigo, descripcion, descripcion_web, descripcion_ok) values ('SO1', 'SUELTO UNO', 'Texto web', true), ('SO2', 'SUELTO DOS', '', false);
                 insert into public.articulos (codigo, descripcion, tipo, padre_codigo) values ('CO1-X', 'VARIANTE DE CO1', 'VARIANTE', 'CO1'), ('SO1-X', 'VARIANTE DE SO1', 'VARIANTE', 'SO1')`);
  const sin = (u) => como(u, "select codigo, nombre, orden, estado, descripcion_web, descripcion_ok, es_variante from public.v_articulos_sin_orden where codigo in ('CO1', 'CO1-X', 'SO1', 'SO1-X', 'SO2') order by codigo");
  const filas = await sin(U.consulta);
  assert.deepEqual(filas.map(f => f.codigo), ['SO1', 'SO1-X', 'SO2']); // CO1 tiene orden y su variante cuelga de un artículo con orden
  assert.deepEqual(filas[0], { codigo: 'SO1', nombre: 'SUELTO UNO', orden: null, estado: null, descripcion_web: 'Texto web', descripcion_ok: true, es_variante: false });
  assert.equal(filas[1].es_variante, true);
  // Al cargarle una orden deja de salir
  await cargarOC(oc('0001-00000089', '2026-10-02', [['SO2', 3]]));
  assert.deepEqual((await sin(U.carga)).map(f => f.codigo), ['SO1', 'SO1-X']);
  await assert.rejects(como(null, 'select * from public.v_articulos_sin_orden'), /permission denied/);
});

test('pendientes: los artículos sin orden ni remito no cuentan (ni en pendientes ni en sobrantes)', async () => {
  await cargarOC(oc('0001-00000090', '2026-10-01', [['PE1', 5]]));
  const foto = async () => ({
    pendientes: await como(U.consulta, "select count(*)::int as lineas, coalesce(sum(pendiente), 0)::float8 as unidades, count(distinct orden)::int as ordenes from public.v_pendientes"),
    sobrantes: await como(U.consulta, 'select count(*)::int as n from public.v_sobrantes'),
  });
  const antes = await foto();
  await db.exec("insert into public.articulos (codigo, descripcion, descripcion_web) values ('PE-SUELTO1', 'Suelto 1', 'Texto'), ('PE-SUELTO2', 'Suelto 2', '')");
  assert.deepEqual(await foto(), antes);
});

test('restaurar desde el Excel del backup: vuelve todo lo borrado, sin duplicar, y el reinicio de números anda', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const { armarLibro } = await import('../backup/armar-xlsx.mjs');
  const { leerLibro, planDeRestauracion, lotes, TABLAS_RESTAURABLES, CLAVES } = await import('../backup/restaurar-lib.mjs');
  const snap = async () => {
    const o = {};
    for (const t of TABLAS_RESTAURABLES) o[t] = (await db.query(`select coalesce(jsonb_agg(to_jsonb(x) order by x.${CLAVES[t]}), '[]'::jsonb) as r from public.${t} x`)).rows[0].r;
    return o;
  };
  const antes = await snap();
  for (const t of TABLAS_RESTAURABLES) assert.ok(antes[t].length > 0, `la prueba necesita datos en ${t}`);

  // Backup -> Excel -> lectura (el mismo camino que el script)
  const buffer = Buffer.from(await armarLibro(ExcelJS, { planilla: [], tablas: { ...antes, perfiles: [], preferencias: [] } }).xlsx.writeBuffer());
  const libro = await leerLibro(ExcelJS, buffer);
  assert.equal(libro.tablas.articulos.length, antes.articulos.length);

  // Se pierde todo
  await db.exec(`truncate public.recepciones, public.remito_lineas, public.remitos, public.oc_lineas, public.ordenes_compra, public.articulos, public.colores, public.proveedores restart identity cascade`);
  assert.equal((await snap()).articulos.length, 0);

  // Solo el backend (clave de servicio) puede restaurar
  await assert.rejects(como(U.admin, `select public.restaurar_tabla('articulos', '[]'::jsonb)`), /permission denied/);
  await assert.rejects(db.query(`select public.restaurar_tabla('perfiles', '[]'::jsonb)`), /no permitida/);

  const cargar = async (plan) => {
    const insertadas = {};
    for (const p of plan) for (const lote of lotes(p.faltan, 100)) {
      const r = (await db.query('select public.restaurar_tabla($1, $2::jsonb) as r', [p.tabla, JSON.stringify(lote)])).rows[0].r;
      insertadas[p.tabla] = (insertadas[p.tabla] || 0) + r.insertadas;
    }
    return insertadas;
  };
  const vacias = Object.fromEntries(TABLAS_RESTAURABLES.map(t => [t, new Set()]));
  const plan = planDeRestauracion(libro, vacias);
  assert.ok(plan.every(p => p.huerfanas.length === 0), 'no debería haber filas huérfanas');
  const insertadas = await cargar(plan);
  for (const t of TABLAS_RESTAURABLES) assert.equal(insertadas[t], antes[t].length, `se cargaron todas las filas de ${t}`);

  // Quedó igual que antes (mismos números, textos, fechas, cantidades)
  assert.deepEqual(await snap(), antes);

  // Repetir no duplica: nada falta y, si igual se manda, la base ignora lo que ya está
  const existentes = Object.fromEntries(TABLAS_RESTAURABLES.map(t => [t, new Set(antes[t].map(f => String(f[CLAVES[t]])))]));
  const plan2 = planDeRestauracion(libro, existentes);
  assert.ok(plan2.every(p => p.faltan.length === 0));
  const r2 = (await db.query('select public.restaurar_tabla($1, $2::jsonb) as r', ['proveedores', JSON.stringify(antes.proveedores)])).rows[0].r;
  assert.deepEqual(r2, { enviadas: antes.proveedores.length, insertadas: 0 });

  // Los números siguen desde el más alto: un proveedor nuevo no choca con los restaurados
  const nuevo = (await db.query(`insert into public.proveedores (cuit, nombre) values ('30000000007', 'NUEVO TRAS RESTAURAR') returning id`)).rows[0].id;
  assert.ok(Number(nuevo) > Math.max(...antes.proveedores.map(p => Number(p.id))));
});

test('lo que llega por remito sin orden: crea el artículo, marca "Llegó" y sale en la Planilla y en "Subir a la página"', async () => {
  const cuitSO = '30555555550';
  const remSO = (numero, fecha, lineas) => ({ ...remito(numero, fecha, lineas), cuit: cuitSO, proveedor: 'PROVEEDOR SIN ORDEN SA' });
  // Un artículo que ya existía (con variante) y uno nuevo, ninguno con orden
  await db.exec(`insert into public.articulos (codigo, descripcion) values ('SN-VIEJO', 'YA CARGADO');
                 insert into public.articulos (codigo, descripcion, tipo, padre_codigo) values ('SN-VIEJO-NEG', 'YA CARGADO NEGRO', 'VARIANTE', 'SN-VIEJO')`);

  // La simulación no crea nada
  await cargarRemito(remSO('0007-00000001', '2026-11-10', [['SN-NUEVO', 4]]), false);
  assert.equal((await como(U.consulta, "select count(*)::int as n from public.articulos where codigo = 'SN-NUEVO'"))[0].n, 0);

  await cargarRemito(remSO('0007-00000001', '2026-11-10', [['SN-NUEVO', 4], ['SN-VIEJO', 2]]));
  await cargarRemito(remSO('0007-00000002', '2026-11-11', [['SN-NUEVO', 1]]));
  const art = await como(U.consulta, "select codigo, descripcion, llego, (proveedor_id is not null) as con_prov from public.articulos where codigo in ('SN-NUEVO', 'SN-VIEJO') order by codigo");
  assert.deepEqual(art, [
    { codigo: 'SN-NUEVO', descripcion: 'ART SN-NUEVO', llego: true, con_prov: true },
    { codigo: 'SN-VIEJO', descripcion: 'YA CARGADO', llego: true, con_prov: false }, // no se pisa lo que ya estaba
  ]);

  // Planilla: una fila por artículo (las variantes debajo), estado "sin_orden", unidades y remitos
  const planilla = u => como(u, "select codigo, orden, estado, cantidad::float8 as cantidad, ultima_recepcion::text as ultima, remitos, llego, es_variante, proveedor from public.v_planilla where codigo like 'SN-%' order by padre, es_variante, codigo");
  assert.deepEqual(await planilla(U.consulta), [
    { codigo: 'SN-NUEVO', orden: null, estado: 'sin_orden', cantidad: 5, ultima: '2026-11-11', remitos: '0007-00000001, 0007-00000002', llego: true, es_variante: false, proveedor: 'PROVEEDOR SIN ORDEN SA' },
    { codigo: 'SN-VIEJO', orden: null, estado: 'sin_orden', cantidad: 2, ultima: '2026-11-10', remitos: '0007-00000001', llego: true, es_variante: false, proveedor: 'PROVEEDOR SIN ORDEN SA' },
    { codigo: 'SN-VIEJO-NEG', orden: null, estado: 'sin_orden', cantidad: null, ultima: '2026-11-10', remitos: '0007-00000001', llego: true, es_variante: true, proveedor: 'PROVEEDOR SIN ORDEN SA' },
  ]);
  // Lo que usa "Subir a la página": llegó y no está cargado en la web
  const subir = async () => (await como(U.carga, "select codigo from public.v_planilla where codigo like 'SN-%' and llego and not cargado_web and not es_variante order by codigo")).map(f => f.codigo);
  assert.deepEqual(await subir(), ['SN-NUEVO', 'SN-VIEJO']);
  await como(U.carga, "update public.articulos set cargado_web = true where codigo = 'SN-VIEJO'");
  assert.deepEqual(await subir(), ['SN-NUEVO']);

  // Una variante que llega sola marca también a su artículo principal (la Planilla muestra la casilla del principal)
  await db.exec(`insert into public.articulos (codigo, descripcion) values ('SV-PADRE', 'PADRE');
                 insert into public.articulos (codigo, descripcion, tipo, padre_codigo) values ('SV-PADRE-ROJ', 'PADRE ROJO', 'VARIANTE', 'SV-PADRE')`);
  await cargarRemito(remSO('0007-00000003', '2026-11-11', [['SV-PADRE-ROJ', 3]]));
  assert.deepEqual(await como(U.consulta, "select codigo, llego from public.articulos where codigo like 'SV-PADRE%' order by codigo"),
    [{ codigo: 'SV-PADRE', llego: true }, { codigo: 'SV-PADRE-ROJ', llego: true }]);
  // Llegó sola, sin su principal en el remito: sale como su propia fila
  assert.deepEqual((await como(U.consulta, "select codigo, estado from public.v_planilla where codigo like 'SV-PADRE%' order by codigo")),
    [{ codigo: 'SV-PADRE-ROJ', estado: 'sin_orden' }]);

  // Al asignarlo a una orden, la fila "sin orden" se va y queda la de la orden (sin repetirse)
  await cargarOC({ ...oc('0007-00000100', '2026-11-11', [['SN-NUEVO', 10]]), cuit: cuitSO, proveedor: 'PROVEEDOR SIN ORDEN SA' });
  const filasNuevo = () => como(U.consulta, "select orden, estado from public.v_planilla where codigo = 'SN-NUEVO' order by orden nulls last");
  assert.deepEqual(await filasNuevo(), [{ orden: '0007-00000100', estado: 'pendiente' }], 'con una orden del mismo código sale solo por la orden');
  const linea = (await como(U.carga, "select id from public.v_oc_lineas where orden = '0007-00000100'"))[0].id;
  for (const s of await como(U.carga, "select remito_linea_id, sin_orden::float8 as n from public.v_sobrantes where codigo = 'SN-NUEVO'")) {
    await como(U.carga, 'select public.asignar_a_orden($1, $2, $3)', [s.remito_linea_id, linea, s.n]);
  }
  assert.deepEqual(await filasNuevo(), [{ orden: '0007-00000100', estado: 'parcial' }]);

  // El remito borrado no deja la fila "sin orden" (el artículo queda, con "Llegó" marcado)
  const r = await cargarRemito(remSO('0007-00000004', '2026-11-12', [['SN-BORRAR', 1]]));
  assert.equal((await como(U.consulta, "select count(*)::int as n from public.v_planilla where codigo = 'SN-BORRAR'"))[0].n, 1);
  await como(U.carga, 'delete from public.remitos where id = $1', [r.remito_id]);
  assert.equal((await como(U.consulta, "select count(*)::int as n from public.v_planilla where codigo = 'SN-BORRAR'"))[0].n, 0);
});

test('migración de lo que ya llegó sin orden: crea los artículos que faltaban y los marca', async () => {
  // Como estaba antes: una línea de remito sin orden y sin artículo
  await db.exec(`alter table public.remito_lineas disable trigger remito_lineas_articulo`);
  const r = await cargarRemito({ ...remito('0008-00000001', '2026-11-01', [['MG-SUELTO', 2]]), cuit: '30444444440', proveedor: 'PROVEEDOR MIGRACION' });
  await db.exec(`alter table public.remito_lineas enable trigger remito_lineas_articulo`);
  assert.equal((await db.query("select count(*)::int as n from public.articulos where codigo = 'MG-SUELTO'")).rows[0].n, 0);
  assert.equal(r.sin_orden.length, 1);

  const sql = migraciones().find(m => m.includes('articulo_desde_remito'));
  await db.exec(sql);
  assert.deepEqual((await db.query("select llego, descripcion from public.articulos where codigo = 'MG-SUELTO'")).rows, [{ llego: true, descripcion: 'ART MG-SUELTO' }]);
  assert.equal((await como(U.consulta, "select estado from public.v_planilla where codigo = 'MG-SUELTO'"))[0].estado, 'sin_orden');
});
