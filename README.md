# Gastos App — CI para APK (GitHub Actions)

Este repo genera automáticamente un **APK de Android** (Debug por defecto) y lo publica como **artifact** en cada push a `main` (o manualmente con *Run workflow*).

## Cómo usar
1. Sube este código a un repositorio en GitHub (privado o público).
2. Ve a **Actions** y ejecuta el workflow **Android APK (Capacitor)**.
3. Cuando termine, entra al job y descarga el artifact **gastos-app-debug-apk**: `app-debug.apk`.

## Opcional: APK de Release firmado
Agrega estos **Secrets** en el repositorio (Settings > Secrets and variables > Actions > New repository secret):
- `ANDROID_KEYSTORE_BASE64`: tu keystore `.jks` en base64.
- `ANDROID_KEYSTORE_PASSWORD`: password del keystore.
- `ANDROID_KEY_ALIAS`: alias de la clave.
- `ANDROID_KEY_PASSWORD`: password de la clave.

El workflow generará y subirá también **gastos-app-release-apk**.

## Desarrollo local
```bash
npm install
npm run build
npx cap add android
npx cap sync android
# Abrir Android Studio y compilar:
npx cap open android
```

## Notas
- La app usa **localStorage**. En la versión nativa final migraremos a **Room**.
- El paquete (appId) es `com.tuempresa.gastos` (cámbialo en `capacitor.config.ts` si quieres).
