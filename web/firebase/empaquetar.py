"""Crea el zip para Netlify con las cabeceras de seguridad (_headers).

La política de contenido (CSP) solo deja ejecutar los scripts de esta página (identificados por su
huella sha256) y los de Firebase, y solo deja conectarse a Firebase y Wikipedia. Las huellas cambian
con cada versión de index.html, por eso se calculan aquí al empaquetar.

Uso: python3 empaquetar.py [salida.zip]
"""
import base64, hashlib, os, re, sys, zipfile

AQUI = os.path.dirname(os.path.abspath(__file__))
AUTH_DOMAIN = 'taller-automotriz-38ab1.firebaseapp.com'


def script_hashes(html):
    inline = re.findall(r'<script>(.*?)</script>', html, flags=re.S)
    return ["'sha256-%s'" % base64.b64encode(hashlib.sha256(s.encode()).digest()).decode() for s in inline]


def headers(html, extra_connect=''):
    csp = '; '.join([
        "default-src 'self'",
        "script-src 'self' %s https://www.gstatic.com https://www.google.com/recaptcha/" % ' '.join(script_hashes(html)),
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://upload.wikimedia.org",
        "connect-src 'self' https://*.googleapis.com https://es.wikipedia.org https://en.wikipedia.org https://www.gstatic.com https://fonts.googleapis.com https://fonts.gstatic.com" + extra_connect,
        "frame-src https://%s https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/" % AUTH_DOMAIN,
        "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
    ])
    return '\n'.join([
        '/*',
        '  Content-Security-Policy: ' + csp,
        '  X-Frame-Options: DENY',
        '  X-Content-Type-Options: nosniff',
        '  Referrer-Policy: strict-origin-when-cross-origin',
        '  Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
        '  Strict-Transport-Security: max-age=31536000',
        '  Cross-Origin-Opener-Policy: same-origin',
        '',
    ])


def main(salida):
    html = open(os.path.join(AQUI, 'index.html'), encoding='utf-8').read()
    open(os.path.join(AQUI, '_headers'), 'w', encoding='utf-8').write(headers(html))
    with zipfile.ZipFile(salida, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in ['index.html', 'manifest.webmanifest', 'sw.js', '_headers']:
            z.write(os.path.join(AQUI, f), f)
        for f in sorted(os.listdir(os.path.join(AQUI, 'icons'))):
            z.write(os.path.join(AQUI, 'icons', f), 'icons/' + f)
    print('Listo:', salida)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(AQUI, 'taller.zip'))
