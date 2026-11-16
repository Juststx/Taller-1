const path = require('node:path');
const express = require('express');
const { transaction } = require('./db');
const {
  hashPassword, verifyPassword, randomToken, createSession, sessionCookie,
  loadUser, requireAuth, requireRole,
} = require('./auth');
const { quoteTotals, renderQuoteEmail, round2 } = require('./quotes');

const ROLES = ['admin', 'recepcion', 'mecanico'];
const QUOTE_STATUSES = ['borrador', 'enviada', 'aprobada', 'rechazada'];
const ITEM_KINDS = ['repuesto', 'mano_obra', 'otro'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const optStr = (v) => str(v) || null;
const optInt = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new HttpError(400, `Valor numérico inválido: ${v}`);
  return n;
};
const num = (v, field) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `El campo ${field} debe ser un número positivo`);
  return n;
};
const required = (value, label) => {
  if (!value) throw new HttpError(400, `El campo ${label} es obligatorio`);
  return value;
};
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

function createApp({ db, mailer, publicUrl, secureCookies = false }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(loadUser(db));

  const getSettings = () => Object.fromEntries(
    db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]),
  );
  const baseUrl = (req) => publicUrl || `${req.protocol}://${req.get('host')}`;

  // ---------- Auth ----------
  app.get('/api/setup', (_req, res) => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
    res.json({ needsSetup: n === 0 });
  });

  app.post('/api/setup', (req, res) => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
    if (n > 0) throw new HttpError(409, 'La configuración inicial ya fue realizada');
    const user = validateUser(req.body, { requirePassword: true });
    const id = Number(db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(user.name, user.email, hashPassword(user.password), 'admin').lastInsertRowid);
    if (req.body.workshop_name) {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'workshop_name'").run(str(req.body.workshop_name));
    }
    res.setHeader('Set-Cookie', sessionCookie(createSession(db, id), { secure: secureCookies }));
    res.status(201).json({ id, name: user.name, email: user.email, role: 'admin' });
  });

  app.post('/api/login', (req, res) => {
    const email = str(req.body.email);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(str(req.body.password), user.password_hash)) {
      throw new HttpError(401, 'Correo o contraseña incorrectos');
    }
    if (!user.active) throw new HttpError(403, 'Tu usuario está desactivado');
    res.setHeader('Set-Cookie', sessionCookie(createSession(db, user.id), { secure: secureCookies }));
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  });

  app.post('/api/logout', (req, res) => {
    if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
    res.setHeader('Set-Cookie', sessionCookie('', { clear: true, secure: secureCookies }));
    res.json({ ok: true });
  });

  app.get('/api/me', requireAuth, (req, res) => {
    res.json({ ...req.user, mailEnabled: mailer.enabled });
  });

  app.put('/api/me/password', requireAuth, (req, res) => {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(str(req.body.current_password), row.password_hash)) {
      throw new HttpError(400, 'La contraseña actual no es correcta');
    }
    const password = str(req.body.new_password);
    if (password.length < 6) throw new HttpError(400, 'La nueva contraseña debe tener al menos 6 caracteres');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), req.user.id);
    res.json({ ok: true });
  });

  // ---------- Users (admin) ----------
  function validateUser(body, { requirePassword }) {
    const user = {
      name: required(str(body.name), 'nombre'),
      email: required(str(body.email).toLowerCase(), 'correo'),
      role: str(body.role) || 'mecanico',
      password: str(body.password),
      active: body.active === undefined ? 1 : (body.active ? 1 : 0),
    };
    if (!isEmail(user.email)) throw new HttpError(400, 'Correo inválido');
    if (!ROLES.includes(user.role)) throw new HttpError(400, 'Rol inválido');
    if ((requirePassword || user.password) && user.password.length < 6) {
      throw new HttpError(400, 'La contraseña debe tener al menos 6 caracteres');
    }
    return user;
  }

  app.get('/api/users', requireRole('admin'), (_req, res) => {
    res.json(db.prepare('SELECT id, name, email, role, active, created_at FROM users ORDER BY name').all());
  });

  app.post('/api/users', requireRole('admin'), (req, res) => {
    const u = validateUser(req.body, { requirePassword: true });
    const result = db.prepare('INSERT INTO users (name, email, password_hash, role, active) VALUES (?, ?, ?, ?, ?)')
      .run(u.name, u.email, hashPassword(u.password), u.role, u.active);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });

  app.put('/api/users/:id', requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!existing) throw new HttpError(404, 'Usuario no encontrado');
    const u = validateUser(req.body, { requirePassword: false });
    if (id === req.user.id && (u.role !== 'admin' || !u.active)) {
      throw new HttpError(400, 'No puedes quitarte el rol de administrador ni desactivarte');
    }
    db.prepare('UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?')
      .run(u.name, u.email, u.role, u.active, id);
    if (u.password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(u.password), id);
    if (!u.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    res.json({ ok: true });
  });

  app.delete('/api/users/:id', requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'No puedes eliminar tu propio usuario');
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (!result.changes) throw new HttpError(404, 'Usuario no encontrado');
    res.json({ ok: true });
  });

  // ---------- Settings ----------
  app.get('/api/settings', requireAuth, (_req, res) => res.json(getSettings()));

  app.put('/api/settings', requireRole('admin'), (req, res) => {
    const current = getSettings();
    const update = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
    transaction(db, () => {
      for (const key of Object.keys(current)) {
        if (key in req.body) update.run(str(req.body[key]), key);
      }
    });
    res.json(getSettings());
  });

  // ---------- Clients ----------
  function validateClient(body) {
    const c = {
      name: required(str(body.name), 'nombre'),
      document: optStr(body.document),
      phone: optStr(body.phone),
      email: optStr(body.email),
      address: optStr(body.address),
      notes: optStr(body.notes),
    };
    if (c.email && !isEmail(c.email)) throw new HttpError(400, 'Correo inválido');
    return c;
  }

  app.get('/api/clients', requireAuth, (req, res) => {
    const q = `%${str(req.query.q)}%`;
    res.json(db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM vehicles v WHERE v.client_id = c.id) AS vehicle_count
      FROM clients c
      WHERE c.name LIKE ? OR IFNULL(c.document, '') LIKE ? OR IFNULL(c.phone, '') LIKE ? OR IFNULL(c.email, '') LIKE ?
      ORDER BY c.name`).all(q, q, q, q));
  });

  app.get('/api/clients/:id', requireAuth, (req, res) => {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(req.params.id));
    if (!client) throw new HttpError(404, 'Cliente no encontrado');
    client.vehicles = db.prepare('SELECT * FROM vehicles WHERE client_id = ? ORDER BY plate').all(client.id);
    client.quotes = listQuotes({ clientId: client.id });
    res.json(client);
  });

  app.post('/api/clients', requireAuth, (req, res) => {
    const c = validateClient(req.body);
    const result = db.prepare('INSERT INTO clients (name, document, phone, email, address, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(c.name, c.document, c.phone, c.email, c.address, c.notes);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });

  app.put('/api/clients/:id', requireAuth, (req, res) => {
    const c = validateClient(req.body);
    const result = db.prepare('UPDATE clients SET name = ?, document = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?')
      .run(c.name, c.document, c.phone, c.email, c.address, c.notes, Number(req.params.id));
    if (!result.changes) throw new HttpError(404, 'Cliente no encontrado');
    res.json({ ok: true });
  });

  app.delete('/api/clients/:id', requireRole('admin', 'recepcion'), (req, res) => {
    const id = Number(req.params.id);
    const used = db.prepare('SELECT (SELECT COUNT(*) FROM vehicles WHERE client_id = ?) + (SELECT COUNT(*) FROM quotes WHERE client_id = ?) AS n').get(id, id);
    if (used.n > 0) throw new HttpError(409, 'El cliente tiene vehículos o cotizaciones asociadas');
    const result = db.prepare('DELETE FROM clients WHERE id = ?').run(id);
    if (!result.changes) throw new HttpError(404, 'Cliente no encontrado');
    res.json({ ok: true });
  });

  // ---------- Vehicles ----------
  function validateVehicle(body) {
    const v = {
      client_id: required(optInt(body.client_id), 'cliente'),
      plate: required(str(body.plate).toUpperCase(), 'placa'),
      make: required(str(body.make), 'marca'),
      model: required(str(body.model), 'modelo'),
      year: optInt(body.year),
      color: optStr(body.color),
      vin: optStr(body.vin),
      mileage: optInt(body.mileage),
      notes: optStr(body.notes),
    };
    if (!db.prepare('SELECT id FROM clients WHERE id = ?').get(v.client_id)) throw new HttpError(400, 'El cliente no existe');
    return v;
  }

  app.get('/api/vehicles', requireAuth, (req, res) => {
    const q = `%${str(req.query.q)}%`;
    const params = [q, q, q, q];
    let where = '(v.plate LIKE ? OR v.make LIKE ? OR v.model LIKE ? OR c.name LIKE ?)';
    if (req.query.client_id) {
      where += ' AND v.client_id = ?';
      params.push(Number(req.query.client_id));
    }
    res.json(db.prepare(`
      SELECT v.*, c.name AS client_name FROM vehicles v JOIN clients c ON c.id = v.client_id
      WHERE ${where} ORDER BY v.plate`).all(...params));
  });

  app.get('/api/vehicles/:id', requireAuth, (req, res) => {
    const vehicle = db.prepare('SELECT v.*, c.name AS client_name FROM vehicles v JOIN clients c ON c.id = v.client_id WHERE v.id = ?')
      .get(Number(req.params.id));
    if (!vehicle) throw new HttpError(404, 'Vehículo no encontrado');
    vehicle.quotes = listQuotes({ vehicleId: vehicle.id });
    res.json(vehicle);
  });

  app.post('/api/vehicles', requireAuth, (req, res) => {
    const v = validateVehicle(req.body);
    const result = db.prepare(`INSERT INTO vehicles (client_id, plate, make, model, year, color, vin, mileage, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(v.client_id, v.plate, v.make, v.model, v.year, v.color, v.vin, v.mileage, v.notes);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });

  app.put('/api/vehicles/:id', requireAuth, (req, res) => {
    const v = validateVehicle(req.body);
    const result = db.prepare(`UPDATE vehicles SET client_id = ?, plate = ?, make = ?, model = ?, year = ?, color = ?,
      vin = ?, mileage = ?, notes = ? WHERE id = ?`)
      .run(v.client_id, v.plate, v.make, v.model, v.year, v.color, v.vin, v.mileage, v.notes, Number(req.params.id));
    if (!result.changes) throw new HttpError(404, 'Vehículo no encontrado');
    res.json({ ok: true });
  });

  app.delete('/api/vehicles/:id', requireRole('admin', 'recepcion'), (req, res) => {
    const result = db.prepare('DELETE FROM vehicles WHERE id = ?').run(Number(req.params.id));
    if (!result.changes) throw new HttpError(404, 'Vehículo no encontrado');
    res.json({ ok: true });
  });

  // ---------- Quotes ----------
  function listQuotes({ clientId, vehicleId, status, q } = {}) {
    const where = [];
    const params = [];
    if (clientId) { where.push('q.client_id = ?'); params.push(clientId); }
    if (vehicleId) { where.push('q.vehicle_id = ?'); params.push(vehicleId); }
    if (status) { where.push('q.status = ?'); params.push(status); }
    if (q) {
      where.push('(q.number LIKE ? OR c.name LIKE ? OR IFNULL(v.plate, \'\') LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const rows = db.prepare(`
      SELECT q.id, q.number, q.status, q.created_at, q.sent_at, q.valid_until, q.tax_rate, q.discount,
             c.name AS client_name, v.plate AS vehicle_plate,
             IFNULL((SELECT SUM(quantity * unit_price) FROM quote_items i WHERE i.quote_id = q.id), 0) AS subtotal
      FROM quotes q JOIN clients c ON c.id = q.client_id LEFT JOIN vehicles v ON v.id = q.vehicle_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY q.id DESC`).all(...params);
    return rows.map((r) => ({ ...r, total: quoteTotals(r.subtotal, r.discount, r.tax_rate).total }));
  }

  function getQuote(where, value) {
    const quote = db.prepare(`
      SELECT q.*, u.name AS created_by_name FROM quotes q LEFT JOIN users u ON u.id = q.created_by
      WHERE q.${where} = ?`).get(value);
    if (!quote) return null;
    quote.items = db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY position, id').all(quote.id);
    quote.client = db.prepare('SELECT * FROM clients WHERE id = ?').get(quote.client_id);
    quote.vehicle = quote.vehicle_id ? db.prepare('SELECT * FROM vehicles WHERE id = ?').get(quote.vehicle_id) : null;
    const subtotal = quote.items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
    Object.assign(quote, quoteTotals(subtotal, quote.discount, quote.tax_rate));
    return quote;
  }

  function validateQuote(body) {
    const settings = getSettings();
    const quote = {
      client_id: required(optInt(body.client_id), 'cliente'),
      vehicle_id: optInt(body.vehicle_id),
      tax_rate: num(body.tax_rate ?? settings.default_tax_rate, 'impuesto'),
      discount: num(body.discount, 'descuento'),
      notes: optStr(body.notes),
      valid_until: optStr(body.valid_until),
    };
    if (quote.tax_rate > 100) throw new HttpError(400, 'El impuesto no puede ser mayor a 100%');
    if (!db.prepare('SELECT id FROM clients WHERE id = ?').get(quote.client_id)) throw new HttpError(400, 'El cliente no existe');
    if (quote.vehicle_id) {
      const v = db.prepare('SELECT client_id FROM vehicles WHERE id = ?').get(quote.vehicle_id);
      if (!v) throw new HttpError(400, 'El vehículo no existe');
      if (v.client_id !== quote.client_id) throw new HttpError(400, 'El vehículo no pertenece al cliente');
    }
    if (quote.valid_until && !/^\d{4}-\d{2}-\d{2}$/.test(quote.valid_until)) throw new HttpError(400, 'Fecha de validez inválida');
    const items = Array.isArray(body.items) ? body.items : [];
    quote.items = items.map((item, idx) => {
      const kind = str(item.kind) || 'repuesto';
      if (!ITEM_KINDS.includes(kind)) throw new HttpError(400, 'Tipo de ítem inválido');
      return {
        kind,
        description: required(str(item.description), `descripción del ítem ${idx + 1}`),
        quantity: num(item.quantity ?? 1, 'cantidad'),
        unit_price: round2(num(item.unit_price, 'precio')),
        position: idx,
      };
    });
    return quote;
  }

  function saveItems(quoteId, items) {
    db.prepare('DELETE FROM quote_items WHERE quote_id = ?').run(quoteId);
    const insert = db.prepare('INSERT INTO quote_items (quote_id, kind, description, quantity, unit_price, position) VALUES (?, ?, ?, ?, ?, ?)');
    for (const i of items) insert.run(quoteId, i.kind, i.description, i.quantity, i.unit_price, i.position);
  }

  function defaultValidUntil() {
    const days = Number(getSettings().quote_validity_days) || 15;
    return new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  }

  app.get('/api/quotes', requireAuth, (req, res) => {
    res.json(listQuotes({ status: str(req.query.status) || null, q: str(req.query.q) || null }));
  });

  app.get('/api/quotes/:id', requireAuth, (req, res) => {
    const quote = getQuote('id', Number(req.params.id));
    if (!quote) throw new HttpError(404, 'Cotización no encontrada');
    quote.public_url = `${baseUrl(req)}/c/${quote.public_token}`;
    res.json(quote);
  });

  app.post('/api/quotes', requireAuth, (req, res) => {
    const q = validateQuote(req.body);
    const id = transaction(db, () => {
      const { next } = db.prepare('SELECT IFNULL(MAX(id), 0) + 1 AS next FROM quotes').get();
      const number = `COT-${String(next).padStart(5, '0')}`;
      const result = db.prepare(`INSERT INTO quotes (number, client_id, vehicle_id, tax_rate, discount, notes, valid_until, public_token, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(number, q.client_id, q.vehicle_id, q.tax_rate, q.discount, q.notes, q.valid_until || defaultValidUntil(), randomToken(), req.user.id);
      const quoteId = Number(result.lastInsertRowid);
      saveItems(quoteId, q.items);
      return quoteId;
    });
    res.status(201).json(getQuote('id', id));
  });

  app.put('/api/quotes/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT status FROM quotes WHERE id = ?').get(id);
    if (!existing) throw new HttpError(404, 'Cotización no encontrada');
    if (existing.status === 'aprobada') throw new HttpError(409, 'Una cotización aprobada no se puede modificar');
    const q = validateQuote(req.body);
    transaction(db, () => {
      db.prepare('UPDATE quotes SET client_id = ?, vehicle_id = ?, tax_rate = ?, discount = ?, notes = ?, valid_until = ? WHERE id = ?')
        .run(q.client_id, q.vehicle_id, q.tax_rate, q.discount, q.notes, q.valid_until, id);
      saveItems(id, q.items);
    });
    res.json(getQuote('id', id));
  });

  app.put('/api/quotes/:id/status', requireAuth, (req, res) => {
    const status = str(req.body.status);
    if (!QUOTE_STATUSES.includes(status)) throw new HttpError(400, 'Estado inválido');
    const responded = ['aprobada', 'rechazada'].includes(status) ? new Date().toISOString() : null;
    const result = db.prepare('UPDATE quotes SET status = ?, responded_at = ? WHERE id = ?').run(status, responded, Number(req.params.id));
    if (!result.changes) throw new HttpError(404, 'Cotización no encontrada');
    res.json({ ok: true });
  });

  app.delete('/api/quotes/:id', requireRole('admin', 'recepcion'), (req, res) => {
    const result = db.prepare('DELETE FROM quotes WHERE id = ?').run(Number(req.params.id));
    if (!result.changes) throw new HttpError(404, 'Cotización no encontrada');
    res.json({ ok: true });
  });

  // Marks the quote as sent and returns the ways to deliver it. With
  // channel "email" the quote is emailed through SMTP.
  app.post('/api/quotes/:id/send', requireAuth, async (req, res) => {
    const quote = getQuote('id', Number(req.params.id));
    if (!quote) throw new HttpError(404, 'Cotización no encontrada');
    if (!quote.items.length) throw new HttpError(400, 'La cotización no tiene ítems');
    const settings = getSettings();
    const link = `${baseUrl(req)}/c/${quote.public_token}`;
    const channel = str(req.body.channel) || 'link';
    const message = str(req.body.message);

    if (channel === 'email') {
      const to = str(req.body.email) || quote.client.email;
      if (!to || !isEmail(to)) throw new HttpError(400, 'El cliente no tiene un correo válido');
      if (!mailer.enabled) throw new HttpError(400, 'El envío de correos no está configurado en el servidor');
      try {
        await mailer.send({
          to,
          replyTo: settings.workshop_email || undefined,
          subject: `Cotización ${quote.number} - ${settings.workshop_name}`,
          html: renderQuoteEmail({ quote, settings, link, message }),
        });
      } catch (err) {
        throw new HttpError(502, `No se pudo enviar el correo: ${err.message}`);
      }
    }

    if (quote.status === 'borrador' || channel === 'email') {
      db.prepare("UPDATE quotes SET status = CASE WHEN status = 'borrador' THEN 'enviada' ELSE status END, sent_at = ? WHERE id = ?")
        .run(new Date().toISOString(), quote.id);
    }

    const text = `${message ? `${message}\n\n` : ''}Hola ${quote.client.name}, te compartimos la cotización ${quote.number} `
      + `de ${settings.workshop_name} por ${settings.currency} ${quote.total.toFixed(2)}. Puedes verla y aprobarla aquí: ${link}`;
    const phone = (quote.client.phone || '').replace(/\D/g, '');
    res.json({
      ok: true,
      link,
      emailed: channel === 'email',
      whatsapp_url: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
      text,
    });
  });

  // ---------- Dashboard ----------
  app.get('/api/dashboard', requireAuth, (_req, res) => {
    const count = (sql) => db.prepare(sql).get().n;
    const byStatus = Object.fromEntries(QUOTE_STATUSES.map((s) => [s, 0]));
    for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM quotes GROUP BY status').all()) byStatus[r.status] = r.n;
    const approved = listQuotes({ status: 'aprobada' }).reduce((sum, q) => sum + q.total, 0);
    res.json({
      clients: count('SELECT COUNT(*) AS n FROM clients'),
      vehicles: count('SELECT COUNT(*) AS n FROM vehicles'),
      quotes: byStatus,
      approved_total: round2(approved),
      recent_quotes: listQuotes().slice(0, 8),
    });
  });

  // ---------- Public quote (client-facing) ----------
  app.get('/api/public/quotes/:token', (req, res) => {
    const quote = getQuote('public_token', str(req.params.token));
    if (!quote) throw new HttpError(404, 'Cotización no encontrada');
    const s = getSettings();
    res.json({
      number: quote.number,
      status: quote.status,
      created_at: quote.created_at,
      valid_until: quote.valid_until,
      notes: quote.notes,
      items: quote.items.map(({ kind, description, quantity, unit_price }) => ({ kind, description, quantity, unit_price })),
      subtotal: quote.subtotal,
      discount: quote.discount,
      tax_rate: quote.tax_rate,
      tax: quote.tax,
      total: quote.total,
      client: { name: quote.client.name },
      vehicle: quote.vehicle && { plate: quote.vehicle.plate, make: quote.vehicle.make, model: quote.vehicle.model, year: quote.vehicle.year },
      workshop: {
        name: s.workshop_name, address: s.workshop_address, phone: s.workshop_phone,
        email: s.workshop_email, currency: s.currency, footer: s.quote_footer,
      },
    });
  });

  app.post('/api/public/quotes/:token/respond', (req, res) => {
    const decision = str(req.body.decision);
    if (!['aprobada', 'rechazada'].includes(decision)) throw new HttpError(400, 'Respuesta inválida');
    const quote = db.prepare('SELECT id, status, valid_until FROM quotes WHERE public_token = ?').get(str(req.params.token));
    if (!quote) throw new HttpError(404, 'Cotización no encontrada');
    if (quote.status !== 'enviada') throw new HttpError(409, 'Esta cotización ya no admite respuesta');
    if (decision === 'aprobada' && quote.valid_until && quote.valid_until < new Date().toISOString().slice(0, 10)) {
      throw new HttpError(409, 'La cotización está vencida. Contacta al taller para actualizarla.');
    }
    db.prepare('UPDATE quotes SET status = ?, responded_at = ? WHERE id = ?').run(decision, new Date().toISOString(), quote.id);
    res.json({ ok: true, status: decision });
  });

  // ---------- Static ----------
  const publicDir = path.join(__dirname, '..', 'public');
  app.get('/c/:token', (_req, res) => res.sendFile(path.join(publicDir, 'cotizacion.html')));
  app.use(express.static(publicDir));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    if (/UNIQUE constraint failed: users.email/.test(err.message)) return res.status(409).json({ error: 'Ya existe un usuario con ese correo' });
    if (/UNIQUE constraint failed: vehicles.plate/.test(err.message)) return res.status(409).json({ error: 'Ya existe un vehículo con esa placa' });
    if (/FOREIGN KEY constraint failed/.test(err.message)) return res.status(409).json({ error: 'El registro está en uso por otros datos' });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return app;
}

module.exports = { createApp };
