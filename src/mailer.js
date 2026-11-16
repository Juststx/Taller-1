const nodemailer = require('nodemailer');

// SMTP is configured through environment variables. Without SMTP_HOST the
// mailer is disabled and quotes can still be shared by link or WhatsApp.
function createMailer(env = process.env) {
  if (!env.SMTP_HOST) {
    return { enabled: false, send: async () => { throw new Error('El correo no está configurado (SMTP_HOST)'); } };
  }
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === 'true',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  const from = env.SMTP_FROM || env.SMTP_USER;
  return {
    enabled: true,
    send: (message) => transport.sendMail({ from, ...message }),
  };
}

module.exports = { createMailer };
