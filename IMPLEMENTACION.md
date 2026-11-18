# Senda — Guía de Implementación y Despliegue a Producción

Senda es un hub minimalista de captura rápida que organiza notas, tareas y consultas de IA directamente en tu workspace de Notion.

---

## PASO 1: Despliegue Web & PWA (GitHub + Vercel)

### 1.1. Preparar la integración en Notion
1. Ve a [notion.so/my-integrations](https://www.notion.so/my-integrations) y haz clic en **New integration**.
2. Nómbrala **Senda**, selecciona tu workspace y copia el **Internal Integration Secret** (`ntn_...`).
3. Abre la página o base de datos de Notion donde Senda guardará tus notas, haz clic en el menú `•••` (arriba a la derecha) → **Connections** → selecciona **Senda**.
4. Copia el **ID de la página** desde la URL de Notion (los 32 caracteres al final del enlace, antes del `?`).

### 1.2. Repositorio en GitHub
El código vive en **[bareirojero/senda](https://github.com/bareirojero/senda)** con esta estructura:

```
index.html              ← solo marcado; carga /src/main.ts
src/main.ts             ← arranque, vistas, envío del scratchpad, sesión de Notion
src/style.css           ← estilos v5.1 (4 temas)
src/state.ts            ← estado de notas/temas + persistencia
src/types.ts
src/data/commands.ts    ← catálogo del menú /
src/data/seed.ts        ← notas y temas iniciales
src/lib/parser.ts       ← comandos / + Markdown → bloques de la API de Notion
src/lib/markdown.ts     ← render seguro de Markdown en línea
src/lib/storage.ts      ← acceso seguro a localStorage
src/lib/api.ts          ← cliente de /api/*
src/ui/slash-menu.ts    ← menú flotante /
src/ui/feed.ts          ← tarjetas y barra lateral de temas
src/ui/graph.ts         ← red neuronal en <canvas> (ratón + táctil)
api/notion-sync.ts      ← GET usuario+páginas / POST bloques
api/ai-route.ts         ← /gemini, /claude, /auto
api/oauth-login.ts      ← inicia OAuth de Notion
api/oauth-callback.ts   ← canjea el código y guarda la sesión cifrada
api/oauth-logout.ts     ← cierra la sesión
api/_lib/               ← utilidades compartidas (no son endpoints)
tests/                  ← Vitest: parser y flujo OAuth
.github/workflows/ci.yml
```

Comandos locales: `npm install`, `npm run dev`, `npm test`, `npm run build`.

**CI:** cada push a `main` y cada Pull Request ejecuta `typecheck → tests → build` en GitHub Actions y adjunta `dist/` como artefacto.

### 1.3. Publicar en Vercel (Frontend + Backend Serverless)
1. Entra a [vercel.com](https://vercel.com) con tu cuenta de GitHub e importa el repositorio elegido.
2. En **Environment Variables**, agrega (ver `.env.example`):
   - `NOTION_TOKEN`: tu secreto `ntn_...` (modo integración interna)
   - `NOTION_DEFAULT_PAGE_ID`: el ID de 32 caracteres de tu página en Notion
   - `GEMINI_API_KEY`: tu clave de Google AI Studio (para `/gemini` y `/auto`)
   - `CLAUDE_API_KEY`: tu clave de Anthropic (para `/claude`)
   - Opcionales: `GEMINI_MODEL` (por defecto `gemini-3.5-flash`) y `CLAUDE_MODEL` (por defecto `claude-sonnet-5-5`)
3. Haz clic en **Deploy**. En 30 segundos tendrás tu URL HTTPS lista.

### 1.4. Instalar en Android, Windows y Linux (PWA)
- **Android (Chrome):** Abre tu URL de Vercel → menú `⋮` → **Instalar aplicación**. Aparecerá con el ícono de Senda en tu pantalla de inicio.
- **Windows / Linux (Chrome o Edge):** Haz clic en el ícono de instalación en la barra de direcciones para abrir Senda como ventana independiente sin bordes de navegador.

---

## PASO 2: Evolución Nativa (Notion OAuth Multi-Usuario + Binarios Tauri v2)

Una vez que la versión Web/PWA esté corriendo en producción, puedes dar el siguiente salto:

### 2.1. Autenticación OAuth de Notion (Conectar con un clic sin copiar tokens) — ✅ implementado
1. En [notion.so/my-integrations](https://www.notion.so/my-integrations) crea una integración **Public** (o cambia la existente).
2. En **Redirect URIs** agrega exactamente `https://<tu-dominio>.vercel.app/api/oauth-callback` (y la de cada dominio propio que uses).
3. Copia **OAuth client ID** y **OAuth client secret** a Vercel:
   - `NOTION_OAUTH_CLIENT_ID`
   - `NOTION_OAUTH_CLIENT_SECRET`
   - `SESSION_SECRET`: 32+ caracteres aleatorios (`openssl rand -base64 32`). Cifra la cookie de sesión.
   - `APP_URL` (opcional): fuerza el origen de la redirect URI si usas varios dominios.
4. Redeploy. En **Personalizar → Conectar con Notion** el usuario autoriza y elige qué páginas compartir.

Cómo funciona:
- `/api/oauth-login` genera un `state` anti-CSRF (cookie de 10 min) y redirige a Notion.
- `/api/oauth-callback` valida el `state`, canjea el `code` en `https://api.notion.com/v1/oauth/token` y guarda `access_token`, workspace y nombre del usuario en una cookie **httpOnly cifrada con AES-256-GCM** (180 días). El token nunca llega al JavaScript del navegador.
- `/api/notion-sync` usa, por prioridad: token manual (`x-notion-token`) → sesión OAuth → `NOTION_TOKEN`. El `GET` devuelve el usuario real, el workspace y las páginas compartidas; la píldora superior y el selector de **Página destino** se llenan solos.
- `/api/oauth-logout` borra la sesión.

> Nota para Tauri (Paso 2.2): dentro de la app nativa la cookie no viaja entre orígenes; ahí se seguirá usando el token manual o un flujo con deep link, que se resolverá al configurar Tauri.

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

---

## Bases de datos de Notion (tareas con propiedades)

1. En la conexión **Senda** de Notion, da acceso a las bases que quieras usar (p. ej. la página **Tareas**, que contiene *Mis tareas* y *🏗️ Obras*).
2. En **Personalizar → Base de datos para tareas**, elige *Mis tareas*.
3. Escribe una tarea (`/todo` o `#tarea`) y Senda crea una **fila** con las propiedades deducidas del texto:

| Escribes | Propiedad |
|---|---|
| `hoy`, `mañana`, `pasado mañana`, `el viernes`, `3/12`, `en 5 días` | Fecha |
| `8h`, `8:30`, `a las 9`, `5 de la tarde`, `3pm` | Hora de la Fecha |
| `#urgente`, `#master`, `#ruso`, `#personal` | Selects (coincide con el comienzo de la opción) |
| el nombre o una *Palabra clave* de la obra (`PJC`, `Olimpia`) | Relación Obra |

- `@mis-tareas` o `@obras` envían cualquier nota a esa base aunque no sea tarea.
- **Completar propiedades con IA** (Personalizar) suma Gemini/Claude para textos más libres; solo acepta opciones que existan en la base.
- Marcar la casilla en Senda actualiza *Hecho*; borrar la nota manda la fila a la papelera de Notion.
