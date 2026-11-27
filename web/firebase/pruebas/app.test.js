// Browser test of the inventory and expenses package against the emulators, with the real security headers.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const C = require('./comun');

let b, srv, ctx, page, photo;
const errores = [];
const doc = (p) => page.evaluate(async (p) => { const s = await S.db.doc(p).get(); return s.exists ? s.data() : null; }, p);
const movs = (rid) => page.evaluate(async (rid) => (await S.db.collection('movimientos').where('repuestoId', '==', rid).get()).docs.map((d) => d.data()), rid);
const sheet = '#layer .sheet';

before(async () => {
  await C.reiniciarEmulador();
  srv = C.servidor(5181); b = await C.navegador(); photo = await C.fotoEjemplo(b);
  ctx = await C.contexto(b); page = await ctx.newPage(); C.vigilarErrores(page, errores, 'admin: ');
  await C.configurarAdmin(page, srv.url);
  await C.sembrar(page, photo);
  await page.reload(); await page.waitForSelector('#auth', { state: 'hidden' }); await page.waitForTimeout(1500);
});
after(async () => { await b?.close(); srv?.cerrar(); });

test('Inicio avisa de los repuestos por agotarse', async () => {
  await page.evaluate(() => go('inicio')); await page.waitForTimeout(400);
  const t = await page.textContent('[data-part=alertas]');
  assert.match(t, /2 repuestos|Filtro de aceite/);
});

test('Inventario: lista, existencias bajas y filtro', async () => {
  await page.evaluate(() => go('inventario')); await page.waitForSelector('[data-open-repuesto]');
  assert.equal(await page.locator('[data-open-repuesto]').count(), 5);
  assert.match(await page.textContent('[data-part=stats]'), /Por agotarse\s*2/);
  await page.selectOption('#q-inv-f', 'bajo');
  assert.equal(await page.locator('[data-open-repuesto]').count(), 2);
  await page.selectOption('#q-inv-f', '');
  await page.fill('#q-inv', 'frenos');
  assert.equal(await page.locator('[data-open-repuesto]').count(), 2);
  await page.fill('#q-inv', ''); await page.dispatchEvent('#q-inv', 'input');
});

test('Registrar compra: suben existencias, cambia el costo y queda el gasto', async () => {
  await page.click('[data-act=new-compra]'); await page.waitForSelector('#c-items');
  await page.selectOption('#c-prov', 'pr1');
  await page.fill('#c-factura', 'F-1001');
  await page.selectOption('#c-items tr:nth-child(1) [data-k=rep]', 'r3');
  assert.equal(await page.inputValue('#c-items tr:nth-child(1) [data-k=costo]'), '4.25');
  await page.fill('#c-items tr:nth-child(1) [data-k=cant]', '10');
  await page.fill('#c-items tr:nth-child(1) [data-k=costo]', '4.5');
  await page.click(`${sheet} [data-add]`);
  await page.selectOption('#c-items tr:nth-child(2) [data-k=rep]', 'r5');
  await page.fill('#c-items tr:nth-child(2) [data-k=cant]', '2');
  assert.equal(await page.textContent('#c-total'), '$201.00');
  await page.click(`${sheet} [data-save]`); await page.waitForSelector(sheet, { state: 'detached' });
  const r3 = await doc('repuestos/r3'), r5 = await doc('repuestos/r5');
  assert.equal(r3.stock, 13); assert.equal(r3.costo, 4.5); assert.equal(r5.stock, 2); assert.equal(r5.costo, 78);
  const g = await page.evaluate(async () => (await S.db.collection('gastos').where('categoria', '==', 'Repuestos (compras)').get()).docs.map((d) => d.data()));
  assert.equal(g.length, 1); assert.equal(g[0].monto, 201); assert.match(g[0].descripcion, /F-1001 · Repuestos El Pino/); assert.equal(g[0].items.length, 2);
  assert.ok((await movs('r3')).some((m) => m.tipo === 'entrada' && m.cantidad === 10 && /F-1001/.test(m.nota)));
});

test('Kardex del repuesto y ajuste por conteo físico', async () => {
  await page.click('[data-open-repuesto="r2"]'); await page.waitForSelector(`${sheet} [data-ajuste]`);
  assert.match(await page.textContent(sheet), /Inventario inicial/);
  await page.click(`${sheet} [data-ajuste]`); await page.fill('#a-real', '22'); await page.fill('#a-nota', 'Conteo de fin de mes');
  await page.click(`${sheet} [data-save]`); await page.waitForTimeout(800);
  assert.equal((await doc('repuestos/r2')).stock, 22);
  assert.ok((await movs('r2')).some((m) => m.tipo === 'ajuste' && m.cantidad === -2));
  assert.match(await page.textContent(sheet), /Conteo de fin de mes/);
  await page.evaluate(() => closeSheet());
});

test('Nuevo repuesto con existencias iniciales', async () => {
  await page.click('[data-act=new-repuesto]'); await page.waitForSelector('#f-nombre');
  await page.fill('#f-nombre', 'Bujía iridio'); await page.fill('#f-codigo', 'BJ-IR'); await page.fill('#f-categoria', 'Encendido');
  await page.fill('#f-costo', '7'); await page.fill('#f-precio', '12.5'); await page.fill('#f-stock', '8'); await page.fill('#f-minimo', '4');
  assert.match(await page.textContent('#f-margen'), /\$5\.50/);
  await page.click(`${sheet} [data-save]`); await page.waitForSelector(`${sheet} [data-ajuste]`);
  const id = await page.evaluate(() => S.repuestos.find((r) => r.codigo === 'BJ-IR')?.id);
  assert.ok(id); assert.equal((await movs(id)).length, 1);
  await page.evaluate(() => closeSheet());
});

test('Cotización: “+ Del inventario” agrega la línea con su precio y la enlaza', async () => {
  await page.evaluate(() => editQuote(S.cotizaciones.find((q) => q.id === 'q4'))); await page.waitForSelector('#f-repuesto');
  await page.selectOption('#f-repuesto', 'r2');
  const last = '#layer tbody tr:last-child';
  assert.match(await page.inputValue(`${last} [data-k=desc]`), /Aceite sintético/);
  assert.equal(await page.inputValue(`${last} [data-k=precio]`), '11');
  await page.fill(`${last} [data-k=cantidad]`, '5');
  await page.click(`${sheet} [data-save]`); await page.waitForTimeout(1000);
  const q = await doc('cotizaciones/q4');
  const it = q.items.find((i) => i.repuestoId === 'r2');
  assert.ok(it, 'la línea debe guardar repuestoId'); assert.equal(it.precio, 11); assert.equal(it.cantidad, 5);
  assert.ok(q.items.filter((i) => i.repuestoId === undefined || i.repuestoId).every((i) => !('repuestoId' in i) || i.repuestoId), 'sin repuestoId vacío');
  await page.evaluate(() => closeSheet());
});

test('Entregar la orden descuenta los repuestos una sola vez', async () => {
  await page.evaluate(() => editDelivery(S.ordenes.find((o) => o.id === 'o2'))); await page.waitForSelector('#d-nombre');
  await page.click(`${sheet} [data-save]`); await page.waitForTimeout(1500);
  assert.equal((await doc('repuestos/r1')).stock, 5);
  assert.equal((await doc('repuestos/r4')).stock, 6);
  const o2 = await doc('ordenes/o2'); assert.equal(o2.estado, 'entregado'); assert.equal(o2.inventarioDescontado, true);
  assert.ok((await movs('r4')).some((m) => m.tipo === 'salida' && m.cantidad === 2 && m.ordenId === 'o2'));
  await page.evaluate(() => descontarInventario(S.ordenes.find((o) => o.id === 'o2')));
  await page.waitForTimeout(500);
  assert.equal((await doc('repuestos/r1')).stock, 5);
  await page.evaluate(() => closeSheet());
});

test('Reportes: ganancia del mes con gastos y costo de repuestos usados', async () => {
  await page.evaluate(() => { S.q.mes = ''; go('reportes'); }); await page.waitForSelector('text=Ganancia del mes');
  // Seed + this run: payments $394.65; expenses 450 + 62.40 + 29.99 + purchase 201 = 743.39.
  const t = (await page.textContent('[data-part=rep]')).replace(/\s+/g, ' ');
  assert.match(t, /Entró \(cobrado\) ?\$394\.65/);
  assert.match(t, /Salió \(gastos\) ?\$743\.39/);
  assert.match(t, /Ganancia ?-\$348\.74/);
  assert.match(t, /Costo de repuestos usados ?\$42\.00/);
  assert.match(t, /Renta/);
  await page.click('[data-act=new-gasto]'); await page.waitForSelector('#g-monto');
  await page.selectOption('#g-cat', 'Sueldos'); await page.fill('#g-desc', 'Quincena Carlos'); await page.fill('#g-monto', '250');
  await page.click(`${sheet} [data-save]`); await page.waitForSelector(sheet, { state: 'detached' }); await page.waitForTimeout(800);
  assert.match((await page.textContent('[data-part=rep]')).replace(/\s+/g, ' '), /Salió \(gastos\) ?\$993\.39/);
  await page.click('[data-open-gasto]:has-text("Quincena")'); await page.waitForSelector('#g-monto');
  assert.equal(await page.inputValue('#g-monto'), '250'); await page.evaluate(() => closeSheet());
});

test('Proveedores: pedido por WhatsApp con lo que se está agotando', async () => {
  await page.evaluate(() => { go('inventario'); showProveedores(); }); await page.waitForSelector('text=Repuestos El Pino');
  // After the purchase only the battery (2 vs mínimo 1) is fine; the brake pads (5 vs 2) too — so make one run low.
  await page.evaluate(() => S.db.doc('repuestos/r4').update({ minimo: 10 })); await page.waitForTimeout(800);
  const href = await page.getAttribute('a:has-text("Pedir por WhatsApp")', 'href');
  assert.match(href, /^https:\/\/wa\.me\/50322220000\?text=/);
  assert.match(decodeURIComponent(href), /Líquido de frenos DOT 4/);
  await page.evaluate(() => closeSheet());
});

test('Buscador y respaldo incluyen el inventario', async () => {
  const r = await page.evaluate(() => searchAll('pastillas'));
  assert.ok((r.repuestos || []).length >= 1);
  const hojas = await page.evaluate(() => backupSheets().map((s) => s.name));
  for (const h of ['Inventario', 'Movimientos', 'Gastos', 'Proveedores']) assert.ok(hojas.includes(h), 'falta la hoja ' + h);
});

test('Mecánico: ve el inventario sin costos ni gastos, y al entregar descuenta', async () => {
  await page.evaluate(async () => {
    await S.db.doc('cotizaciones/q5').set({ numero: 'COT-0005', clienteId: 'c5', vehiculoId: 'v6', estado: 'aprobada', creada: new Date().toISOString(), impuesto: 13, descuento: 0, items: [{ tipo: 'repuesto', desc: 'Aceite', cantidad: 3, precio: 11, repuestoId: 'r2' }], ordenId: 'o4' });
    await S.db.doc('ordenes/o4').update({ cotizacionId: 'q5' });
  });
  const ctx2 = await C.contexto(b), p2 = await ctx2.newPage(), errs = [];
  C.vigilarErrores(p2, errs, 'mecánico: ');
  await C.entrar(p2, srv.url, 'carlos@taller.test', 'mecanico12');
  await p2.evaluate(() => go('inventario')); await p2.waitForSelector('[data-open-repuesto]');
  assert.equal(await p2.locator('[data-act=new-repuesto]').count(), 0);
  assert.doesNotMatch(await p2.textContent('[data-part=list] thead'), /Costo/);
  assert.doesNotMatch(await p2.textContent('[data-part=stats]'), /Valor del inventario/);
  await p2.evaluate(() => go('reportes')); await p2.waitForTimeout(600);
  assert.doesNotMatch(await p2.textContent('#view'), /Ganancia del mes/);
  await p2.evaluate(() => editDelivery(S.ordenes.find((o) => o.id === 'o4'))); await p2.waitForSelector('#d-nombre');
  await p2.click(`${sheet} [data-save]`); await p2.waitForTimeout(1500);
  assert.equal((await doc('repuestos/r2')).stock, 19);
  assert.equal((await doc('ordenes/o4')).inventarioDescontado, true);
  assert.doesNotMatch(await p2.innerText('body'), /No se pudo descontar/);
  assert.deepEqual(errs, []);
  await ctx2.close();
});

test('Sin errores en la consola ni bloqueos de la política de seguridad', () => {
  assert.deepEqual(errores, []);
});
