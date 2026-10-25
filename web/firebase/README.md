# Taller — versión con Firebase

`index.html` es la misma web del taller, pero guarda los datos en Firestore (proyecto
`taller-automotriz-38ab1`) y cada persona entra con correo y contraseña. Funciona en cualquier
hosting estático y en el celular (se puede "Agregar a la pantalla de inicio").

## Puesta en marcha (una sola vez)

1. **Authentication** → Métodos de acceso → activar **Correo electrónico/contraseña**.
2. **Firestore Database** → crear la base de datos en modo producción.
3. **Firestore Database → Reglas**: pegar el contenido de `firestore.rules` y **Publicar**.
4. Publicar en un hosting `index.html`, `manifest.webmanifest`, `sw.js` y la carpeta `icons/` (por ejemplo
   arrastrando el zip o la carpeta a https://app.netlify.com/drop). Con esos archivos la página se puede
   instalar como app en el celular y en el PC.
5. **Authentication → Configuración → Dominios autorizados**: agregar el dominio del hosting
   (por ejemplo `nombre-al-azar.netlify.app`).
6. Abrir la página: la primera vez pide crear la cuenta de administrador.

## Flujo del taller

1. **Orden de trabajo**: cuando entra el vehículo (desde la ficha del vehículo o *Órdenes → Nueva orden*).
2. **Recepción**: kilometraje, combustible, checklist, observaciones, fotos (se comprimen en el teléfono)
   y firma del cliente con el dedo. Se puede descargar la hoja de recepción para imprimir o guardar como PDF.
3. **Cotización** desde la orden. Al enviarla por WhatsApp, Gmail o copiando el enlace, el cliente la abre
   en `index.html?c=<token>` (sin cuenta) y la aprueba o rechaza; la cotización y la orden se actualizan solas.
4. **Reparación y cobros**: estados de la orden, mecánico asignado, anticipos y pagos (efectivo, tarjeta,
   transferencia), saldo pendiente y mensaje de WhatsApp para avisar que el vehículo está listo.
5. **Reportes**: cobrado en el mes, por cobrar, órdenes ingresadas y entregadas, por método de pago y por mecánico.

Las fotos y la firma de cada recepción se guardan en `ordenes/<id>/imagenes`. La copia de cada cotización
que ve el cliente se guarda en `publicas/<token>`; las reglas solo le permiten leerla y responderla una vez.

## Roles

| Rol | Puede |
| --- | --- |
| Administrador | Todo: usuarios, ajustes, eliminar |
| Recepción | Clientes, vehículos y cotizaciones, incluido eliminar |
| Mecánico | Registrar y editar, sin eliminar |

Las reglas de `firestore.rules` aplican estos permisos en el servidor: una cuenta que no esté
registrada y activa en "Usuarios" no puede leer ni escribir nada.

## App instalable

`manifest.webmanifest`, `sw.js` e `icons/` hacen que la página se instale como app (ícono propio, pantalla
completa, abre sin internet). Al publicar una versión nueva de `index.html`, la app la toma sola la próxima vez
que se abre con internet. Si cambian los íconos u otros archivos, sube también `sw.js` con `VERSION` actualizado.
