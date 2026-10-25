'use strict';

// ---------- Helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const state = { user: null, settings: null };

const STATUS_LABELS = { borrador: 'Borrador', enviada: 'Enviada', aprobada: 'Aprobada', rechazada: 'Rechazada' };
const ROLE_LABELS = { admin: 'Administrador', recepcion: 'Recepción', mecanico: 'Mecánico' };
const KIND_LABELS = { repuesto: 'Repuesto', mano_obra: 'Mano de obra', otro: 'Otro' };

const money = (n) => `${esc(state.settings?.currency || '')} ${Number(n || 0).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (s) => (s ? new Date(s.length === 10 ? `${s}T00:00:00` : s.replace(' ', 'T') + (s.includes('Z') || s.includes('+') ? '' : 'Z')).toLocaleDateString('es') : '—');
const badge = (status) => `<span class="badge ${esc(status)}">${STATUS_LABELS[status] || esc(status)}</span>`;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login' && path !== '/me/password') {
    state.user = null;
    location.hash = '#/login';
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

let toastTimer;
function toast(message, type = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

function formData(form) {
  const data = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    data[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return data;
}

function modal(title, bodyHtml, { onSubmit, submitLabel = 'Guardar', wide = false } = {}) {
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="modal" style="${wide ? 'max-width:820px' : ''}" novalidate>
        <h2>${esc(title)}</h2>
        ${bodyHtml}
        <p class="error" data-error></p>
        <div class="actions">
          <button type="button" data-close>Cancelar</button>
          ${onSubmit ? `<button type="submit" class="btn-primary">${esc(submitLabel)}</button>` : ''}
        </div>
      </form>
    </div>`;
  const form = $('form', root);
  const close = () => { root.innerHTML = ''; };
  $('[data-close]', root).onclick = close;
  $('.modal-backdrop', root).addEventListener('mousedown', (e) => { if (e.target.classList.contains('modal-backdrop')) close(); });
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!onSubmit) return;
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      await onSubmit(formData(form), form);
      close();
    } catch (err) {
      $('[data-error]', form).textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
  $('input, select, textarea', form)?.focus();
  return { form, close };
}

function confirmDialog(message) {
  return new Promise((resolve) => {
    const { form } = modal('Confirmar', `<p>${esc(message)}</p>`, {
      submitLabel: 'Sí, continuar',
      onSubmit: async () => resolve(true),
    });
    $('[data-close]', form).addEventListener('click', () => resolve(false));
  });
}

const field = (name, label, value = '', { type = 'text', required = false, full = false, attrs = '' } = {}) => `
  <label class="${full ? 'full' : ''}">${esc(label)}${required ? ' *' : ''}
    ${type === 'textarea'
    ? `<textarea name="${name}" ${attrs}>${esc(value)}</textarea>`
    : `<input name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${attrs}>`}
  </label>`;

const selectField = (name, label, options, value, { full = false, required = false } = {}) => `
  <label class="${full ? 'full' : ''}">${esc(label)}${required ? ' *' : ''}
    <select name="${name}">
      ${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}
    </select>
  </label>`;

// ---------- Layout ----------
const NAV = [
  ['#/', 'Inicio'],
  ['#/cotizaciones', 'Cotizaciones'],
  ['#/clientes', 'Clientes'],
  ['#/vehiculos', 'Vehículos'],
  ['#/usuarios', 'Usuarios', 'admin'],
  ['#/ajustes', 'Ajustes'],
];

function renderLayout(content) {
  const current = location.hash.split('/').slice(0, 2).join('/') || '#/';
  $('#app').innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">🔧 ${esc(state.settings?.workshop_name || 'Taller')}</div>
        <button class="menu-toggle btn-sm" type="button" aria-label="Menú">☰</button>
        <nav>
          ${NAV.filter(([, , role]) => !role || state.user.role === role)
    .map(([href, label]) => `<a href="${href}" class="${current === href ? 'active' : ''}">${label}</a>`).join('')}
        </nav>
        <div class="spacer"></div>
        <div class="user">
          <div><strong>${esc(state.user.name)}</strong></div>
          <div>${ROLE_LABELS[state.user.role]}</div>
          <button type="button" class="btn-sm" data-logout>Cerrar sesión</button>
        </div>
      </aside>
      <main class="main">${content}</main>
    </div>`;
  $('.menu-toggle').onclick = () => $('.sidebar').classList.toggle('open');
  $('[data-logout]').onclick = async () => {
    await api('/logout', { method: 'POST' });
    state.user = null;
    location.hash = '#/login';
  };
}

// ---------- Auth views ----------
async function viewLogin() {
  const { needsSetup } = await api('/setup');
  if (needsSetup) return viewSetup();
  $('#app').innerHTML = `
    <div class="auth"><div class="card">
      <h1>Iniciar sesión</h1>
      <p class="muted">Gestión de taller</p>
      <form>
        ${field('email', 'Correo', '', { type: 'email', required: true })}
        ${field('password', 'Contraseña', '', { type: 'password', required: true })}
        <p class="error" data-error></p>
        <button class="btn-primary" type="submit">Entrar</button>
      </form>
    </div></div>`;
  $('form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      state.user = await api('/login', { method: 'POST', body: formData(e.target) });
      location.hash = '#/';
    } catch (err) {
      $('[data-error]').textContent = err.message;
    }
  };
}

function viewSetup() {
  $('#app').innerHTML = `
    <div class="auth"><div class="card">
      <h1>Bienvenido</h1>
      <p class="muted">Crea la cuenta del administrador del taller.</p>
      <form>
        ${field('workshop_name', 'Nombre del taller', '', { required: true })}
        ${field('name', 'Tu nombre', '', { required: true })}
        ${field('email', 'Correo', '', { type: 'email', required: true })}
        ${field('password', 'Contraseña (mín. 6 caracteres)', '', { type: 'password', required: true })}
        <p class="error" data-error></p>
        <button class="btn-primary" type="submit">Crear cuenta</button>
      </form>
    </div></div>`;
  $('form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      state.user = await api('/setup', { method: 'POST', body: formData(e.target) });
      location.hash = '#/';
      router();
    } catch (err) {
      $('[data-error]').textContent = err.message;
    }
  };
}

// ---------- Dashboard ----------
async function viewDashboard() {
  const d = await api('/dashboard');
  renderLayout(`
    <div class="page-head"><h1>Inicio</h1>
      <a class="btn btn-primary" href="#/cotizaciones/nueva">+ Nueva cotización</a></div>
    <div class="grid stats">
      <div class="stat"><div class="label">Clientes</div><div class="value">${d.clients}</div></div>
      <div class="stat"><div class="label">Vehículos</div><div class="value">${d.vehicles}</div></div>
      <div class="stat"><div class="label">Cotizaciones en borrador</div><div class="value">${d.quotes.borrador}</div></div>
      <div class="stat"><div class="label">Esperando respuesta</div><div class="value">${d.quotes.enviada}</div></div>
      <div class="stat"><div class="label">Aprobadas</div><div class="value">${d.quotes.aprobada}</div></div>
      <div class="stat"><div class="label">Total aprobado</div><div class="value" style="font-size:1.25rem">${money(d.approved_total)}</div></div>
    </div>
    <div class="card"><h2>Cotizaciones recientes</h2>${quotesTable(d.recent_quotes)}</div>`);
  bindRowLinks();
}

function quotesTable(quotes) {
  if (!quotes.length) return '<p class="empty">No hay cotizaciones todavía.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Número</th><th>Cliente</th><th>Vehículo</th><th>Fecha</th><th>Estado</th><th class="num">Total</th></tr></thead>
    <tbody>${quotes.map((q) => `
      <tr class="clickable" data-href="#/cotizaciones/${q.id}">
        <td><strong>${esc(q.number)}</strong></td><td>${esc(q.client_name)}</td><td>${esc(q.vehicle_plate || '—')}</td>
        <td>${fmtDate(q.created_at)}</td><td>${badge(q.status)}</td><td class="num">${money(q.total)}</td>
      </tr>`).join('')}</tbody></table></div>`;
}

function bindRowLinks(root = document) {
  $$('tr[data-href]', root).forEach((tr) => { tr.onclick = () => { location.hash = tr.dataset.href; }; });
}

function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------- Clients ----------
function clientForm(c = {}) {
  return `<div class="form-grid">
    ${field('name', 'Nombre completo / Razón social', c.name, { required: true, full: true })}
    ${field('document', 'Documento / NIT / RUC', c.document)}
    ${field('phone', 'Teléfono (WhatsApp, con código de país)', c.phone, { type: 'tel', attrs: 'placeholder="573001234567"' })}
    ${field('email', 'Correo', c.email, { type: 'email' })}
    ${field('address', 'Dirección', c.address)}
    ${field('notes', 'Notas', c.notes, { type: 'textarea', full: true })}
  </div>`;
}

function openClientModal(client, onSaved) {
  modal(client ? 'Editar cliente' : 'Nuevo cliente', clientForm(client || {}), {
    onSubmit: async (data) => {
      const res = client
        ? await api(`/clients/${client.id}`, { method: 'PUT', body: data })
        : await api('/clients', { method: 'POST', body: data });
      toast('Cliente guardado');
      onSaved?.(client ? client.id : res.id);
    },
  });
}

async function viewClients() {
  renderLayout(`
    <div class="page-head"><h1>Clientes</h1>
      <div class="actions"><input class="search" placeholder="Buscar por nombre, documento, teléfono…" data-search>
      <button class="btn-primary" data-new>+ Nuevo cliente</button></div></div>
    <div class="card" data-list></div>`);
  const load = async (q = '') => {
    const clients = await api(`/clients?q=${encodeURIComponent(q)}`);
    $('[data-list]').innerHTML = clients.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Nombre</th><th>Documento</th><th>Teléfono</th><th>Correo</th><th class="num">Vehículos</th></tr></thead>
      <tbody>${clients.map((c) => `
        <tr class="clickable" data-href="#/clientes/${c.id}">
          <td><strong>${esc(c.name)}</strong></td><td>${esc(c.document || '—')}</td><td>${esc(c.phone || '—')}</td>
          <td>${esc(c.email || '—')}</td><td class="num">${c.vehicle_count}</td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="empty">No se encontraron clientes.</p>';
    bindRowLinks();
  };
  $('[data-search]').oninput = debounce((e) => load(e.target.value));
  $('[data-new]').onclick = () => openClientModal(null, (id) => { location.hash = `#/clientes/${id}`; });
  await load();
}

async function viewClient(id) {
  const c = await api(`/clients/${id}`);
  const canDelete = ['admin', 'recepcion'].includes(state.user.role);
  renderLayout(`
    <div class="page-head"><h1>${esc(c.name)}</h1>
      <div class="actions">
        <a class="btn" href="#/clientes">← Volver</a>
        <button data-edit>Editar</button>
        ${canDelete ? '<button class="btn-danger" data-delete>Eliminar</button>' : ''}
        <a class="btn btn-primary" href="#/cotizaciones/nueva?cliente=${c.id}">+ Cotización</a>
      </div></div>
    <div class="card"><dl class="dl">
      <dt>Documento</dt><dd>${esc(c.document || '—')}</dd>
      <dt>Teléfono</dt><dd>${esc(c.phone || '—')}</dd>
      <dt>Correo</dt><dd>${esc(c.email || '—')}</dd>
      <dt>Dirección</dt><dd>${esc(c.address || '—')}</dd>
      <dt>Notas</dt><dd>${esc(c.notes || '—')}</dd>
      <dt>Cliente desde</dt><dd>${fmtDate(c.created_at)}</dd>
    </dl></div>
    <div class="card">
      <div class="page-head" style="margin-bottom:8px"><h2>Vehículos</h2><button class="btn-sm" data-new-vehicle>+ Agregar vehículo</button></div>
      ${vehiclesTable(c.vehicles, { showClient: false })}
    </div>
    <div class="card"><h2>Cotizaciones</h2>${quotesTable(c.quotes)}</div>`);
  bindRowLinks();
  $('[data-edit]').onclick = () => openClientModal(c, () => viewClient(id));
  $('[data-new-vehicle]').onclick = () => openVehicleModal({ client_id: c.id }, () => viewClient(id));
  if (canDelete) {
    $('[data-delete]').onclick = async () => {
      if (!await confirmDialog(`¿Eliminar al cliente ${c.name}?`)) return;
      try {
        await api(`/clients/${id}`, { method: 'DELETE' });
        toast('Cliente eliminado');
        location.hash = '#/clientes';
      } catch (err) { toast(err.message, 'error'); }
    };
  }
}

// ---------- Vehicles ----------
function vehiclesTable(vehicles, { showClient = true } = {}) {
  if (!vehicles.length) return '<p class="empty">No hay vehículos registrados.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Placa</th><th>Marca / Modelo</th><th>Año</th><th>Color</th>${showClient ? '<th>Propietario</th>' : ''}<th class="num">Kilometraje</th></tr></thead>
    <tbody>${vehicles.map((v) => `
      <tr class="clickable" data-href="#/vehiculos/${v.id}">
        <td><strong>${esc(v.plate)}</strong></td><td>${esc(v.make)} ${esc(v.model)}</td><td>${esc(v.year || '—')}</td>
        <td>${esc(v.color || '—')}</td>${showClient ? `<td>${esc(v.client_name)}</td>` : ''}
        <td class="num">${v.mileage != null ? Number(v.mileage).toLocaleString('es') : '—'}</td>
      </tr>`).join('')}</tbody></table></div>`;
}

async function openVehicleModal(vehicle, onSaved) {
  const clients = await api('/clients');
  if (!clients.length) {
    toast('Primero registra un cliente', 'error');
    return;
  }
  const v = vehicle || {};
  const editing = Boolean(v.id);
  modal(editing ? 'Editar vehículo' : 'Nuevo vehículo', `<div class="form-grid">
    ${selectField('client_id', 'Propietario', [['', 'Selecciona un cliente…'], ...clients.map((c) => [c.id, c.name])], v.client_id, { full: true, required: true })}
    ${field('plate', 'Placa', v.plate, { required: true, attrs: 'style="text-transform:uppercase"' })}
    ${field('make', 'Marca', v.make, { required: true })}
    ${field('model', 'Modelo', v.model, { required: true })}
    ${field('year', 'Año', v.year, { type: 'number', attrs: 'min="1900" max="2100"' })}
    ${field('color', 'Color', v.color)}
    ${field('mileage', 'Kilometraje', v.mileage, { type: 'number', attrs: 'min="0"' })}
    ${field('vin', 'VIN / Serie', v.vin, { full: true })}
    ${field('notes', 'Notas', v.notes, { type: 'textarea', full: true })}
  </div>`, {
    onSubmit: async (data) => {
      const res = editing
        ? await api(`/vehicles/${v.id}`, { method: 'PUT', body: data })
        : await api('/vehicles', { method: 'POST', body: data });
      toast('Vehículo guardado');
      onSaved?.(editing ? v.id : res.id);
    },
  });
}

async function viewVehicles() {
  renderLayout(`
    <div class="page-head"><h1>Vehículos</h1>
      <div class="actions"><input class="search" placeholder="Buscar por placa, marca, propietario…" data-search>
      <button class="btn-primary" data-new>+ Nuevo vehículo</button></div></div>
    <div class="card" data-list></div>`);
  const load = async (q = '') => {
    $('[data-list]').innerHTML = vehiclesTable(await api(`/vehicles?q=${encodeURIComponent(q)}`));
    bindRowLinks();
  };
  $('[data-search]').oninput = debounce((e) => load(e.target.value));
  $('[data-new]').onclick = () => openVehicleModal(null, (id) => { location.hash = `#/vehiculos/${id}`; });
  await load();
}

async function viewVehicle(id) {
  const v = await api(`/vehicles/${id}`);
  const canDelete = ['admin', 'recepcion'].includes(state.user.role);
  renderLayout(`
    <div class="page-head"><h1>${esc(v.plate)} · ${esc(v.make)} ${esc(v.model)}</h1>
      <div class="actions">
        <a class="btn" href="#/vehiculos">← Volver</a>
        <button data-edit>Editar</button>
        ${canDelete ? '<button class="btn-danger" data-delete>Eliminar</button>' : ''}
        <a class="btn btn-primary" href="#/cotizaciones/nueva?cliente=${v.client_id}&vehiculo=${v.id}">+ Cotización</a>
      </div></div>
    <div class="card"><dl class="dl">
      <dt>Propietario</dt><dd><a href="#/clientes/${v.client_id}">${esc(v.client_name)}</a></dd>
      <dt>Año</dt><dd>${esc(v.year || '—')}</dd>
      <dt>Color</dt><dd>${esc(v.color || '—')}</dd>
      <dt>Kilometraje</dt><dd>${v.mileage != null ? Number(v.mileage).toLocaleString('es') : '—'}</dd>
      <dt>VIN / Serie</dt><dd>${esc(v.vin || '—')}</dd>
      <dt>Notas</dt><dd>${esc(v.notes || '—')}</dd>
    </dl></div>
    <div class="card"><h2>Historial de cotizaciones</h2>${quotesTable(v.quotes)}</div>`);
  bindRowLinks();
  $('[data-edit]').onclick = () => openVehicleModal(v, () => viewVehicle(id));
  if (canDelete) {
    $('[data-delete]').onclick = async () => {
      if (!await confirmDialog(`¿Eliminar el vehículo ${v.plate}?`)) return;
      try {
        await api(`/vehicles/${id}`, { method: 'DELETE' });
        toast('Vehículo eliminado');
        location.hash = '#/vehiculos';
      } catch (err) { toast(err.message, 'error'); }
    };
  }
}

// ---------- Quotes ----------
async function viewQuotes() {
  renderLayout(`
    <div class="page-head"><h1>Cotizaciones</h1>
      <div class="actions">
        <input class="search" placeholder="Buscar por número, cliente o placa…" data-search>
        <select data-status style="width:auto">
          <option value="">Todos los estados</option>
          ${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
        <a class="btn btn-primary" href="#/cotizaciones/nueva">+ Nueva cotización</a>
      </div></div>
    <div class="card" data-list></div>`);
  const load = async () => {
    const q = $('[data-search]').value;
    const status = $('[data-status]').value;
    $('[data-list]').innerHTML = quotesTable(await api(`/quotes?q=${encodeURIComponent(q)}&status=${status}`));
    bindRowLinks();
  };
  $('[data-search]').oninput = debounce(load);
  $('[data-status]').onchange = load;
  await load();
}

async function viewQuoteEditor(id, params) {
  const [clients, quote] = await Promise.all([
    api('/clients'),
    id ? api(`/quotes/${id}`) : Promise.resolve(null),
  ]);
  if (!clients.length) {
    renderLayout(`<div class="card empty">Primero debes <a href="#/clientes">registrar un cliente</a> para crear una cotización.</div>`);
    return;
  }
  const q = quote || {
    client_id: params.get('cliente') || '',
    vehicle_id: params.get('vehiculo') || '',
    tax_rate: state.settings.default_tax_rate,
    discount: 0,
    notes: '',
    valid_until: '',
    items: [{ kind: 'mano_obra', description: '', quantity: 1, unit_price: 0 }],
  };

  renderLayout(`
    <div class="page-head"><h1>${quote ? `Editar ${esc(quote.number)}` : 'Nueva cotización'}</h1>
      <a class="btn" href="${quote ? `#/cotizaciones/${quote.id}` : '#/cotizaciones'}">← Volver</a></div>
    <form data-quote novalidate>
      <div class="card"><div class="form-grid">
        <label>Cliente *
          <select name="client_id">
            <option value="">Selecciona un cliente…</option>
            ${clients.map((c) => `<option value="${c.id}" ${String(c.id) === String(q.client_id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </label>
        <label>Vehículo <select name="vehicle_id"></select></label>
        ${field('valid_until', 'Válida hasta', q.valid_until, { type: 'date' })}
      </div></div>
      <div class="card">
        <h2>Detalle</h2>
        <div class="table-wrap"><table class="items-table">
          <thead><tr><th style="width:150px">Tipo</th><th>Descripción</th><th class="num">Cantidad</th><th class="num">Precio unit.</th><th class="num">Importe</th><th></th></tr></thead>
          <tbody data-items></tbody>
        </table></div>
        <div class="actions" style="margin-top:10px">
          <button type="button" class="btn-sm" data-add="mano_obra">+ Mano de obra</button>
          <button type="button" class="btn-sm" data-add="repuesto">+ Repuesto</button>
          <button type="button" class="btn-sm" data-add="otro">+ Otro</button>
        </div>
        <div class="form-grid" style="margin-top:20px">
          <div>
            ${field('notes', 'Observaciones para el cliente', q.notes, { type: 'textarea' })}
          </div>
          <div class="totals">
            <label>Descuento (${esc(state.settings.currency)}) <input name="discount" type="number" min="0" step="0.01" value="${esc(q.discount)}"></label>
            <label style="margin-top:8px">Impuesto (%) <input name="tax_rate" type="number" min="0" max="100" step="0.01" value="${esc(q.tax_rate)}"></label>
            <div style="margin-top:12px"><span>Subtotal</span><span data-t="subtotal"></span></div>
            <div><span>Descuento</span><span data-t="discount"></span></div>
            <div><span>Impuesto</span><span data-t="tax"></span></div>
            <div class="grand"><span>Total</span><span data-t="total"></span></div>
          </div>
        </div>
      </div>
      <p class="error" data-error></p>
      <div class="actions"><button type="submit" class="btn-primary">Guardar cotización</button></div>
    </form>`);

  const form = $('[data-quote]');
  const tbody = $('[data-items]', form);
  const clientSel = form.elements.client_id;
  const vehicleSel = form.elements.vehicle_id;

  const loadVehicles = async (selected) => {
    if (!clientSel.value) {
      vehicleSel.innerHTML = '<option value="">—</option>';
      return;
    }
    const vehicles = await api(`/vehicles?client_id=${clientSel.value}`);
    vehicleSel.innerHTML = `<option value="">Sin vehículo</option>${vehicles.map((v) => `
      <option value="${v.id}" ${String(v.id) === String(selected) ? 'selected' : ''}>${esc(v.plate)} — ${esc(v.make)} ${esc(v.model)}</option>`).join('')}`;
  };
  clientSel.onchange = () => loadVehicles('');
  await loadVehicles(q.vehicle_id);

  const itemRow = (item) => `<tr>
    <td><select data-f="kind">${Object.entries(KIND_LABELS).map(([v, l]) => `<option value="${v}" ${v === item.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
    <td><input data-f="description" value="${esc(item.description)}" placeholder="Ej: Cambio de aceite y filtro"></td>
    <td><input data-f="quantity" class="qty num" type="number" min="0" step="0.01" value="${esc(item.quantity)}"></td>
    <td><input data-f="unit_price" class="price num" type="number" min="0" step="0.01" value="${esc(item.unit_price)}"></td>
    <td class="num" data-amount></td>
    <td><button type="button" class="btn-sm btn-danger" data-remove title="Quitar">✕</button></td>
  </tr>`;

  const readItems = () => $$('tr', tbody).map((tr) => ({
    kind: $('[data-f=kind]', tr).value,
    description: $('[data-f=description]', tr).value,
    quantity: Number($('[data-f=quantity]', tr).value || 0),
    unit_price: Number($('[data-f=unit_price]', tr).value || 0),
  }));

  const recalc = () => {
    let subtotal = 0;
    $$('tr', tbody).forEach((tr) => {
      const amount = Number($('[data-f=quantity]', tr).value || 0) * Number($('[data-f=unit_price]', tr).value || 0);
      subtotal += amount;
      $('[data-amount]', tr).innerHTML = money(amount);
    });
    const discount = Math.min(Number(form.elements.discount.value || 0), subtotal);
    const tax = (subtotal - discount) * Number(form.elements.tax_rate.value || 0) / 100;
    $('[data-t=subtotal]').innerHTML = money(subtotal);
    $('[data-t=discount]').innerHTML = `-${money(discount)}`;
    $('[data-t=tax]').innerHTML = money(tax);
    $('[data-t=total]').innerHTML = money(subtotal - discount + tax);
  };

  const addItem = (item) => {
    tbody.insertAdjacentHTML('beforeend', itemRow(item));
    recalc();
  };
  q.items.forEach(addItem);
  $$('[data-add]', form).forEach((b) => {
    b.onclick = () => {
      addItem({ kind: b.dataset.add, description: '', quantity: 1, unit_price: 0 });
      $('tr:last-child [data-f=description]', tbody).focus();
    };
  });
  tbody.addEventListener('click', (e) => {
    if (e.target.closest('[data-remove]')) {
      e.target.closest('tr').remove();
      recalc();
    }
  });
  form.addEventListener('input', recalc);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      client_id: clientSel.value,
      vehicle_id: vehicleSel.value,
      valid_until: form.elements.valid_until.value,
      notes: form.elements.notes.value,
      discount: form.elements.discount.value || 0,
      tax_rate: form.elements.tax_rate.value || 0,
      items: readItems().filter((i) => i.description.trim() || i.unit_price),
    };
    try {
      const saved = quote
        ? await api(`/quotes/${quote.id}`, { method: 'PUT', body })
        : await api('/quotes', { method: 'POST', body });
      toast('Cotización guardada');
      location.hash = `#/cotizaciones/${saved.id}`;
    } catch (err) {
      $('[data-error]', form).textContent = err.message;
    }
  };
}

async function viewQuote(id) {
  const q = await api(`/quotes/${id}`);
  const s = state.settings;
  const canDelete = ['admin', 'recepcion'].includes(state.user.role);
  renderLayout(`
    <div class="page-head no-print"><h1>${esc(q.number)} ${badge(q.status)}</h1>
      <div class="actions">
        <a class="btn" href="#/cotizaciones">← Volver</a>
        ${q.status !== 'aprobada' ? `<a class="btn" href="#/cotizaciones/${q.id}/editar">Editar</a>` : ''}
        <button data-print>Imprimir / PDF</button>
        <select data-status style="width:auto" title="Cambiar estado">
          ${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}" ${v === q.status ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        ${canDelete ? '<button class="btn-danger" data-delete>Eliminar</button>' : ''}
        <button class="btn-primary" data-send>Enviar al cliente</button>
      </div></div>
    <div class="card">
      <div class="page-head" style="align-items:flex-start">
        <div>
          <h2 style="margin-bottom:4px">${esc(s.workshop_name)}</h2>
          <div class="muted">${esc(s.workshop_address)}</div>
          <div class="muted">${esc(s.workshop_phone)} ${esc(s.workshop_email)}</div>
        </div>
        <div style="text-align:right">
          <div><strong>Cotización ${esc(q.number)}</strong></div>
          <div class="muted">Fecha: ${fmtDate(q.created_at)}</div>
          <div class="muted">Válida hasta: ${fmtDate(q.valid_until)}</div>
        </div>
      </div>
      <div class="form-grid" style="margin-bottom:16px">
        <dl class="dl">
          <dt>Cliente</dt><dd><a href="#/clientes/${q.client.id}">${esc(q.client.name)}</a></dd>
          <dt>Documento</dt><dd>${esc(q.client.document || '—')}</dd>
          <dt>Teléfono</dt><dd>${esc(q.client.phone || '—')}</dd>
          <dt>Correo</dt><dd>${esc(q.client.email || '—')}</dd>
        </dl>
        <dl class="dl">
          ${q.vehicle ? `
          <dt>Vehículo</dt><dd><a href="#/vehiculos/${q.vehicle.id}">${esc(q.vehicle.make)} ${esc(q.vehicle.model)} ${esc(q.vehicle.year || '')}</a></dd>
          <dt>Placa</dt><dd>${esc(q.vehicle.plate)}</dd>
          <dt>Kilometraje</dt><dd>${q.vehicle.mileage != null ? Number(q.vehicle.mileage).toLocaleString('es') : '—'}</dd>` : '<dt>Vehículo</dt><dd>—</dd>'}
          <dt>Elaboró</dt><dd>${esc(q.created_by_name || '—')}</dd>
        </dl>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Tipo</th><th>Descripción</th><th class="num">Cant.</th><th class="num">Precio unit.</th><th class="num">Importe</th></tr></thead>
        <tbody>${q.items.map((i) => `<tr>
          <td>${KIND_LABELS[i.kind]}</td><td>${esc(i.description)}</td><td class="num">${i.quantity}</td>
          <td class="num">${money(i.unit_price)}</td><td class="num">${money(i.quantity * i.unit_price)}</td></tr>`).join('')
          || '<tr><td colspan="5" class="empty">Sin ítems</td></tr>'}</tbody>
      </table></div>
      <div class="totals" style="margin-top:16px">
        <div><span>Subtotal</span><span>${money(q.subtotal)}</span></div>
        ${q.discount ? `<div><span>Descuento</span><span>-${money(q.discount)}</span></div>` : ''}
        <div><span>Impuesto (${q.tax_rate}%)</span><span>${money(q.tax)}</span></div>
        <div class="grand"><span>Total</span><span>${money(q.total)}</span></div>
      </div>
      ${q.notes ? `<p><strong>Observaciones:</strong><br>${esc(q.notes).replace(/\n/g, '<br>')}</p>` : ''}
      <p class="muted">${esc(s.quote_footer)}</p>
      <p class="muted no-print" style="font-size:.85rem">
        ${q.sent_at ? `Enviada el ${fmtDate(q.sent_at)}. ` : ''}${q.responded_at ? `Respuesta registrada el ${fmtDate(q.responded_at)}.` : ''}
      </p>
    </div>`);

  $('[data-print]').onclick = () => window.print();
  $('[data-send]').onclick = () => openSendModal(q);
  $('[data-status]').onchange = async (e) => {
    try {
      await api(`/quotes/${id}/status`, { method: 'PUT', body: { status: e.target.value } });
      toast('Estado actualizado');
      viewQuote(id);
    } catch (err) { toast(err.message, 'error'); }
  };
  if (canDelete) {
    $('[data-delete]').onclick = async () => {
      if (!await confirmDialog(`¿Eliminar la cotización ${q.number}?`)) return;
      try {
        await api(`/quotes/${id}`, { method: 'DELETE' });
        toast('Cotización eliminada');
        location.hash = '#/cotizaciones';
      } catch (err) { toast(err.message, 'error'); }
    };
  }
}

function openSendModal(q) {
  const mailEnabled = state.user.mailEnabled;
  const { form, close } = modal(`Enviar ${q.number}`, `
    <p class="muted">El cliente recibirá un enlace donde podrá ver la cotización y aprobarla o rechazarla.</p>
    <label>Enlace de la cotización
      <div class="share-link"><input readonly value="${esc(q.public_url)}" data-link><button type="button" data-copy>Copiar</button></div>
    </label>
    <label style="margin-top:12px">Mensaje (opcional)
      <textarea name="message" placeholder="Ej: Adjuntamos el presupuesto de la revisión de frenos."></textarea>
    </label>
    <div class="card" style="margin-top:16px">
      <h2>Por correo electrónico</h2>
      ${mailEnabled ? `
        ${field('email', 'Correo del cliente', q.client.email, { type: 'email' })}
        <div class="actions" style="margin-top:10px"><button type="button" class="btn-primary" data-email>Enviar correo</button></div>`
    : `<p class="muted">El servidor no tiene SMTP configurado. Puedes usar tu propio programa de correo:</p>
        <a class="btn" data-mailto target="_blank" rel="noopener">Abrir en mi correo</a>`}
    </div>
    <div class="card">
      <h2>Por WhatsApp</h2>
      ${q.client.phone ? '' : '<p class="muted">El cliente no tiene teléfono registrado; podrás elegir el contacto en WhatsApp.</p>'}
      <button type="button" class="btn-success" data-whatsapp>Enviar por WhatsApp</button>
    </div>`);

  const message = () => form.elements.message.value;
  const send = async (channel, extra = {}) => {
    const res = await api(`/quotes/${q.id}/send`, { method: 'POST', body: { channel, message: message(), ...extra } });
    return res;
  };
  const done = (text) => {
    toast(text);
    close();
    viewQuote(q.id);
  };
  const fail = (err) => { $('[data-error]', form).textContent = err.message; };

  $('[data-copy]', form).onclick = async () => {
    try {
      await navigator.clipboard.writeText(q.public_url);
    } catch {
      $('[data-link]', form).select();
      document.execCommand('copy');
    }
    send('link').then(() => toast('Enlace copiado y cotización marcada como enviada')).catch(fail);
  };
  $('[data-whatsapp]', form).onclick = () => {
    // Open the window synchronously so popup blockers allow it.
    const win = window.open('about:blank', '_blank');
    send('whatsapp').then((res) => {
      if (win) win.location = res.whatsapp_url; else location.href = res.whatsapp_url;
      done('Cotización marcada como enviada');
    }).catch((err) => { win?.close(); fail(err); });
  };
  if (mailEnabled) {
    $('[data-email]', form).onclick = async (e) => {
      e.target.disabled = true;
      try {
        await send('email', { email: form.elements.email.value });
        done('Correo enviado al cliente');
      } catch (err) { fail(err); } finally { e.target.disabled = false; }
    };
  } else {
    $('[data-mailto]', form).onclick = (e) => {
      e.preventDefault();
      send('link').then((res) => {
        const subject = `Cotización ${q.number} - ${state.settings.workshop_name}`;
        location.href = `mailto:${encodeURIComponent(q.client.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(res.text)}`;
        done('Cotización marcada como enviada');
      }).catch(fail);
    };
  }
}

// ---------- Users ----------
function openUserModal(user, onSaved) {
  const u = user || { role: 'mecanico', active: 1 };
  modal(user ? 'Editar usuario' : 'Nuevo usuario', `<div class="form-grid">
    ${field('name', 'Nombre', u.name, { required: true })}
    ${field('email', 'Correo', u.email, { type: 'email', required: true })}
    ${selectField('role', 'Rol', Object.entries(ROLE_LABELS), u.role)}
    ${field('password', user ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña', '', { type: 'password', required: !user })}
    <label class="full" style="flex-direction:row;align-items:center;gap:8px">
      <input type="checkbox" name="active" style="width:auto" ${u.active ? 'checked' : ''}> Usuario activo
    </label>
  </div>
  <p class="muted" style="font-size:.85rem">Administrador: acceso total. Recepción: clientes, vehículos y cotizaciones (puede eliminar). Mecánico: puede consultar y crear, pero no eliminar.</p>`, {
    onSubmit: async (data) => {
      if (user) await api(`/users/${user.id}`, { method: 'PUT', body: data });
      else await api('/users', { method: 'POST', body: data });
      toast('Usuario guardado');
      onSaved?.();
    },
  });
}

async function viewUsers() {
  if (state.user.role !== 'admin') {
    renderLayout('<div class="card empty">Solo los administradores pueden gestionar usuarios.</div>');
    return;
  }
  const users = await api('/users');
  renderLayout(`
    <div class="page-head"><h1>Usuarios</h1><button class="btn-primary" data-new>+ Nuevo usuario</button></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
      <tbody>${users.map((u) => `<tr>
        <td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td><td>${ROLE_LABELS[u.role]}</td>
        <td>${u.active ? '<span class="badge aprobada">Activo</span>' : '<span class="badge inactive">Inactivo</span>'}</td>
        <td class="num"><div class="actions" style="justify-content:flex-end">
          <button class="btn-sm" data-edit="${u.id}">Editar</button>
          ${u.id !== state.user.id ? `<button class="btn-sm btn-danger" data-delete="${u.id}">Eliminar</button>` : ''}
        </div></td></tr>`).join('')}</tbody>
    </table></div></div>`);
  $('[data-new]').onclick = () => openUserModal(null, viewUsers);
  $$('[data-edit]').forEach((b) => { b.onclick = () => openUserModal(users.find((u) => u.id === Number(b.dataset.edit)), viewUsers); });
  $$('[data-delete]').forEach((b) => {
    b.onclick = async () => {
      const u = users.find((x) => x.id === Number(b.dataset.delete));
      if (!await confirmDialog(`¿Eliminar al usuario ${u.name}?`)) return;
      try {
        await api(`/users/${u.id}`, { method: 'DELETE' });
        toast('Usuario eliminado');
        viewUsers();
      } catch (err) { toast(err.message, 'error'); }
    };
  });
}

// ---------- Settings ----------
async function viewSettings() {
  const s = state.settings;
  const isAdmin = state.user.role === 'admin';
  renderLayout(`
    <div class="page-head"><h1>Ajustes</h1></div>
    ${isAdmin ? `<form class="card" data-settings>
      <h2>Datos del taller</h2>
      <div class="form-grid">
        ${field('workshop_name', 'Nombre del taller', s.workshop_name, { required: true })}
        ${field('workshop_phone', 'Teléfono', s.workshop_phone)}
        ${field('workshop_email', 'Correo', s.workshop_email, { type: 'email' })}
        ${field('workshop_address', 'Dirección', s.workshop_address)}
        ${field('currency', 'Moneda (ej: USD, COP, MXN)', s.currency)}
        ${field('default_tax_rate', 'Impuesto por defecto (%)', s.default_tax_rate, { type: 'number', attrs: 'min="0" max="100" step="0.01"' })}
        ${field('quote_validity_days', 'Validez de cotizaciones (días)', s.quote_validity_days, { type: 'number', attrs: 'min="1"' })}
        ${field('quote_footer', 'Pie de página de las cotizaciones', s.quote_footer, { type: 'textarea', full: true })}
      </div>
      <p class="error" data-error></p>
      <div class="actions"><button class="btn-primary" type="submit">Guardar ajustes</button></div>
    </form>` : ''}
    <form class="card" data-password>
      <h2>Cambiar mi contraseña</h2>
      <div class="form-grid">
        ${field('current_password', 'Contraseña actual', '', { type: 'password', required: true })}
        ${field('new_password', 'Nueva contraseña', '', { type: 'password', required: true })}
      </div>
      <p class="error" data-error></p>
      <div class="actions"><button class="btn-primary" type="submit">Cambiar contraseña</button></div>
    </form>`);

  if (isAdmin) {
    $('[data-settings]').onsubmit = async (e) => {
      e.preventDefault();
      try {
        state.settings = await api('/settings', { method: 'PUT', body: formData(e.target) });
        toast('Ajustes guardados');
        viewSettings();
      } catch (err) { $('[data-error]', e.target).textContent = err.message; }
    };
  }
  $('[data-password]').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/me/password', { method: 'PUT', body: formData(e.target) });
      e.target.reset();
      toast('Contraseña actualizada');
    } catch (err) { $('[data-error]', e.target).textContent = err.message; }
  };
}

// ---------- Router ----------
async function router() {
  const [pathPart, query = ''] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(query);
  const parts = pathPart.split('/').filter(Boolean);
  $('#modal-root').innerHTML = '';

  try {
    if (parts[0] === 'login') return await viewLogin();
    if (!state.user) {
      try {
        state.user = await api('/me');
      } catch {
        location.hash = '#/login';
        return;
      }
    }
    // /login and /setup don't return mailEnabled, /me does.
    if (state.user.mailEnabled === undefined) state.user = await api('/me');
    if (!state.settings) state.settings = await api('/settings');

    const [section, id, action] = parts;
    switch (section) {
      case undefined: return await viewDashboard();
      case 'clientes': return id ? await viewClient(id) : await viewClients();
      case 'vehiculos': return id ? await viewVehicle(id) : await viewVehicles();
      case 'cotizaciones':
        if (id === 'nueva') return await viewQuoteEditor(null, params);
        if (id && action === 'editar') return await viewQuoteEditor(id, params);
        return id ? await viewQuote(id) : await viewQuotes();
      case 'usuarios': return await viewUsers();
      case 'ajustes': return await viewSettings();
      default: location.hash = '#/';
    }
  } catch (err) {
    if (state.user) renderLayout(`<div class="card"><p class="error">${esc(err.message)}</p><a href="#/">Volver al inicio</a></div>`);
    else toast(err.message, 'error');
  }
}

window.addEventListener('hashchange', router);
router();
