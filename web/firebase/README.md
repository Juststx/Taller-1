# Taller — versión con Firebase

`index.html` es la misma web del taller, pero guarda los datos en Firestore (proyecto
`taller-automotriz-38ab1`) y cada persona entra con correo y contraseña. Funciona en cualquier
hosting estático y en el celular (se puede "Agregar a la pantalla de inicio").

## Puesta en marcha (una sola vez)

1. **Authentication** → Métodos de acceso → activar **Correo electrónico/contraseña**.
2. **Firestore Database** → crear la base de datos en modo producción.
3. **Firestore Database → Reglas**: pegar el contenido de `firestore.rules` y **Publicar**.
4. Publicar `index.html` en un hosting (por ejemplo arrastrando esta carpeta a https://app.netlify.com/drop).
5. **Authentication → Configuración → Dominios autorizados**: agregar el dominio del hosting
   (por ejemplo `nombre-al-azar.netlify.app`).
6. Abrir la página: la primera vez pide crear la cuenta de administrador.

## Roles

| Rol | Puede |
| --- | --- |
| Administrador | Todo: usuarios, ajustes, eliminar |
| Recepción | Clientes, vehículos y cotizaciones, incluido eliminar |
| Mecánico | Registrar y editar, sin eliminar |

Las reglas de `firestore.rules` aplican estos permisos en el servidor: una cuenta que no esté
registrada y activa en "Usuarios" no puede leer ni escribir nada.
