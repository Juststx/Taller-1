// Screenshots of the inventory and expenses screens with the sample workshop (npm run capturas).
const path = require('path');
const C = require('./comun');

(async () => {
  await C.reiniciarEmulador();
  const srv = C.servidor(5183), b = await C.navegador();
  const ctx = await C.contexto(b, { deviceScaleFactor: 2 }), page = await ctx.newPage();
  await C.configurarAdmin(page, srv.url);
  await C.sembrar(page, await C.fotoEjemplo(b));
  await page.reload(); await page.waitForSelector('#auth', { state: 'hidden' }); await page.waitForTimeout(2000);
  // A purchase and a delivered order so the reports have real numbers.
  await page.evaluate(async () => {
    const o = S.ordenes.find((x) => x.id === 'o2');
    await setOrderState(o, 'entregado');
    await S.db.doc('ordenes/o2').update({ pagos: [...o.pagos, { monto: 89.48, metodo: 'efectivo', nota: 'Saldo', fecha: new Date().toISOString(), por: S.myId }] });
  });
  await page.waitForTimeout(1200);
  const shot = async (nombre, sel) => { await page.waitForTimeout(500); await page.evaluate(() => { document.querySelector('#toast').hidden = true; }); await (sel ? page.locator(sel) : page).screenshot({ path: path.join(C.SALIDA, nombre + '.png') }); C.log(nombre); };

  await page.evaluate(() => go('inicio')); await shot('1-inicio-alerta');
  await page.evaluate(() => go('inventario')); await page.waitForSelector('[data-open-repuesto]'); await shot('2-inventario');
  await page.click('[data-open-repuesto="r1"]'); await page.waitForSelector('#layer .sheet [data-ajuste]'); await shot('3-repuesto-kardex');
  await page.evaluate(() => closeSheet());
  await page.click('[data-act=new-compra]'); await page.waitForSelector('#c-items');
  await page.selectOption('#c-prov', 'pr1'); await page.fill('#c-factura', 'F-1001');
  await page.selectOption('#c-items tr:nth-child(1) [data-k=rep]', 'r3'); await page.fill('#c-items tr:nth-child(1) [data-k=cant]', '12');
  await page.click('#layer .sheet [data-add]'); await page.selectOption('#c-items tr:nth-child(2) [data-k=rep]', 'r5'); await page.fill('#c-items tr:nth-child(2) [data-k=cant]', '2');
  await shot('4-registrar-compra');
  await page.click('#layer .sheet [data-save]'); await page.waitForTimeout(1200);
  await page.evaluate(() => editQuote(S.cotizaciones.find((q) => q.id === 'q4'))); await page.waitForSelector('#f-repuesto');
  await page.selectOption('#f-repuesto', 'r2'); await page.fill('#layer tbody tr:last-child [data-k=cantidad]', '5');
  await page.selectOption('#f-repuesto', 'r3'); await page.dispatchEvent('#layer .sheet', 'input');
  await page.evaluate(() => { const s = document.querySelector('#layer .sheet-body'); s.scrollTop = s.scrollHeight; });
  await shot('5-cotizacion-del-inventario');
  await page.evaluate(() => closeSheet());
  await page.evaluate(() => go('reportes')); await page.waitForSelector('text=Ganancia del mes');
  await page.setViewportSize({ width: 1280, height: 1000 }); await shot('6-reportes-ganancia');
  await page.evaluate(() => showProveedores()); await page.waitForSelector('text=Repuestos El Pino'); await shot('7-proveedores');
  await page.evaluate(() => closeSheet());

  const m = await (await C.contexto(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  await C.entrar(m, srv.url, 'admin@taller.test', 'secreto12');
  await m.evaluate(() => go('inventario')); await m.waitForSelector('[data-open-repuesto]'); await m.waitForTimeout(600);
  await m.screenshot({ path: path.join(C.SALIDA, '8-movil-inventario.png') }); C.log('8-movil-inventario');
  await m.evaluate(() => go('reportes')); await m.waitForSelector('text=Ganancia del mes'); await m.waitForTimeout(600);
  await m.screenshot({ path: path.join(C.SALIDA, '9-movil-ganancia.png') }); C.log('9-movil-ganancia');
  await b.close(); srv.cerrar();
})().catch((e) => { console.error(e); process.exit(1); });
