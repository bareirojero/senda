# Senda — Guía de Implementación y Despliegue a Producción

Senda es un hub minimalista de captura rápida que organiza notas, tareas y consultas de IA directamente en tu workspace de Notion.

---

## PASO 1: Despliegue Web & PWA (GitHub + Vercel)

### 1.1. Preparar la integración en Notion
1. Ve a [notion.so/my-integrations](https://www.notion.so/my-integrations) y haz clic en **New integration**.
2. Nómbrala **Senda**, selecciona tu workspace y copia el **Internal Integration Secret** (`ntn_...`).
3. Abre la página o base de datos de Notion donde Senda guardará tus notas, haz clic en el menú `•••` (arriba a la derecha) → **Connections** → selecciona **Senda**.
4. Copia el **ID de la página** desde la URL de Notion (los 32 caracteres al final del enlace, antes del `?`).

### 1.2. Subir el código a GitHub
Crea o selecciona el repositorio en tu cuenta de GitHub donde alojarás el proyecto con esta estructura:
- `index.html`
- `package.json`
- `tsconfig.json`
- `vite.config.ts`
- `public/icon.svg` y `public/manifest.json`
- `api/notion-sync.ts` y `api/ai-route.ts`
- `src/lib/parser.ts`
- `IMPLEMENTACION.md`

```bash
git init
git add .
git commit -m "feat: Senda v1.0 Hub hacia Notion"
git branch -M main
git remote add origin <URL_DE_TU_REPOSITORIO_GITHUB>
git push -u origin main
```

### 1.3. Publicar en Vercel (Frontend + Backend Serverless)
1. Entra a [vercel.com](https://vercel.com) con tu cuenta de GitHub e importa el repositorio elegido.
2. En **Environment Variables**, agrega:
   - `NOTION_TOKEN`: tu secreto `ntn_...`
   - `NOTION_DEFAULT_PAGE_ID`: el ID de 32 caracteres de tu página en Notion
   - `GEMINI_API_KEY`: tu clave de Google AI Studio (para `/gemini` y `/auto`)
   - `CLAUDE_API_KEY`: tu clave de Anthropic (para `/claude`)
3. Haz clic en **Deploy**. En 30 segundos tendrás tu URL HTTPS lista.

### 1.4. Instalar en Android, Windows y Linux (PWA)
- **Android (Chrome):** Abre tu URL de Vercel → menú `⋮` → **Instalar aplicación**. Aparecerá con el ícono de Senda en tu pantalla de inicio.
- **Windows / Linux (Chrome o Edge):** Haz clic en el ícono de instalación en la barra de direcciones para abrir Senda como ventana independiente sin bordes de navegador.

---

## PASO 2: Evolución Nativa (Notion OAuth Multi-Usuario + Binarios Tauri v2)

Una vez que la versión Web/PWA esté corriendo en producción, puedes dar el siguiente salto:

### 2.1. Autenticación OAuth de Notion (Conectar con un clic sin copiar tokens)
1. En [notion.so/my-integrations](https://www.notion.so/my-integrations), cambia el tipo de integración de *Internal* a **Public**.
2. Configura la **Redirect URI** apuntando a `https://tu-dominio.vercel.app/api/oauth-callback`.
3. Al autorizar, Notion devolverá un `access_token`, `workspace_name` y `owner.user.name`, poblando automáticamente la píldora superior derecha con el usuario real conectado.

### 2.2. Empaquetado Nativo Ligero (Windows `.exe`, Linux `.AppImage`, Android `.apk`)
Para compilar binarios nativos ultrarrápidos (~8 MB) reutilizando exactamente el mismo frontend:

```bash
npm install -D @tauri-apps/cli@latest
npx tauri init
```

- **Escritorio (Windows / Linux):**
  ```bash
  npx tauri build
  ```
- **Android (APK nativo):**
  ```bash
  npx tauri android init
  npx tauri android build
  ```
- **Automatización en GitHub Actions:** Puedes añadir un workflow `.github/workflows/release.yml` con `tauri-apps/tauri-action` para que GitHub compile automáticamente los instaladores de Windows, Linux y Android cada vez que publiques un tag `v1.x.x`.
