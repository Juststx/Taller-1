// Security rules: roles, setup, deactivation, orders, public link, inventory and expenses, plus attack attempts.
const { test, before, after, beforeEach } = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');

let env;
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-taller', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8085 } });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await db.doc('config/setup').set({ owner: 'admin' });
    await db.doc('config/taller').set({ nombre: 'Taller' });
    for (const [uid, rol, activo] of [['admin', 'admin', true], ['ana', 'recepcion', true], ['carlos', 'mecanico', true], ['viejo', 'mecanico', false]])
      await db.doc('personal/' + uid).set({ nombre: uid, rol, activo });
    await db.doc('clientes/c1').set({ nombre: 'Cliente' });
    await db.doc('cotizaciones/q1').set({ estado: 'aprobada', items: [], ordenId: '' });
    await db.doc('cotizaciones/q2').set({ estado: 'enviada', items: [] });
    await db.doc('ordenes/o1').set({ estado: 'en_reparacion', pagos: [{ monto: 50 }] });
    await db.doc('ordenes/o1/imagenes/firma').set({ data: IMG });
    await db.doc('publicas/tok').set({ estado: 'enviada', total: 100 });
    await db.doc('publicas/tok2').set({ estado: 'aprobada', total: 100 });
    await db.doc('repuestos/r1').set({ nombre: 'Filtro', stock: 5, costo: 4, precio: 9 });
    await db.doc('proveedores/p1').set({ nombre: 'Proveedor' });
    await db.doc('gastos/g1').set({ monto: 100, categoria: 'Renta' });
    await db.doc('movimientos/m1').set({ repuestoId: 'r1', tipo: 'entrada', cantidad: 5 });
  });
});
const as = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

test('configuración inicial: solo una vez y solo como administrador', async () => {
  await env.withSecurityRulesDisabled((c) => c.firestore().doc('config/setup').delete());
  const nuevo = as('nuevo');
  await assertFails(nuevo.doc('personal/nuevo').set({ rol: 'admin', activo: true }));
  const b = nuevo.batch();
  b.set(nuevo.doc('personal/nuevo'), { rol: 'admin', activo: true }); b.set(nuevo.doc('config/setup'), { owner: 'nuevo' });
  await assertSucceeds(b.commit());
  const otro = as('otro'), b2 = otro.batch();
  b2.set(otro.doc('personal/otro'), { rol: 'admin', activo: true }); b2.set(otro.doc('config/setup'), { owner: 'otro' });
  await assertFails(b2.commit());
  await assertSucceeds(as(null).doc('config/setup').get());
});

test('sin sesión, sin registro o desactivado: no ve nada', async () => {
  for (const u of [null, 'intruso', 'viejo']) {
    await assertFails(as(u).doc('clientes/c1').get());
    await assertFails(as(u).collection('cotizaciones').get());
    await assertFails(as(u).doc('repuestos/r1').get());
    await assertFails(as(u).collection('clientes').add({ nombre: 'x' }));
  }
});

test('roles: personal y configuración solo los cambia el administrador', async () => {
  await assertSucceeds(as('admin').doc('personal/nuevo').set({ rol: 'mecanico', activo: true }));
  await assertFails(as('ana').doc('personal/nuevo2').set({ rol: 'admin', activo: true }));
  await assertFails(as('carlos').doc('personal/carlos').update({ rol: 'admin' }));
  await assertFails(as('admin').doc('personal/admin').delete());
  await assertFails(as('ana').doc('config/taller').update({ nombre: 'X' }));
  await assertSucceeds(as('admin').doc('config/taller').update({ nombre: 'X' }));
  await assertFails(as('carlos').doc('clientes/c1').delete());
  await assertSucceeds(as('ana').doc('clientes/c1').delete());
  await assertFails(as('carlos').collection('otra').add({ x: 1 }));
});

test('cotizaciones y órdenes: aprobadas y pagos protegidos', async () => {
  await assertFails(as('carlos').doc('cotizaciones/q1').update({ items: [{ precio: 1 }] }));
  await assertSucceeds(as('carlos').doc('cotizaciones/q1').update({ ordenId: 'o1' }));
  await assertSucceeds(as('carlos').doc('cotizaciones/q2').update({ items: [{ precio: 1 }] }));
  await assertSucceeds(as('ana').doc('cotizaciones/q1').update({ items: [] }));
  await assertFails(as('carlos').doc('ordenes/o1').update({ pagos: [] }));
  await assertSucceeds(as('carlos').doc('ordenes/o1').update({ pagos: [{ monto: 50 }, { monto: 20 }], estado: 'terminado' }));
  await assertSucceeds(as('ana').doc('ordenes/o1').update({ pagos: [] }));
  await assertFails(as('carlos').doc('ordenes/o1').delete());
});

test('fotos y firmas: solo imágenes; firmas protegidas', async () => {
  await assertSucceeds(as('carlos').collection('ordenes/o1/imagenes').add({ data: IMG }));
  await assertFails(as('carlos').collection('ordenes/o1/imagenes').add({ data: 'data:text/html;base64,PHNjcmlwdD4=' }));
  await assertFails(as('carlos').collection('ordenes/o1/imagenes').add({ data: 'javascript:alert(1)' }));
  await assertFails(as('carlos').doc('ordenes/o1/imagenes/firma').delete());
  await assertFails(as('carlos').doc('ordenes/o1/imagenes/firma-entrega').set({ data: IMG }).then(() => as('carlos').doc('ordenes/o1/imagenes/firma-entrega').set({ data: IMG })));
  await assertSucceeds(as('ana').doc('ordenes/o1/imagenes/firma').delete());
});

test('enlace público: el cliente solo aprueba o rechaza una vez', async () => {
  const anon = as(null);
  await assertSucceeds(anon.doc('publicas/tok').get());
  await assertFails(anon.collection('publicas').get());
  await assertFails(anon.doc('publicas/tok').update({ estado: 'aprobada', total: 1, respondida: 'x' }));
  await assertFails(anon.doc('publicas/tok').update({ estado: 'pagada', respondida: 'x' }));
  await assertFails(anon.doc('publicas/tok').update({ estado: 'aprobada', respondida: 'x'.repeat(41) }));
  await assertFails(anon.doc('publicas/tok2').update({ estado: 'rechazada', respondida: 'x' }));
  await assertFails(anon.doc('publicas/nuevo').set({ estado: 'enviada' }));
  await assertFails(anon.doc('publicas/tok').delete());
  await assertSucceeds(anon.doc('publicas/tok').update({ estado: 'aprobada', respondida: new Date().toISOString() }));
});

test('citas y paquetes', async () => {
  await assertSucceeds(as('carlos').collection('citas').add({ fecha: '2026-12-01' }));
  await assertSucceeds(as('carlos').collection('paquetes').get());
  await assertFails(as('carlos').collection('paquetes').add({ nombre: 'x' }));
  await assertSucceeds(as('ana').collection('paquetes').add({ nombre: 'x' }));
});

test('inventario: el mecánico consulta y descuenta, pero no suma ni cambia precios', async () => {
  const mec = as('carlos');
  await assertSucceeds(mec.doc('repuestos/r1').get());
  await assertFails(mec.collection('repuestos').add({ nombre: 'x', stock: 1 }));
  await assertFails(mec.doc('repuestos/r1').update({ precio: 1 }));
  await assertFails(mec.doc('repuestos/r1').update({ stock: 50 }));
  await assertFails(mec.doc('repuestos/r1').update({ stock: 3, costo: 0 }));
  await assertSucceeds(mec.doc('repuestos/r1').update({ stock: 3 }));
  await assertFails(mec.doc('repuestos/r1').delete());
  await assertSucceeds(mec.collection('movimientos').add({ repuestoId: 'r1', tipo: 'salida', cantidad: 2 }));
  await assertFails(mec.collection('movimientos').add({ repuestoId: 'r1', tipo: 'entrada', cantidad: 99 }));
  await assertFails(mec.doc('movimientos/m1').update({ cantidad: 0 }));
  await assertFails(as('ana').doc('movimientos/m1').delete());
  await assertSucceeds(as('admin').doc('movimientos/m1').delete());
  await assertSucceeds(as('ana').doc('repuestos/r1').update({ stock: 20, precio: 10 }));
});

test('gastos solo para administración y recepción; proveedores los edita recepción', async () => {
  await assertFails(as('carlos').doc('gastos/g1').get());
  await assertFails(as('carlos').collection('gastos').get());
  await assertFails(as('carlos').collection('gastos').add({ monto: 1 }));
  await assertSucceeds(as('ana').collection('gastos').get());
  await assertSucceeds(as('ana').collection('gastos').add({ monto: 30, categoria: 'Luz y agua' }));
  await assertSucceeds(as('admin').doc('gastos/g1').delete());
  await assertSucceeds(as('carlos').doc('proveedores/p1').get());
  await assertFails(as('carlos').doc('proveedores/p1').update({ nombre: 'x' }));
  await assertSucceeds(as('ana').doc('proveedores/p1').update({ telefono: '503' }));
});

test('ataques: escalar privilegios, saltarse la configuración y tocar datos ajenos', async () => {
  const anon = as(null), intruso = as('intruso'), viejo = as('viejo'), mec = as('carlos');
  // Crear un administrador falso después de la configuración inicial
  await assertFails(intruso.doc('personal/intruso').set({ rol: 'admin', activo: true }));
  const b = intruso.batch(); b.set(intruso.doc('personal/intruso'), { rol: 'admin', activo: true }); b.set(intruso.doc('config/setup'), { owner: 'intruso' });
  await assertFails(b.commit());
  // Reactivarse a sí mismo
  await assertFails(viejo.doc('personal/viejo').update({ activo: true }));
  // Leer la lista de personal o la configuración sin cuenta
  await assertFails(anon.collection('personal').get());
  await assertFails(anon.doc('config/taller').get());
  // Listar todas las cotizaciones públicas para adivinar enlaces
  await assertFails(anon.collection('publicas').get());
  // Cambiar el total en el enlace público
  await assertFails(anon.doc('publicas/tok').update({ total: 0 }));
  // Inyectar HTML como "foto"
  await assertFails(mec.collection('ordenes/o1/imagenes').add({ data: 'data:image/svg+xml;base64,PHN2Zz4=' }));
  // Borrar pagos ya registrados
  await assertFails(mec.doc('ordenes/o1').update({ pagos: [{ monto: 1 }] }));
  // Ver los gastos y la ganancia del taller siendo mecánico
  await assertFails(mec.collection('gastos').get());
  // Inflar existencias o registrar entradas falsas
  await assertFails(mec.doc('repuestos/r1').update({ stock: 999 }));
  await assertFails(mec.collection('movimientos').add({ tipo: 'ajuste', cantidad: 999 }));
  // Escribir en una colección inventada
  await assertFails(mec.doc('secretos/x').set({ a: 1 }));
  await assertFails(anon.doc('secretos/x').get());
  // Usuario desactivado intenta seguir trabajando
  await assertFails(viejo.doc('ordenes/o1').update({ estado: 'entregado' }));
  // Mecánico se sube el rol
  await assertFails(mec.doc('personal/carlos').update({ rol: 'admin' }));
  // Operaciones legítimas que sí deben funcionar
  await assertSucceeds(mec.doc('ordenes/o1').update({ estado: 'terminado' }));
  await assertSucceeds(anon.doc('publicas/tok').update({ estado: 'rechazada', respondida: 'hoy' }));
});
