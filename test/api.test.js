const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

let server;
let base;
const sentMail = [];

before(async () => {
  const db = openDb(':memory:');
  const mailer = { enabled: true, send: async (msg) => { sentMail.push(msg); } };
  const app = createApp({ db, mailer, publicUrl: 'http://taller.test' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function client() {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

const admin = client();
const mechanic = client();
let clientId;
let vehicleId;
let quote;

test('initial setup creates the admin and only works once', async () => {
  assert.deepEqual((await admin('/api/setup')).body, { needsSetup: true });
  const res = await admin('/api/setup', {
    method: 'POST', body: { name: 'Ana', email: 'ana@taller.com', password: 'secreto1', workshop_name: 'Taller Ana' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.role, 'admin');
  assert.equal((await admin('/api/setup', { method: 'POST', body: { name: 'X', email: 'x@x.com', password: 'secreto1' } })).status, 409);
  assert.equal((await admin('/api/settings')).body.workshop_name, 'Taller Ana');
});

test('requires authentication', async () => {
  assert.equal((await client()('/api/clients')).status, 401);
});

test('admin creates users and roles are enforced', async () => {
  const res = await admin('/api/users', { method: 'POST', body: { name: 'Luis', email: 'luis@taller.com', password: 'mecanico', role: 'mecanico' } });
  assert.equal(res.status, 201);
  assert.equal((await admin('/api/users', { method: 'POST', body: { name: 'Otro', email: 'LUIS@taller.com', password: 'mecanico' } })).status, 409);

  assert.equal((await mechanic('/api/login', { method: 'POST', body: { email: 'luis@taller.com', password: 'mal' } })).status, 401);
  assert.equal((await mechanic('/api/login', { method: 'POST', body: { email: 'luis@taller.com', password: 'mecanico' } })).status, 200);
  assert.equal((await mechanic('/api/users')).status, 403);
});

test('registers clients and vehicles', async () => {
  const c = await mechanic('/api/clients', { method: 'POST', body: { name: 'Carlos Pérez', phone: '+57 300 123 4567', email: 'carlos@mail.com' } });
  assert.equal(c.status, 201);
  clientId = c.body.id;

  const v = await mechanic('/api/vehicles', { method: 'POST', body: { client_id: clientId, plate: 'abc123', make: 'Toyota', model: 'Corolla', year: 2018 } });
  assert.equal(v.status, 201);
  vehicleId = v.body.id;
  assert.equal((await mechanic('/api/vehicles', { method: 'POST', body: { client_id: clientId, plate: 'ABC123', make: 'X', model: 'Y' } })).status, 409);

  const detail = await mechanic(`/api/clients/${clientId}`);
  assert.equal(detail.body.vehicles[0].plate, 'ABC123');
  assert.equal((await mechanic('/api/vehicles?q=corolla')).body.length, 1);
  assert.equal((await mechanic(`/api/clients/${clientId}`, { method: 'DELETE' })).status, 403);
});

test('creates a quote and computes totals', async () => {
  const res = await mechanic('/api/quotes', {
    method: 'POST',
    body: {
      client_id: clientId,
      vehicle_id: vehicleId,
      tax_rate: 19,
      discount: 10,
      items: [
        { kind: 'mano_obra', description: 'Cambio de pastillas', quantity: 1, unit_price: 50 },
        { kind: 'repuesto', description: 'Pastillas de freno', quantity: 2, unit_price: 30.5 },
      ],
    },
  });
  assert.equal(res.status, 201);
  quote = res.body;
  assert.equal(quote.number, 'COT-00001');
  assert.equal(quote.status, 'borrador');
  assert.equal(quote.subtotal, 111);
  assert.equal(quote.tax, 19.19);
  assert.equal(quote.total, 120.19);
  assert.match(quote.valid_until, /^\d{4}-\d{2}-\d{2}$/);
});

test('rejects a vehicle that belongs to another client', async () => {
  const other = await mechanic('/api/clients', { method: 'POST', body: { name: 'Otra persona' } });
  const res = await mechanic('/api/quotes', { method: 'POST', body: { client_id: other.body.id, vehicle_id: vehicleId, items: [] } });
  assert.equal(res.status, 400);
});

test('sends the quote by email and returns a WhatsApp link', async () => {
  const res = await mechanic(`/api/quotes/${quote.id}/send`, { method: 'POST', body: { channel: 'email', message: 'Hola' } });
  assert.equal(res.status, 200);
  assert.equal(sentMail.length, 1);
  assert.equal(sentMail[0].to, 'carlos@mail.com');
  assert.match(sentMail[0].html, /COT-00001/);
  assert.equal(res.body.link, `http://taller.test/c/${quote.public_token}`);
  assert.match(res.body.whatsapp_url, /^https:\/\/wa\.me\/573001234567\?text=/);
  assert.equal((await mechanic(`/api/quotes/${quote.id}`)).body.status, 'enviada');
});

test('client views and approves the quote through the public link', async () => {
  const anon = client();
  const view = await anon(`/api/public/quotes/${quote.public_token}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.total, 120.19);
  assert.equal(view.body.client.email, undefined, 'public view must not leak contact data');

  assert.equal((await anon(`/api/public/quotes/${quote.public_token}/respond`, { method: 'POST', body: { decision: 'aprobada' } })).status, 200);
  assert.equal((await anon(`/api/public/quotes/${quote.public_token}/respond`, { method: 'POST', body: { decision: 'rechazada' } })).status, 409);
  assert.equal((await mechanic(`/api/quotes/${quote.id}`)).body.status, 'aprobada');
  assert.equal((await mechanic(`/api/quotes/${quote.id}`, { method: 'PUT', body: { client_id: clientId, items: [] } })).status, 409);
  assert.equal((await anon('/api/public/quotes/no-existe')).status, 404);
});

test('dashboard summarizes the workshop', async () => {
  const d = (await admin('/api/dashboard')).body;
  assert.equal(d.clients, 2);
  assert.equal(d.vehicles, 1);
  assert.equal(d.quotes.aprobada, 1);
  assert.equal(d.approved_total, 120.19);
});
