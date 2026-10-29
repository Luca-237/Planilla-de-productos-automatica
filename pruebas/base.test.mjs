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
  assert.equal((await como(U.carga, "delete from public.remitos where numero = '0009-00000004' returning id")).length, 0);
  assert.equal((await como(U.admin, "delete from public.remitos where numero = '0009-00000004' returning id")).length, 1);
});

test('borrar documentos (admin): un remito devuelve sus unidades a pendientes; una OC deja lo recibido como "sin orden"', async () => {
  await cargarOC(oc('0001-00000020', '2026-10-01', [['B1', 10]]));
  await cargarRemito(remito('0009-00000020', '2026-10-05', [['B1', 7]]));
  assert.equal((await estadoLineas('0001-00000020'))[0].pendiente, 3);
  // carga no puede borrar; admin sí
  assert.equal((await como(U.carga, "delete from public.remitos where numero = '0009-00000020' returning id")).length, 0);
  assert.equal((await como(U.admin, "delete from public.remitos where numero = '0009-00000020' returning id")).length, 1);
  assert.deepEqual(await estadoLineas('0001-00000020'), [{ codigo: 'B1', cantidad: 10, recibido: 0, pendiente: 10, estado: 'pendiente' }]);
  // Al borrar la OC, lo que había llegado contra ella queda "sin orden"
  await cargarRemito(remito('0009-00000021', '2026-10-06', [['B1', 4]]));
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

test('las migraciones se pueden volver a correr sin perder datos', async () => {
  const contar = () => db.query('select (select count(*) from public.ordenes_compra)::int as oc, (select count(*) from public.recepciones)::int as rec').then(r => r.rows[0]);
  const antes = await contar();
  for (const sql of migraciones()) await db.exec(sql);
  assert.deepEqual(await contar(), antes);
  // Y sigue sin poder ejecutarse sin sesión
  await assert.rejects(como(null, `select public.cargar_remito('{}'::jsonb, false)`), /permission denied/);
});
