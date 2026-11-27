// Shared helpers for the browser tests: serve the site like Netlify (security headers + /q/* rewrite),
// point the page at the Firebase emulators, and feed it local copies of the Firebase SDK and jsPDF.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const NM = path.join(__dirname, 'node_modules');
const SALIDA = path.join(__dirname, 'salida');
fs.mkdirSync(SALIDA, { recursive: true });

// index.html talking to the emulators instead of the real project.
function paginaEmulador() {
  let src = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  const sw = (a, b) => { if (!src.includes(a)) throw new Error('No encontré en index.html: ' + a.slice(0, 60)); src = src.replace(a, b); };
  sw("  S.db = firebase.firestore();\n", "  S.db = firebase.firestore();\n  S.db.useEmulator('127.0.0.1', 8085); firebase.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true });\n");
  sw("  const sec = firebase.apps.find((a) => a.name === 'alta') || firebase.initializeApp(FIREBASE_CONFIG, 'alta');",
    "  const sec = firebase.apps.find((a) => a.name === 'alta') || firebase.initializeApp(FIREBASE_CONFIG, 'alta');\n  if (!sec.__emu) { sec.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true }); sec.__emu = true; }");
  sw("projectId: 'taller-automotriz-38ab1'", "projectId: 'demo-taller'");
  return src;
}
// The same _headers that empaquetar.py writes, with the emulator hosts allowed.
function cabeceras(html) {
  const tmp = path.join(SALIDA, 'index-emu.html');
  fs.writeFileSync(tmp, html);
  const out = execFileSync('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(RAIZ)}); import empaquetar; print(empaquetar.headers(open(${JSON.stringify(tmp)}).read(), ' http://127.0.0.1:8085 http://127.0.0.1:9099'))`]).toString();
  return out.split('\n').slice(1).map((l) => l.trim().match(/^([^:]+):\s(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]);
}

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
function servidor(puerto) {
  const html = paginaEmulador(), hs = cabeceras(html);
  const srv = http.createServer((q, r) => {
    let f = decodeURIComponent(q.url.split('?')[0]);
    if (f === '/' || /^\/q\//.test(f)) f = '/index.html';
    const file = path.join(RAIZ, f);
    if (f !== '/index.html' && (!file.startsWith(RAIZ) || !fs.existsSync(file) || fs.statSync(file).isDirectory() || f.includes('pruebas'))) { r.statusCode = 404; return r.end('no'); }
    hs.forEach(([k, v]) => r.setHeader(k, v));
    r.setHeader('content-type', TIPOS[path.extname(file)] || 'application/octet-stream');
    r.end(f === '/index.html' ? html : fs.readFileSync(file));
  }).listen(puerto);
  return { url: `http://localhost:${puerto}`, cerrar: () => srv.close() };
}

async function navegador() { return chromium.launch(); }
// A browser context with the local SDKs; service workers off except where a test turns them on.
async function contexto(b, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block', acceptDownloads: true, ...opts });
  await ctx.route(/gstatic\.com\/firebasejs\/10\.12\.2\/(.+\.js)$/, (rt) => rt.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(NM, 'firebase-compat-10', rt.request().url().match(/10\.12\.2\/(.+\.js)$/)[1])) }));
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/2\.5\.1\/jspdf\.umd\.min\.js/, (rt) => rt.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(NM, 'jspdf/dist/jspdf.umd.min.js')) }));
  await ctx.route(/wikipedia\.org/, (rt) => rt.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  return ctx;
}
function vigilarErrores(page, lista, etiqueta = '') {
  page.on('pageerror', (e) => lista.push(etiqueta + e.message));
  page.on('console', (m) => { if ((m.type() === 'error' || /Content Security Policy/.test(m.text())) && !/Failed to load resource|404/.test(m.text())) lista.push(etiqueta + m.text()); });
}
async function configurarAdmin(page, base, { taller = 'Taller Automotriz', nombre = 'Administrador', correo = 'admin@taller.test', clave = 'secreto12' } = {}) {
  await page.goto(base + '/'); await page.waitForSelector('#setup-form', { timeout: 20000 });
  await page.fill('#s-taller', taller); await page.fill('#s-nombre', nombre); await page.fill('#s-correo', correo); await page.fill('#s-clave', clave);
  await page.click('#setup-form button[type=submit]'); await page.waitForSelector('#auth', { state: 'hidden', timeout: 20000 });
}
async function entrar(page, base, correo, clave) {
  await page.goto(base + '/'); await page.waitForSelector('#login-form', { timeout: 20000 });
  await page.fill('#l-correo', correo); await page.fill('#l-clave', clave); await page.click('#login-form button[type=submit]');
  await page.waitForSelector('#auth', { state: 'hidden', timeout: 20000 }); await page.waitForTimeout(1000);
}
// A small JPEG to use as a reception photo.
async function fotoEjemplo(b) {
  const p = await b.newPage({ viewport: { width: 480, height: 360 } });
  await p.setContent('<body style="margin:0;background:linear-gradient(#9fb4c7,#dfe6ec 60%,#8a8f93 60%)"><svg viewBox="0 0 120 60" width="480" height="240" style="margin-top:70px"><path d="M6 44L6 35Q7 31 13 30L26 29L34 19Q36 17 41 17L66 17Q69 17 70 20L71 29L114 29L114 44Q114 46 112 46L101 46A10 10 0 0 0 81 46L41 46A10 10 0 0 0 21 46L8 46Q6 46 6 44Z" fill="#f4f5f3" stroke="#555"/><circle cx="31" cy="47" r="8" fill="#222"/><circle cx="91" cy="47" r="8" fill="#222"/></svg></body>');
  const buf = await p.screenshot({ type: 'jpeg', quality: 60 }); await p.close();
  fs.writeFileSync(path.join(SALIDA, 'foto.jpg'), buf);
  return 'data:image/jpeg;base64,' + buf.toString('base64');
}
// Fictitious sample workshop: staff, clients, vehicles, quotes, orders, appointments, packages, parts and expenses.
async function sembrar(page, photo) {
  await page.evaluate(async (photo) => {
    const now = Date.now(), day = (d) => new Date(now - d * 864e5).toISOString(), ymd = (d) => { const x = new Date(now + d * 864e5); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    await S.db.doc('config/taller').set({ ...S.config, nombre: 'Taller Automotriz', moneda: 'USD', unidad: 'mi', impuesto: 13, telefono: '+503 2200 0000', direccion: 'San Salvador', validez: 15, pie: 'Gracias por confiar en nosotros.' });
    const mec = await createAccount('carlos@taller.test', 'mecanico12');
    await S.db.doc('personal/' + mec).set({ nombre: 'Carlos Rivas', rol: 'mecanico', activo: true, correo: 'carlos@taller.test', telefono: '' });
    const rec = await createAccount('ana@taller.test', 'recepcion12');
    await S.db.doc('personal/' + rec).set({ nombre: 'Ana Gómez', rol: 'recepcion', activo: true, correo: 'ana@taller.test', telefono: '' });
    for (const [id, nombre, telefono] of [['c1', 'Carlos Hernández', '50370000001'], ['c2', 'María López', '50370000002'], ['c3', 'Transportes El Volcán', '50370000003'], ['c4', 'José Martínez', '50370000004'], ['c5', 'Sofía Castillo', '50370000005']])
      await S.db.doc('clientes/' + id).set({ nombre, telefono, correo: '', documento: '', direccion: 'San Salvador', notas: '', creado: day(60) });
    for (const [id, clienteId, placa, marca, modelo, anio, color, km, carroceria, unidad] of [['v1', 'c1', 'P123-456', 'Toyota', 'Hilux', 2021, 'Blanco', 68400, 'pickup', 'mi'], ['v2', 'c2', 'P456-789', 'Kia', 'Sportage', 2023, 'Rojo', 21500, 'suv', 'mi'],
      ['v3', 'c3', 'C789-012', 'Isuzu', 'NPR', 2019, 'Blanco', 154000, 'camion', 'km'], ['v4', 'c4', 'P234-567', 'Honda', 'Civic', 2018, 'Gris', 97300, 'sedan', 'mi'], ['v5', 'c2', 'P345-678', 'Mazda', 'CX-5', 2020, 'Azul', 55200, 'suv', 'mi'],
      ['v6', 'c5', 'P567-890', 'Nissan', 'Sentra', 2022, 'Plata', 33100, 'sedan', 'mi'], ['v7', 'c5', 'P678-901', 'Mitsubishi', 'Montero Sport', 2017, 'Negro', 121000, 'suv', 'km']])
      await S.db.doc('vehiculos/' + id).set({ clienteId, placa, marca, modelo, anio, color, km, carroceria, unidad, vin: '', notas: '', creado: day(50) });
    await S.db.doc('vehiculos/v4').update({ proximoServicio: { fecha: ymd(12), km: 100300, nota: 'Cambio de aceite y filtros', avisado: false } });
    await S.db.doc('proveedores/pr1').set({ nombre: 'Repuestos El Pino', contacto: 'Don Mario', telefono: '50322220000', notas: 'Entrega a domicilio' });
    const R = [['r1', 'Pastillas de freno delanteras', 'PF-0451', 'Frenos', 'juego', 6, 2, 32, 58], ['r2', 'Aceite sintético 5W-30', 'AC-530', 'Aceites', 'cuarto', 24, 10, 6.5, 11],
      ['r3', 'Filtro de aceite', 'FA-102', 'Filtros', 'unidad', 3, 4, 4.25, 9.5], ['r4', 'Líquido de frenos DOT 4', 'LF-DOT4', 'Frenos', 'unidad', 8, 3, 5, 9.75], ['r5', 'Batería 12V 60Ah', 'BT-60', 'Eléctrico', 'unidad', 0, 1, 78, 115]];
    for (const [id, nombre, codigo, categoria, unidad, stock, minimo, costo, precio] of R) {
      await S.db.doc('repuestos/' + id).set({ nombre, codigo, categoria, unidad, stock, minimo, costo, precio, proveedorId: 'pr1', ubicacion: 'Estante A', notas: '', activo: true, creado: day(40) });
      if (stock) await S.db.collection('movimientos').add({ repuestoId: id, tipo: 'entrada', cantidad: stock, costo, fecha: day(40), por: rec, nota: 'Inventario inicial' });
    }
    const Q = (n, cl, ve, estado, d, items, extra = {}) => S.db.doc('cotizaciones/q' + n).set({ numero: 'COT-000' + n, clienteId: cl, vehiculoId: ve, estado, creada: day(d), validez: ymd(15 - d), impuesto: 13, descuento: 0, notas: '', tecnico: '', items, creadaPor: S.myId, ...extra });
    await Q(1, 'c4', 'v4', 'aprobada', 9, [{ tipo: 'mano_obra', desc: 'Cambio de embrague', cantidad: 1, precio: 120 }, { tipo: 'repuesto', desc: 'Kit de embrague', cantidad: 1, precio: 185 }], { ordenId: 'o1', respondida: day(8) });
    await Q(2, 'c1', 'v1', 'aprobada', 3, [{ tipo: 'mano_obra', desc: 'Cambio de pastillas y rectificación de discos', cantidad: 1, precio: 65 }, { tipo: 'repuesto', desc: 'Pastillas de freno delanteras · PF-0451', cantidad: 1, precio: 58, repuestoId: 'r1' }, { tipo: 'repuesto', desc: 'Líquido de frenos DOT 4 · LF-DOT4', cantidad: 2, precio: 9.75, repuestoId: 'r4' }], { ordenId: 'o2', respondida: day(2) });
    await Q(3, 'c3', 'v3', 'enviada', 1, [{ tipo: 'mano_obra', desc: 'Servicio mayor 150,000 km', cantidad: 1, precio: 90 }, { tipo: 'repuesto', desc: 'Aceite 15W-40 (galón)', cantidad: 4, precio: 24.5 }], { ordenId: 'o3', enviada: day(1), token: 'muestraMUE01' });
    await Q(4, 'c2', 'v2', 'borrador', 0.2, [{ tipo: 'mano_obra', desc: 'Diagnóstico por escáner', cantidad: 1, precio: 25 }]);
    const O = (n, cl, ve, estado, d, extra) => S.db.doc('ordenes/o' + n).set({ numero: 'OT-000' + n, clienteId: cl, vehiculoId: ve, estado, creada: day(d), creadaPor: S.myId, tecnico: mec, motivo: '', prometida: ymd(2), pagos: [], historial: [{ estado: 'recibido', fecha: day(d), por: S.myId }], cotizacionId: '', ...extra });
    await O(1, 'c4', 'v4', 'entregado', 10, { cotizacionId: 'q1', entregada: day(6), motivo: 'El embrague patina.', pagos: [{ monto: 344.65, metodo: 'tarjeta', nota: '', fecha: day(6), por: rec }] });
    await O(2, 'c1', 'v1', 'en_reparacion', 3, { cotizacionId: 'q2', motivo: 'Ruido al frenar y vibración en el volante.', pagos: [{ monto: 50, metodo: 'efectivo', nota: 'Anticipo', fecha: day(2), por: rec }],
      historial: [{ estado: 'recibido', fecha: day(3), por: rec }, { estado: 'diagnostico', fecha: day(3), por: mec }, { estado: 'en_reparacion', fecha: day(2), por: mec }],
      recepcion: { km: 68420, unidad: 'mi', combustible: 3, checklist: { luces: 'ok', llantas: 'mal', repuesto: 'ok', herramientas: 'ok', espejos: 'ok', parabrisas: 'ok', carroceria: 'mal', llaves: 'ok' }, obs: 'Rayón en puerta trasera derecha. Llanta delantera izquierda gastada.', firmante: 'Carlos Hernández', fotos: 2, firma: false, fecha: day(3), por: rec } });
    await S.db.collection('ordenes/o2/imagenes').add({ tipo: 'foto', data: photo, creada: day(3) });
    await S.db.collection('ordenes/o2/imagenes').add({ tipo: 'foto', data: photo, creada: day(3) });
    await O(3, 'c3', 'v3', 'esperando_aprobacion', 1, { cotizacionId: 'q3', motivo: 'Servicio mayor de flota.' });
    await O(4, 'c5', 'v6', 'terminado', 2, { motivo: 'Cambio de batería.' });
    await S.db.doc('paquetes/p1').set({ nombre: 'Mantenimiento 5,000 millas', items: [{ tipo: 'mano_obra', desc: 'Mano de obra mantenimiento', cantidad: 1, precio: 40 }, { tipo: 'repuesto', desc: 'Aceite sintético 5W-30', cantidad: 5, precio: 11 }, { tipo: 'repuesto', desc: 'Filtro de aceite', cantidad: 1, precio: 9.5 }] });
    await S.db.doc('paquetes/p2').set({ nombre: 'Alineación y balanceo', items: [{ tipo: 'mano_obra', desc: 'Alineación', cantidad: 1, precio: 25 }, { tipo: 'mano_obra', desc: 'Balanceo 4 llantas', cantidad: 1, precio: 20 }] });
    const Ci = (id, d, hora, cl, ve, motivo, estado = 'programada') => S.db.doc('citas/' + id).set({ fecha: ymd(d), hora, clienteId: cl, vehiculoId: ve, motivo, tecnico: mec, estado, creada: day(1), creadaPor: rec });
    await Ci('a1', 0, '08:30', 'c2', 'v5', 'Revisión de frenos', 'confirmada'); await Ci('a2', 0, '11:00', 'c5', 'v7', 'Mantenimiento 120,000 km');
    await Ci('a3', 1, '09:00', 'c4', 'v4', 'Cambio de aceite'); await Ci('a4', 3, '14:30', 'c1', 'v1', 'Alineación y balanceo');
    const G = (id, d, categoria, descripcion, monto, metodo = 'transferencia') => S.db.doc('gastos/' + id).set({ fecha: ymd(-d), categoria, descripcion, monto, metodo, por: S.myId, creada: day(d) });
    await G('g1', 1, 'Renta', 'Renta del local', 450); await G('g2', 2, 'Luz y agua', 'Recibo de luz', 62.4); await G('g3', 3, 'Internet y teléfono', 'Internet', 29.99);
  }, photo);
  await page.waitForTimeout(1500);
}
// Load the real firestore.rules into the emulator (and wipe its data) before a browser test.
async function reiniciarEmulador() {
  const rules = fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8');
  let r = await fetch('http://127.0.0.1:8085/emulator/v1/projects/demo-taller:securityRules', { method: 'PUT', body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: rules }] } }) });
  if (!r.ok) throw new Error('No se pudieron cargar las reglas: ' + await r.text());
  await fetch('http://127.0.0.1:8085/emulator/v1/projects/demo-taller/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-taller/accounts', { method: 'DELETE' });
}
const log = (...a) => console.log('  ›', ...a);

module.exports = { RAIZ, SALIDA, servidor, navegador, contexto, vigilarErrores, configurarAdmin, entrar, fotoEjemplo, sembrar, reiniciarEmulador, log };
