// Earlier features that the inventory package touches: short link approval, PDFs, Excel backup and the mobile menu.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('./comun');

let b, srv, ctx, page;
const errores = [];
const doc = (p) => page.evaluate(async (p) => (await S.db.doc(p).get()).data(), p);
// Capture the PDF blob instead of offering it to the user.
const pdf = async (fn, nombre) => {
  const b64 = await page.evaluate(async (fn) => {
    let out; window.offerPdf = (d) => { out = d.output('blob'); };
    await (0, eval)(fn)();
    const buf = new Uint8Array(await out.arrayBuffer()); let s = ''; buf.forEach((x) => { s += String.fromCharCode(x); }); return btoa(s);
  }, fn);
  const f = path.join(C.SALIDA, nombre); fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  return execFileSync('python3', ['-c', 'import sys,fitz; d=fitz.open(sys.argv[1]); print(d.page_count); print("".join(p.get_text() for p in d))', f]).toString();
};

before(async () => {
  await C.reiniciarEmulador();
  srv = C.servidor(5182); b = await C.navegador();
  ctx = await C.contexto(b); page = await ctx.newPage(); C.vigilarErrores(page, errores, 'admin: ');
  await C.configurarAdmin(page, srv.url);
  await C.sembrar(page, await C.fotoEjemplo(b));
  await page.reload(); await page.waitForSelector('#auth', { state: 'hidden' }); await page.waitForTimeout(1500);
});
after(async () => { await b?.close(); srv?.cerrar(); });

test('enlace corto: el cliente aprueba y la orden pasa a reparación', async () => {
  const link = await page.evaluate(async () => { const q = S.cotizaciones.find((x) => x.id === 'q3'); await publishQuote(q, 'enviada'); return quoteLink(q); });
  assert.match(link, /\/q\/muestraMUE01$/);
  const anon = await (await C.contexto(b, { viewport: { width: 390, height: 844 } })).newPage(); C.vigilarErrores(anon, errores, 'cliente: ');
  await anon.goto(link); await anon.waitForSelector('#pub-ok');
  assert.match(await anon.innerText('body'), /COT-0003/);
  await anon.click('#pub-ok'); await anon.click('.box .btn:has-text("Sí, aprobar")');
  await anon.waitForSelector('text=Aprobaste esta cotización');
  await page.waitForTimeout(2500);
  assert.equal((await doc('cotizaciones/q3')).estado, 'aprobada');
  assert.equal((await doc('ordenes/o3')).estado, 'en_reparacion');
  await anon.context().close();
});

test('PDF de cotización con líneas del inventario', async () => {
  const t = await pdf("() => quotePdf(S.cotizaciones.find((q) => q.id === 'q2'))", 'cotizacion.pdf');
  assert.match(t, /COTIZACIÓN/); assert.match(t, /Pastillas de freno delanteras/); assert.match(t, /\$1\d\d\.\d\d/);
  assert.equal(t.split('\n')[0], '1');
});

test('Respaldo en Excel con las hojas de inventario y gastos', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => { go('ajustes'); })
    .then(() => page.click('#bk-xlsx'))]);
  const f = path.join(C.SALIDA, 'respaldo.xlsx'); await dl.saveAs(f);
  const out = execFileSync('python3', ['-c', 'import sys,openpyxl; w=openpyxl.load_workbook(sys.argv[1]); print("|".join(w.sheetnames)); s=w["Inventario"]; print(s.max_row); print(w["Gastos"].max_row)', f]).toString().split('\n');
  for (const h of ['Inventario', 'Movimientos', 'Gastos', 'Proveedores']) assert.ok(out[0].split('|').includes(h), 'falta ' + h + ' en ' + out[0]);
  assert.equal(Number(out[1]), 6); assert.equal(Number(out[2]), 4);
});

test('menú del celular incluye Inventario', async () => {
  const m = await (await C.contexto(b, { viewport: { width: 390, height: 844 } })).newPage();
  await C.entrar(m, srv.url, 'ana@taller.test', 'recepcion12');
  await m.click('#menu-btn');
  await m.click('nav >> text=Inventario'); await m.waitForSelector('[data-open-repuesto]');
  const w = await m.evaluate(() => document.documentElement.scrollWidth); assert.ok(w <= 390, 'sin scroll horizontal: ' + w);
  await m.context().close();
});

test('el menú de escritorio cabe completo en cualquier ancho', async () => {
  for (const width of [1321, 1400, 1500, 1920]) {
    await page.setViewportSize({ width, height: 860 }); await page.waitForTimeout(200);
    const r = await page.evaluate(() => { const n = document.querySelector('#nav-wrap'), tabs = [...n.querySelectorAll('.tab')]; const last = tabs[tabs.length - 1].getBoundingClientRect(), box = n.getBoundingClientRect();
      return { fits: n.scrollWidth <= n.clientWidth + 1 && last.right <= box.right + 1, menu: getComputedStyle(document.querySelector('#menu-btn')).display }; });
    assert.ok(r.fits, `a ${width}px se corta el menú`); assert.equal(r.menu, 'none');
  }
  await page.setViewportSize({ width: 1280, height: 860 });
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('#menu-btn')).display), 'none');
});

test('sin errores en la consola', () => assert.deepEqual(errores, []));
