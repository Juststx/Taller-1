const path = require('node:path');
const { openDb } = require('./db');
const { createMailer } = require('./mailer');
const { createApp } = require('./app');

const port = Number(process.env.PORT || 3000);
const dbFile = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'taller.db');

const db = openDb(dbFile);
const mailer = createMailer();
const app = createApp({
  db,
  mailer,
  publicUrl: process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/$/, '') : null,
  secureCookies: process.env.SECURE_COOKIES === 'true',
});
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

app.listen(port, () => {
  console.log(`Taller listo en http://localhost:${port}`);
  if (!mailer.enabled) console.log('Correo deshabilitado: define SMTP_HOST para enviar cotizaciones por email.');
});
