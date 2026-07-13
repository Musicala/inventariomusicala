# Migración a Firebase — Inventario Musicala

La app ya no usa Google Sheets/Apps Script: ahora todo vive en Firestore del proyecto
**prestamo-de-herramientas** (el mismo de la app de préstamo de herramientas).

## Colecciones que usa el inventario

Todas con prefijo `inventario_` para no chocar con la otra app:

- `inventario_items` — ficha de cada ítem (doc id = item_id)
- `inventario_stock` — stock por ubicación (doc id = `itemId__ubicacion`)
- `inventario_movimientos` — historial
- `inventario_usuarios` — usuarios internos (doc id = uid de Firebase Auth)

## Pasos de configuración (una sola vez)

### 1. Publicar las reglas

En [Firebase Console](https://console.firebase.google.com/project/prestamo-de-herramientas/firestore/rules)
→ Firestore Database → Reglas → pega el contenido de `firestore.rules` y publica.

> Las reglas conservan **exactamente** el acceso que ya tenía la app de préstamos
> (los 4 correos con acceso total). Solo se agregan reglas nuevas para las
> colecciones `inventario_*`.

### 2. Habilitar métodos de acceso en Authentication

En Firebase Console → Authentication → Sign-in method, habilita:

- **Google** (para los admins)
- **Correo electrónico/contraseña** (para los usuarios del equipo)

### 3. Dominios autorizados

En Authentication → Settings → Authorized domains agrega el dominio donde publiques
la app (GitHub Pages, Hosting, etc.). `localhost` ya viene autorizado.

⚠️ El login con Google **no funciona abriendo `index.html` como archivo** (`file://`).
Para probar en local, sirve la carpeta con un servidor, por ejemplo:
`python -m http.server 8080` y abre `http://localhost:8080`.

## Cómo funciona el acceso

- **Admins (Google):** `alekcaballeromusic@gmail.com`, `catalina.medina.leal@gmail.com`,
  `adminmusicala@gmail.com`. Entran con el botón "Entrar con Google". Rol ADMIN automático.
- **Equipo (usuario + contraseña):** los crea un admin desde el panel admin
  (mantener presionado el logo 3 s → "Gestionar usuarios"). Internamente se crean como
  `usuario@inventario-musicala.com` en Firebase Auth, pero la persona solo escribe su usuario.
- Desde ese panel también se puede cambiar rol (USER/ADMIN) y activar/desactivar usuarios.
- **Cambiar contraseña de un usuario:** no se puede desde el front (limitación del SDK web).
  Opciones: hacerlo en Firebase Console → Authentication, o desactivar el usuario y crear uno nuevo.

## Migrar los datos actuales de Sheets

1. Entra con Google como admin.
2. Mantén presionado el logo 3 segundos para abrir el panel admin.
3. Botón **"Migrar datos desde Sheets"** → escribe tu usuario del sistema anterior.
4. Copia ítems, stock y el historial de movimientos a Firestore.

La migración se puede repetir: sobreescribe ítems/stock con lo de la hoja
(los movimientos migrados se duplicarían si la corres dos veces — hazla una sola vez).
Después de migrar y verificar, el Apps Script queda solo como respaldo.
